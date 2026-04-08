import { SupabaseClient } from "@supabase/supabase-js";

export interface ListTopicsParams {
  limit?: number;
}

export async function listTopics(
  supabase: SupabaseClient,
  params: ListTopicsParams
): Promise<string> {
  const { limit = 50 } = params;

  const { data, error } = await supabase
    .from("thoughts")
    .select("topics, created_at")
    .is("deleted_at", null)
    .not("topics", "is", null);

  if (error) {
    return JSON.stringify({ error: error.message });
  }

  const map = new Map<string, { count: number; last_mentioned_at: string }>();
  for (const row of data ?? []) {
    for (const topic of row.topics ?? []) {
      const existing = map.get(topic);
      if (existing) {
        existing.count++;
        if (row.created_at > existing.last_mentioned_at) {
          existing.last_mentioned_at = row.created_at;
        }
      } else {
        map.set(topic, { count: 1, last_mentioned_at: row.created_at });
      }
    }
  }

  const results = [...map.entries()]
    .map(([topic, stats]) => ({ topic, ...stats }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);

  return JSON.stringify(results);
}

import { z } from "zod";
import type { ToolDefinition } from "./registry.js";

export const definition: ToolDefinition = {
  name: "thoughts_topics",
  description: "List all unique topics mentioned across thoughts, with mention count and last mentioned date.",
  schema: {
    limit: z.number().optional().default(50).describe("Max topics to return"),
  },
  handler: (deps, params) => listTopics(deps.supabase, params as ListTopicsParams),
};
