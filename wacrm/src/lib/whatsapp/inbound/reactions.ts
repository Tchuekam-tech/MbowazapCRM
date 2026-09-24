// ============================================================
// Inbound customer reactions.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { lookupInternalIdByMetaId } from './conversations';

export interface InboundReactionParams {
  /** Provider id of the message reacted to. */
  targetMessageId: string;
  conversationId: string;
  contactId: string;
  /** Empty or missing = the reaction was removed. */
  emoji?: string | null;
}

/**
 * Persist an inbound reaction. WhatsApp reactions are not new messages —
 * they're per-(target, actor) state. We upsert / delete on
 * `message_reactions`, never write a row into `messages`.
 *
 * Best-effort: a missing parent (we never received it) is logged and
 * skipped so the webhook still acks 200 to Meta.
 */
export async function handleInboundReaction(
  db: SupabaseClient,
  params: InboundReactionParams
): Promise<void> {
  const { targetMessageId, conversationId, contactId, emoji } = params;
  if (!targetMessageId) return;

  const targetInternalId = await lookupInternalIdByMetaId(
    db,
    targetMessageId,
    conversationId
  );
  if (!targetInternalId) {
    console.warn(
      '[webhook] reaction target message not found; skipping',
      targetMessageId
    );
    return;
  }

  // Empty emoji = removal (per Meta's Cloud API spec; Baileys does the same).
  if (!emoji) {
    const { error: delError } = await db
      .from('message_reactions')
      .delete()
      .eq('message_id', targetInternalId)
      .eq('actor_type', 'customer')
      .eq('actor_id', contactId);
    if (delError) {
      console.error('[webhook] reaction delete failed:', delError.message);
    }
    return;
  }

  const { error: upsertError } = await db.from('message_reactions').upsert(
    {
      message_id: targetInternalId,
      conversation_id: conversationId,
      actor_type: 'customer',
      actor_id: contactId,
      emoji,
    },
    { onConflict: 'message_id,actor_type,actor_id' }
  );
  if (upsertError) {
    console.error('[webhook] reaction upsert failed:', upsertError.message);
  }
}
