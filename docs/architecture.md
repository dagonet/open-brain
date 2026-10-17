[Back to README](../README.md)

# Architecture

How the pieces of Open Brain fit together: the capture path, the retrieval layers, the components and the database, migration by migration.

## How it works

```
You (CLI / Slack / Claude Code)
  |
  v
capture-thought edge function (Supabase/Deno)
  |
  ├── OpenAI text-embedding-3-small → 1536-dim vector
  ├── GPT-4o-mini → thought_type, people, topics, action_items, salience
  ├── GPT-4o-mini → entity descriptions
  ├── find_near_dups RPC — cosine check against recent thoughts
  |
  v
PostgreSQL + pgvector (Supabase)
  |
  ├── thoughts (vector, type, people, topics, project, salience, supersedes, lifecycle)
  ├── entity_descriptions → entity_nodes + entity_edges
  ├── wiki_pages + wiki_sources
  ├── contradictions
  ├── tasks
  └── retrieval_count, last_retrieved_at (retrieval tracking)

  v
Retrieval (MCP server / CLI / web dashboard)
  ├── match_thoughts_v2 hybrid ranking — recency x salience x contradiction x supersede
  ├── match_thoughts pure cosine (backward compatible)
  ├── List by date, people, topics, project
  ├── thoughts_supersede tool
  ├── Entity description + graph lookup
  ├── entities_search / entities_graph
  ├── thoughts_search_expanded — semantic + 1-hop entity expansion
  └── Weekly review summaries

  Wiki layer
  ┌──────────────────────────────────────────────────┐
  │ brain wiki refresh <slug> | brain audit          │
  │   |                            |                 │
  │   v                            v                 │
  │ compile-wiki edge fn      detect-contradictions  │
  │   |  GPT-4o-mini structured-output + validator   │
  │   v                            v                 │
  │ wiki_pages + wiki_sources    contradictions      │
  │   |                            |                 │
  │   v                            v                 │
  │ wiki_get / wiki_list      contradictions_list    │
  │ (MCP / dashboard /wiki)   (MCP / dashboard       │
  │                              /contradictions)    │
  └──────────────────────────────────────────────────┘

  Graph layers
  ┌──────────────────────────────────────────────────┐
  │ Contradiction graph                              │
  │ contradictions + thoughts → force-directed SVG   │
  │   |                                              │
  │   v                                              │
  │ /graph (dashboard) — nodes=thoughts,             │
  │ edges=contradictions, click to drill in          │
  ├──────────────────────────────────────────────────┤
  │ Entity graph                                      │
  │ entity_descriptions → entity_nodes + entity_edges │
  │   |                                              │
  │   v                                              │
  │ entities_search / entities_graph /               │
  │ thoughts_search_expanded (MCP)                   │
  │ — co-occurrence graph, pure SQL, zero LLM cost   │
  └──────────────────────────────────────────────────┘
```

Every thought you capture is:

1. **Embedded** as a 1536-dimensional vector for semantic search
2. **Classified** into a type: decision, insight, meeting, action, reference, question, or note
3. **Annotated** with extracted people, topics, and action items
4. **Deduplicated** on import, in the MCP tool and for Slack events through idempotency keys (a one-off `brain "<thought>"` gets a fresh key each run)

## Components

| Component | Runtime | Description |
| --------- | ------- | ----------- |
| `cli/` | Node.js 18+ | `brain` command: capture thoughts, import memories, refresh wiki pages, run contradiction audits. Zero runtime dependencies. Reference: [`cli.md`](cli.md). |
| `mcp-server/` | Node.js 18+ | MCP server with 22 tools (10 thoughts + 3 wiki + 3 contradictions + 4 tasks + 2 entities) for Claude Code integration. Reference: [`mcp.md`](mcp.md). |
| `web/` | Next.js 16 | Authenticated dashboard with `/`, `/wiki`, `/contradictions` and `/graph` routes. Reads as the signed-in user; the anon key serves only login/auth; auto-deployed from `main` to Vercel. Reference: [`dashboard.md`](dashboard.md). |
| `supabase/functions/capture-thought/` | Deno | Thought processing and storage |
| `supabase/functions/compile-wiki/` | Deno | Compiles a topic-level wiki page from clustered thoughts with citation validation |
| `supabase/functions/detect-contradictions/` | Deno | Audits thought pairs for contradictions via embedding-similar neighbours and an LLM judge |
| `supabase/functions/run-nightly-jobs/` | Deno | Cron orchestrator for the nightly jobs: [`operations.md`](operations.md) |
| `supabase/functions/tasks-feed/` | Deno | Read-only task list (JSON) for local tools, behind a bearer token |
| `supabase/functions/slack-webhook/` | Deno | Slack Events API integration |
| `supabase/migrations/` | SQL | Database schema with pgvector, indexes, RLS |

The functions are documented in [`edge-functions.md`](edge-functions.md); who may call what is in [`security.md`](security.md).

## Design notes

**Database.** A `thoughts` table in PostgreSQL with the pgvector extension. An HNSW index serves fast approximate nearest-neighbour search; GIN indexes cover the `people` and `topics` arrays. Soft delete is a `deleted_at` column. Single-user row-level security: the signed-in role sees data only for the accounts listed in `public.owners` (migration 017), and the anon role has no data access (migration 016).

**Processing.** All capture paths (CLI, Slack, MCP, dashboard) call the same `capture-thought` edge function, which runs embedding generation and metadata extraction in parallel via the shared `processThought()` core.

**Embedding.** OpenAI `text-embedding-3-small` produces 1536-dimensional vectors. Semantic search uses the `match_thoughts` / `match_thoughts_v2` SQL functions with pgvector cosine similarity (the `<=>` operator).

**Classification.** GPT-4o-mini with JSON mode extracts `thought_type`, `people`, `topics`, `action_items` and salience from raw text. Temperature 0 for deterministic results.

**Idempotency.** `brain import` hashes `source:normalized_text` (SHA-256), the MCP tool `mcp:normalized_text`, Slack uses `<channel>:<ts>`. Plain `brain "<thought>"` uses a random key per run, so repeating the same text stores it twice.

**Entity graph.** The `entity_descriptions` table records entity mentions (people, projects, technologies) on every save. Migration 014 adds `entity_nodes` (canonical entities by `lower(trim(name))`) and `entity_edges` (co-occurrence pairs, weight = shared-thought count): pure SQL views over the existing data, zero LLM cost, self-maintaining. Three RPCs expose the graph: `entity_search` for full-text entity lookup, `entity_neighbors` for 1-hop traversal, and `related_thoughts_via_entities` for hub-suppressed thought expansion (degree cap and inverse-frequency scoring). Migration 015 filters file-path and generic-token noise out of the views without touching the stored data. The MCP server exposes the graph as `entities_search`, `entities_graph` and `thoughts_search_expanded`; opt out with `OPEN_BRAIN_TOOLS_DISABLED=entities`. Edges are co-occurrence-based and untyped; relation-typed edges are not implemented.

**Evaluation.** A ranking-quality eval harness lives in `mcp-server` (`npm run test:eval --prefix mcp-server`; it needs a seeded project). See [`configuration.md`](configuration.md#eval-harness).

## Data model, by migration

Migrations are in `supabase/migrations/` and applied in order by `supabase db push`. All use `IF NOT EXISTS` / `CREATE OR REPLACE` patterns where the change can be repeated; 016 to 018 are idempotent. Upgrade notes per release: [`upgrading.md`](upgrading.md).

| # | File | What it adds |
| - | ---- | ------------ |
| 001 | `create_thoughts` | The `thoughts` table: `raw_text`, a 1536-dim `embedding` (HNSW cosine index), `thought_type` (decision, insight, meeting, action, reference, question, note), `people`, `topics`, `action_items`, `source`, `processing_status` (complete, partial, failed), `metadata`, `idempotency_key`, soft delete, GIN indexes, the `update_updated_at()` trigger function. |
| 002 | `add_import_source` | Widens the `source` check so imports (`import`, `import-claude`, `import-chatgpt`) are accepted. |
| 003 | `add_read_policy` | A read policy for non-deleted thoughts (replaced by owner-scoped policies in 016 to 018). |
| 004 | `add_authenticated_policy` | A SELECT policy for the signed-in role, a `(created_at, id)` index, and `get_distinct_topics()` / `get_distinct_people()` for the dashboard filters. |
| 005 | `wiki` | `contradictions`, `wiki_pages` (append-only versions) and `wiki_sources` tables; views `current_wiki_pages`, `wiki_page_staleness` and `topic_counts`; functions `slugify()` and `thoughts_by_slug()`; the `unaccent` and `pgcrypto` extensions. |
| 006 | `contradictions_anon_update` | A policy letting the dashboard resolve contradictions (replaced in 016 to 018). |
| 007 | `entity_descriptions` | The `entity_descriptions` table: one-sentence descriptions of people, projects and technologies per thought. |
| 008 | `project_salience_supersedes` | `thoughts.project`, `salience` (1 to 5), `supersedes_id`, `retrieval_count`, `last_retrieved_at`; indexes; `match_thoughts` rebuilt with project scope; backfills `project` from metadata. |
| 009 | `hybrid_ranking` | `match_thoughts_v2`: cosine similarity blended with recency decay, salience, contradiction penalty and superseded exclusion. |
| 010 | `near_dup` | `find_near_dups()`: cosine check of a new thought against recent ones. |
| 011 | `track_retrieval` | `increment_retrieval()`: bumps `retrieval_count` and `last_retrieved_at` when search returns a thought. |
| 012 | `lifecycle_status` | `thoughts.lifecycle_status` (active, superseded, archived); `match_thoughts_v2` gains `include_archived` (11 arguments); `archive_thoughts()` and `consolidation_candidates()` for the nightly jobs. |
| 013 | `create_tasks` | The `tasks` table: `title`, `description`, `status` (open, in_progress, blocked, done, cancelled), `priority` (1 to 5), `project`, `linked_thought_ids`, `metadata`, `status_history`, soft delete. |
| 014 | `entity_graph` | Views `entity_nodes` and `entity_edges`; RPCs `entity_search`, `entity_neighbors`, `related_thoughts_via_entities`. |
| 015 | `entity_quality` | `is_code_path()` and the noise filter in the two entity views. |
| 016 | `restrict_to_authenticated` | Anon lockdown: anon/PUBLIC policies and privileges dropped, views switched to `security_invoker`, `EXECUTE` on the RPCs revoked from anon. [`security.md`](security.md#database-lockdown-migration-by-migration) |
| 017 | `scope_authenticated_to_owner` | `public.owners` and owner-scoped policies for the signed-in role; bootstrap seeds the owner when there is exactly one user. |
| 018 | `narrow_grants_private_helper` | Narrower grants for the signed-in role (SELECT, plus UPDATE of `contradictions.status` and `resolved_at`), the owner check moved to `private.is_owner()`, `search_path` pinned on the `SECURITY DEFINER` functions, `CREATE` on `public` revoked. Rollback steps are in the file header. |

Tables in the end state: `thoughts`, `entity_descriptions`, `wiki_pages`, `wiki_sources`, `contradictions`, `tasks`, `owners`. Views: `current_wiki_pages`, `wiki_page_staleness`, `topic_counts`, `entity_nodes`, `entity_edges`.
