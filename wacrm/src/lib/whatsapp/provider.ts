// ============================================================
// Which WhatsApp provider an account is connected through. Each
// account has exactly one `whatsapp_config` row (migration 017), and
// migration 043's `provider` column says whether it's the official
// Meta Cloud API or MboWazap (TchuekBot over Baileys).
// ============================================================

export type WhatsAppProvider = 'meta' | 'mbowazap';

/** Anything but "mbowazap" — including a pre-043 row — is Meta. */
export function whatsappProvider(
  config: { provider?: string | null } | null | undefined
): WhatsAppProvider {
  return config?.provider === 'mbowazap' ? 'mbowazap' : 'meta';
}

/** Refusal for Meta-only features (templates, broadcasts, Meta media) on a MboWazap account. */
export const META_ONLY_MESSAGE =
  'This needs the official WhatsApp Cloud API, but this account is connected through MboWazap.';

/** Refusal for Cloud API configuration while MboWazap holds the account's one connection. */
export const MBOWAZAP_CONNECTED_MESSAGE =
  'This account is connected through MboWazap. Disconnect it in Settings → MboWazap before connecting the official WhatsApp Cloud API.';
