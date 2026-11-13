import { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { ToolDefinition } from './registry.js';

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
    history_len: Array.isArray(row.status_history) ? row.status_history.length : 0,
  });
}

export async function taskUpdate(
  supabase: SupabaseClient,
  params: TaskUpdateParams,
): Promise<string> {
  const { id, title, description, priority, linked_thought_ids, metadata, status, note } = params;
  const { metadata_merge, echo } = params;

  if (metadata !== undefined && metadata_merge !== undefined) {
    return JSON.stringify({ error: 'Pass either metadata or metadata_merge, not both.' });
  }

  // Read the current task (must exist and not be deleted).
  const { data: current, error: readError } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();

  if (readError) {
    return JSON.stringify({ error: readError.message });
  }

  if (!current) {
    return JSON.stringify({ error: 'not found' });
  }

  // Build the update payload with only the fields that changed.
  const updates: Record<string, unknown> = {};

  if (title !== undefined) {
    if (title.trim().length === 0) {
      return JSON.stringify({ error: 'title must be non-empty.' });
    }
    updates.title = title;
  }
  if (description !== undefined) updates.description = description;
  if (priority !== undefined) updates.priority = priority;
  if (linked_thought_ids !== undefined) updates.linked_thought_ids = linked_thought_ids;
  if (metadata !== undefined) updates.metadata = metadata;

  if (metadata_merge !== undefined) {
    const base =
      typeof current.metadata === 'object' &&
      current.metadata !== null &&
      !Array.isArray(current.metadata)
        ? (current.metadata as Record<string, unknown>)
        : {};
    const merged: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(metadata_merge)) {
      if (value === null) {
        delete merged[key];
      } else {
        merged[key] = value;
      }
    }
    updates.metadata = merged;
  }

  // A note without a status change is kept as a note-only history entry.
  const noteOnly = note !== undefined && (status === undefined || status === current.status);
  if (noteOnly) {
    const history = Array.isArray(current.status_history) ? [...current.status_history] : [];
    history.push({
      status: current.status,
      at: new Date().toISOString(),
      note,
      kind: 'note',
    });
    updates.status_history = history;
  }

  // If status is changing, append to status_history.
  if (status !== undefined && status !== current.status) {
    const history = Array.isArray(current.status_history) ? [...current.status_history] : [];
    history.push({
      status,
      at: new Date().toISOString(),
      note: note ?? null,
    });
    updates.status = status;
    updates.status_history = history;
  }

  // If status is 'cancelled', soft-delete.
  if (status === 'cancelled') {
    updates.deleted_at = new Date().toISOString();
  }

  // Nothing to write: return the current row unchanged (an empty PATCH has no row to return).
  if (Object.keys(updates).length === 0) {
    return echo === 'compact' ? compactEcho(current) : JSON.stringify(current);
  }

  // Note-only appends and metadata merges read-modify-write, so guard against a concurrent write.
  const guarded = noteOnly || metadata_merge !== undefined;
  let writeQuery = supabase.from('tasks').update(updates).eq('id', id);
  if (guarded) {
    writeQuery = writeQuery.eq('updated_at', current.updated_at);
  }
  const { data, error: writeError } = await writeQuery.select().single();

  if (writeError) {
    if (guarded && (writeError as { code?: string }).code === 'PGRST116') {
      return JSON.stringify({ error: 'conflict, re-read and retry' });
    }
    return JSON.stringify({ error: writeError.message });
  }

  return echo === 'compact' ? compactEcho(data) : JSON.stringify(data);
}

export const definition: ToolDefinition = {
  name: 'task_update',
  description:
    "Update a task by ID. Supports changing title, description, priority, linked_thought_ids, metadata, and status. When status changes, appends an entry to status_history. Setting status to 'cancelled' also sets deleted_at (soft-delete). " +
    "A note now applies without a status change too: it is appended to status_history as a note-only entry (kind 'note') when status is absent or unchanged. " +
    'metadata_merge is a SHALLOW top-level merge into the current metadata (null value deletes the key), so to change metadata.plan send the whole plan object {owner, goal, next_step, done_check}; it cannot be combined with metadata. ' +
    "Note-only and metadata_merge writes fail with 'conflict, re-read and retry' if the task changed meanwhile. echo='compact' returns only {id, status, priority, updated_at, history_len}. A call that changes nothing returns the current row.",
  schema: {
    id: z.string().uuid().describe('UUID of the task to update.'),
    title: z.string().min(1).optional().describe('New title (non-empty when provided).'),
    description: z.string().optional().describe('New description.'),
    priority: z.number().int().min(1).max(5).optional().describe('New priority 1-5.'),
    linked_thought_ids: z.array(z.string().uuid()).optional().describe('New linked thought IDs.'),
    metadata: z
      .record(z.unknown())
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
      .record(z.unknown())
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
