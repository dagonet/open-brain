import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolDefinition } from "./registry.js";

export interface WikiListParams {
  limit?: number;
  since?: string;
}

interface WikiPageRow {
  slug: string;
  version: number;
  source_thought_count: number;
  partial: boolean;
  compiled_at: string;
}

export async function wikiList(
  supabase: SupabaseClient,
  params: WikiListParams,
): Promise<string> {
  const limit = Math.max(1, Math.min(params.limit ?? 50, 200));

  let query = supabase
    .from("current_wiki_pages")
    .select("slug, version, source_thought_count, partial, compiled_at")
    .order("compiled_at", { ascending: false })
    .limit(limit);

  if (params.since) {
    query = query.gte("compiled_at", params.since);
  }

  const { data, error } = await query;
  if (error) {
    return JSON.stringify({ error: error.message });
  }

  return JSON.stringify({
    status: "ok",
    pages: (data as WikiPageRow[] | null) ?? [],
  });
}

export const definition: ToolDefinition = {
  name: "wiki_list",
  description:
    "List the latest compiled wiki pages, newest first. Use {limit:1} to cheaply check whether any wiki pages exist before considering wiki_get.",
  schema: {
    limit: z
      .number()
      .optional()
      .default(50)
      .describe("Max pages to return (1..200, default 50)"),
    since: z
      .string()
      .optional()
      .describe(
        "ISO timestamp. If set, only return pages compiled at or after this time.",
      ),
  },
  handler: (deps, params) =>
    wikiList(deps.supabase, params as unknown as WikiListParams),
};
