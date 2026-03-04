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
      suggestion: "Use list_recent as a fallback to browse recent thoughts without semantic search.",
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