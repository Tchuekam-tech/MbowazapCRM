import type { SupabaseClient } from '@supabase/supabase-js';
import { MbowazapBridgeError } from './client';

export const PAIRING_TTL_MS = 120_000;
export type PairingConfig = Record<string, unknown> & {
  id: string;
  updated_at: string | null;
  mbowazap_pairing_ref: string | null;
  mbowazap_state: string | null;
  mbowazap_session: string | null;
};

/** Reserve the account and unique phone BEFORE touching any WhatsApp socket. */
export async function reservePairing(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  previous: PairingConfig | null,
  ref: string,
  phone: string | null,
  now: number = Date.now(),
  options: { previousWasDisconnectedOnBot?: boolean } = {}
) {
  const previousUpdatedMs = previous?.updated_at
    ? Date.parse(previous.updated_at)
    : Number.NaN;
  if (
    previous?.mbowazap_state === 'pairing' &&
    Number.isFinite(previousUpdatedMs) &&
    now < previousUpdatedMs + PAIRING_TTL_MS
  ) {
    throw new MbowazapBridgeError(
      'pairing_busy',
      'A pairing is already in progress for this account. Wait for it to finish or expire.'
    );
  }
  const patch = {
    account_id: accountId,
    user_id: userId,
    provider: 'mbowazap',
    mbowazap_pairing_ref: ref,
    mbowazap_state: 'pairing',
    status: 'disconnected',
    mbowazap_session: phone,
    mbowazap_display_name: null,
    mbowazap_brain: 'tchuekbot',
    updated_at: new Date(now).toISOString(),
  };
  // Compare-and-swap prevents two tabs replacing one another after both read
  // the old row. A concurrent insert is rejected by UNIQUE(account_id).
  let query = previous
    ? db.from('whatsapp_config').update(patch).eq('id', previous.id)
    : db.from('whatsapp_config').insert(patch);
  if (previous) {
    query =
      previous.updated_at === null
        ? query.is('updated_at', null)
        : query.eq('updated_at', previous.updated_at);
    query =
      previous.mbowazap_pairing_ref === null
        ? query.is('mbowazap_pairing_ref', null)
        : query.eq('mbowazap_pairing_ref', previous.mbowazap_pairing_ref);
  }
  const { data, error } = await query.select('id').maybeSingle();
  if (error?.code === '23505') {
    throw new MbowazapBridgeError(
      'pairing_busy',
      phone
        ? `Phone number +${phone} is already linked to or reserved by another wacrm account.`
        : 'The account or phone number is already reserved by another connection attempt.'
    );
  }
  if (!error && !data) {
    throw new MbowazapBridgeError(
      'pairing_busy',
      'The account or phone number is already reserved by another connection attempt.'
    );
  }
  if (error) throw new Error(`Failed to reserve pairing: ${error.message}`);

  return {
    expiresAt: new Date(now + PAIRING_TTL_MS).toISOString(),
    async rollback() {
      // Never undo a newer request, disconnect, or successful connection event.
      let rollbackState = previous;
      if (
        rollbackState &&
        (rollbackState.mbowazap_state === 'pairing' ||
          (options.previousWasDisconnectedOnBot &&
            rollbackState.mbowazap_state === 'connected'))
      ) {
        rollbackState = {
          ...rollbackState,
          mbowazap_state: 'disconnected',
          status: 'disconnected',
          mbowazap_session: null,
          mbowazap_display_name: null,
          mbowazap_pairing_ref: crypto.randomUUID(),
          updated_at: new Date().toISOString(),
        };
      }
      const operation = rollbackState
        ? db.from('whatsapp_config').update(rollbackState)
        : db.from('whatsapp_config').delete();
      const { error } = await operation
        .eq('account_id', accountId)
        .eq('mbowazap_pairing_ref', ref)
        .eq('mbowazap_state', 'pairing');
      if (error)
        console.error('[mbowazap/pair] reservation rollback failed:', error);
    },
  };
}

// [cleanup] clear mbowazap_display_name on new pairing attempt
