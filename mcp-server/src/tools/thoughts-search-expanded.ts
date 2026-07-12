import { SupabaseClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { z } from "zod";
import { resolveProject } from "../config.js";
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
  const effectiveProject = resolveProject(project);

  // === Base leg: embed + match_thoughts_v2 ===
  let embedding: number[];
  try {
    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: query,
    });
    embedding = response.data[0].embedding;
  } catch (err) {
    return JSON.stringify({
      error: "Failed to generate embedding",
      message: err instanceof Error ? err.message : String(err),
    });
  }

  const { data: baseData, error: baseError } = await supabase.rpc(
    "match_thoughts_v2",
    {
      query_embedding: JSON.stringify(embedding),
      match_count: limit,
      filter_thought_type: null,
      filter_people: null,
      filter_topics: null,
      filter_days: null,
      filter_project: effectiveProject,
      recency_halflife_days: recency_halflife_days ?? 30,
      include_superseded: false,
      include_archived: false,
      apply_contradiction_penalty: true,
    },
  );

  if (baseError) {
    return JSON.stringify({ error: baseError.message });
  }

  const baseResults = Array.isArray(baseData) ? baseData : [];

  // === Expansion leg: thought IDs → related_thoughts_via_entities ===
  // Degrade gracefully on failure — expansion is best-effort.
  let expansionResults: unknown[] = [];
  try {
    const ids = (baseResults as Array<Record<string, unknown>>).map(
      (r) => r.id,
    );
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
