[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/dagonet/open-brain)
[![CI](https://github.com/dagonet/open-brain/actions/workflows/ci.yml/badge.svg)](https://github.com/dagonet/open-brain/actions/workflows/ci.yml)

# Open Brain

**Give every AI tool you use the same memory: capture a thought once, from the shell, Claude Code or Slack, and find it again by meaning.**

Open Brain is for people who run [Claude Code](https://docs.anthropic.com/en/docs/claude-code) on real work and want a memory they own. It runs in your own Supabase project, with no SaaS in between and nobody else reading your notes.
You need Node.js, a Supabase project (the free tier works) and an OpenAI API key.

## What you get

### Capture from anywhere

Type `brain "..."` in a shell, let Claude Code call `thoughts_capture`, or message a Slack bot. There is no folder or filename to think about. Every note is embedded, classified (decision, insight, meeting, action, reference, question or note), tagged with its people, topics and action items, and rated for how much it matters.

### Search that ranks what matters

Ask "what did I decide about X last quarter?" and the right notes come back by meaning, not keyword. Results blend relevance with recency, importance and contradiction status, so a fresh decision beats a stale note. Memory can be scoped per repo, near-duplicates are flagged so you can supersede them, and archived thoughts stay out of the way.

### Wiki pages with provenance

For any topic you have a few notes on, Open Brain compiles one readable page. Every paragraph cites the notes it came from, and the page tells you when it has gone stale. Refresh it from the CLI, from Claude or from the dashboard.

### Your own contradictions

A scan finds pairs of notes that disagree, for example an old "we picked Postgres" next to a newer "we switched to SQLite". You decide which one is current; the wiki leaves out the stale one.

### An entity graph

People, projects and technologies you mention become a co-occurrence graph. Explore it with `entities_search` and `entities_graph`, widen a search along shared entities with `thoughts_search_expanded`, or look at it on the dashboard's `/graph` page.

### Tasks

`task_create`, `task_get`, `task_list` and `task_update` track action items from Claude Code, with a status history. A token-protected `tasks-feed` gives a local tool a read-only list.

### A dashboard

Browse thoughts, wiki pages, contradictions and the graph in a browser. It is private to you and deploys to Vercel.

### It looks after itself

Nightly jobs audit contradictions, recompile stale wiki pages, archive old notes and consolidate topics, each with an LLM budget cap.

### You own all of it

The data lives in your Supabase project. The public key can read nothing, the dashboard is scoped to your account, and the server key never leaves your own tools. See [`docs/security.md`](docs/security.md).

## What it looks like

From a shell:

```
$ brain "Met with Sarah today, she's considering consulting"
✓ Thought captured
  Type: decision
  People: Sarah Johnson
  Topics: consulting
  Action: Follow up with Sarah about consulting timeline
```

In Claude Code, which searches your memory on its own at the start of a session and when a person or project comes up:

```
> What did we decide about the build tool?
  thoughts_search("build tool decision")  ->  3 notes, newest first
  We switched to esbuild in March because ... (your own words, with the note it came from)
```

On the dashboard, after you sign in:

| Route | What it shows |
| ----- | ------------- |
| `/` | Your thoughts, filterable by topic, person and type, with full-text search |
| `/wiki` | Compiled topic pages, each with its sources and a staleness banner |
| `/contradictions` | Pairs of notes that disagree, with a resolve form |
| `/graph` | Contradictions and entities as force-directed graphs |

Slack: invite the bot to a channel and every message there is captured, with a threaded reply that shows what was extracted.

## Get started

You need Node.js, the [Supabase CLI](https://github.com/supabase/cli#install-the-cli), a Supabase project and an OpenAI key. The short version:

```bash
supabase link --project-ref <project-ref> && supabase db push     # 1. the database
supabase functions deploy capture-thought                         # 2. the functions, one by name
npm ci --prefix cli && npm run build --prefix cli && npm install -g --install-links=false ./cli   # 3. the brain command
```

That is a teaser, not the guide. The full walk-through, with keys, secrets, the MCP server, the dashboard and optional Slack and nightly jobs, is in [`docs/install.md`](docs/install.md). You can also try everything on a local stack first.

## Upgrading

Coming from 0.8: [`docs/upgrading.md`](docs/upgrading.md). Keys first, then the new migrations, then the functions by name. Release notes for every version are in [`CHANGELOG.md`](CHANGELOG.md).

## Learn more

| Document | What is in it |
| -------- | ------------- |
| [`docs/install.md`](docs/install.md) | Fresh install, step by step, and how to verify it |
| [`docs/upgrading.md`](docs/upgrading.md) | Moving to a new release |
| [`docs/cli.md`](docs/cli.md) | The `brain` command |
| [`docs/mcp.md`](docs/mcp.md) | The MCP server and its 22 tools |
| [`docs/dashboard.md`](docs/dashboard.md) | The web dashboard |
| [`docs/edge-functions.md`](docs/edge-functions.md) | The six edge functions |
| [`docs/configuration.md`](docs/configuration.md) | Every environment variable |
| [`docs/security.md`](docs/security.md) | Who can do what, keys, and the lockdown |
| [`docs/operations.md`](docs/operations.md) | Nightly jobs, routine upkeep, checks |
| [`docs/architecture.md`](docs/architecture.md) | How it fits together and the data model |
| [`docs/troubleshooting.md`](docs/troubleshooting.md) | Symptoms and fixes |

Already using [claude-code-toolkit](https://github.com/dagonet/claude-code-toolkit)? Its templates ship with the Open Brain integration pre-wired, and `OPEN_BRAIN_TOOLS_DISABLED` in a repo's `.mcp.json` silences tool families you do not want there ([`docs/mcp.md`](docs/mcp.md#per-repo-opt-out)).

## Inspired by

- Andrej Karpathy — [LLM Wiki gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) (the upstream "personal wiki maintained by AI" idea — 41 k bookmarks)
- Nate B Jones — [Karpathy's Wiki vs Open Brain](https://www.youtube.com/watch?v=dxq7WtWxi44) (the bridge that adapted Karpathy's idea for Open Brain and announced the wiki + contradictions improvements)
- Nate B Jones — [You Don't Need SaaS. The $0.10 System That Replaced My AI Workflow](https://www.youtube.com/watch?v=2JiMmye2ezg)
- Nate B Jones — [One Simple System Gave All My AI Tools a Memory. Here's How.](https://www.youtube.com/watch?v=japT66frdhM)

## Related projects

Part of an ecosystem for AI-assisted development with Claude Code:

- [claude-code-toolkit](https://github.com/dagonet/claude-code-toolkit) -- Template system for bootstrapping projects with Claude Code configuration, including pre-wired Open Brain integration
- [mcp-dev-servers](https://github.com/dagonet/mcp-dev-servers) -- Six custom MCP servers (61 tools) for git, GitHub, .NET, Rust, Ollama, and template-sync integration

## Contributing, security and license

See [`CONTRIBUTING.md`](CONTRIBUTING.md), [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) and [`SECURITY.md`](SECURITY.md). MIT licensed, see [`LICENSE`](LICENSE).
