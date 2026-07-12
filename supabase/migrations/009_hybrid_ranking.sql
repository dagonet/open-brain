-- Migration 009: Hybrid ranking — match_thoughts_v2 with recency, salience, and
-- contradiction-penalty scoring (HNSW over-fetch + re-rank pattern).
--
-- The blended ORDER BY (score = cosine_sim * recency * salience * penalty)
-- cannot use the vector index directly. We over-fetch from the HNSW index
-- (LIMIT max(4*match_count, 50)), then re-rank with the full scoring formula.
--
-- This migration ONLY adds match_thoughts_v2. The original match_thoughts
-- (pure cosine similarity, established in migration 008) is UNCHANGED so that
-- existing callers like detect-contradictions continue using pure-cosine search.
-- Callers migrate to match_thoughts_v2 deliberately in later workstreams.
--
-- SECURITY DEFINER matches the pattern set by thoughts_by_slug in migration 005.
--
-- Recency uses a true half-life formula: exp(-ln(2) * age_days / halflife).
-- At the default recency_halflife_days=30, a 30-day-old thought scores 0.5x.
-- The 0.05 floor ensures old but salient decision/insight thoughts stay reachable.
--
-- Inspired by Andrej Karpathy's LLM Wiki gist
--   https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
-- via Nate B Jones
--   https://www.youtube.com/watch?v=dxq7WtWxi44

-- ---------------------------------------------------------------------------
-- 1. match_thoughts_v2: hybrid ranking function
-- ---------------------------------------------------------------------------

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
  apply_contradiction_penalty boolean DEFAULT true
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
  score float
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
      AS score
  FROM candidates c
  ORDER BY score DESC
  LIMIT match_count;
END;
$$;

GRANT EXECUTE ON FUNCTION match_thoughts_v2(vector(1536),int,text,text[],text[],int,text,int,boolean,boolean) TO anon;

-- ---------------------------------------------------------------------------
-- Rollback
--
-- DROP FUNCTION IF EXISTS match_thoughts_v2(vector(1536),int,text,text[],text[],int,text,int,boolean,boolean);
-- ---------------------------------------------------------------------------
