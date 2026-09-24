-- ============================================================
-- 043_mbowazap.sql — MboWazap (TchuekBot) Baileys Gateway Schema
--
-- Enables dual-provider support in wacrm: each account connects
-- through EITHER the official Meta Cloud API OR MboWazap (TchuekBot
-- over Baileys), never both at once.
--
-- What this migration does:
--   1. Adds `provider` ('meta' | 'mbowazap') and MboWazap session /
--      pairing state columns to `whatsapp_config`.
--   2. Relaxes NOT NULL on `phone_number_id` and `access_token` so
--      MboWazap accounts do not require dummy Meta credentials.
--   3. Adds a CHECK constraint enforcing provider-specific shapes:
--      - 'meta' requires `phone_number_id` and `access_token`
--      - 'mbowazap' requires `mbowazap_pairing_ref` or `mbowazap_session`
--   4. Adds a partial UNIQUE index on `mbowazap_session` to guarantee
--      a WhatsApp phone number belongs to at most one wacrm account.
--   5. Adds `wa_lid` to `contacts` with an `(account_id, wa_lid)`
--      partial UNIQUE index to handle WhatsApp LID identities.
--
-- Tenancy & Isolation:
--   Migration 017 already enforces `UNIQUE(account_id)` on
--   `whatsapp_config`, ensuring exactly one connection per account.
--   Switching provider keeps all contact and message history because
--   conversations and messages belong to `account_id`, not the provider.
--
-- Idempotent — safe to re-run.
-- ============================================================

-- 1. Extend whatsapp_config with provider columns and relax Meta NOT NULLs
ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'meta' CHECK (provider IN ('meta', 'mbowazap')),
  ADD COLUMN IF NOT EXISTS mbowazap_session TEXT,
  ADD COLUMN IF NOT EXISTS mbowazap_pairing_ref UUID,
  ADD COLUMN IF NOT EXISTS mbowazap_state TEXT CHECK (mbowazap_state IN ('pairing', 'connected', 'disconnected', 'logged_out')),
  ADD COLUMN IF NOT EXISTS mbowazap_display_name TEXT,
  ADD COLUMN IF NOT EXISTS mbowazap_brain TEXT NOT NULL DEFAULT 'tchuekbot' CHECK (mbowazap_brain IN ('tchuekbot', 'wacrm')),
  ADD COLUMN IF NOT EXISTS mbowazap_last_event_at TIMESTAMPTZ,
  ALTER COLUMN phone_number_id DROP NOT NULL,
  ALTER COLUMN access_token DROP NOT NULL;

-- 2. Document newly added columns
COMMENT ON COLUMN whatsapp_config.provider IS
  'Active WhatsApp provider: "meta" (official Cloud API) or "mbowazap" (TchuekBot Baileys gateway).';

COMMENT ON COLUMN whatsapp_config.mbowazap_session IS
  'Paired phone number digits (e.g. "237653683174"), acting as the bot session identifier.';

COMMENT ON COLUMN whatsapp_config.mbowazap_pairing_ref IS
  'Unique token generated during pairing handshake so inbound bot connection events map to this account.';

COMMENT ON COLUMN whatsapp_config.mbowazap_state IS
  'Current Baileys socket lifecycle state: pairing, connected, disconnected, or logged_out.';

COMMENT ON COLUMN whatsapp_config.mbowazap_display_name IS
  'Display name / verified pushName of the paired WhatsApp companion session.';

COMMENT ON COLUMN whatsapp_config.mbowazap_brain IS
  'Who drives AI auto-replies: "tchuekbot" (Davila AI on the bot) or "wacrm" (wacrm Flows/AI assistant).';

COMMENT ON COLUMN whatsapp_config.mbowazap_last_event_at IS
  'Timestamp of the most recent event batch received from TchuekBot for this session.';

-- 3. Enforce mutually exclusive provider shapes via CHECK constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'whatsapp_config_provider_shape'
      AND conrelid = 'whatsapp_config'::regclass
  ) THEN
    ALTER TABLE whatsapp_config
      ADD CONSTRAINT whatsapp_config_provider_shape CHECK (
        (provider = 'meta'     AND phone_number_id IS NOT NULL AND access_token IS NOT NULL) OR
        (provider = 'mbowazap' AND (mbowazap_pairing_ref IS NOT NULL OR mbowazap_session IS NOT NULL))
      );
  END IF;
END $$;

-- 4. Unique index on mbowazap_session: exactly one account per paired WhatsApp number
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_config_mbowazap_session
  ON whatsapp_config (mbowazap_session)
  WHERE mbowazap_session IS NOT NULL;

-- 5. Fast lookup index for incoming pairing handshake webhook
CREATE INDEX IF NOT EXISTS idx_whatsapp_config_mbowazap_pairing_ref
  ON whatsapp_config (mbowazap_pairing_ref)
  WHERE mbowazap_pairing_ref IS NOT NULL;

-- 6. Add wa_lid to contacts for senders identified via WhatsApp LID
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS wa_lid TEXT;

COMMENT ON COLUMN contacts.wa_lid IS
  'WhatsApp LID (Linked Identity, e.g. "123456789012345"). Secondary identity used by Baileys when phone is withheld.';

-- 7. Unique index on (account_id, wa_lid) matching idx_contacts_account_wa_user_id pattern
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_account_wa_lid
  ON contacts (account_id, wa_lid)
  WHERE wa_lid IS NOT NULL;
