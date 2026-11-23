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
