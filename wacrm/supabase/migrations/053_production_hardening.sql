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
