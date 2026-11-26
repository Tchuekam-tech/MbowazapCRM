-- ============================================================
-- MboWazapCRM Production Migration Bundle (047 -> 053)
-- Target Supabase Project: jwclwfsxkyxqvanqqixs.supabase.co
-- Safe to run multiple times (100% idempotent).
-- Paste into Supabase Dashboard -> SQL Editor -> Run.
-- ============================================================

-- >>>>>>>>>>>>>>>>>>>> 047_mbowazap_events_rls.sql <<<<<<<<<<<<<<<<<<<<
-- ============================================================
-- 047_mbowazap_events_rls.sql — Lock Down mbowazap_events with RLS
--
-- `mbowazap_events` stores internal bridge deduplication records and
-- account IDs. It is only accessed server-side via supabaseAdmin
-- (service_role key). Enabling RLS with no policies denies all anon and
-- authenticated client reads/writes while permitting service_role bypass.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE mbowazap_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE mbowazap_events FROM anon, authenticated;
GRANT ALL ON TABLE mbowazap_events TO service_role;

-- >>>>>>>>>>>>>>>>>>>> 048_ai_gemini_provider.sql <<<<<<<<<<<<<<<<<<<<
-- ============================================================
-- 048_ai_gemini_provider.sql — Allow 'gemini' in ai_configs and ai_usage_log
--
-- Extends the provider CHECK constraint on both `ai_configs` and
-- `ai_usage_log` from ('openai', 'anthropic') to
-- ('openai', 'anthropic', 'gemini').
--
-- Idempotent — safe to run multiple times.
-- ============================================================

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'ai_configs'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%provider%'
  LOOP
    EXECUTE format('ALTER TABLE public.ai_configs DROP CONSTRAINT %I', r.conname);
  END LOOP;

  ALTER TABLE public.ai_configs
    ADD CONSTRAINT ai_configs_provider_check
    CHECK (provider IN ('openai', 'anthropic', 'gemini'));

  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'ai_usage_log'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%provider%'
  LOOP
    EXECUTE format('ALTER TABLE public.ai_usage_log DROP CONSTRAINT %I', r.conname);
  END LOOP;

  ALTER TABLE public.ai_usage_log
    ADD CONSTRAINT ai_usage_log_provider_check
    CHECK (provider IN ('openai', 'anthropic', 'gemini'));
END $$;

-- >>>>>>>>>>>>>>>>>>>> 049_marketing_growth_suite.sql <<<<<<<<<<<<<<<<<<<<
-- ============================================================
-- 049_marketing_growth_suite.sql — MboWazap Marketing Growth OS
--
-- Introduces 5 core marketing capabilities with full multi-tenant
-- account isolation (is_account_member) and idempotent DDL:
--
--   1. Growth Links & QR Attribution (`growth_links`, `growth_link_clicks`)
--      Click-to-WhatsApp short links (/go/<slug>) with UTM tracking,
--      pre-filled ref codes, auto-tagging, and conversion attribution.
--   2. Smart Audience Segments & AI Lead Scoring
--      (`contact_lead_scores`, `marketing_segments`)
--      0-100 lead temperature scoring (hot/warm/cold), buy-intent
--      signals, AI next-best-action, and dynamic segment rules.
--   3. Multi-Step Drip & Win-Back Sequences
--      (`drip_sequences`, `drip_sequence_steps`, `drip_enrollments`)
--      Automated multi-day WhatsApp nurture funnels with quiet hours,
--      reply-aware exit conditions, and dual-provider pacing.
--   4. AI Copywriter & A/B Split-Test Campaigns
--      (`ab_campaigns`, `ab_campaign_variants`, `ab_campaign_recipients`)
--      Two-variant split testing with holdout auto-winner promotion.
--   5. Promo Coupons & Revenue ROI Attribution
--      (`promo_coupons`, `coupon_redemptions` + contact UTM columns)
--      Trackable WhatsApp offer codes tied directly to deals & revenue.
--
-- Idempotent — safe to re-run.
-- ============================================================

-- ============================================================
-- 0. ATTRIBUTION COLUMNS ON CONTACTS
-- ============================================================
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS utm_source TEXT,
  ADD COLUMN IF NOT EXISTS utm_medium TEXT,
  ADD COLUMN IF NOT EXISTS utm_campaign TEXT,
  ADD COLUMN IF NOT EXISTS growth_link_id UUID;

-- ============================================================
-- 1. GROWTH LINKS & QR ATTRIBUTION
-- ============================================================
CREATE TABLE IF NOT EXISTS growth_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  destination_phone TEXT NOT NULL,
  prefill_message TEXT NOT NULL DEFAULT '',
  ref_code TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  auto_tag_id UUID REFERENCES tags(id) ON DELETE SET NULL,
  clicks_count INTEGER NOT NULL DEFAULT 0,
  unique_clicks_count INTEGER NOT NULL DEFAULT 0,
  conversions_count INTEGER NOT NULL DEFAULT 0,
  attributed_revenue NUMERIC(14, 2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_growth_links_account_created
  ON growth_links (account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_growth_links_account_ref
  ON growth_links (account_id, ref_code)
  WHERE ref_code IS NOT NULL;

ALTER TABLE growth_links ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON growth_links;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON growth_links
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP POLICY IF EXISTS "growth_links_select" ON growth_links;
CREATE POLICY "growth_links_select" ON growth_links
  FOR SELECT USING (is_account_member(account_id, 'viewer'));

DROP POLICY IF EXISTS "growth_links_insert" ON growth_links;
CREATE POLICY "growth_links_insert" ON growth_links
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS "growth_links_update" ON growth_links;
CREATE POLICY "growth_links_update" ON growth_links
  FOR UPDATE USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS "growth_links_delete" ON growth_links;
CREATE POLICY "growth_links_delete" ON growth_links
  FOR DELETE USING (is_account_member(account_id, 'agent'));

CREATE TABLE IF NOT EXISTS growth_link_clicks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id UUID NOT NULL REFERENCES growth_links(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  visitor_hash TEXT NOT NULL,
  referrer TEXT,
  user_agent TEXT,
  converted_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_growth_link_clicks_link_created
  ON growth_link_clicks (link_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_growth_link_clicks_visitor
  ON growth_link_clicks (link_id, visitor_hash);

ALTER TABLE growth_link_clicks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "growth_link_clicks_select" ON growth_link_clicks;
CREATE POLICY "growth_link_clicks_select" ON growth_link_clicks
  FOR SELECT USING (is_account_member(account_id, 'viewer'));

-- Atomic click recorder called from the public /go/[slug] redirect route via service_role.
CREATE OR REPLACE FUNCTION record_growth_link_click(
  p_link_id UUID,
  p_account_id UUID,
  p_visitor_hash TEXT,
  p_referrer TEXT DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seen BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM growth_link_clicks
    WHERE link_id = p_link_id
      AND visitor_hash = p_visitor_hash
      AND created_at >= NOW() - INTERVAL '24 hours'
  ) INTO v_seen;

  INSERT INTO growth_link_clicks (link_id, account_id, visitor_hash, referrer, user_agent)
  VALUES (p_link_id, p_account_id, p_visitor_hash, p_referrer, p_user_agent);

  UPDATE growth_links
  SET clicks_count = clicks_count + 1,
      unique_clicks_count = unique_clicks_count + CASE WHEN v_seen THEN 0 ELSE 1 END,
      updated_at = NOW()
  WHERE id = p_link_id;

  RETURN NOT v_seen;
END;
$$;

REVOKE ALL ON FUNCTION record_growth_link_click(UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_growth_link_click(UUID, UUID, TEXT, TEXT, TEXT) TO service_role;

-- ============================================================
-- 2. LEAD INTELLIGENCE & SMART AUDIENCE SEGMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS contact_lead_scores (
  contact_id UUID PRIMARY KEY REFERENCES contacts(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  score INTEGER NOT NULL DEFAULT 0 CHECK (score >= 0 AND score <= 100),
  tier TEXT NOT NULL DEFAULT 'cold' CHECK (tier IN ('hot', 'warm', 'cold')),
  intent_label TEXT,
  signals JSONB NOT NULL DEFAULT '[]'::jsonb,
  ai_summary TEXT,
  next_best_action TEXT,
  last_message_at TIMESTAMPTZ,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contact_lead_scores_account_tier_score
  ON contact_lead_scores (account_id, tier, score DESC);

ALTER TABLE contact_lead_scores ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON contact_lead_scores;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON contact_lead_scores
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP POLICY IF EXISTS "contact_lead_scores_select" ON contact_lead_scores;
CREATE POLICY "contact_lead_scores_select" ON contact_lead_scores
  FOR SELECT USING (is_account_member(account_id, 'viewer'));

DROP POLICY IF EXISTS "contact_lead_scores_write" ON contact_lead_scores;
CREATE POLICY "contact_lead_scores_write" ON contact_lead_scores
  FOR ALL USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

CREATE TABLE IF NOT EXISTS marketing_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  cached_count INTEGER NOT NULL DEFAULT 0,
  last_evaluated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketing_segments_account
  ON marketing_segments (account_id, created_at DESC);

ALTER TABLE marketing_segments ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON marketing_segments;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON marketing_segments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP POLICY IF EXISTS "marketing_segments_select" ON marketing_segments;
CREATE POLICY "marketing_segments_select" ON marketing_segments
  FOR SELECT USING (is_account_member(account_id, 'viewer'));

DROP POLICY IF EXISTS "marketing_segments_write" ON marketing_segments;
CREATE POLICY "marketing_segments_write" ON marketing_segments
  FOR ALL USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

-- ============================================================
-- 3. MULTI-STEP DRIP & WIN-BACK SEQUENCES
-- ============================================================
CREATE TABLE IF NOT EXISTS drip_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused')),
  segment_id UUID REFERENCES marketing_segments(id) ON DELETE SET NULL,
  stop_on_reply BOOLEAN NOT NULL DEFAULT TRUE,
  stop_on_tag_id UUID REFERENCES tags(id) ON DELETE SET NULL,
  quiet_hours_start TEXT NOT NULL DEFAULT '21:00',
  quiet_hours_end TEXT NOT NULL DEFAULT '08:00',
  timezone TEXT NOT NULL DEFAULT 'UTC',
  enrolled_count INTEGER NOT NULL DEFAULT 0,
  completed_count INTEGER NOT NULL DEFAULT 0,
  replied_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_drip_sequences_account
  ON drip_sequences (account_id, created_at DESC);

ALTER TABLE drip_sequences ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON drip_sequences;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON drip_sequences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP POLICY IF EXISTS "drip_sequences_select" ON drip_sequences;
CREATE POLICY "drip_sequences_select" ON drip_sequences
  FOR SELECT USING (is_account_member(account_id, 'viewer'));

DROP POLICY IF EXISTS "drip_sequences_write" ON drip_sequences;
CREATE POLICY "drip_sequences_write" ON drip_sequences
  FOR ALL USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

-- ============================================================
-- 5 (defined before steps/variants FKs): PROMO COUPONS
-- ============================================================
CREATE TABLE IF NOT EXISTS promo_coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  discount_type TEXT NOT NULL DEFAULT 'percent' CHECK (discount_type IN ('percent', 'fixed')),
  discount_value NUMERIC(12, 2) NOT NULL CHECK (discount_value > 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  min_order_value NUMERIC(12, 2) NOT NULL DEFAULT 0,
  max_uses INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
  uses_count INTEGER NOT NULL DEFAULT 0,
  attributed_revenue NUMERIC(14, 2) NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, code)
);

CREATE INDEX IF NOT EXISTS idx_promo_coupons_account
  ON promo_coupons (account_id, created_at DESC);

ALTER TABLE promo_coupons ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON promo_coupons;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON promo_coupons
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP POLICY IF EXISTS "promo_coupons_select" ON promo_coupons;
CREATE POLICY "promo_coupons_select" ON promo_coupons
  FOR SELECT USING (is_account_member(account_id, 'viewer'));

DROP POLICY IF EXISTS "promo_coupons_write" ON promo_coupons;
CREATE POLICY "promo_coupons_write" ON promo_coupons
  FOR ALL USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id UUID NOT NULL REFERENCES promo_coupons(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  order_value NUMERIC(12, 2) NOT NULL DEFAULT 0,
  discount_applied NUMERIC(12, 2) NOT NULL DEFAULT 0,
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_coupon
  ON coupon_redemptions (coupon_id, redeemed_at DESC);

CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_account
  ON coupon_redemptions (account_id, redeemed_at DESC);

ALTER TABLE coupon_redemptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "coupon_redemptions_select" ON coupon_redemptions;
CREATE POLICY "coupon_redemptions_select" ON coupon_redemptions
  FOR SELECT USING (is_account_member(account_id, 'viewer'));

DROP POLICY IF EXISTS "coupon_redemptions_write" ON coupon_redemptions;
CREATE POLICY "coupon_redemptions_write" ON coupon_redemptions
  FOR ALL USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

-- Drip steps & enrollments
CREATE TABLE IF NOT EXISTS drip_sequence_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id UUID NOT NULL REFERENCES drip_sequences(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL CHECK (step_order >= 1),
  delay_minutes INTEGER NOT NULL DEFAULT 0 CHECK (delay_minutes >= 0),
  message_type TEXT NOT NULL DEFAULT 'text' CHECK (message_type IN ('text', 'template', 'image')),
  content_text TEXT NOT NULL DEFAULT '',
  media_url TEXT,
  template_name TEXT,
  template_language TEXT,
  coupon_id UUID REFERENCES promo_coupons(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (sequence_id, step_order)
);

ALTER TABLE drip_sequence_steps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "drip_sequence_steps_select" ON drip_sequence_steps;
CREATE POLICY "drip_sequence_steps_select" ON drip_sequence_steps
  FOR SELECT USING (is_account_member(account_id, 'viewer'));

DROP POLICY IF EXISTS "drip_sequence_steps_write" ON drip_sequence_steps;
CREATE POLICY "drip_sequence_steps_write" ON drip_sequence_steps
  FOR ALL USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

CREATE TABLE IF NOT EXISTS drip_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id UUID NOT NULL REFERENCES drip_sequences(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  current_step_order INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'replied', 'exited', 'failed', 'paused')),
  next_send_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_sent_at TIMESTAMPTZ,
  last_error TEXT,
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE (sequence_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_drip_enrollments_due
  ON drip_enrollments (next_send_at)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_drip_enrollments_contact_active
  ON drip_enrollments (account_id, contact_id)
  WHERE status = 'active';

ALTER TABLE drip_enrollments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "drip_enrollments_select" ON drip_enrollments;
CREATE POLICY "drip_enrollments_select" ON drip_enrollments
  FOR SELECT USING (is_account_member(account_id, 'viewer'));

DROP POLICY IF EXISTS "drip_enrollments_write" ON drip_enrollments;
CREATE POLICY "drip_enrollments_write" ON drip_enrollments
  FOR ALL USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

-- ============================================================
-- 4. AI COPYWRITER & A/B SPLIT-TEST CAMPAIGNS
-- ============================================================
CREATE TABLE IF NOT EXISTS ab_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  goal TEXT NOT NULL DEFAULT 'promotion',
  segment_id UUID REFERENCES marketing_segments(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'running', 'evaluating', 'completed', 'failed')),
  split_ratio INTEGER NOT NULL DEFAULT 50 CHECK (split_ratio >= 10 AND split_ratio <= 90),
  holdout_percent INTEGER NOT NULL DEFAULT 0 CHECK (holdout_percent >= 0 AND holdout_percent <= 80),
  winner_variant TEXT CHECK (winner_variant IN ('A', 'B')),
  winner_metric TEXT NOT NULL DEFAULT 'reply_rate' CHECK (winner_metric IN ('reply_rate', 'read_rate', 'conversion_rate')),
  scheduled_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ab_campaigns_account
  ON ab_campaigns (account_id, created_at DESC);

ALTER TABLE ab_campaigns ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON ab_campaigns;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON ab_campaigns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP POLICY IF EXISTS "ab_campaigns_select" ON ab_campaigns;
CREATE POLICY "ab_campaigns_select" ON ab_campaigns
  FOR SELECT USING (is_account_member(account_id, 'viewer'));

DROP POLICY IF EXISTS "ab_campaigns_write" ON ab_campaigns;
CREATE POLICY "ab_campaigns_write" ON ab_campaigns
  FOR ALL USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

CREATE TABLE IF NOT EXISTS ab_campaign_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES ab_campaigns(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  variant_key TEXT NOT NULL CHECK (variant_key IN ('A', 'B')),
  label TEXT NOT NULL DEFAULT '',
  body_text TEXT NOT NULL,
  template_name TEXT,
  template_language TEXT,
  media_url TEXT,
  coupon_id UUID REFERENCES promo_coupons(id) ON DELETE SET NULL,
  compliance_score INTEGER NOT NULL DEFAULT 100 CHECK (compliance_score >= 0 AND compliance_score <= 100),
  sent_count INTEGER NOT NULL DEFAULT 0,
  delivered_count INTEGER NOT NULL DEFAULT 0,
  read_count INTEGER NOT NULL DEFAULT 0,
  replied_count INTEGER NOT NULL DEFAULT 0,
  conversions_count INTEGER NOT NULL DEFAULT 0,
  revenue_attributed NUMERIC(14, 2) NOT NULL DEFAULT 0,
  UNIQUE (campaign_id, variant_key)
);

ALTER TABLE ab_campaign_variants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ab_campaign_variants_select" ON ab_campaign_variants;
CREATE POLICY "ab_campaign_variants_select" ON ab_campaign_variants
  FOR SELECT USING (is_account_member(account_id, 'viewer'));

DROP POLICY IF EXISTS "ab_campaign_variants_write" ON ab_campaign_variants;
CREATE POLICY "ab_campaign_variants_write" ON ab_campaign_variants
  FOR ALL USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

CREATE TABLE IF NOT EXISTS ab_campaign_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES ab_campaigns(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES ab_campaign_variants(id) ON DELETE SET NULL,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  variant_key TEXT NOT NULL CHECK (variant_key IN ('A', 'B', 'holdout')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'replied', 'failed')),
  whatsapp_message_id TEXT,
  error_message TEXT,
  sent_at TIMESTAMPTZ,
  replied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_ab_campaign_recipients_campaign_status
  ON ab_campaign_recipients (campaign_id, status);

CREATE INDEX IF NOT EXISTS idx_ab_campaign_recipients_contact_sent
  ON ab_campaign_recipients (account_id, contact_id, sent_at DESC)
  WHERE status IN ('sent', 'delivered', 'read');

ALTER TABLE ab_campaign_recipients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ab_campaign_recipients_select" ON ab_campaign_recipients;
CREATE POLICY "ab_campaign_recipients_select" ON ab_campaign_recipients
  FOR SELECT USING (is_account_member(account_id, 'viewer'));

DROP POLICY IF EXISTS "ab_campaign_recipients_write" ON ab_campaign_recipients;
CREATE POLICY "ab_campaign_recipients_write" ON ab_campaign_recipients
  FOR ALL USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

-- >>>>>>>>>>>>>>>>>>>> 050_performance_hardening_and_indexes.sql <<<<<<<<<<<<<<<<<<<<
-- ============================================================
-- 050_performance_hardening_and_indexes.sql
--
-- Production-grade composite & partial indexes plus server-side
-- aggregation RPCs so high-volume accounts keep sub-50ms query
-- latencies on the dashboard, inbox, contacts, broadcasts, and crons.
--
-- Idempotent — safe to re-run.
-- ============================================================

-- 1. Hot-path indexes for Inbox, Dashboard, Broadcasts, Automations & Marketing
CREATE INDEX IF NOT EXISTS idx_messages_conv_created_desc
  ON messages (conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_sender_created_desc
  ON messages (sender_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_wa_message_id
  ON messages (message_id)
  WHERE message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_account_status_last_msg
  ON conversations (account_id, status, last_message_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_conversations_account_contact
  ON conversations (account_id, contact_id);

CREATE INDEX IF NOT EXISTS idx_contacts_account_created_desc
  ON contacts (account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_contacts_account_utm
  ON contacts (account_id, utm_source, utm_campaign)
  WHERE utm_source IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_deals_account_status_stage
  ON deals (account_id, status, stage_id);

CREATE INDEX IF NOT EXISTS idx_deals_contact_created_desc
  ON deals (contact_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_broadcast_status
  ON broadcast_recipients (broadcast_id, status);

CREATE INDEX IF NOT EXISTS idx_automation_pending_due_fast
  ON automation_pending_executions (run_at)
  WHERE status = 'pending';

-- 2. Fast single-roundtrip Dashboard Metrics RPC (RLS-respecting SECURITY INVOKER)
CREATE OR REPLACE FUNCTION get_dashboard_metrics_fast(
  p_today_start TIMESTAMPTZ,
  p_yesterday_start TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT jsonb_build_object(
    'open_conv_cur', (SELECT COUNT(*) FROM conversations WHERE status = 'open'),
    'new_conv_today', (SELECT COUNT(*) FROM conversations WHERE status = 'open' AND created_at >= p_today_start),
    'new_conv_yesterday', (SELECT COUNT(*) FROM conversations WHERE status = 'open' AND created_at >= p_yesterday_start AND created_at < p_today_start),
    'new_contacts_today', (SELECT COUNT(*) FROM contacts WHERE created_at >= p_today_start),
    'new_contacts_yesterday', (SELECT COUNT(*) FROM contacts WHERE created_at >= p_yesterday_start AND created_at < p_today_start),
    'open_deals_value', COALESCE((SELECT SUM(COALESCE(value, 0)) FROM deals WHERE status = 'open'), 0),
    'open_deals_count', (SELECT COUNT(*) FROM deals WHERE status = 'open'),
    'messages_today', (SELECT COUNT(*) FROM messages WHERE sender_type = 'agent' AND created_at >= p_today_start),
    'messages_yesterday', (SELECT COUNT(*) FROM messages WHERE sender_type = 'agent' AND created_at >= p_yesterday_start AND created_at < p_today_start)
  );
$$;

GRANT EXECUTE ON FUNCTION get_dashboard_metrics_fast(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

-- 3. Fast server-side daily message volume aggregation RPC (avoids pulling 10k+ raw rows to client)
CREATE OR REPLACE FUNCTION get_conversations_series_fast(
  p_start TIMESTAMPTZ,
  p_tz TEXT DEFAULT 'UTC'
) RETURNS TABLE (
  day TEXT,
  incoming BIGINT,
  outgoing BIGINT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    to_char(created_at AT TIME ZONE COALESCE(NULLIF(p_tz, ''), 'UTC'), 'YYYY-MM-DD') AS day,
    COUNT(*) FILTER (WHERE sender_type = 'customer') AS incoming,
    COUNT(*) FILTER (WHERE sender_type <> 'customer') AS outgoing
  FROM messages
  WHERE created_at >= p_start
  GROUP BY 1
  ORDER BY 1 ASC;
$$;

GRANT EXECUTE ON FUNCTION get_conversations_series_fast(TIMESTAMPTZ, TEXT) TO authenticated;

-- >>>>>>>>>>>>>>>>>>>> 051_buffer_omnichannel.sql <<<<<<<<<<<<<<<<<<<<
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, buffer_post_id)
);

CREATE INDEX IF NOT EXISTS idx_buffer_posts_account_sent
  ON buffer_posts (account_id, sent_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_buffer_posts_account_channel
  ON buffer_posts (account_id, buffer_channel_id, status);

ALTER TABLE buffer_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "buffer_posts_select" ON buffer_posts;
CREATE POLICY "buffer_posts_select" ON buffer_posts
  FOR SELECT USING (is_account_member(account_id, 'viewer'));

DROP POLICY IF EXISTS "buffer_posts_write" ON buffer_posts;
CREATE POLICY "buffer_posts_write" ON buffer_posts
  FOR ALL USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

-- >>>>>>>>>>>>>>>>>>>> 052_autonomous_jarvis_and_knowledge_hub.sql <<<<<<<<<<<<<<<<<<<<
-- ============================================================
-- 052_autonomous_jarvis_and_knowledge_hub.sql
--
-- Turns MboWazapCRM into an autonomous 24/7 AI Employee ("Jarvis")
-- ready for multi-tenant SaaS distribution:
--   1. Company DNA / Profile (`jarvis_company_profiles`)
--   2. Multi-source Knowledge Hub metadata on `ai_knowledge_documents`
--      (company_bio, website URLs w/ auto-sync, uploaded business docs,
--       FAQs, product catalogs, policies)
--   3. Autonomous 24/7 Jarvis configuration & typing-simulation controls
--      (`jarvis_configs`)
--   4. Ecosystem brain cycle audit log (`jarvis_runs`)
--   5. Autonomous action queue & execution log (`jarvis_actions`)
--   6. Direct Jarvis Command Console chat history (`jarvis_chat_messages`)
--   7. Expands `notifications.type` check constraint for Jarvis alerts
--
-- Idempotent — safe to re-run. Uses native gen_random_uuid().
-- ============================================================

-- 1. Extend notifications.type constraint for Jarvis alerts & briefings
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'notifications'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%type%'
  LOOP
    EXECUTE format('ALTER TABLE public.notifications DROP CONSTRAINT %I', r.conname);
  END LOOP;

  ALTER TABLE public.notifications
    ADD CONSTRAINT notifications_type_check
    CHECK (type IN (
      'conversation_assigned',
      'jarvis_alert',
      'jarvis_briefing',
      'jarvis_approval_needed'
    ));
END $$;

-- 2. Extend ai_knowledge_documents with multi-source ingestion metadata
ALTER TABLE ai_knowledge_documents
  ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS source_url TEXT,
  ADD COLUMN IF NOT EXISTS file_name TEXT,
  ADD COLUMN IF NOT EXISTS mime_type TEXT,
  ADD COLUMN IF NOT EXISTS file_size_bytes INTEGER,
  ADD COLUMN IF NOT EXISTS sync_status TEXT NOT NULL DEFAULT 'synced',
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS last_sync_error TEXT,
  ADD COLUMN IF NOT EXISTS auto_sync_hours INTEGER,
  ADD COLUMN IF NOT EXISTS chunk_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS char_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_ai_knowledge_documents_account_source
  ON ai_knowledge_documents (account_id, source_type, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_knowledge_documents_autosync
  ON ai_knowledge_documents (source_type, last_synced_at ASC NULLS FIRST)
  WHERE source_type = 'website' AND auto_sync_hours IS NOT NULL;

-- 3. Multi-tenant Company Bio & Brand DNA (`jarvis_company_profiles`)
CREATE TABLE IF NOT EXISTS jarvis_company_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  company_name TEXT NOT NULL DEFAULT '',
  tagline TEXT NOT NULL DEFAULT '',
  industry TEXT NOT NULL DEFAULT '',
  company_bio TEXT NOT NULL DEFAULT '',
  website_url TEXT NOT NULL DEFAULT '',
  support_email TEXT NOT NULL DEFAULT '',
  support_phone TEXT NOT NULL DEFAULT '',
  business_hours TEXT NOT NULL DEFAULT '',
  timezone TEXT NOT NULL DEFAULT 'UTC',
  primary_language TEXT NOT NULL DEFAULT 'English',
  brand_voice TEXT NOT NULL DEFAULT 'consultative'
    CHECK (brand_voice IN ('professional', 'friendly', 'consultative', 'bold', 'luxury', 'custom')),
  products_services_summary TEXT NOT NULL DEFAULT '',
  pricing_summary TEXT NOT NULL DEFAULT '',
  policies_summary TEXT NOT NULL DEFAULT '',
  escalation_rules TEXT NOT NULL DEFAULT '',
  custom_instructions TEXT NOT NULL DEFAULT '',
  social_links JSONB NOT NULL DEFAULT '{}'::jsonb,
  faq_pairs JSONB NOT NULL DEFAULT '[]'::jsonb,
  kb_document_id UUID REFERENCES ai_knowledge_documents(id) ON DELETE SET NULL,
  completeness_score INTEGER NOT NULL DEFAULT 0 CHECK (completeness_score >= 0 AND completeness_score <= 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE jarvis_company_profiles ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON jarvis_company_profiles;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON jarvis_company_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP POLICY IF EXISTS "jarvis_company_profiles_select" ON jarvis_company_profiles;
CREATE POLICY "jarvis_company_profiles_select" ON jarvis_company_profiles
  FOR SELECT USING (is_account_member(account_id, 'viewer'));

DROP POLICY IF EXISTS "jarvis_company_profiles_write" ON jarvis_company_profiles;
CREATE POLICY "jarvis_company_profiles_write" ON jarvis_company_profiles
  FOR ALL USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

-- 4. Autonomous 24/7 Jarvis Config & Typing Simulation (`jarvis_configs`)
CREATE TABLE IF NOT EXISTS jarvis_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  agent_name TEXT NOT NULL DEFAULT 'Jarvis',
  agent_role TEXT NOT NULL DEFAULT '24/7 Autonomous Growth & Operations Director',
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  autonomy_mode TEXT NOT NULL DEFAULT 'copilot'
    CHECK (autonomy_mode IN ('observer', 'copilot', 'autonomous')),

  -- Granular capabilities
  can_reply_inbound BOOLEAN NOT NULL DEFAULT TRUE,
  can_followup_stale_leads BOOLEAN NOT NULL DEFAULT TRUE,
  can_manage_deals BOOLEAN NOT NULL DEFAULT TRUE,
  can_score_and_tag BOOLEAN NOT NULL DEFAULT TRUE,
  can_publish_social BOOLEAN NOT NULL DEFAULT FALSE,
  can_enroll_drips BOOLEAN NOT NULL DEFAULT TRUE,
  can_alert_team BOOLEAN NOT NULL DEFAULT TRUE,

  -- Human-like typing simulation controls
  typing_simulation_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  typing_speed_profile TEXT NOT NULL DEFAULT 'natural'
    CHECK (typing_speed_profile IN ('fast', 'natural', 'thoughtful')),
  typing_min_ms INTEGER NOT NULL DEFAULT 1200 CHECK (typing_min_ms >= 0 AND typing_min_ms <= 15000),
  typing_max_ms INTEGER NOT NULL DEFAULT 8500 CHECK (typing_max_ms >= 500 AND typing_max_ms <= 20000),

  -- Guardrails & scheduling
  cycle_interval_minutes INTEGER NOT NULL DEFAULT 15 CHECK (cycle_interval_minutes >= 5 AND cycle_interval_minutes <= 1440),
  max_autonomous_actions_per_day INTEGER NOT NULL DEFAULT 50 CHECK (max_autonomous_actions_per_day >= 1 AND max_autonomous_actions_per_day <= 500),
  max_proactive_messages_per_day INTEGER NOT NULL DEFAULT 20 CHECK (max_proactive_messages_per_day >= 0 AND max_proactive_messages_per_day <= 200),
  contact_cooldown_hours INTEGER NOT NULL DEFAULT 24 CHECK (contact_cooldown_hours >= 1 AND contact_cooldown_hours <= 336),
  quiet_hours_start TEXT NOT NULL DEFAULT '21:00',
  quiet_hours_end TEXT NOT NULL DEFAULT '08:00',
  timezone TEXT NOT NULL DEFAULT 'UTC',

  -- Latest heartbeat snapshot
  last_cycle_at TIMESTAMPTZ,
  last_cycle_status TEXT,
  last_cycle_summary TEXT,
  last_ecosystem_health_score INTEGER CHECK (last_ecosystem_health_score IS NULL OR (last_ecosystem_health_score >= 0 AND last_ecosystem_health_score <= 100)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jarvis_configs_enabled_cycle
  ON jarvis_configs (is_enabled, last_cycle_at ASC NULLS FIRST)
  WHERE is_enabled = TRUE;

ALTER TABLE jarvis_configs ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON jarvis_configs;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON jarvis_configs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP POLICY IF EXISTS "jarvis_configs_select" ON jarvis_configs;
CREATE POLICY "jarvis_configs_select" ON jarvis_configs
  FOR SELECT USING (is_account_member(account_id, 'viewer'));

DROP POLICY IF EXISTS "jarvis_configs_write" ON jarvis_configs;
CREATE POLICY "jarvis_configs_write" ON jarvis_configs
  FOR ALL USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

-- 5. Autonomous Brain Runs (`jarvis_runs`)
CREATE TABLE IF NOT EXISTS jarvis_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  trigger TEXT NOT NULL DEFAULT 'cron' CHECK (trigger IN ('cron', 'manual', 'command', 'inbound')),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  health_score INTEGER NOT NULL DEFAULT 0 CHECK (health_score >= 0 AND health_score <= 100),
  ecosystem_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  executive_summary TEXT NOT NULL DEFAULT '',
  observations JSONB NOT NULL DEFAULT '[]'::jsonb,
  actions_proposed INTEGER NOT NULL DEFAULT 0,
  actions_executed INTEGER NOT NULL DEFAULT 0,
  actions_failed INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_jarvis_runs_account_started
  ON jarvis_runs (account_id, started_at DESC);

ALTER TABLE jarvis_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "jarvis_runs_select" ON jarvis_runs;
CREATE POLICY "jarvis_runs_select" ON jarvis_runs
  FOR SELECT USING (is_account_member(account_id, 'viewer'));

DROP POLICY IF EXISTS "jarvis_runs_write" ON jarvis_runs;
CREATE POLICY "jarvis_runs_write" ON jarvis_runs
  FOR ALL USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

-- 6. Autonomous Action Queue & Audit Log (`jarvis_actions`)
CREATE TABLE IF NOT EXISTS jarvis_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  run_id UUID REFERENCES jarvis_runs(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL CHECK (action_type IN (
    'send_whatsapp_followup',
    'create_or_advance_deal',
    'tag_contact',
    'enroll_drip',
    'queue_buffer_post',
    'recompute_lead_scores',
    'create_team_alert',
    'escalate_conversation'
  )),
  status TEXT NOT NULL DEFAULT 'pending_approval' CHECK (status IN (
    'pending_approval',
    'approved',
    'executed',
    'rejected',
    'failed',
    'skipped'
  )),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('critical', 'high', 'medium', 'low')),
  title TEXT NOT NULL,
  reasoning TEXT NOT NULL DEFAULT '',
  target_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  target_conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  target_deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB,
  error_message TEXT,
  executed_at TIMESTAMPTZ,
  decided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jarvis_actions_account_created
  ON jarvis_actions (account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_jarvis_actions_account_status
  ON jarvis_actions (account_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_jarvis_actions_contact_recent
  ON jarvis_actions (account_id, target_contact_id, executed_at DESC)
  WHERE target_contact_id IS NOT NULL AND status = 'executed';

ALTER TABLE jarvis_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "jarvis_actions_select" ON jarvis_actions;
CREATE POLICY "jarvis_actions_select" ON jarvis_actions
  FOR SELECT USING (is_account_member(account_id, 'viewer'));

DROP POLICY IF EXISTS "jarvis_actions_write" ON jarvis_actions;
CREATE POLICY "jarvis_actions_write" ON jarvis_actions
  FOR ALL USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

-- 7. Jarvis Interactive Command Console Chat (`jarvis_chat_messages`)
CREATE TABLE IF NOT EXISTS jarvis_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  proposed_action_ids UUID[] NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jarvis_chat_messages_account_created
  ON jarvis_chat_messages (account_id, created_at DESC);

ALTER TABLE jarvis_chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "jarvis_chat_messages_select" ON jarvis_chat_messages;
CREATE POLICY "jarvis_chat_messages_select" ON jarvis_chat_messages
  FOR SELECT USING (is_account_member(account_id, 'viewer'));

DROP POLICY IF EXISTS "jarvis_chat_messages_write" ON jarvis_chat_messages;
CREATE POLICY "jarvis_chat_messages_write" ON jarvis_chat_messages
  FOR ALL USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

-- >>>>>>>>>>>>>>>>>>>> 053_production_hardening.sql <<<<<<<<<<<<<<<<<<<<
-- ============================================================
-- 053_production_hardening.sql
--
-- Security & performance hardening across 049–052:
--   1. Revoke anon & authenticated EXECUTE on SECURITY DEFINER
--      `record_growth_link_click` and verify account ownership.
--   2. Add `SET search_path = public` + explicit REVOKE from
--      PUBLIC/anon on `get_dashboard_metrics_fast` and
--      `get_conversations_series_fast`.
--   3. Add FK constraint on `contacts.growth_link_id` (ON DELETE SET NULL).
--   4. Drop redundant duplicate indexes added in 050.
--
-- Idempotent — safe to re-run.
-- ============================================================

-- 1. Harden record_growth_link_click (service_role only + ownership check)
CREATE OR REPLACE FUNCTION record_growth_link_click(
  p_link_id UUID,
  p_account_id UUID,
  p_visitor_hash TEXT,
  p_referrer TEXT DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seen BOOLEAN;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM growth_links
    WHERE id = p_link_id
      AND account_id = p_account_id
      AND is_active = TRUE
  ) THEN
    RETURN FALSE;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM growth_link_clicks
    WHERE link_id = p_link_id
      AND visitor_hash = p_visitor_hash
      AND created_at >= NOW() - INTERVAL '24 hours'
  ) INTO v_seen;

  INSERT INTO growth_link_clicks (link_id, account_id, visitor_hash, referrer, user_agent)
  VALUES (p_link_id, p_account_id, p_visitor_hash, p_referrer, p_user_agent);

  UPDATE growth_links
  SET clicks_count = clicks_count + 1,
      unique_clicks_count = unique_clicks_count + CASE WHEN v_seen THEN 0 ELSE 1 END,
      updated_at = NOW()
  WHERE id = p_link_id;

  RETURN NOT v_seen;
END;
$$;

REVOKE ALL ON FUNCTION record_growth_link_click(UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_growth_link_click(UUID, UUID, TEXT, TEXT, TEXT) TO service_role;

-- 2. Harden dashboard fast RPCs with explicit search_path and REVOKE from anon
CREATE OR REPLACE FUNCTION get_dashboard_metrics_fast(
  p_today_start TIMESTAMPTZ,
  p_yesterday_start TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'open_conv_cur', (SELECT COUNT(*) FROM conversations WHERE status = 'open'),
    'new_conv_today', (SELECT COUNT(*) FROM conversations WHERE status = 'open' AND created_at >= p_today_start),
    'new_conv_yesterday', (SELECT COUNT(*) FROM conversations WHERE status = 'open' AND created_at >= p_yesterday_start AND created_at < p_today_start),
    'new_contacts_today', (SELECT COUNT(*) FROM contacts WHERE created_at >= p_today_start),
    'new_contacts_yesterday', (SELECT COUNT(*) FROM contacts WHERE created_at >= p_yesterday_start AND created_at < p_today_start),
    'open_deals_value', COALESCE((SELECT SUM(COALESCE(value, 0)) FROM deals WHERE status = 'open'), 0),
    'open_deals_count', (SELECT COUNT(*) FROM deals WHERE status = 'open'),
    'messages_today', (SELECT COUNT(*) FROM messages WHERE sender_type = 'agent' AND created_at >= p_today_start),
    'messages_yesterday', (SELECT COUNT(*) FROM messages WHERE sender_type = 'agent' AND created_at >= p_yesterday_start AND created_at < p_today_start)
  );
$$;

REVOKE ALL ON FUNCTION get_dashboard_metrics_fast(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_dashboard_metrics_fast(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

CREATE OR REPLACE FUNCTION get_conversations_series_fast(
  p_start TIMESTAMPTZ,
  p_tz TEXT DEFAULT 'UTC'
) RETURNS TABLE (
  day TEXT,
  incoming BIGINT,
  outgoing BIGINT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    to_char(created_at AT TIME ZONE COALESCE(NULLIF(p_tz, ''), 'UTC'), 'YYYY-MM-DD') AS day,
    COUNT(*) FILTER (WHERE sender_type = 'customer') AS incoming,
    COUNT(*) FILTER (WHERE sender_type <> 'customer') AS outgoing
  FROM messages
  WHERE created_at >= p_start
  GROUP BY 1
  ORDER BY 1 ASC;
$$;

REVOKE ALL ON FUNCTION get_conversations_series_fast(TIMESTAMPTZ, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_conversations_series_fast(TIMESTAMPTZ, TEXT) TO authenticated;

-- 3. Add FK constraint for contacts.growth_link_id if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contacts_growth_link_id_fkey'
      AND conrelid = 'public.contacts'::regclass
  ) THEN
    ALTER TABLE public.contacts
      ADD CONSTRAINT contacts_growth_link_id_fkey
      FOREIGN KEY (growth_link_id) REFERENCES public.growth_links(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 4. Drop duplicate indexes superseded by earlier migrations (001 & 006)
DROP INDEX IF EXISTS idx_messages_wa_message_id;
DROP INDEX IF EXISTS idx_automation_pending_due_fast;

