[Back to README](../README.md)

# Edge functions

Six Supabase edge functions (Deno) in `supabase/functions/`. Shared code is in `_shared/` (the service-role guard, the OpenAI client and the processing core).

| Function | Purpose | Caller | `verify_jwt` |
| -------- | ------- | ------ | ------------ |
| [`capture-thought`](#capture-thought) | Embed, classify and store a thought | CLI, MCP server, dashboard | true |
| [`compile-wiki`](#compile-wiki) | Compile a topic wiki page with validated citations | CLI, MCP server, dashboard, nightly job | true |
| [`detect-contradictions`](#detect-contradictions) | Find pairs of thoughts that disagree | CLI, MCP server, nightly job | true |
| [`run-nightly-jobs`](#run-nightly-jobs) | Cron orchestrator: contradictions, stale wiki, archive, consolidate | pg_cron, you | true |
| [`tasks-feed`](#tasks-feed) | Read-only task list for local tools | a local tool with a bearer token | **false** |
| [`slack-webhook`](#slack-webhook) | Capture Slack messages | Slack | **false** |

## Deploy and secrets

Deploy each function **by name**:

```bash
supabase functions deploy capture-thought
supabase functions deploy compile-wiki
supabase functions deploy detect-contradictions
supabase functions deploy run-nightly-jobs
supabase functions deploy tasks-feed
supabase functions deploy slack-webhook
```

Set the secrets they read (all of them are listed in [`configuration.md`](configuration.md#edge-function-secrets)):

```bash
supabase secrets set OPENAI_API_KEY=sk-your-key
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided to the functions automatically on a hosted project; the `SUPABASE_` prefix is reserved, so you cannot set them as secrets.

**Windows note.** `supabase functions deploy` bundles with Docker by default. If Docker's volume mounts cannot read your project drive (common when the repo lives on a non-`C:` drive like `G:\`), the bundler fails with `entrypoint path does not exist`. Add `--use-api` to bundle server-side: `supabase functions deploy capture-thought --use-api`.

### `verify_jwt`

`supabase/config.toml` pins `verify_jwt` per function:

| Function | `verify_jwt` | Why |
| -------- | ------------ | --- |
| `capture-thought`, `compile-wiki`, `detect-contradictions`, `run-nightly-jobs` | `true` | They write data or spend tokens, and their guard trusts the gateway's signature check. |
| `tasks-feed` | `false` | Its caller has no Supabase JWT; a bearer token is the access control. |
| `slack-webhook` | `false` | Slack cannot send a Supabase JWT; the request signature is the access control. |

**NEVER deploy `capture-thought`, `compile-wiki`, `detect-contradictions` or `run-nightly-jobs` with `--no-verify-jwt`.** Their guard trusts the gateway's signature check, so a forged token would be accepted. Only `tasks-feed` and `slack-webhook` run without gateway JWT checks, and the config already sets that; the flag is never needed. A bare `supabase functions deploy --no-verify-jwt` redeploys **every** function with verification off. The CLI uses the config value unless the flag is given on the command line (flag over config; checked against v2.90.0). More: [`security.md`](security.md#the---no-verify-jwt-footgun).

## capture-thought

`POST /functions/v1/capture-thought` with `Authorization: Bearer <service-role key>` and a JSON body.

| Field | Required | Meaning |
| ----- | -------- | ------- |
| `text` | yes | The thought. |
| `source` | yes | One of `slack`, `cli`, `mcp`, `import`, `import-claude`, `import-chatgpt`. |
| `idempotency_key` | no | Same key, same thought: a repeat is reported as a duplicate. `brain import` uses a SHA-256 of `source:normalized_text`, the MCP tool `thoughts_capture` one of `mcp:normalized_text`, Slack `<channel>:<ts>`. `brain "<thought>"` sends a fresh random key on every run, so identical text is stored again; it is deduplicated only when a request is retried. |
| `project` | no | Project scope. |
| `metadata` | no | Free-form JSON stored with the thought. |

What it does for every thought, in parallel: embeds it (`text-embedding-3-small`, 1536 dimensions), classifies it with GPT-4o-mini (type, people, topics, action items, salience), and writes one-sentence descriptions for the key entities. It then checks for near-duplicates among recent thoughts (`find_near_dups`, threshold `NEAR_DUP_THRESHOLD`, default 0.92) and returns a `duplicate_candidate` when it finds one.

- `401` without the service-role key (the check runs before anything else), `405` for anything but POST, `403` for a browser-origin request, `400` for a missing `text` or `source`.
- **Without an OpenAI key** the call still returns `200` and stores the raw text, but with no embedding, type `note` and `processing_status = failed`; such a thought is not found by semantic search. Set `OPENAI_API_KEY` as a function secret.
- A partial failure (metadata extraction fails, embedding works) stores the thought with `processing_status = partial`.

## compile-wiki

Compiles one topic into a wiki page: clusters the topic's thoughts, drops those in an open contradiction, ranks them with recency decay (`WIKI_DECAY_DAYS`, default 90), and asks the model for structured output. A citation validator checks every paragraph against real source thoughts; it retries once and falls back to a `partial` page that omits unverifiable paragraphs. Pages are append-only versions; the `current_wiki_pages` view shows the latest. A topic needs at least 3 thoughts.

Request body: `slug` (a topic slug), optional `dry_run`. Service-role key required. Responses: `401` for no key, the anon key or an `sb_secret_...` key; `405` for GET; `400` for invalid JSON, a body that is not a JSON object, a missing `slug`, or a `dry_run` that is not a boolean; `200` with status `refused` (reason `cluster_too_small`) for an unknown slug. Related knobs: `WIKI_TOPIC_DENYLIST` (comma-separated slugs to skip), `WIKI_COMPILE_MODEL` (default `gpt-4o-mini`), `WIKI_DECAY_DAYS`.

## detect-contradictions

Scans candidate thoughts, fetches embedding-similar neighbours, asks the model whether each pair contradicts, and inserts rows above a confidence floor (idempotent: the same pair is stored once). Request body: optional `thought_id`, `since`, `candidate_limit`. Service-role key required. Responses: `401` for no key, the anon key or an `sb_secret_...` key; `405` for GET; `400` for a body that is invalid JSON, not a JSON object, or has a field with the wrong type (an absent, empty or whitespace-only body runs the default audit). Topics in `WIKI_TOPIC_DENYLIST` are skipped.

## run-nightly-jobs

A cron-driven orchestrator. `POST {"job": "<name>"}` runs one job; it dispatches to the sibling functions with the injected service key. It accepts the role-claim service-role JWT only. Responses: `401` for no key, the anon key or an `sb_secret_...` key; `405` for GET; `400` for invalid JSON or a missing `job`.

| Job | What it does | LLM cost |
| --- | ------------ | -------- |
| `contradictions` | Runs `detect-contradictions` over recent thoughts (up to `NIGHTLY_CONTRADICTION_LIMIT`) | yes |
| `stale-wiki` | Recompiles stale wiki pages (up to `NIGHTLY_COMPILE_BUDGET`) | yes |
| `archive` | Archives resolved action items older than `ARCHIVE_RESOLVED_ACTION_DAYS` (90) and notes, references and questions never retrieved for `ARCHIVE_COLD_DAYS` (180). Decisions and insights are never auto-archived. | none (SQL) |
| `consolidate` | Finds topics with at least `CONSOLIDATE_MIN_THOUGHTS` (3) thoughts but no wiki page and compiles up to `CONSOLIDATE_BUDGET` (5) of them | yes |

Every job is capped by `MAX_LLM_CALLS_PER_JOB` (50). The contradictions job reserves its full `NIGHTLY_CONTRADICTION_LIMIT` against that cap as a conservative over-count; actual usage may be lower. Scheduling and manual triggers: [`operations.md`](operations.md#nightly-automation).

## tasks-feed

A read-only JSON task list for a local consumer (for example an agent dashboard on your machine). Migration 016 revoked anon access to `tasks`, so such a tool can no longer read the table with the anon key. The function reads it with the service-role key on the server; the consumer needs only a token you generate, never a Supabase key.

- **Request:** `GET /functions/v1/tasks-feed` with `Authorization: Bearer <token>`. No query parameters.
- **Response:** `200` with a JSON array of `{id, project, title, status, priority, metadata, updated_at}`, newest first (`updated_at` descending, then `id`), limited to 2000 rows. Two headers say whether the list is complete: `X-Total-Count` is the exact number of matching tasks and `X-Truncated` is `true` when more tasks match than the body holds (the cut keeps the most recently updated tasks). Soft-deleted tasks and tasks with status `cancelled` are left out. Standard JSON values pass through as PostgREST returns them (very large numbers in `metadata` can lose precision on re-serialisation, as with any JavaScript client). Your project's PostgREST "max rows" setting (default 1000) can cap the result below 2000.
- **Errors:** `500` if the secret is not set or is shorter than 32 characters (checked first: the function fails closed and compares nothing, so an unauthenticated caller gets `500` rather than `401` until the secret is fixed), or if the database call fails; otherwise `401` for a missing, malformed or wrong token; `405` for anything but `GET` (checked after the token, so an unauthenticated caller sees `401`, not `405`).

The token is the only access control: it is compared in constant time against the `TASKS_FEED_TOKEN` function secret. Use at least 32 characters (`openssl rand -hex 32` gives 64), keep it out of git, and rotate it by setting a new secret and updating the consumer.

```bash
openssl rand -hex 32                              # 1. generate the token
supabase secrets set TASKS_FEED_TOKEN=<token>     # 2. store it as a function secret
supabase functions deploy tasks-feed              # 3. deploy, naming the function
```

`--no-verify-jwt` is not needed: the config pins `verify_jwt = false` for `tasks-feed`.

Check it (replace the placeholders):

```bash
# 401 without the token
curl -i https://<project-ref>.supabase.co/functions/v1/tasks-feed

# 200, a JSON array, and the X-Total-Count / X-Truncated headers with it
curl -i https://<project-ref>.supabase.co/functions/v1/tasks-feed \
  -H "Authorization: Bearer <token>"
```

If the second call also returns `401`, the gateway is still verifying JWTs: redeploy by name and confirm the `[functions.tasks-feed]` entry in `supabase/config.toml`.

## slack-webhook

Receives Slack Events API requests and captures channel messages as thoughts, replying in a thread with the classification.

Setup is in [`install.md`](install.md#8-set-up-slack-optional): a Slack app with the bot scopes `channels:history` and `chat:write` (plus `groups:history` / `im:history` for private channels and DMs), the secrets `SLACK_SIGNING_SECRET` and `SLACK_BOT_TOKEN`, the request URL `https://<project-ref>.supabase.co/functions/v1/slack-webhook`, and the `message.channels` bot event.

It calls the shared processing code directly, not `capture-thought`, so it reads `OPENAI_API_KEY` and `NEAR_DUP_THRESHOLD` itself.

Slack cannot send a Supabase JWT, so `verify_jwt = false`. The function is protected by Slack's signature instead:

- Every event request must carry a valid `X-Slack-Signature` for `X-Slack-Request-Timestamp` (HMAC-SHA256 with `SLACK_SIGNING_SECRET`, compared in constant time, rejected after 5 minutes). Anything else gets `401`; a non-POST gets `405`.
- The signature is checked first, before the body is parsed and before the `url_verification` echo. The timestamp must be digits only.
- If `SLACK_SIGNING_SECRET` is not set, all events are rejected.
- Event processing is handed to `EdgeRuntime.waitUntil` when available, and a `500` response does not echo the error.

Check it: an unsigned request must be refused.

```bash
curl -i -X POST https://<project-ref>.supabase.co/functions/v1/slack-webhook \
  -d '{"type":"url_verification"}'     # 401
```
