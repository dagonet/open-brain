# Project Context

## Project

- **Name**: Open Brain (AI Memory)
- **Tech stack**: TypeScript, Deno (edge functions), Node.js (MCP server + CLI), PostgreSQL + pgvector, Supabase, OpenAI API, Slack Events API, MCP SDK
- **Repository**: https://github.com/DarkNite-AI/open-brain
- **Branch strategy**: `main` is protected; feature branches per task (see AGENT_TEAM.md Mode Behavior Table for naming convention)

## Commands

- **Build**: `npx tsc --noEmit` (per component: `cd cli && npx tsc --noEmit`, `cd mcp-server && npx tsc --noEmit`)
- **Test**: `npx vitest run` (per component where tests exist)
- **Format**: `npx prettier --write .`
- **Lint**: `npx eslint .`

## Paths

- **Worktree base**: `G:\git\worktrees`
- **Architecture docs**: `docs/`
- **Log location**: stdout

## Workflow Configuration

- **Task source**: `plan-files`
- **Max parallel workstreams**: 5
- **Commit convention**: `feat:`, `fix:`, `chore:`, `test:`, `docs:` prefixes
- **Issue labels** (github-issues mode only): `feature`, `bug`, `tech-debt`

## Preprocessing

- **Ollama**: available (MCP: `ollama-tools`) -- see CLAUDE.local.md for usage rules
- **Context7**: available (MCP: `context7`)
