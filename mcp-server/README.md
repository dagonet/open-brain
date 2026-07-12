# Open Brain MCP Server

A local MCP (Model Context Protocol) server for Open Brain memory retrieval. As of v0.5.0 it exposes **15 tools** — semantic search with hybrid ranking (recency, salience, contradiction-penalized, superseded-excluded), capture with project scoping, salience extraction, and near-dup detection, listing with project filter, weekly review, system status, wiki pages, contradictions, and supersede.

> Inspired by Andrej Karpathy's [LLM Wiki gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) via Nate B Jones — [Karpathy's Wiki vs Open Brain](https://www.youtube.com/watch?v=dxq7WtWxi44).

## Prerequisites

- Node.js 18+
- npm
- A Supabase project with the Open Brain schema deployed (migrations 001–011)
- An OpenAI API key (for embedding-based semantic search)

## Setup

### 1. Install dependencies

```bash
cd mcp-server
npm install
npm run build
```

### 2. Configure environment variables

| Var | Purpose |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (NOT the anon key) |
| `OPENAI_API_KEY` | OpenAI API key for generating embeddings |
| `OPEN_BRAIN_TOOLS_DISABLED` | (v0.3.0, optional) Comma-separated tool families to filter out: `wiki`, `contradictions`, or both. See [Per-repo opt-out](#per-repo-opt-out) below. |
| `OPEN_BRAIN_DEFAULT_PROJECT` | (v0.5.0, optional) Default project scope for all tools when the caller omits the `project` param. Enables per-repo memory isolation — each workspace pins itself via `.mcp.json`. |

### 3. Apply database migrations

Run `supabase db push` from the repo root to apply all Open Brain migrations (001–011). Migrations 008–011 (v0.5.0) add project scoping, salience, supersedes, hybrid ranking, near-duplicate detection, and retrieval tracking. The `sql/match_thoughts.sql` file is deprecated — migration 008 is now the source of truth.

### 4. Configure Claude Code

Add to your `.claude/.mcp.json` (project) or `~/.claude/.mcp.json` (user-level):

```json
{
  "mcpServers": {
    "open-brain": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-server/dist/index.js"],
      "env": {
        "SUPABASE_URL": "https://your-project.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "your-service-role-key",
        "OPENAI_API_KEY": "sk-your-openai-key",
        "OPEN_BRAIN_DEFAULT_PROJECT": "my-repo-name"
      }
    }
  }
}
```

## Tools

### Thoughts (9)

| Tool | Description |
|---|---|
| `thoughts_search` | Semantic search with hybrid ranking (v0.5.0: uses `match_thoughts_v2` with recency decay, salience boost, contradiction penalty, superseded exclusion). Params: `query`, `limit`, `thought_type`, `people`, `topics`, `days`, `project` (v0.5.0), `recency_halflife_days`, `include_superseded`, `apply_contradiction_penalty`. Results include `score`, `salience`, `project`. |
| `thoughts_recent` | List thoughts ordered by date. Params: `days`, `limit`, `project` (v0.5.0). |
| `thoughts_capture` | Capture a thought, decision, insight, or note. Auto-classifies + extracts metadata + salience rating (v0.5.0). Params: `text`, `metadata`, `project` (v0.5.0). When `duplicate_candidate` is returned, a hint text suggests using `thoughts_supersede`. |
| `thoughts_delete` | Soft-delete a thought by UUID. Params: `id`. |
| `thoughts_people` | List unique people with mention counts. Params: `limit`. |
| `thoughts_topics` | List unique topics with mention counts. Params: `limit`. |
| `thoughts_review` | Structured summary over a time period. Params: `days`. |
| `thoughts_supersede` | (v0.5.0, tool #15) Mark one thought as superseding another. Superseded thoughts excluded from default search results. Params: `new_thought_id`, `old_thought_id`. |
| `system_status` | Total thoughts, counts by status/source, recent failures, embedding config. No params. |

### Wiki (3 — new in v0.3.0)

| Tool | Description |
|---|---|
| `wiki_get` | Latest compiled wiki page for a topic slug. Returns markdown plus staleness signals (`stale_since_n_thoughts`, `open_contradictions_count`, `compiled_at`) and source thought IDs (with optional inline snippets). Params: `slug`, `include_sources` (`snippets` \| `full` \| `none`, default `snippets`). |
| `wiki_list` | List compiled pages newest-first. Use `{limit:1}` to cheaply check whether wiki content exists at all in this workspace. Params: `limit`, `since`. |
| `wiki_refresh` | Recompile a topic page from current thoughts via the `compile-wiki` edge function. Citation-validated; returns `partial=true` if some paragraphs were dropped. Params: `slug`, `dry_run`. |

### Contradictions (3 — new in v0.3.0)

| Tool | Description |
|---|---|
| `contradictions_list` | List contradictions detected between pairs of captured thoughts. Params: `status`, `since`, `limit`. |
| `contradictions_resolve` | Mark a contradiction as `resolved` / `ignored` / `false_positive` and capture an audit thought. Params: `id`, `decision`, `note`. |
| `contradictions_audit` | Trigger an on-demand audit pass via the `detect-contradictions` edge function. Params: `thought_id`, `since`, `candidate_limit`. |

The MCP `instructions` string includes a **conditional wiki-first rule**: agents call `wiki_list({limit:1})` before considering `wiki_get`, so unrelated repos with no wiki content see no behavioural change versus v0.2.0.

## Per-repo opt-out

Set `OPEN_BRAIN_TOOLS_DISABLED=wiki,contradictions` in a project's `.mcp.json` env block to silence those tool families in that workspace. Useful for sensitive client repos where wiki/audit overhead is unwanted.

```json
{
  "mcpServers": {
    "open-brain": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-server/dist/index.js"],
      "env": {
        "SUPABASE_URL": "https://your-project.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "your-service-role-key",
        "OPENAI_API_KEY": "sk-your-openai-key",
        "OPEN_BRAIN_DEFAULT_PROJECT": "my-repo-name",
        "OPEN_BRAIN_TOOLS_DISABLED": "wiki,contradictions"
      }
    }
  }
}
```

When the env var is set, the filtered families do not appear in the `tools/list` response and the wiki-first rule is omitted from the MCP `instructions` string.

## Versions

| Version | Notes |
|---|---|
| `0.5.0` | Added thoughts_supersede (tool #15), hybrid search params, project scoping, salience, near-dup detection, retrieval tracking |
| `0.3.0` | Added 6 wiki / contradictions tools, per-repo opt-out, conditional wiki-first rule |
| `0.2.0` | First write tool (`thoughts_capture`), proactive `instructions` string |
| `0.1.0` | Initial 6 read tools |
