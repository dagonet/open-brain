import { SupabaseClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { z } from "zod";
import { baseSemanticSearch } from "./search-core.js";
import type { ToolDefinition } from "./registry.js";

export interface ThoughtsSearchExpandedParams {
  query: string;
  project?: string;
  limit?: number;
  recency_halflife_days?: number;
}

export async function thoughtsSearchExpanded(
  supabase: SupabaseClient,
  openai: OpenAI,
  params: ThoughtsSearchExpandedParams,
): Promise<string> {
  const { query, project, limit = 10, recency_halflife_days } = params;

  // === Base leg: shared helper handles embed + match_thoughts_v2 + tracking ===
  const base = await baseSemanticSearch(supabase, openai, {
    query,
    limit,
    thought_type: null,
    people: null,
    topics: null,
    days: null,
    project: project ?? null,
    recency_halflife_days,
    include_superseded: false,
    include_archived: false,
    apply_contradiction_penalty: true,
  });

  if (base.error) {
    return JSON.stringify({ error: base.error });
  }

  const baseResults = base.data ?? [];

  // === Expansion leg: thought IDs → related_thoughts_via_entities ===
  // Degrade gracefully on failure — expansion is best-effort.
  let expansionResults: Array<Record<string, unknown>> = [];
  try {
    const ids = baseResults.map((r) => r.id as string);
    if (ids.length > 0) {
      const { data: expData, error: expError } = await supabase.rpc(
        "related_thoughts_via_entities",
        {
          seed_thought_ids: ids,
          result_limit: limit,
          max_entity_degree: 20,
        },
      );
      if (!expError && Array.isArray(expData)) {
        expansionResults = expData;

        // Fire-and-forget retrieval tracking for expansion results too.
        const expIds = (expData as Array<Record<string, unknown>>).map(
          (r) => r.thought_id,
        );
        if (expIds.length > 0) {
          void (async () => {
            try {
              await supabase.rpc("increment_retrieval", { ids: expIds });
            } catch (trackErr: unknown) {
              console.error(
                "[thoughts_search_expanded] expansion tracking failed:",
                trackErr,
              );
            }
          })();
        }
      }
    }
  } catch {
    // expansion errors are non-fatal
  }

  return JSON.stringify({
    results: baseResults,
    related_via_entities: expansionResults,
  });
}

export const definition: ToolDefinition = {
  name: "thoughts_search_expanded",
  description:
    "Search thoughts with entity-expanded results. Performs semantic search, then uses entity graph traversal to find related thoughts the pure semantic match would miss. Prefer it to surface connected memories a pure semantic search misses.",
  schema: {
    query: z.string().describe("The search query to embed and match against thoughts"),
    project: z
      .string()
      .optional()
      .describe(
        "Filter by project. Falls back to OPEN_BRAIN_DEFAULT_PROJECT env var if set and this param is omitted.",
      ),
    limit: z
      .number()
      .optional()
      .default(10)
      .describe("Max results to return (default 10)"),
    recency_halflife_days: z
      .number()
      .optional()
      .default(30)
      .describe(
        "Half-life in days for recency decay (default 30). A 30-day-old thought scores 0.5x.",
      ),
  },
  handler: (deps, params) =>
    thoughtsSearchExpanded(
      deps.supabase,
      deps.openai,
      params as unknown as ThoughtsSearchExpandedParams,
    ),
};
