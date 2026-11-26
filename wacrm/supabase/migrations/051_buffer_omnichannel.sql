-- ============================================================
-- 051_buffer_omnichannel.sql — Buffer API & Omnichannel Digital
-- Presence Analytics
--
-- Lets each MboWazapCRM account connect its Buffer API key
-- (encrypted with AES-256-GCM at rest), instantly sync all
-- connected social channels (Instagram, LinkedIn, Facebook, X,
-- TikTok, Threads, YouTube, Pinterest, etc.) + posts & metrics,
-- cross-correlate social performance with WhatsApp Growth Links
-- & CRM revenue, and publish Growth-Link-powered posts back to
-- Buffer queues.
--
-- Idempotent — safe to re-run.
-- ============================================================

-- 1. Account-level Buffer connection (one per account)
CREATE TABLE IF NOT EXISTS buffer_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  api_key_encrypted TEXT NOT NULL,
  buffer_account_id TEXT,
  buffer_account_email TEXT,
  buffer_account_name TEXT,
  organization_id TEXT NOT NULL,
  organization_name TEXT,
  organizations_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'error', 'disconnected')),
  insights_available BOOLEAN NOT NULL DEFAULT TRUE,
  last_synced_at TIMESTAMPTZ,
  last_error TEXT,
  ai_audit_summary JSONB,
  ai_audit_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_buffer_integrations_sync
  ON buffer_integrations (status, last_synced_at ASC NULLS FIRST);

