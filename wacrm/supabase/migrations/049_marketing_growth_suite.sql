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
