-- Migration 015: Entity quality -- noise filter for entity graph views
--
-- ADDITIVE. Creates one function (is_code_path) and replaces two views
-- (entity_nodes, entity_edges) to exclude file-path entities and generic
-- tooling tokens from the entity graph.
--
-- entity_descriptions (the source table) is untouched -- data is never
-- destroyed, only filtered from the derived views.
--
-- Noise sources eliminated:
--   1. File-path entities ending in code extensions (.ts, .js, .py, etc.)
--   2. Generic tooling/ecosystem tokens (npm, docker, eslint, etc.)
--
-- Inspired by Andrej Karpathy's LLM Wiki gist
--   https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
-- via Nate B Jones
--   https://www.youtube.com/watch?v=dxq7WtWxi44

-- ---------------------------------------------------------------------------
-- 1. is_code_path -- detect file-path entities by trailing extension
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION is_code_path(key text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT key ~ '\.(ts|tsx|js|jsx|py|rs|go|java|md|json|sql|sh|ya?ml|toml|css|html)$';
$$;

GRANT EXECUTE ON FUNCTION is_code_path(text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. entity_nodes -- canonical entity aggregate (filtered)
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
WHERE
  NOT is_code_path(lower(trim(ed.entity_name)))
  AND lower(trim(ed.entity_name)) NOT IN (
    'npm','docker','eslint','ci','git','github','bash',
    'vitest','prettier','node','typescript','javascript','python','sql'
  )
GROUP BY lower(trim(ed.entity_name));

-- ---------------------------------------------------------------------------
-- 3. entity_edges -- co-occurrence pair view (filtered in CTE)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW entity_edges AS
-- Filter in the CTE: if an endpoint is noise, the join never forms,
-- so no edge with a noise endpoint survives.
WITH n AS (
  SELECT thought_id, lower(trim(entity_name)) AS entity_key
  FROM entity_descriptions
  WHERE
    NOT is_code_path(lower(trim(entity_name)))
    AND lower(trim(entity_name)) NOT IN (
      'npm','docker','eslint','ci','git','github','bash',
      'vitest','prettier','node','typescript','javascript','python','sql'
    )
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
-- 4. No RPC changes -- entity_search, entity_neighbors, and
--    related_thoughts_via_entities inherit the filtered views via
--    CREATE OR REPLACE VIEW.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Rollback (CAPTURED 2026-07-12):
--
-- DROP FUNCTION IF EXISTS is_code_path(text);
--
-- CREATE OR REPLACE VIEW entity_nodes AS
-- SELECT
--   lower(trim(ed.entity_name)) AS entity_key,
--   mode() WITHIN GROUP (ORDER BY ed.entity_name) AS display_name,
--   mode() WITHIN GROUP (ORDER BY ed.entity_type) AS entity_type,
--   count(*) AS mention_count,
--   count(DISTINCT ed.thought_id) AS thought_count,
--   array_agg(DISTINCT ed.thought_id) AS thought_ids,
--   max(ed.created_at) AS last_mentioned_at
-- FROM entity_descriptions ed
-- JOIN thoughts t ON t.id = ed.thought_id AND t.deleted_at IS NULL
-- GROUP BY lower(trim(ed.entity_name));
--
-- CREATE OR REPLACE VIEW entity_edges AS
-- WITH n AS (
--   SELECT thought_id, lower(trim(entity_name)) AS entity_key
--   FROM entity_descriptions
-- )
-- SELECT
--   a.entity_key AS source_key,
--   b.entity_key AS target_key,
--   count(DISTINCT a.thought_id) AS weight,
--   array_agg(DISTINCT a.thought_id) AS shared_thought_ids
-- FROM n a
-- JOIN n b ON a.thought_id = b.thought_id AND a.entity_key < b.entity_key
-- JOIN thoughts t ON t.id = a.thought_id AND t.deleted_at IS NULL
-- GROUP BY a.entity_key, b.entity_key;
-- ---------------------------------------------------------------------------
