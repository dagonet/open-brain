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
--   5. Replace '<YOUR_SERVICE_ROLE_KEY>' in the one-time Vault step below.
--      Use the LEGACY service_role JWT (starts with "eyJ...", from Dashboard →
--      Settings → API → Project API keys → service_role). run-nightly-jobs
--      authorizes by decoding this JWT's role claim, so it MUST be a JWT — the
--      new sb_secret / sb_publishable keys will NOT work here.
--
-- Usage:
--   Run in Supabase SQL editor or via:
--     psql "$SUPABASE_DB_URL" -f docs/cron-setup.sql
--
-- To verify schedules:
--   SELECT jobname, schedule, active
--   FROM cron.job
--   WHERE jobname LIKE 'nightly-%';
--
-- To verify runs (after 03:07/04:07/05:07/06:07 UTC):
--   SELECT jobname, status, return_message, start_time
--   FROM cron.job_run_details
--   ORDER BY start_time DESC LIMIT 10;
--
-- To remove a schedule:
--   SELECT cron.unschedule('nightly-contradictions');
--   SELECT cron.unschedule('nightly-stale-wiki');
--   SELECT cron.unschedule('nightly-archive');
--   SELECT cron.unschedule('nightly-consolidate');
-- =========================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- One-time: store the service-role key in Supabase Vault.
-- (current_setting('supabase.service_role_key') does NOT exist on Supabase;
--  Vault is the supported way for cron jobs to read secrets.)
-- Skip if a secret named 'service_role_key' already exists.
SELECT vault.create_secret('<YOUR_SERVICE_ROLE_KEY>', 'service_role_key');

-- Schedule 1: contradictions audit at 03:07 UTC daily
SELECT cron.schedule(
  'nightly-contradictions',
  '7 3 * * *',
  $$
  SELECT net.http_post(
    url := 'https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/run-nightly-jobs',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
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
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{"job":"stale-wiki"}'::jsonb
  ) AS request_id;
  $$
);

-- Schedule 3: nightly auto-archival at 05:07 UTC daily
SELECT cron.schedule(
  'nightly-archive',
  '7 5 * * *',
  $$
  SELECT net.http_post(
    url := 'https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/run-nightly-jobs',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{"job":"archive"}'::jsonb
  ) AS request_id;
  $$
);

-- Schedule 4: nightly consolidation (weekly Sunday) at 06:07 UTC
SELECT cron.schedule(
  'nightly-consolidate',
  '7 6 * * 0',
  $$
  SELECT net.http_post(
    url := 'https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/run-nightly-jobs',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{"job":"consolidate"}'::jsonb
  ) AS request_id;
  $$
);
