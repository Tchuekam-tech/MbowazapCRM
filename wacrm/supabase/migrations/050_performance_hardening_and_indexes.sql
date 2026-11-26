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
