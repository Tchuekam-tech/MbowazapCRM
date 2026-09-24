-- ============================================================
-- 046_reply_engine_hardening.sql — lock down the 045 reply-engine
--                                   RPCs and make "Resume AI" resume
--
-- Three problems in 045, each reproduced by replaying the migrations on
-- a scratch Postgres that carries Supabase's default grants:
--
--   1. Cross-tenant and unauthenticated state tampering — the same class
--      as GHSA-fg5p-2qc3-jmxr, fixed for the knowledge RPCs in 032.
--      takeover_/resume_conversation_automation were SECURITY DEFINER
--      (they bypass RLS), filtered only on the caller-supplied id, and
--      were executable by `authenticated` AND `anon`: functions carry a
--      PUBLIC EXECUTE grant by default and Supabase's default privileges
--      add anon/authenticated, which a GRANT never narrows. Anyone with
--      the public anon key could pause or resume any tenant's bot:
--
--        POST /rest/v1/rpc/resume_conversation_automation
--          { "p_conversation_id": "<another tenant's conversation>" }
--
--      Both are now SECURITY INVOKER, so the conversations_update policy
--      (agent+ of the owning account) decides for `authenticated`, while
--      the service role (webhooks, bridge ingest) still bypasses RLS.
--
--   2. claim_ai_reply_slot_v2 — and the 029 claim_ai_reply_slot before
--      it — were meant to be service-role only (see 031) but were just
--      as callable by anon/authenticated, letting anyone burn a thread's
--      auto-reply budget. EXECUTE is now revoked from PUBLIC, anon and
--      authenticated.
--
--   3. resume_conversation_automation left ai_reply_count at the cap,
--      the handoff note in place and the resuming agent still assigned —
--      and the reply engine stands down while anyone is assigned — so
--      "Resume AI" re-enabled nothing. It now resets the count, clears
--      the note, and releases the assignment when it belongs to the
--      resuming agent (p_release_assignee), in the same UPDATE that bumps
--      automation_version.
--
-- claim_ai_reply_slot_v2 also now applies exactly the eligibility rule
-- of checkAutomationAllowed() (src/lib/ai/reply-control.ts), so the
-- atomic claim can never disagree with the gates around it.
--
-- Idempotent — safe to re-run.
-- ============================================================

-- 1. Takeover — body unchanged, now runs with the caller's privileges.
ALTER FUNCTION public.takeover_conversation_automation(UUID, TEXT, UUID, TIMESTAMPTZ)
  SECURITY INVOKER;
REVOKE EXECUTE ON FUNCTION public.takeover_conversation_automation(UUID, TEXT, UUID, TIMESTAMPTZ)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.takeover_conversation_automation(UUID, TEXT, UUID, TIMESTAMPTZ)
  TO authenticated, service_role;

-- 2. Resume. The new optional parameter and result column change the
-- signature, so the 045 version is dropped rather than overloaded (an
-- overload would make PostgREST's by-name call ambiguous). Plain SQL, so
-- the body is checked at CREATE time and the OUT columns can't shadow
-- table columns (the 42702 trap 041 fixed).
DROP FUNCTION IF EXISTS public.resume_conversation_automation(UUID);

CREATE OR REPLACE FUNCTION public.resume_conversation_automation(
  p_conversation_id UUID,
  p_release_assignee UUID DEFAULT NULL
)
RETURNS TABLE (
  new_state TEXT,
  new_version INTEGER,
  new_assigned_agent_id UUID
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  UPDATE conversations c
  SET
    automation_state = 'active',
    automation_version = c.automation_version + 1,
    ai_autoreply_disabled = false,
    ai_paused_until = NULL,
    ai_reply_count = 0,
    ai_handoff_summary = NULL,
    assigned_agent_id = CASE
      WHEN p_release_assignee IS NOT NULL
       AND c.assigned_agent_id = p_release_assignee THEN NULL
      ELSE c.assigned_agent_id
    END,
    updated_at = now()
  WHERE c.id = p_conversation_id
  RETURNING c.automation_state, c.automation_version, c.assigned_agent_id;
$$;

REVOKE EXECUTE ON FUNCTION public.resume_conversation_automation(UUID, UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resume_conversation_automation(UUID, UUID)
  TO authenticated, service_role;

-- 3. Version-checked slot claim, service role only. Eligible exactly
-- when checkAutomationAllowed() says so: nobody assigned, and either
-- automation is active here or a timed human pause has run out.
CREATE OR REPLACE FUNCTION public.claim_ai_reply_slot_v2(
  p_conversation_id UUID,
  p_max_replies INTEGER,
  p_expected_version INTEGER
)
RETURNS boolean AS $$
  WITH claimed AS (
    UPDATE conversations
    SET ai_reply_count = ai_reply_count + 1
    WHERE id = p_conversation_id
      AND ai_reply_count < p_max_replies
      AND automation_version = p_expected_version
      AND assigned_agent_id IS NULL
      AND (
        (automation_state = 'active' AND NOT ai_autoreply_disabled)
        OR (ai_paused_until IS NOT NULL AND ai_paused_until <= now())
      )
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM claimed);
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.claim_ai_reply_slot_v2(UUID, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ai_reply_slot_v2(UUID, INTEGER, INTEGER)
  TO service_role;

-- 4. The legacy claim is superseded by v2 but kept for older callers;
-- give it the service-role-only surface 031 intended.
REVOKE EXECUTE ON FUNCTION public.claim_ai_reply_slot(uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ai_reply_slot(uuid, integer)
  TO service_role;
