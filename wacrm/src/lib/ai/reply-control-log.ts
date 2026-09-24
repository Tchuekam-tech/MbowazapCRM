// ============================================================
// Structured logging for Reply Engine Control (migration 045).
//
// Records state transitions, invalidations, typing lifecycles, and
// blocked automated sends with complete audit metadata.
// Never logs secrets, keys, or private customer message contents.
// ============================================================

export type ReplyControlEventType =
  | 'human_takeover_started'
  | 'automation_cancelled'
  | 'automation_run_invalidated'
  | 'ai_generation_started'
  | 'ai_generation_discarded'
  | 'ai_generation_completed'
  | 'typing_started'
  | 'typing_stopped'
  | 'flow_cancelled'
  | 'automated_send_blocked';

export interface ReplyControlLogPayload {
  conversationId: string;
  accountId?: string;
  runId?: string;
  messageId?: string;
  workerId?: string;
  version?: number;
  reason?: string;
  details?: Record<string, unknown>;
}

export function logReplyControl(
  event: ReplyControlEventType,
  payload: ReplyControlLogPayload
): void {
  const entry = {
    timestamp: new Date().toISOString(),
    system: 'reply_engine_control',
    event,
    ...payload,
  };
  console.log(`[reply-control] ${event}:`, JSON.stringify(entry));
}
