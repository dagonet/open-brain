import { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { ToolDefinition } from './registry.js';
import { compactRow, truncateCodePoints } from './task-list.js';

export interface TaskGetParams {
  id: string;
  compact?: boolean;
  description_chars?: number;
}

const DEFAULT_DESCRIPTION_CHARS = 300;

export async function taskGet(supabase: SupabaseClient, params: TaskGetParams): Promise<string> {
  const { id, compact, description_chars } = params;

  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) {
    return JSON.stringify({ error: error.message });
  }

  if (!data) {
    return JSON.stringify({ error: 'not found' });
  }

  if (compact === true) {
    const row = data as Record<string, unknown>;
    const metadata = row.metadata;
    const plan =
      typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata)
        ? ((metadata as Record<string, unknown>).plan ?? null)
        : null;
    const description =
      typeof row.description === 'string'
        ? truncateCodePoints(row.description, description_chars ?? DEFAULT_DESCRIPTION_CHARS)
        : null;
    return JSON.stringify({
      ...compactRow({ ...row, plan }),
      description,
      plan,
      history_len: Array.isArray(row.status_history) ? row.status_history.length : 0,
    });
  }

  return JSON.stringify(data);
}

export const definition: ToolDefinition = {
  name: 'task_get',
  description:
    "Get a single task by ID. Returns the task row or {error:'not found'} if the task does not exist or has been deleted. " +
    'Set compact=true for a small answer: the compact list row plus description (cut to description_chars, default 300), plan (metadata.plan) and history_len, without metadata or status_history.',
  schema: {
    id: z.string().uuid().describe('UUID of the task to retrieve.'),
    compact: z
      .boolean()
      .optional()
      .describe('Return the compact row plus description, plan and history_len.'),
    description_chars: z
      .number()
      .int()
      .min(0)
      .max(2000)
      .optional()
      .describe('With compact: max description characters (default 300).'),
  },
  handler: (deps, params) => taskGet(deps.supabase, params as unknown as TaskGetParams),
};
