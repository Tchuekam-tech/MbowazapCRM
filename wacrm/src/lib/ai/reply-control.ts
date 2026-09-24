// ============================================================
// Authoritative Reply Engine Control & Concurrency State
//
// Governs whether automated AI and Flow responses may run, advance,
// or send. Guarantees that when Davila or a human agent takes over:
//   1. In-flight AI generations are immediately aborted / invalidated.
//   2. AI typing indicators on MboWazap immediately stop.
//   3. Active flow runs pause cleanly.
//   4. Stale queued or retrying runs fail the version check and discard.
//   5. Final outbound send gates block any automated escape.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AutomationState } from '@/types';
import { logReplyControl } from './reply-control-log';
import { supabaseAdmin } from './admin-client';

export interface AutomationCheckResult {
  allowed: boolean;
  reason?: string;
  state: AutomationState;
  version: number;
}

export interface TakeoverOptions {
  reason: string;
  handlerId?: string;
  pauseUntil?: string | null;
  pauseMinutes?: number;
  accountId?: string;
}

export interface InFlightAiHandle {
  conversationId: string;
  abortController: AbortController;
  capturedVersion: number;
  stopTyping?: () => Promise<void>;
  startedAt: number;
}

// In-process active AI run registry for immediate zero-latency abort
const activeAiRuns = new Map<string, InFlightAiHandle>();

export function registerInFlightAi(handle: InFlightAiHandle): void {
  activeAiRuns.set(handle.conversationId, handle);
}

export function unregisterInFlightAi(conversationId: string): void {
  activeAiRuns.delete(conversationId);
}

export function getInFlightAi(conversationId: string): InFlightAiHandle | undefined {
  return activeAiRuns.get(conversationId);
}

export async function abortInFlightAi(
  conversationId: string,
  reason: string
): Promise<void> {
  const handle = activeAiRuns.get(conversationId);
  if (!handle) return;
  activeAiRuns.delete(conversationId);

  logReplyControl('automation_cancelled', {
    conversationId,
    version: handle.capturedVersion,
    reason,
  });

  try {
    handle.abortController.abort(new Error(`Cancelled: ${reason}`));
  } catch (_) {}

  if (handle.stopTyping) {
    try {
      await handle.stopTyping();
    } catch (_) {}
  }
}

/**
 * Authoritatively check if automation is currently allowed for this conversation.
 * Verifies both the state ('active' vs 'human_handling'), the temporary pause window,
 * and optionally the version precondition.
 */
export async function checkAutomationAllowed(
  db: SupabaseClient,
  conversationId: string,
  expectedVersion?: number
): Promise<AutomationCheckResult> {
  const { data: conv, error } = await db
    .from('conversations')
    .select('automation_state, automation_version, ai_paused_until, ai_autoreply_disabled, assigned_agent_id')
    .eq('id', conversationId)
    .maybeSingle();

  if (error) {
    return {
      allowed: false,
      reason: `db_error: ${error.message}`,
      state: 'human_handling',
      version: 0,
    };
  }

  if (!conv) {
    return {
      allowed: true,
      reason: 'conversation_not_found',
      state: 'active',
      version: 1,
    };
  }

  const rawState = (conv.automation_state as AutomationState) || (conv.ai_autoreply_disabled ? 'human_handling' : 'active');
  const version = typeof conv.automation_version === 'number' ? conv.automation_version : 1;

  // Check version precondition if caller passed expectedVersion
  if (expectedVersion !== undefined && version !== expectedVersion) {
    return {
      allowed: false,
      reason: `version_mismatch: expected ${expectedVersion}, got ${version}`,
      state: rawState,
      version,
    };
  }

  // If a human is assigned, human handling is authoritative
  if (conv.assigned_agent_id) {
    return {
      allowed: false,
      reason: 'human_agent_assigned',
      state: 'human_handling',
      version,
    };
  }

  // Check state and paused until
  if (rawState === 'human_handling' || conv.ai_autoreply_disabled) {
    if (conv.ai_paused_until) {
      const until = Date.parse(conv.ai_paused_until);
      if (Date.now() < until) {
        return {
          allowed: false,
          reason: 'human_handling_temporary_pause',
          state: 'human_handling',
          version,
        };
      }
      // Pause window expired
    } else {
      return {
        allowed: false,
        reason: 'human_handling_active',
        state: 'human_handling',
        version,
      };
    }
  }

  return {
    allowed: true,
    state: 'active',
    version,
  };
}

/**
 * Authoritatively transition a conversation to HUMAN_HANDLING.
 * Increments automation_version to atomically invalidate all stale in-flight / queued work,
 * aborts running AI generation in memory, and pauses active Flow runs.
 */
export async function takeoverConversation(
  db: SupabaseClient,
  conversationId: string,
  options: TakeoverOptions
): Promise<{ state: AutomationState; version: number }> {
  let pauseUntilIso: string | null = options.pauseUntil || null;
  if (!pauseUntilIso && options.pauseMinutes && options.pauseMinutes > 0) {
    pauseUntilIso = new Date(Date.now() + options.pauseMinutes * 60 * 1000).toISOString();
  }

  // 1. Immediately abort any in-process AI generation & typing
  await abortInFlightAi(conversationId, options.reason);

  // 2. Perform atomic database transition (via RPC or direct fallback update)
  let newState: AutomationState = 'human_handling';
  let newVersion = 1;

  try {
    let rpcSuccess = false;
    if (typeof db.rpc === 'function') {
      const { data: rpcData, error: rpcErr } = await db.rpc(
        'takeover_conversation_automation',
        {
          p_conversation_id: conversationId,
          p_reason: options.reason,
          p_handler_id: options.handlerId ?? null,
          p_pause_until: pauseUntilIso,
        }
      );
      if (!rpcErr && rpcData && rpcData.length > 0) {
        newState = (rpcData[0].new_state as AutomationState) || 'human_handling';
        newVersion = Number(rpcData[0].new_version) || 1;
        rpcSuccess = true;
      }
    }

    if (!rpcSuccess) {
      // Fallback update if RPC is missing in local test env
      const { data: current } = await db
        .from('conversations')
        .select('automation_version')
        .eq('id', conversationId)
        .maybeSingle();
      newVersion = ((current?.automation_version as number) || 1) + 1;

      await db
        .from('conversations')
        .update({
          automation_state: 'human_handling',
          automation_version: newVersion,
          human_handled_at: new Date().toISOString(),
          human_handler_id: options.handlerId ?? null,
          human_handling_reason: options.reason,
          ai_autoreply_disabled: true,
          ai_paused_until: pauseUntilIso,
          updated_at: new Date().toISOString(),
        })
        .eq('id', conversationId);
    }
  } catch (err) {
    console.error('[reply-control] takeover DB update failed:', err);
  }

  logReplyControl('human_takeover_started', {
    conversationId,
    accountId: options.accountId,
    version: newVersion,
    reason: options.reason,
  });

  // 3. Pause any active flow runs for this conversation
  try {
    let clientToUse = db;
    try {
      clientToUse = supabaseAdmin();
    } catch (_) {}

    await clientToUse
      .from('flow_runs')
      .update({
        status: 'paused_by_agent',
        ended_at: new Date().toISOString(),
        end_reason: `human_takeover:${options.reason}`,
      })
      .eq('conversation_id', conversationId)
      .eq('status', 'active');
  } catch (err) {
    console.error('[reply-control] flow_runs pause failed:', err);
  }

  return { state: newState, version: newVersion };
}

/**
 * Authoritatively resume automation for a conversation.
 * Re-enables automation and increments version so stale queued runs are never resurrected.
 */
export async function resumeConversation(
  db: SupabaseClient,
  conversationId: string,
  options?: { accountId?: string; handlerId?: string }
): Promise<{ state: AutomationState; version: number }> {
  let newState: AutomationState = 'active';
  let newVersion = 1;

  try {
    let rpcSuccess = false;
    if (typeof db.rpc === 'function') {
      const { data: rpcData, error: rpcErr } = await db.rpc(
        'resume_conversation_automation',
        { p_conversation_id: conversationId }
      );

      if (!rpcErr && rpcData && rpcData.length > 0) {
        newState = (rpcData[0].new_state as AutomationState) || 'active';
        newVersion = Number(rpcData[0].new_version) || 1;
        rpcSuccess = true;
      }
    }

    if (!rpcSuccess) {
      const { data: current } = await db
        .from('conversations')
        .select('automation_version')
        .eq('id', conversationId)
        .maybeSingle();
      newVersion = ((current?.automation_version as number) || 1) + 1;

      await db
        .from('conversations')
        .update({
          automation_state: 'active',
          automation_version: newVersion,
          ai_autoreply_disabled: false,
          ai_paused_until: null,
          ai_handoff_summary: null,
          assigned_agent_id: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', conversationId);
    }
  } catch (err) {
    console.error('[reply-control] resume DB update failed:', err);
  }

  logReplyControl('automation_run_invalidated', {
    conversationId,
    accountId: options?.accountId,
    version: newVersion,
    reason: 'resumed_with_fresh_version',
  });

  return { state: newState, version: newVersion };
}
