// ============================================================
// CRM effects of what Davila learns in a conversation: contact facts,
// closed deals, form submissions, opt-outs. Every write here must be
// safe to repeat — the bot delivers events at least once.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveImportTagIds } from '@/lib/contacts/resolve-import-tags';
import { addContactTagAndDispatch } from '@/lib/contacts/tag-events';
import { normalizePhone } from '@/lib/whatsapp/phone-utils';
import type { MbowazapAccount } from './accounts';
import type { ContactFactsEvent } from './protocol';

/** Custom fields Davila's facts land in (created per account on first use). */
export const FACT_FIELDS = {
  businessType: 'Business type',
  location: 'Location',
  interestedPack: 'Interested pack',
} as const;

export const MBOWAZAP_TAGS = {
  dealClosed: 'Deal closed',
  tallySubmitted: 'Tally submitted',
  optedOut: 'Opted out',
} as const;

/** A redelivered deal.closed inside this window is the same closing. */
export const DEAL_REPLAY_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface CrmContact {
  id: string;
  phone: string;
  name?: string | null;
}

function fail(what: string, error: { message: string }): never {
  throw new Error(`${what}: ${error.message}`);
}

/** Tag the contact by name, creating the tag on first use. */
export async function tagContact(
  db: SupabaseClient,
  account: MbowazapAccount,
  contactId: string,
  tagName: string
): Promise<void> {
  const { tagIdByKey } = await resolveImportTagIds(db, {
    accountId: account.accountId,
    userId: account.ownerUserId,
    tagNames: [tagName],
    canCreateTags: true,
  });
  const tagId = tagIdByKey.get(tagName.toLowerCase());
  if (!tagId) return;
  // Fires tag_added automations only for a newly-added tag, so a
  // redelivered event can't trigger them twice.
  await addContactTagAndDispatch({
    db,
    accountId: account.accountId,
    contactId,
    tagId,
  });
}

/** A name nobody chose: empty, or just the phone number. */
function isPlaceholderName(contact: CrmContact): boolean {
  const name = (contact.name ?? '').trim();
  if (!name) return true;
  const digits = normalizePhone(name);
  return digits.length > 0 && digits === normalizePhone(contact.phone);
}

async function customFieldIds(
  db: SupabaseClient,
  account: MbowazapAccount,
  names: string[]
): Promise<Map<string, string>> {
  const { data, error } = await db
    .from('custom_fields')
    .select('id, field_name')
    .eq('account_id', account.accountId);
  if (error) fail('custom_fields lookup failed', error);

  const ids = new Map<string, string>();
  for (const row of (data ?? []) as { id: string; field_name: string }[]) {
    const key = row.field_name.trim().toLowerCase();
    if (!ids.has(key)) ids.set(key, row.id);
  }

  const missing = names.filter((name) => !ids.has(name.toLowerCase()));
  if (missing.length > 0) {
    const { data: created, error: createError } = await db
      .from('custom_fields')
      .insert(
        missing.map((field_name) => ({
          account_id: account.accountId,
          user_id: account.ownerUserId,
          field_name,
          field_type: 'text',
        }))
      )
      .select('id, field_name');
    if (createError) fail('custom_fields insert failed', createError);
    for (const row of (created ?? []) as { id: string; field_name: string }[]) {
      ids.set(row.field_name.toLowerCase(), row.id);
    }
  }
  return ids;
}

/**
 * Store Davila's facts: business type, location and pack as custom
 * fields; the name only when the contact has no real one yet — never
 * over a name an agent typed.
 */
export async function applyContactFacts(
  db: SupabaseClient,
  account: MbowazapAccount,
  contact: CrmContact,
  facts: ContactFactsEvent['facts'] & Record<string, string | undefined>
): Promise<void> {
  if (facts.name && isPlaceholderName(contact)) {
    const { error } = await db
      .from('contacts')
      .update({ name: facts.name, updated_at: new Date().toISOString() })
      .eq('id', contact.id);
    if (error) fail('contact name update failed', error);
  }

  const entries: { field: string; value: string }[] = [];
  for (const [rawKey, rawVal] of Object.entries(facts)) {
    if (!rawVal || rawKey === 'name') continue;
    let fieldName: string;
    if (rawKey in FACT_FIELDS) {
      fieldName = FACT_FIELDS[rawKey as keyof typeof FACT_FIELDS];
    } else {
      fieldName = rawKey
        .replace(/([A-Z])/g, ' $1')
        .replace(/[_-]/g, ' ')
        .trim();
      fieldName = fieldName.charAt(0).toUpperCase() + fieldName.slice(1);
    }
    entries.push({ field: fieldName, value: String(rawVal).trim() });
  }

  if (entries.length === 0) return;

  const ids = await customFieldIds(
    db,
    account,
    entries.map((v) => v.field)
  );
  const rows = entries.flatMap(({ field, value }) => {
    const customFieldId = ids.get(field.toLowerCase());
    return customFieldId
      ? [{ contact_id: contact.id, custom_field_id: customFieldId, value }]
      : [];
  });
  if (rows.length === 0) return;
  const { error } = await db
    .from('contact_custom_values')
    .upsert(rows, { onConflict: 'contact_id,custom_field_id' });
  if (error) fail('contact_custom_values upsert failed', error);
}

async function lastStageId(
  db: SupabaseClient,
  pipelineId: string
): Promise<string | null> {
  const { data, error } = await db
    .from('pipeline_stages')
    .select('id, position')
    .eq('pipeline_id', pipelineId)
    .order('position', { ascending: false })
    .limit(1);
  if (error) fail('pipeline_stages lookup failed', error);
  return (data as { id: string }[] | null)?.[0]?.id ?? null;
}

export interface DealClosedOptions {
  value?: number;
  currency?: string;
  externalDealId?: string;
}

/**
 * Davila closed a deal: tag the contact, then mark their open deal won
 * — or open a won one in the account's first pipeline. A redelivered
 * event (a won deal for this contact within DEAL_REPLAY_WINDOW_MS)
 * changes nothing. Without any pipeline the tag is the only record.
 */
export async function applyDealClosed(
  db: SupabaseClient,
  account: MbowazapAccount,
  contact: CrmContact,
  conversationId: string | null,
  pack: string | undefined,
  now: number,
  options?: DealClosedOptions
): Promise<void> {
  await tagContact(db, account, contact.id, MBOWAZAP_TAGS.dealClosed);

  const { data: deals, error } = await db
    .from('deals')
    .select('id, status, pipeline_id, updated_at, value, currency, notes')
    .eq('account_id', account.accountId)
    .eq('contact_id', contact.id)
    .order('updated_at', { ascending: false })
    .limit(10);
  if (error) fail('deals lookup failed', error);
  const existing = (deals ?? []) as {
    id: string;
    status: string;
    pipeline_id: string;
    updated_at: string;
    value?: number;
    currency?: string;
    notes?: string | null;
  }[];

  const recentWin = existing.find(
    (d) =>
      d.status === 'won' &&
      now - Date.parse(d.updated_at) < DEAL_REPLAY_WINDOW_MS
  );
  if (recentWin) return;

  const nowIso = new Date(now).toISOString();
  const extRef = options?.externalDealId ? ` [ID: ${options.externalDealId}]` : '';
  const note = `Closed by Davila over MboWazap${pack ? ` — ${pack} pack` : ''}${extRef}.`;

  const open = existing.find((d) => d.status === 'open');
  if (open) {
    const stageId = await lastStageId(db, open.pipeline_id);
    const updatePatch: Record<string, unknown> = {
      status: 'won',
      ...(stageId ? { stage_id: stageId } : {}),
      ...(options?.value !== undefined ? { value: options.value } : {}),
      ...(options?.currency ? { currency: options.currency } : {}),
      // Appended: the deal's notes may be an agent's.
      notes: open.notes?.trim() ? `${open.notes}\n\n${note}` : note,
      updated_at: nowIso,
    };
    const { error: updateError } = await db
      .from('deals')
      .update(updatePatch)
      .eq('id', open.id);
    if (updateError) fail('deal update failed', updateError);
    return;
  }

  const { data: pipelines, error: pipelineError } = await db
    .from('pipelines')
    .select('id')
    .eq('account_id', account.accountId)
    .order('created_at', { ascending: true })
    .limit(1);
  if (pipelineError) fail('pipelines lookup failed', pipelineError);
  const pipelineId = (pipelines as { id: string }[] | null)?.[0]?.id;
  if (!pipelineId) return;
  const stageId = await lastStageId(db, pipelineId);
  if (!stageId) return;

  const { data: accountRow } = await db
    .from('accounts')
    .select('default_currency')
    .eq('id', account.accountId)
    .maybeSingle();

  const who = contact.name?.trim() || contact.phone || 'WhatsApp contact';
  const dealValue = options?.value ?? 0;
  const dealCurrency = options?.currency || accountRow?.default_currency || 'USD';

  const { error: insertError } = await db.from('deals').insert({
    account_id: account.accountId,
    user_id: account.ownerUserId,
    pipeline_id: pipelineId,
    stage_id: stageId,
    contact_id: contact.id,
    conversation_id: conversationId,
    title: pack ? `${pack} pack — ${who}` : `Deal — ${who}`,
    value: dealValue,
    currency: dealCurrency,
    status: 'won',
    notes: note,
    created_at: nowIso,
    updated_at: nowIso,
  });
  if (insertError) fail('deal insert failed', insertError);
}

/**
 * Mirror Davila's pause state onto the conversation's AI flag, so the
 * inbox banner shows whether the assistant is answering this contact.
 */
export async function setConversationAiPaused(
  db: SupabaseClient,
  conversationId: string,
  paused: boolean
): Promise<void> {
  const { error } = await db
    .from('conversations')
    .update({ ai_autoreply_disabled: paused })
    .eq('id', conversationId);
  if (error) fail('conversation AI flag update failed', error);
}
