# Contributing to Open Brain

Thanks for your interest in contributing! Here's how to get started.

## Prerequisites

- [Node.js](https://nodejs.org/) 22.12+ (the CLI build and tests need it; the dashboard needs 20.9+)
- [Supabase account](https://supabase.com/) (free tier works), or Docker and the Supabase CLI for a [local stack](#testing-against-a-local-stack)
- [Supabase CLI](https://supabase.com/docs/guides/cli)
- [OpenAI API key](https://platform.openai.com/api-keys)
- [Deno](https://deno.com/) for the edge function tests

## Development Setup

1. Fork and clone the repository
2. Copy `.env.example` to `.env` and fill in your keys
3. Install dependencies for the component you're working on:

```bash
npm ci --prefix mcp-server   # MCP server
npm ci --prefix cli          # CLI
npm ci --prefix web          # Web dashboard
```

4. Set up your Supabase project (see [`docs/install.md`](docs/install.md) for the full instructions)

Component references: [`docs/cli.md`](docs/cli.md), [`docs/mcp.md`](docs/mcp.md), [`docs/dashboard.md`](docs/dashboard.md), [`docs/edge-functions.md`](docs/edge-functions.md). How the pieces fit: [`docs/architecture.md`](docs/architecture.md).

## Running Tests

The quality gate runs everything the CI runs for the Node components: the node_modules drift check, the migration dollar-quote lint, `tsc --noEmit`, vitest, prettier and ESLint, for `cli/`, `mcp-server/` and `web/`.

```bash
cct-gate               # inside Claude Code, where it is on the PATH
bash scripts/gate.sh   # the same checks, directly
```

A single component:

```bash
npm test --prefix mcp-server
```

Edge function tests run under [Deno](https://deno.com/) (not part of the gate; CI runs them):

```bash
deno test --node-modules-dir=none --allow-env supabase/functions/handler-auth_test.ts supabase/functions/tasks-feed_test.ts supabase/functions/slack-webhook_test.ts supabase/functions/process-thought_test.ts
```

## Testing against a local stack

You can run the whole database and the edge functions on your machine with Docker and the Supabase CLI. [`docs/install.md`](docs/install.md#try-it-on-a-local-stack) has the walk-through; these are the rules for doing it safely and repeatably.

- **Local only.** Use the `supabase` CLI for `start`, `db reset`, `functions serve`, `status` and `stop`. Never `login`, `link`, `db push` or `functions deploy` from a test run: those touch a hosted project.
- **Sign-ups are disabled** in `supabase/config.toml` (as they should be on a hosted project). If a test needs sign-up, enable it in a scratch copy of the config, never in the repository. To create a user without it, use Studio or the admin API (`/auth/v1/admin/users` with the service key).
- **Keep `kong`.** Do not exclude it from `supabase start`: the edge functions and REST API are reached through it.
- **Run SQL inside the database container**, so no local `psql` is needed and errors stop the run:

  ```bash
  docker exec -i supabase_db_<project_id> psql -U postgres -v ON_ERROR_STOP=1 < docs/sql/verify-anon-lockdown.sql
  ```

  `<project_id>` is `project_id` in `supabase/config.toml`.
- **Test a commit, not your working tree.** Export a clean copy from a SHA with `git archive <sha> | tar -x -C <scratch-dir>` and run the stack from there, so uncommitted files cannot make a test pass.
- **Use a unique `project_id`** in that copy's `config.toml`, so the containers and volumes of parallel runs do not collide.
- **Delete `start.log` and `reset.log`** (and any other captured output) when you are done. They contain the local keys. Finish with `supabase stop --no-backup`.

## Making Changes

1. Create a feature branch from `main`
2. Make your changes
3. Ensure the gate passes (`cct-gate` or `bash scripts/gate.sh`), plus the Deno tests when you touched `supabase/functions/`
4. Commit with a clear message describing what and why
5. Open a pull request

### Inspiration trailers

When a change is directly inspired by an external source (a tweet, a video, a
gist, a paper), add an `Inspired-by:` trailer to the commit message and the
PR description so the lineage is preserved. Example:

```
Inspired-by: karpathy/442a6bf555914893e9891c11519de94f (gist) via Nate B Jones (youtu.be/dxq7WtWxi44)
```

This is a soft convention — there is no enforcement hook — but the v0.3.0
wiki + contradictions work follows it consistently and future ports of similar
ideas are encouraged to do the same.

## Release Process

Open Brain follows a single root `CHANGELOG.md` (Keep-a-Changelog format) as
the source of truth. None of the packages is published to npm; each is built
from a clone and **versioned independently**:

- **`mcp-server`** — bump its `package.json` version on every release that
  changes the tool surface or `instructions` string. It reports that version
  as `serverInfo.version`, and the release tag follows it.
- **`cli`** — bump its `package.json` version when new subcommands are added
  or argument behaviour changes. `brain --version` prints it.
- **`web`** is the internal Next.js dashboard — leaves its `package.json`
  version at `1.0.0` permanently.

The packages are on different version tracks (mcp-server at `0.x`, cli at
`1.x`), so they are not lock-step. Bump each on its own merit, and let the
CHANGELOG entry name the versions a release ships.

Each release lands:

1. A new `## [X.Y.Z] - YYYY-MM-DD` section in `CHANGELOG.md` with `Added`,
   `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security` subsections as
   needed.
2. An "Upgrading from <prev>" note in the release section if the change
   requires migration steps or new env vars, with the steps in
   [`docs/upgrading.md`](docs/upgrading.md).
3. The `Inspired-by:` trailer in the merge commit when applicable.

Documentation lives in `docs/`. Update the matching `docs/*.md` (and the
short stub in `cli/README.md`, `mcp-server/README.md` or `web/README.md` if
its pointer changes) in the same PR that changes the behaviour, so the
documented surface always matches the code.

## Pull Request Guidelines

- Keep PRs focused — one concern per PR
- Describe what changed and why in the PR description
- Ensure all tests pass
- Add tests for new functionality

## Reporting Issues

- Use [GitHub Issues](https://github.com/dagonet/open-brain/issues) for bug reports and feature requests
- Include steps to reproduce for bugs
- Check existing issues before opening a new one
- Report vulnerabilities privately, see [`SECURITY.md`](SECURITY.md)

## Project Structure

| Component | Path | Runtime |
|-----------|------|---------|
| CLI | `cli/` | Node.js 18+ (build: 22.12+) |
| MCP Server | `mcp-server/` | Node.js 18+ |
| Edge Functions | `supabase/functions/` | Deno |
| Web Dashboard | `web/` | Next.js 16 |
| Database | `supabase/migrations/` | PostgreSQL + pgvector |
