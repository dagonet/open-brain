-- pgTAP tests for public.task_apply_update() (migration 019, #115).
-- Run locally with `supabase test db` (needs `supabase start`). Everything rolls back.
--
-- A test transaction has one now(), so each task is inserted with an old updated_at:
-- a real write moves it to now() (trigger), a no-op leaves it alone.

BEGIN;
SELECT plan(42);

INSERT INTO public.tasks (id, title, status, priority, metadata, status_history, updated_at) VALUES
  ('00000000-0000-4000-8000-000000000001', 'T1', 'open', 3, '{"keep":1,"drop":2,"plan":{"old":true}}', '[]', '2020-01-01Z'),
  ('00000000-0000-4000-8000-000000000002', 'T2', 'blocked', NULL, '{}', '[]', '2020-01-01Z'),
  ('00000000-0000-4000-8000-000000000003', 'T3', 'open', NULL, '{"x":1}', '[]', '2020-01-01Z'),
  ('00000000-0000-4000-8000-000000000004', 'T4', 'open', NULL, '"str"', '{"not":"array"}', '2020-01-01Z'),
  ('00000000-0000-4000-8000-000000000005', 'T5', 'open', NULL, '{}', '[]', '2020-01-01Z'),
  ('00000000-0000-4000-8000-000000000006', 'T6', 'open', NULL, '{}', '[]', '2020-01-01Z');
INSERT INTO public.tasks (id, title, status, deleted_at) VALUES
  ('00000000-0000-4000-8000-0000000000dd', 'gone', 'cancelled', now());

-- status entry
SELECT is((SELECT status FROM public.task_apply_update('00000000-0000-4000-8000-000000000001', p_status => 'done', p_note => 'ok')),
  'done', 'status change sets status');
SELECT is((SELECT status_history FROM public.tasks WHERE id = '00000000-0000-4000-8000-000000000001') #>> '{0,note}',
  'ok', 'status entry carries the note');
SELECT is((SELECT jsonb_typeof(status_history -> 0 -> 'kind') FROM public.tasks WHERE id = '00000000-0000-4000-8000-000000000001'),
  NULL, 'status entry has no kind');
SELECT matches((SELECT status_history #>> '{0,at}' FROM public.tasks WHERE id = '00000000-0000-4000-8000-000000000001'),
  '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$', 'at is in toISOString() form');
SELECT isnt((SELECT updated_at FROM public.tasks WHERE id = '00000000-0000-4000-8000-000000000001'),
  '2020-01-01Z'::timestamptz, 'a write moves updated_at');

-- status change without note: note is JSON null
SELECT is((SELECT jsonb_typeof(status_history -> 0 -> 'note') FROM public.task_apply_update('00000000-0000-4000-8000-000000000005', p_status => 'blocked')),
  'null', 'status change without note stores note null');

-- note-only entry
SELECT is((SELECT status_history -> 1 FROM public.task_apply_update('00000000-0000-4000-8000-000000000001', p_note => 'later')) - 'at',
  '{"status":"done","note":"later","kind":"note"}'::jsonb, 'note-only entry has kind note, current status');
SELECT is((SELECT jsonb_array_length(status_history) FROM public.tasks WHERE id = '00000000-0000-4000-8000-000000000001'),
  2, 'history holds both entries');

-- same status plus note is a note-only entry
SELECT is((SELECT status_history -> 0 ->> 'kind' FROM public.task_apply_update('00000000-0000-4000-8000-000000000002', p_status => 'blocked', p_note => 'still stuck')),
  'note', 'same status plus note is a note-only entry');
SELECT is((SELECT status FROM public.tasks WHERE id = '00000000-0000-4000-8000-000000000002'),
  'blocked', 'same status plus note keeps the status');

-- blank notes: no entry, no write (U+00A0, U+FEFF, U+3000 are trimmed like JavaScript trim())
SELECT is((SELECT jsonb_array_length(status_history) FROM public.task_apply_update('00000000-0000-4000-8000-000000000003', p_note => '')),
  0, 'empty note adds nothing');
SELECT is((SELECT jsonb_array_length(status_history) FROM public.task_apply_update('00000000-0000-4000-8000-000000000003',
  p_note => E'  \u00A0\uFEFF\u3000\t\n')), 0, 'whitespace-only note adds nothing');
SELECT is((SELECT updated_at FROM public.tasks WHERE id = '00000000-0000-4000-8000-000000000003'),
  '2020-01-01Z'::timestamptz, 'blank note does not bump updated_at');
SELECT is((SELECT status_history -> 0 ->> 'note' FROM public.task_apply_update('00000000-0000-4000-8000-000000000003', p_status => 'done', p_note => '')),
  '', 'blank note with a status change is kept');

-- non-array history starts a new array
SELECT is((SELECT jsonb_array_length(status_history) FROM public.task_apply_update('00000000-0000-4000-8000-000000000004', p_note => 'n')),
  1, 'non-array history starts a new array');

-- patch fields
SELECT is((SELECT title || priority::text FROM public.task_apply_update('00000000-0000-4000-8000-000000000005', p_patch => '{"title":"N","priority":2}')),
  'N2', 'patch sets title and priority');
SELECT is((SELECT linked_thought_ids FROM public.task_apply_update('00000000-0000-4000-8000-000000000005',
  p_patch => '{"linked_thought_ids":["11111111-1111-4111-8111-111111111111"]}')),
  ARRAY['11111111-1111-4111-8111-111111111111']::uuid[], 'patch sets linked_thought_ids');
SELECT is((SELECT metadata FROM public.task_apply_update('00000000-0000-4000-8000-000000000005', p_patch => '{"metadata":{"a":1}}')),
  '{"a":1}'::jsonb, 'patch metadata replaces');
SELECT is((SELECT title FROM public.tasks WHERE id = '00000000-0000-4000-8000-000000000005'),
  'N', 'untouched fields keep their value');

-- merge, null deletes
SELECT is((SELECT metadata FROM public.task_apply_update('00000000-0000-4000-8000-000000000001',
  p_metadata_merge => '{"drop":null,"plan":{"goal":"g"},"added":"x"}')),
  '{"keep":1,"plan":{"goal":"g"},"added":"x"}'::jsonb, 'merge is shallow, null deletes');
SELECT is((SELECT metadata FROM public.task_apply_update('00000000-0000-4000-8000-000000000004', p_metadata_merge => '{"a":1,"b":null}')),
  '{"a":1}'::jsonb, 'merge on a non-object base starts from {}');
SELECT is((SELECT updated_at FROM public.task_apply_update('00000000-0000-4000-8000-000000000006', p_metadata_merge => '{}')) > '2020-01-01Z'::timestamptz,
  true, 'an empty merge still writes');

-- errors
SELECT throws_ok($$SELECT * FROM public.task_apply_update('00000000-0000-4000-8000-000000000001', p_patch => '{"metadata":{}}', p_metadata_merge => '{}')$$,
  'P0001', 'Pass either metadata or metadata_merge, not both.', 'metadata plus merge raises');
SELECT throws_ok($$SELECT * FROM public.task_apply_update('00000000-0000-4000-8000-000000000001', p_patch => '{"status":"done"}')$$,
  'P0001', NULL, 'an unknown patch key raises');
SELECT throws_ok($$SELECT * FROM public.task_apply_update('00000000-0000-4000-8000-000000000001', p_metadata_merge => '[1]')$$,
  'P0001', 'metadata_merge must be a JSON object', 'a non-object merge raises');
SELECT throws_ok($$SELECT * FROM public.task_apply_update('00000000-0000-4000-8000-000000000001', p_status => 'bogus')$$,
  '23514', NULL, 'a bad status keeps the CHECK error');

-- no-op returns the row without writing
SELECT is((SELECT count(*) FROM public.task_apply_update('00000000-0000-4000-8000-000000000003')), 1::bigint, 'bare id returns the row');
INSERT INTO public.tasks (id, title, status, status_history, updated_at) VALUES
  ('00000000-0000-4000-8000-0000000000ab', 'same', 'blocked', '[{"status":"blocked","at":"x","note":null}]', '2020-01-01Z');
SELECT is((SELECT updated_at FROM public.task_apply_update('00000000-0000-4000-8000-0000000000ab', p_status => 'blocked')),
  '2020-01-01Z'::timestamptz, 'same status without note keeps updated_at');
SELECT is((SELECT jsonb_array_length(status_history) FROM public.task_apply_update('00000000-0000-4000-8000-0000000000ab', p_status => 'blocked')),
  1, 'same status without note keeps the history length');
INSERT INTO public.tasks (id, title, updated_at) VALUES ('00000000-0000-4000-8000-0000000000aa', 'noop', '2020-01-01Z');
SELECT is((SELECT updated_at FROM public.task_apply_update('00000000-0000-4000-8000-0000000000aa')),
  '2020-01-01Z'::timestamptz, 'no-op keeps updated_at');

-- cancel sets deleted_at, then not found
SELECT is((SELECT deleted_at IS NOT NULL AND status = 'cancelled' AND date_trunc('milliseconds', deleted_at) = deleted_at
  FROM public.task_apply_update('00000000-0000-4000-8000-000000000006', p_status => 'cancelled', p_note => 'dropped')),
  true, 'cancel sets deleted_at (millisecond precision)');
SELECT is((SELECT count(*) FROM public.task_apply_update('00000000-0000-4000-8000-000000000006', p_note => 'late')),
  0::bigint, 'a cancelled task is not found');
SELECT is((SELECT count(*) FROM public.task_apply_update('00000000-0000-4000-8000-0000000000dd', p_note => 'x')),
  0::bigint, 'an already-deleted task is not found');
SELECT is((SELECT count(*) FROM public.task_apply_update('00000000-0000-4000-8000-0000000000ff', p_note => 'x')),
  0::bigint, 'an unknown id is not found');

-- combined calls
SELECT is((SELECT title || (status_history -> -1 ->> 'kind') FROM public.task_apply_update('00000000-0000-4000-8000-000000000005',
  p_patch => '{"title":"Combo"}', p_note => 'why')), 'Combonote', 'title plus note writes both');
SELECT is((SELECT status || (metadata ->> 'm') || jsonb_array_length(status_history)::text FROM public.task_apply_update('00000000-0000-4000-8000-000000000005',
  p_status => 'in_progress', p_metadata_merge => '{"m":"x"}')), 'in_progressx3', 'status change plus merge writes both');

-- patch keys outside the allowed five are refused, so a patch cannot rewrite id, history or deleted_at
SELECT throws_ok($$SELECT * FROM public.task_apply_update('00000000-0000-4000-8000-000000000005', p_patch => '{"id":"00000000-0000-4000-8000-0000000000ee"}')$$,
  'P0001', NULL, 'a patch with id is refused');
SELECT throws_ok($$SELECT * FROM public.task_apply_update('00000000-0000-4000-8000-000000000005', p_patch => '{"deleted_at":"2020-01-01Z"}')$$,
  'P0001', NULL, 'a patch with deleted_at is refused');
SELECT throws_ok($$SELECT * FROM public.task_apply_update('00000000-0000-4000-8000-000000000005', p_patch => '{"status_history":[]}')$$,
  'P0001', NULL, 'a patch with status_history is refused');
SELECT throws_ok($$SELECT * FROM public.task_apply_update('00000000-0000-4000-8000-000000000005', p_patch => '[1]')$$,
  'P0001', 'p_patch must be a JSON object', 'a non-object patch is refused');

-- privileges
SELECT is(has_function_privilege('anon', 'public.task_apply_update(uuid,jsonb,jsonb,text,text)', 'EXECUTE')
  OR has_function_privilege('authenticated', 'public.task_apply_update(uuid,jsonb,jsonb,text,text)', 'EXECUTE'),
  false, 'anon and authenticated cannot execute');
SELECT is(has_function_privilege('service_role', 'public.task_apply_update(uuid,jsonb,jsonb,text,text)', 'EXECUTE'),
  true, 'service_role can execute');

SELECT * FROM finish();
ROLLBACK;
