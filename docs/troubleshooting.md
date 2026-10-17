[Back to README](../README.md)

# Troubleshooting

Symptoms, causes and fixes. Each entry names the document with the details.

- [A function returns 401](#a-function-returns-401)
- [`tasks-feed` returns 401, 405 or 500](#tasks-feed-returns-401-405-or-500)
- [The dashboard shows no data, or refuses a button](#the-dashboard-shows-no-data-or-refuses-a-button)
- [A direct REST read with the anon key returns 401 or 42501](#a-direct-rest-read-with-the-anon-key-returns-401-or-42501)
- [`brain` runs old code after a pull](#brain-runs-old-code-after-a-pull)
- [The CLI tests need Node 22.12 or newer](#the-cli-tests-need-node-2212-or-newer)
- [`entrypoint path does not exist` on Windows](#entrypoint-path-does-not-exist-on-windows)
- [The near-duplicate hint never appears](#the-near-duplicate-hint-never-appears)
- [The `private` schema is exposed](#the-private-schema-is-exposed)
- [Capture without an OpenAI key](#capture-without-an-openai-key)
- [The SQL editor warns about a temporary table](#the-sql-editor-warns-about-a-temporary-table)

## A function returns 401

Applies to `capture-thought`, `compile-wiki`, `detect-contradictions` and `run-nightly-jobs`. They accept only the service-role key.

- **You sent the anon key, a user token or nothing.** All three get `401`. Send the service-role key as `Authorization: Bearer <key>`.
- **You sent an `sb_secret_...` key.** It is not a JWT, so the gateway's `verify_jwt` check rejects it. Use the **legacy `service_role` JWT** (`eyJ...`, Settings > API) in `BRAIN_SERVICE_KEY`, the MCP server's `SUPABASE_SERVICE_ROLE_KEY`, the dashboard's `SUPABASE_SERVICE_ROLE_KEY` and the Vault secret behind pg_cron. See [`security.md`](security.md#keys).
- **`verify_jwt` is off for a function that should have it on.** Someone ran `supabase functions deploy --no-verify-jwt` without a function name, which redeploys every function with verification off. Redeploy each function by name (`supabase functions deploy capture-thought`, and so on); the config pins the right values. See [`edge-functions.md`](edge-functions.md#verify_jwt).
- **The reverse:** `tasks-feed` or `slack-webhook` returns `401` for a request that should pass because the gateway is still verifying JWTs. Redeploy that function by name and confirm its `[functions.<name>]` entry with `verify_jwt = false` in `supabase/config.toml`.

## `tasks-feed` returns 401, 405 or 500

| Status | Meaning |
| ------ | ------- |
| `401` | The bearer token is missing, malformed or wrong. It is compared in constant time against the `TASKS_FEED_TOKEN` function secret. If a correct token still gets `401`, see the second bullet above. |
| `405` | The method is not `GET`. The method is checked after the token, so an unauthenticated caller always sees `401`. |
| `500` | `TASKS_FEED_TOKEN` is not set or is shorter than 32 characters (the function fails closed and compares nothing), or the database call failed. Generate a longer token with `openssl rand -hex 32` and set it with `supabase secrets set TASKS_FEED_TOKEN=<token>`. |

Contract and checks: [`edge-functions.md`](edge-functions.md#tasks-feed).

## The dashboard shows no data, or refuses a button

- **Empty dashboard.** The signed-in account is not in `public.owners`, so row-level security returns no rows. Migration 017 seeds the table only when `auth.users` holds exactly one user; on a new install the migrations usually ran before your user existed. Add yourself in the SQL editor (the id is under Authentication > Users):

  ```sql
  insert into public.owners (user_id) values ('<your-user-id>');
  ```

- **Refresh, reject or resolve buttons are refused.** `OWNER_USER_IDS` (the dashboard's server-only variable) is unset, empty, or does not include your id. It fails closed. Set it in `web/.env.local` and in Vercel for Production and Preview, then redeploy.
- **"no row was updated" when resolving a contradiction.** Your id is in `OWNER_USER_IDS` but not in `public.owners`: the web check passes, the database refuses the write. Add the id to `public.owners`.
- **Refresh or note saving fails with 401.** The dashboard's `SUPABASE_SERVICE_ROLE_KEY` is missing or is an `sb_secret_...` key. See the first entry above.
- **Login fails with "Email logins are disabled" (`422 email_provider_disabled`).** The email provider is off. On a local stack the shipped `supabase/config.toml` sets `[auth.email] enable_signup = false`: set it to `true` in your local copy (leave `[auth] enable_signup = false`), then `supabase stop` and `supabase start`. On a hosted project, switch **Email** back on under Authentication > Providers; this happens if `supabase config push` was run with the shipped config, so do not run it.

Keep the two owner lists equal: [`security.md`](security.md#the-owner-list). Setup: [`dashboard.md`](dashboard.md).

## A direct REST read with the anon key returns 401 or 42501

Expected. Since migration 016 the anon key has no access to tables, views or functions, so `curl` against `/rest/v1/thoughts` with it returns `401` or error `42501` (permission denied). That is the lockdown working; confirm with [`sql/verify-anon-lockdown.sql`](sql/verify-anon-lockdown.sql).

If a local tool used to read the `tasks` table with the anon key, switch it to [`tasks-feed`](edge-functions.md#tasks-feed) (bearer token) or give it the service key.

## `brain` runs old code after a pull

`brain` runs the compiled `cli/dist/`, so it keeps the old code until you rebuild:

```bash
npm ci --prefix cli && npm run build --prefix cli
```

The same applies to the MCP server (`npm run build` in `mcp-server/`, then restart Claude Code). Check the CLI version with `brain --version`.

## The CLI tests need Node 22.12 or newer

The CLI runs and builds on Node 18 and later, but `npm ci` warns below 22.12 and the test suite (vitest 5) needs Node 22.12 or newer. If `npm test --prefix cli` fails on an older Node, upgrade Node (the dashboard needs 20.9 or newer, so 22 covers everything). See [`cli.md`](cli.md#install-and-rebuild).

## `entrypoint path does not exist` on Windows

`supabase functions deploy` bundles with Docker by default. When Docker's volume mounts cannot read your project drive (common when the repo lives on a non-`C:` drive like `G:\`), the bundler fails with this error. Bundle server-side instead:

```bash
supabase functions deploy capture-thought --use-api
```

Still name the function. See [`edge-functions.md`](edge-functions.md#deploy-and-secrets).

## The near-duplicate hint never appears

Captures work but you never see the `Near-duplicate of ...` line in the CLI or the `duplicate_candidate` hint in Claude. The deployed `capture-thought` predates the fix that returns the hint under the declared name. Redeploy it by name:

```bash
supabase functions deploy capture-thought
```

Also check `NEAR_DUP_THRESHOLD` (default 0.92): a higher value reports fewer matches. See [`configuration.md`](configuration.md#edge-function-secrets).

## The `private` schema is exposed

Since migration 018 the owner check lives in `private.is_owner()`, in a schema the REST API must not expose. On a hosted project open **Project Settings > API > Exposed schemas**: only `public` and `graphql_public` (the defaults) should be listed. Remove `private` if it is there, then rerun [`sql/verify-anon-lockdown.sql`](sql/verify-anon-lockdown.sql). See [`security.md`](security.md#database-lockdown-migration-by-migration).

## Capture without an OpenAI key

If `capture-thought` has no `OPENAI_API_KEY` (or OpenAI is unreachable), the call still returns `200` and the text is stored. But the thought has no embedding, type `note` and `processing_status = failed`, so semantic search never finds it. `brain` and Claude show a normal confirmation, so the failure is easy to miss.

Fix: `supabase secrets set OPENAI_API_KEY=sk-...` and capture again. Failed rows can be found with `select id, raw_text from thoughts where processing_status = 'failed'`, and `system_status` (in Claude) lists recent failures. A thought stored as `partial` had its metadata extraction fail while the embedding worked. Details: [`edge-functions.md`](edge-functions.md#capture-thought).

## The SQL editor warns about a temporary table

[`sql/verify-owner-scope.sql`](sql/verify-owner-scope.sql) creates a `TEMP` table for its results, and the Supabase SQL editor warns that a table is created without row-level security. It is a session-local table that is dropped at the end of the transaction. Choose **Run without RLS** and let it run as a whole; no error afterwards means the check passed ([`security.md`](security.md#the-verify-scripts)).
