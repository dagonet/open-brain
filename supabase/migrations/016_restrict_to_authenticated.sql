-- Migration 016: Tighten database access to authenticated and service-role only.
--
-- The anon key is embedded in the web bundle, so it must not grant any access
-- through PostgREST. After this migration only `authenticated` (the owner's
-- login) and `service_role` can read or write tables, views and RPCs.
--
-- Callers:
--   * web dashboard          -> authenticated (cookie session)
--   * mcp-server, edge fns   -> service_role
--   * CLI (sync, wiki, audit)-> service_role (BRAIN_SERVICE_KEY)
--
-- Idempotent: DROP POLICY IF EXISTS / REVOKE / GRANT / ALTER VIEW can be re-run.
-- Verify afterwards with docs/sql/verify-anon-lockdown.sql.

-- ---------------------------------------------------------------------------
-- 1. Drop policies that apply to anon / PUBLIC
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Allow read access to non-deleted thoughts" ON thoughts;
DROP POLICY IF EXISTS "Allow read access to contradictions" ON contradictions;
DROP POLICY IF EXISTS "Allow anon update on contradictions" ON contradictions;
DROP POLICY IF EXISTS "Allow read access to wiki pages" ON wiki_pages;
DROP POLICY IF EXISTS "Allow read access to wiki sources" ON wiki_sources;
DROP POLICY IF EXISTS "anon_select_entity_descriptions" ON entity_descriptions;
DROP POLICY IF EXISTS "tasks_select_anon" ON tasks;

-- The entity_nodes / entity_edges views (section 3) now run with the caller's
-- rights, so authenticated needs to read entity_descriptions. It previously
-- only had the anon policy. (tasks is not read by the web, so it gets none.)
DROP POLICY IF EXISTS "allow_authenticated_select_entity_descriptions" ON entity_descriptions;
CREATE POLICY "allow_authenticated_select_entity_descriptions"
  ON entity_descriptions FOR SELECT
  TO authenticated
  USING (true);

-- ---------------------------------------------------------------------------
-- 2. Remove the table-level privileges anon was granted
--    (defence in depth: RLS already denies once the policies above are gone)
-- ---------------------------------------------------------------------------

REVOKE ALL ON TABLE thoughts, contradictions, wiki_pages, wiki_sources,
  entity_descriptions, tasks FROM anon;

-- ---------------------------------------------------------------------------
-- 3. Views: run with the caller's rights (default is the view owner's, which
--    bypasses RLS) and close them to anon.
-- ---------------------------------------------------------------------------

ALTER VIEW entity_nodes SET (security_invoker = on);
ALTER VIEW entity_edges SET (security_invoker = on);
ALTER VIEW topic_counts SET (security_invoker = on);
ALTER VIEW current_wiki_pages SET (security_invoker = on);
ALTER VIEW wiki_page_staleness SET (security_invoker = on);

REVOKE ALL ON entity_nodes, entity_edges, topic_counts, current_wiki_pages,
  wiki_page_staleness FROM anon;
GRANT SELECT ON entity_nodes, entity_edges, topic_counts, current_wiki_pages,
  wiki_page_staleness TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Functions: Postgres grants EXECUTE to PUBLIC by default and the
--    SECURITY DEFINER ones bypass RLS, so close every function to anon.
-- ---------------------------------------------------------------------------

-- 4a. Called by the web (authenticated) and server-side code (service_role).
--     slugify and is_code_path are used inside the views above, which now run
--     as the caller, so the caller needs EXECUTE on them.
REVOKE EXECUTE ON FUNCTION get_distinct_topics() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION get_distinct_people() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION slugify(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION is_code_path(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_distinct_topics() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_distinct_people() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION slugify(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION is_code_path(text) TO authenticated, service_role;

-- 4b. Server-side only (mcp-server, edge functions): service_role.
--     authenticated is revoked too: the entity functions were granted to it
--     explicitly in 014; for the others this is a no-op.
REVOKE EXECUTE ON FUNCTION thoughts_by_slug(text, int)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION match_thoughts(vector(1536), int, text, text[], text[], int)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION match_thoughts_v2(
  vector(1536), int, text, text[], text[], int, text, int, boolean, boolean, boolean
) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION find_near_dups(vector(1536), float, int, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION consolidation_candidates(int, int)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION entity_search(text, text, int)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION entity_neighbors(text, int)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION related_thoughts_via_entities(uuid[], int, int)
  FROM PUBLIC, anon, authenticated;
-- Write-capable:
REVOKE EXECUTE ON FUNCTION archive_thoughts(int, int)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION increment_retrieval(uuid[])
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION thoughts_by_slug(text, int) TO service_role;
GRANT EXECUTE ON FUNCTION match_thoughts(vector(1536), int, text, text[], text[], int)
  TO service_role;
GRANT EXECUTE ON FUNCTION match_thoughts_v2(
  vector(1536), int, text, text[], text[], int, text, int, boolean, boolean, boolean
) TO service_role;
GRANT EXECUTE ON FUNCTION find_near_dups(vector(1536), float, int, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION consolidation_candidates(int, int) TO service_role;
GRANT EXECUTE ON FUNCTION entity_search(text, text, int) TO service_role;
GRANT EXECUTE ON FUNCTION entity_neighbors(text, int) TO service_role;
GRANT EXECUTE ON FUNCTION related_thoughts_via_entities(uuid[], int, int) TO service_role;
GRANT EXECUTE ON FUNCTION archive_thoughts(int, int) TO service_role;
GRANT EXECUTE ON FUNCTION increment_retrieval(uuid[]) TO service_role;

-- 4c. Trigger function (privilege is only checked when the trigger is created).
REVOKE EXECUTE ON FUNCTION update_updated_at() FROM PUBLIC, anon;

-- 4d. Future functions created by this role in public: no automatic anon access.
--     authenticated / service_role keep their default grants. Note that
--     `IN SCHEMA` can only remove an explicit default entry (Supabase's anon
--     one); the implicit PUBLIC default is not removed by it, so new functions
--     still need an explicit REVOKE ... FROM PUBLIC.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;

-- 4e. Same for future tables, views and sequences created by this role in
--     public: no automatic anon grant. Like 4d this only removes explicit
--     default entries (Supabase's anon one) for objects created by the role
--     that runs this migration.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;

-- NOTE: a later CREATE OR REPLACE VIEW (or DROP + CREATE) does not carry over
-- security_invoker. Any later view definition must state
-- WITH (security_invoker = on) explicitly.

-- ---------------------------------------------------------------------------
-- Rollback
--
-- Re-creating the removed policies and grants restores the old (open) state;
-- see migrations 003, 005, 006, 007, 013 and the per-function GRANT ... TO anon
-- lines in 008-015. Not recommended: the anon key is public.
-- ---------------------------------------------------------------------------
