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

ALTER TABLE buffer_integrations ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON buffer_integrations;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON buffer_integrations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP POLICY IF EXISTS "buffer_integrations_select" ON buffer_integrations;
CREATE POLICY "buffer_integrations_select" ON buffer_integrations
  FOR SELECT USING (is_account_member(account_id, 'viewer'));

DROP POLICY IF EXISTS "buffer_integrations_write" ON buffer_integrations;
CREATE POLICY "buffer_integrations_write" ON buffer_integrations
  FOR ALL USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

-- 2. Synced social channels from Buffer
CREATE TABLE IF NOT EXISTS buffer_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  buffer_channel_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  service TEXT NOT NULL,
  name TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  is_queue_paused BOOLEAN NOT NULL DEFAULT FALSE,
  sent_posts_count INTEGER NOT NULL DEFAULT 0,
  scheduled_posts_count INTEGER NOT NULL DEFAULT 0,
  total_impressions BIGINT NOT NULL DEFAULT 0,
  total_reach BIGINT NOT NULL DEFAULT 0,
  total_engagements BIGINT NOT NULL DEFAULT 0,
  total_clicks BIGINT NOT NULL DEFAULT 0,
  engagement_rate NUMERIC(8, 2) NOT NULL DEFAULT 0,
  last_post_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, buffer_channel_id)
);

CREATE INDEX IF NOT EXISTS idx_buffer_channels_account_service
  ON buffer_channels (account_id, service);

ALTER TABLE buffer_channels ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON buffer_channels;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON buffer_channels
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP POLICY IF EXISTS "buffer_channels_select" ON buffer_channels;
CREATE POLICY "buffer_channels_select" ON buffer_channels
  FOR SELECT USING (is_account_member(account_id, 'viewer'));

DROP POLICY IF EXISTS "buffer_channels_write" ON buffer_channels;
CREATE POLICY "buffer_channels_write" ON buffer_channels
  FOR ALL USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

-- 3. Synced social posts & normalized engagement metrics from Buffer
CREATE TABLE IF NOT EXISTS buffer_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  buffer_post_id TEXT NOT NULL,
  buffer_channel_id TEXT NOT NULL,
  service TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent',
  text_content TEXT NOT NULL DEFAULT '',
  due_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  impressions BIGINT NOT NULL DEFAULT 0,
  reach BIGINT NOT NULL DEFAULT 0,
  reactions BIGINT NOT NULL DEFAULT 0,
  comments BIGINT NOT NULL DEFAULT 0,
  shares BIGINT NOT NULL DEFAULT 0,
  clicks BIGINT NOT NULL DEFAULT 0,
  total_engagements BIGINT NOT NULL DEFAULT 0,
  metrics_raw JSONB NOT NULL DEFAULT '[]'::jsonb,
  linked_growth_slug TEXT,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
