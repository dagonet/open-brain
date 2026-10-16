-- docs/sql/verify-owner-scope.sql
--
-- Run in the Supabase SQL editor (or psql) after applying migration 017 and
-- after the owner is listed in public.owners. Sibling of verify-anon-lockdown.sql,
-- which checks the anon side.
--
-- The whole script runs in one transaction that ends in ROLLBACK: the sample rows
-- it inserts are never kept, and nothing else is changed. Run it as a whole.
--
-- How to read it: every check is an assertion. A failed check stops the script
-- with an error that names the check, so no error means every check passed. The
-- last result set (just before ROLLBACK) lists what was checked and observed.
--
-- What it does:
--   1. Reads the owner id from public.owners (no id in this file; it stops with
--      a clear message if the list is empty) and inserts one sample row per table.
--   2. Acts as the `authenticated` role with a random user id that is NOT an
--      owner. Expects: no rows visible anywhere (tables, views, RPCs), every
--      insert refused by RLS, updates and deletes touching zero rows, is_owner()
--      false, public.owners unreadable.
--   3. Repeats as the owner. Expects the sample rows visible (a soft-deleted
--      thought stays hidden), the same refused writes, except that the
--      contradictions UPDATE the dashboard uses now succeeds.
--   4. Catalog checks: every data table has the restrictive owner-only policy for
--      authenticated; public.owners has no policy; authenticated holds no
--      TRUNCATE, REFERENCES or TRIGGER; is_owner() is the only SECURITY DEFINER
--      function authenticated can execute; every view runs with the caller's
--      rights; RLS is on for every table; anon has no access to public.owners
--      or is_owner().
--
-- Not covered: service_role (it bypasses RLS by design) and anon row access (see
-- verify-anon-lockdown.sql).

BEGIN;

-- 1. Preconditions and sample rows (run as the editor's role, which bypasses RLS).
--    The sample ids are passed to the checks below through session settings.
DO $$
DECLARE
  v_owner     uuid;
  v_thought   uuid := gen_random_uuid();
  v_deleted   uuid := gen_random_uuid();
  v_page      uuid := gen_random_uuid();
  v_contra    uuid := gen_random_uuid();
  v_task      uuid := gen_random_uuid();
BEGIN
  IF to_regclass('public.owners') IS NULL OR to_regprocedure('public.is_owner()') IS NULL THEN
    RAISE EXCEPTION 'owner-scope: migration 017 is not applied (public.owners / public.is_owner() missing)';
  END IF;

  SELECT user_id INTO v_owner FROM public.owners ORDER BY created_at, user_id LIMIT 1;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'owner-scope: public.owners is empty. Add the owner first: INSERT INTO public.owners (user_id) VALUES (''<your-user-id>'');';
  END IF;

  INSERT INTO public.thoughts (id, raw_text, source, topics, people)
  VALUES (v_thought, 'owner-scope check', 'cli', ARRAY['owner-scope-check'], ARRAY['Owner Scope Check']);
  INSERT INTO public.thoughts (id, raw_text, source, deleted_at)
  VALUES (v_deleted, 'owner-scope check (soft-deleted)', 'cli', now());
  INSERT INTO public.entity_descriptions (thought_id, entity_name, description)
  VALUES (v_thought, 'Owner Scope Alpha', 'sample'), (v_thought, 'Owner Scope Beta', 'sample');
  INSERT INTO public.wiki_pages (id, slug, version, content_md, embedding_model,
                                 embedding_dimensions, source_thought_count)
  VALUES (v_page, 'owner-scope-check-' || replace(v_page::text, '-', ''), 1, 'sample',
          'sample', 1536, 1);
  INSERT INTO public.wiki_sources (page_id, thought_id) VALUES (v_page, v_thought);
  INSERT INTO public.contradictions (id, thought_a_id, thought_b_id, reason, severity,
                                     confidence, embedding_model)
  VALUES (v_contra, v_thought, v_deleted, 'sample', 3, 0.5, 'sample');
  INSERT INTO public.tasks (id, title) VALUES (v_task, 'owner-scope check');

  PERFORM set_config('owner_scope.thought_id', v_thought::text, true);
  PERFORM set_config('owner_scope.deleted_id', v_deleted::text, true);
  PERFORM set_config('owner_scope.page_id', v_page::text, true);
  PERFORM set_config('owner_scope.contradiction_id', v_contra::text, true);
  PERFORM set_config('owner_scope.task_id', v_task::text, true);
  PERFORM set_config('owner_scope.owner_id', v_owner::text, true);
END
$$;

-- 2. The checks for one user. Not stored: the function only exists in this session.
CREATE FUNCTION pg_temp.owner_scope_pass(p_who text, p_sub uuid, p_is_owner boolean)
RETURNS SETOF text
LANGUAGE plpgsql
AS $$
DECLARE
  v_thought   uuid := current_setting('owner_scope.thought_id')::uuid;
  v_deleted   uuid := current_setting('owner_scope.deleted_id')::uuid;
  v_page      uuid := current_setting('owner_scope.page_id')::uuid;
  v_contra    uuid := current_setting('owner_scope.contradiction_id')::uuid;
  v_task      uuid := current_setting('owner_scope.task_id')::uuid;
  r           record;
  n_all       bigint;
  n_marker    bigint;
  n_rows      bigint;
  v_flag      boolean;
  v_msg       text;
  v_rejected  boolean;
  v_text      text;
BEGIN
  -- What PostgREST sets for a signed-in session. auth.uid() reads one of the two
  -- settings, depending on the Supabase version; set both.
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', p_sub::text, true);
  SET LOCAL ROLE authenticated;

  IF (SELECT auth.uid()) IS DISTINCT FROM p_sub THEN
    RAISE EXCEPTION 'owner-scope [%]: auth.uid() does not return the test user id; the check setup is wrong', p_who;
  END IF;
  RETURN NEXT format('%-9s auth.uid() returns the test user id', p_who);

  SELECT public.is_owner() INTO v_flag;
  IF v_flag IS DISTINCT FROM p_is_owner THEN
    RAISE EXCEPTION 'owner-scope [%]: is_owner() returned %, expected %', p_who, v_flag, p_is_owner;
  END IF;
  RETURN NEXT format('%-9s is_owner() = %s', p_who, v_flag);

  -- Reads. A non-owner sees nothing at all. The owner sees the sample row (the
  -- marker); tasks has no authenticated policy, so nobody sees it.
  FOR r IN
    SELECT * FROM (VALUES
      ('thoughts',             'public.thoughts',             format('id = %L', v_thought),                true),
      ('contradictions',       'public.contradictions',       format('id = %L', v_contra),                 true),
      ('wiki_pages',           'public.wiki_pages',           format('id = %L', v_page),                   true),
      ('wiki_sources',         'public.wiki_sources',         format('page_id = %L', v_page),              true),
      ('entity_descriptions',  'public.entity_descriptions',  format('thought_id = %L', v_thought),        true),
      ('tasks',                'public.tasks',                format('id = %L', v_task),                   false),
      ('entity_nodes',         'public.entity_nodes',         'entity_key = ''owner scope alpha''',        true),
      ('entity_edges',         'public.entity_edges',         'source_key = ''owner scope alpha''',        true),
      ('topic_counts',         'public.topic_counts',         'slug = ''owner-scope-check''',              true),
      ('current_wiki_pages',   'public.current_wiki_pages',   format('id = %L', v_page),                   true),
      ('wiki_page_staleness',  'public.wiki_page_staleness',  format('page_id = %L', v_page),              true),
      ('get_distinct_topics()', 'public.get_distinct_topics()', 'get_distinct_topics = ''owner-scope-check''', true),
      ('get_distinct_people()', 'public.get_distinct_people()', 'get_distinct_people = ''Owner Scope Check''', true)
    ) AS v(label, src, marker, owner_sees)
  LOOP
    EXECUTE format('SELECT count(*) FROM %s', r.src) INTO n_all;
    EXECUTE format('SELECT count(*) FROM %s WHERE %s', r.src, r.marker) INTO n_marker;
    IF NOT (p_is_owner AND r.owner_sees) THEN
      IF n_all <> 0 OR n_marker <> 0 THEN
        RAISE EXCEPTION 'owner-scope [%]: % shows % rows (sample row: %), expected none', p_who, r.label, n_all, n_marker;
      END IF;
      RETURN NEXT format('%-9s read %s: 0 rows', p_who, r.label);
    ELSE
      IF n_marker < 1 THEN
        RAISE EXCEPTION 'owner-scope [%]: % does not show the sample row, expected it to', p_who, r.label;
      END IF;
      RETURN NEXT format('%-9s read %s: sample row visible', p_who, r.label);
    END IF;
  END LOOP;

  -- Soft-deleted rows stay hidden, also for the owner.
  SELECT count(*) INTO n_rows FROM public.thoughts WHERE id = v_deleted;
  IF n_rows <> 0 THEN
    RAISE EXCEPTION 'owner-scope [%]: a soft-deleted thought is visible', p_who;
  END IF;
  RETURN NEXT format('%-9s read thoughts: soft-deleted row hidden', p_who);

  -- public.owners is closed to authenticated for reads and writes.
  FOREACH v_text IN ARRAY ARRAY['SELECT count(*) FROM public.owners',
                                'INSERT INTO public.owners (user_id) VALUES (gen_random_uuid())',
                                'UPDATE public.owners SET created_at = now()',
                                'DELETE FROM public.owners']
  LOOP
    v_rejected := false;
    BEGIN
      EXECUTE v_text;
    EXCEPTION WHEN insufficient_privilege THEN
      v_rejected := true;
    END;
    IF NOT v_rejected THEN
      RAISE EXCEPTION 'owner-scope [%]: public.owners accepted: %', p_who, v_text;
    END IF;
  END LOOP;
  RETURN NEXT format('%-9s public.owners: select/insert/update/delete refused', p_who);

  -- Writes. Inserts are refused by RLS (no INSERT policy exists). Updates and
  -- deletes touch zero rows (RLS filters the sample row out), except the
  -- contradictions UPDATE the dashboard uses, which only the owner may do.
  FOR r IN
    SELECT * FROM (VALUES
      ('thoughts',
       'INSERT INTO public.thoughts (raw_text, source) VALUES (''x'', ''cli'')',
       format('UPDATE public.thoughts SET raw_text = ''changed'' WHERE id = %L', v_thought),
       format('DELETE FROM public.thoughts WHERE id = %L', v_thought), false),
      ('contradictions',
       format('INSERT INTO public.contradictions (thought_a_id, thought_b_id, reason, severity, confidence, embedding_model) VALUES (gen_random_uuid(), gen_random_uuid(), ''x'', 1, 0.5, ''x'')'),
       format('UPDATE public.contradictions SET status = ''ignored'' WHERE id = %L', v_contra),
       format('DELETE FROM public.contradictions WHERE id = %L', v_contra), true),
      ('wiki_pages',
       'INSERT INTO public.wiki_pages (slug, version, content_md, embedding_model, embedding_dimensions, source_thought_count) VALUES (''owner-scope-insert'', 1, ''x'', ''x'', 1536, 0)',
       format('UPDATE public.wiki_pages SET content_md = ''changed'' WHERE id = %L', v_page),
       format('DELETE FROM public.wiki_pages WHERE id = %L', v_page), false),
      ('wiki_sources',
       format('INSERT INTO public.wiki_sources (page_id, thought_id) VALUES (%L, gen_random_uuid())', v_page),
       format('UPDATE public.wiki_sources SET thought_id = gen_random_uuid() WHERE page_id = %L', v_page),
       format('DELETE FROM public.wiki_sources WHERE page_id = %L', v_page), false),
      ('entity_descriptions',
       format('INSERT INTO public.entity_descriptions (thought_id, entity_name, description) VALUES (%L, ''x'', ''x'')', v_thought),
       format('UPDATE public.entity_descriptions SET description = ''changed'' WHERE thought_id = %L', v_thought),
       format('DELETE FROM public.entity_descriptions WHERE thought_id = %L', v_thought), false),
      ('tasks',
       'INSERT INTO public.tasks (title) VALUES (''x'')',
       format('UPDATE public.tasks SET title = ''changed'' WHERE id = %L', v_task),
       format('DELETE FROM public.tasks WHERE id = %L', v_task), false)
    ) AS v(label, ins, upd, del, owner_may_update)
  LOOP
    v_rejected := false;
    BEGIN
      EXECUTE r.ins;
    EXCEPTION WHEN insufficient_privilege THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
      v_rejected := true;
    END;
    IF NOT v_rejected THEN
      RAISE EXCEPTION 'owner-scope [%]: INSERT into % was accepted', p_who, r.label;
    END IF;
    IF v_msg NOT ILIKE '%row-level security%' THEN
      RAISE EXCEPTION 'owner-scope [%]: INSERT into % was refused, but not by RLS: %', p_who, r.label, v_msg;
    END IF;
    RETURN NEXT format('%-9s write %s: insert refused by RLS', p_who, r.label);

    EXECUTE r.upd;
    GET DIAGNOSTICS n_rows = ROW_COUNT;
    IF p_is_owner AND r.owner_may_update THEN
      IF n_rows <> 1 THEN
        RAISE EXCEPTION 'owner-scope [%]: UPDATE on % changed % rows, expected 1', p_who, r.label, n_rows;
      END IF;
      RETURN NEXT format('%-9s write %s: update allowed (1 row)', p_who, r.label);
    ELSE
      IF n_rows <> 0 THEN
        RAISE EXCEPTION 'owner-scope [%]: UPDATE on % changed % rows, expected 0', p_who, r.label, n_rows;
      END IF;
      RETURN NEXT format('%-9s write %s: update touches 0 rows', p_who, r.label);
    END IF;

    EXECUTE r.del;
    GET DIAGNOSTICS n_rows = ROW_COUNT;
    IF n_rows <> 0 THEN
      RAISE EXCEPTION 'owner-scope [%]: DELETE on % removed % rows, expected 0', p_who, r.label, n_rows;
    END IF;
    RETURN NEXT format('%-9s write %s: delete touches 0 rows', p_who, r.label);
  END LOOP;

  RESET ROLE;

  -- Back as the editor's role: the sample rows must be intact, and the one
  -- allowed change must have happened for the owner only.
  IF (SELECT count(*) FROM public.thoughts WHERE id = v_thought AND raw_text = 'owner-scope check') <> 1
     OR (SELECT count(*) FROM public.wiki_pages WHERE id = v_page AND content_md = 'sample') <> 1
     OR (SELECT count(*) FROM public.wiki_sources WHERE page_id = v_page) <> 1
     OR (SELECT count(*) FROM public.entity_descriptions WHERE thought_id = v_thought AND description = 'sample') <> 2
     OR (SELECT count(*) FROM public.tasks WHERE id = v_task AND title = 'owner-scope check') <> 1
     OR (SELECT count(*) FROM public.contradictions WHERE id = v_contra) <> 1 THEN
    RAISE EXCEPTION 'owner-scope [%]: a sample row was changed or removed', p_who;
  END IF;
  SELECT status INTO v_text FROM public.contradictions WHERE id = v_contra;
  IF v_text IS DISTINCT FROM (CASE WHEN p_is_owner THEN 'ignored' ELSE 'open' END) THEN
    RAISE EXCEPTION 'owner-scope [%]: contradiction status is %, which does not match the expected outcome', p_who, v_text;
  END IF;
  RETURN NEXT format('%-9s sample rows intact afterwards', p_who);
END
$$;

CREATE TEMP TABLE owner_scope_results (n serial PRIMARY KEY, result text NOT NULL) ON COMMIT DROP;

-- A user id that is not in public.owners (random, never exists as an owner).
INSERT INTO owner_scope_results (result)
SELECT pg_temp.owner_scope_pass('non-owner', gen_random_uuid(), false);

-- The owner listed in public.owners.
INSERT INTO owner_scope_results (result)
SELECT pg_temp.owner_scope_pass('owner', current_setting('owner_scope.owner_id')::uuid, true);

-- 3. Catalog checks (run as the editor's role).
DO $$
DECLARE
  v_bad text;
BEGIN
  -- Every data table (every public table except the owner list) has the
  -- RESTRICTIVE policy for authenticated that requires is_owner() for all
  -- commands. Restrictive policies are AND-ed with whatever permissive policies
  -- exist, so it keeps non-owners out even if a permissive policy is added later.
  SELECT string_agg(c.relname, ', ') INTO v_bad
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> 'owners'
    AND NOT EXISTS (
      SELECT 1 FROM pg_policies p
      WHERE p.schemaname = 'public' AND p.tablename = c.relname
        AND p.permissive = 'RESTRICTIVE' AND p.cmd = 'ALL'
        AND p.roles::text[] = ARRAY['authenticated']
        AND p.qual LIKE '%is_owner()%' AND p.with_check LIKE '%is_owner()%');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'owner-scope: tables without the restrictive owner-only policy for authenticated: %', v_bad;
  END IF;
  INSERT INTO owner_scope_results (result)
  VALUES ('catalog   every data table has the restrictive owner-only policy for authenticated');

  -- The owner list itself has no policy at all.
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'owners') THEN
    RAISE EXCEPTION 'owner-scope: public.owners has a policy; it should have none';
  END IF;
  INSERT INTO owner_scope_results (result)
  VALUES ('catalog   public.owners has no policies');

  -- RLS does not cover TRUNCATE, and REFERENCES / TRIGGER are not needed.
  SELECT string_agg(c.relname, ', ') INTO v_bad
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
    AND has_table_privilege('authenticated', c.oid, 'TRUNCATE, REFERENCES, TRIGGER');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'owner-scope: authenticated holds TRUNCATE, REFERENCES or TRIGGER on: %', v_bad;
  END IF;
  INSERT INTO owner_scope_results (result)
  VALUES ('catalog   authenticated has no TRUNCATE, REFERENCES or TRIGGER on any table');

  -- SECURITY DEFINER functions bypass RLS: authenticated may only run is_owner().
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_bad
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosecdef
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
    AND p.oid <> 'public.is_owner()'::regprocedure;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'owner-scope: SECURITY DEFINER functions executable by authenticated: %', v_bad;
  END IF;
  INSERT INTO owner_scope_results (result)
  VALUES ('catalog   is_owner() is the only SECURITY DEFINER function authenticated can execute');

  -- is_owner() pins its search_path.
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                 WHERE p.oid = 'public.is_owner()'::regprocedure
                   AND p.prosecdef
                   AND p.proconfig::text[] @> ARRAY['search_path=""']) THEN
    RAISE EXCEPTION 'owner-scope: is_owner() is not SECURITY DEFINER with search_path pinned';
  END IF;
  INSERT INTO owner_scope_results (result)
  VALUES ('catalog   is_owner() is SECURITY DEFINER with a pinned search_path');

  -- Views run with the caller's rights, so table RLS applies to them.
  SELECT string_agg(c.relname, ', ') INTO v_bad
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'v'
    AND NOT coalesce(c.reloptions::text[] @> ARRAY['security_invoker=on']
                     OR c.reloptions::text[] @> ARRAY['security_invoker=true'], false);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'owner-scope: views without security_invoker: %', v_bad;
  END IF;
  INSERT INTO owner_scope_results (result)
  VALUES ('catalog   every view has security_invoker');

  -- RLS on for every table in public.
  SELECT string_agg(c.relname, ', ') INTO v_bad
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'owner-scope: tables without row level security: %', v_bad;
  END IF;
  INSERT INTO owner_scope_results (result)
  VALUES ('catalog   row level security is on for every table');

  -- anon cannot touch the owner list or ask is_owner().
  IF has_table_privilege('anon', 'public.owners', 'SELECT, INSERT, UPDATE, DELETE')
     OR has_table_privilege('authenticated', 'public.owners', 'SELECT, INSERT, UPDATE, DELETE')
     OR has_function_privilege('anon', 'public.is_owner()', 'EXECUTE') THEN
    RAISE EXCEPTION 'owner-scope: anon or authenticated has direct access to public.owners, or anon can execute is_owner()';
  END IF;
  INSERT INTO owner_scope_results (result)
  VALUES ('catalog   anon/authenticated have no privileges on public.owners; anon cannot execute is_owner()');
END
$$;

-- Everything that was checked (expect: only lines, no error above).
SELECT result FROM owner_scope_results ORDER BY n;

ROLLBACK;
