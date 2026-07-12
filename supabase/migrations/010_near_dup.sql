-- Migration 010: Near-duplicate detection RPC for the capture pipeline.
--
-- Provides find_near_dups, a lightweight RPC that finds recent (≤ 30 day)
-- thoughts with high cosine similarity to a given embedding. Used by
-- process-thought.ts after insertion to surface potential near-duplicates
-- to the caller (CLI or MCP tool) as a hint — the new thought is ALWAYS
-- inserted; there is no silent dedup here.
--
-- SECURITY DEFINER matches the pattern set by thoughts_by_slug in migration 005.
--
-- Implicitly references the NEAR_DUP_THRESHOLD env var (default 0.92 in the
-- edge function); this function receives the threshold as a parameter so it
-- stays pure SQL without hard-coding application defaults.
--
-- Inspired by Andrej Karpathy's LLM Wiki gist
--   https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
-- via Nate B Jones
--   https://www.youtube.com/watch?v=dxq7WtWxi44

-- ---------------------------------------------------------------------------
-- 1. find_near_dups: return top near-duplicate candidates by cosine similarity
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION find_near_dups(
  query_embedding vector(1536),
  similarity_threshold float DEFAULT 0.92,
  match_count int DEFAULT 5,
  exclude_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  raw_text text,
  similarity float
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    t.id,
    t.raw_text,
    1 - (t.embedding <=> query_embedding) AS similarity
  FROM thoughts t
  WHERE t.deleted_at IS NULL
    AND t.embedding IS NOT NULL
    AND t.created_at > now() - interval '30 days'
    AND 1 - (t.embedding <=> query_embedding) > similarity_threshold
    AND (exclude_id IS NULL OR t.id <> exclude_id)
  ORDER BY t.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

GRANT EXECUTE ON FUNCTION find_near_dups(vector(1536),float,int,uuid) TO anon;

-- ---------------------------------------------------------------------------
-- Rollback
--
-- DROP FUNCTION IF EXISTS find_near_dups(vector(1536),float,int,uuid);
-- ---------------------------------------------------------------------------
