-- Migration 017: Scope `authenticated` database access to the owner account.
--
-- Defence in depth on top of migration 016. Until now every policy for the
-- `authenticated` role treated any signed-in account as the owner (the
-- single-user design from migration 005). After this migration an authenticated
-- session only sees or changes data when auth.uid() is listed in public.owners.
--
-- Unchanged: service_role paths (CLI, MCP server, edge functions) bypass RLS and
-- keep their access; anon stays fully locked down (see migration 016).
--
-- What this adds:
--   1. public.owners          the owner list (no policies, no API access)
--   2. public.is_owner()      SECURITY DEFINER helper used by the policies
--   3. bootstrap              seeds the owner list when auth.users has exactly one row
--   4. policies               every authenticated policy now also requires is_owner(),
--                             and one RESTRICTIVE policy per data table keeps it so
--   5. get_distinct_*()       switched to SECURITY INVOKER so RLS applies to them
--   6. privileges             TRUNCATE, REFERENCES and TRIGGER revoked from
--                             authenticated on the data tables
--
-- The owner session keeps exactly the access it had before: the dashboard reads
-- and writes through the signed-in session. The one web change is that the
-- contradiction resolve action now reports an update that matched no row.
--
-- Idempotent: CREATE ... IF NOT EXISTS / CREATE OR REPLACE / DROP POLICY IF EXISTS
-- / REVOKE / GRANT / ALTER FUNCTION can be re-run.
-- Verify afterwards with docs/sql/verify-owner-scope.sql.

-- ---------------------------------------------------------------------------
-- 1. Owner list
--
-- RLS is on and there are deliberately NO policies: only the table owner and
-- service_role (both bypass RLS) can read or change the list. Add an owner with
--   INSERT INTO public.owners (user_id) VALUES ('<your-user-id>');
-- in the SQL editor. Keep it in sync with the web app's OWNER_USER_IDS.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.owners (
  user_id    uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.owners ENABLE ROW LEVEL SECURITY;

-- Explicit, including PUBLIC: Supabase default privileges grant new tables to
-- anon and authenticated.
REVOKE ALL ON TABLE public.owners FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. is_owner()
--
-- SECURITY DEFINER so the policies can consult public.owners although the
-- caller has no access to it. search_path is pinned and every reference is
-- schema-qualified. `(select auth.uid())` lets Postgres evaluate the uid once
-- per statement instead of once per row.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_owner()
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

REVOKE EXECUTE ON FUNCTION public.is_owner() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_owner() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Bootstrap
--
-- No user id is hard-coded. When the owner list is empty and auth.users has
-- exactly one row, that user becomes the owner. With zero or several users
-- nothing is seeded: the operator has to add the owner (see section 1), and the
-- dashboard shows no data until then. A non-empty list is never touched, so a
-- re-run does not add users.
--
-- The count and the insert are one statement, so they see the same snapshot of
-- auth.users; the notice is chosen from the number of rows it inserted.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  seeded     bigint;
  user_count bigint;
BEGIN
  INSERT INTO public.owners (user_id)
  SELECT id FROM auth.users
  WHERE (SELECT count(*) FROM auth.users) = 1
    AND NOT EXISTS (SELECT 1 FROM public.owners)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS seeded = ROW_COUNT;

  IF seeded = 1 THEN
    RAISE NOTICE 'public.owners: seeded the only user in auth.users as owner.';
  ELSIF NOT EXISTS (SELECT 1 FROM public.owners) THEN
    SELECT count(*) INTO user_count FROM auth.users;
    RAISE NOTICE 'public.owners is empty and auth.users has % rows, so no owner was seeded. The dashboard shows no data until you run: INSERT INTO public.owners (user_id) VALUES (''<your-user-id>'');', user_count;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 4. Policies for `authenticated`
--
-- 4a. The permissive policies. Same names, commands and row filters as before;
--     each one now also requires is_owner(). SELECT policies take USING only; the
--     UPDATE policy gets both USING and WITH CHECK. Policies that already exist
--     are dropped and recreated. tasks has no authenticated policy (the web does
--     not read it) and gets no permissive one.
--
-- 4b. One RESTRICTIVE policy per data table (end of this section). Permissive
--     policies are OR-ed together, restrictive ones are AND-ed on top, so a
--     permissive policy added later cannot give a non-owner access again.
-- ---------------------------------------------------------------------------

-- thoughts (004). Keeps the soft-delete filter.
DROP POLICY IF EXISTS "allow_authenticated_select" ON public.thoughts;
CREATE POLICY "allow_authenticated_select" ON public.thoughts
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND (SELECT public.is_owner()));

-- contradictions (005)
DROP POLICY IF EXISTS "allow_authenticated_select_contradictions" ON public.contradictions;
CREATE POLICY "allow_authenticated_select_contradictions" ON public.contradictions
  FOR SELECT TO authenticated
  USING ((SELECT public.is_owner()));

DROP POLICY IF EXISTS "allow_authenticated_update_contradictions" ON public.contradictions;
CREATE POLICY "allow_authenticated_update_contradictions" ON public.contradictions
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_owner()))
  WITH CHECK ((SELECT public.is_owner()));

-- wiki_pages, wiki_sources (005)
DROP POLICY IF EXISTS "allow_authenticated_select_wiki_pages" ON public.wiki_pages;
CREATE POLICY "allow_authenticated_select_wiki_pages" ON public.wiki_pages
  FOR SELECT TO authenticated
  USING ((SELECT public.is_owner()));

DROP POLICY IF EXISTS "allow_authenticated_select_wiki_sources" ON public.wiki_sources;
CREATE POLICY "allow_authenticated_select_wiki_sources" ON public.wiki_sources
  FOR SELECT TO authenticated
  USING ((SELECT public.is_owner()));

-- entity_descriptions (016). The entity_nodes / entity_edges views run with the
-- caller's rights, so they inherit this policy and the thoughts one above.
DROP POLICY IF EXISTS "allow_authenticated_select_entity_descriptions" ON public.entity_descriptions;
CREATE POLICY "allow_authenticated_select_entity_descriptions" ON public.entity_descriptions
  FOR SELECT TO authenticated
  USING ((SELECT public.is_owner()));

-- 4b. The restrictive policy, on every data table (public.owners is closed at
--     the privilege level and has no authenticated access to restrict).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['thoughts', 'contradictions', 'wiki_pages', 'wiki_sources',
                           'entity_descriptions', 'tasks']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "authenticated_owner_only" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "authenticated_owner_only" ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.is_owner())) WITH CHECK ((SELECT public.is_owner()))',
      t);
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- 5. SECURITY DEFINER functions that authenticated can still execute
--
-- get_distinct_topics() / get_distinct_people() (004) are called by the
-- dashboard but, as SECURITY DEFINER, ran with the table owner's rights and
-- bypassed RLS. SECURITY INVOKER makes them follow the thoughts policy above
-- (empty result for a non-owner). service_role bypasses RLS, so server-side
-- callers are unaffected. Bodies and grants are unchanged.
--
-- The other SECURITY DEFINER functions were already closed to authenticated in
-- migration 016 (section 4b). After this migration is_owner() is the only
-- SECURITY DEFINER function authenticated can execute. slugify and is_code_path
-- are plain functions the views need; update_updated_at is a trigger function.
-- ---------------------------------------------------------------------------

ALTER FUNCTION public.get_distinct_topics() SECURITY INVOKER;
ALTER FUNCTION public.get_distinct_people() SECURITY INVOKER;

-- ---------------------------------------------------------------------------
-- 6. Table privileges
--
-- RLS does not apply to TRUNCATE, and REFERENCES / TRIGGER are not needed by any
-- signed-in caller. INSERT, UPDATE and DELETE stay granted: they are gated by
-- the policies above (the owner session only updates contradictions; a narrower
-- follow-up could revoke the rest).
-- ---------------------------------------------------------------------------

REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE
  public.thoughts, public.contradictions, public.wiki_pages, public.wiki_sources,
  public.entity_descriptions, public.tasks
  FROM authenticated;

-- NOTE: a view created later must state WITH (security_invoker = on) so that
-- table RLS applies to it (see the note at the end of migration 016). A table
-- created later needs an authenticated policy that includes is_owner(), its own
-- "authenticated_owner_only" restrictive policy (section 4b), and the revoke
-- above.

-- ---------------------------------------------------------------------------
-- Rollback
--
-- Restoring the migration 016 state (any signed-in account is the owner):
--   * DROP POLICY "authenticated_owner_only" on each of the six data tables
--   * recreate the six permissive policies above with USING (true) (thoughts:
--     USING (deleted_at IS NULL)) and, for the contradictions UPDATE policy, no
--     WITH CHECK
--   * GRANT TRUNCATE, REFERENCES, TRIGGER on the six data tables to authenticated
--   * ALTER FUNCTION public.get_distinct_topics() SECURITY DEFINER;
--     ALTER FUNCTION public.get_distinct_people() SECURITY DEFINER;
--   * DROP FUNCTION public.is_owner(); DROP TABLE public.owners;
-- Not recommended: it removes the second layer behind turning off sign-ups.
-- ---------------------------------------------------------------------------
