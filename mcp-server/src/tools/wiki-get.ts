import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolDefinition } from "./registry.js";

export interface WikiGetParams {
  slug: string;
  include_sources?: "snippets" | "full" | "none";
}

const SOURCE_SNIPPET_LEN = 120;
const CONTENT_SOFT_CAP = 32 * 1024;

interface WikiPageRow {
  id: string;
  slug: string;
  version: number;
  content_md: string;
  partial: boolean;
  source_thought_count: number;
  oldest_source_at: string | null;
  newest_source_at: string | null;
  compiled_at: string;
}

interface StalenessRow {
  page_id: string;
  stale_since_n_thoughts: number;
  open_contradictions_count: number;
}

interface SourceJoinRow {
  thought_id: string;
}

interface ThoughtRow {
  id: string;
  raw_text: string;
  created_at: string;
  deleted_at: string | null;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "\n\n… [truncated, see /wiki/" + max + "]";
}

export async function wikiGet(
  supabase: SupabaseClient,
  params: WikiGetParams,
): Promise<string> {
  const slug = params.slug.toLowerCase();
  const includeSources = params.include_sources ?? "snippets";

  const { data: page, error: pageErr } = await supabase
    .from("current_wiki_pages")
    .select(
      "id, slug, version, content_md, partial, source_thought_count, oldest_source_at, newest_source_at, compiled_at",
    )
    .eq("slug", slug)
    .maybeSingle();

  if (pageErr) {
    return JSON.stringify({ error: pageErr.message });
  }
  if (!page) {
    return JSON.stringify({ status: "not_found", slug });
  }

  const wikiPage = page as WikiPageRow;

  const { data: staleness } = await supabase
    .from("wiki_page_staleness")
    .select("page_id, stale_since_n_thoughts, open_contradictions_count")
    .eq("page_id", wikiPage.id)
    .maybeSingle();
  const stale = (staleness as StalenessRow | null) ?? {
    page_id: wikiPage.id,
    stale_since_n_thoughts: 0,
    open_contradictions_count: 0,
  };

  let sources: Array<{
    thought_id: string;
    created_at: string;
    deleted: boolean;
    snippet?: string;
    raw_text?: string;
  }> = [];

  if (includeSources !== "none") {
    const { data: joins } = await supabase
      .from("wiki_sources")
      .select("thought_id")
      .eq("page_id", wikiPage.id);
    const thoughtIds = (joins as SourceJoinRow[] | null ?? []).map(
      (j) => j.thought_id,
    );
    if (thoughtIds.length > 0) {
      const { data: thoughts } = await supabase
        .from("thoughts")
        .select("id, raw_text, created_at, deleted_at")
        .in("id", thoughtIds);
      const rows = (thoughts as ThoughtRow[] | null) ?? [];
      sources = rows.map((t) => {
        const deleted = t.deleted_at !== null;
        if (includeSources === "full") {
          return {
            thought_id: t.id,
            created_at: t.created_at,
            deleted,
            raw_text: t.raw_text,
          };
        }
        return {
          thought_id: t.id,
          created_at: t.created_at,
          deleted,
          snippet:
            t.raw_text.length > SOURCE_SNIPPET_LEN
              ? t.raw_text.slice(0, SOURCE_SNIPPET_LEN) + "…"
              : t.raw_text,
        };
      });
    }
  }

  const content_md = truncate(wikiPage.content_md, CONTENT_SOFT_CAP);

  return JSON.stringify({
    status: "ok",
    slug: wikiPage.slug,
    version: wikiPage.version,
    content_md,
    partial: wikiPage.partial,
    source_thought_count: wikiPage.source_thought_count,
    oldest_source_at: wikiPage.oldest_source_at,
    newest_source_at: wikiPage.newest_source_at,
    compiled_at: wikiPage.compiled_at,
    stale_since_n_thoughts: stale.stale_since_n_thoughts,
    open_contradictions_count: stale.open_contradictions_count,
    sources,
  });
}

export const definition: ToolDefinition = {
  name: "wiki_get",
  description:
    "Get the latest compiled wiki page for a topic slug. Returns markdown plus staleness signals and source thought IDs. For synthesis questions, prefer this over thoughts_search when the page is fresh.",
  schema: {
    slug: z
      .string()
      .describe(
        "Topic slug, e.g. 'open-brain'. Lowercase, hyphenated; matches slugify(topic).",
      ),
    include_sources: z
      .enum(["snippets", "full", "none"])
      .optional()
      .default("snippets")
      .describe(
        "Source detail level. 'snippets' (default) returns 120-char previews; 'full' returns raw text; 'none' omits sources.",
      ),
  },
  handler: (deps, params) =>
    wikiGet(deps.supabase, params as unknown as WikiGetParams),
};
