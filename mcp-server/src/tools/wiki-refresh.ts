import { z } from "zod";
import type { ToolDefinition } from "./registry.js";

export interface WikiRefreshParams {
  slug: string;
  dry_run?: boolean;
}

export async function wikiRefresh(params: WikiRefreshParams): Promise<string> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return JSON.stringify({
      error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  const url = `${supabaseUrl}/functions/v1/compile-wiki`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        slug: params.slug.toLowerCase(),
        dry_run: params.dry_run ?? false,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      return JSON.stringify({
        error: data.error || `HTTP ${response.status}`,
      });
    }
    return JSON.stringify(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return JSON.stringify({ error: "Failed to refresh wiki page", message });
  }
}

export const definition: ToolDefinition = {
  name: "wiki_refresh",
  description:
    "Recompile the wiki page for a topic slug from current thoughts. Acquires a per-slug version, validates citations against the input set, and persists either a fresh page or partial=true if some paragraphs hallucinated IDs. Returns 'refused' with a reason if the cluster has fewer than 3 thoughts.",
  schema: {
    slug: z.string().describe("Topic slug to recompile (e.g. 'open-brain')"),
    dry_run: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "If true, return cluster stats but do not call the LLM or write a new page.",
      ),
  },
  handler: (_deps, params) =>
    wikiRefresh(params as unknown as WikiRefreshParams),
};
