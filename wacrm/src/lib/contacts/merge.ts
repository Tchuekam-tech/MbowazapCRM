// ============================================================
// Merge two contacts of one account that turn out to be the same
// WhatsApp person — typically one created from a WhatsApp LID while the
// number was withheld, and one already known by phone. Everything
// attached to the loser moves to the survivor, then the loser is
// deleted.
//
// Deleting a contact cascades: its conversation (and every message,
// reaction and notification in it), its notes, tags and custom values
// go with it, and other links are nulled. So every move is checked, and
// the first failure aborts the merge BEFORE anything is deleted — a
// failed merge leaves both contacts intact, never a half-deleted one.
// Every step is also safe to repeat, so a retried merge just finishes.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizePhone } from '@/lib/whatsapp/phone-utils';

export class ContactMergeError extends Error {}

export interface MergeContactsOptions {
  accountId: string;
  survivorContactId: string;
  loserContactId: string;
  /** A WhatsApp LID to give the survivor (the loser's own LID otherwise). */
  newLid?: string | null;
}

export interface MergeContactsResult {
  merged: boolean;
  survivorContactId: string;
  /** Why nothing was merged. */
  reason?: 'same_contact' | 'not_found' | 'conflicting_messages';
}

type DbStep = PromiseLike<{ error: { message: string } | null }>;

async function must(what: string, step: DbStep): Promise<void> {
  const { error } = await step;
  if (error) throw new ContactMergeError(`${what}: ${error.message}`);
}

/** Empty, or just the phone number — a name nobody chose. */
function isPlaceholder(
  name: string | null | undefined,
  phone: string | null | undefined
): boolean {
  const n = (name ?? '').trim();
  if (!n) return true;
  const digits = normalizePhone(n);
  return digits.length > 0 && digits === normalizePhone(phone ?? '');
}

/**
 * True when a WhatsApp message stored in `fromConv` is also stored in
 * `toConv`: moving it would collide on (conversation_id, message_id).
 */
async function sharesMessages(
  db: SupabaseClient,
  fromConv: string,
  toConv: string
): Promise<boolean> {
  const { data, error } = await db
    .from('messages')
    .select('message_id')
    .eq('conversation_id', fromConv);
  if (error) throw new ContactMergeError(`reading messages: ${error.message}`);
  const ids = [
    ...new Set(
      ((data ?? []) as { message_id: string | null }[])
        .map((m) => m.message_id)
        .filter((id): id is string => !!id)
    ),
  ];
  // Chunked so a long thread doesn't blow the URL length limit.
  for (let i = 0; i < ids.length; i += 200) {
    const { data: clash, error: clashError } = await db
      .from('messages')
      .select('id')
      .eq('conversation_id', toConv)
      .in('message_id', ids.slice(i, i + 200))
      .limit(1);
    if (clashError) {
      throw new ContactMergeError(`comparing messages: ${clashError.message}`);
    }
    if (clash && clash.length > 0) return true;
  }
  return false;
}

/**
 * Move the loser's rows of a (contact_id, key)-unique table to the
 * survivor; where both have the same key the survivor's row wins and
 * the loser's duplicate is dropped.
 */
async function moveUnique(
  db: SupabaseClient,
  table: 'contact_tags' | 'contact_custom_values',
  key: 'tag_id' | 'custom_field_id',
  survivorId: string,
  loserId: string
): Promise<void> {
  const [kept, moving] = await Promise.all([
    db.from(table).select(key).eq('contact_id', survivorId),
    db.from(table).select(key).eq('contact_id', loserId),
  ]);
  const readError = kept.error ?? moving.error;
  if (readError) throw new ContactMergeError(`reading ${table}: ${readError.message}`);

  const have = new Set((kept.data ?? []).map((r: Record<string, unknown>) => r[key]));
  const missing = (moving.data ?? [])
    .map((r: Record<string, unknown>) => r[key] as string)
    .filter((k) => !have.has(k));
  if (missing.length > 0) {
    await must(
      `moving ${table}`,
      db.from(table).update({ contact_id: survivorId }).eq('contact_id', loserId).in(key, missing)
    );
  }
  // What's left duplicates rows the survivor already has.
  await must(`dropping duplicate ${table}`, db.from(table).delete().eq('contact_id', loserId));
}

export async function mergeContacts(
  db: SupabaseClient,
  options: MergeContactsOptions
): Promise<MergeContactsResult> {
  const { accountId, survivorContactId, loserContactId, newLid } = options;
  if (survivorContactId === loserContactId) {
    return { merged: false, survivorContactId, reason: 'same_contact' };
  }

  const { data: contacts, error: contactError } = await db
    .from('contacts')
    .select('id, name, phone, wa_lid')
    .eq('account_id', accountId)
    .in('id', [survivorContactId, loserContactId]);
  if (contactError) {
    throw new ContactMergeError(`reading contacts: ${contactError.message}`);
  }
  type ContactRow = { id: string; name: string | null; phone: string | null; wa_lid: string | null };
  const rows = (contacts ?? []) as ContactRow[];
  const survivor = rows.find((c) => c.id === survivorContactId);
  const loser = rows.find((c) => c.id === loserContactId);
  if (!survivor || !loser) {
    return { merged: false, survivorContactId, reason: 'not_found' };
  }

  const { data: convData, error: convError } = await db
    .from('conversations')
    .select('id, contact_id, unread_count, last_message_text, last_message_at')
    .eq('account_id', accountId)
    .in('contact_id', [survivorContactId, loserContactId]);
  if (convError) {
    throw new ContactMergeError(`reading conversations: ${convError.message}`);
  }
  type ConvRow = {
    id: string;
    contact_id: string;
    unread_count: number | null;
    last_message_text: string | null;
    last_message_at: string | null;
  };
  const convs = (convData ?? []) as ConvRow[];
  const survivorConv = convs.find((c) => c.contact_id === survivorContactId);
  const loserConv = convs.find((c) => c.contact_id === loserContactId);

  if (survivorConv && loserConv && (await sharesMessages(db, loserConv.id, survivorConv.id))) {
    console.warn(
      `[contacts/merge] ${loserContactId} and ${survivorContactId} share WhatsApp messages; kept apart`
    );
    return { merged: false, survivorContactId, reason: 'conflicting_messages' };
  }

  const nowIso = new Date().toISOString();

  // A contact may have one active flow run (idx_one_active_run_per_contact):
  // when both are mid-flow, the duplicate's run ends here.
  const { data: activeRuns, error: runsError } = await db
    .from('flow_runs')
    .select('id, contact_id')
    .in('contact_id', [survivorContactId, loserContactId])
    .eq('status', 'active');
  if (runsError) throw new ContactMergeError(`reading flow runs: ${runsError.message}`);
  const runs = (activeRuns ?? []) as { contact_id: string }[];
  if (
    runs.some((r) => r.contact_id === survivorContactId) &&
    runs.some((r) => r.contact_id === loserContactId)
  ) {
    await must(
      'ending the duplicate flow run',
      db
        .from('flow_runs')
        .update({ status: 'failed', ended_at: nowIso, end_reason: 'contact_merged' })
        .eq('contact_id', loserContactId)
        .eq('status', 'active')
    );
  }

  // 1. The thread. Everything pointing at the loser's conversation moves
  //    to the survivor's before that conversation can be deleted.
  if (survivorConv && loserConv) {
    const from = loserConv.id;
    const to = survivorConv.id;
    for (const table of [
      'messages',
      'message_reactions',
      'notifications',
      'deals',
      'flow_runs',
      'ai_usage_log',
    ]) {
      await must(
        `moving ${table}`,
        db.from(table).update({ conversation_id: to }).eq('conversation_id', from)
      );
    }
    const newer =
      (loserConv.last_message_at ?? '') > (survivorConv.last_message_at ?? '')
        ? loserConv
        : survivorConv;
    await must(
      'combining the conversations',
      db
        .from('conversations')
        .update({
          unread_count: (survivorConv.unread_count ?? 0) + (loserConv.unread_count ?? 0),
          last_message_text: newer.last_message_text,
          last_message_at: newer.last_message_at,
          updated_at: nowIso,
        })
        .eq('id', to)
    );
  } else if (loserConv) {
    await must(
      'moving the conversation',
      db.from('conversations').update({ contact_id: survivorContactId }).eq('id', loserConv.id)
    );
  }

  // 2. Everything else that points at the loser contact.
  for (const table of [
    'deals',
    'contact_notes',
    'flow_runs',
    'broadcast_recipients',
    'automation_logs',
    'automation_pending_executions',
    'notifications',
  ]) {
    await must(
      `moving ${table}`,
      db.from(table).update({ contact_id: survivorContactId }).eq('contact_id', loserContactId)
    );
  }
  await must(
    'moving customer reactions',
    db
      .from('message_reactions')
      .update({ actor_id: survivorContactId })
      .eq('actor_type', 'customer')
      .eq('actor_id', loserContactId)
  );
  await moveUnique(db, 'contact_tags', 'tag_id', survivorContactId, loserContactId);
  await moveUnique(db, 'contact_custom_values', 'custom_field_id', survivorContactId, loserContactId);

  // 3. Identity. The loser releases its unique keys — (account_id, wa_lid)
  //    and the phone — so the survivor can take them.
  await must(
    'releasing the duplicate identity',
    db.from('contacts').update({ wa_lid: null, phone: '' }).eq('id', loserContactId)
  );
  const patch: Record<string, unknown> = { updated_at: nowIso };
  const lid = newLid || loser.wa_lid;
  if (lid && !survivor.wa_lid) patch.wa_lid = lid;
  if (!survivor.phone && loser.phone) patch.phone = loser.phone;
  if (isPlaceholder(survivor.name, survivor.phone) && !isPlaceholder(loser.name, loser.phone)) {
    patch.name = loser.name;
  }
  await must(
    'updating the surviving contact',
    db.from('contacts').update(patch).eq('id', survivorContactId)
  );

  // 4. Only now delete: nothing that cascades from these rows is left.
  if (survivorConv && loserConv) {
    await must(
      'deleting the emptied conversation',
      db.from('conversations').delete().eq('id', loserConv.id)
    );
  }
  await must('deleting the duplicate contact', db.from('contacts').delete().eq('id', loserContactId));

  return { merged: true, survivorContactId };
}
