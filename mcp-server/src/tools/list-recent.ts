import { SupabaseClient } from "@supabase/supabase-js";
export interface ListRecentParams {
  days?: number;
  limit?: number;
}
export async function listRecent(
  supabase: SupabaseClient,
  params: ListRecentParams
): Promise<string> {
  const { days = 7, limit = 20 } = params;
  const since = new Date();
  since.setDate(since.getDate() - days);
  const { data, error } = await supabase
    .from("thoughts")
    .select("*")
    .is("deleted_at", null)
    .gte("created_at", since.toISOString())
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
  },
  handler: (deps, params) => listRecent(deps.supabase, params as ListRecentParams),
};