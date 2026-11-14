# Atomic task_update via one SQL function (#115)

Status: implemented in this PR. Tier T3. Migration 019, `task-update.ts`, its tests, docs.

## Problem
`task-update.ts` reads the row, builds `status_history`/`metadata` in Node and writes it back. Only
note-only and merge writes are guarded (`updated_at`). A status change racing a note or merge drops
the note, and two status changes can lose a history entry.

## Decision
- **Function.** The whole write moves into one plpgsql function. It locks the row
  (`SELECT ... FOR UPDATE`), then derives status-change detection, the note-only entry, cancel
  setting `deleted_at`, and the shallow merge (null deletes) from the latest version. There is no
  app-side read on the success path.
- **Guard.** Calls serialize on the lock, so the `updated_at` guard and `conflict, re-read and retry`
  are removed with their tests and docs wording (user decision: the guard was never released).
- **Not found.** Under READ COMMITTED, `FOR UPDATE` re-checks `deleted_at IS NULL`, so a call that
  waited behind a cancel gets "not found".
- **No-op.** It returns the locked row with no UPDATE, so `updated_at` stays put. Parameter
  presence, not a value diff, decides whether to write (as today: `metadata_merge: {}` still writes).
- **Stays in TS.** The both-params check, the blank-title check, the not-found mapping and echo
  shaping. The CLI later calls `POST /rest/v1/rpc/task_apply_update`.

## 1. Migration `supabase/migrations/019_task_apply_update.sql`
```sql
CREATE OR REPLACE FUNCTION public.task_apply_update(
  p_id uuid,
  p_patch jsonb DEFAULT '{}'::jsonb,   -- keys: title, description, priority, linked_thought_ids, metadata
  p_metadata_merge jsonb DEFAULT NULL, p_status text DEFAULT NULL, p_note text DEFAULT NULL
) RETURNS SETOF public.tasks
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  -- exactly the characters JavaScript String.prototype.trim() strips (E-strings have no \v)
  c_ws constant text := E' \t\n\r\u000B\f        '
                     || E'         　﻿';
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
  cur public.tasks;  nxt public.tasks;  v_hist jsonb;  v_at timestamptz;  v_at_text text;
  v_change boolean;  v_note_only boolean;
BEGIN
  IF jsonb_typeof(v_patch) <> 'object' OR EXISTS (SELECT 1 FROM jsonb_object_keys(v_patch) k
       WHERE k NOT IN ('title','description','priority','linked_thought_ids','metadata')) THEN
    RAISE EXCEPTION 'p_patch takes only title, description, priority, linked_thought_ids, metadata';
  END IF;
  IF v_patch ? 'metadata' AND p_metadata_merge IS NOT NULL THEN
    RAISE EXCEPTION 'Pass either metadata or metadata_merge, not both.'; END IF;  -- app's text
  IF jsonb_typeof(p_metadata_merge) <> 'object' THEN        -- NULL input: condition NULL, skipped
    RAISE EXCEPTION 'metadata_merge must be a JSON object'; END IF;

  SELECT * INTO cur FROM public.tasks WHERE id = p_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;                                  -- zero rows = not found

  v_at := date_trunc('milliseconds', clock_timestamp());             -- taken after the lock
  v_at_text := to_char(v_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');  -- = toISOString()
  v_change := p_status IS NOT NULL AND p_status <> cur.status;
  v_note_only := p_note IS NOT NULL AND btrim(p_note, c_ws) <> '' AND NOT v_change;

  IF v_patch = '{}'::jsonb AND p_metadata_merge IS NULL AND NOT v_change AND NOT v_note_only
     AND p_status IS DISTINCT FROM 'cancelled' THEN
    RETURN NEXT cur; RETURN;                                         -- no-op: no UPDATE
  END IF;

  nxt := jsonb_populate_record(cur, v_patch);       -- absent keys keep cur; same casts as PostgREST
  IF p_metadata_merge IS NOT NULL THEN
    nxt.metadata := (CASE WHEN jsonb_typeof(cur.metadata) = 'object' THEN cur.metadata
                          ELSE '{}'::jsonb END || p_metadata_merge)
                    - ARRAY(SELECT key FROM jsonb_each(p_metadata_merge) WHERE value = 'null'::jsonb);
  END IF;
  v_hist := CASE WHEN jsonb_typeof(cur.status_history) = 'array' THEN cur.status_history
                 ELSE '[]'::jsonb END;
  IF v_change THEN
    nxt.status := p_status;
    nxt.status_history := v_hist || jsonb_build_array(jsonb_build_object(
      'status', p_status, 'at', v_at_text, 'note', p_note));          -- note NULL -> JSON null
  ELSIF v_note_only THEN
    nxt.status_history := v_hist || jsonb_build_array(jsonb_build_object(
      'status', cur.status, 'at', v_at_text, 'note', p_note, 'kind', 'note'));
  END IF;
  IF p_status = 'cancelled' THEN nxt.deleted_at := v_at; END IF;   -- even if status unchanged (as today)

  UPDATE public.tasks t SET title = nxt.title, description = nxt.description,
         priority = nxt.priority, linked_thought_ids = nxt.linked_thought_ids,
         metadata = nxt.metadata, status = nxt.status, status_history = nxt.status_history,
         deleted_at = nxt.deleted_at
   WHERE t.id = p_id RETURNING t.* INTO cur;
  RETURN NEXT cur;
END $$;

REVOKE EXECUTE ON FUNCTION public.task_apply_update(uuid, jsonb, jsonb, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.task_apply_update(uuid, jsonb, jsonb, text, text) TO service_role;
NOTIFY pgrst, 'reload schema';
```
- **Header.** 016-018 style, with rollback `DROP FUNCTION public.task_apply_update(uuid, jsonb,
  jsonb, text, text);`.
- **`p_patch` jsonb.** It can null a field (the CLI may want that), and a new field is a new key
  rather than a new signature, so there is no overload ambiguity.
- **Stored entries are unchanged.** jsonb normalises key order. `at` keeps the `toISOString()` form,
  now from the DB clock after the lock, so it follows lock order. `deleted_at` keeps ms precision.
- **Security.** INVOKER is enough (service_role has SELECT and UPDATE on `tasks`; `authenticated`
  has no table access since 018). `search_path = ''` with qualified names; the trigger only calls
  `now()`. `authenticated` is revoked because Supabase's default privileges grant it EXECUTE (016
  section 4d). It must stay VOLATILE: STABLE makes PostgREST run read-only. `verify-anon-lockdown.sql`
  covers it unedited.

## 2. TS call shape (`task-update.ts`)
```ts
if (metadata !== undefined && metadata_merge !== undefined) return err('Pass either metadata or metadata_merge, not both.');
if (title !== undefined && title.trim().length === 0) {
  // keep today's precedence (read error, then not found, then title error): error path only, no write
  const { data: cur, error } = await supabase.from('tasks').select('id').eq('id', id).is('deleted_at', null).maybeSingle();
  return err(error ? error.message : !cur ? 'not found' : 'title must be non-empty.');
}
const patch = pickDefined({ title, description, priority, linked_thought_ids, metadata });
const args = { p_id: id, p_patch: patch, ...pickDefined({ p_metadata_merge: metadata_merge, p_status: status, p_note: note }) };
const { data, error } = await supabase.rpc('task_apply_update', args);
if (error) return err(error.code === 'PGRST202' ? `${MIGRATION_019_MISSING} (${error.message})` : error.message);
const row = Array.isArray(data) ? data[0] : undefined;
if (!row) return err('not found');
return echo === 'compact' ? compactEcho(row) : JSON.stringify(row);
```
- **Response.** Read the plain array, not `.single()`/`.maybeSingle()`, so zero rows means not found
  without postgrest-js object handling on POST.
- **Migration error.** `MIGRATION_019_MISSING` is "task_update needs database migration 019
  (task_apply_update): run `supabase db push --remote`, see docs/upgrading.md". The raw message is
  appended because PGRST202 also covers argument-name mismatches and a stale schema cache.
- **Removed.** The guard, the conflict branch and the `isPlainObject` import.

## 3. Byte-identity
- **Serialisation.** `.update().select().single()` and `rpc` over `SETOF public.tasks` serialise the
  same composite type through PostgREST `json_agg`: table column order, timestamptz ISO in the same
  session TimeZone, jsonb verbatim, `uuid[]` an array, `smallint` a number.
- **Errors.** Errors raised inside, such as a status CHECK, keep their message. Only the old
  unguarded race (`Cannot coerce ...`) becomes `not found`.
- **Proof.** It is proven live, not by mocks.

## 4. Rollout (user decisions)
The migration is additive, and an old server never calls the function. The server runs compiled
`dist/index.js`, so the order is: `git pull`, `supabase db push --remote` (019) on the hosted
database, then `npm run build` in `mcp-server` on each machine, then `/mcp` reconnect.
A new server on an old DB gets PGRST202 (or "function ... does not exist") and returns a hard,
clear error naming migration 019. **No legacy fallback** (user decision): it would keep two copies of
the logic and the race.

**No null-clearing exposed** (user decision): the MCP schema keeps rejecting null for fields. The
function takes a JSON patch, but nothing in this PR exposes clearing; `brain task set` is a later PR.

**Deviations from the draft above, at implementation time:** main moved (zod 4 `z.guid()`, `plan_shape`,
`brain task list`); the function body is as drafted except the patch-shape checks are two separate
IFs and the whitespace set is written with `\uXXXX` escapes; `isMissingFunction` also matches code
42883 and the "function ... does not exist" text; `supabase test db` covers the function with 35
pgTAP assertions.

## 5. Tests
**Unit** (rewrite the `task_update` block of `task-compact.test.ts`; `createMockSupabase().rpc` is
awaitable):
- **RPC arguments.** `{id,status:'done',note:'ok'}` gives `{p_id, p_patch:{}, p_status:'done',
  p_note:'ok'}`; title and priority only in `p_patch`; undefined keys absent.
- **Answers.** `JSON.stringify(data[0])`, echo compact and full; `[]` gives not found; an error
  message passes through; PGRST202 gives the migration text.
- **No rpc.** Metadata plus merge calls nothing. A blank title reads only (no row: not found; a row:
  the title error). The description drops conflict and #115.
- **Deleted.** The guard, conflict, `update`-payload and `eq('updated_at')` tests; they move to SQL.

**Live, local only** (`supabase start`, `db reset --yes`, psql):
- **pgTAP** `supabase/tests/task_apply_update.test.sql`, run with `supabase test db` (new
  directory; `test db` runs every file there, so it must be pgTAP). It covers:
  - the status entry `{status,at,note:null}`, with `at` matching `\d{4}-..-..T..:..:..\.\d{3}Z`;
  - the note-only entry with `kind`; same status plus note;
  - blank notes (`''`, spaces, U+00A0, U+FEFF, U+3000) give no entry and no `updated_at` bump,
    while a blank note with a status change is kept;
  - a non-array history; a merge where null deletes, on a non-object base;
  - metadata plus merge, and an unknown key, both raise;
  - cancel sets ms `deleted_at`, then 0 rows; a no-op keeps `updated_at`;
  - `has_function_privilege`: anon and authenticated false, service_role true.
- **Race in two psql sessions.** A: `BEGIN; SELECT * FROM task_apply_update(id, p_status=>'done');`.
  B: a note-only call blocks. Commit A. B's row has both entries, and B's note has status `done`.
  With A cancelling, B gets 0 rows.
- **Through PostgREST** (scratch script):
  - the no-op rpc `[0]` stringifies equal to `.from('tasks').select('*').eq('id',id).single()`
    (priority, uuid[] and nested metadata set);
  - 19 note-only calls, 1 status change and 5 distinct-key merges in parallel on a fresh task give
    `history_len` 20 with every note and key present;
  - after `DROP FUNCTION`, the error names 019.
- **Gate.** `cct-gate` green.

## 6. Docs
- **`task-update.ts` description and `docs/mcp.md:101`.** Drop the conflict, "guarded as a whole"
  and #115 sentences. Add: "Each call is applied atomically on the server (row lock), so concurrent
  notes, merges and status changes are not lost."
- **Migration ranges.** "001 to 018"/"001-018" becomes 019 in `docs/mcp.md:12`, `install.md:48`,
  `install.md:242` and `dashboard.md:12`.
- **`CHANGELOG.md` `[Unreleased]`.** Edit lines 11 and 17 in place (drop "guarded", the conflict
  text and the #115 gap). Add under Changed: "task_update writes atomically through
  `task_apply_update()` (migration 019); apply 019 before rebuilding the MCP server (#115)."
- **`docs/architecture.md`.** Add a 019 row.
- **`docs/upgrading.md`.** A "Next release" section: pull, db push 019, rebuild, plus the error text.

Files: new `supabase/migrations/019_task_apply_update.sql` and
`supabase/tests/task_apply_update.test.sql`; edited `mcp-server/src/tools/task-update.ts`,
`mcp-server/src/tools/__tests__/task-compact.test.ts`, `CHANGELOG.md`,
`docs/{mcp,install,dashboard,architecture,upgrading}.md`.
