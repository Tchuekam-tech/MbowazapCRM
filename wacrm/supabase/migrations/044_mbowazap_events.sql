-- ============================================================
-- 044_mbowazap_events.sql — MboWazap Event Idempotency Tracking
--
-- Records every external bridge event ingested from TchuekBot.
-- Ensures that replayed batches or redelivered events are recognized
-- at the database level, preventing duplicate CRM records, repeated
-- notifications, or redundant database operations.
--
-- Idempotent — safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS mbowazap_events (
  event_id TEXT PRIMARY KEY,
  session TEXT NOT NULL,
  event_type TEXT NOT NULL,
  account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE mbowazap_events IS
  'De-duplication log of external event IDs ingested from the MboWazap bridge (TchuekBot).';

CREATE INDEX IF NOT EXISTS idx_mbowazap_events_session
  ON mbowazap_events (session);

CREATE INDEX IF NOT EXISTS idx_mbowazap_events_account
  ON mbowazap_events (account_id)
  WHERE account_id IS NOT NULL;
