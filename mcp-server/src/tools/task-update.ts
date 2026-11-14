import { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { ToolDefinition } from './registry.js';
import { historyLen } from './task-shape.js';

export interface TaskUpdateParams {
  id: string;
  title?: string;
  description?: string;
  priority?: number;
  linked_thought_ids?: string[];
  metadata?: Record<string, unknown>;
  status?: string;
  /** Optional note appended to status_history (with or without a status change). */
  note?: string;
  /** Shallow top-level merge into the current metadata; a null value deletes the key. */
  metadata_merge?: Record<string, unknown>;
  /** 'compact' returns {id, status, priority, updated_at, history_len}. */
  echo?: 'full' | 'compact';
}

function compactEcho(row: Record<string, unknown>): string {
  return JSON.stringify({
    id: row.id,
    status: row.status,
    priority: row.priority,
    updated_at: row.updated_at,
    history_len: historyLen(row),
  });
}

const MIGRATION_019_MISSING =
  'task_update needs database migration 019 (task_apply_update): run `supabase db push --remote`, see docs/upgrading.md';

/** True when PostgREST or Postgres says the function is missing (migration 019 not applied). */
function isMissingFunction(error: { code?: string; message: string }): boolean {
  return (
    error.code === 'PGRST202' ||
    error.code === '42883' ||
    /function .* does not exist/i.test(error.message)
  );
}

function pickDefined(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined));
}

const err = (message: string): string => JSON.stringify({ error: message });

export async function taskUpdate(
  supabase: SupabaseClient,
  params: TaskUpdateParams,
): Promise<string> {
  const { id, title, description, priority, linked_thought_ids, metadata, status, note } = params;
  const { metadata_merge, echo } = params;

  if (metadata !== undefined && metadata_merge !== undefined) {
    return err('Pass either metadata or metadata_merge, not both.');
  }

  if (title !== undefined && title.trim().length === 0) {
    // Error path only, no write: a missing task still reports 'not found' first.
    const { data: current, error: readError } = await supabase
      .from('tasks')
      .select('id')
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle();
    return err(readError ? readError.message : !current ? 'not found' : 'title must be non-empty.');
  }

  // One SQL function locks the row and applies the whole update to its latest version.
  const patch = pickDefined({ title, description, priority, linked_thought_ids, metadata });
  const args = {
    p_id: id,
    p_patch: patch,
    ...pickDefined({ p_metadata_merge: metadata_merge, p_status: status, p_note: note }),
  };
  const { data, error } = await supabase.rpc('task_apply_update', args);

  if (error) {
    return err(
      isMissingFunction(error) ? `${MIGRATION_019_MISSING} (${error.message})` : error.message,
    );
  }

  const written = Array.isArray(data)
    ? (data[0] as Record<string, unknown> | undefined)
    : undefined;
  if (!written) {
    return err('not found');
  }

  return echo === 'compact' ? compactEcho(written) : JSON.stringify(written);
}

export const definition: ToolDefinition = {
  name: 'task_update',
  description:
    "Update a task by ID. Supports changing title, description, priority, linked_thought_ids, metadata, and status. When status changes, appends an entry to status_history. Setting status to 'cancelled' also sets deleted_at (soft-delete). " +
    "A note also applies without a status change: it is appended to status_history as a note-only entry (kind 'note') when status is absent or unchanged. " +
    'metadata_merge is a SHALLOW top-level merge into the current metadata (null value deletes the key), so to change metadata.plan send the whole plan object {owner, goal, next_step, done_check}; it cannot be combined with metadata. ' +
    "metadata_merge replaces a key whole: if metadata.plan is text (plan_shape 'text' in compact rows), copy that text to `plan_text` in the same metadata_merge call, or it is lost. " +
    "echo='compact' returns only {id, status, priority, updated_at, history_len}. A call that changes nothing returns the current row. " +
    'Each call is applied atomically on the server (row lock), so concurrent notes, merges and status changes are not lost.',
  schema: {
    id: z.guid().describe('UUID of the task to update.'),
    title: z.string().min(1).optional().describe('New title (non-empty when provided).'),
    description: z.string().optional().describe('New description.'),
    priority: z.number().int().min(1).max(5).optional().describe('New priority 1-5.'),
    linked_thought_ids: z.array(z.guid()).optional().describe('New linked thought IDs.'),
    metadata: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('New metadata JSON object (replaces existing).'),
    status: z
      .string()
      .optional()
      .describe('New status: open, in_progress, blocked, done, cancelled.'),
    note: z
      .string()
      .optional()
      .describe(
        'Optional note appended to status_history. Applies with a status change, and also alone or with an unchanged status (note-only entry).',
      ),
    metadata_merge: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'Shallow top-level merge into metadata; a null value deletes that key. Nested objects (e.g. plan) are replaced whole. Cannot be combined with metadata.',
      ),
    echo: z
      .enum(['full', 'compact'])
      .optional()
      .describe("'compact' returns {id, status, priority, updated_at, history_len}."),
  },
  handler: (deps, params) => taskUpdate(deps.supabase, params as unknown as TaskUpdateParams),
};
