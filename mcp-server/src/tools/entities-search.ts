import { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { ToolDefinition } from "./registry.js";

export interface EntitiesSearchParams {
  query: string;
  entity_type?: string;
  limit?: number;
}

export async function entitiesSearch(
  supabase: SupabaseClient,
  params: EntitiesSearchParams,
): Promise<string> {
  const { query, entity_type, limit = 20 } = params;

  const { data, error } = await supabase.rpc("entity_search", {
    query_text: query,
    filter_type: entity_type ?? null,
    result_limit: limit,
  });

  if (error) {
    return JSON.stringify({ error: error.message });
  }

  return JSON.stringify(data);
}

export const definition: ToolDefinition = {
  name: "entities_search",
  description:
    "Search entity nodes by name/type across the mind-graph. Returns matching entities with their mention count, thought count, and last-mentioned timestamp.",
  schema: {
    query: z.string().describe("Search query for entity name"),
    entity_type: z
      .string()
      .optional()
      .describe(
        "Optional filter by entity type (e.g. 'person', 'project', 'topic')",
      ),
    limit: z
      .number()
      .optional()
      .default(20)
      .describe("Max results to return (default 20)"),
  },
  handler: (deps, params) =>
    entitiesSearch(deps.supabase, params as unknown as EntitiesSearchParams),
};
