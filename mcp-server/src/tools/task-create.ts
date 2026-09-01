import { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { resolveProject } from '../config.js';
import type { ToolDefinition } from './registry.js';

export interface TaskCreateParams {
  title: string;
  description?: string;
  priority?: number;
  project?: string;
  linked_thought_ids?: string[];
  metadata?: Record<string, unknown>;
}

export async function taskCreate(
  supabase: SupabaseClient,
  params: TaskCreateParams,
): Promise<string> {
  const { title, description, priority, project, linked_thought_ids, metadata } = params;

  if (!title || title.trim().length === 0) {
    return JSON.stringify({ error: 'title is required and must be non-empty.' });
  }

  const effectiveProject = resolveProject(project);

  const { data, error } = await supabase
    .from('tasks')
    .insert({
      title: title.trim(),
      description: description ?? null,
      priority: priority ?? null,
      project: effectiveProject,
      linked_thought_ids: linked_thought_ids ?? [],
      metadata: metadata ?? {},
    })
    .select()
    .single();

  if (error) {
    return JSON.stringify({ error: error.message });
  }

  return JSON.stringify(data);
}

export const definition: ToolDefinition = {
  name: 'task_create',
  description:
    'Create a new task. Title is required; description, priority, project, linked_thought_ids, and metadata are optional. Falls back to OPEN_BRAIN_DEFAULT_PROJECT env var for project if not provided.',
  schema: {
    title: z.string().min(1).describe('Task title (required, non-empty).'),
    description: z.string().optional().describe('Optional task description.'),
    priority: z.number().int().min(1).max(5).optional().describe('Priority 1-5 (1 highest).'),
    project: z
      .string()
      .optional()
      .describe('Project scope. Falls back to OPEN_BRAIN_DEFAULT_PROJECT if omitted.'),
    linked_thought_ids: z
      .array(z.string().uuid())
      .optional()
      .describe('Optional UUIDs of linked thoughts.'),
    metadata: z.record(z.unknown()).optional().describe('Optional arbitrary metadata JSON object.'),
  },
  handler: (deps, params) => taskCreate(deps.supabase, params as unknown as TaskCreateParams),
};
