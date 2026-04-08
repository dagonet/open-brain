# Open Brain — Project Memory

## Current State

- **Sprint 4**: Complete — MCP Capture Tool (T2 Simple)
- **Sprint 3**: Complete — Memory Import Tool (T2 Simple)
- **Sprint 2**: Complete — Exploration & Review Tools (T2 Simple)
- **Sprint 1**: Complete — AI Memory System (T4 Complex)
- **Plan file**: `docs/plans/2026-03-04-open-brain-sprint1.md`
- **Repository**: https://github.com/dagonet/open-brain

## Sprint 1 Summary

### Delivered
- Database schema with pgvector, indexes, trigger, RLS
- Shared processing core (OpenAI embedding + GPT-4o-mini metadata extraction)
- Capture-thought edge function (Deno, POST API)
- CLI tool (`brain` command, zero runtime deps)
- MCP server (4 tools: thoughts_search, thoughts_recent, thoughts_delete, system_status)
- Slack webhook edge function (signature verification, async processing)
- Slack app setup guide

### PRs Merged
- #1: DB schema + project setup
- #2: Processing core + capture endpoint
- #3: Slack webhook + setup guide
- #4: CLI tool
- #5: MCP server
- #6: Exploration & review tools (Sprint 2)

### Key Decisions
- Single-user RLS (no multi-tenancy for MVP)
- OpenAI text-embedding-3-small (1536 dims) for vectors
- GPT-4o-mini for metadata extraction with JSON mode
- Soft delete via `deleted_at` column
- Deno for edge functions, Node.js for MCP server + CLI
- `match_thoughts` SQL function for pgvector cosine similarity search
- Zero runtime deps for CLI (Node.js 18+ built-in fetch/crypto)

### Pending Setup (user action required)
- Create Supabase account + project
- Install Supabase CLI (`npm install -g supabase`)
- Get OpenAI API key
- Run migration: `supabase db push`
- Run `match_thoughts.sql` in Supabase SQL editor
- Deploy edge functions: `supabase functions deploy`
- Configure CLI: set env vars or create `~/.brain/config.json`
- Configure MCP server in Claude Code settings
- Set up Slack app (see `docs/slack-setup.md`)

## Sprint 2 Summary

### Delivered
- 3 new MCP tools: `thoughts_people`, `thoughts_topics`, `thoughts_review`
- Vitest test infrastructure with mock helpers
- 31 unit tests covering all 7 MCP tool functions

### Key Decisions
- JS-side aggregation (Supabase JS client doesn't support `unnest()`)
- No LLM summarization in thoughts_review — returns structured data for AI client interpretation
- Vitest for test framework (ESM-native, zero config needed)

## Sprint 3 Summary

### Delivered
- DB migration extending `source` CHECK constraint with import values
- `brain import <file>` CLI subcommand for bulk memory import
- Support for `--source import-claude|import-chatgpt|import`, `--delay`, `--dry-run`
- Date prefix parsing (`[YYYY-MM-DD]`) stored as metadata
- SHA-256 idempotency keys for safe re-runs

### Key Decisions
- Sequential POST per memory (reuses existing capture-thought pipeline)
- 500ms default delay between calls (conservative for single-user)
- Idempotency key = SHA-256 of `source:normalized_text` (not random UUID)

## Sprint 4 Summary

### Delivered
- `thoughts_capture` MCP tool — first write tool for Open Brain MCP server
- MCP server `instructions` for proactive read/write behavior guidance
- Server version bumped to 0.2.0
- 6 new tests (37 total unique tests across 8 test files)

### Key Decisions
- HTTP call to edge function (not Supabase client) — intentional pattern divergence
- SHA-256 content-based idempotency key (prevents duplicate captures across sessions)
- MCP `instructions` field used instead of CLAUDE.md modifications for tool behavior guidance
- No `supabase`/`openai` params — reads env vars directly since it calls the edge function

## Future TODOs
- Remote MCP server (cloud-hosted retrieval)
- `action_items` separate table with status/due dates
- People alias lookup table
- Re-embedding runbook for model migration
- Web UI / dashboard
