-- docs/sql/verify-anon-lockdown.sql
--
-- Read-only check, run in the Supabase SQL editor after applying migrations 016
-- and 018 (check 8 needs the schema private from 018). Sibling of
-- verify-owner-scope.sql, which checks the authenticated side (only the owner may
-- read or write, migrations 017 and 018).
--
-- The script is one SELECT: it reads the catalogs only, changes nothing and creates
-- nothing. The SQL editor displays only the last result set, which is why everything
-- is in one query.
--
-- How to read it: one row per check, with the columns
--   check     what is checked
--   expected  the state that counts as passing
--   observed  what the database shows: "<n> violation(s), <m> checked", followed by
--             the offending objects when there are any
--   pass      true or false
-- Failing rows (pass = false) are listed first. The database is locked down for anon
-- when every row says pass = true. A check also fails when it found nothing to look
-- at (for example no tables at all), so a wrong schema cannot pass by accident.
--
-- What is checked:
--   1. No policy in public applies to anon or PUBLIC.
--   2. anon holds no SELECT, INSERT, UPDATE or DELETE on any public table.
--   3. Every public view gives anon no SELECT and has security_invoker on.
--   4. anon cannot EXECUTE any public function (extension members excluded).
--   5. Combined: no public table, view or function still lets anon in.
--   6. Positive: authenticated can still SELECT the dashboard tables and views,
--      EXECUTE the dashboard functions, UPDATE contradictions.status and
--      contradictions.resolved_at, and use the schema private (USAGE, EXECUTE on
--      private.is_owner(); the policies call it, so without it every dashboard
--      query fails).
--   7. Row level security is on for every public table.
--   8. The schema private exists, anon has no USAGE or CREATE on it and cannot
--      EXECUTE anything in it, and private.is_owner() exists.
--   9. Neither anon nor authenticated holds CREATE on the schema public (directly or
--      through PUBLIC). The SECURITY DEFINER functions resolve names through public
--      (migration 018 section 3), so a role that could create objects there could
--      plant look-alikes. Fix a failure with
--      REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated;

WITH
-- Policies in public that apply to anon or PUBLIC.
anon_policies AS (
  SELECT format('%s.%s', tablename, policyname) AS item
  FROM pg_policies
  WHERE schemaname = 'public'
    AND (roles::text[] && ARRAY['anon', 'public'])
),
tbl AS (
  SELECT c.relname::text AS name,
         c.relrowsecurity AS rls_enabled,
         has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE') AS anon_access
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
),
vw AS (
  SELECT c.relname::text AS name,
         has_table_privilege('anon', c.oid, 'SELECT') AS anon_select,
         has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE') AS anon_access,
         coalesce(c.reloptions::text[] @> ARRAY['security_invoker=on']
                  OR c.reloptions::text[] @> ARRAY['security_invoker=true'], false) AS security_invoker
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'v'
),
-- Functions defined in public, excluding extension members.
fn AS (
  SELECT p.oid::regprocedure::text AS name,
         has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_access
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
),
-- The schema private and the functions in it (extension members excluded). The
-- schema is looked up in pg_namespace: has_schema_privilege() raises an error for a
-- schema that does not exist, and this script must report that as a failed check.
priv_schema AS (
  SELECT n.oid,
         has_schema_privilege('anon', n.oid, 'USAGE, CREATE') AS anon_access
  FROM pg_namespace n
  WHERE n.nspname = 'private'
),
priv_fn AS (
  SELECT p.oid::regprocedure::text AS name,
         has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_access
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'private'
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
),
-- The schema public and whether the two API roles can create objects in it.
pub_schema AS (
  SELECT n.oid,
         has_schema_privilege('anon', n.oid, 'CREATE') AS anon_create,
         has_schema_privilege('authenticated', n.oid, 'CREATE') AS authenticated_create
  FROM pg_namespace n
  WHERE n.nspname = 'public'
),
-- What the dashboard (authenticated) needs; a missing object counts as no access.
dashboard AS (
  SELECT t AS name,
         coalesce(has_table_privilege('authenticated', to_regclass('public.' || quote_ident(t)), 'SELECT'), false) AS ok
  FROM unnest(ARRAY[
    'thoughts', 'contradictions', 'wiki_pages', 'wiki_sources', 'entity_descriptions',
    'entity_nodes', 'entity_edges', 'topic_counts', 'current_wiki_pages', 'wiki_page_staleness'
  ]) AS t
  UNION ALL
  SELECT f,
         coalesce(has_function_privilege('authenticated', to_regprocedure(f), 'EXECUTE'), false)
  FROM unnest(ARRAY[
    'public.get_distinct_topics()', 'public.get_distinct_people()', 'public.slugify(text)',
    'public.is_code_path(text)', 'private.is_owner()'
  ]) AS f
  UNION ALL
  -- resolveContradiction() updates exactly these two columns.
  SELECT 'contradictions.' || col || ' (UPDATE)',
         coalesce(has_column_privilege('authenticated', to_regclass('public.contradictions'), col, 'UPDATE'), false)
  FROM unnest(ARRAY['status', 'resolved_at']) AS col
  UNION ALL
  SELECT 'schema private (USAGE)',
         coalesce((SELECT has_schema_privilege('authenticated', n.oid, 'USAGE')
                   FROM pg_namespace n WHERE n.nspname = 'private'), false)
),
checks(n, check_name, expected) AS (
  VALUES
    (1, '1. policies for anon/PUBLIC in public',     'no such policy'),
    (2, '2. anon table privileges',                  'no table with anon privileges'),
    (3, '3. views: anon access, security_invoker',   'no anon SELECT, security_invoker on for every view'),
    (4, '4. anon EXECUTE on public functions',       'no function executable by anon'),
    (5, '5. anything still open to anon (combined)', 'no table, view or function open to anon'),
    (6, '6. authenticated can use the dashboard',    'SELECT on every dashboard table/view, EXECUTE on every dashboard function, UPDATE of contradictions.status and resolved_at, USAGE on schema private'),
    (7, '7. row level security on public tables',    'RLS enabled on every table'),
    (8, '8. schema private closed to anon',          'schema exists, no anon USAGE/CREATE on it, no function in it executable by anon, private.is_owner() present'),
    (9, '9. CREATE on schema public',                'neither anon nor authenticated can create objects in public')
),
-- How many objects each check looked at (0 makes the check fail).
scope(n, total) AS (
  SELECT 1, count(*) FROM tbl
  UNION ALL SELECT 2, count(*) FROM tbl
  UNION ALL SELECT 3, count(*) FROM vw
  UNION ALL SELECT 4, count(*) FROM fn
  UNION ALL SELECT 5, (SELECT count(*) FROM tbl) + (SELECT count(*) FROM vw) + (SELECT count(*) FROM fn)
  UNION ALL SELECT 6, count(*) FROM dashboard
  UNION ALL SELECT 7, count(*) FROM tbl
  UNION ALL SELECT 8, (SELECT count(*) FROM priv_schema) + (SELECT count(*) FROM priv_fn)
  UNION ALL SELECT 9, count(*) FROM pub_schema
),
-- One row per violation.
issues(n, item) AS (
  SELECT 1, item FROM anon_policies
  UNION ALL SELECT 2, name FROM tbl WHERE anon_access
  UNION ALL SELECT 3, name || ' (anon can SELECT)' FROM vw WHERE anon_select
  UNION ALL SELECT 3, name || ' (security_invoker off)' FROM vw WHERE NOT security_invoker
  UNION ALL SELECT 4, name FROM fn WHERE anon_access
  UNION ALL SELECT 5, 'table ' || name FROM tbl WHERE anon_access
  UNION ALL SELECT 5, 'view ' || name FROM vw WHERE anon_access
  UNION ALL SELECT 5, 'function ' || name FROM fn WHERE anon_access
  UNION ALL SELECT 6, name FROM dashboard WHERE NOT ok
  UNION ALL SELECT 7, name FROM tbl WHERE NOT rls_enabled
  UNION ALL SELECT 8, 'schema private is missing' WHERE NOT EXISTS (SELECT 1 FROM priv_schema)
  UNION ALL SELECT 8, 'schema private (anon has USAGE or CREATE)' FROM priv_schema WHERE anon_access
  UNION ALL SELECT 8, 'function ' || name || ' (anon can EXECUTE)' FROM priv_fn WHERE anon_access
  UNION ALL SELECT 8, 'private.is_owner() is missing' WHERE to_regprocedure('private.is_owner()') IS NULL
  UNION ALL SELECT 9, 'anon has CREATE on public' FROM pub_schema WHERE anon_create
  UNION ALL SELECT 9, 'authenticated has CREATE on public' FROM pub_schema WHERE authenticated_create
)
SELECT c.check_name AS "check",
       c.expected,
       format('%s violation(s), %s checked%s',
              count(i.item), s.total,
              CASE WHEN count(i.item) > 0 THEN ': ' || string_agg(i.item, ', ' ORDER BY i.item) ELSE '' END) AS observed,
       (count(i.item) = 0 AND s.total > 0) AS pass
FROM checks c
JOIN scope s ON s.n = c.n
LEFT JOIN issues i ON i.n = c.n
GROUP BY c.n, c.check_name, c.expected, s.total
ORDER BY pass, c.n;
