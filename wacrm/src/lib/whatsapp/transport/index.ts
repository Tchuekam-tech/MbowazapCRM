// ============================================================
// WhatsApp transport layer: one sending interface over the Meta Cloud
// API and MboWazap (TchuekBot over Baileys). An account is connected
// through exactly one of them — migration 043's `provider` column on
// the one-per-account `whatsapp_config` row.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption';
import { whatsappProvider } from '@/lib/whatsapp/provider';
import { createMbowazapTransport } from './mbowazap';
import { createMetaTransport } from './meta';
import { SendMessageError, type WhatsAppTransport } from './types';

export * from './types';
export * from './meta';
export * from './mbowazap';
export { whatsappProvider, META_ONLY_MESSAGE } from '@/lib/whatsapp/provider';

/**
 * The sending transport for an account, from its `whatsapp_config`.
 * `db` must be able to read that row and, for MboWazap, the account's
 * `messages` (the reply-only check).
 */
export async function loadTransport(
  db: SupabaseClient,
  accountId: string
): Promise<WhatsAppTransport> {
  const { data: config, error: configError } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId)
    .single();

  if (configError || !config) {
    throw new SendMessageError(
      'whatsapp_not_configured',
      'WhatsApp not configured. Please set up your WhatsApp integration first.',
      400
    );
  }

  if (whatsappProvider(config) === 'mbowazap') {
    // A row mid-pairing has no session yet (QR pairing learns the
    // number only once it's scanned).
    if (!config.mbowazap_session) {
      throw new SendMessageError(
        'mbowazap_not_connected',
        'MboWazap is not connected yet. Finish pairing in Settings → MboWazap.',
        409
      );
    }
    return createMbowazapTransport({ session: config.mbowazap_session, db });
  }

  const accessToken = decrypt(config.access_token);

  // Self-heal legacy CBC ciphertexts. Fire-and-forget; idempotent.
  if (isLegacyFormat(config.access_token)) {
    void db
      .from('whatsapp_config')
      .update({ access_token: encrypt(accessToken) })
      .eq('id', config.id)
      .then(({ error }: { error: { message: string } | null }) => {
        if (error) {
          console.warn(
            '[transport] access_token GCM upgrade failed:',
            error.message
          );
        }
      });
  }

  return createMetaTransport({
    phoneNumberId: config.phone_number_id,
    accessToken,
  });
}
