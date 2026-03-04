# Sprint 1: Open Brain — AI Memory System

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a personal AI memory system with PostgreSQL + pgvector on Supabase, Slack + CLI capture, and local MCP server for retrieval by any AI client.

**Architecture:** Supabase (Postgres + pgvector + edge functions) as backend. Two edge functions: `slack-webhook` (Slack-specific) and `capture-thought` (clean API). Local MCP server for read-only retrieval. OpenAI text-embedding-3-small for vectors, GPT-4o-mini for metadata extraction. Single-user, RLS-secured.

**Tech Stack:** TypeScript (Deno for edge functions, Node.js for MCP server + CLI), PostgreSQL + pgvector, Supabase, OpenAI API, Slack Events API, MCP SDK

**Tier:** T4 Complex (architectural, new system, multiple components, >200 lines)

**Task source:** plan-files

**Design validated:** Two rounds of architectural challenge (see `docs/plans/2026-03-04-open-brain-design.md`)

---

## Architecture Diagram

```
Slack webhook ──> slack-webhook edge fn ──┐
                                          ├──> shared processing core ──> PostgreSQL + pgvector
CLI tool ─────> capture-thought edge fn ──┘    (embed + classify)            │
                                                                             │
Local MCP Server (4 tools) <─────────────────────────────────────────────────┘
    │
Claude Code / any MCP client
```

---

## Task 1: Project Setup + Database Schema

**Branch:** `feature/db-schema`
**Files:**
- `supabase/config.toml` (new)
- `supabase/migrations/001_create_thoughts.sql` (new)
- `.env.example` (new)
- `.gitignore` (update — add `.env`, `node_modules/`)
- `PROJECT_CONTEXT.md` (update — fill placeholders)

**Acceptance Criteria:**
- Supabase project initialized with `supabase init`
- pgvector extension enabled
- `thoughts` table created with all columns, constraints, indexes, trigger, and RLS
- `.env.example` documents all required environment variables
- `PROJECT_CONTEXT.md` has correct tech stack, commands, and paths

**Schema:**
```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE thoughts (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  idempotency_key     TEXT UNIQUE,
  raw_text            TEXT NOT NULL CHECK (length(trim(raw_text)) > 0),
  embedding           vector(1536),
  embedding_model     TEXT NOT NULL DEFAULT 'text-embedding-3-small',
  embedding_dimensions INT NOT NULL DEFAULT 1536,
  thought_type        TEXT CHECK (thought_type IN (
                        'decision', 'insight', 'meeting', 'action',
                        'reference', 'question', 'note'
                      )),
  people              TEXT[],
  topics              TEXT[],
  action_items        TEXT[],
  action_items_resolved BOOLEAN NOT NULL DEFAULT false,
  source              TEXT NOT NULL CHECK (source IN ('slack', 'cli', 'mcp')),
  processing_status   TEXT NOT NULL DEFAULT 'complete'
                        CHECK (processing_status IN ('complete', 'partial', 'failed')),
  metadata            JSONB DEFAULT '{}',
  deleted_at          TIMESTAMPTZ DEFAULT NULL,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX ON thoughts USING hnsw (embedding vector_cosine_ops);
CREATE INDEX ON thoughts (created_at DESC);
CREATE INDEX ON thoughts USING gin (people);
CREATE INDEX ON thoughts USING gin (topics);
CREATE INDEX ON thoughts (deleted_at) WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER thoughts_updated_at
  BEFORE UPDATE ON thoughts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE thoughts ENABLE ROW LEVEL SECURITY;
```

---

## Task 2: Shared Processing Core

**Branch:** `feature/processing-core`
**Files:**
- `supabase/functions/_shared/process-thought.ts` (new)
- `supabase/functions/_shared/openai.ts` (new — OpenAI client wrapper)
- `supabase/functions/_shared/types.ts` (new — shared types)

**Acceptance Criteria:**
- Validates input: rejects empty/whitespace text, enforces max 4000 chars
- Checks idempotency_key — returns existing record if duplicate
- Calls OpenAI text-embedding-3-small and GPT-4o-mini in parallel
- Post-processes metadata: validates `thought_type` (defaults to `'note'` if invalid), normalizes people names (trim), normalizes topics (lowercase + trim)
- Inserts into `thoughts` table with graceful degradation:
  - Embedding fails: `embedding=NULL`, `processing_status='failed'`
  - Metadata extraction fails: stores embedding, empty arrays, `processing_status='partial'`
- Returns inserted record
- GPT-4o-mini prompt defines exact `thought_type` vocabulary and instructs consistent full names

---

## Task 3: Capture Thought Edge Function (CLI endpoint)

**Branch:** `feature/capture-endpoint`
**Files:**
- `supabase/functions/capture-thought/index.ts` (new)

**Acceptance Criteria:**
- Accepts POST with JSON body: `{ text, source, idempotency_key?, metadata? }`
- Calls shared processing core synchronously
- Returns result with extracted metadata
- Rejects browser-origin requests (CORS restricted)
- Returns 400 for invalid input, 200 with existing record for duplicate idempotency_key
- Structured error responses (not raw exceptions)

---

## Task 4: CLI Tool

**Branch:** `feature/cli-tool`
**Files:**
- `cli/package.json` (new)
- `cli/tsconfig.json` (new)
- `cli/brain.ts` (new)
- `cli/README.md` (new — setup instructions)

**Acceptance Criteria:**
- Usage: `brain "Met with Sarah today, she's considering consulting"`
- Generates client-side UUID as idempotency_key
- POSTs to capture-thought edge function endpoint
- Displays confirmation showing: thought_type, people, topics, action_items
- Reads config from environment variables (`BRAIN_API_URL`, `BRAIN_API_KEY`) or `~/.brain/config.json`
- Handles errors gracefully (network failure, API error) with clear messages
- Can be installed globally via `npm install -g` or run with `npx`

---

## Task 5: MCP Server

**Branch:** `feature/mcp-server`
**Files:**
- `mcp-server/package.json` (new)
- `mcp-server/tsconfig.json` (new)
- `mcp-server/index.ts` (new)
- `mcp-server/tools/semantic-search.ts` (new)
- `mcp-server/tools/list-recent.ts` (new)
- `mcp-server/tools/delete-thought.ts` (new)
- `mcp-server/tools/system-status.ts` (new)
- `mcp-server/README.md` (new — setup + Claude Code config instructions)

**Acceptance Criteria:**
- Implements MCP protocol via `@modelcontextprotocol/sdk`
- Connects to Supabase via `service_role` key (env var)
- 4 tools:

| Tool | Params | Behavior |
|------|--------|----------|
| `semantic_search` | `query` (required), `limit?` (default 10), `thought_type?`, `people?`, `topics?`, `days?` | Embeds query via OpenAI, cosine similarity search, filters `WHERE deleted_at IS NULL`. On OpenAI failure: returns structured error suggesting `list_recent`. |
| `list_recent` | `days?` (default 7), `limit?` (default 20) | Pure DB query, no OpenAI. Orders by `created_at DESC`. Filters `WHERE deleted_at IS NULL`. |
| `delete_thought` | `id` (required) | Soft-delete: `UPDATE thoughts SET deleted_at = now() WHERE id = $1`. Returns confirmation or "not found". |
| `system_status` | none | Returns: total thoughts, counts by processing_status, counts by source, recent failures (last 5), embedding model info. |

- Error handling: Supabase unreachable = clear message; OpenAI unreachable = semantic_search fails with fallback suggestion, list_recent still works
- Configuration via `.env`: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`

---

## Task 6: Slack Webhook Edge Function

**Branch:** `feature/slack-webhook`
**Files:**
- `supabase/functions/slack-webhook/index.ts` (new)

**Acceptance Criteria:**
- Handles Slack `url_verification` challenge (returns `challenge` field)
- Verifies `X-Slack-Signature` header against signing secret — rejects 401 if invalid
- Extracts text from Slack event envelope (`event.type === 'message'`, `event.text`)
- Derives idempotency_key: `${event.channel}:${event.ts}`
- Returns 200 immediately, processes asynchronously (fire-and-forget pattern)
- In background: calls shared processing core, then posts confirmation reply to Slack thread via Slack API
- Ignores bot messages (prevents loops), ignores message edits/deletes
- Logs processing results via `console.log(JSON.stringify({...}))` for Supabase dashboard

---

## Task 7: Slack App Configuration Guide

**Branch:** `feature/slack-setup-guide`
**Files:**
- `docs/slack-setup.md` (new)

**Acceptance Criteria:**
- Step-by-step guide for creating a Slack app
- Covers: app creation, OAuth scopes, Events API subscription, webhook URL configuration
- Documents required Supabase secrets: `SLACK_SIGNING_SECRET`, `SLACK_BOT_TOKEN`
- Includes troubleshooting section
