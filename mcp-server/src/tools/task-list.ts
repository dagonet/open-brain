import { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { resolveProject } from "../config.js";
import type { ToolDefinition } from "./registry.js";

export interface TaskListParams {
  project?: string;
  status?: string;
  priority?: number;
  limit?: number;
}

export async function taskList(
  supabase: SupabaseClient,
  params: TaskListParams,
): Promise<string> {
  const { status, priority, limit = 50, project } = params;

  const effectiveProject = resolveProject(project);

  let query = supabase
    .from("tasks")
    .select("*")
    .is("deleted_at", null);

  if (effectiveProject) {
    query = query.eq("project", effectiveProject);
  }

  if (status) {
    query = query.eq("status", status);
  }

  if (priority !== undefined && priority !== null) {
    query = query.eq("priority", priority);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return JSON.stringify({ error: error.message });
  }

  return JSON.stringify(data);
}

export const definition: ToolDefinition = {
  name: "task_list",
  description:
    "List tasks with optional filters by project, status, and priority. Ordered by creation date descending. Default limit is 50.",
  schema: {
    project: z
      .string()
      .optional()
      .describe("Filter by project. Falls back to OPEN_BRAIN_DEFAULT_PROJECT if omitted."),
    status: z
      .string()
      .optional()
      .describe("Filter by status: open, in_progress, blocked, done, cancelled."),
    priority: z
      .number()
      .int()
      .min(1)
      .max(5)
      .optional()
      .describe("Filter by priority 1-5."),
    limit: z
      .number()
      .int()
      .min(1)
      .optional()
      .default(50)
      .describe("Max results to return (default 50)."),
  },
  handler: (deps, params) => taskList(deps.supabase, params as TaskListParams),
};
