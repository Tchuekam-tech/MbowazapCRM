// ============================================================
// Delivery status updates (sent / delivered / read / failed) for
// messages we sent — from Meta's webhook, and (with the same ladder
// rules) from MboWazap's bridge events.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver';

// The happy-path status ladder — pending → sent → delivered → read →
// replied. Webhook replays must never regress a recipient back down
// this ladder.
//
// `failed` is NOT on this ladder. It's a terminal side branch that is
// only valid from the early states (pending / sent) — once Meta has
// delivered or the user has read or replied, a later "failed" status
// event is a bug in Meta's pipeline or a spoof attempt and must be
// ignored.
export const RECIPIENT_STATUS_LADDER = [
  'pending',
  'sent',
  'delivered',
  'read',
  'replied',
] as const;

export function ladderLevel(s: string): number {
  const idx = (RECIPIENT_STATUS_LADDER as readonly string[]).indexOf(s);
  return idx < 0 ? -1 : idx;
}

/**
 * Can a recipient transition from `current` to `incoming`?
 *   - Along the ladder, only forward moves are allowed.
 *   - `failed` is accepted only from `pending` or `sent`; it's refused
 *     once the recipient has reached any of the success states.
 */
export function isValidStatusTransition(
  current: string,
  incoming: string
): boolean {
  if (incoming === 'failed') {
    return current === 'pending' || current === 'sent';
  }
  if (current === 'failed') {
    return false; // failed is terminal
  }
  const ci = ladderLevel(current);
  const ii = ladderLevel(incoming);
  if (ii < 0) return false; // unknown incoming status
  if (ci < 0) return true; // unknown current — accept anything on the ladder
  return ii > ci;
}

export interface InboundStatusError {
  code: number;
  title: string;
  message?: string;
  error_data?: { details?: string };
  href?: string;
}

export interface InboundStatusPayload {
  id: string;
  status: string;
  /** Unix seconds — a string from Meta, a number from MboWazap. */
  timestamp: string | number;
  recipient_id?: string;
  errors?: InboundStatusError[];
}

export async function handleStatusUpdate(
  db: SupabaseClient,
  status: InboundStatusPayload
): Promise<void> {
  // Meta's reason for a failed send (#535). Only read on `failed`; a
  // later non-failed status for the same wamid leaves the error
  // columns alone rather than clearing them, so the reason survives.
  const failure =
    status.status === 'failed' && status.errors?.[0]
      ? {
          code: status.errors[0].code,
          title: status.errors[0].title,
          details: status.errors[0].error_data?.details ?? null,
        }
      : null;

  if (failure) {
    console.warn(
      `WhatsApp message ${status.id} failed: [${failure.code}] ${failure.title}` +
        (failure.details ? ` — ${failure.details}` : '')
    );
  }

  // 1) Mirror onto messages (legacy behavior) — Meta's status values
  //    already match the CHECK constraint on messages.status. No
  //    `.select()`: message_id is NOT unique (migration 009 — Meta ids
  //    repeat across numbers), so this updates 0..N rows and must not
  //    assume a single row.
  const messageUpdate: Record<string, unknown> = { status: status.status };
  if (failure) {
    messageUpdate.error_code = failure.code;
    messageUpdate.error_title = failure.title;
    messageUpdate.error_details = failure.details;
  }
  const { error: msgErr } = await db
    .from('messages')
    .update(messageUpdate)
    .eq('message_id', status.id);

  if (msgErr) {
    console.error('Error updating message status:', msgErr);
  }

  // Webhook fan-out for this status change happens at the END of this
  // handler (after the broadcast mirror below), so a slow subscriber
  // endpoint can't delay the broadcast_recipients update.

  // 2) Mirror onto broadcast_recipients via whatsapp_message_id
  //    (added in migration 003). The aggregate trigger on
  //    broadcast_recipients re-derives the parent broadcast's
  //    sent/delivered/read/failed counts automatically.
  const tsSeconds =
    typeof status.timestamp === 'string'
      ? parseInt(status.timestamp, 10)
      : status.timestamp;
  const tsIso = new Date(tsSeconds * 1000).toISOString();

  const { data: recipient, error: recFetchErr } = await db
    .from('broadcast_recipients')
    .select('id, status')
    .eq('whatsapp_message_id', status.id)
    .maybeSingle();

  if (recFetchErr) {
    console.error('Error fetching broadcast recipient:', recFetchErr);
  } else if (
    recipient &&
    // Guard transitions — forward-only on the success ladder, and
    // `failed` only from pre-delivered states.
    isValidStatusTransition(recipient.status, status.status)
  ) {
    const update: Record<string, unknown> = { status: status.status };
    if (status.status === 'sent' && !('sent_at' in update)) update.sent_at = tsIso;
    if (status.status === 'delivered') update.delivered_at = tsIso;
    if (status.status === 'read') update.read_at = tsIso;
    // broadcast_recipients already has a free-text error_message column
    // (migration 001), so the reason is folded into it rather than
    // adding three more columns there.
    if (failure) {
      update.error_message =
        `[${failure.code}] ${failure.title}` +
        (failure.details ? `: ${failure.details}` : '');
    }

    const { error: recUpdateErr } = await db
      .from('broadcast_recipients')
      .update(update)
      .eq('id', recipient.id);

    if (recUpdateErr) {
      console.error('Error updating broadcast recipient status:', recUpdateErr);
    }
  }

  // 3) Webhook fan-out for messages we store (inbox / API sends).
  //    Runs last so a slow subscriber can't delay the mirrors above.
  //    Bounded to one row (message_id isn't unique) purely to resolve
  //    the owning account for delivery.
  const { data: msgRow } = await db
    .from('messages')
    .select('conversation_id, conversations(account_id)')
    .eq('message_id', status.id)
    .limit(1)
    .maybeSingle();

  if (msgRow) {
    // The embedded relation comes back as an object for a to-one join,
    // but tolerate the array shape too.
    const rawConv = msgRow.conversations as unknown;
    const conv = Array.isArray(rawConv)
      ? (rawConv[0] as { account_id?: string } | undefined)
      : (rawConv as { account_id?: string } | null);
    const accountId = conv?.account_id;
    if (accountId) {
      await dispatchWebhookEvent(db, accountId, 'message.status_updated', {
        whatsapp_message_id: status.id,
        conversation_id: msgRow.conversation_id,
        status: status.status,
      });
    }
  }
}
