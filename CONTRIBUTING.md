# Contributing to Open Brain

Thanks for your interest in contributing! Here's how to get started.

## Prerequisites

- [Node.js 18+](https://nodejs.org/)
- [Supabase account](https://supabase.com/) (free tier works)
- [Supabase CLI](https://supabase.com/docs/guides/cli)
- [OpenAI API key](https://platform.openai.com/api-keys)

## Development Setup

1. Fork and clone the repository
2. Copy `.env.example` to `.env` and fill in your keys
3. Install dependencies for the component you're working on:

```bash
# MCP Server
cd mcp-server && npm install

# CLI
cd cli && npm install

# Web Dashboard
cd web && npm install
```

4. Set up your Supabase project (see README.md for full instructions)

## Running Tests

```bash
cd mcp-server && npx vitest run
```

## Making Changes

1. Create a feature branch from `main`
2. Make your changes
3. Ensure tests pass and TypeScript compiles cleanly:
   ```bash
   cd mcp-server && npx tsc --noEmit && npx vitest run
   ```
4. Commit with a clear message describing what and why
5. Open a pull request

## Pull Request Guidelines

- Keep PRs focused — one concern per PR
- Describe what changed and why in the PR description
- Ensure all tests pass
- Add tests for new functionality

## Reporting Issues

- Use [GitHub Issues](https://github.com/dagonet/open-brain/issues) for bug reports and feature requests
- Include steps to reproduce for bugs
- Check existing issues before opening a new one

## Project Structure

| Component | Path | Runtime |
|-----------|------|---------|
| CLI | `cli/` | Node.js 18+ |
| MCP Server | `mcp-server/` | Node.js 18+ |
| Edge Functions | `supabase/functions/` | Deno |
| Web Dashboard | `web/` | Next.js |
| Database | `supabase/migrations/` | PostgreSQL + pgvector |
