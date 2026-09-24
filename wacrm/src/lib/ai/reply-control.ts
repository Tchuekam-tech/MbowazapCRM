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

export interface TakeoverResult {
  state: AutomationState;
  version: number;
  /** False when neither the RPC nor the fallback UPDATE was written. */
  persisted: boolean;
}

export interface ResumeOptions {
  accountId?: string;
  handlerId?: string;
  /**
   * Release the assignment when it belongs to this user. The reply
   * engine stands down while anyone is assigned, so resuming without
   * releasing the resuming agent's own claim would re-enable nothing.
   */
  releaseAssignee?: string;
}

export interface ResumeResult {
  state: AutomationState;
  version: number;
  /** The assignee after the resume; non-null keeps automation silent. */
  assignedAgentId: string | null;
  persisted: boolean;
}

/**
 * Thrown by the final send gates when automation may not speak on a
 * conversation. The expected outcome of a human takeover, not a
 * failure: callers stand down quietly instead of logging an error.
 */
export class AutomationBlockedError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`automated send blocked: ${reason}`);
    this.name = 'AutomationBlockedError';
    this.reason = reason;
  }
}

export function isAutomationBlockedError(
  err: unknown
): err is AutomationBlockedError {
  return err instanceof AutomationBlockedError;
}

/**
 * Gate 5: the authoritative check right before an automated message
 * leaves. Throws AutomationBlockedError when a human owns the thread or,
 * with `expectedVersion`, when it changed hands since the caller's run
 * began — a check against the database, so it holds across workers.
 */
export async function assertAutomationAllowed(
  db: SupabaseClient,
  args: {
    conversationId: string;
    accountId?: string;
    expectedVersion?: number;
    site: string;
  }
): Promise<void> {
  const gate = await checkAutomationAllowed(
    db,
    args.conversationId,
    args.expectedVersion
  );
  if (gate.allowed) return;
  logReplyControl('automated_send_blocked', {
    conversationId: args.conversationId,
    accountId: args.accountId,
    version: gate.version,
    reason: `${args.site} blocked: ${gate.reason}`,
  });
  throw new AutomationBlockedError(gate.reason ?? 'not_allowed');
}

export interface InFlightAiHandle {
  conversationId: string;
  abortController: AbortController;
  capturedVersion: number;
  stopTyping?: () => Promise<void>;
  startedAt: number;
}

// In-process registry of running AI generations, for zero-latency abort
// on takeover. Several can run at once for one conversation (two inbound
// messages close together), so each conversation holds a set, and a run
// only ever removes its own handle.
const activeAiRuns = new Map<string, Set<InFlightAiHandle>>();

export function registerInFlightAi(handle: InFlightAiHandle): void {
  let runs = activeAiRuns.get(handle.conversationId);
  if (!runs) {
    runs = new Set();
    activeAiRuns.set(handle.conversationId, runs);
  }
  runs.add(handle);
}

/** Without `handle`, forgets every run for the conversation. */
export function unregisterInFlightAi(
  conversationId: string,
  handle?: InFlightAiHandle
): void {
  if (!handle) {
    activeAiRuns.delete(conversationId);
    return;
  }
  const runs = activeAiRuns.get(conversationId);
  if (!runs) return;
  runs.delete(handle);
  if (runs.size === 0) activeAiRuns.delete(conversationId);
}

/** The most recently registered run for the conversation. */
export function getInFlightAi(conversationId: string): InFlightAiHandle | undefined {
  const runs = activeAiRuns.get(conversationId);
  if (!runs) return undefined;
  let latest: InFlightAiHandle | undefined;
  for (const handle of runs) latest = handle;
  return latest;
}

export async function abortInFlightAi(
  conversationId: string,
  reason: string
): Promise<void> {
  const runs = activeAiRuns.get(conversationId);
  if (!runs) return;
  activeAiRuns.delete(conversationId);

  for (const handle of runs) {
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

function rpcFailureDetail(err: { message?: string } | null, rows: unknown): string {
  if (err) return err.message ?? 'unknown error';
  return Array.isArray(rows) && rows.length === 0 ? 'no row updated' : 'no result';
}

/**
 * Authoritatively transition a conversation to HUMAN_HANDLING.
 * Increments automation_version to atomically invalidate all stale in-flight / queued work,
 * aborts running AI generation in memory, and pauses active Flow runs.
 *
 * Never throws; `persisted: false` means the state could not be written
 * (the caller decides whether that is fatal — a human's send is not
 * blocked on it, an explicit "Take over" click is).
 */
export async function takeoverConversation(
  db: SupabaseClient,
  conversationId: string,
  options: TakeoverOptions
): Promise<TakeoverResult> {
  let pauseUntilIso: string | null = options.pauseUntil || null;
  if (!pauseUntilIso && options.pauseMinutes && options.pauseMinutes > 0) {
    pauseUntilIso = new Date(Date.now() + options.pauseMinutes * 60 * 1000).toISOString();
  }

  // 1. Immediately abort any in-process AI generation & typing
  await abortInFlightAi(conversationId, options.reason);

  // 2. Perform atomic database transition (via RPC or direct fallback update)
  let newState: AutomationState = 'human_handling';
  let newVersion = 1;
  let persisted = false;

  try {
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
        persisted = true;
      } else {
        console.warn(
          `[reply-control] takeover RPC failed for ${conversationId}, falling back to a direct update:`,
          rpcFailureDetail(rpcErr, rpcData)
        );
      }
    }

    if (!persisted) {
      // Non-atomic fallback (RPC unavailable). Same writes as the RPC.
      const { data: current, error: readErr } = await db
        .from('conversations')
        .select('automation_version')
        .eq('id', conversationId)
        .maybeSingle();
      if (readErr || !current) {
        throw new Error(readErr?.message ?? 'conversation not found');
      }
      newVersion = ((current.automation_version as number) || 1) + 1;

      const { error: updateErr } = await db
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
      if (updateErr) throw new Error(updateErr.message);
      persisted = true;
    }
  } catch (err) {
    console.error('[reply-control] takeover DB update failed:', err);
  }

  logReplyControl('human_takeover_started', {
    conversationId,
    accountId: options.accountId,
    version: newVersion,
    reason: options.reason,
    details: { persisted },
  });

  // 3. Pause any active flow runs for this conversation
  try {
    let clientToUse = db;
    try {
      clientToUse = supabaseAdmin();
    } catch (_) {}

    const { error: pauseErr } = await clientToUse
      .from('flow_runs')
      .update({
        status: 'paused_by_agent',
        ended_at: new Date().toISOString(),
        end_reason: `human_takeover:${options.reason}`,
      })
      .eq('conversation_id', conversationId)
      .eq('status', 'active');
    if (pauseErr) throw new Error(pauseErr.message);
  } catch (err) {
    console.error('[reply-control] flow_runs pause failed:', err);
  }

  return { state: newState, version: newVersion, persisted };
}

/**
 * Authoritatively resume automation for a conversation.
 * Re-enables automation, resets the per-conversation reply count, clears
 * the handoff note, releases `releaseAssignee`'s own assignment, and
 * increments the version so stale queued runs are never resurrected.
 * Never throws; see `persisted`.
 */
export async function resumeConversation(
  db: SupabaseClient,
  conversationId: string,
  options: ResumeOptions = {}
): Promise<ResumeResult> {
  let newState: AutomationState = 'active';
  let newVersion = 1;
  let assignedAgentId: string | null = null;
  let persisted = false;

  try {
    if (typeof db.rpc === 'function') {
      const { data: rpcData, error: rpcErr } = await db.rpc(
        'resume_conversation_automation',
        {
          p_conversation_id: conversationId,
          p_release_assignee: options.releaseAssignee ?? null,
        }
      );

      if (!rpcErr && rpcData && rpcData.length > 0) {
        newState = (rpcData[0].new_state as AutomationState) || 'active';
        newVersion = Number(rpcData[0].new_version) || 1;
        assignedAgentId = (rpcData[0].new_assigned_agent_id as string | null) ?? null;
        persisted = true;
      } else {
        console.warn(
          `[reply-control] resume RPC failed for ${conversationId}, falling back to a direct update:`,
          rpcFailureDetail(rpcErr, rpcData)
        );
      }
    }

    if (!persisted) {
      // Non-atomic fallback (RPC unavailable). Same writes as the RPC.
      const { data: current, error: readErr } = await db
        .from('conversations')
        .select('automation_version, assigned_agent_id')
        .eq('id', conversationId)
        .maybeSingle();
      if (readErr || !current) {
        throw new Error(readErr?.message ?? 'conversation not found');
      }
      newVersion = ((current.automation_version as number) || 1) + 1;
      const currentAssignee = (current.assigned_agent_id as string | null) ?? null;
      const release =
        !!options.releaseAssignee && currentAssignee === options.releaseAssignee;
      assignedAgentId = release ? null : currentAssignee;

      const { error: updateErr } = await db
        .from('conversations')
        .update({
          automation_state: 'active',
          automation_version: newVersion,
          ai_autoreply_disabled: false,
          ai_paused_until: null,
          ai_reply_count: 0,
          ai_handoff_summary: null,
          ...(release ? { assigned_agent_id: null } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq('id', conversationId);
      if (updateErr) throw new Error(updateErr.message);
      persisted = true;
    }
  } catch (err) {
    console.error('[reply-control] resume DB update failed:', err);
  }

  logReplyControl('automation_run_invalidated', {
    conversationId,
    accountId: options.accountId,
    version: newVersion,
    reason: 'resumed_with_fresh_version',
    details: { persisted, stillAssigned: assignedAgentId !== null },
  });

  return { state: newState, version: newVersion, assignedAgentId, persisted };
}
