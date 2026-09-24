// ============================================================
// Which wacrm account a MboWazap session (paired number) belongs to.
// The link lives on the account's one `whatsapp_config` row
// (migration 043): `mbowazap_session` once paired, and the
// `mbowazap_pairing_ref` token while a pairing is in flight.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

/** Who answers customers: Davila on the bot, or wacrm's Flows / AI. */
export type MbowazapBrain = 'tchuekbot' | 'wacrm';

export interface MbowazapAccount {
  configId: string;
  accountId: string;
  /** whatsapp_config.user_id — the audit owner for NOT NULL user_id inserts. */
  ownerUserId: string;
  /** The paired number, or null while a QR pairing is pending. */
  session: string | null;
  brain: MbowazapBrain;
}

interface ConfigRow {
  id: string;
  account_id: string;
  user_id: string;
  mbowazap_session: string | null;
  mbowazap_brain: string | null;
}

function toAccount(row: ConfigRow): MbowazapAccount {
  return {
    configId: row.id,
    accountId: row.account_id,
    ownerUserId: row.user_id,
    session: row.mbowazap_session,
    brain: row.mbowazap_brain === 'wacrm' ? 'wacrm' : 'tchuekbot',
  };
}

/** Throws on a query error so the caller can fail the batch for a retry. */
async function findOne(
  db: SupabaseClient,
  column: 'mbowazap_session' | 'mbowazap_pairing_ref',
  value: string
): Promise<MbowazapAccount | null> {
  const { data, error } = await db
    .from('whatsapp_config')
    .select('id, account_id, user_id, mbowazap_session, mbowazap_brain')
    .eq('provider', 'mbowazap')
    .eq(column, value)
    .maybeSingle();
  if (error) throw new Error(`whatsapp_config lookup failed: ${error.message}`);
  return data ? toAccount(data as ConfigRow) : null;
}

export function findAccountBySession(
  db: SupabaseClient,
  session: string
): Promise<MbowazapAccount | null> {
  return findOne(db, 'mbowazap_session', session);
}

export function findAccountByPairingRef(
  db: SupabaseClient,
  pairingRef: string
): Promise<MbowazapAccount | null> {
  return findOne(db, 'mbowazap_pairing_ref', pairingRef);
}
