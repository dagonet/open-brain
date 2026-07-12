import { SupabaseClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { resolveProject } from "../config.js";

export interface SemanticSearchParams {
  query: string;
  limit?: number;
  thought_type?: string;
  people?: string[];
  topics?: string[];
  days?: number;
  /** If omitted, falls back to OPEN_BRAIN_DEFAULT_PROJECT env var. */
  project?: string;
  /** Half-life for recency decay (default 30 days). */
  recency_halflife_days?: number;
  /** Include thoughts that have been superseded (default false). */
  include_superseded?: boolean;
  /** Include thoughts with archived lifecycle status (default false). */
  include_archived?: boolean;
  /** Apply contradiction penalty to scoring (default true). */
  apply_contradiction_penalty?: boolean;
}

export async function semanticSearch(
  supabase: SupabaseClient,
  openai: OpenAI,
  params: SemanticSearchParams,
): Promise<string> {
  const {
    query,
    limit = 10,
    thought_type,
    people,
    topics,
    days,
    project,
    recency_halflife_days,
    include_superseded,
    include_archived,
    apply_contradiction_penalty,
  } = params;

  const effectiveProject = resolveProject(project);

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
      suggestion:
        "Use thoughts_recent as a fallback to browse recent thoughts without semantic search.",
    });
  }

  const { data, error } = await supabase.rpc("match_thoughts_v2", {
    query_embedding: JSON.stringify(embedding),
    match_count: limit,
    filter_thought_type: thought_type ?? null,
    filter_people: people ?? null,
    filter_topics: topics ?? null,
    filter_days: days ?? null,
    filter_project: effectiveProject,
    recency_halflife_days: recency_halflife_days ?? 30,
    include_superseded: include_superseded ?? false,
    include_archived: include_archived ?? false,
    apply_contradiction_penalty: apply_contradiction_penalty ?? true,
  });

  if (error) {
    return JSON.stringify({ error: error.message });
  }

  // Fire-and-forget retrieval tracking — never blocks or fails the response.
  if (Array.isArray(data) && data.length > 0) {
    const ids = (data as Array<Record<string, unknown>>).map((r) => r.id);
    void (async () => {
      try {
        await supabase.rpc("increment_retrieval", { ids });
      } catch (trackErr: unknown) {
        console.error("[thoughts_search] tracking failed:", trackErr);
      }
    })();
  }

  return JSON.stringify(data);
}

import { z } from "zod";
import type { ToolDefinition } from "./registry.js";

export const definition: ToolDefinition = {
  name: "thoughts_search",
  description:
    "Search thoughts by semantic similarity. Embeds the query and finds the most relevant thoughts using hybrid ranking (cosine similarity, recency, salience, and contradiction-penalty scoring).",
  schema: {
    query: z
      .string()
      .describe("The search query to embed and match against thoughts"),
    limit: z.number().optional().default(10).describe("Max results to return"),
    thought_type: z
      .enum([
        "decision",
        "insight",
        "meeting",
        "action",
        "reference",
        "question",
        "note",
      ])
      .optional()
      .describe("Filter by thought type"),
    people: z
      .array(z.string())
      .optional()
      .describe("Filter by people mentioned"),
    topics: z.array(z.string()).optional().describe("Filter by topics"),
    days: z
      .number()
      .optional()
      .describe("Only search thoughts from the last N days"),
    project: z
      .string()
      .optional()
      .describe(
        "Filter by project. Falls back to OPEN_BRAIN_DEFAULT_PROJECT env var if set and this param is omitted.",
      ),
    recency_halflife_days: z
      .number()
      .optional()
      .default(30)
      .describe(
        "Half-life in days for recency decay (default 30). A 30-day-old thought scores 0.5x.",
      ),
    include_superseded: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Include thoughts that have been superseded by newer entries (default false).",
      ),
    include_archived: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Include thoughts with archived lifecycle status (default false).",
      ),
    apply_contradiction_penalty: z
      .boolean()
      .optional()
      .default(true)
      .describe(
        "Apply a 0.7 scoring penalty to thoughts involved in open contradictions (default true).",
      ),
  },
  handler: (deps, params) =>
    semanticSearch(
      deps.supabase,
      deps.openai,
      params as unknown as SemanticSearchParams,
    ),
};
