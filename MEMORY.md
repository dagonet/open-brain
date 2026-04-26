# Open Brain — Project Memory

## Current State

- **Sprint 7**: Complete — Wiki layer + contradiction surfacing (T3 Standard, single PR)
- **Sprint 5/6**: Complete — Obsidian export (`brain sync-vault`) + Vercel-deployed read-only Next.js dashboard
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

## Sprint 7 Summary — Wiki layer + contradictions

Inspired by Andrej Karpathy's [LLM Wiki gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
via Nate B Jones' [Karpathy's Wiki vs Open Brain](https://www.youtube.com/watch?v=dxq7WtWxi44).

### Delivered
- Migration `005_wiki.sql` — strictly additive (`unaccent`, `pgcrypto` extensions; `slugify()`, `thoughts_by_slug()` SQL functions; `topic_counts`, `current_wiki_pages`, `wiki_page_staleness` views; `contradictions`, `wiki_pages`, `wiki_sources` tables)
- Edge functions: `compile-wiki` (cluster → contradiction-aware filter → recency-decayed ranking → structured-output LLM with citation validator + retry-once + partial=true fallback) and `detect-contradictions` (candidate scan → match_thoughts neighbours → LLM judge → idempotent insert)
- MCP server v0.3.0: 6 new tools (`wiki_get`, `wiki_list`, `wiki_refresh`, `contradictions_list`, `contradictions_resolve`, `contradictions_audit`); modular `instructions.ts` with conditional wiki-first rule; per-repo `OPEN_BRAIN_TOOLS_DISABLED` opt-out env var
- CLI subcommands: `brain audit [--since|--candidate-limit|--resolve|--decision|--note|--verbose]` and `brain wiki <get|list|refresh|reject>` with `--all`, `--dry-run`, `--top` flags
- Web dashboard: `/wiki` (list) + `/wiki/[slug]` (markdown render with inline source quotes, staleness banner, refresh + reject server actions); `/contradictions` (list with status filter chips) + `/contradictions/[id]` (side-by-side source thoughts with resolve form); attribution footer in `layout.tsx`
- Docs: README plain-English explainer + diagram update + 14-tool MCP reference; new CHANGELOG.md (Keep-a-Changelog); CONTRIBUTING.md `Inspired-by:` trailer convention

### Key Decisions
- Single PR (`feat/wiki-layer`), single migration — collapsed v2's three-sprint plan after round-3 YAGNI challenge
- No `runs` table, no `pg_cron`, no advisory lock — relied on `UNIQUE(slug, version)` collision handling and on-demand CLI invocation
- No `is_current` flag on `wiki_pages` — append-only versions; latest-by-slug exposed via `current_wiki_pages` view
- No FKs from `contradictions`/`wiki_sources` to `thoughts.id` — incompatible with soft-delete; renderer JOINs and checks `deleted_at`
- Citations as `string` + regex pattern, not `format: "uuid"` (unsupported by OpenAI Structured Outputs schema subset)
- `WIKI_TOPIC_DENYLIST` (env var) and `WIKI_DECAY_DAYS` (default 90) for tunable filtering and recency decay
- Per-repo opt-out via `OPEN_BRAIN_TOOLS_DISABLED=wiki,contradictions` in `.mcp.json` env block
- Conditional MCP rule: agents only switch to wiki-first behaviour when `wiki_list({limit:1})` returns ≥1 row — protects unrelated repos from regression

### Cross-repo follow-up (separate PR, NOT in this sprint)
- `dagonet/claude-code-toolkit` sync: each variant's `CLAUDE.md`, `CLAUDE.local.md`, skill files, and agent definitions need the new MCP tools added alongside the existing `thoughts_*` references; document the per-repo opt-out env var

### Smoke-test recipe (run before merge to main)
1. Create a Supabase preview branch from production
2. Apply `005_wiki.sql` against the preview only; confirm `\d thoughts` is byte-identical
3. `brain wiki refresh --dry-run --all --supabase-url=<preview>` — eyeball the compile/refuse split
4. Real refresh on one slug with ≥5 thoughts; verify citations resolve
5. Capture two contradictory thoughts; `brain audit --since=now-1h`; verify exactly one row in `contradictions`
6. Drop the preview; merge to main

## Future TODOs
- Remote MCP server (cloud-hosted retrieval)
- `action_items` separate table with status/due dates
- People alias lookup table
- Re-embedding runbook for model migration (`brain rebuild-embeddings` command)
- `wiki_search` MCP tool (requires re-adding the `embedding` column on `wiki_pages` + HNSW index)
- `pg_cron` automated nightly contradiction audit (only when volume justifies)
- Per-capture inline contradiction detection (after measured precision ≥ 0.7)
- Two-way Obsidian sync (`brain sync-vault --pull`)
- `dagonet/claude-code-toolkit` cross-repo sync follow-up PR
