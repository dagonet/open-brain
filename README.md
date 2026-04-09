# Open Brain

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/dagonet/open-brain)
[![CI](https://github.com/dagonet/open-brain/actions/workflows/ci.yml/badge.svg)](https://github.com/dagonet/open-brain/actions/workflows/ci.yml)

A personal AI memory system that captures, classifies, and retrieves thoughts using semantic search. Thoughts are automatically embedded, categorized, and made searchable across multiple interfaces: CLI, MCP server (Claude Code), and Slack.

Inspired by Nate B Jones:
- [You Don't Need SaaS. The $0.10 System That Replaced My AI Workflow (45 Min No-Code Build)](https://www.youtube.com/watch?v=2JiMmye2ezg)
- [One Simple System Gave All My AI Tools a Memory. Here's How.](https://www.youtube.com/watch?v=japT66frdhM)

## How It Works

```
You (CLI / Slack / Claude Code)
  |
  v
capture-thought edge function (Supabase/Deno)
  |
  ├── OpenAI text-embedding-3-small → 1536-dim vector
  ├── GPT-4o-mini → thought_type, people, topics, action_items
  |
  v
PostgreSQL + pgvector (Supabase)
  |
  v
Retrieval (MCP server / CLI)
  ├── Semantic search (cosine similarity)
  ├── List by date, people, topics
  └── Weekly review summaries
```

Every thought you capture is:
1. **Embedded** as a 1536-dimensional vector for semantic search
2. **Classified** into a type: decision, insight, meeting, action, reference, question, or note
3. **Annotated** with extracted people, topics, and action items
4. **Deduplicated** via content-based SHA-256 idempotency keys

## Components

| Component | Runtime | Description |
|-----------|---------|-------------|
| `cli/` | Node.js 18+ | `brain` command — capture thoughts and import memories. Zero runtime dependencies. |
| `mcp-server/` | Node.js 18+ | MCP server with 8 tools for Claude Code integration |
| `supabase/functions/capture-thought/` | Deno | Edge function for thought processing and storage |
| `supabase/functions/slack-webhook/` | Deno | Slack Events API integration |
| `supabase/migrations/` | SQL | Database schema with pgvector, indexes, RLS |

## Setup

### Prerequisites

- [Node.js 18+](https://nodejs.org/)
- [Supabase account](https://supabase.com/) (free tier works)
- [Supabase CLI](https://supabase.com/docs/guides/cli) (`npm install -g supabase`)
- [OpenAI API key](https://platform.openai.com/api-keys)

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
supabase functions deploy slack-webhook  # optional, only if using Slack
```

Set the secrets for deployed functions:

```bash
supabase secrets set OPENAI_API_KEY=sk-your-key
supabase secrets set SUPABASE_URL=https://your-project.supabase.co
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
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

### 7. Set Up Slack (Optional)

See [docs/slack-setup.md](docs/slack-setup.md) for the full Slack app setup guide.

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
```

### MCP Server (Claude Code)

The MCP server exposes 8 tools that Claude Code uses automatically:

**Read tools:**
- `thoughts_search` — Find thoughts by meaning (embeds query, cosine similarity)
- `thoughts_recent` — List thoughts by date (no embedding needed)
- `thoughts_people` — All mentioned people with counts
- `thoughts_topics` — All mentioned topics with counts
- `thoughts_review` — Structured summary with counts, breakdowns, and open action items
- `system_status` — System health and configuration

**Write tools:**
- `thoughts_capture` — Save a thought (auto-classifies, extracts metadata, generates embedding)
- `thoughts_delete` — Soft-delete a thought by ID

The server includes MCP `instructions` that guide Claude Code to proactively read from and write to Open Brain during sessions.

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
- [mcp-dev-servers](https://github.com/dagonet/mcp-dev-servers) -- Five custom MCP servers (47 tools) for git, GitHub, .NET, Rust, and Ollama integration
