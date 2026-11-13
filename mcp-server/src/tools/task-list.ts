import { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { resolveProject } from '../config.js';
import type { ToolDefinition } from './registry.js';
import { compactRow } from './task-shape.js';

export interface TaskListParams {
  project?: string;
  status?: string;
  priority?: number;
  limit?: number;
  compact?: boolean;
  statuses?: string[];
  stale_days?: number;
  priority_missing?: boolean;
  sort?: 'created' | 'priority';
}

const COMPACT_COLUMNS = 'id,title,status,priority,created_at,updated_at,plan:metadata->plan';
const MS_PER_DAY = 86_400_000;

export async function taskList(supabase: SupabaseClient, params: TaskListParams): Promise<string> {
  const { status, priority, limit = 50, project } = params;
  const { compact, statuses, stale_days, priority_missing, sort } = params;

  if (status && statuses !== undefined) {
    return JSON.stringify({ error: 'Pass either status or statuses, not both.' });
  }
  if (priority !== undefined && priority !== null && priority_missing === true) {
    return JSON.stringify({ error: 'Pass either priority or priority_missing, not both.' });
  }

  const effectiveProject = resolveProject(project);

  let query = supabase
    .from('tasks')
    .select(compact === true ? COMPACT_COLUMNS : '*')
    .is('deleted_at', null);

  if (effectiveProject) {
    query = query.eq('project', effectiveProject);
  }

  if (status) {
    query = query.eq('status', status);
  }

  if (statuses !== undefined) {
    query = query.in('status', statuses);
  }

  if (priority !== undefined && priority !== null) {
    query = query.eq('priority', priority);
  }

  if (priority_missing === true) {
    query = query.is('priority', null);
  }

  if (stale_days !== undefined) {
    const cutoff = new Date(Date.now() - stale_days * MS_PER_DAY).toISOString();
    query = query.lt('updated_at', cutoff);
  }

  const ordered =
    sort === 'priority'
      ? query
          .order('priority', { ascending: true, nullsFirst: false })
          .order('updated_at', { ascending: true })
      : query.order('created_at', { ascending: false });

  const { data, error } = await ordered.limit(limit);

  if (error) {
    return JSON.stringify({ error: error.message });
  }

  if (compact === true) {
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    return JSON.stringify(rows.map(compactRow));
  }

  return JSON.stringify(data);
}

export const definition: ToolDefinition = {
  name: 'task_list',
  description:
    'List tasks with optional filters by project, status, and priority. Ordered by creation date descending. Default limit is 50. ' +
    'Set compact=true for small rows {id, title (100 chars), status, priority, created_at, updated_at, planned} instead of full rows; ' +
    "planned is true when metadata.plan = {owner, goal, next_step, done_check} is complete. Extra filters: statuses (list), stale_days (not updated for N days), priority_missing; sort='priority' orders by priority (unset last), then oldest update.",
  schema: {
    project: z
      .string()
      .optional()
      .describe('Filter by project. Falls back to OPEN_BRAIN_DEFAULT_PROJECT if omitted.'),
    status: z
      .string()
      .optional()
      .describe('Filter by status: open, in_progress, blocked, done, cancelled.'),
    priority: z.number().int().min(1).max(5).optional().describe('Filter by priority 1-5.'),
    limit: z
      .number()
      .int()
      .min(1)
      .optional()
      .default(50)
      .describe('Max results to return (default 50).'),
    compact: z
      .boolean()
      .optional()
      .describe('Return small rows without description, metadata or status_history.'),
    statuses: z
      .array(z.enum(['open', 'in_progress', 'blocked', 'done']))
      .min(1)
      .optional()
      .describe('Filter by any of these statuses. Cannot be combined with status.'),
    stale_days: z
      .number()
      .int()
      .min(1)
      .max(36500)
      .optional()
      .describe('Only tasks not updated for at least this many days.'),
    priority_missing: z
      .boolean()
      .optional()
      .describe('When true, only tasks without a priority. Cannot be combined with priority.'),
    sort: z
      .enum(['created', 'priority'])
      .optional()
      .describe("'created' (default) newest first; 'priority' highest first, unset last."),
  },
  handler: (deps, params) => taskList(deps.supabase, params as TaskListParams),
};
