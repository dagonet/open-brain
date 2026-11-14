-- Migration 019: task_apply_update(), one atomic write for the MCP task_update tool (#115).
--
-- Before this migration the MCP server read the task row, built status_history and
-- metadata in Node and wrote them back, so two concurrent calls could drop a history
-- entry or a merged key. This function locks the row (SELECT ... FOR UPDATE) and derives
-- everything from the latest version: the status entry, the note-only entry, cancel
-- setting deleted_at, and the shallow metadata merge (a null value deletes the key).
-- Concurrent calls serialize on the row lock. A task that is missing or already
-- soft-deleted returns zero rows.
--
-- Parameters:
--   p_id              the task id
--   p_patch           jsonb object, keys limited to title, description, priority,
--                     linked_thought_ids, metadata; absent keys keep the current value
--   p_metadata_merge  jsonb object, shallow merge into metadata (null deletes a key)
--   p_status          new status; a change appends {status, at, note} to status_history
--   p_note            a note; with a changed status it rides on that entry, otherwise a
--                     non-blank note appends {status, at, note, kind: 'note'}
-- A call that changes nothing returns the current row without an UPDATE (updated_at
-- stays put). `at` and a cancel's deleted_at come from the database clock after the
-- lock, in the JavaScript toISOString() form (milliseconds, Z).
--
-- Security (as 016 to 018): SECURITY INVOKER, search_path = '', VOLATILE (STABLE would
-- make PostgREST run it read-only). EXECUTE is revoked from PUBLIC, anon and
-- authenticated (Supabase's default privileges grant it to them) and granted to
-- service_role only.
--
-- Idempotent: CREATE OR REPLACE / REVOKE / GRANT can be re-run.
-- Apply this migration BEFORE rebuilding the MCP server (docs/upgrading.md): the new
-- server calls the function and returns an error while it is missing.
--
-- Rollback:
--   DROP FUNCTION public.task_apply_update(uuid, jsonb, jsonb, text, text);
--   (then run an MCP server from before this migration; the new one needs it)

CREATE OR REPLACE FUNCTION public.task_apply_update(
  p_id uuid,
  p_patch jsonb DEFAULT '{}'::jsonb,
  p_metadata_merge jsonb DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_note text DEFAULT NULL
) RETURNS SETOF public.tasks
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  -- exactly the characters JavaScript String.prototype.trim() strips
  c_ws constant text := U&' \0009\000A\000D\000B\000C\00A0\1680\2000\2001\2002\2003\2004\2005'
                     || U&'\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
  cur public.tasks;
  nxt public.tasks;
  v_hist jsonb;
  v_at timestamptz;
  v_at_text text;
  v_change boolean;
  v_note_only boolean;
BEGIN
  IF jsonb_typeof(v_patch) <> 'object' THEN
    RAISE EXCEPTION 'p_patch must be a JSON object';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_patch) k
              WHERE k NOT IN ('title', 'description', 'priority', 'linked_thought_ids', 'metadata')) THEN
    RAISE EXCEPTION 'p_patch takes only title, description, priority, linked_thought_ids, metadata';
  END IF;
  IF v_patch ? 'metadata' AND p_metadata_merge IS NOT NULL THEN
    RAISE EXCEPTION 'Pass either metadata or metadata_merge, not both.';
  END IF;
  IF jsonb_typeof(p_metadata_merge) <> 'object' THEN
    RAISE EXCEPTION 'metadata_merge must be a JSON object';
  END IF;

  SELECT * INTO cur FROM public.tasks WHERE id = p_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_at := date_trunc('milliseconds', clock_timestamp());
  v_at_text := to_char(v_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_change := p_status IS NOT NULL AND p_status <> cur.status;
  v_note_only := p_note IS NOT NULL AND btrim(p_note, c_ws) <> '' AND NOT v_change;

  IF v_patch = '{}'::jsonb AND p_metadata_merge IS NULL AND NOT v_change AND NOT v_note_only
     AND p_status IS DISTINCT FROM 'cancelled' THEN
    RETURN NEXT cur;
    RETURN;
  END IF;

  nxt := jsonb_populate_record(cur, v_patch);
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
      'status', p_status, 'at', v_at_text, 'note', p_note));
  ELSIF v_note_only THEN
    nxt.status_history := v_hist || jsonb_build_array(jsonb_build_object(
      'status', cur.status, 'at', v_at_text, 'note', p_note, 'kind', 'note'));
  END IF;
  IF p_status = 'cancelled' THEN
    nxt.deleted_at := v_at;
  END IF;

  UPDATE public.tasks t
     SET title = nxt.title, description = nxt.description, priority = nxt.priority,
         linked_thought_ids = nxt.linked_thought_ids, metadata = nxt.metadata,
         status = nxt.status, status_history = nxt.status_history, deleted_at = nxt.deleted_at
   WHERE t.id = p_id
   RETURNING t.* INTO cur;
  RETURN NEXT cur;
END
$$;

REVOKE EXECUTE ON FUNCTION public.task_apply_update(uuid, jsonb, jsonb, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.task_apply_update(uuid, jsonb, jsonb, text, text)
  TO service_role;

NOTIFY pgrst, 'reload schema';
