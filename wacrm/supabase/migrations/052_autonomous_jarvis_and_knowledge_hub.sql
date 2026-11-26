-- ============================================================
-- 052_autonomous_jarvis_and_knowledge_hub.sql
--
-- Turns MboWazapCRM into an autonomous 24/7 AI Employee ("Jarvis")
-- ready for multi-tenant SaaS distribution:
--   1. Company DNA / Profile (`jarvis_company_profiles`)
--   2. Multi-source Knowledge Hub metadata on `ai_knowledge_documents`
--      (company_bio, website URLs w/ auto-sync, uploaded business docs,
--       FAQs, product catalogs, policies)
--   3. Autonomous 24/7 Jarvis configuration & typing-simulation controls
--      (`jarvis_configs`)
--   4. Ecosystem brain cycle audit log (`jarvis_runs`)
--   5. Autonomous action queue & execution log (`jarvis_actions`)
--   6. Direct Jarvis Command Console chat history (`jarvis_chat_messages`)
--   7. Expands `notifications.type` check constraint for Jarvis alerts
--
-- Idempotent — safe to re-run. Uses native gen_random_uuid().
-- ============================================================

-- 1. Extend notifications.type constraint for Jarvis alerts & briefings
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'notifications'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%type%'
  LOOP
    EXECUTE format('ALTER TABLE public.notifications DROP CONSTRAINT %I', r.conname);
  END LOOP;

  ALTER TABLE public.notifications
    ADD CONSTRAINT notifications_type_check
    CHECK (type IN (
      'conversation_assigned',
      'jarvis_alert',
      'jarvis_briefing',
      'jarvis_approval_needed'
    ));
END $$;

-- 2. Extend ai_knowledge_documents with multi-source ingestion metadata
ALTER TABLE ai_knowledge_documents
  ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS source_url TEXT,
  ADD COLUMN IF NOT EXISTS file_name TEXT,
  ADD COLUMN IF NOT EXISTS mime_type TEXT,
  ADD COLUMN IF NOT EXISTS file_size_bytes INTEGER,
  ADD COLUMN IF NOT EXISTS sync_status TEXT NOT NULL DEFAULT 'synced',
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS last_sync_error TEXT,
  ADD COLUMN IF NOT EXISTS auto_sync_hours INTEGER,
  ADD COLUMN IF NOT EXISTS chunk_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS char_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_ai_knowledge_documents_account_source
  ON ai_knowledge_documents (account_id, source_type, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_knowledge_documents_autosync
  ON ai_knowledge_documents (source_type, last_synced_at ASC NULLS FIRST)
  WHERE source_type = 'website' AND auto_sync_hours IS NOT NULL;

-- 3. Multi-tenant Company Bio & Brand DNA (`jarvis_company_profiles`)
CREATE TABLE IF NOT EXISTS jarvis_company_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  company_name TEXT NOT NULL DEFAULT '',
  tagline TEXT NOT NULL DEFAULT '',
  industry TEXT NOT NULL DEFAULT '',
  company_bio TEXT NOT NULL DEFAULT '',
  website_url TEXT NOT NULL DEFAULT '',
  support_email TEXT NOT NULL DEFAULT '',
  support_phone TEXT NOT NULL DEFAULT '',
  business_hours TEXT NOT NULL DEFAULT '',
  timezone TEXT NOT NULL DEFAULT 'UTC',
  primary_language TEXT NOT NULL DEFAULT 'English',
  brand_voice TEXT NOT NULL DEFAULT 'consultative'
    CHECK (brand_voice IN ('professional', 'friendly', 'consultative', 'bold', 'luxury', 'custom')),
  products_services_summary TEXT NOT NULL DEFAULT '',
  pricing_summary TEXT NOT NULL DEFAULT '',
  policies_summary TEXT NOT NULL DEFAULT '',
  escalation_rules TEXT NOT NULL DEFAULT '',
  custom_instructions TEXT NOT NULL DEFAULT '',
  social_links JSONB NOT NULL DEFAULT '{}'::jsonb,
  faq_pairs JSONB NOT NULL DEFAULT '[]'::jsonb,
  kb_document_id UUID REFERENCES ai_knowledge_documents(id) ON DELETE SET NULL,
  completeness_score INTEGER NOT NULL DEFAULT 0 CHECK (completeness_score >= 0 AND completeness_score <= 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE jarvis_company_profiles ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON jarvis_company_profiles;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON jarvis_company_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP POLICY IF EXISTS "jarvis_company_profiles_select" ON jarvis_company_profiles;
CREATE POLICY "jarvis_company_profiles_select" ON jarvis_company_profiles
  FOR SELECT USING (is_account_member(account_id, 'viewer'));

DROP POLICY IF EXISTS "jarvis_company_profiles_write" ON jarvis_company_profiles;
CREATE POLICY "jarvis_company_profiles_write" ON jarvis_company_profiles
  FOR ALL USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

-- 4. Autonomous 24/7 Jarvis Config & Typing Simulation (`jarvis_configs`)
CREATE TABLE IF NOT EXISTS jarvis_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  agent_name TEXT NOT NULL DEFAULT 'Jarvis',
  agent_role TEXT NOT NULL DEFAULT '24/7 Autonomous Growth & Operations Director',
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  autonomy_mode TEXT NOT NULL DEFAULT 'copilot'
    CHECK (autonomy_mode IN ('observer', 'copilot', 'autonomous')),

  -- Granular capabilities
  can_reply_inbound BOOLEAN NOT NULL DEFAULT TRUE,
  can_followup_stale_leads BOOLEAN NOT NULL DEFAULT TRUE,
  can_manage_deals BOOLEAN NOT NULL DEFAULT TRUE,
  can_score_and_tag BOOLEAN NOT NULL DEFAULT TRUE,
  can_publish_social BOOLEAN NOT NULL DEFAULT FALSE,
  can_enroll_drips BOOLEAN NOT NULL DEFAULT TRUE,
  can_alert_team BOOLEAN NOT NULL DEFAULT TRUE,

  -- Human-like typing simulation controls
  typing_simulation_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  typing_speed_profile TEXT NOT NULL DEFAULT 'natural'
    CHECK (typing_speed_profile IN ('fast', 'natural', 'thoughtful')),
  typing_min_ms INTEGER NOT NULL DEFAULT 1200 CHECK (typing_min_ms >= 0 AND typing_min_ms <= 15000),
  typing_max_ms INTEGER NOT NULL DEFAULT 8500 CHECK (typing_max_ms >= 500 AND typing_max_ms <= 20000),

  -- Guardrails & scheduling
  cycle_interval_minutes INTEGER NOT NULL DEFAULT 15 CHECK (cycle_interval_minutes >= 5 AND cycle_interval_minutes <= 1440),
  max_autonomous_actions_per_day INTEGER NOT NULL DEFAULT 50 CHECK (max_autonomous_actions_per_day >= 1 AND max_autonomous_actions_per_day <= 500),
  max_proactive_messages_per_day INTEGER NOT NULL DEFAULT 20 CHECK (max_proactive_messages_per_day >= 0 AND max_proactive_messages_per_day <= 200),
  contact_cooldown_hours INTEGER NOT NULL DEFAULT 24 CHECK (contact_cooldown_hours >= 1 AND contact_cooldown_hours <= 336),
  quiet_hours_start TEXT NOT NULL DEFAULT '21:00',
  quiet_hours_end TEXT NOT NULL DEFAULT '08:00',
  timezone TEXT NOT NULL DEFAULT 'UTC',

  -- Latest heartbeat snapshot
  last_cycle_at TIMESTAMPTZ,
  last_cycle_status TEXT,
  last_cycle_summary TEXT,
  last_ecosystem_health_score INTEGER CHECK (last_ecosystem_health_score IS NULL OR (last_ecosystem_health_score >= 0 AND last_ecosystem_health_score <= 100)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jarvis_configs_enabled_cycle
  ON jarvis_configs (is_enabled, last_cycle_at ASC NULLS FIRST)
  WHERE is_enabled = TRUE;

ALTER TABLE jarvis_configs ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON jarvis_configs;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON jarvis_configs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP POLICY IF EXISTS "jarvis_configs_select" ON jarvis_configs;
CREATE POLICY "jarvis_configs_select" ON jarvis_configs
  FOR SELECT USING (is_account_member(account_id, 'viewer'));

DROP POLICY IF EXISTS "jarvis_configs_write" ON jarvis_configs;
CREATE POLICY "jarvis_configs_write" ON jarvis_configs
  FOR ALL USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

-- 5. Autonomous Brain Runs (`jarvis_runs`)
CREATE TABLE IF NOT EXISTS jarvis_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  trigger TEXT NOT NULL DEFAULT 'cron' CHECK (trigger IN ('cron', 'manual', 'command', 'inbound')),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  health_score INTEGER NOT NULL DEFAULT 0 CHECK (health_score >= 0 AND health_score <= 100),
  ecosystem_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  executive_summary TEXT NOT NULL DEFAULT '',
  observations JSONB NOT NULL DEFAULT '[]'::jsonb,
  actions_proposed INTEGER NOT NULL DEFAULT 0,
  actions_executed INTEGER NOT NULL DEFAULT 0,
  actions_failed INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_jarvis_runs_account_started
  ON jarvis_runs (account_id, started_at DESC);

ALTER TABLE jarvis_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "jarvis_runs_select" ON jarvis_runs;
CREATE POLICY "jarvis_runs_select" ON jarvis_runs
  FOR SELECT USING (is_account_member(account_id, 'viewer'));

DROP POLICY IF EXISTS "jarvis_runs_write" ON jarvis_runs;
CREATE POLICY "jarvis_runs_write" ON jarvis_runs
  FOR ALL USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

-- 6. Autonomous Action Queue & Audit Log (`jarvis_actions`)
CREATE TABLE IF NOT EXISTS jarvis_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  run_id UUID REFERENCES jarvis_runs(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL CHECK (action_type IN (
    'send_whatsapp_followup',
    'create_or_advance_deal',
    'tag_contact',
    'enroll_drip',
    'queue_buffer_post',
    'recompute_lead_scores',
    'create_team_alert',
    'escalate_conversation'
  )),
  status TEXT NOT NULL DEFAULT 'pending_approval' CHECK (status IN (
    'pending_approval',
    'approved',
    'executed',
    'rejected',
    'failed',
    'skipped'
  )),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('critical', 'high', 'medium', 'low')),
  title TEXT NOT NULL,
  reasoning TEXT NOT NULL DEFAULT '',
  target_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  target_conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  target_deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB,
  error_message TEXT,
  executed_at TIMESTAMPTZ,
  decided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jarvis_actions_account_created
  ON jarvis_actions (account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_jarvis_actions_account_status
  ON jarvis_actions (account_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_jarvis_actions_contact_recent
  ON jarvis_actions (account_id, target_contact_id, executed_at DESC)
  WHERE target_contact_id IS NOT NULL AND status = 'executed';

ALTER TABLE jarvis_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "jarvis_actions_select" ON jarvis_actions;
CREATE POLICY "jarvis_actions_select" ON jarvis_actions
  FOR SELECT USING (is_account_member(account_id, 'viewer'));

DROP POLICY IF EXISTS "jarvis_actions_write" ON jarvis_actions;
CREATE POLICY "jarvis_actions_write" ON jarvis_actions
  FOR ALL USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

-- 7. Jarvis Interactive Command Console Chat (`jarvis_chat_messages`)
CREATE TABLE IF NOT EXISTS jarvis_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  proposed_action_ids UUID[] NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jarvis_chat_messages_account_created
  ON jarvis_chat_messages (account_id, created_at DESC);

ALTER TABLE jarvis_chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "jarvis_chat_messages_select" ON jarvis_chat_messages;
CREATE POLICY "jarvis_chat_messages_select" ON jarvis_chat_messages
  FOR SELECT USING (is_account_member(account_id, 'viewer'));

DROP POLICY IF EXISTS "jarvis_chat_messages_write" ON jarvis_chat_messages;
CREATE POLICY "jarvis_chat_messages_write" ON jarvis_chat_messages
  FOR ALL USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));
