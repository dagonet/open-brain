-- Migration 004: Add authenticated SELECT policy + composite index for pagination
--
-- Keeps existing anon SELECT policy (003) for sync-vault compatibility.
-- Adds authenticated policy for web dashboard access.
-- Adds composite index for cursor-based pagination on (created_at, id).

-- Authenticated users can read non-deleted thoughts
CREATE POLICY "allow_authenticated_select" ON thoughts
  FOR SELECT TO authenticated USING (deleted_at IS NULL);

-- Composite index for efficient cursor-based pagination
CREATE INDEX idx_thoughts_created_at_id ON thoughts (created_at DESC, id DESC);

-- Helper functions for filter dropdowns (unnest arrays, deduplicate)
CREATE OR REPLACE FUNCTION get_distinct_topics()
RETURNS SETOF text
LANGUAGE sql STABLE
SECURITY DEFINER
AS $$
  SELECT DISTINCT unnest(topics) AS topic
  FROM thoughts
  WHERE deleted_at IS NULL AND topics IS NOT NULL
  ORDER BY topic;
$$;

CREATE OR REPLACE FUNCTION get_distinct_people()
RETURNS SETOF text
LANGUAGE sql STABLE
SECURITY DEFINER
AS $$
  SELECT DISTINCT unnest(people) AS person
  FROM thoughts
  WHERE deleted_at IS NULL AND people IS NOT NULL
  ORDER BY person;
$$;
