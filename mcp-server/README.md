# Open Brain MCP Server

A local MCP (Model Context Protocol) server for Open Brain memory retrieval. As of v0.3.0 it exposes **14 tools** — semantic search, capture, listing, weekly review, system status, plus the new wiki and contradictions surfaces.

> Inspired by Andrej Karpathy's [LLM Wiki gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) via Nate B Jones — [Karpathy's Wiki vs Open Brain](https://www.youtube.com/watch?v=dxq7WtWxi44).

## Prerequisites

- Node.js 18+
- npm
- A Supabase project with the Open Brain schema deployed (migrations 001–006)
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

### 3. Install the database function

Run the SQL in `sql/match_thoughts.sql` in your Supabase SQL Editor or add as a migration. This creates the `match_thoughts` function used by semantic search.

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
        "OPENAI_API_KEY": "sk-your-openai-key"
      }
    }
  }
}
```

## Tools

### Thoughts (8)

| Tool | Description |
|---|---|
| `thoughts_search` | Semantic similarity search. Embeds the query via OpenAI and matches against stored embeddings. Params: `query`, `limit`, `thought_type`, `people`, `topics`, `days`. |
| `thoughts_recent` | List thoughts ordered by date (no embedding). Params: `days`, `limit`. |
| `thoughts_capture` | Capture a thought, decision, insight, or note. Auto-classifies + extracts metadata. Params: `text`, `metadata`. |
| `thoughts_delete` | Soft-delete a thought by UUID. Params: `id`. |
| `thoughts_people` | List unique people with mention counts. Params: `limit`. |
| `thoughts_topics` | List unique topics with mention counts. Params: `limit`. |
| `thoughts_review` | Structured summary over a time period. Params: `days`. |
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
| `0.3.0` | Added 6 wiki / contradictions tools, per-repo opt-out, conditional wiki-first rule |
| `0.2.0` | First write tool (`thoughts_capture`), proactive `instructions` string |
| `0.1.0` | Initial 6 read tools |
