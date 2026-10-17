[Back to README](../README.md)

# Install Open Brain

A fresh install, start to finish. It takes about 30 minutes, most of it clicking through Supabase and Vercel.
Upgrading an existing install? Read [`upgrading.md`](upgrading.md) instead.

You end up with: a Supabase project that holds your thoughts, six edge functions, the `brain` command, the MCP server for Claude Code and (optionally) the dashboard, Slack capture and nightly maintenance.

Want to try it first without a hosted project? [Try it on a local stack](#try-it-on-a-local-stack) at the end of this page runs the same steps against Docker on your machine.

## Prerequisites

- [Node.js](https://nodejs.org/) 22 recommended. The CLI and the MCP server run on Node 18+. Building the CLI also works there, but `npm ci` warns below 22.12 and the CLI test suite (vitest 5) needs 22.12+. The dashboard (`web/`, Next.js 16) needs 20.9+ (Node 18 refuses to build it).
- A [Supabase account](https://supabase.com/) (the free tier works).
- The [Supabase CLI](https://github.com/supabase/cli/releases), see the install note below. Docker, if you deploy functions without `--use-api`.
- An [OpenAI API key](https://platform.openai.com/api-keys).
- Optional: a Vercel account for a hosted dashboard, a Slack workspace for Slack capture.

> **Supabase CLI install note.** `npm install -g supabase` is **deprecated upstream** and fails on recent Node versions. Use one of the supported install paths from <https://github.com/supabase/cli#install-the-cli>:
>
> - **Windows:** `scoop install supabase` (preferred), or download `supabase_windows_amd64.tar.gz` from the [latest release](https://github.com/supabase/cli/releases/latest), extract `supabase.exe`, and add it to your PATH.
> - **macOS/Linux:** `brew install supabase/tap/supabase` or use the appropriate release binary.

Clone the repository first; every command below runs from its root:

```bash
git clone https://github.com/dagonet/open-brain
cd open-brain
```

## 1. Create the Supabase project

1. Create a new project at [supabase.com/dashboard](https://supabase.com/dashboard).
2. Note the **Project URL**, the **anon key** and the **service role key** from Settings > API.
3. Use the **legacy `service_role` JWT** (starts with `eyJ`), not the newer `sb_secret_...` key. The edge functions that write data or spend tokens accept only the legacy JWT; the gateway rejects an `sb_secret_...` bearer with `401`. Every other page in these docs says "service-role key" and means this JWT. Why: [`security.md`](security.md#keys).

## 2. Configure the environment

```bash
cp .env.example .env
```

Fill in `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and `OPENAI_API_KEY`. Each component reads its own variables (CLI, MCP server, dashboard, functions); [`configuration.md`](configuration.md) lists them all, including the optional ones.

## 3. Deploy the database

Link your project and push the migrations (001 to 018):

```bash
supabase link --project-ref <project-ref>
supabase db push
```

Migration 008 defines the semantic search function (`match_thoughts`); there is nothing to paste into the SQL editor. `mcp-server/sql/match_thoughts.sql` is kept only as a deprecated pointer.

Migrations 016 to 018 lock the database down: the anon key can read and write nothing, the signed-in dashboard role is limited to the accounts listed in `public.owners`, and its privileges are narrowed. Step 7 below covers adding the owner. Background: [`security.md`](security.md).

## 4. Deploy the edge functions

Deploy every function **by name**:

```bash
supabase functions deploy capture-thought
supabase functions deploy compile-wiki
supabase functions deploy detect-contradictions
supabase functions deploy run-nightly-jobs
supabase functions deploy tasks-feed            # optional, step 10
supabase functions deploy slack-webhook         # optional, step 8
```

> **Never deploy without a name together with `--no-verify-jwt`.** `supabase functions deploy --no-verify-jwt` redeploys every function with JWT verification off, including the four that rely on it. `supabase/config.toml` already pins `verify_jwt` per function; the plain commands above are all you need. See [`edge-functions.md`](edge-functions.md#verify_jwt).

> **Windows note:** `supabase functions deploy` uses Docker by default to bundle TypeScript. If Docker volume mounts can't read your project drive (common when the repo lives on a non-`C:` drive like `G:\`), the bundler fails with `entrypoint path does not exist`. Pass `--use-api` to bundle server-side instead: `supabase functions deploy capture-thought --use-api`.

Set the secrets the functions read:

```bash
supabase secrets set OPENAI_API_KEY=sk-your-key
supabase secrets set SUPABASE_URL=https://<project-ref>.supabase.co
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
```

Optional secrets (wiki recency decay, topics to skip) are in [`configuration.md`](configuration.md#edge-function-secrets).

## 5. Install the CLI

```bash
npm ci --prefix cli
npm run build --prefix cli
npm install -g --install-links=false ./cli    # from the repo root (PowerShell: npm install -g --install-links=false .\cli)
```

The CLI is not published to npm. After every `git pull`, rebuild it: `npm ci --prefix cli && npm run build --prefix cli`. `brain` runs the compiled `cli/dist/`, so it keeps the old code until you do.

Configure it with environment variables or `~/.brain/config.json`:

```bash
export BRAIN_API_URL=https://<project-ref>.supabase.co
export BRAIN_SERVICE_KEY=<service-role-key>
```

```bash
mkdir -p ~/.brain
cat > ~/.brain/config.json << 'EOF'
{
  "api_url": "https://<project-ref>.supabase.co",
  "service_key": "<service-role-key>"
}
EOF
```

Every command needs the service-role key. Full reference, including URL rules: [`cli.md`](cli.md).

## 6. Set up the MCP server (Claude Code)

```bash
npm ci --prefix mcp-server
npm run build --prefix mcp-server
```

Add the server to your Claude Code MCP configuration: a project's `.mcp.json` (repo root) or `~/.claude.json`:

```json
{
  "mcpServers": {
    "open-brain": {
      "command": "node",
      "args": ["path/to/mcp-server/dist/index.js"],
      "env": {
        "SUPABASE_URL": "https://<project-ref>.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "<service-role-key>",
        "OPENAI_API_KEY": "sk-your-openai-api-key",
        "OPEN_BRAIN_DEFAULT_PROJECT": "my-repo-name"
      }
    }
  }
}
```

Restart Claude Code. It then lists 22 tools. Details and per-repo options: [`mcp.md`](mcp.md).

## 7. Set up the dashboard

The dashboard is a Next.js app in `web/`. Reference: [`dashboard.md`](dashboard.md).

**1. Enable email auth in Supabase.** Open `https://supabase.com/dashboard/project/<project-ref>/auth/providers` and toggle **Email** on. For local development, also toggle **Confirm email** off (skips the verification email). For a **hosted** project, also turn **off** "Allow new users to sign up" and anonymous sign-ins in the same Auth settings, once you have created your user in step 2: `supabase/config.toml` only covers the local stack, so this dashboard setting is required. Otherwise anyone could register and log in. **Do not run `supabase config push`**: the shipped config switches the email provider off (`[auth.email] enable_signup = false`), and pushing it to a hosted project would lock you out of the dashboard login.

**2. Create at least one user.** Open `https://supabase.com/dashboard/project/<project-ref>/auth/users`, choose **Add user > Create new user**, enter email and password, toggle **Auto Confirm User** on, and create it. On a new install the migrations (step 3) ran before this user existed, so `public.owners` is still empty and the dashboard shows no data. Right after creating the user, add it as the owner in the SQL editor (the user id is shown in the Users list):

```sql
insert into public.owners (user_id) values ('<your-user-id>');
```

**3. Configure `web/.env.local`.**

```bash
cp web/.env.local.example web/.env.local
```

Then fill it in:

```env
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
# Server-only (never prefix with NEXT_PUBLIC_):
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
OWNER_USER_IDS=<your-user-id>
```

`OWNER_USER_IDS` is required for local runs too: without it the wiki refresh, reject and contradiction-resolve buttons are refused. Keep it and `public.owners` listing the same accounts ([`security.md`](security.md#the-owner-list)).

**4. Run it locally.**

```bash
npm ci --prefix web
npm run dev --prefix web
```

Open <http://localhost:3000>, sign in with the user you created and browse `/`, `/wiki`, `/contradictions` and `/graph`.

**5. Deploy to Vercel (optional).** Connect the repo to a Vercel project; it auto-deploys from `main`. In **Project Settings > Environment Variables** set the two `NEXT_PUBLIC_*` variables plus the server-only `SUPABASE_SERVICE_ROLE_KEY` (legacy JWT, marked sensitive) and `OWNER_USER_IDS`, for both **Production** and **Preview**. Without the service-role key the refresh and note-saving actions fail; without `OWNER_USER_IDS` they are refused.

## 8. Set up Slack (optional)

The `slack-webhook` edge function receives Slack Events API requests and captures channel messages as thoughts.

1. Create a Slack app with a bot user and the bot scopes `channels:history` (read messages in public channels) and `chat:write` (post replies). Add `groups:history` for private channels and `im:history` for direct messages if you want those captured. Install it to your workspace and invite the bot to those channels.
2. Store the app's signing secret and bot token as function secrets: `supabase secrets set SLACK_SIGNING_SECRET=<secret> SLACK_BOT_TOKEN=<xoxb-token>`.
3. Deploy, naming the function: `supabase functions deploy slack-webhook`.
4. In the Slack app, enable Event Subscriptions, set the request URL to `https://<project-ref>.supabase.co/functions/v1/slack-webhook` (the function answers Slack's URL challenge) and subscribe to the `message.channels` bot event (add the matching `message.*` events for private channels or DMs).

Slack cannot send a Supabase JWT, so the function runs with `verify_jwt = false` and is protected by Slack's request signature instead: [`edge-functions.md`](edge-functions.md#slack-webhook).

## 9. Set up nightly automation (optional)

A scheduled job audits contradictions, recompiles stale wiki pages, archives old notes and consolidates topics, each with an LLM budget cap.

1. Deploy the orchestrator (step 4 already did, if you followed it).
2. Optional budget secrets; the defaults apply if you skip them:

   ```bash
   supabase secrets set NIGHTLY_CONTRADICTION_LIMIT=100
   supabase secrets set NIGHTLY_COMPILE_BUDGET=5
   supabase secrets set MAX_LLM_CALLS_PER_JOB=50
   ```

3. Schedule it with pg_cron: open the [Supabase SQL Editor](https://supabase.com/dashboard/project/_/sql), paste `docs/cron-setup.sql` and replace `<YOUR_PROJECT_REF>`; the Vault step in that file stores the service-role key.

The full walk-through, the manual triggers and the knobs are in [`operations.md`](operations.md#nightly-automation).

## 10. Expose the task list to local tools (optional)

`tasks-feed` gives a local, read-only consumer (for example an agent dashboard on your machine) the task list, behind a bearer token you generate. The consumer never gets a Supabase key.

```bash
openssl rand -hex 32                              # 1. generate the token
supabase secrets set TASKS_FEED_TOKEN=<token>     # 2. store it as a function secret
supabase functions deploy tasks-feed              # 3. deploy, naming the function
```

The contract, the checks and the error meanings are in [`edge-functions.md`](edge-functions.md#tasks-feed).

## Verify your install

1. **Database.** In the SQL editor run [`docs/sql/verify-anon-lockdown.sql`](sql/verify-anon-lockdown.sql): one SELECT, every row must say `pass = true`. Then [`docs/sql/verify-owner-scope.sql`](sql/verify-owner-scope.sql) (after the owner is in `public.owners`): it rolls back everything it does, and no error means it passed. How to read both: [`security.md`](security.md#the-verify-scripts).
2. **Capture.** `brain "install test: my first thought"` prints a confirmation block with a type, people and topics. Without an OpenAI key the thought is still stored, but with no embedding and `processing_status = failed` ([`troubleshooting.md`](troubleshooting.md)).
3. **Claude Code.** After restarting it, ask Claude to call `wiki_list` with `{limit: 1}`, or `system_status`. A reply (an empty wiki list is fine) proves the MCP server reaches your project.
4. **Dashboard.** Sign in at your dashboard URL; `/` lists your thoughts.

## Try it on a local stack

Everything above except the hosted-only parts (Vercel, Slack, hosted Auth settings, pg_cron, `supabase link`, `db push`, `functions deploy`, `secrets set`) also runs on your machine with Docker and the Supabase CLI. It is the way to try Open Brain without a hosted project, and what contributors test against ([`CONTRIBUTING.md`](../CONTRIBUTING.md#testing-against-a-local-stack)).

```bash
supabase start                      # API 54321, DB 54322, Studio 54323
supabase status -o env              # API_URL, ANON_KEY, SERVICE_ROLE_KEY (the legacy JWT form), DB_URL
supabase db reset --yes             # applies migrations 001-018 locally; stands in for `supabase db push`

# load the local keys into this shell (API_URL, ANON_KEY, SERVICE_ROLE_KEY, DB_URL)
set -a; eval "$(supabase status -o env)"; set +a
```

`supabase/config.toml` has public sign-ups off (`[auth] enable_signup = false`), as on a hosted project. It also switches the email provider off (`[auth.email] enable_signup = false`), and then nobody can sign in with a password, the dashboard login included. To use the dashboard locally, set `[auth.email] enable_signup = true` in your local copy of the file (leave `[auth] enable_signup = false`: sign-up stays closed) and run `supabase stop`, then `supabase start`. Create your user with Studio (http://127.0.0.1:54323, Authentication > Users > Add user) or the admin API:

```bash
curl -s -X POST http://127.0.0.1:54321/auth/v1/admin/users \
  -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"owner@example.com","password":"<password>","email_confirm":true}'
```

Migration 017 seeded no owner (there was no user yet), so add one and run the checks. `psql` is not needed: run them inside the database container (`supabase_db_<project_id>`; the id is `project_id` in `supabase/config.toml`):

```bash
DB=supabase_db_$(sed -n 's/^project_id *= *"\(.*\)"/\1/p' supabase/config.toml)
docker exec -i $DB psql -U postgres -v ON_ERROR_STOP=1 \
  -c "insert into public.owners (user_id) select id from auth.users"
docker exec -i $DB psql -U postgres -v ON_ERROR_STOP=1 < docs/sql/verify-anon-lockdown.sql
docker exec -i $DB psql -U postgres -v ON_ERROR_STOP=1 < docs/sql/verify-owner-scope.sql
```

Serve the functions and point the tools at the local API (`http://127.0.0.1:54321` is accepted by the CLI; plain `http` works only for loopback):

```bash
printf 'OPENAI_API_KEY=%s\nTASKS_FEED_TOKEN=%s\n' "$OPENAI_API_KEY" "$(openssl rand -hex 32)" > supabase/.env.local
supabase functions serve --env-file supabase/.env.local
BRAIN_API_URL=http://127.0.0.1:54321 BRAIN_SERVICE_KEY=$SERVICE_ROLE_KEY brain "local capture"
```

Run the MCP server and the dashboard with `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` set to `http://127.0.0.1:54321` and the local keys. Stop and delete the stack with `supabase stop --no-backup`.
