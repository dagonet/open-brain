[Back to README](../README.md)

# Upgrading Open Brain

Pick your starting point. Fresh install? See [`install.md`](install.md).

Which components ship in which release: the product is tagged as one version (the CHANGELOG heading) but the components keep their own version numbers.

| Release | mcp-server | cli | web |
| ------- | ---------- | --- | --- |
| 0.9.0 | 0.9.0 | 1.3.0 | 1.0.0 (unchanged, not published) |
| 0.8.0 | 0.8.0 | 1.2.0 | 1.0.0 |

Neither package is published to npm; "version" means what `brain --version` and the MCP `serverInfo.version` report from your checkout.

## From 0.8 to 0.9

0.9.0 locks the database down. Do the steps **in this order**; it keeps a live install working at every step. The web environment comes first, because the new dashboard code refuses the refresh, reject and resolve buttons when `OWNER_USER_IDS` is missing; without `SUPABASE_SERVICE_ROLE_KEY` it falls back to the anon key, and the edge function calls then fail with `401`. `tasks-feed` comes before the migrations, because migration 016 takes the anon key's access to `tasks` away.

What changes for you, in short: the public anon key can no longer read or write anything; the dashboard role sees data only for accounts listed in `public.owners`; `capture-thought`, `compile-wiki` and `detect-contradictions` accept only the service-role key; every `brain` command needs `BRAIN_SERVICE_KEY`. The reasons are in [`security.md`](security.md).

1. **Get the legacy service-role JWT** (Supabase dashboard > Settings > API, the `eyJ...` key). The newer `sb_secret_...` key is rejected by the gateway's JWT check on the functions above.
2. **Web environment, before any new web code arrives.** In Vercel (Production **and** Preview) and in `web/.env.local`, set the server-only `SUPABASE_SERVICE_ROLE_KEY` (the legacy JWT) and `OWNER_USER_IDS` (your Supabase auth user id; comma-separated for more than one). The 0.8 web code ignores both, so this is safe to do first. Vercel auto-deploys from `main`: if your Vercel project builds a branch you are about to update, set these variables **before** you merge or pull the new web code into it, otherwise the first deployment has the buttons refused.
3. **Update your checkout.** `git pull` (or fetch and check out the `v0.9.0` tag). Everything below runs from the new code.
4. **`tasks-feed` and `TASKS_FEED_TOKEN`** (if a local tool such as an agent dashboard read your tasks with the anon key; skip it otherwise). It works on the 0.8 database, so do it **before** `db push`: generate a token (`openssl rand -hex 32`, at least 32 characters), `supabase secrets set TASKS_FEED_TOKEN=<token>`, `supabase functions deploy tasks-feed`, and switch the tool to it ([`edge-functions.md`](edge-functions.md#tasks-feed)). Once the tool reads from `tasks-feed`, the next steps cannot cut it off.
5. **CLI.** Set `BRAIN_SERVICE_KEY` (or `"service_key"` in `~/.brain/config.json`), then rebuild: `npm ci --prefix cli && npm run build --prefix cli` (Node 22 is recommended; the build works on 18+ with `npm ci` warnings below 22.12, and the tests need 22.12+). `brain` runs the compiled `cli/dist/`, so it keeps the old code until you rebuild. `brain --version` should print `1.3.0`. Every command, including `wiki get` and `audit`, now needs the service key.
6. **Migrations.** `supabase db push` applies 016 (anon lockdown), 017 (owner scope) and 018 (narrower grants, `private.is_owner()`). All three can be re-run. If the 017 bootstrap seeded no owner (it seeds one only when `auth.users` has exactly one user; with zero or several it prints a notice), add yours: `insert into public.owners (user_id) values ('<your-user-id>');`. Rollback notes are in the migration headers, 018 in particular.
7. **Remaining edge functions, by name.** Redeploy each one with its name: `supabase functions deploy capture-thought`, and the same for `compile-wiki`, `detect-contradictions`, `run-nightly-jobs` and `slack-webhook` (`tasks-feed` is already done). **Never** run `supabase functions deploy --no-verify-jwt` without a name (it turns JWT verification off for every function). `supabase/config.toml` already pins `verify_jwt` correctly. Redeploying `capture-thought` also restores the near-duplicate hint.
8. **Run the verify scripts** in the SQL editor: `docs/sql/verify-anon-lockdown.sql` (every row `pass = true`) and `docs/sql/verify-owner-scope.sql` (no error). See [`security.md`](security.md#the-verify-scripts).
9. **Hosted Auth settings.** Turn off "Allow new users to sign up" and anonymous sign-ins (Authentication > Providers/Sign In), once your user exists. `supabase/config.toml` only covers local development.
10. **MCP server.** `npm ci --prefix mcp-server && npm run build --prefix mcp-server`, then restart Claude Code. Expect `serverInfo.version` `0.9.0` and 22 tools.
11. **Exposed schemas.** Project Settings > API: the exposed schemas must not include `private` (the default is `public` and `graphql_public`). Migration 018 keeps `is_owner()` there.

Then smoke-test the dashboard: sign in, open `/wiki/<slug>` and press "Refresh now" (needs the owner list and the service key), and resolve a test contradiction.

Things that stop working, on purpose: any local tool that read PostgREST with the anon key must use `tasks-feed` or the service key; a function call with `sb_secret_...` or the anon key gets `401`. More on symptoms: [`troubleshooting.md`](troubleshooting.md).

## Older upgrades

The sections below are kept as they were written for each release. Their commands target the version they describe. The per-release summaries (v0.3.0, v0.5.0 and later) are in [`CHANGELOG.md`](../CHANGELOG.md); its "Upgrading from v0.2.x" and "Upgrading from v0.4.x" notes point back here.

## Upgrading from v0.2.x

The v0.3.0 release adds two new edge functions, two strictly additive migrations (`005_wiki.sql`, `006_contradictions_anon_update.sql`), six new MCP tools, and the `/wiki` + `/contradictions` dashboard routes. The `thoughts` table schema is unchanged. The migrations are safe to apply to an existing project.

### Smoke-test recipe (recommended)

> Historical: this recipe was written for v0.3.0. To aim the `brain` commands below at the preview branch, set `BRAIN_API_URL` and `BRAIN_SERVICE_KEY` to the preview branch's values for the duration of the test. (The first version of the recipe passed a `--supabase-url` flag; the CLI never accepted it.)

If you have **Supabase Pro** (preview branches available), test against a throwaway preview branch first:

1. Create a preview branch from production:
   ```bash
   supabase branches create wiki-preview --persistent=false
   ```
2. Apply migration `005` and `006` against the preview branch only. Confirm `\d thoughts` in the SQL editor shows zero new columns and zero altered constraints — the migrations are additive.
3. Dry-run wiki compilation against the preview without writes:
   ```bash
   brain wiki refresh --dry-run --all
   ```
   Eyeball the `compiled / refused / errors` summary.
4. Pick a topic with ≥5 thoughts and run a real compile in preview:
   ```bash
   brain wiki refresh open-brain
   ```
   Inspect the resulting page; verify every citation resolves to a real `wiki_sources` row.
5. Capture two deliberately contradictory test thoughts in preview, then run:
   ```bash
   brain audit --since 2026-04-01    # use a date just before you captured the two test thoughts
   ```
   Verify exactly one row lands in `contradictions` with `severity ≥ 3`.
6. If all five checks pass, drop the preview branch and apply the migrations to production via `supabase db push`.

### Without Supabase Pro

The migrations are still safe — apply directly to production with the rollback SQL handy. Take a snapshot of the `thoughts` schema first (run the SQL below in the SQL editor and save the result), then `supabase db push`. Re-run the same query after; the result must be byte-identical.

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'thoughts'
ORDER BY ordinal_position;
```

**Rollback SQL** (if anything goes wrong):

```sql
DROP TABLE IF EXISTS wiki_sources;
DROP TABLE IF EXISTS wiki_pages;
DROP TABLE IF EXISTS contradictions;
DROP VIEW IF EXISTS wiki_page_staleness;
DROP VIEW IF EXISTS current_wiki_pages;
DROP VIEW IF EXISTS topic_counts;
DROP FUNCTION IF EXISTS thoughts_by_slug(text, int);
DROP FUNCTION IF EXISTS slugify(text);
-- Extensions left in place (unaccent + pgcrypto are harmless).
```

After the migrations apply, deploy the new edge functions (see [`install.md`](install.md#4-deploy-the-edge-functions)) and rebuild + restart the MCP server so it exposes the new tools.

### v0.5.0 migration backfill

Migration 008 backfills `project` from `metadata->>'project'`. After migrations, deploy the **new** edge function and rebuild:

```bash
supabase functions deploy run-nightly-jobs --use-api       # NEW in v0.5.0
supabase functions deploy capture-thought --use-api        # updated in v0.5.0
# compile-wiki and detect-contradictions are unchanged from v0.4.x
```

Verify backfill completeness:

```sql
SELECT count(*) AS pending_backfill
FROM thoughts
WHERE metadata->>'project' IS NOT NULL AND project IS NULL AND deleted_at IS NULL;
```

If non-zero, re-run: `UPDATE thoughts SET project = metadata->>'project' WHERE metadata->>'project' IS NOT NULL AND project IS NULL;`

See `docs/cron-setup.sql` for the full backfill verify query.

### v0.6.0 migration — lifecycle + tasks + nightly archive/consolidate

Migrations 012 and 013 add lifecycle tracking, archival RPCs, and the tasks table. The `match_thoughts_v2` signature changes from 10 to 11 arguments (adding `include_archived`). The `run-nightly-jobs` edge function gains two new jobs: `archive` and `consolidate`.

```bash
supabase db push                      # applies 012 + 013
supabase functions deploy run-nightly-jobs --use-api   # updated in v0.6.0
supabase functions deploy capture-thought --use-api     # updated in v0.6.0
```

After migrations, rebuild the MCP server so it exposes the 4 new task tools (19 total). For v0.7.0, rebuild again to pick up the 3 entity graph tools (22 total):

```bash
cd mcp-server && npm install && npm run build
```

See `docs/cron-setup.sql` for the two new `nightly-archive` / `nightly-consolidate` pg_cron schedules.

### v0.7.0 migration — entity graph views + RPCs

Migration 014 adds `entity_nodes` and `entity_edges` views plus `entity_search`, `entity_neighbors`, and `related_thoughts_via_entities` RPCs. Pure additive DDL — no table changes, no edge function redeploys needed.

```bash
supabase db push                      # applies 014
```

After migration, rebuild the MCP server to expose the 3 new entity graph tools (22 total):

```bash
cd mcp-server && npm install && npm run build
```

No CLI or web dashboard changes in this release. Restart Claude Code to pick up the new tools.

### v0.8.0 migration — entity noise filter + web entity view

Migration 015 adds the `is_code_path` function and updates `entity_nodes` / `entity_edges` view definitions to filter file-path and generic-token noise. Pure additive DDL — no table changes, no edge function redeploys needed.

```bash
supabase db push                      # applies 015
```

After migration, rebuild the MCP server for the 0.8.0 version (22 tools, unchanged count):

```bash
cd mcp-server && npm install && npm run build
```

The web dashboard now shows a tabbed `/graph` view with Contradictions | Entities tabs. Deploy via normal CI from `main`.
