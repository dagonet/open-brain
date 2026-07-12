-- Migration 014: Entity graph -- co-occurrence views + entity-search RPCs
--
-- STRICTLY ADDITIVE. Creates two derived views (entity_nodes, entity_edges)
-- and three RPCs (entity_search, entity_neighbors, related_thoughts_via_entities)
-- atop the existing entity_descriptions table. No ALTER on existing tables.
--
-- entity_nodes: canonically-keyed entities aggregated from entity_descriptions
-- entity_edges: co-occurrence pairs (thought co-appearance) with DISTINCT weight
-- entity_search: ILIKE-based entity lookup across display_name / entity_type
-- entity_neighbors: 1-hop neighborhood via co-occurrence edges (DEPTH 1 ONLY)
-- related_thoughts_via_entities: thought-level similarity via shared entities
--   with inverse-frequency scoring and hub-suppression (max_entity_degree gate).
--
-- Inspired by Andrej Karpathy's LLM Wiki gist
--   https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
-- via Nate B Jones
--   https://www.youtube.com/watch?v=dxq7WtWxi44

-- ---------------------------------------------------------------------------
-- 1. entity_nodes -- canonical entity aggregate view
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW entity_nodes AS
SELECT
  lower(trim(ed.entity_name)) AS entity_key,
  mode() WITHIN GROUP (ORDER BY ed.entity_name) AS display_name,
  mode() WITHIN GROUP (ORDER BY ed.entity_type) AS entity_type,
  count(*) AS mention_count,
  count(DISTINCT ed.thought_id) AS thought_count,
  array_agg(DISTINCT ed.thought_id) AS thought_ids,
  max(ed.created_at) AS last_mentioned_at
FROM entity_descriptions ed
JOIN thoughts t ON t.id = ed.thought_id AND t.deleted_at IS NULL
GROUP BY lower(trim(ed.entity_name));

-- ---------------------------------------------------------------------------
-- 2. entity_edges -- co-occurrence pair view
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW entity_edges AS
WITH n AS (
  SELECT thought_id, lower(trim(entity_name)) AS entity_key
  FROM entity_descriptions
)
SELECT
  a.entity_key AS source_key,
  b.entity_key AS target_key,
  count(DISTINCT a.thought_id) AS weight,
  array_agg(DISTINCT a.thought_id) AS shared_thought_ids
FROM n a
JOIN n b ON a.thought_id = b.thought_id AND a.entity_key < b.entity_key
JOIN thoughts t ON t.id = a.thought_id AND t.deleted_at IS NULL
GROUP BY a.entity_key, b.entity_key;

-- ---------------------------------------------------------------------------
-- 3. entity_search RPC -- ILIKE-based entity lookup
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION entity_search(
  query_text text,
  filter_type text DEFAULT NULL,
  result_limit int DEFAULT 20
)
RETURNS SETOF entity_nodes
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT *
  FROM entity_nodes en
  WHERE en.display_name ILIKE '%' || query_text || '%'
    AND (filter_type IS NULL OR en.entity_type = filter_type)
  ORDER BY en.thought_count DESC, en.mention_count DESC
  LIMIT result_limit;
$$;

-- ---------------------------------------------------------------------------
-- 4. entity_neighbors RPC -- 1-hop neighborhood via co-occurrence edges
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION entity_neighbors(
  seed_key text,
  max_nodes int DEFAULT 50
)
RETURNS TABLE(
  source_key text,
  target_key text,
  weight bigint,
  display_name text,
  entity_type text,
  thought_count bigint
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    ee.source_key,
    ee.target_key,
    ee.weight,
    en.display_name,
    en.entity_type,
    en.thought_count
  FROM entity_edges ee
  JOIN entity_nodes en ON en.entity_key = CASE
    WHEN ee.source_key = lower(trim(seed_key)) THEN ee.target_key
    ELSE ee.source_key
  END
  WHERE ee.source_key = lower(trim(seed_key))
     OR ee.target_key = lower(trim(seed_key))
  ORDER BY ee.weight DESC
  LIMIT max_nodes;
$$;

-- ---------------------------------------------------------------------------
-- 5. related_thoughts_via_entities RPC -- thought similarity via shared
--    entities with inverse-frequency scoring and hub-suppression.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION related_thoughts_via_entities(
  seed_thought_ids uuid[],
  result_limit int DEFAULT 10,
  max_entity_degree int DEFAULT 20
)
RETURNS TABLE(thought_id uuid, raw_text text, score float)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH seed_entities AS (
    SELECT DISTINCT lower(trim(ed.entity_name)) AS entity_key
    FROM entity_descriptions ed
    WHERE ed.thought_id = ANY(seed_thought_ids)
  ),
  neighbor_entities AS (
    SELECT DISTINCT
      CASE
        WHEN ee.source_key IN (SELECT entity_key FROM seed_entities) THEN ee.target_key
        ELSE ee.source_key
      END AS entity_key
    FROM entity_edges ee
    WHERE ee.source_key IN (SELECT entity_key FROM seed_entities)
       OR ee.target_key IN (SELECT entity_key FROM seed_entities)
  ),
  -- Hub-suppression (a): exclude bridging entities whose global mention
  -- count exceeds the max_entity_degree threshold.
  filtered_neighbors AS (
    SELECT ne.entity_key, en.thought_count
    FROM neighbor_entities ne
    JOIN entity_nodes en ON en.entity_key = ne.entity_key
    WHERE en.thought_count <= max_entity_degree
  ),
  candidate_thoughts AS (
    SELECT ed.thought_id, fn.entity_key, fn.thought_count
    FROM entity_descriptions ed
    JOIN filtered_neighbors fn ON fn.entity_key = lower(trim(ed.entity_name))
    WHERE ed.thought_id <> ALL(seed_thought_ids)
  ),
  -- Hub-suppression (b): inverse-frequency scoring — a rare shared entity
  -- outranks a hub. Each bridging entity contributes 1/thought_count.
  scored AS (
    SELECT
      ct.thought_id,
      t.raw_text,
      SUM(1.0 / ct.thought_count::float) AS score
    FROM candidate_thoughts ct
    JOIN thoughts t ON t.id = ct.thought_id
    WHERE t.deleted_at IS NULL
      AND t.lifecycle_status NOT IN ('archived', 'superseded')
    GROUP BY ct.thought_id, t.raw_text
  )
  SELECT s.thought_id, s.raw_text, s.score
  FROM scored s
  ORDER BY s.score DESC
  LIMIT result_limit;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Grants
-- ---------------------------------------------------------------------------

GRANT SELECT ON entity_nodes TO anon, authenticated;
GRANT SELECT ON entity_edges TO anon, authenticated;

GRANT EXECUTE ON FUNCTION entity_search(text, text, int) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION entity_neighbors(text, int) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION related_thoughts_via_entities(uuid[], int, int) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Rollback
--
-- DROP FUNCTION IF EXISTS related_thoughts_via_entities(uuid[],int,int);
-- DROP FUNCTION IF EXISTS entity_neighbors(text,int);
-- DROP FUNCTION IF EXISTS entity_search(text,text,int);
-- DROP VIEW IF EXISTS entity_edges;
-- DROP VIEW IF EXISTS entity_nodes;
-- ---------------------------------------------------------------------------
