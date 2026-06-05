# Changelog

All notable changes to Open Brain are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.1] - 2026-06-05

Inspired by Andrej Karpathy's [LLM Wiki gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
via Nate B Jones' [video](https://www.youtube.com/watch?v=dxq7WtWxi44).

### Fixed

- **Wiki citation fidelity at large clusters.** `compile-wiki` previously asked the
  model to echo full 36-char thought UUIDs into its `citations` array. OpenAI
  Structured Outputs `strict` mode enforces the UUID *shape* but not set
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
