-- Migration 018: Narrower grants for `authenticated`, is_owner() in a private
-- schema, and a pinned search_path on the SECURITY DEFINER functions.
--
-- Defence in depth on top of migrations 016 and 017 (issue #92, items 1 to 3).
-- Nothing here changes what the owner's dashboard session can do; it removes
-- access nobody uses.
--
--   1. grants       authenticated loses INSERT, UPDATE and DELETE on the six data
--                   tables (and on the five views). It keeps SELECT wherever the
--                   dashboard reads, plus UPDATE of exactly two columns of
--                   contradictions (status, resolved_at), the only write the web
--                   makes with the signed-in session. authenticated loses all
--                   access to tasks (see section 1).
--   2. is_owner()   moves from public (exposed by the REST API as /rpc/is_owner)
--                   to private.is_owner(). The schema `private` is not exposed by
--                   the API. All 12 policies that call it are recreated, then
--                   public.is_owner() is dropped.
--   3. search_path  the ten SECURITY DEFINER functions in public that had none now
--                   pin it (public, extensions, pg_temp). Bodies are unchanged.
--
-- Unchanged: service_role (bypasses RLS and keeps all its privileges), anon (fully
-- locked down by migration 016) and every row-level security policy except the
-- function it calls.
--
-- Idempotent: REVOKE / GRANT / CREATE ... IF NOT EXISTS / CREATE OR REPLACE /
-- DROP ... IF EXISTS / ALTER FUNCTION can be re-run. The order inside section 1
-- matters (REVOKE ALL, then GRANT SELECT, then the column grant): a table-level
-- REVOKE also removes column-level grants, so the reverse order would leave no
-- UPDATE at all.
-- Verify afterwards with docs/sql/verify-owner-scope.sql and
-- docs/sql/verify-anon-lockdown.sql.
--
-- Rollback (restores the migration 017 state; not recommended, it re-opens grants
-- that nothing uses):
--   * GRANT INSERT, UPDATE, DELETE ON the six data tables TO authenticated;
--     GRANT SELECT ON public.tasks TO authenticated; and the same
--     INSERT / UPDATE / DELETE grant on the five views if wanted
--   * recreate public.is_owner() with the body of migration 017 section 2 and its
--     two grants, recreate the 12 policies of section 2 below with
--     (SELECT public.is_owner()) in place of (SELECT private.is_owner()), then
--     DROP FUNCTION private.is_owner(); DROP SCHEMA private;
--   * ALTER FUNCTION <name>(<args>) RESET search_path; for the ten functions in
--     section 3

-- ---------------------------------------------------------------------------
-- 1. Table privileges for `authenticated`
--
-- What the web reads with the signed-in session (web/src, every .from() and
-- .rpc() call):
--   tables  thoughts, contradictions, wiki_sources
--   views   current_wiki_pages, wiki_page_staleness, entity_nodes, entity_edges
--   rpc     get_distinct_topics(), get_distinct_people()
-- The views run with the caller's rights (migration 016), so the caller also needs
-- SELECT on what they read: wiki_pages, entity_descriptions, thoughts,
-- contradictions and wiki_sources. All of that is granted again below; tasks is
-- the only table that ends up without SELECT.
--
-- The one write is resolveContradiction() in web/src/app/wiki/actions.ts: it
-- updates status and resolved_at of one contradictions row and selects its id back.
-- Those are the only columns granted for UPDATE. The WHERE clause and the RETURNING
-- need SELECT, which the table keeps.
--
-- tasks: no view or function the dashboard uses touches it, there is no authenticated
-- policy for it, and its readers (mcp-server, the tasks-feed edge function) run as
-- service_role. authenticated therefore loses all access; the restrictive owner-only
-- policy stays so a future grant cannot open it to non-owners.
-- ---------------------------------------------------------------------------

-- Reset-then-grant, in this order, for every table and view: REVOKE ALL, then GRANT
-- SELECT, then the column-level UPDATE. REVOKE ALL removes every table privilege
-- the role holds today and any a later Postgres adds to ALL (PostgreSQL 17 added
-- MAINTAIN, which Supabase's default privileges would grant to a new table), plus
-- all column-level grants; listing privileges one by one would not. The project
-- declares PostgreSQL 15 (supabase/config.toml [db] major_version), where this is
-- equivalent to listing them.
REVOKE ALL ON TABLE
  public.thoughts, public.contradictions, public.wiki_pages, public.wiki_sources,
  public.entity_descriptions, public.tasks,
  public.entity_nodes, public.entity_edges, public.topic_counts,
  public.current_wiki_pages, public.wiki_page_staleness
  FROM authenticated;

-- SELECT where the dashboard reads. tasks gets none. The views are not updatable,
-- but Supabase's default privileges had granted them the full set.
GRANT SELECT ON TABLE
  public.thoughts, public.contradictions, public.wiki_pages, public.wiki_sources,
  public.entity_descriptions,
  public.entity_nodes, public.entity_edges, public.topic_counts,
  public.current_wiki_pages, public.wiki_page_staleness
  TO authenticated;

-- Column-level UPDATE: a future column on contradictions is not writable by default.
GRANT UPDATE (status, resolved_at) ON TABLE public.contradictions TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. is_owner() in the schema `private`
--
-- The REST API only exposes the schemas listed in supabase/config.toml [api]
-- (public, graphql_public) and, on a hosted project, under Project Settings, API,
-- Exposed schemas. `private` is in neither, so its functions are not reachable as
-- /rest/v1/rpc/... Policies still call it: the role evaluating a policy needs USAGE
-- on the schema and EXECUTE on the function, both granted to authenticated below.
-- authenticated gets no CREATE on the schema and anon gets nothing at all.
-- ---------------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS private;

REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

-- Same body as public.is_owner() (migration 017): SECURITY DEFINER so the policies
-- can consult public.owners although the caller has no access to it; search_path
-- pinned, every reference schema-qualified; `(select auth.uid())` evaluates the uid
-- once per statement.
CREATE OR REPLACE FUNCTION private.is_owner()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.owners WHERE user_id = (SELECT auth.uid())
  );
$$;

REVOKE EXECUTE ON FUNCTION private.is_owner() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_owner() TO authenticated, service_role;

-- 2a. The permissive policies (same names, commands and row filters as migration
--     017; only the function changed).
DROP POLICY IF EXISTS "allow_authenticated_select" ON public.thoughts;
CREATE POLICY "allow_authenticated_select" ON public.thoughts
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND (SELECT private.is_owner()));

DROP POLICY IF EXISTS "allow_authenticated_select_contradictions" ON public.contradictions;
CREATE POLICY "allow_authenticated_select_contradictions" ON public.contradictions
  FOR SELECT TO authenticated
  USING ((SELECT private.is_owner()));

DROP POLICY IF EXISTS "allow_authenticated_update_contradictions" ON public.contradictions;
CREATE POLICY "allow_authenticated_update_contradictions" ON public.contradictions
  FOR UPDATE TO authenticated
  USING ((SELECT private.is_owner()))
  WITH CHECK ((SELECT private.is_owner()));

DROP POLICY IF EXISTS "allow_authenticated_select_wiki_pages" ON public.wiki_pages;
CREATE POLICY "allow_authenticated_select_wiki_pages" ON public.wiki_pages
  FOR SELECT TO authenticated
  USING ((SELECT private.is_owner()));

DROP POLICY IF EXISTS "allow_authenticated_select_wiki_sources" ON public.wiki_sources;
CREATE POLICY "allow_authenticated_select_wiki_sources" ON public.wiki_sources
  FOR SELECT TO authenticated
  USING ((SELECT private.is_owner()));

DROP POLICY IF EXISTS "allow_authenticated_select_entity_descriptions" ON public.entity_descriptions;
CREATE POLICY "allow_authenticated_select_entity_descriptions" ON public.entity_descriptions
  FOR SELECT TO authenticated
  USING ((SELECT private.is_owner()));

-- 2b. The restrictive policy on every data table.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['thoughts', 'contradictions', 'wiki_pages', 'wiki_sources',
                           'entity_descriptions', 'tasks']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "authenticated_owner_only" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "authenticated_owner_only" ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT private.is_owner())) WITH CHECK ((SELECT private.is_owner()))',
      t);
  END LOOP;
END
$$;

-- 2c. Drop the old function. No CASCADE on purpose: if a policy or any other object
--     still depends on it, this statement fails and the migration stops, instead of
--     silently dropping the dependent policy. On a re-run the function is already
--     gone and IF EXISTS makes this a no-op.
DROP FUNCTION IF EXISTS public.is_owner();

-- ---------------------------------------------------------------------------
-- 3. Pin search_path on the SECURITY DEFINER functions in public
--
-- Only service_role can execute them (migration 016), so this is consistency
-- hardening: a SECURITY DEFINER function should not resolve names through the
-- caller's search_path.
--
-- Their bodies use unqualified names (thoughts, contradictions, entity_nodes,
-- slugify, ...), the pgvector type and its <=> operator, and, through slugify(),
-- unaccent(), which also looks up its dictionary through the search_path. So the
-- path has to contain the schema the extensions live in. On the local image and in
-- migrations 001 and 005 that is public; a project that enabled them from the
-- dashboard has them in `extensions` (supabase/config.toml: extra_search_path =
-- ["public", "extensions"]). public, extensions covers both; a schema that does not
-- exist in the path is ignored. pg_temp comes last so temporary objects cannot
-- shadow anything.
--
-- ALTER FUNCTION ... SET keeps the bodies, owners and grants as they are.
-- get_distinct_topics / get_distinct_people are SECURITY INVOKER since 017 and
-- slugify / is_code_path are plain functions; none of them is touched here.
-- ---------------------------------------------------------------------------

ALTER FUNCTION public.thoughts_by_slug(text, int)
  SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.match_thoughts(vector(1536), int, text, text[], text[], int)
  SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.match_thoughts_v2(
  vector(1536), int, text, text[], text[], int, text, int, boolean, boolean, boolean
) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.find_near_dups(vector(1536), float, int, uuid)
  SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.consolidation_candidates(int, int)
  SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.entity_search(text, text, int)
  SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.entity_neighbors(text, int)
  SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.related_thoughts_via_entities(uuid[], int, int)
  SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.archive_thoughts(int, int)
  SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.increment_retrieval(uuid[])
  SET search_path = public, extensions, pg_temp;

-- NOTE for later migrations:
--   * a table or view created later is granted in full to authenticated by Supabase's
--     default privileges; REVOKE ALL ... FROM authenticated, then GRANT only what the
--     dashboard needs, as in section 1, besides the policies and the restrictive
--     owner-only policy
--   * a policy must call (SELECT private.is_owner()); a new SECURITY DEFINER function
--     must set its search_path (verify-owner-scope.sql checks both)
--   * CREATE OR REPLACE FUNCTION replaces the whole definition: a pinned SET search_path
--     and SECURITY DEFINER are lost unless the new statement states them again
--   * a new function in the schema private gets EXECUTE for PUBLIC by default (no
--     default privileges are set for that schema); REVOKE EXECUTE ... FROM PUBLIC, anon
--     explicitly, then GRANT only to the roles that need it
