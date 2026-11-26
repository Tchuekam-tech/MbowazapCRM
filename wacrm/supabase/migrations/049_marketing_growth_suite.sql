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

