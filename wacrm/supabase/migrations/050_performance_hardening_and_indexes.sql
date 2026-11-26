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
