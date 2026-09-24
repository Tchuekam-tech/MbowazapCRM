// ============================================================
// Inbound contact resolution: find the contact an inbound message
// belongs to (by BSUID, then phone), backfill identity we just
// learned, or create the row.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe';
import { normalizePhone } from '@/lib/whatsapp/phone-utils';
import {
  identityDisplayName,
  type WaIdentity,
} from '@/lib/whatsapp/wa-identity';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ContactRow = any;

export interface ContactOutcome {
  contact: ContactRow;
  /** True when this call created the row; drives new_contact_created. */
  wasCreated: boolean;
}

/**
 * Look a contact up by BSUID. Exact match on the column backing
 * migration 040's unique index — no fuzzy matching, because a BSUID is
 * an opaque identifier with exactly one correct spelling.
 */
export async function findContactByWaUserId(
  db: SupabaseClient,
  accountId: string,
  waUserId: string
): Promise<ContactRow | null> {
  const { data, error } = await db
    .from('contacts')
    .select('*')
    .eq('account_id', accountId)
    .eq('wa_user_id', waUserId)
    .maybeSingle();

  if (error) {
    console.error('[webhook] BSUID contact lookup failed:', error.message);
    return null;
  }
  return data ?? null;
}

/**
 * Fields worth writing back onto a contact we just matched, given what
 * this delivery told us. Returns null when nothing changed, so the
 * common case costs no UPDATE.
 *
 * The BSUID backfill is the important one: it stamps the id onto a
 * contact we have only ever known by phone, so the NEXT message from
 * that person — which may well arrive with no phone number at all —
 * still resolves to this same row instead of forking a new one.
 * Likewise a phone backfill upgrades a BSUID-only contact the moment
 * Meta discloses the number, making them reachable by every existing
 * phone-based code path.
 */
export function contactIdentityPatch(
  existing: ContactRow,
  identity: WaIdentity
): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};

  // Only ever from a label Meta actually supplied. `identityDisplayName`
  // falls back to the phone number / BSUID, which is the right choice
  // for a brand-new row but would clobber an agent's hand-edited name
  // on every inbound message from a contact with no WhatsApp profile
  // name.
  const name = identity.name || identity.waUsername;
  if (name && name !== existing.name) patch.name = name;

  if (identity.waUserId && identity.waUserId !== existing.wa_user_id) {
    patch.wa_user_id = identity.waUserId;
  }
  if (
    identity.waParentUserId &&
    identity.waParentUserId !== existing.wa_parent_user_id
  ) {
    patch.wa_parent_user_id = identity.waParentUserId;
  }
  if (identity.waUsername && identity.waUsername !== existing.wa_username) {
    patch.wa_username = identity.waUsername;
  }
  // Only ever fills a blank. An existing number is left alone — the
  // send path's variant retry already owns correcting it, and Meta's
  // formatting differences are not a reason to rewrite it.
  if (identity.phone && !normalizePhone(existing.phone ?? '')) {
    patch.phone = identity.phone;
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

export async function findOrCreateContact(
  db: SupabaseClient,
  accountId: string,
  configOwnerUserId: string,
  identity: WaIdentity
): Promise<ContactOutcome | null> {
  // BSUID first when we have one. It's stable per (user, business
  // portfolio) and, unlike the phone number, Meta will keep sending it
  // — so it's the key that survives a customer adopting a username.
  let existingContact: ContactRow | null = identity.waUserId
    ? await findContactByWaUserId(db, accountId, identity.waUserId)
    : null;

  // Fall back to the phone. The shared helper pre-filters in SQL by the
  // last-8-digit suffix (so we don't pull every contact on every
  // inbound message) then applies the strict `phonesMatch` in JS on the
  // small candidate set. The same helper backs the manual contact form
  // and CSV import, so all three paths agree on what "same number"
  // means (issue #212).
  if (!existingContact && identity.phone) {
    existingContact = await findExistingContact(db, accountId, identity.phone);
  }

  if (existingContact) {
    const patch = contactIdentityPatch(existingContact, identity);
    if (patch) {
      const { data: updated, error: updateError } = await db
        .from('contacts')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', existingContact.id)
        .select()
        .maybeSingle();

      if (updateError) {
        // A BSUID backfill can lose a race with a concurrent delivery
        // that already claimed it for another row. Not fatal — the
        // message still belongs to the contact we matched.
        console.error(
          '[webhook] contact identity backfill failed:',
          updateError.message
        );
      } else if (updated) {
        existingContact = updated;
      }
    }
    return { contact: existingContact, wasCreated: false };
  }

  // Create new contact. account_id is the tenancy column;
  // user_id is the NOT NULL FK audit column (no inbound message
  // has a single "user who created" it — we attribute to the
  // WhatsApp config owner as a stable default).
  //
  // `phone` stays NOT NULL in the schema, so a BSUID-only sender is
  // stored with '' — which migration 022's partial unique index
  // tolerates, and migration 040's BSUID index is what keeps them
  // unique instead.
  const { data: newContact, error: createError } = await db
    .from('contacts')
    .insert({
      account_id: accountId,
      user_id: configOwnerUserId,
      phone: identity.phone,
      name: identityDisplayName(identity),
      wa_user_id: identity.waUserId,
      wa_parent_user_id: identity.waParentUserId,
      wa_username: identity.waUsername,
    })
    .select()
    .single();

  if (createError) {
    // Lost a race: a concurrent inbound delivery (or another path)
    // created this contact between our lookup and insert, and a unique
    // index (022's phone, or 040's BSUID) rejected the duplicate.
    // Re-resolve the existing row instead of dropping the message.
    if (isUniqueViolation(createError)) {
      const raced = identity.waUserId
        ? await findContactByWaUserId(db, accountId, identity.waUserId)
        : null;
      if (raced) return { contact: raced, wasCreated: false };
      if (identity.phone) {
        const racedByPhone = await findExistingContact(
          db,
          accountId,
          identity.phone
        );
        if (racedByPhone) return { contact: racedByPhone, wasCreated: false };
      }
    }
    console.error('Error creating contact:', createError);
    return null;
  }

  return { contact: newContact, wasCreated: true };
}
