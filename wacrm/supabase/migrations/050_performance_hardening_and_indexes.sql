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
