-- Migration 008: Project, salience, supersedes columns + establish match_thoughts
-- in the migration system.
--
-- This migration is STRICTLY ADDITIVE. It adds columns and indexes to thoughts
-- and moves match_thoughts from mcp-server/sql/match_thoughts.sql (previously
-- applied manually on live deployments) into the migration system so fresh
-- Supabase deploys get the function automatically.
--
-- Idempotent on live deployments: ADD COLUMN IF NOT EXISTS / CREATE INDEX IF
-- NOT EXISTS on all schema changes; DROP IF EXISTS + CREATE OR REPLACE on the
-- function; backfill targets only rows where project IS NULL.
--
-- Inspired by Andrej Karpathy's LLM Wiki gist
--   https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
-- via Nate B Jones
--   https://www.youtube.com/watch?v=dxq7WtWxi44

-- ---------------------------------------------------------------------------
-- 1. New columns on thoughts
-- ---------------------------------------------------------------------------

ALTER TABLE thoughts ADD COLUMN IF NOT EXISTS project text;
ALTER TABLE thoughts ADD COLUMN IF NOT EXISTS salience smallint CHECK (salience BETWEEN 1 AND 5);
ALTER TABLE thoughts ADD COLUMN IF NOT EXISTS supersedes_id uuid REFERENCES thoughts(id);
ALTER TABLE thoughts ADD COLUMN IF NOT EXISTS retrieval_count integer NOT NULL DEFAULT 0;
ALTER TABLE thoughts ADD COLUMN IF NOT EXISTS last_retrieved_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_thoughts_project ON thoughts (project);
CREATE INDEX IF NOT EXISTS idx_thoughts_supersedes ON thoughts (supersedes_id);

-- ---------------------------------------------------------------------------
-- 2. Establish match_thoughts in the migration system
--
-- SECURITY DEFINER so anon-key callers bypass RLS on the thoughts table
-- (matching the pattern set by thoughts_by_slug in migration 005).
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
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
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

GRANT EXECUTE ON FUNCTION match_thoughts(vector(1536),int,text,text[],text[],int) TO anon;

-- ---------------------------------------------------------------------------
-- 3. Backfill project from existing metadata
-- ---------------------------------------------------------------------------

UPDATE thoughts SET project = metadata->>'project'
WHERE metadata->>'project' IS NOT NULL AND project IS NULL;

-- ---------------------------------------------------------------------------
-- Rollback
--
-- DROP INDEX IF EXISTS idx_thoughts_supersedes;
-- DROP INDEX IF EXISTS idx_thoughts_project;
-- ALTER TABLE thoughts DROP COLUMN IF EXISTS last_retrieved_at;
-- ALTER TABLE thoughts DROP COLUMN IF EXISTS retrieval_count;
-- ALTER TABLE thoughts DROP COLUMN IF EXISTS supersedes_id;
-- ALTER TABLE thoughts DROP COLUMN IF EXISTS salience;
-- ALTER TABLE thoughts DROP COLUMN IF EXISTS project;
-- DROP FUNCTION IF EXISTS match_thoughts(vector,int,text,text[],text[],int);
-- ---------------------------------------------------------------------------
