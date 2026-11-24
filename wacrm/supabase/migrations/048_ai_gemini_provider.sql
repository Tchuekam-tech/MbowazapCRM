-- ============================================================
-- 048_ai_gemini_provider.sql — Allow 'gemini' in ai_configs and ai_usage_log
--
-- Extends the provider CHECK constraint on both `ai_configs` and
-- `ai_usage_log` from ('openai', 'anthropic') to
-- ('openai', 'anthropic', 'gemini').
--
-- Idempotent — safe to run multiple times.
-- ============================================================

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
      AND t.relname = 'ai_configs'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%provider%'
  LOOP
    EXECUTE format('ALTER TABLE public.ai_configs DROP CONSTRAINT %I', r.conname);
  END LOOP;

  ALTER TABLE public.ai_configs
    ADD CONSTRAINT ai_configs_provider_check
    CHECK (provider IN ('openai', 'anthropic', 'gemini'));

  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'ai_usage_log'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%provider%'
  LOOP
    EXECUTE format('ALTER TABLE public.ai_usage_log DROP CONSTRAINT %I', r.conname);
  END LOOP;

  ALTER TABLE public.ai_usage_log
    ADD CONSTRAINT ai_usage_log_provider_check
    CHECK (provider IN ('openai', 'anthropic', 'gemini'));
END $$;
