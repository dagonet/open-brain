import { SupabaseClient } from "@supabase/supabase-js";
import { resolveProject } from "../config.js";
export interface ListRecentParams {
  days?: number;
  limit?: number;
  /** If omitted, falls back to OPEN_BRAIN_DEFAULT_PROJECT env var. */
  project?: string;
}
export async function listRecent(
  supabase: SupabaseClient,
  params: ListRecentParams
): Promise<string> {
  const { days = 7, limit = 20, project } = params;
  const since = new Date();
  since.setDate(since.getDate() - days);

  const effectiveProject = resolveProject(project);

  let query = supabase
    .from("thoughts")
    .select("*")
    .is("deleted_at", null)
    .gte("created_at", since.toISOString());

  if (effectiveProject) {
    query = query.eq("project", effectiveProject);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return JSON.stringify({ error: error.message });
  }
  return JSON.stringify(data);
}

import { z } from "zod";
import type { ToolDefinition } from "./registry.js";

export const definition: ToolDefinition = {
  name: "thoughts_recent",
  description: "List recent thoughts ordered by creation date. No embedding needed -- useful as a fallback when semantic search is unavailable.",
  schema: {
    days: z.number().optional().default(7).describe("Number of days to look back"),
    limit: z.number().optional().default(20).describe("Max results to return"),
    project: z
      .string()
      .optional()
      .describe("Filter by project. Falls back to OPEN_BRAIN_DEFAULT_PROJECT env var if set and this param is omitted."),
  },
  handler: (deps, params) => listRecent(deps.supabase, params as ListRecentParams),
};