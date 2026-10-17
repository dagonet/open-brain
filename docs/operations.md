[Back to README](../README.md)

# Operations

Keeping a running Open Brain healthy: the nightly jobs, the routine upkeep you do by hand, and the checks worth repeating. Fresh installs are in [`install.md`](install.md); upgrades in [`upgrading.md`](upgrading.md).

## Nightly automation

The `run-nightly-jobs` edge function is a cron-driven orchestrator. It runs four jobs, each capped by an LLM budget, and dispatches to its sibling functions with the service key. pg_cron calls it on a schedule.

| Job | Schedule (UTC) | What it does | LLM cost |
| --- | -------------- | ------------ | -------- |
| `contradictions` | daily 03:07 | Audits recent thoughts for contradictions | yes |
| `stale-wiki` | daily 04:07 | Recompiles wiki pages that went stale | yes |
| `archive` | daily 05:07 | Archives resolved action items older than 90 days and notes, references and questions never retrieved for 180 days. Decisions and insights are never auto-archived. | none (SQL) |
| `consolidate` | Sundays 06:07 | Compiles a wiki page for high-signal topics that have none | yes |

The per-job details and the manual-trigger contract are in [`edge-functions.md`](edge-functions.md#run-nightly-jobs).

### Set it up

1. **Deploy the orchestrator**, by name: `supabase functions deploy run-nightly-jobs` (add `--use-api` on Windows, see [`edge-functions.md`](edge-functions.md#deploy-and-secrets)).
2. **Set the budget secrets** (optional; the defaults apply if you skip them):

   ```bash
   supabase secrets set NIGHTLY_CONTRADICTION_LIMIT=100
   supabase secrets set NIGHTLY_COMPILE_BUDGET=5
   supabase secrets set MAX_LLM_CALLS_PER_JOB=50
   ```

3. **Schedule it with pg_cron.** Open the [Supabase SQL Editor](https://supabase.com/dashboard/project/_/sql), paste [`cron-setup.sql`](cron-setup.sql) and replace `<YOUR_PROJECT_REF>` and `<YOUR_SERVICE_ROLE_KEY>`. The script:
   - enables `pg_cron` and `pg_net`;
   - stores the service-role key in Supabase Vault as `service_role_key` (create or update, safe to re-run);
   - creates four schedules, `nightly-contradictions`, `nightly-stale-wiki`, `nightly-archive` and `nightly-consolidate`, which call the function with the key read from Vault.

   The key must be the **legacy `service_role` JWT** (`eyJ...`), not an `sb_secret_...` key: the function authorizes by decoding the JWT's `role` claim ([`security.md`](security.md#keys)).

### Check that it runs

```sql
-- the four schedules exist and are active
SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE 'nightly-%';

-- what happened on recent runs (after 03:07, 04:07, 05:07 and 06:07 UTC)
SELECT jobname, status, return_message, start_time
FROM cron.job_run_details
ORDER BY start_time DESC LIMIT 10;
```

`cron.job_run_details` shows that the HTTP call was made. The function's own answer (what each job did) comes back in the `net.http_post` response; for a quick look, trigger a job by hand as below. To remove a schedule: `SELECT cron.unschedule('nightly-archive');` (and likewise for the other three names).

### Trigger a job by hand

```bash
curl -X POST https://<project-ref>.supabase.co/functions/v1/run-nightly-jobs \
  -H "Authorization: Bearer <service-role-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"job":"archive"}'
```

Use `"contradictions"`, `"stale-wiki"`, `"archive"` or `"consolidate"` as the job name. The `archive` job costs no LLM calls, so it is the cheapest way to prove the wiring. The key is the legacy `service_role` JWT from Settings > API.

### Budgets

Every job is capped by `MAX_LLM_CALLS_PER_JOB` (default 50), so a bad night cannot run away with your OpenAI bill. The contradictions job reserves its full `NIGHTLY_CONTRADICTION_LIMIT` against that cap as a conservative over-count, so actual usage may be lower. All knobs, with their defaults, are in [`configuration.md`](configuration.md#nightly-job-knobs-run-nightly-jobs).

## Routine upkeep

With the nightly jobs on, little is needed by hand. Without them, or to catch up after a long break:

| Task | How |
| ---- | --- |
| Recompile stale wiki pages | `brain wiki refresh --all` (top 25 topics by thought count). `--dry-run` first shows the compile/refuse split without spending tokens. |
| Look for contradictions | `brain audit`, or ask Claude to call `contradictions_audit`. |
| Decide the open ones | `brain audit --resolve <id> --decision resolved --note "..."`, `contradictions_resolve` in Claude, or the dashboard's `/contradictions` page. An open contradiction keeps both thoughts out of wiki compilation until you decide. |
| See the state of things | `system_status` (in Claude): totals, counts by status and source, recent failures. |
| Find thoughts stored without an embedding | They have `processing_status = failed`; see [`troubleshooting.md`](troubleshooting.md#capture-without-an-openai-key). |

Details of the commands: [`cli.md`](cli.md).

## Routine checks

Run the two verify scripts after applying migrations, after any change to grants or policies, and now and then as a health check. How to read them: [`security.md`](security.md#the-verify-scripts).

- [`sql/verify-anon-lockdown.sql`](sql/verify-anon-lockdown.sql): one read-only SELECT; every row must say `pass = true`.
- [`sql/verify-owner-scope.sql`](sql/verify-owner-scope.sql): rolls back everything it does; no error means pass.

Also worth a glance on a hosted project: **Project Settings > API > Exposed schemas** must not list `private`, and sign-ups and anonymous sign-ins stay off.

## Suggestions: rotation and backups

These are suggestions, not requirements of Open Brain; adapt them to your own risk.

- **Rotating `TASKS_FEED_TOKEN`.** Generate a new value (`openssl rand -hex 32`), run `supabase secrets set TASKS_FEED_TOKEN=<new>`, then update the consumer. Until both match, the consumer gets `401`.
- **Rotating the service-role key.** If the key may have leaked, reset the JWT secret in Supabase and then update every place that holds a copy: the dashboard's `SUPABASE_SERVICE_ROLE_KEY` (Vercel Production and Preview, `web/.env.local`), the CLI (`BRAIN_SERVICE_KEY` or `~/.brain/config.json`), the MCP server's `.mcp.json`, the function secret `SUPABASE_SERVICE_ROLE_KEY`, and the Vault secret behind pg_cron (re-run the Vault step of `cron-setup.sql`). Rotating the JWT secret also changes the anon key, so redeploy the dashboard.
- **Backups.** Supabase offers daily backups on paid plans (and point-in-time recovery as an add-on). On the free tier, take a copy yourself now and then with `supabase db dump -f backup.sql` (add `--data-only` for rows only), and keep it somewhere private: it contains all your notes.
