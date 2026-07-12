-- docs/cron-setup.sql
--
-- NOT a Supabase migration (stays in docs/ for manual reference).
-- Sets up pg_cron to invoke the run-nightly-jobs edge function daily.
--
-- Prerequisites:
--   1. The run-nightly-jobs edge function must be deployed:
--        supabase functions deploy run-nightly-jobs --no-verify-jwt
--   2. pg_cron must be available (Supabase projects have it by default).
--   3. The function URL is derived from your Supabase project ref.
--
-- Usage:
--   Run this SQL in the Supabase SQL editor or via a migration:
--     psql "$SUPABASE_DB_URL" -f docs/cron-setup.sql
--
-- To verify the schedule:
--   SELECT * FROM cron.job WHERE jobname = 'run-nightly-jobs';
--
-- To remove the schedule:
--   SELECT cron.unschedule('run-nightly-jobs');
--
-- Environment variables the edge function reads:
--   OPEN_BRAIN_MONTHLY_BUDGET_USD  (default: 50)
--   OPEN_BRAIN_WARN_THRESHOLD      (default: 0.8)
-- =========================================================================

-- Ensure pg_cron extension is available
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule the edge function to run daily at 03:00 UTC.
-- The edge function URL uses your Supabase project ref from the
-- SUPABASE_URL env var (e.g. https://<ref>.supabase.co).
--
-- Replace '<YOUR_PROJECT_REF>' with your actual Supabase project ref
-- (the subdomain in your SUPABASE_URL, e.g. 'abcdefghijklm').

SELECT cron.schedule(
  'run-nightly-jobs',           -- unique job name
  '0 3 * * *',                  -- cron expression: daily at 03:00 UTC
  $$
  SELECT net.http_post(
    url := 'https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/run-nightly-jobs',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('supabase.service_role_key')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

-- =========================================================================
-- Verifying the backfill from migration 008
--
-- Migration 008 backfilled project FROM metadata->>'project'.
-- To verify all rows are populated:
--
--   SELECT count(*) AS pending_backfill
--   FROM thoughts
--   WHERE metadata->>'project' IS NOT NULL
--     AND project IS NULL
--     AND deleted_at IS NULL;
--
-- A non-zero count means the backfill needs to be re-run:
--   UPDATE thoughts SET project = metadata->>'project'
--   WHERE metadata->>'project' IS NOT NULL AND project IS NULL;
-- =========================================================================
