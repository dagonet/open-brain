import { SupabaseClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { resolveProject } from '../config.js';

/**
 * Parameters for the base semantic search (embed + match_thoughts_v2).
 * Every field maps to a match_thoughts_v2 RPC parameter.
 */
export interface BaseSearchParams {
  query: string;
  limit?: number;
  thought_type?: string | null;
  people?: string[] | null;
  topics?: string[] | null;
  days?: number | null;
  project?: string | null;
  recency_halflife_days?: number;
  include_superseded?: boolean;
  include_archived?: boolean;
  apply_contradiction_penalty?: boolean;
}

export interface BaseSearchResult {
  data: Record<string, unknown>[] | null;
  error: string | null;
  /** True when the error came from OpenAI embedding generation (vs. RPC). */
  isEmbeddingError?: boolean;
}

/**
 * Core semantic search: generate embedding, call match_thoughts_v2, fire
 * increment_retrieval tracking, and return structured results.
 *
 * Consumers (semanticSearch, thoughtsSearchExpanded) wrap the result with
 * their own error formatting and post-processing.
 */
export async function baseSemanticSearch(
  supabase: SupabaseClient,
  openai: OpenAI,
  params: BaseSearchParams,
): Promise<BaseSearchResult> {
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

  // --- Embed ---
  let embedding: number[];
  try {
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: query,
    });
    embedding = response.data[0].embedding;
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : String(err),
      isEmbeddingError: true,
    };
  }

  // --- match_thoughts_v2 ---
  const { data, error } = await supabase.rpc('match_thoughts_v2', {
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
    return { data: null, error: error.message };
  }

  // --- Fire-and-forget retrieval tracking ---
  if (Array.isArray(data) && data.length > 0) {
    const ids = (data as Array<Record<string, unknown>>).map((r) => r.id);
    void (async () => {
      try {
        await supabase.rpc('increment_retrieval', { ids });
      } catch (trackErr: unknown) {
        console.error('[baseSemanticSearch] tracking failed:', trackErr);
      }
    })();
  }

  return { data: Array.isArray(data) ? data : [], error: null };
}
