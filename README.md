# Open Brain

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/dagonet/open-brain)
[![CI](https://github.com/dagonet/open-brain/actions/workflows/ci.yml/badge.svg)](https://github.com/dagonet/open-brain/actions/workflows/ci.yml)

A personal AI memory system that captures, classifies, and retrieves thoughts using semantic search. Thoughts are automatically embedded, categorized, and made searchable across multiple interfaces: CLI, MCP server (Claude Code), and Slack. Since v0.3.0, Open Brain also compiles topic-level **wiki pages** with provenance-linked sources and surfaces **contradictions** in your captured notes. v0.4.0 adds **entity descriptions** (rich context for people, projects, and technologies mentioned in your thoughts) and a **contradiction graph visualization** at `/graph`.

Inspired by:
- Andrej Karpathy — [LLM Wiki gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) (the upstream "personal wiki maintained by AI" idea — 41 k bookmarks)
- Nate B Jones — [Karpathy's Wiki vs Open Brain](https://www.youtube.com/watch?v=dxq7WtWxi44) (the bridge that adapted Karpathy's idea for Open Brain and announced the wiki + contradictions improvements)
- Nate B Jones — [You Don't Need SaaS. The $0.10 System That Replaced My AI Workflow](https://www.youtube.com/watch?v=2JiMmye2ezg)
- Nate B Jones — [One Simple System Gave All My AI Tools a Memory. Here's How.](https://www.youtube.com/watch?v=japT66frdhM)

## What This Does (Plain English)

1. **You give it your scattered notes.** Capture anything useful — meeting takeaways, decisions, half-baked ideas, references — by typing one command, talking to Claude Code, or messaging a Slack bot. There's no folder or filename to think about.
2. **It tags and remembers them automatically.** Each note gets a meaning-based fingerprint and is auto-classified (decision / insight / action item / reference / note) along with the people and topics it mentions. You don't write tags by hand.
3. **You can ask it anything later.** "What did I decide about X last quarter?" — the AI finds the right notes by *meaning*, not just keyword match, and answers using your own words.
4. **NEW (v0.3.0): It writes wiki pages for you.** For any topic you've captured a few notes on, you can ask Open Brain to compile a single readable page that weaves those notes together — with every paragraph showing exactly which note it came from. The page lives in storage so future questions start from a finished study guide instead of from scratch.
5. **NEW (v0.3.0): It catches your own contradictions.** A separate scan looks for pairs of notes that disagree (e.g. an old "we picked Postgres" alongside a newer "we switched to SQLite") and surfaces them on a dashboard. You decide which one is current truth; the wiki excludes the stale one.
6. **NEW (v0.4.0): It maps your contradictions visually.** The `/graph` page shows every contradiction as a force-directed network graph. Nodes are your thoughts (colored by type, sized by how many contradictions they're involved in); edges are the contradictions (thicker = higher severity). Click any node or edge to drill in.
7. **NEW (v0.4.0): It remembers what entities mean.** During capture, a parallel LLM pass writes one-sentence descriptions for key entities (projects, technologies, people) into a searchable table so future queries know *what* "PaddleOCR" or "OmniScribe" is, not just that you mentioned it.
8. **You own all of it.** The data lives in your own Supabase project, your own files, your own dashboard. No SaaS lock-in, no vendor reading your notes.

> **Already using `claude-code-toolkit`?** Toolkit templates ship with v0.3.0 references built in (synced 2026-04-26). The new tools also accept a per-repo `OPEN_BRAIN_TOOLS_DISABLED=wiki,contradictions` env var in `.mcp.json` to silence them in workspaces where they aren't useful.

## How It Works

```
You (CLI / Slack / Claude Code)
  |
  v
capture-thought edge function (Supabase/Deno)
  |
  ├── OpenAI text-embedding-3-small → 1536-dim vector
  ├── GPT-4o-mini → thought_type, people, topics, action_items
  ├── GPT-4o-mini → entity descriptions (v0.4.0)
  |
  v
PostgreSQL + pgvector (Supabase)
  |
  ├── thoughts (vector, type, people, topics)
  ├── entity_descriptions (v0.4.0)
  ├── wiki_pages + wiki_sources
  └── contradictions
  |
  v
Retrieval (MCP server / CLI / web dashboard)
  ├── Semantic search (cosine similarity)
  ├── List by date, people, topics
  ├── Entity description lookup (v0.4.0)
  └── Weekly review summaries

  Wiki layer (v0.3.0)
  ┌──────────────────────────────────────────────────┐
  │ brain wiki refresh <slug> | brain audit          │
  │   |                            |                 │
  │   v                            v                 │
  │ compile-wiki edge fn      detect-contradictions  │
  │   |  GPT-4o-mini structured-output + validator   │
  │   v                            v                 │
  │ wiki_pages + wiki_sources    contradictions      │
  │   |                            |                 │
  │   v                            v                 │
  │ wiki_get / wiki_list      contradictions_list    │
  │ (MCP / dashboard /wiki)   (MCP / dashboard       │
  │                              /contradictions)    │
  └──────────────────────────────────────────────────┘

  Graph layer (v0.4.0)
  ┌──────────────────────────────────────────────────┐
  │ contradictions + thoughts → force-directed SVG   │
  │   |                                              │
  │   v                                              │
  │ /graph (dashboard) — nodes=thoughts,             │
  │ edges=contradictions, click to drill in          │
  └──────────────────────────────────────────────────┘
```

Every thought you capture is:
1. **Embedded** as a 1536-dimensional vector for semantic search
2. **Classified** into a type: decision, insight, meeting, action, reference, question, or note
3. **Annotated** with extracted people, topics, and action items
4. **Deduplicated** via content-based SHA-256 idempotency keys

## Components

| Component | Runtime | Description |
|-----------|---------|-------------|
| `cli/` | Node.js 18+ | `brain` command — capture thoughts, import memories, refresh wiki pages, run contradiction audits. Zero runtime dependencies. |
| `mcp-server/` | Node.js 18+ | MCP server with 14 tools (8 thoughts + 3 wiki + 3 contradictions) for Claude Code integration |
| `web/` | Next.js 15 | Authenticated dashboard with `/`, `/wiki`, `/contradictions`, `/graph` routes. Read-only via Supabase anon key; auto-deployed from `main` to Vercel. |
| `supabase/functions/capture-thought/` | Deno | Edge function for thought processing and storage |
| `supabase/functions/compile-wiki/` | Deno | (v0.3.0) Compiles a topic-level wiki page from clustered thoughts with citation validation |
| `supabase/functions/detect-contradictions/` | Deno | (v0.3.0) Audits thought pairs for contradictions via embedding-similar neighbours + LLM judge |
| `supabase/functions/slack-webhook/` | Deno | Slack Events API integration |
| `supabase/migrations/` | SQL | Database schema with pgvector, indexes, RLS |

## Setup

### Prerequisites

- [Node.js 18+](https://nodejs.org/)
- [Supabase account](https://supabase.com/) (free tier works) with **email auth provider enabled** (Authentication → Providers → Email → ON; needed by the v0.3.0 web dashboard)
- [Supabase CLI](https://github.com/supabase/cli/releases) — see install note below
- [OpenAI API key](https://platform.openai.com/api-keys)
- (Optional) Vercel account if you want the web dashboard deployed publicly; auto-deploys from `main`

> **Supabase CLI install note.** `npm install -g supabase` is **deprecated upstream** and fails on recent Node versions. Use one of the supported install paths from <https://github.com/supabase/cli#install-the-cli>:
> - **Windows:** `scoop install supabase` (preferred), or download `supabase_windows_amd64.tar.gz` from the [latest release](https://github.com/supabase/cli/releases/latest), extract `supabase.exe`, and add it to your PATH.
> - **macOS/Linux:** `brew install supabase/tap/supabase` or use the appropriate release binary.

### 1. Create Supabase Project

1. Create a new project at [supabase.com/dashboard](https://supabase.com/dashboard)
2. Note your **Project URL**, **anon key**, and **service role key** from Settings > API

### 2. Configure Environment

Copy the example and fill in your keys:

```bash
cp .env.example .env
```

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
OPENAI_API_KEY=sk-your-openai-api-key
```

### 3. Deploy Database

Link your Supabase project and push the migrations:

```bash
supabase link --project-ref your-project-ref
supabase db push
```

Then run the semantic search function in the [Supabase SQL Editor](https://supabase.com/dashboard/project/_/sql):

```sql
-- Paste contents of mcp-server/sql/match_thoughts.sql
```

### 4. Deploy Edge Functions

```bash
supabase functions deploy capture-thought
supabase functions deploy compile-wiki              # v0.3.0
supabase functions deploy detect-contradictions     # v0.3.0
supabase functions deploy slack-webhook             # optional, only if using Slack
```

> **Windows note:** `supabase functions deploy` uses Docker by default to bundle TypeScript. If Docker volume mounts can't read your project drive (common when the repo lives on a non-`C:` drive like `G:\`), the bundler fails with `entrypoint path does not exist`. Pass `--use-api` to bundle server-side instead:
>
> ```bash
> supabase functions deploy capture-thought --use-api
> ```

Set the secrets for deployed functions:

```bash
supabase secrets set OPENAI_API_KEY=sk-your-key
supabase secrets set SUPABASE_URL=https://your-project.supabase.co
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

#### Optional v0.3.0 secrets

```bash
# Recency-decay rate inside compile-wiki cluster ranking. Default 90 days.
supabase secrets set WIKI_DECAY_DAYS=90

# Comma-separated topic slugs to skip in wiki compilation and contradiction audits.
# Useful for sensitive notes you don't want compiled or audited.
supabase secrets set WIKI_TOPIC_DENYLIST=personal-health,client-acme
```

### 5. Install CLI

```bash
cd cli
npm install
npm run build
npm link
```

Configure the CLI:

```bash
# Option A: environment variables
export BRAIN_API_URL=https://your-project.supabase.co/functions/v1/capture-thought
export BRAIN_API_KEY=your-supabase-anon-key

# Option B: config file
mkdir -p ~/.brain
cat > ~/.brain/config.json << 'EOF'
{
  "apiUrl": "https://your-project.supabase.co/functions/v1/capture-thought",
  "apiKey": "your-supabase-anon-key"
}
EOF
```

### 6. Set Up MCP Server (Claude Code)

```bash
cd mcp-server
npm install
npm run build
```

Add to your Claude Code MCP configuration (`.claude/.mcp.json` or global settings):

```json
{
  "mcpServers": {
    "open-brain": {
      "command": "node",
      "args": ["path/to/mcp-server/dist/index.js"],
      "env": {
        "SUPABASE_URL": "https://your-project.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "your-service-role-key",
        "OPENAI_API_KEY": "sk-your-openai-api-key"
      }
    }
  }
}
```

### 7. Set Up Web Dashboard (v0.3.0)

The web dashboard is a Next.js app that lets you browse thoughts, wiki pages, and contradictions in a browser.

**1. Enable email auth in Supabase.** Open `https://supabase.com/dashboard/project/<your-ref>/auth/providers` → toggle **Email** to ON. For local development, also toggle **Confirm email** to OFF (skips the verification email).

**2. Create at least one user.** Open `https://supabase.com/dashboard/project/<your-ref>/auth/users` → **Add user → Create new user** → enter email + password → toggle **Auto Confirm User** ON → Create.

**3. Configure `web/.env.local`.** Copy from the example:

```bash
cd web
cp .env.local.example .env.local
```

Then edit `.env.local` and fill in:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

**4. Run locally.**

```bash
cd web
npm install
npm run dev
```

Open <http://localhost:3000>, sign in with the user you created, and browse `/`, `/wiki`, `/contradictions`.

**5. Deploy to Vercel (optional).** Connect the repo to a Vercel project; auto-deploys from `main`. Set the same two `NEXT_PUBLIC_*` env vars in **Project Settings → Environment Variables** (Production scope).

### 8. Set Up Slack (Optional)

See [docs/slack-setup.md](docs/slack-setup.md) for the full Slack app setup guide.

## Upgrading from v0.2.x

The v0.3.0 release adds two new edge functions, two strictly additive migrations (`005_wiki.sql`, `006_contradictions_anon_update.sql`), six new MCP tools, and the `/wiki` + `/contradictions` dashboard routes. The `thoughts` table schema is unchanged. The migrations are safe to apply to an existing project.

### Smoke-test recipe (recommended)

If you have **Supabase Pro** (preview branches available), test against a throwaway preview branch first:

1. Create a preview branch from production:
   ```bash
   supabase branches create wiki-preview --persistent=false
   ```
2. Apply migration `005` and `006` against the preview branch only. Confirm `\d thoughts` in the SQL editor shows zero new columns and zero altered constraints — the migrations are additive.
3. Dry-run wiki compilation against the preview without writes:
   ```bash
   brain wiki refresh --dry-run --all --supabase-url=<preview-url>
   ```
   Eyeball the `compiled / refused / errors` summary.
4. Pick a topic with ≥5 thoughts and run a real compile in preview:
   ```bash
   brain wiki refresh open-brain --supabase-url=<preview-url>
   ```
   Inspect the resulting page; verify every citation resolves to a real `wiki_sources` row.
5. Capture two deliberately contradictory test thoughts in preview, then run:
   ```bash
   brain audit --since=now-1h --supabase-url=<preview-url>
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

After the migrations apply, deploy the new edge functions (step 4 above) and rebuild + restart the MCP server so it exposes the new tools.

## Usage

### CLI

```bash
# Capture a thought
brain "We decided to use pgvector for semantic search"

# Import memories from a file (one per line)
brain import memories.txt

# Import with source tracking
brain import claude-export.txt --source import-claude
brain import chatgpt-export.txt --source import-chatgpt

# Preview without importing
brain import memories.txt --dry-run

# v0.3.0: wiki pages
brain wiki refresh open-brain                # recompile one slug
brain wiki refresh --all                     # recompile all topics with >=3 thoughts
brain wiki refresh --dry-run --all           # preview without writing
brain wiki get open-brain                    # print the current page
brain wiki list                              # list all compiled pages
brain wiki reject <page_id> --reason "..."   # log a rejection that nudges next refresh

# v0.3.0: contradictions
brain audit                                  # scan recent thoughts for contradictions
brain audit --since 2026-04-01               # only consider thoughts after a date
brain audit --resolve <id> --decision resolved
```

### MCP Server (Claude Code)

The MCP server exposes 14 tools that Claude Code uses automatically:

**Read tools (thoughts):**
- `thoughts_search` — Find thoughts by meaning (embeds query, cosine similarity)
- `thoughts_recent` — List thoughts by date (no embedding needed)
- `thoughts_people` — All mentioned people with counts
- `thoughts_topics` — All mentioned topics with counts
- `thoughts_review` — Structured summary with counts, breakdowns, and open action items
- `system_status` — System health and configuration

**Write tools (thoughts):**
- `thoughts_capture` — Save a thought (auto-classifies, extracts metadata, generates embedding)
- `thoughts_delete` — Soft-delete a thought by ID

**Wiki tools (new in v0.3.0):**
- `wiki_get` — Get the latest compiled wiki page for a topic slug; includes inline source snippets and staleness signals
- `wiki_list` — List compiled pages newest-first (use `{limit:1}` to cheaply check whether wiki content exists at all in this workspace)
- `wiki_refresh` — Recompile a topic page from current thoughts; writes a new version with citation-validated paragraphs

**Contradictions tools (new in v0.3.0):**
- `contradictions_list` — List contradictions detected between pairs of captured thoughts
- `contradictions_resolve` — Mark a contradiction as resolved / ignored / false_positive (also captures an audit thought)
- `contradictions_audit` — Trigger an on-demand audit pass

The server includes MCP `instructions` that guide Claude Code to proactively read from and write to Open Brain. The wiki rule is **conditional** on `wiki_list` returning ≥1 row, so unrelated repos don't see new behaviour until they have wiki content.

**Per-repo opt-out.** Set `OPEN_BRAIN_TOOLS_DISABLED=wiki,contradictions` in a project's `.mcp.json` env block to silence those tool families in that workspace:

```json
{
  "mcpServers": {
    "open-brain": {
      "command": "node",
      "args": ["path/to/mcp-server/dist/index.js"],
      "env": {
        "SUPABASE_URL": "https://your-project.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "your-service-role-key",
        "OPENAI_API_KEY": "sk-your-openai-api-key",
        "OPEN_BRAIN_TOOLS_DISABLED": "wiki,contradictions"
      }
    }
  }
}
```

### Web Dashboard (v0.3.0+)

Once authenticated (see Setup step 7), the following routes are available:

| Route | Purpose |
|---|---|
| `/` | Thoughts list with semantic-style filters (topic, person, type), full-text search, pagination |
| `/wiki` | Compiled topic pages, newest first; click a slug for the full page |
| `/wiki/[slug]` | Markdown page with inline source quotes, staleness banner, "Refresh now" server action, "Reject this page" form |
| `/contradictions` | List filterable by status (open / resolved / ignored / false_positive / all) |
| `/contradictions/[id]` | Side-by-side source thoughts with a resolve form (decision + optional note → captures an audit thought) |
| `/graph` | (v0.4.0) Force-directed network graph of the contradiction network. Nodes = thoughts colored by type and sized by degree; edges = contradictions weighted by severity. Click to drill in. |

A unified left sidebar shows all sections with badges (wiki page count, open-contradictions count). The bottom of the rail shows total thoughts captured plus a Sign out button.

### Slack

Send a message in a channel where the bot is invited. The bot captures the message as a thought and replies in a thread with the classification results.

## Development

```bash
# Build all components
cd cli && npx tsc && cd ../mcp-server && npx tsc

# Run tests (37 tests across 8 files)
cd mcp-server && npx vitest run

# Watch mode
cd mcp-server && npx vitest
```

## Architecture

**Database:** Single `thoughts` table in PostgreSQL with pgvector extension. HNSW index for fast approximate nearest neighbor search. GIN indexes on `people` and `topics` arrays. Soft delete via `deleted_at` column. Single-user RLS.

**Processing:** All capture paths (CLI, Slack, MCP) call the same `capture-thought` edge function, which runs embedding generation and metadata extraction in parallel via the shared `processThought()` core.

**Embedding:** OpenAI `text-embedding-3-small` produces 1536-dimensional vectors. Semantic search uses the `match_thoughts` SQL function with pgvector cosine similarity (`<=>` operator).

**Classification:** GPT-4o-mini with JSON mode extracts `thought_type`, `people`, `topics`, and `action_items` from raw text. Temperature 0 for deterministic results.

**Idempotency:** Content-based SHA-256 hashes prevent duplicate captures. The CLI uses `source:normalized_text` as the hash input; the MCP tool uses `mcp:normalized_text`.

## Related Projects

Part of an ecosystem for AI-assisted development with Claude Code:

- [claude-code-toolkit](https://github.com/dagonet/claude-code-toolkit) -- Template system for bootstrapping projects with Claude Code configuration, including pre-wired Open Brain integration
- [mcp-dev-servers](https://github.com/dagonet/mcp-dev-servers) -- Six custom MCP servers (61 tools) for git, GitHub, .NET, Rust, Ollama, and template-sync integration
