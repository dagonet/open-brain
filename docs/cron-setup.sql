-- docs/cron-setup.sql
--
-- NOT a Supabase migration (stays in docs/ for manual reference).
-- Sets up pg_cron to invoke run-nightly-jobs for contradictions and stale-wiki.
--
-- Prerequisites:
--   1. Deploy the edge function:
--        supabase functions deploy run-nightly-jobs
--   2. pg_cron must be available (available by default on Supabase)
--   3. pg_net must be available (available by default on Supabase)
--   4. Replace '<YOUR_PROJECT_REF>' with your actual project ref
--
-- Usage:
--   Run in Supabase SQL editor or via:
--     psql "$SUPABASE_DB_URL" -f docs/cron-setup.sql
--
-- To verify schedules:
--   SELECT jobname, schedule, last_run, next_run
--   FROM cron.job
--   WHERE jobname LIKE 'nightly-%';
--
-- To remove a schedule:
--   SELECT cron.unschedule('nightly-contradictions');
--   SELECT cron.unschedule('nightly-stale-wiki');
-- =========================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule 1: contradictions audit at 03:07 UTC daily
SELECT cron.schedule(
  'nightly-contradictions',
  '7 3 * * *',
  $$
  SELECT net.http_post(
    url := 'https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/run-nightly-jobs',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('supabase.service_role_key')
    ),
    body := '{"job":"contradictions"}'::jsonb
  ) AS request_id;
  $$
);

-- Schedule 2: stale wiki compilation at 04:07 UTC daily
SELECT cron.schedule(
  'nightly-stale-wiki',
  '7 4 * * *',
  $$
  SELECT net.http_post(
    url := 'https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/run-nightly-jobs',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('supabase.service_role_key')
    ),
    body := '{"job":"stale-wiki"}'::jsonb
  ) AS request_id;
  $$
);
