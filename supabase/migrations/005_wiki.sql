-- Migration 005: Wiki layer + contradiction surfacing.
--
-- This migration is STRICTLY ADDITIVE. It does NOT ALTER, RENAME, RE-EMBED,
-- or otherwise modify any existing row in the `thoughts` table. A reviewer
-- can verify this with `git diff` showing only CREATE statements below.
--
-- Inspired by Andrej Karpathy's LLM Wiki gist
--   https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
-- via Nate B Jones
--   https://www.youtube.com/watch?v=dxq7WtWxi44

CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Slug helper + topic counts view (replace a topic_slugs dimension table)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION slugify(input text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(
    regexp_replace(lower(unaccent(coalesce(input, ''))), '[^a-z0-9]+', '-', 'g'),
    '^-+|-+$', '', 'g'
  );
$$;

CREATE OR REPLACE VIEW topic_counts AS
  SELECT
    slugify(t)             AS slug,
    t                      AS display_name,
    count(*)::int          AS thought_count,
    min(created_at)        AS first_seen,
    max(created_at)        AS last_seen
  FROM thoughts, unnest(topics) AS t
  WHERE deleted_at IS NULL
  GROUP BY slugify(t), t;

-- Helper: thoughts whose any topic slugifies to `in_slug`.
-- Used by `compile-wiki` to gather the cluster for a wiki page.
-- DISTINCT is needed because a thought can match the slug via multiple
-- aliased topics (e.g. "Open Brain" and "open-brain").
CREATE OR REPLACE FUNCTION thoughts_by_slug(in_slug text, in_limit int DEFAULT 80)
RETURNS TABLE (
  id              uuid,
  raw_text        text,
  topics          text[],
  embedding_model text,
  created_at      timestamptz
)
LANGUAGE sql STABLE
SECURITY DEFINER
AS $$
  SELECT DISTINCT t.id, t.raw_text, t.topics, t.embedding_model, t.created_at
  FROM thoughts t, unnest(t.topics) AS topic_name
  WHERE t.deleted_at IS NULL
    AND t.embedding IS NOT NULL
    AND slugify(topic_name) = in_slug
  ORDER BY t.created_at DESC
  LIMIT in_limit;
$$;

-- ---------------------------------------------------------------------------
-- Contradictions
-- ---------------------------------------------------------------------------

CREATE TABLE contradictions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  thought_a_id    uuid        NOT NULL,    -- intentionally no FK: thoughts are soft-deleted
  thought_b_id    uuid        NOT NULL,
  reason          text        NOT NULL,
  severity        smallint    NOT NULL CHECK (severity BETWEEN 1 AND 5),
  confidence      real        NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  status          text        NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open', 'resolved', 'ignored', 'false_positive')),
  embedding_model text        NOT NULL,
  idempotency_key text        UNIQUE,
  detected_at     timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz
);

-- Functional unique index for unordered-pair dedupe.
-- (Cannot live as a table-level UNIQUE constraint in Postgres.)
CREATE UNIQUE INDEX contradictions_pair_uniq ON contradictions
  (LEAST(thought_a_id, thought_b_id), GREATEST(thought_a_id, thought_b_id));

CREATE INDEX contradictions_status_detected_at_desc
  ON contradictions (status, detected_at DESC);

ALTER TABLE contradictions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read access to contradictions"
  ON contradictions FOR SELECT USING (true);

CREATE POLICY "allow_authenticated_select_contradictions"
  ON contradictions FOR SELECT TO authenticated USING (true);

CREATE POLICY "allow_authenticated_update_contradictions"
  ON contradictions FOR UPDATE TO authenticated USING (true);

-- ---------------------------------------------------------------------------
-- Wiki pages (append-only versions; latest-by-slug found via window query —
-- no `is_current` column, so no partial UNIQUE flip race.)
-- ---------------------------------------------------------------------------

CREATE TABLE wiki_pages (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                  text        NOT NULL,
  version               int         NOT NULL,
  content_md            text        NOT NULL,
  -- v4 dropped wiki_pages.embedding column (YAGNI; add when wiki_search ships).
  embedding_model       text        NOT NULL,
  embedding_dimensions  int         NOT NULL CHECK (embedding_dimensions = 1536),
  source_thought_count  int         NOT NULL,
  oldest_source_at      timestamptz,
  newest_source_at      timestamptz,
  partial               boolean     NOT NULL DEFAULT false,  -- true if citation validator dropped paragraphs
  idempotency_key       text        UNIQUE,
  compiled_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (slug, version)
);

CREATE INDEX wiki_pages_slug_version_desc
  ON wiki_pages (slug, version DESC);

CREATE INDEX wiki_pages_compiled_at_desc
  ON wiki_pages (compiled_at DESC);

ALTER TABLE wiki_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read access to wiki pages"
  ON wiki_pages FOR SELECT USING (true);

CREATE POLICY "allow_authenticated_select_wiki_pages"
  ON wiki_pages FOR SELECT TO authenticated USING (true);

CREATE TABLE wiki_sources (
  page_id    uuid NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
  thought_id uuid NOT NULL,    -- intentionally no FK (soft-delete on thoughts)
  PRIMARY KEY (page_id, thought_id)
);

ALTER TABLE wiki_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read access to wiki sources"
  ON wiki_sources FOR SELECT USING (true);

CREATE POLICY "allow_authenticated_select_wiki_sources"
  ON wiki_sources FOR SELECT TO authenticated USING (true);

-- ---------------------------------------------------------------------------
-- Helper view: latest wiki page per slug (avoids window query in hot reads)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW current_wiki_pages AS
  SELECT DISTINCT ON (slug) *
  FROM wiki_pages
  ORDER BY slug, version DESC;

-- ---------------------------------------------------------------------------
-- Helper view: per-slug staleness (new thoughts on this topic since compile)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW wiki_page_staleness AS
  SELECT
    cwp.id                                        AS page_id,
    cwp.slug                                      AS slug,
    cwp.version                                   AS version,
    cwp.compiled_at                               AS compiled_at,
    coalesce((
      -- count(DISTINCT) so a thought tagged with multiple aliased topics
      -- (e.g. "Open Brain" and "open-brain") that all slugify to the same
      -- value is counted once, not once per matching topic string.
      SELECT count(DISTINCT t.id)::int
      FROM thoughts t, unnest(t.topics) AS topic_name
      WHERE t.deleted_at IS NULL
        AND slugify(topic_name) = cwp.slug
        AND t.created_at > cwp.compiled_at
    ), 0)                                         AS stale_since_n_thoughts,
    coalesce((
      SELECT count(*)::int
      FROM contradictions c, wiki_sources ws
      WHERE ws.page_id = cwp.id
        AND c.status = 'open'
        AND (ws.thought_id = c.thought_a_id OR ws.thought_id = c.thought_b_id)
    ), 0)                                         AS open_contradictions_count
  FROM current_wiki_pages cwp;
