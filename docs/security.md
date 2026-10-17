[Back to README](../README.md)

# Security model

How Open Brain keeps your notes yours. To report a vulnerability, see [`SECURITY.md`](../SECURITY.md).

Open Brain runs entirely in your own Supabase project. Nothing is shared with other users; the model is "one owner, several tools".

## Who can do what

| Role | Who uses it | Access |
| ---- | ----------- | ------ |
| `anon` | The public key shipped in the dashboard bundle | Login and auth only. No table, view or function access (migration 016). |
| `authenticated` | The owner's dashboard session | Read what the dashboard shows, and resolve a contradiction. Only for accounts listed in `public.owners` (migrations 017, 018). |
| `service_role` | CLI, MCP server, edge functions, the dashboard's server actions | Full access. Keep this key server-side. |

## Keys

Supabase issues two kinds of server keys:

- The **legacy `service_role` JWT** (`eyJ...`, Settings > API). This is the one Open Brain uses everywhere ("the service-role key" in these docs).
- The newer **`sb_secret_...`** key. It is not a JWT, so the functions' gateway check (`verify_jwt`) rejects it with `401`. Do not use it for `BRAIN_SERVICE_KEY`, the MCP server's `SUPABASE_SERVICE_ROLE_KEY`, the dashboard's `SUPABASE_SERVICE_ROLE_KEY`, or the Vault secret behind pg_cron.

The anon key is embedded in the dashboard and is public by design. It cannot read or write data. Treat the service-role key like a password: never put it in a `NEXT_PUBLIC_*` variable, never commit it.

## Database lockdown, migration by migration

All three migrations are idempotent (safe to re-run). Check them with the [verify scripts](#the-verify-scripts).

**016, anon lockdown.** Drops the policies and privileges that applied to `anon`/`PUBLIC`, makes the views run with the caller's rights (`security_invoker`) and revokes `EXECUTE` on the RPCs from `anon`. After it, `curl` with the anon key against PostgREST returns `401` or `42501` instead of data.

**017, owner scope.** Adds `public.owners` (RLS on, no policies, no API access). Every policy for `authenticated` now also requires the caller's id to be in that table, so another account that somehow got a session sees no rows and cannot change any.

- *Bootstrap.* The migration seeds `public.owners` with the user in `auth.users` only when there is exactly one. With zero or several it seeds nothing and prints a notice; until you add an owner the dashboard shows no data.
- *Add or remove an owner.* In the SQL editor: `insert into public.owners (user_id) values ('<your-user-id>');` and `delete from public.owners where user_id = '<user-id>';`. Find the id under Authentication > Users. Users deleted from Supabase Auth leave the list automatically.

**018, narrower grants.** `authenticated` keeps `SELECT` where the dashboard reads, plus `UPDATE` of `contradictions.status` and `resolved_at` (the resolve button), and nothing else: no inserts or deletes, no access to `tasks`. The owner check moves to `private.is_owner()`, a schema the REST API does not expose, and `public.is_owner()` is dropped. The ten remaining `SECURITY DEFINER` functions pin `search_path = public, extensions, pg_temp`. `anon`, `authenticated` and `PUBLIC` lose `CREATE` on the schema `public`. Rollback steps are in the migration header.

On a hosted project, check **Project Settings > API > Exposed schemas**: `private` must not be listed (the default is `public` and `graphql_public`).

### The owner list

`OWNER_USER_IDS` (the dashboard's server-only variable) and `public.owners` should name the same account(s):

- An id only in `OWNER_USER_IDS` passes the web check, but the database returns no rows; resolving a contradiction fails with a "no row was updated" error before any audit note is saved.
- An id only in `public.owners` can browse the dashboard, but the refresh, reject and resolve buttons are refused.

## Edge functions

The dashboard actions, the CLI and the MCP server call functions that write data or spend LLM tokens. Those functions accept only the service-role key:

- `capture-thought`, `compile-wiki`, `detect-contradictions` and `run-nightly-jobs` run with `verify_jwt = true`. The gateway checks the JWT signature; the shared guard (`supabase/functions/_shared/auth.ts`) then reads the `role` claim. It accepts two credentials: a Bearer JWT whose role is `service_role`, or a Bearer value equal to the function's own `SUPABASE_SERVICE_ROLE_KEY` (the value `run-nightly-jobs` forwards to its siblings). Anon keys, user JWTs and missing credentials get `401`. `run-nightly-jobs` accepts the role-claim JWT only.
- `tasks-feed` and `slack-webhook` run with `verify_jwt = false` because their callers cannot send a Supabase JWT. They authenticate themselves instead (see below). They do not use the guard.

### `verify_jwt` matrix

Pinned in `supabase/config.toml`; the CLI uses the config value unless a flag overrides it on the command line.

| Function | `verify_jwt` | What authenticates the caller |
| -------- | ------------ | ----------------------------- |
| `capture-thought` | true | Service-role key |
| `compile-wiki` | true | Service-role key |
| `detect-contradictions` | true | Service-role key |
| `run-nightly-jobs` | true | Service-role JWT (role claim) |
| `tasks-feed` | **false** | Bearer token (`TASKS_FEED_TOKEN`, 32+ characters, constant-time compare, fail closed) |
| `slack-webhook` | **false** | Slack signature (HMAC-SHA256 with `SLACK_SIGNING_SECRET`, constant-time compare, 5-minute window) |

### The `--no-verify-jwt` footgun

**Always deploy a function by name.** `supabase functions deploy --no-verify-jwt` without a name redeploys every function with JWT verification off. The guard trusts the gateway's signature check, so a forged token would then be accepted by `capture-thought`, `compile-wiki`, `detect-contradictions` and `run-nightly-jobs`. The config already pins the right setting per function; the flag is never needed. See [`edge-functions.md`](edge-functions.md#verify_jwt).

## Dashboard

- The dashboard reads with the signed-in session; the anon key only serves the login page.
- Actions that spend tokens or write through the service-role key (wiki refresh, reject, contradiction note) check `OWNER_USER_IDS` first and fail closed: unset or empty means refused.
- Turn off sign-ups and anonymous sign-ins on the hosted project once your user exists ([`install.md`](install.md#7-set-up-the-dashboard), step 1). `supabase/config.toml` has them off for local development only.

## The verify scripts

Run both after applying migrations and after any change to grants or policies.

- [`docs/sql/verify-anon-lockdown.sql`](sql/verify-anon-lockdown.sql) is one read-only `SELECT`, one row per check, failing rows first. Every row must say `pass = true`. (Check 8 needs migration 018.)
- [`docs/sql/verify-owner-scope.sql`](sql/verify-owner-scope.sql) runs in one transaction that ends in `ROLLBACK`; it stops with an error naming the failed check, so no error means a non-owner session is denied and the owner session still works.

## Reporting

See [`SECURITY.md`](../SECURITY.md) for how to report a vulnerability.
