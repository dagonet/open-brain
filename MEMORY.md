# Open Brain — Project Memory

## Current State

- **Sprint 1**: Complete — AI Memory System (T4 Complex)
- **Plan file**: `docs/plans/2026-03-04-open-brain-sprint1.md`
- **Repository**: https://github.com/dagonet/open-brain

## Sprint 1 Summary

### Delivered
- Database schema with pgvector, indexes, trigger, RLS
- Shared processing core (OpenAI embedding + GPT-4o-mini metadata extraction)
- Capture-thought edge function (Deno, POST API)
- CLI tool (`brain` command, zero runtime deps)
- MCP server (4 tools: semantic_search, list_recent, delete_thought, system_status)
- Slack webhook edge function (signature verification, async processing)
- Slack app setup guide

### PRs Merged
- #1: DB schema + project setup
- #2: Processing core + capture endpoint
- #3: Slack webhook + setup guide
- #4: CLI tool
- #5: MCP server

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

## Future TODOs
- Remote MCP server (cloud-hosted retrieval)
- `action_items` separate table with status/due dates
- Memory migration prompt (import from Claude/ChatGPT memories)
- Weekly review prompt
- `list_people()` / `list_topics()` MCP tools
- People alias lookup table
- Re-embedding runbook for model migration
- Web UI / dashboard
