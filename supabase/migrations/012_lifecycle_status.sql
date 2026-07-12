-- Migration 012: Lifecycle status -- archive, supersede, and consolidate RPCs.
--
-- This migration is ADDITIVE. Column/index are IF NOT EXISTS; the match_thoughts_v2
-- extension DROPs the old 10-param function and creates an 11-param version.
--
-- Inspired by Andrej Karpathy's LLM Wiki gist
--   https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
-- via Nate B Jones
--   https://www.youtube.com/watch?v=dxq7WtWxi44

-- ---------------------------------------------------------------------------
-- 1. lifecycle_status column + index
-- ---------------------------------------------------------------------------

ALTER TABLE thoughts ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'active'
  CHECK (lifecycle_status IN ('active', 'superseded', 'archived'));

CREATE INDEX IF NOT EXISTS idx_thoughts_lifecycle_status
  ON thoughts (lifecycle_status)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. Backfill: mark thoughts that have been superseded
-- ---------------------------------------------------------------------------

UPDATE thoughts
SET lifecycle_status = 'superseded'
WHERE lifecycle_status = 'active'
  AND id IN (
    SELECT supersedes_id
    FROM thoughts
    WHERE supersedes_id IS NOT NULL AND deleted_at IS NULL
  );

-- ---------------------------------------------------------------------------
-- 3. Extend match_thoughts_v2 with lifecycle_status awareness
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS match_thoughts_v2(
  vector(1536), int, text, text[], text[], int, text, int, boolean, boolean
);

CREATE OR REPLACE FUNCTION match_thoughts_v2(
  query_embedding vector(1536),
  match_count int DEFAULT 10,
  filter_thought_type text DEFAULT NULL,
  filter_people text[] DEFAULT NULL,
  filter_topics text[] DEFAULT NULL,
  filter_days int DEFAULT NULL,
  filter_project text DEFAULT NULL,
  recency_halflife_days int DEFAULT 30,
  include_superseded boolean DEFAULT false,
  apply_contradiction_penalty boolean DEFAULT true,
  include_archived boolean DEFAULT false
)
RETURNS TABLE (
  id uuid,
  raw_text text,
  thought_type text,
  people text[],
  topics text[],
  action_items text[],
  action_items_resolved boolean,
  source text,
  processing_status text,
  metadata jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  similarity float,
  project text,
  salience smallint,
  score float,
  lifecycle_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT
      t.id, t.raw_text, t.thought_type, t.people, t.topics,
      t.action_items, t.action_items_resolved, t.source,
      t.processing_status, t.metadata, t.created_at, t.updated_at,
      t.project, t.salience,
      t.lifecycle_status,
      1 - (t.embedding <=> query_embedding) AS cosine_sim
    FROM thoughts t
    WHERE t.deleted_at IS NULL
      AND t.embedding IS NOT NULL
      AND (filter_thought_type IS NULL OR t.thought_type = filter_thought_type)
      AND (filter_people IS NULL OR t.people && filter_people)
      AND (filter_topics IS NULL OR t.topics && filter_topics)
      AND (filter_days IS NULL OR t.created_at > now() - make_interval(days => filter_days))
      AND (filter_project IS NULL OR t.project = filter_project)
      AND (include_superseded OR NOT EXISTS (
        SELECT 1 FROM thoughts s WHERE s.supersedes_id = t.id AND s.deleted_at IS NULL))
      AND (include_archived OR t.lifecycle_status != 'archived')
    ORDER BY t.embedding <=> query_embedding
    LIMIT GREATEST(match_count * 4, 50)
  )
  SELECT
    c.id, c.raw_text, c.thought_type, c.people, c.topics,
    c.action_items, c.action_items_resolved, c.source,
    c.processing_status, c.metadata, c.created_at, c.updated_at,
    c.cosine_sim AS similarity,
    c.project,
    c.salience,
    c.cosine_sim
      * GREATEST(
          exp(-ln(2.0) * EXTRACT(epoch FROM now() - c.created_at) / 86400.0
            / (recency_halflife_days * CASE WHEN c.thought_type IN ('decision','insight') THEN 2.0 ELSE 1.0 END)
          ),
          0.05
        )
      * (0.7 + COALESCE(c.salience::float, 3.0) * 0.1)
      * CASE
          WHEN apply_contradiction_penalty AND EXISTS (
            SELECT 1 FROM contradictions c2
            WHERE c2.status = 'open'
              AND (c2.thought_a_id = c.id OR c2.thought_b_id = c.id)
          ) THEN 0.7
          ELSE 1.0
        END
      AS score,
    c.lifecycle_status
  FROM candidates c
  ORDER BY score DESC
  LIMIT match_count;
END;
$$;

GRANT EXECUTE ON FUNCTION match_thoughts_v2(
  vector(1536), int, text, text[], text[], int, text, int, boolean, boolean, boolean
) TO anon;

-- archive_thoughts
CREATE OR REPLACE FUNCTION archive_thoughts(
  resolved_action_days int DEFAULT 90,
  cold_days int DEFAULT 180
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  n1 int;
  n2 int;
BEGIN
  UPDATE thoughts
  SET lifecycle_status = 'archived'
  WHERE lifecycle_status = 'active'
    AND thought_type = 'action'
    AND action_items_resolved = true
    AND updated_at < now() - make_interval(days => resolved_action_days);
  GET DIAGNOSTICS n1 = ROW_COUNT;
  UPDATE thoughts
  SET lifecycle_status = 'archived'
  WHERE lifecycle_status = 'active'
    AND thought_type IN ('note', 'question', 'reference')
    AND retrieval_count = 0
    AND created_at < now() - make_interval(days => cold_days);
  GET DIAGNOSTICS n2 = ROW_COUNT;
  RETURN jsonb_build_object('rule1_archived', n1, 'rule2_archived', n2);
END;
$$;

GRANT EXECUTE ON FUNCTION archive_thoughts(int, int) TO anon;

-- consolidation_candidates
CREATE OR REPLACE FUNCTION consolidation_candidates(
  min_thoughts int DEFAULT 3,
  result_limit int DEFAULT 5
)
RETURNS TABLE(slug text, thought_count bigint, aggregate_signal float)
LANGUAGE sql
SECURITY DEFINER
AS $$
  WITH grouped AS (
    SELECT
      slugify(topic) AS slug,
      count(*) AS thought_count,
      sum(
        COALESCE(t.salience, 3)::float + COALESCE(t.retrieval_count, 0)
      ) AS aggregate_signal
    FROM thoughts t
    CROSS JOIN LATERAL unnest(t.topics) AS topic
    WHERE t.deleted_at IS NULL
      AND t.lifecycle_status = 'active'
      AND array_length(t.topics, 1) > 0
    GROUP BY slugify(topic)
    HAVING count(*) >= min_thoughts
  )
  SELECT g.slug, g.thought_count, g.aggregate_signal
  FROM grouped g
  WHERE NOT EXISTS (
    SELECT 1 FROM current_wiki_pages wp WHERE wp.slug = g.slug
  )
  ORDER BY g.aggregate_signal DESC
  LIMIT result_limit;
$$;

GRANT EXECUTE ON FUNCTION consolidation_candidates(int, int) TO anon;

-- ---------------------------------------------------------------------------
-- Rollback
--
-- DROP FUNCTION IF EXISTS consolidation_candidates(int,int);
-- DROP FUNCTION IF EXISTS archive_thoughts(int,int);
-- DROP FUNCTION IF EXISTS match_thoughts_v2(vector(1536),int,text,text[],text[],int,text,int,boolean,boolean,boolean);
-- CREATE OR REPLACE FUNCTION match_thoughts_v2(vector(1536),int,text,text[],text[],int,text,int,boolean,boolean) ... (from 009)
-- GRANT EXECUTE ON FUNCTION match_thoughts_v2(vector(1536),int,text,text[],text[],int,text,int,boolean,boolean) TO anon;
-- DROP INDEX IF EXISTS idx_thoughts_lifecycle_status;
-- ALTER TABLE thoughts DROP COLUMN IF EXISTS lifecycle_status;
-- ---------------------------------------------------------------------------
