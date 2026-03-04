# Open Brain — Project Memory

## Current State

- **Sprint 1**: In progress — AI Memory System (T4 Complex)
- **Plan file**: `docs/plans/2026-03-04-open-brain-sprint1.md`
- **Repository**: https://github.com/DarkNite-AI/open-brain

## Sprint 1 Tasks

| # | Task | Branch | Status |
|---|------|--------|--------|
| 1 | Project Setup + DB Schema | `feature/db-schema` | pending |
| 2 | Shared Processing Core | `feature/processing-core` | pending |
| 3 | Capture Thought Edge Function | `feature/capture-endpoint` | pending |
| 4 | CLI Tool | `feature/cli-tool` | pending |
| 5 | MCP Server | `feature/mcp-server` | pending |
| 6 | Slack Webhook Edge Function | `feature/slack-webhook` | pending |
| 7 | Slack App Configuration Guide | `feature/slack-setup-guide` | pending |

## Key Decisions

- Single-user RLS (no multi-tenancy for MVP)
- OpenAI text-embedding-3-small (1536 dims) for vectors
- GPT-4o-mini for metadata extraction
- Soft delete via `deleted_at` column
- Deno for edge functions, Node.js for MCP server + CLI
