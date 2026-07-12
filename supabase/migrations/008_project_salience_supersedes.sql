-- Migration 008: Project, salience, supersedes columns + establish match_thoughts
-- in the migration system.
--
-- This migration is STRICTLY ADDITIVE. It adds columns and indexes to thoughts
-- and moves match_thoughts from mcp-server/sql/match_thoughts.sql (previously
-- applied manually on live deployments) into the migration system so fresh
-- Supabase deploys get the function automatically.
--
-- Idempotent on live deployments: DROP IF EXISTS on the function, CREATE OR
-- REPLACE on its body, and the backfill targets only rows where project IS NULL.
--
-- Inspired by Andrej Karpathy's LLM Wiki gist
--   https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
-- via Nate B Jones
--   https://www.youtube.com/watch?v=dxq7WtWxi44

-- ---------------------------------------------------------------------------
-- 1. New columns on thoughts
-- ---------------------------------------------------------------------------

ALTER TABLE thoughts ADD COLUMN project text;
ALTER TABLE thoughts ADD COLUMN salience smallint CHECK (salience BETWEEN 1 AND 5);
ALTER TABLE thoughts ADD COLUMN supersedes_id uuid REFERENCES thoughts(id);
ALTER TABLE thoughts ADD COLUMN retrieval_count integer NOT NULL DEFAULT 0;
ALTER TABLE thoughts ADD COLUMN last_retrieved_at timestamptz;

CREATE INDEX idx_thoughts_project ON thoughts (project);
CREATE INDEX idx_thoughts_supersedes ON thoughts (supersedes_id);

-- ---------------------------------------------------------------------------
-- 2. Establish match_thoughts in the migration system
--
-- Previously this function lived only in mcp-server/sql/match_thoughts.sql and
-- was applied manually. Fresh Supabase deploys had no match_thoughts, which
-- broke the detect-contradictions edge function. Now it ships as part of the
-- migration chain.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS match_thoughts(vector,int,text,text[],text[],int);

CREATE OR REPLACE FUNCTION match_thoughts(
  query_embedding vector(1536),
  match_count int DEFAULT 10,
  filter_thought_type text DEFAULT NULL,
  filter_people text[] DEFAULT NULL,
  filter_topics text[] DEFAULT NULL,
  filter_days int DEFAULT NULL
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
  similarity float
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    t.id, t.raw_text, t.thought_type, t.people, t.topics,
    t.action_items, t.action_items_resolved, t.source,
    t.processing_status, t.metadata, t.created_at, t.updated_at,
    1 - (t.embedding <=> query_embedding) AS similarity
  FROM thoughts t
  WHERE t.deleted_at IS NULL
    AND t.embedding IS NOT NULL
    AND (filter_thought_type IS NULL OR t.thought_type = filter_thought_type)
    AND (filter_people IS NULL OR t.people && filter_people)
    AND (filter_topics IS NULL OR t.topics && filter_topics)
    AND (filter_days IS NULL OR t.created_at > now() - make_interval(days => filter_days))
  ORDER BY t.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Backfill project from existing metadata
-- ---------------------------------------------------------------------------

UPDATE thoughts SET project = metadata->>'project'
WHERE metadata->>'project' IS NOT NULL AND project IS NULL;

-- ---------------------------------------------------------------------------
-- Rollback
--
-- Migration 009 replaces match_thoughts with a backward-compat wrapper.
-- To fully revert the 008+009 pair:
--   1. Roll back 009 first (drops match_thoughts_v2, restores match_thoughts v1)
--   2. Then roll back 008:
--
-- DROP INDEX IF EXISTS idx_thoughts_supersedes;
-- DROP INDEX IF EXISTS idx_thoughts_project;
-- ALTER TABLE thoughts DROP COLUMN last_retrieved_at;
-- ALTER TABLE thoughts DROP COLUMN retrieval_count;
-- ALTER TABLE thoughts DROP COLUMN supersedes_id;
-- ALTER TABLE thoughts DROP COLUMN salience;
-- ALTER TABLE thoughts DROP COLUMN project;
-- DROP FUNCTION IF EXISTS match_thoughts(vector,int,text,text[],text[],int);
-- ---------------------------------------------------------------------------
