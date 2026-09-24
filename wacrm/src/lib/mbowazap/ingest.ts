// ============================================================
// MboWazap event ingestion: turns the bot's event batches into
// contacts, conversations, messages, delivery statuses, reactions and
// CRM facts — the same records the Meta webhook produces, so the inbox,
// pipelines and automations work unchanged.
//
// Delivery is at-least-once, so every event must be safe to replay:
// messages are upserted on (conversation_id, message_id), statuses only
// move forward, and the CRM writes (./crm.ts) are idempotent.
//
// Errors split two ways. An `IngestRejection` means the event can never
// apply (e.g. no account is paired with the session): it is reported
// back and the rest of the batch continues. Anything else — a database
// hiccup — fails the whole batch so the bot retries it later; events
// already applied are then replayed harmlessly.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe';
import { mergeContacts } from '@/lib/contacts/merge';
import { normalizePhone } from '@/lib/whatsapp/phone-utils';
import { reopenClosedConversation } from '@/lib/conversations/reopen';
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver';
import { dispatchInboundLifecycle } from '@/lib/whatsapp/inbound/lifecycle';
import {
  findOrCreateContact,
  type ContactRow,
} from '@/lib/whatsapp/inbound/contacts';
import {
  findOrCreateConversation,
  flagBroadcastReplyIfAny,
  lookupInternalIdByMetaId,
  type ConversationRow,
} from '@/lib/whatsapp/inbound/conversations';
import { handleInboundReaction } from '@/lib/whatsapp/inbound/reactions';
import { isValidStatusTransition } from '@/lib/whatsapp/inbound/status';
import {
  findAccountByPairingRef,
  findAccountBySession,
  type MbowazapAccount,
} from './accounts';
import {
  applyContactFacts,
  applyDealClosed,
  MBOWAZAP_TAGS,
  setConversationAiPaused,
  tagContact,
} from './crm';
import type {
  BridgeEvent,
  ChatRef,
  ConnectionEvent,
  EventBatch,
  MessageEvent,
  MessageKind,
  RejectedEvent,
  StatusEvent,
} from './protocol';

/** The event can never apply; report it and carry on with the batch. */
export class IngestRejection extends Error {}

export interface IngestContext {
  db: SupabaseClient;
  /** Queue work that may finish after the response (flows, automations, AI, webhooks). */
  defer: (task: () => Promise<void>) => void;
  now?: () => number;
}

export interface IngestResult {
  accepted: number;
  /** `index` is the event's position within `batch.events`. */
  rejected: RejectedEvent[];
}

const CONTENT_TYPES: Record<MessageKind, string> = {
  text: 'text',
  image: 'image',
  video: 'video',
  audio: 'audio',
  document: 'document',
  sticker: 'image',
  location: 'location',
  unsupported: 'text',
};

function fail(what: string, error: { message: string }): never {
  throw new Error(`${what}: ${error.message}`);
}

function contentTextOf(e: MessageEvent): string | null {
  if (e.text) return e.text;
  // Same rendering as the Meta webhook's location messages.
  if (e.kind === 'location' && e.location) {
    const l = e.location;
    return [l.name, l.address, `${l.latitude},${l.longitude}`]
      .filter(Boolean)
      .join(' - ');
  }
  if (e.kind === 'unsupported') return '[Unsupported message]';
  return null;
}

/**
 * The contact a chat belongs to.
 *
 * Handles single-key and dual-key resolution:
 * 1. If both LID and phone are provided:
 *    - Looks up by LID and by phone.
 *    - If both match two different rows, merges them via mergeContacts.
 *    - Backfills whichever key the existing record was missing.
 * 2. If only LID is provided:
 *    - Looks up by LID; creates a LID-only contact if not found.
 * 3. If only phone is provided:
 *    - Looks up or creates via phone deduplication.
 */
async function resolveContact(
  db: SupabaseClient,
  account: MbowazapAccount,
  chat: ChatRef,
  create: boolean
): Promise<{ contact: ContactRow; wasCreated: boolean } | null> {
  const lid = chat.lid?.trim() || null;
  const rawPhone = chat.phone?.trim() || null;
  const normalizedPhone = rawPhone ? normalizePhone(rawPhone) : null;

  // 1. Dual-identifier resolution
  if (lid && normalizedPhone && rawPhone) {
    const { data: byLid, error: lidErr } = await db
      .from('contacts')
      .select('*')
      .eq('account_id', account.accountId)
      .eq('wa_lid', lid)
      .maybeSingle();
    if (lidErr) fail('contact lookup by LID failed', lidErr);

    const byPhone = await findExistingContact(db, account.accountId, rawPhone);

    if (byLid && byPhone) {
      if (byLid.id === byPhone.id) {
        if (!byLid.phone) {
          await db
            .from('contacts')
            .update({ phone: rawPhone, updated_at: new Date().toISOString() })
            .eq('id', byLid.id);
          byLid.phone = rawPhone;
        }
        return { contact: byLid, wasCreated: false };
      }

      // Two distinct contacts exist for the same individual (e.g. LID-only created first).
      // Merge byLid into byPhone (the phone-bearing contact survives).
      await mergeContacts(db, {
        accountId: account.accountId,
        survivorContactId: byPhone.id,
        loserContactId: byLid.id,
        newLid: lid,
      });

      const { data: survivor, error: sErr } = await db
        .from('contacts')
        .select('*')
        .eq('id', byPhone.id)
        .single();
      if (sErr || !survivor) fail('fetching merged contact failed', sErr || { message: 'survivor missing' });
      return { contact: survivor, wasCreated: false };
    }

    if (byLid && !byPhone) {
      if (!byLid.phone) {
        const { error: patchError } = await db
          .from('contacts')
          .update({ phone: rawPhone, updated_at: new Date().toISOString() })
          .eq('id', byLid.id);
        if (patchError) {
          if (isUniqueViolation(patchError)) {
            const racing = await findExistingContact(db, account.accountId, rawPhone);
            if (racing && racing.id !== byLid.id) {
              await mergeContacts(db, {
                accountId: account.accountId,
                survivorContactId: racing.id,
                loserContactId: byLid.id,
                newLid: lid,
              });
              const { data: survivor } = await db.from('contacts').select('*').eq('id', racing.id).single();
              if (survivor) return { contact: survivor, wasCreated: false };
            }
          } else {
            fail('contact phone backfill failed', patchError);
          }
        } else {
          byLid.phone = rawPhone;
        }
      }
      return { contact: byLid, wasCreated: false };
    }

    if (byPhone && !byLid) {
      if (!byPhone.wa_lid) {
        const { error: lidError } = await db
          .from('contacts')
          .update({ wa_lid: lid, updated_at: new Date().toISOString() })
          .eq('id', byPhone.id);
        if (lidError) {
          if (isUniqueViolation(lidError)) {
            const { data: racingLid } = await db
              .from('contacts')
              .select('*')
              .eq('account_id', account.accountId)
              .eq('wa_lid', lid)
              .maybeSingle();
            if (racingLid && racingLid.id !== byPhone.id) {
              await mergeContacts(db, {
                accountId: account.accountId,
                survivorContactId: byPhone.id,
                loserContactId: racingLid.id,
                newLid: lid,
              });
              const { data: survivor } = await db.from('contacts').select('*').eq('id', byPhone.id).single();
              if (survivor) return { contact: survivor, wasCreated: false };
            }
          } else {
            fail('contact LID backfill failed', lidError);
          }
        } else {
          byPhone.wa_lid = lid;
        }
      }
      return { contact: byPhone, wasCreated: false };
    }

    // Neither exists
    if (!create) return null;
    const identity = {
      phone: rawPhone,
      name: chat.pushName ?? '',
      waUserId: null,
      waParentUserId: null,
      waUsername: null,
    };
    const outcome = await findOrCreateContact(
      db,
      account.accountId,
      account.ownerUserId,
      identity
    );
    if (!outcome) throw new Error('contact create failed');
    if (!outcome.contact.wa_lid) {
      const { error: lidPatchErr } = await db
        .from('contacts')
        .update({ wa_lid: lid, updated_at: new Date().toISOString() })
        .eq('id', outcome.contact.id);
      if (lidPatchErr && !isUniqueViolation(lidPatchErr)) {
        fail('contact LID backfill failed', lidPatchErr);
      }
      outcome.contact.wa_lid = lid;
    }
    return outcome;
  }

  // 2. LID-only
  if (lid) {
    const { data, error } = await db
      .from('contacts')
      .select('*')
      .eq('account_id', account.accountId)
      .eq('wa_lid', lid)
      .maybeSingle();
    if (error) fail('contact lookup by LID failed', error);
    if (data) return { contact: data, wasCreated: false };

    if (!create) return null;
    const { data: created, error: createError } = await db
      .from('contacts')
      .insert({
        account_id: account.accountId,
        user_id: account.ownerUserId,
        phone: '',
        name: chat.pushName || lid,
        wa_lid: lid,
      })
      .select()
      .single();
    if (createError) {
      if (isUniqueViolation(createError)) {
        const { data: raced } = await db
          .from('contacts')
          .select('*')
          .eq('account_id', account.accountId)
          .eq('wa_lid', lid)
          .maybeSingle();
        if (raced) return { contact: raced, wasCreated: false };
      }
      fail('contact create failed', createError);
    }
    return { contact: created, wasCreated: true };
  }

  // 3. Phone-only
  if (rawPhone) {
    const identity = {
      phone: rawPhone,
      name: chat.pushName ?? '',
      waUserId: null,
      waParentUserId: null,
      waUsername: null,
    };
    if (create) {
      const outcome = await findOrCreateContact(
        db,
        account.accountId,
        account.ownerUserId,
        identity
      );
      if (!outcome) throw new Error('contact create failed');
      return outcome;
    } else {
      const found = await findExistingContact(db, account.accountId, rawPhone);
      return found ? { contact: found, wasCreated: false } : null;
    }
  }

  return null;
}

async function findConversation(
  db: SupabaseClient,
  accountId: string,
  contactId: string
): Promise<ConversationRow | null> {
  const { data, error } = await db
    .from('conversations')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true })
    .limit(1);
  if (error) fail('conversation lookup failed', error);
  return (data as ConversationRow[] | null)?.[0] ?? null;
}

async function openConversation(
  ctx: IngestContext,
  account: MbowazapAccount,
  contactId: string
): Promise<ConversationRow> {
  const result = await findOrCreateConversation(
    ctx.db,
    account.accountId,
    account.ownerUserId,
    contactId
  );
  if (!result) throw new Error('conversation lookup/create failed');
  if (result.created) {
    ctx.defer(() =>
      dispatchWebhookEvent(ctx.db, account.accountId, 'conversation.created', {
        conversation_id: result.conversation.id,
        contact_id: contactId,
      })
    );
  }
  return result.conversation;
}

async function ingestMessage(
  ctx: IngestContext,
  account: MbowazapAccount,
  e: MessageEvent
): Promise<void> {
  const { db } = ctx;
  const resolved = await resolveContact(db, account, e.chat, true);
  if (!resolved) throw new Error('contact resolution failed');
  const contact = resolved.contact;
  const conversation = await openConversation(ctx, account, contact.id);

  // A swipe-reply to a message we never stored just renders unquoted.
  const replyTo = e.quotedId
    ? await lookupInternalIdByMetaId(db, e.quotedId, conversation.id)
    : null;
  const contentType = CONTENT_TYPES[e.kind];
  const contentText = contentTextOf(e);
  const createdAt = new Date(e.timestamp * 1000).toISOString();
  const inbound = e.direction === 'inbound';

  // First inbound ever for this contact — counted BEFORE the insert so
  // the first_inbound_message trigger sees an accurate history.
  let isFirstInboundMessage = false;
  if (inbound) {
    const { count, error } = await db
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', conversation.id)
      .eq('sender_type', 'customer');
    if (error) fail('message count failed', error);
    isFirstInboundMessage = (count ?? 0) === 0;
  }

  // The idempotency boundary: a redelivered event conflicts on
  // (conversation_id, message_id) and returns no row, so nothing after
  // this runs twice (same guarantee as the Meta webhook, issue #367).
  const { data: inserted, error: insertError } = await db
    .from('messages')
    .upsert(
      {
        conversation_id: conversation.id,
        sender_type: inbound ? 'customer' : e.origin === 'davila' ? 'bot' : 'agent',
        content_type: contentType,
        content_text: contentText,
        media_url: e.media?.url ?? null,
        media_type: e.media?.mimeType ?? null,
        message_id: e.id,
        status: inbound ? 'delivered' : 'sent',
        created_at: createdAt,
        reply_to_message_id: replyTo,
        ai_generated: e.origin === 'davila',
      },
      { onConflict: 'conversation_id,message_id', ignoreDuplicates: true }
    )
    .select('id');
  if (insertError) fail('message insert failed', insertError);
  if (!inserted || inserted.length === 0) return;

  const preview = contentText || `[${e.kind}]`;

  if (!inbound) {
    // Davila's reply, or one typed on the paired phone: recorded, never
    // counted as unread, never fanned out to the reply engines. Only
    // moves the preview forward — a late event mustn't bury a newer one.
    const last = conversation.last_message_at
      ? Date.parse(conversation.last_message_at)
      : 0;
    if (e.timestamp * 1000 >= last) {
      const { error } = await db
        .from('conversations')
        .update({
          last_message_text: preview,
          last_message_at: createdAt,
          updated_at: new Date().toISOString(),
        })
        .eq('id', conversation.id);
      if (error) fail('conversation preview update failed', error);
    }
    return;
  }

  // Unread bump + preview in one statement (migration 037), so two
  // concurrent inbound messages can't lose an increment (issue #369).
  const { error: bumpError } = await db.rpc('bump_conversation_on_inbound', {
    p_conversation_id: conversation.id,
    p_last_message_text: preview,
  });
  if (bumpError) fail('conversation bump failed', bumpError);

  await reopenClosedConversation(db, conversation);
  await flagBroadcastReplyIfAny(db, account.accountId, contact.id);

  ctx.defer(() =>
    dispatchInboundLifecycle(db, {
      accountId: account.accountId,
      configOwnerUserId: account.ownerUserId,
      contactId: contact.id,
      conversationId: conversation.id,
      messageId: e.id,
      contentType,
      contentText,
      interactiveReplyId: null,
      isFirstInboundMessage,
      wasContactCreated: resolved.wasCreated,
      // Davila answers when TchuekBot is the brain; wacrm's Flows and
      // AI assistant would be a second reply.
      replyEngines: account.brain === 'wacrm',
    })
  );
}

/**
 * Forward-only status update, scoped to this account's conversations —
 * provider message ids aren't unique across accounts.
 */
async function applyStatus(
  ctx: IngestContext,
  account: MbowazapAccount,
  e: StatusEvent
): Promise<void> {
  const { db } = ctx;
  const { data: rows, error } = await db
    .from('messages')
    .select('id, status, conversation_id')
    .eq('message_id', e.id);
  if (error) fail('message lookup failed', error);
  const candidates = (rows ?? []) as {
    id: string;
    status: string;
    conversation_id: string;
  }[];
  if (candidates.length === 0) return;

  const { data: owned, error: convError } = await db
    .from('conversations')
    .select('id')
    .eq('account_id', account.accountId)
    .in(
      'id',
      [...new Set(candidates.map((r) => r.conversation_id))]
    );
  if (convError) fail('conversation ownership check failed', convError);
  const ownedIds = new Set((owned ?? []).map((c: { id: string }) => c.id));

  for (const row of candidates) {
    if (!ownedIds.has(row.conversation_id)) continue;
    if (!isValidStatusTransition(row.status, e.status)) continue;
    const { error: updateError } = await db
      .from('messages')
      .update({ status: e.status })
      .eq('id', row.id);
    if (updateError) fail('message status update failed', updateError);
    ctx.defer(() =>
      dispatchWebhookEvent(db, account.accountId, 'message.status_updated', {
        whatsapp_message_id: e.id,
        conversation_id: row.conversation_id,
        status: e.status,
      })
    );
  }
}

/**
 * Bind the session to its account on the first connect after pairing,
 * then mirror the socket state onto whatsapp_config.
 */
async function applyConnection(
  ctx: IngestContext,
  session: string,
  current: MbowazapAccount | null,
  e: ConnectionEvent
): Promise<MbowazapAccount> {
  let account = current;
  if (!account && e.pairingRef) {
    account = await findAccountByPairingRef(ctx.db, e.pairingRef);
  }
  if (!account) {
    throw new IngestRejection(`no wacrm account is paired with ${session}`);
  }
  if (account.session && account.session !== session) {
    throw new IngestRejection(
      `this account is pairing ${account.session}, but ${session} connected`
    );
  }

  const nowIso = new Date(ctx.now?.() ?? Date.now()).toISOString();
  const connected = e.status === 'connected';
  const patch: Record<string, unknown> = {
    mbowazap_state: e.status,
    status: connected ? 'connected' : 'disconnected',
    mbowazap_last_event_at: nowIso,
    updated_at: nowIso,
  };
  if (connected) {
    patch.mbowazap_session = session;
    patch.connected_at = nowIso;
    if (e.me?.name) patch.mbowazap_display_name = e.me.name;
  }

  const { error } = await ctx.db
    .from('whatsapp_config')
    .update(patch)
    .eq('id', account.configId);
  if (error) {
    // Migration 043's unique index: the number is linked elsewhere.
    if (isUniqueViolation(error)) {
      throw new IngestRejection(
        `${session} is already linked to another wacrm account`
      );
    }
    fail('whatsapp_config update failed', error);
  }
  return { ...account, session: connected ? session : account.session };
}

async function applyEvent(
  ctx: IngestContext,
  account: MbowazapAccount,
  event: BridgeEvent
): Promise<void> {
  const { db } = ctx;
  switch (event.type) {
    case 'message':
      return ingestMessage(ctx, account, event);
    case 'status':
      return applyStatus(ctx, account, event);
    case 'reaction': {
      // The owner reacting from the phone has no wacrm user to attribute
      // the reaction to.
      if (event.fromMe) return;
      const resolved = await resolveContact(db, account, event.chat, false);
      if (!resolved) return;
      const conversation = await findConversation(
        db,
        account.accountId,
        resolved.contact.id
      );
      if (!conversation) return;
      return handleInboundReaction(db, {
        targetMessageId: event.targetId,
        conversationId: conversation.id,
        contactId: resolved.contact.id,
        emoji: event.emoji,
      });
    }
    case 'contact.facts': {
      const resolved = await resolveContact(db, account, event.chat, true);
      if (!resolved) return;
      return applyContactFacts(db, account, resolved.contact, event.facts);
    }
    case 'deal.closed': {
      const resolved = await resolveContact(db, account, event.chat, true);
      if (!resolved) return;
      const conversation = await findConversation(
        db,
        account.accountId,
        resolved.contact.id
      );
      return applyDealClosed(
        db,
        account,
        resolved.contact,
        conversation?.id ?? null,
        event.pack,
        ctx.now?.() ?? Date.now(),
        {
          value: event.value,
          currency: event.currency,
          externalDealId: event.externalDealId,
        }
      );
    }
    case 'tally.submitted': {
      const resolved = await resolveContact(db, account, event.chat, true);
      if (!resolved) return;
      return tagContact(db, account, resolved.contact.id, MBOWAZAP_TAGS.tallySubmitted);
    }
    case 'contact.opted_out': {
      const resolved = await resolveContact(db, account, event.chat, true);
      if (!resolved) return;
      await tagContact(db, account, resolved.contact.id, MBOWAZAP_TAGS.optedOut);
      const conversation = await findConversation(
        db,
        account.accountId,
        resolved.contact.id
      );
      if (conversation) await setConversationAiPaused(db, conversation.id, true);
      return;
    }
    case 'ai.paused': {
      const resolved = await resolveContact(db, account, event.chat, false);
      if (!resolved) return;
      const conversation = await findConversation(
        db,
        account.accountId,
        resolved.contact.id
      );
      if (conversation) {
        await setConversationAiPaused(db, conversation.id, event.until !== null);
      }
      return;
    }
    case 'connection':
      // Handled by ingestBatch, which may switch the account.
      return;
  }
}

/** Apply a validated batch in order. See the module comment for error handling. */
export async function ingestBatch(
  ctx: IngestContext,
  batch: EventBatch
): Promise<IngestResult> {
  let account = await findAccountBySession(ctx.db, batch.session);
  let accepted = 0;
  const rejected: RejectedEvent[] = [];

  for (const [index, event] of batch.events.entries()) {
    try {
      if (event.eventId) {
        const { data: seen } = await ctx.db
          .from('mbowazap_events')
          .select('event_id')
          .eq('event_id', event.eventId)
          .maybeSingle();
        if (seen) {
          accepted += 1;
          continue;
        }
      }

      if (event.type === 'connection') {
        account = await applyConnection(ctx, batch.session, account, event);
      } else if (!account) {
        throw new IngestRejection(
          `no wacrm account is paired with ${batch.session}`
        );
      } else {
        await applyEvent(ctx, account, event);
      }

      if (event.eventId) {
        const { error: recordErr } = await ctx.db
          .from('mbowazap_events')
          .insert({
            event_id: event.eventId,
            session: batch.session,
            event_type: event.type,
            account_id: account?.accountId ?? null,
            processed_at: new Date(ctx.now?.() ?? Date.now()).toISOString(),
          });
        if (recordErr && !isUniqueViolation(recordErr)) {
          console.warn('[mbowazap] recording event_id failed:', recordErr.message);
        }
      }

      accepted += 1;
    } catch (err) {
      if (!(err instanceof IngestRejection)) throw err;
      rejected.push({ index, eventId: event.eventId, error: err.message });
    }
  }

  if (account && accepted > 0) {
    const { error } = await ctx.db
      .from('whatsapp_config')
      .update({
        mbowazap_last_event_at: new Date(ctx.now?.() ?? Date.now()).toISOString(),
      })
      .eq('id', account.configId);
    if (error) console.warn('[mbowazap] last-event stamp failed:', error.message);
  }

  return { accepted, rejected };
}
