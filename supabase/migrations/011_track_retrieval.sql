-- Migration 011: Retrieval tracking — increment_retrieval RPC for
-- fire-and-forget access-count updates from the MCP server.
--
-- Used by the thoughts_search tool: after a successful search, it calls
-- increment_retrieval(ids) fire-and-forget so that retrieval_count and
-- last_retrieved_at are updated without blocking the response.
--
-- SECURITY DEFINER so the anon-key service role caller (MCP server via
-- SUPABASE_SERVICE_ROLE_KEY) can update the counters on arbitrary rows
-- without row-level security constraints.
--
-- The GRANT to anon reflects the fact that the MCP server authenticates
-- as the anon role (with SUPABASE_SERVICE_ROLE_KEY overrides), matching
-- the pattern set by match_thoughts / match_thoughts_v2.

CREATE OR REPLACE FUNCTION increment_retrieval(ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE thoughts
  SET
    retrieval_count = retrieval_count + 1,
    last_retrieved_at = now()
  WHERE id = ANY(ids);
END;
$$;

GRANT EXECUTE ON FUNCTION increment_retrieval(uuid[]) TO anon;

-- ---------------------------------------------------------------------------
-- Rollback
--
-- DROP FUNCTION IF EXISTS increment_retrieval(uuid[]);
-- ---------------------------------------------------------------------------
