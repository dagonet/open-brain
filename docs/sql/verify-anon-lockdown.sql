-- docs/sql/verify-anon-lockdown.sql
--
-- Read-only check, run in the Supabase SQL editor after applying migration 016.
-- Every row of every result set must show that anon has no access.
-- Result sets 1-4 must show anon_access = false everywhere; set 5 must be empty.

-- 1. Policies in public that apply to anon or PUBLIC (expect: no rows).
SELECT tablename, policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public'
  AND (roles::text[] && ARRAY['anon', 'public'])
ORDER BY tablename, policyname;

-- 2. Table privileges for anon (expect: anon_access = false on every row).
SELECT c.relname AS table_name,
       has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE') AS anon_access
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.relname;

-- 3. Views: no anon access, and they run with the caller's rights
--    (expect: anon_access = false, security_invoker = true).
SELECT c.relname AS view_name,
       has_table_privilege('anon', c.oid, 'SELECT') AS anon_access,
       coalesce(c.reloptions::text[] @> ARRAY['security_invoker=on']
                OR c.reloptions::text[] @> ARRAY['security_invoker=true'], false) AS security_invoker
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'v'
ORDER BY c.relname;

-- 4. Functions defined in public, excluding extension members
--    (expect: anon_access = false on every row).
SELECT p.oid::regprocedure AS function_signature,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_access
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND NOT EXISTS (
    SELECT 1 FROM pg_depend d
    WHERE d.objid = p.oid AND d.deptype = 'e'
  )
ORDER BY 1::text;

-- 5. Anything above that still lets anon in (expect: no rows).
SELECT 'table' AS kind, c.relname::text AS name
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v')
  AND has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE')
UNION ALL
SELECT 'function', p.oid::regprocedure::text
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  AND has_function_privilege('anon', p.oid, 'EXECUTE');
