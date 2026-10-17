[Back to README](../README.md)

# MCP server (Claude Code)

A local [Model Context Protocol](https://modelcontextprotocol.io) server that gives Claude Code (or any MCP client) read and write access to your Open Brain. It exposes **22 tools** in five families and ships `instructions` that tell the agent when to read from and write to your memory.

> Inspired by Andrej Karpathy's [LLM Wiki gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) via Nate B Jones — [Karpathy's Wiki vs Open Brain](https://www.youtube.com/watch?v=dxq7WtWxi44).

## Prerequisites

- Node.js 18+ and npm.
- A Supabase project with all migrations (001 to 018) applied: [`install.md`](install.md#3-deploy-the-database).
- The legacy service-role key ([`security.md`](security.md#keys)) and an OpenAI API key (used to embed search queries).

## Install

```bash
npm ci --prefix mcp-server
npm run build --prefix mcp-server
```

Rebuild after every `git pull`; Claude Code runs the compiled `dist/`. Then restart Claude Code.

## Configure Claude Code

Add the server to a project's `.mcp.json` (at the repo root) or to `~/.claude.json` (user level). The file is not `.claude/.mcp.json`.

```json
{
  "mcpServers": {
    "open-brain": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-server/dist/index.js"],
      "env": {
        "SUPABASE_URL": "https://<project-ref>.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "<service-role-key>",
        "OPENAI_API_KEY": "sk-your-openai-key",
        "OPEN_BRAIN_DEFAULT_PROJECT": "my-repo-name"
      }
    }
  }
}
```

Environment variables:

| Variable | Purpose |
| -------- | ------- |
| `SUPABASE_URL` | Your Supabase project URL. Required. |
| `SUPABASE_SERVICE_ROLE_KEY` | The legacy service-role JWT (not the anon key, not `sb_secret_...`). Required. |
| `OPENAI_API_KEY` | Embeds search queries. Required. |
| `OPEN_BRAIN_DEFAULT_PROJECT` | Optional. Default project scope when a call omits `project`. Each workspace pins itself in its own `.mcp.json`, so agents working on different repos see only their own memories. |
| `OPEN_BRAIN_TOOLS_DISABLED` | Optional. Comma-separated tool families to hide: `wiki`, `contradictions`, `tasks`, `entities`. |

All variables for all components: [`configuration.md`](configuration.md).

## Tools

### Thoughts (10)

| Tool | Description |
| ---- | ----------- |
| `thoughts_search` | Semantic search with hybrid ranking (`match_thoughts_v2`: recency decay, salience boost, contradiction penalty, superseded excluded, archived excluded unless asked). Params: `query`, `limit`, `thought_type`, `people`, `topics`, `days`, `project`, `recency_halflife_days`, `include_superseded`, `include_archived`, `apply_contradiction_penalty`. Results include `score`, `salience`, `project`, `lifecycle_status`. |
| `thoughts_search_expanded` | Semantic search plus 1-hop entity expansion: runs `match_thoughts_v2`, then adds related thoughts via shared entities (`related_thoughts_via_entities`; a rare shared entity outranks a common hub). Params: `query`, `project`, `limit`, `recency_halflife_days`. The expansion leg degrades gracefully; a failing base search surfaces as an error. |
| `thoughts_recent` | List thoughts by date. Params: `days`, `limit`, `project`. |
| `thoughts_capture` | Save a thought: classifies, extracts people, topics, action items and salience, embeds. Params: `text`, `metadata`, `project`. When the response includes a `duplicate_candidate`, the tool renders a hint with the duplicate's id, similarity and a pointer to `thoughts_supersede`. |
| `thoughts_delete` | Soft-delete a thought by UUID. Params: `id`. |
| `thoughts_supersede` | Mark `new_thought_id` as superseding `old_thought_id`. Validates that both exist, are distinct and not deleted. The old thought leaves default search results. |
| `thoughts_people` | Unique people with mention counts. Params: `limit`. |
| `thoughts_topics` | Unique topics with mention counts. Params: `limit`. |
| `thoughts_review` | Structured summary over a period: counts, breakdowns, open action items. Params: `days`. |
| `system_status` | Total thoughts, counts by status and source, recent failures, embedding configuration. No params. |

### Wiki (3)

| Tool | Description |
| ---- | ----------- |
| `wiki_get` | Latest compiled page for a topic slug: markdown, staleness signals (`stale_since_n_thoughts`, `open_contradictions_count`, `compiled_at`) and source thought ids. Params: `slug`, `include_sources` (`snippets` \| `full` \| `none`, default `snippets`). |
| `wiki_list` | Compiled pages, newest first. `{limit: 1}` is a cheap check whether the workspace has wiki content at all. Params: `limit`, `since`. |
| `wiki_refresh` | Recompile a topic page through the `compile-wiki` function. Citation-validated; returns `partial=true` if paragraphs were dropped. Params: `slug`, `dry_run`. |

### Contradictions (3)

| Tool | Description |
| ---- | ----------- |
| `contradictions_list` | Contradictions detected between pairs of thoughts. Params: `status`, `since`, `limit`. |
| `contradictions_resolve` | Mark one `resolved` / `ignored` / `false_positive` and capture an audit thought. Params: `id`, `decision`, `note`. |
| `contradictions_audit` | Trigger an on-demand audit via the `detect-contradictions` function. Params: `thought_id`, `since`, `candidate_limit`. |

### Tasks (4)

Statuses: `open` (default), `in_progress`, `blocked`, `done`, `cancelled`. There is no delete; `cancelled` soft-deletes, and cancelled tasks drop out of every tool.

| Tool | Description |
| ---- | ----------- |
| `task_create` | Create a task. Params: `title` (required), `description`, `priority` (1 to 5, 1 highest), `project`, `linked_thought_ids`, `metadata`. |
| `task_get` | One task by UUID, with its full `status_history`. Params: `id`. |
| `task_list` | Tasks, newest first, default limit 50. Params: `project`, `status`, `priority`, `limit`. |
| `task_update` | Update fields. A status change is appended to `status_history` with a timestamp and optional `note`. Params: `id`, `title`, `description`, `priority`, `linked_thought_ids`, `metadata`, `status`, `note`. |

### Entities (2)

The entity graph is a co-occurrence graph over the entity descriptions captured with each thought: pure SQL views, no extra LLM cost. File-path and generic-token noise is filtered out.

| Tool | Description |
| ---- | ----------- |
| `entities_search` | Search entities by name, optionally by `entity_type`. Returns mention count, thought count and last-mentioned time. Params: `query`, `entity_type`, `limit` (default 20). |
| `entities_graph` | The 1-hop neighbourhood of an entity: `{entity, neighbors}`, each neighbour with edge weight (shared-thought count), type and display name. Params: `entity`, `max_nodes` (default 50). |

## How agents use it

The server sends MCP `instructions` on connect. They tell the agent to search memory at session start and when a person, project or topic comes up, to capture durable knowledge (decisions, root causes, preferences) without asking permission, to resolve near-duplicates with `thoughts_supersede`, and what not to capture (routine implementation details, temporary debugging state, anything marked private).

The wiki rule is **conditional**: agents call `wiki_list({limit: 1})` first and only switch to wiki-first behaviour when it returns at least one page, so a repo without wiki content sees no change.

## Per-repo opt-out

Set `OPEN_BRAIN_TOOLS_DISABLED` in a project's `.mcp.json` to hide tool families in that workspace, for example for sensitive client repos where wiki, audit or task overhead is unwanted:

```json
{
  "mcpServers": {
    "open-brain": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-server/dist/index.js"],
      "env": {
        "SUPABASE_URL": "https://<project-ref>.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "<service-role-key>",
        "OPENAI_API_KEY": "sk-your-openai-key",
        "OPEN_BRAIN_TOOLS_DISABLED": "wiki,contradictions,tasks,entities"
      }
    }
  }
}
```

| Family | Hides |
| ------ | ----- |
| `wiki` | `wiki_get`, `wiki_list`, `wiki_refresh`, and the wiki-first rule in the instructions |
| `contradictions` | `contradictions_list`, `contradictions_resolve`, `contradictions_audit` |
| `tasks` | `task_create`, `task_get`, `task_list`, `task_update` |
| `entities` | `entities_search`, `entities_graph`, and the entity section of the instructions (`thoughts_search_expanded` stays: it is a thoughts tool) |

Hidden tools do not appear in `tools/list`. Toolkit-based projects ([claude-code-toolkit](https://github.com/dagonet/claude-code-toolkit)) ship the Open Brain references pre-wired and can use the same variable.

## Versions

The server reports its real version: `serverInfo.version` is read from `mcp-server/package.json`.

| Version | Notes |
| ------- | ----- |
| `0.9.0` | Reports its real version, smoke test, declares `zod`; 22 tools, unchanged. Requires the service-role key for every call (database access is closed to the anon key). |
| `0.8.0` | Version bump only; entity noise filter in the database. |
| `0.7.0` | Entity tools: `entities_search`, `entities_graph`, `thoughts_search_expanded` (22 tools). |
| `0.6.0` | 4 task tools (19 total), lifecycle (`include_archived`, `lifecycle_status`), `tasks` opt-out family. |
| `0.5.0` | `thoughts_supersede`, hybrid search params, project scoping, salience, near-duplicate detection, retrieval tracking. |
| `0.3.0` | 6 wiki and contradictions tools, per-repo opt-out, conditional wiki-first rule. |
| `0.2.0` | First write tool (`thoughts_capture`), proactive `instructions`. |
| `0.1.0` | Initial 6 read tools. |

## Development

```bash
npm ci --prefix mcp-server
npm test --prefix mcp-server           # vitest, includes the in-memory smoke test
npm run test:eval --prefix mcp-server  # ranking-quality eval harness (needs a seeded project)
```
