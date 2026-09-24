-- ============================================================
-- 045_reply_engine_control.sql — Authoritative Reply Engine Control & Concurrency State
--
-- Adds conversation-level automation state, monotonic versioning,
-- human takeover tracking, and atomic claim functions so automated
-- replies (AI and Flows) are strictly prevented from sending when a
-- human operator (Davila or agent) is handling the conversation.
--
-- Idempotent — safe to re-run.
-- ============================================================

-- 1. Conversation automation columns
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS automation_state TEXT NOT NULL DEFAULT 'active'
    CHECK (automation_state IN ('active', 'human_handling'));

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS automation_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS human_handled_at TIMESTAMPTZ;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS human_handler_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS human_handling_reason TEXT;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS ai_paused_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_conversations_automation_state
  ON conversations (account_id, automation_state);

-- 2. Atomic Human Takeover Function
-- Sets automation_state = 'human_handling', increments automation_version,
-- records the timestamp/reason, and disables AI auto-reply.
CREATE OR REPLACE FUNCTION public.takeover_conversation_automation(
  p_conversation_id UUID,
  p_reason TEXT DEFAULT 'human_takeover',
  p_handler_id UUID DEFAULT NULL,
  p_pause_until TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  new_state TEXT,
  new_version INTEGER
) AS $$
BEGIN
  RETURN QUERY
  UPDATE conversations
  SET
    automation_state = 'human_handling',
    automation_version = automation_version + 1,
    human_handled_at = now(),
    human_handler_id = COALESCE(p_handler_id, human_handler_id),
    human_handling_reason = p_reason,
    ai_autoreply_disabled = true,
    ai_paused_until = p_pause_until,
    updated_at = now()
  WHERE id = p_conversation_id
  RETURNING automation_state, automation_version;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.takeover_conversation_automation(UUID, TEXT, UUID, TIMESTAMPTZ) TO service_role, authenticated;

-- 3. Atomic Resume Automation Function
-- Re-enables automation, increments automation_version (to invalidate any stale pending runs),
-- and clears pause flags.
CREATE OR REPLACE FUNCTION public.resume_conversation_automation(
  p_conversation_id UUID
)
RETURNS TABLE (
  new_state TEXT,
  new_version INTEGER
) AS $$
BEGIN
  RETURN QUERY
  UPDATE conversations
  SET
    automation_state = 'active',
    automation_version = automation_version + 1,
    ai_autoreply_disabled = false,
    ai_paused_until = NULL,
    updated_at = now()
  WHERE id = p_conversation_id
  RETURNING automation_state, automation_version;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.resume_conversation_automation(UUID) TO service_role, authenticated;

-- 4. Version-checked AI reply slot claim
-- Only succeeds if the conversation is still active AND matches the expected automation version.
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
      AND automation_state = 'active'
      AND automation_version = p_expected_version
      AND (ai_paused_until IS NULL OR ai_paused_until <= now())
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM claimed);
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.claim_ai_reply_slot_v2(UUID, INTEGER, INTEGER) TO service_role;
