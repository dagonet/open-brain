import { SupabaseClient } from "@supabase/supabase-js";
import OpenAI from "openai";
export interface SemanticSearchParams {
  query: string;
  limit?: number;
  thought_type?: string;
  people?: string[];
  topics?: string[];
  days?: number;
}
export async function semanticSearch(
  supabase: SupabaseClient,
  openai: OpenAI,
  params: SemanticSearchParams
): Promise<string> {
  const { query, limit = 10, thought_type, people, topics, days } = params;
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
      suggestion: "Use thoughts_recent as a fallback to browse recent thoughts without semantic search.",
    });
  }
  const { data, error } = await supabase.rpc("match_thoughts", {
    query_embedding: JSON.stringify(embedding),
    match_count: limit,
    filter_thought_type: thought_type ?? null,
    filter_people: people ?? null,
    filter_topics: topics ?? null,
    filter_days: days ?? null,
  });
  if (error) {
    return JSON.stringify({ error: error.message });
  }
  return JSON.stringify(data);
}

import { z } from "zod";
import type { ToolDefinition } from "./registry.js";

export const definition: ToolDefinition = {
  name: "thoughts_search",
  description: "Search thoughts by semantic similarity. Embeds the query and finds the most relevant thoughts.",
  schema: {
    query: z.string().describe("The search query to embed and match against thoughts"),
    limit: z.number().optional().default(10).describe("Max results to return"),
    thought_type: z
      .enum(["decision", "insight", "meeting", "action", "reference", "question", "note"])
      .optional()
      .describe("Filter by thought type"),
    people: z.array(z.string()).optional().describe("Filter by people mentioned"),
    topics: z.array(z.string()).optional().describe("Filter by topics"),
    days: z.number().optional().describe("Only search thoughts from the last N days"),
  },
  handler: (deps, params) => semanticSearch(deps.supabase, deps.openai, params as unknown as SemanticSearchParams),
};