[Back to README](../README.md)

# Configuration reference

Every environment variable Open Brain reads, by component. Each component reads only its own set, from its own place: function secrets live in Supabase, the CLI reads your shell or `~/.brain/config.json`, the MCP server reads the `env` block of `.mcp.json`, the dashboard reads `web/.env.local` or the Vercel project settings.

`.env.example` at the repo root lists the same names as a starting point (copy it to `.env`). The source of truth is the code: `Deno.env.get` in `supabase/functions/`, `process.env` in `cli/`, `mcp-server/` and `web/`.

"Service-role key" always means the **legacy `service_role` JWT** (`eyJ...`), never `sb_secret_...` ([`security.md`](security.md#keys)).

## Edge function secrets

Set with `supabase secrets set NAME=value` (hosted) or `supabase functions serve --env-file` (local).

| Variable | Required | Default | Read by | Purpose |
| -------- | -------- | ------- | ------- | ------- |
| `OPENAI_API_KEY` | yes | none | capture-thought, compile-wiki, detect-contradictions | Embeddings and GPT-4o-mini calls. Without it captures are stored without embedding ([`troubleshooting.md`](troubleshooting.md)). |
| `SUPABASE_URL` | yes | injected | all functions | Project URL. Supabase injects it on hosted projects; set it if your setup does not. |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | injected | all functions | Service-role key the functions use to reach the database. |
| `NEAR_DUP_THRESHOLD` | no | `0.92` | capture-thought | Cosine similarity at or above which a recent thought counts as a near-duplicate. |
| `WIKI_COMPILE_MODEL` | no | `gpt-4o-mini` | compile-wiki | Model for wiki compilation. |
| `WIKI_DECAY_DAYS` | no | `90` | compile-wiki | Recency-decay rate in cluster ranking. |
| `WIKI_TOPIC_DENYLIST` | no | empty | compile-wiki, detect-contradictions | Comma-separated topic slugs to skip (sensitive notes). |
| `TASKS_FEED_TOKEN` | for tasks-feed | none | tasks-feed | Bearer token, at least 32 characters; shorter or unset makes the function answer `500`. |
| `SLACK_SIGNING_SECRET` | for Slack | none | slack-webhook | Verifies Slack's request signature; unset rejects every event. |
| `SLACK_BOT_TOKEN` | for Slack | none | slack-webhook | Posts the threaded reply (`xoxb-...`). |

### Nightly job knobs (run-nightly-jobs)

All optional; the defaults apply when unset.

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `NIGHTLY_CONTRADICTION_LIMIT` | 100 | Max candidate thoughts scanned per contradictions run. |
| `NIGHTLY_COMPILE_BUDGET` | 5 | Max wiki pages recompiled per stale-wiki run. |
| `MAX_LLM_CALLS_PER_JOB` | 50 | Hard budget cap per job invocation. |
| `ARCHIVE_RESOLVED_ACTION_DAYS` | 90 | Archive resolved action items older than this many days. |
| `ARCHIVE_COLD_DAYS` | 180 | Archive notes, references and questions never retrieved for this many days. |
| `CONSOLIDATE_MIN_THOUGHTS` | 3 | Minimum thoughts on a topic before it is eligible for consolidation. |
| `CONSOLIDATE_BUDGET` | 5 | Max compilations per consolidation run. |

## CLI

| Variable | Config file field | Purpose |
| -------- | ----------------- | ------- |
| `BRAIN_API_URL` | `api_url` | API base URL: `https://<project-ref>.supabase.co` (or `http://127.0.0.1:54321` locally). The older capture-function URL form still works. |
| `BRAIN_SERVICE_KEY` | `service_key` | Service-role key. Required by every command. |
| `BRAIN_API_KEY` | `api_key` | **Unused.** No command sends it; old configs may keep it. |

The environment wins over `~/.brain/config.json`, field by field. Details and URL rules: [`cli.md`](cli.md#configuration).

## MCP server

Set in the `env` block of the server entry in `.mcp.json` or `~/.claude.json`.

| Variable | Required | Purpose |
| -------- | -------- | ------- |
| `SUPABASE_URL` | yes | Project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Service-role key. |
| `OPENAI_API_KEY` | yes | Embeds search queries. |
| `OPEN_BRAIN_DEFAULT_PROJECT` | no | Default project scope when a call omits `project`. |
| `OPEN_BRAIN_TOOLS_DISABLED` | no | Comma-separated tool families to hide: `wiki`, `contradictions`, `tasks`, `entities`. |

See [`mcp.md`](mcp.md).

## Dashboard

Set in `web/.env.local` (local) or the Vercel project (Production and Preview).

| Variable | Scope | Purpose |
| -------- | ----- | ------- |
| `NEXT_PUBLIC_SUPABASE_URL` | public | Project URL. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | Anon key (login and auth only). |
| `SUPABASE_SERVICE_ROLE_KEY` | server-only | Service-role key for the refresh, reject and note actions. |
| `OWNER_USER_IDS` | server-only | Comma-separated owner user ids; unset means the actions are refused. |

See [`dashboard.md`](dashboard.md#configuration).

## Eval harness

`npm run test:eval --prefix mcp-server` (ranking quality) reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
