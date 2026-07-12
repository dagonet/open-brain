# Changelog

All notable changes to Open Brain are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.0] - 2026-07-12

Inspired by Andrej Karpathy's [LLM Wiki gist](https://gist.github.com/karpathy/442a6bf555914893e9891c19de94f)
via Nate B Jones' [Karpathy's Wiki vs Open Brain](https://www.youtube.com/watch?v=dxq7WtWxi44).

### Added

- **Entity co-occurrence graph.** The `entity_descriptions` table (v0.4) held 2,260+
  entity mentions across 585 thoughts, captured on every save but NEVER read — the data
  was stranded. Migration 014 introduces `entity_nodes` (canonical entities by
  `lower(trim(name))`) and `entity_edges` (co-occurrence pairs, weight = shared-thought
  count) views — pure SQL self-joins, zero LLM cost, self-maintaining. Three new RPCs:
  `entity_search`, `entity_neighbors` (1-hop), `related_thoughts_via_entities`
  (hub-suppression: degree cap + inverse-frequency scoring so a rare shared entity
  outranks a hub). (WS1)
- **Three new MCP tools.** Tool count: 19 -> 22. `entities_search(query, entity_type?,
  limit?)` — full-text entity lookup; `entities_graph(entity, max_nodes?)` — depth-1
  entity neighborhood, returns `{entity, neighbors}`; `thoughts_search_expanded(query,
  project?, limit?, recency_halflife_days?)` — semantic search + 1-hop entity expansion
  via `related_thoughts_via_entities`. `match_thoughts_v2` unchanged; expansion leg
  degrades gracefully; base-search failure surfaces as an error. (WS2)
- **New disable family.** `OPEN_BRAIN_TOOLS_DISABLED` now accepts `entities` alongside
  `wiki`, `contradictions`, and `tasks`. (WS2)

### Changed

- **MCP server 0.6.0 -> 0.7.0** (19 -> 22 tools). New `entities` tool family
  (`entities_search`, `entities_graph`) plus `thoughts_search_expanded` on the
  `thoughts` family. (WS3)
- **Migration 014** applied. Additive DDL creating `entity_nodes` + `entity_edges`
  views and the `entity_search`, `entity_neighbors`, `related_thoughts_via_entities`
  RPCs. (WS1)

### Fixed

- **#29: Dollar-quote SQL lint.** `hooks/run-gate.sh` now accepts dollar-quoted strings
  (`$$...$$`) in SQL files, ending false positives on migration files with dollar-quote
  delimiters. (WS1)

### Notes

- Edges are co-occurrence-based (untyped). The canonical entity is the normalized name
  (`lower(trim(name))`). Deferred to v0.8: LLM-typed relation edges, alias merge
  (React = ReactJS), entity embeddings, web entity graph view, depth-2 neighborhoods.
- CLI and web dashboard are unchanged in this release.

### Cross-repo follow-ups (not part of this release)

- A separate PR on `dagonet/claude-code-toolkit` will sync each variant's
  `CLAUDE.md`, `CLAUDE.local.md`, skill files, and agent definitions to reference
  the 22-tool set (was 19) and document the `entities` disable family.

## [0.6.0] - 2026-07-12

Inspired by Andrej Karpathy's [LLM Wiki gist](https://gist.github.com/karpathy/442a6bf555914893e9891c19de94f)
via Nate B Jones' [Karpathy's Wiki vs Open Brain](https://www.youtube.com/watch?v=dxq7WtWxi44).

### Added

- **Lifecycle status.** New `lifecycle_status` column (`active`/`superseded`/`archived`)
  on `thoughts`. `match_thoughts_v2` now accepts an `include_archived` boolean param
  (default false); results surface `lifecycle_status`. The supersede tool also sets the
  old thought to `'superseded'`. (WS1)
- **Archived-aware ranking.** Archived thoughts are excluded from default search results
  unless `include_archived=true`. Superseded ranking logic is unchanged (still uses the
  `NOT EXISTS` anti-join). (WS1)
- **Nightly auto-archival** (`{job:"archive"}`). Pure SQL, zero LLM cost. Resolved action
  items older than `ARCHIVE_RESOLVED_ACTION_DAYS` (default 90) and cold
  notes/references/questions never retrieved for `ARCHIVE_COLD_DAYS` (default 180) are
  set to `lifecycle_status = 'archived'`. Decisions and insights are NEVER auto-archived.
  Scheduled daily at 05:07 UTC via pg_cron. (WS2)
- **Nightly consolidation** (`{job:"consolidate"}`, weekly Sunday 06:07 UTC).
  `consolidation_candidates` RPC finds high-signal topics with no compiled wiki page;
  compiles via `compile-wiki`, budget-capped by `CONSOLIDATE_BUDGET` (default 5) and
  `CONSOLIDATE_MIN_THOUGHTS` (default 3). (WS2)
- **Task-state API.** New `tasks` table (migration 013) with 4 MCP tools:
  `task_create`, `task_get`, `task_list`, `task_update`. Project-scoped, with
  `status_history` array for auditable transitions, soft-delete via `cancel` status.
  Tool count: 15 -> 19. (WS4)
- **New disable family.** `OPEN_BRAIN_TOOLS_DISABLED` now accepts `tasks` alongside
  `wiki` and `contradictions`. (WS4)
- **Eval: archived-exclusion golden queries.** Deterministic fixtures verify archived
  thoughts are excluded from default `match_thoughts_v2` results and included when
  `include_archived=true`. (WS5)

### Changed

- **MCP server 0.5.0 -> 0.6.0** (15 -> 19 tools). `thoughts_search` now surfaces
  `lifecycle_status` and accepts the `include_archived` param. New `task_*` tool family
  with 4 tools. (WS3 + WS4)
- **Migrations 012 + 013** applied. Migration 012 adds `lifecycle_status`,
  `archive_thought`, `consolidation_candidates`, and updates `match_thoughts_v2` to
  11 arguments. Migration 013 creates the `tasks` table. (WS1 + WS4)

### Cross-repo follow-ups (not part of this release)

- A separate PR on `dagonet/claude-code-toolkit` will sync each variant's
  `CLAUDE.md`, `CLAUDE.local.md`, skill files, and agent definitions to reference
  the 19-tool set (was 15) and document the `lifecycle` + `tasks` disable families.

## [0.5.0] - 2026-07-12

Inspired by Andrej Karpathy's [LLM Wiki gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
via Nate B Jones' [Karpathy's Wiki vs Open Brain](https://www.youtube.com/watch?v=dxq7WtWxi44).

### Added

- **Hybrid ranking** (`match_thoughts_v2`). New SQL function re-ranks HNSW over-fetched
  candidates (4x match_count, min 50) with recency decay, salience multiplier, contradiction
  penalty, and superseded-thought exclusion. Every factor has a KNOWN mathematical form with
  analytic floor (0.05 for old critical decisions). The original `match_thoughts` (pure cosine)
  remains unchanged for backward compat — v2 is additive only. (WP1)
- **Near-duplicate detection.** After capture, a new `find_near_dups` RPC checks the 30-day
  window for cosine-similar thoughts above `NEAR_DUP_THRESHOLD` (default 0.92). The new thought
  is ALWAYS inserted — no silent dedup. The response carries an optional `duplicate_candidate`
  hint with thought ID, preview, and similarity. (WP2)
- **Salience rating.** The existing gpt-4o-mini classification call (JSON mode) now returns
  `salience` 1–5 (5 = critical decision, 1 = throwaway) in the same response — no new LLM call.
  Missing/invalid values become NULL, scored as neutral (3) by `match_thoughts_v2`. (WP2)
- **Project scoping.** `ThoughtInput` gains `project?: string` accepted by the capture endpoint.
  When set, the `project` column is populated alongside the existing `metadata.project` convention
  (column takes precedence). `match_thoughts_v2`, `thoughts_recent`, and the `OPEN_BRAIN_DEFAULT_PROJECT`
  env var enable per-repo memory isolation — each workspace can pin itself to its own project scope.
  (WP2 + WP3)
- **`thoughts_supersede` MCP tool** (tool #15). Marks one thought as superseding another;
  superseded thoughts are excluded from default search results. Direction is unambiguous: "A
  supersedes B" means B is superseded and dropped from results unless `include_superseded` is
  passed. (WP3)
- **Retrieval tracking.** A fire-and-forget `increment_retrieval` RPC updates `retrieval_count`
  and `last_retrieved_at` after every search. Accumulated signal feeds consolidation in v0.6.
  (WP3)
- **Eval harness.** Fully deterministic synthetic fixture set (17 thoughts, 1536-d unit vectors
  from orthogonal centroids + seeded LCG noise) with 6 golden queries covering recency ranking,
  contradiction demotion, superseded exclusion, recency floor, project filtering, and fresh
  insight boost. Runner reports recall@5/10 and MRR for v1 vs v2. CI-safe when `SUPABASE_URL`
  is unset. (WP5)
- **Nightly automation.** New `run-nightly-jobs` edge function with two jobs: contradictions
  sweep (`NIGHTLY_CONTRADICTION_LIMIT`, default 100) and stale-wiki recompile (`NIGHTLY_COMPILE_BUDGET`,
  default 5). Global `MAX_LLM_CALLS_PER_JOB` budget cap (default 50). `docs/cron-setup.sql`
  documents pg_cron + pg_net scheduling at 03:00/04:00. (WP6)
- **CLI `--project` flag** on `capture` and `import` commands. When the response includes a
  `duplicate_candidate`, prints: `Near-duplicate of <id> (<similarity>): "<preview>" — consider
superseding.` (WP4)

### Changed

- **MCP server 0.3.0 → 0.5.0** (14 → 15 tools). `thoughts_search` now calls `match_thoughts_v2`
  and surfaces `score`, `salience`, and `project` in results. New optional params: `project`,
  `recency_halflife_days`, `include_superseded`, `apply_contradiction_penalty`. `thoughts_capture`
  accepts `project` and renders `duplicate_candidate` as guidance text. `thoughts_recent` accepts
  `project` filter. `OPEN_BRAIN_DEFAULT_PROJECT` env var scopes all tools when the caller omits
  `project`. (WP3)
- **CLI 1.1.0 → 1.2.0.** New `--project` flag, expanded usage text, export of `captureSingleThought`
  for programmatic use. (WP4)
- `match_thoughts` is now part of the migration system (migration 008) — previously it only lived
  in `mcp-server/sql/match_thoughts.sql`, applied manually. Fresh Supabase deploys get it
  automatically. The `mcp-server/sql/match_thoughts.sql` file is deprecated as a pointer to the
  migration. (WP1)

### Fixed

- **Self-match in near-duplicate detection.** `find_near_dups` now accepts `exclude_id` (uuid)
  so the just-inserted thought is excluded from its own near-dup candidates. (PR #14 review)
- **Embedding format for RPC calls.** JSON.stringify() the embedding array before passing to
  `supabase.rpc()`, matching the convention used by detect-contradictions and semantic-search.
  (PR #14 review)
- **Empty-string project.** Blank/whitespace `project` is treated as null (coalesces to
  `metadata.project` then null). (PR #14 review)
- **NaN threshold safety.** Validation ensures `NEAR_DUP_THRESHOLD` is a number in (0, 1];
  NaN or out-of-range falls back to 0.92. (PR #14 review)

### Migrations

- `008_project_salience_supersedes.sql` — Additive DDL (`ADD COLUMN IF NOT EXISTS`,
  `CREATE INDEX IF NOT EXISTS`): `project`, `salience`, `supersedes_id`, `retrieval_count`,
  `last_retrieved_at`. Also establishes `match_thoughts` (SECURITY DEFINER, GRANT TO anon)
  in the migration system. Backfills `project` from `metadata->>'project'`.
- `009_hybrid_ranking.sql` — `match_thoughts_v2` with hybrid ranking (SECURITY DEFINER,
  GRANT TO anon). Additive only — does NOT redefine `match_thoughts`.
- `010_near_dup.sql` — `find_near_dups(embedding, similarity_threshold, match_count, exclude_id)`
  RPC (SECURITY DEFINER, GRANT TO anon).
- `011_track_retrieval.sql` — `increment_retrieval(ids uuid[])` RPC (SECURITY DEFINER,
  GRANT TO anon).

### Upgrading from v0.4.x

1. Pull this branch; rebuild `mcp-server` and `cli` (`npm install && npm run build` in each).
2. Apply migrations 008–011 against a **preview branch** first (see the smoke-test recipe in README.md).
   Migrations are strictly additive — no column drops or type changes.
3. Verify `match_thoughts` was created by migration 008: run `SELECT * FROM information_schema.routines
WHERE routine_name = 'match_thoughts'` in the SQL editor.
4. Deploy the updated edge function:
   ```bash
   supabase functions deploy capture-thought --use-api
   supabase functions deploy run-nightly-jobs --use-api
   ```
5. Restart Claude Code. The MCP server picks up 15 tools on next launch.
6. Optional: set `OPEN_BRAIN_DEFAULT_PROJECT` in your workspace's `.mcp.json` to pin memory scope.
7. Optional: set up nightly cron per `docs/cron-setup.sql` (requires pg_cron + pg_net).

### Cross-repo follow-ups (not part of this release)

- A separate PR on `dagonet/claude-code-toolkit` will sync each variant's `CLAUDE.md`,
  `CLAUDE.local.md`, skill files, and agent definitions to reference the 15th tool (`thoughts_supersede`)
  alongside existing `thoughts_*` references, and document the new search/capture/recent params
  and `OPEN_BRAIN_DEFAULT_PROJECT` env var.

## [0.4.1] - 2026-06-05

Inspired by Andrej Karpathy's [LLM Wiki gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
via Nate B Jones' [video](https://www.youtube.com/watch?v=dxq7WtWxi44).

### Fixed

- **Wiki citation fidelity at large clusters.** `compile-wiki` previously asked the
  model to echo full 36-char thought UUIDs into its `citations` array. OpenAI
  Structured Outputs `strict` mode enforces the UUID _shape_ but not set
  membership, so at ~80-thought clusters the model emitted plausible-but-invented
  UUIDs; the old whole-paragraph drop then amplified this into near-empty pages
  (one 80-thought topic compiled to 3 cited sources, `partial=true`). The model
  now cites by a small bracketed `[n]` index shown next to each note and the
  server maps the index back to a UUID — citation validity went from a handful of
  survivors to **100%** on the same cluster.
- **Graceful citation salvage.** Out-of-range indices are stripped individually
  and a paragraph survives if it retains ≥1 valid citation (was: drop the entire
  paragraph on any bad citation). Inline `[n]` markers the model echoes into prose
  are stripped at render time.

### Added

- **`citation_validity`** (valid / attempted citations) in the `compile-wiki`
  response as the fidelity signal — distinct from cluster-coverage, which is a
  synthesis property, not a defect. Response also reports `cited`, `cluster_size`,
  and `model`; a low-validity warning is logged.
- **`WIKI_COMPILE_MODEL`** env var (default `gpt-4o-mini`) to escalate the compile
  model without code changes.

## [0.4.0] - 2026-04-30

Inspired by Andrej Karpathy's [LLM Wiki gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
via Nate B Jones' [GraphRAG tutorial](https://www.youtube.com/watch?v=dxq7WtWxi44).

### Added

- **Entity descriptions.** A parallel LLM extraction call during capture writes
  rich descriptions for key entities (people, projects, technologies) into a new
  `entity_descriptions` table. Fails gracefully — doesn't block thought capture.
- **Contradiction graph visualization.** New `/graph` route in the web dashboard
  with a force-directed SVG graph. Nodes = thoughts (colored by type, sized by
  contradiction count); edges = contradiction pairs (weighted by severity).
  Click any node or edge to see details in a slide-out panel.
- **Graph nav item** in the sidebar.

### Changed

- `_shared/process-thought.ts` now runs `extractEntityDescriptions` in parallel
  with embedding and metadata extraction via `Promise.allSettled`.

### Migrations

- `007_entity_descriptions.sql` — strictly additive; new `entity_descriptions`
  table with FK to `thoughts` and RLS anon SELECT policy.

## [0.3.0] - 2026-04-26

Inspired by Andrej Karpathy's [LLM Wiki gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
via Nate B Jones' [Karpathy's Wiki vs Open Brain](https://www.youtube.com/watch?v=dxq7WtWxi44).

### Added

- **Wiki layer.** New `compile-wiki` edge function compiles a markdown page per
  topic slug from the user's captured thoughts. Every paragraph cites the
  thought IDs it was drawn from; citations are validated against the input set
  with a one-shot retry. Pages are append-only versioned; the latest version
  per slug is exposed via the `current_wiki_pages` view.
- **Contradiction surfacing.** New `detect-contradictions` edge function walks
  recent thoughts, finds embedding-similar pairs, and asks an LLM judge whether
  each pair contradicts. Surfaces results in a new `contradictions` table with
  `severity` (1–5) and `confidence` (0–1) columns and a functional unique
  index for unordered-pair dedupe.
- **Six new MCP tools** in `mcp-server@0.3.0`: `wiki_get`, `wiki_list`,
  `wiki_refresh`, `contradictions_list`, `contradictions_resolve`,
  `contradictions_audit`.
- **CLI:** `brain wiki get|list|refresh|reject` and `brain audit [--resolve …]`
  subcommands.
- **Web dashboard:** new `/wiki` (list + `[slug]` detail with inline source
  quotes, staleness banner, "Reject this page" form) and `/contradictions`
  (list + `[id]` detail with resolve form) routes. Layout footer attributes
  the inspiration chain.
- **Per-repo opt-out.** `OPEN_BRAIN_TOOLS_DISABLED=wiki,contradictions` env var
  in `.mcp.json` silences the wiki and contradictions tool families per
  workspace.
- **Privacy:** `WIKI_TOPIC_DENYLIST` env var (comma-separated slugs) excludes
  matching topics from wiki compilation and contradiction detection on both
  the candidate side and the neighbour side.
- **Tunable decay:** `WIKI_DECAY_DAYS` env var (default `90`) controls the
  recency-decay rate inside `compile-wiki`'s cluster ranking.

### Changed

- The MCP server now ships **conditional wiki-first behaviour**: agents call
  `wiki_list({limit:1})` first; in repos with no wiki content, behaviour is
  unchanged from v0.2.0. In repos with wiki content, agents prefer the
  compiled page when fresh (`stale_since_n_thoughts ≤ 5`,
  `open_contradictions_count = 0`, `compiled_at` ≤ 7 days).
- `_shared/openai.ts` gained a `chatCompletionsStructured` helper that uses
  OpenAI's `response_format: { type: 'json_schema' }` Structured Outputs path
  alongside the existing `json_object` helper.

### Migrations

- `005_wiki.sql` — strictly additive; no `ALTER TABLE thoughts`. Adds:
  - extensions: `unaccent`, `pgcrypto`
  - functions: `slugify(text)`, `thoughts_by_slug(slug, limit)`
  - views: `topic_counts`, `current_wiki_pages`, `wiki_page_staleness`
  - tables: `contradictions`, `wiki_pages`, `wiki_sources`
  - RLS policies for anon SELECT and authenticated SELECT/UPDATE

### Upgrading from v0.2.x

1. Pull this branch; rebuild `mcp-server` and `cli` (`npm install && npm run build` in each).
2. Apply migration `005_wiki.sql` (and `006_contradictions_anon_update.sql`)
   against a Supabase **preview branch** first — see the
   "Upgrading from v0.2.x" section of `README.md` for the 6-step smoke-test
   recipe. Confirm `\d thoughts` is byte-identical before and after.
3. Deploy the new edge functions:
   - `supabase functions deploy compile-wiki`
   - `supabase functions deploy detect-contradictions`
4. Restart Claude Code. The MCP server picks up the new tool list and the
   updated `instructions` on next launch.
5. Optional: run `brain wiki refresh --all` to compile your first wiki pages,
   then visit `/wiki` in the dashboard.
6. Roll back by pinning `mcp-server` to `0.2.0` in `.mcp.json` and skipping the
   migration; old tools and behaviour are unchanged.

### Cross-repo follow-ups (not part of this release)

- A separate PR on `dagonet/claude-code-toolkit` will sync each variant's
  `CLAUDE.md`, `CLAUDE.local.md`, skill files, and agent definitions to
  reference the new `wiki_*` and `contradictions_*` tools alongside the
  existing `thoughts_*` references, and document `OPEN_BRAIN_TOOLS_DISABLED`
  as the per-repo opt-out.

## [0.2.0] - 2026-03-08

- First write tool (`thoughts_capture`) and proactive MCP `instructions`.

## [0.1.0] - 2026-03-04

- Initial release: capture-thought edge function, CLI, MCP server with 6 read
  tools, Slack webhook integration.
