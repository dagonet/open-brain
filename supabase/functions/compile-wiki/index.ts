// compile-wiki edge function
//
// Inspired by Andrej Karpathy's LLM Wiki gist
//   https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
// via Nate B Jones
//   https://www.youtube.com/watch?v=dxq7WtWxi44
//
// Compiles a markdown wiki page for a given topic slug from the user's
// captured thoughts. Every paragraph cites the thought IDs it draws from;
// citations are validated against the input set and the validator retries
// once if the model hallucinates an ID. On second failure offending
// paragraphs are dropped and the page is persisted with `partial=true`.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import {
  chatCompletionsStructured,
  UUID_PATTERN,
} from "../_shared/openai.ts";

interface CompileRequest {
  slug: string;
  dry_run?: boolean;
}

interface ThoughtRow {
  id: string;
  raw_text: string;
  topics: string[] | null;
  embedding_model: string;
  created_at: string;
}

interface CompiledPage {
  paragraphs: Array<{ markdown: string; citations: string[] }>;
  summary: string;
}

interface FeedbackRow {
  raw_text: string;
  metadata: Record<string, unknown> | null;
}

const PARAGRAPH_SCHEMA = {
  type: "object",
  properties: {
    paragraphs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          markdown: { type: "string" },
          citations: {
            type: "array",
            items: { type: "string", pattern: UUID_PATTERN },
          },
        },
        required: ["markdown", "citations"],
        additionalProperties: false,
      },
    },
    summary: { type: "string" },
  },
  required: ["paragraphs", "summary"],
  additionalProperties: false,
} as const;

const COMPILE_SYSTEM_PROMPT = `You are a careful wiki author. You compile a single markdown page from a set of short notes the user captured at different times. The page must be useful as the user's "what do I know about this topic?" reference.

Rules:
- Write 3 to 8 paragraphs of plain markdown.
- Every paragraph MUST cite the thought IDs it draws from in the "citations" array. Use the IDs exactly as given. NEVER invent IDs.
- Prefer recent notes when notes disagree; the input has already been filtered to remove pairs flagged as open contradictions, but conflicting wording can still appear.
- Do NOT add information that isn't in the source notes.
- Open with a short orientation paragraph; close with a one-sentence "summary" field.
- Markdown should use plain prose, occasional bullet lists, and short code spans for technical terms — no headers (# / ##), no horizontal rules.`;

function getDenylist(): string[] {
  const raw = Deno.env.get("WIKI_TOPIC_DENYLIST") ?? "";
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

function getDecayDays(): number {
  const raw = Number(Deno.env.get("WIKI_DECAY_DAYS") ?? "90");
  return Number.isFinite(raw) && raw > 0 ? raw : 90;
}

function recencyScore(createdAt: string, decayDays: number): number {
  const ageDays =
    (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24);
  return Math.exp(-Math.max(ageDays, 0) / decayDays);
}

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function topicsIntersectDenylist(
  topics: string[] | null,
  denylist: string[],
): boolean {
  if (denylist.length === 0 || !topics) return false;
  const lowered = topics.map((t) => t.toLowerCase());
  return denylist.some((d) => lowered.includes(d));
}

function buildUserPrompt(
  slug: string,
  thoughts: ThoughtRow[],
  feedback: string[],
): string {
  const lines: string[] = [];
  lines.push(`Topic slug: ${slug}`);
  lines.push("");
  lines.push("Source notes (id — created_at — text):");
  for (const t of thoughts) {
    const date = t.created_at.slice(0, 10);
    lines.push(`- ${t.id} — ${date} — ${t.raw_text.replace(/\s+/g, " ").trim()}`);
  }
  if (feedback.length > 0) {
    lines.push("");
    lines.push(
      "Prior user feedback on earlier compilations of this topic — take into account:",
    );
    for (const f of feedback) {
      lines.push(`- ${f}`);
    }
  }
  return lines.join("\n");
}

function validateCitations(
  page: CompiledPage,
  validIds: Set<string>,
): { ok: boolean; rejected: string[] } {
  const rejected: string[] = [];
  for (const p of page.paragraphs) {
    for (const c of p.citations) {
      if (!validIds.has(c)) rejected.push(c);
    }
  }
  return { ok: rejected.length === 0, rejected };
}

function dropInvalidParagraphs(
  page: CompiledPage,
  validIds: Set<string>,
): CompiledPage {
  return {
    paragraphs: page.paragraphs.filter((p) =>
      p.citations.length > 0 && p.citations.every((c) => validIds.has(c))
    ),
    summary: page.summary,
  };
}

function renderMarkdown(page: CompiledPage): string {
  const blocks: string[] = [];
  for (const p of page.paragraphs) {
    blocks.push(p.markdown.trim());
    if (p.citations.length > 0) {
      // Plain markdown italic, not raw HTML. The dashboard's `<article>`
      // does NOT pass through a markdown renderer in v0.3.0, so any HTML
      // tags here would render as literal text.
      const cites = p.citations.map((c) => `[[#${c}]]`).join(" ");
      blocks.push(`*Sources: ${cites}*`);
    }
  }
  if (page.summary && page.summary.trim().length > 0) {
    blocks.push("");
    blocks.push(`**Summary:** ${page.summary.trim()}`);
  }
  return blocks.join("\n\n");
}

serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return jsonResponse(405, { success: false, error: "Method not allowed" });
  }

  let body: CompileRequest;
  try {
    body = (await req.json()) as CompileRequest;
  } catch {
    return jsonResponse(400, {
      success: false,
      error: "JSON body required with { slug }",
    });
  }
  if (!body.slug || typeof body.slug !== "string") {
    return jsonResponse(400, { success: false, error: "slug is required" });
  }

  const slug = body.slug.toLowerCase();
  const dryRun = body.dry_run === true;
  const denylist = getDenylist();

  if (denylist.includes(slug)) {
    return jsonResponse(200, {
      success: true,
      status: "refused",
      reason: "denylisted",
      slug,
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse(500, {
      success: false,
      error: "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing",
    });
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  // ---- 1. Resolve cluster -----------------------------------------------------
  const currentEmbeddingModel = "text-embedding-3-small";
  const decayDays = getDecayDays();

  const { data: byTopic, error: byTopicErr } = await supabase.rpc(
    "thoughts_by_slug",
    { in_slug: slug, in_limit: 80 },
  );
  if (byTopicErr) {
    console.error("thoughts_by_slug failed:", byTopicErr);
    return jsonResponse(500, { success: false, error: byTopicErr.message });
  }

  const cluster = ((byTopic ?? []) as ThoughtRow[]).filter(
    (t) =>
      t.embedding_model === currentEmbeddingModel &&
      !topicsIntersectDenylist(t.topics, denylist),
  );

  if (cluster.length < 3) {
    return jsonResponse(200, {
      success: true,
      status: "refused",
      reason: "cluster_too_small",
      slug,
      cluster_size: cluster.length,
    });
  }

  // ---- 2. Exclude thoughts in any open contradiction --------------------------
  const clusterIds = cluster.map((t) => t.id);
  const { data: openContras, error: contrasErr } = await supabase
    .from("contradictions")
    .select("thought_a_id, thought_b_id")
    .eq("status", "open")
    .or(
      `thought_a_id.in.(${clusterIds.join(",")}),thought_b_id.in.(${clusterIds.join(",")})`,
    );
  if (contrasErr) {
    console.error("open contradictions query failed:", contrasErr);
  }

  const flagged = new Set<string>();
  for (const c of openContras ?? []) {
    if (clusterIds.includes(c.thought_a_id)) flagged.add(c.thought_a_id);
    if (clusterIds.includes(c.thought_b_id)) flagged.add(c.thought_b_id);
  }

  let cleaned = cluster.filter((t) => !flagged.has(t.id));
  if (cleaned.length < 3) {
    return jsonResponse(200, {
      success: true,
      status: "refused",
      reason: "cluster_too_small_after_contradictions",
      slug,
      cluster_size: cleaned.length,
    });
  }

  // Cap and rank by recency-decayed score (no neighbour cosines in v0.3.0,
  // so the score reduces to recency alone — keeps the most relevant 80).
  cleaned = [...cleaned]
    .map((t) => ({ t, score: recencyScore(t.created_at, decayDays) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 80)
    .map((x) => x.t);

  // ---- 3. Pull last 5 wiki-feedback notes for this slug -----------------------
  // Filter by metadata.kind, NOT by `topics`. The `topics` column is set
  // exclusively by the LLM classifier in process-thought.ts, which has no
  // guaranteed way to return the literal string "wiki-feedback". The
  // server action / CLI both set `metadata.kind = 'wiki-feedback'` reliably.
  const { data: feedback } = await supabase
    .from("thoughts")
    .select("raw_text, metadata")
    .is("deleted_at", null)
    .eq("metadata->>kind", "wiki-feedback")
    .order("created_at", { ascending: false })
    .limit(20);

  const feedbackForSlug: string[] = [];
  const seen = new Set<string>();
  for (const f of (feedback ?? []) as FeedbackRow[]) {
    const meta = f.metadata as { slug?: string } | null;
    if (meta?.slug && meta.slug !== slug) continue;
    const key = f.raw_text.slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    feedbackForSlug.push(f.raw_text);
    if (feedbackForSlug.length >= 5) break;
  }

  if (dryRun) {
    return jsonResponse(200, {
      success: true,
      status: "would_compile",
      slug,
      cluster_size: cleaned.length,
      feedback_count: feedbackForSlug.length,
      thought_ids: cleaned.map((t) => t.id),
    });
  }

  // ---- 4. Compile via structured-output LLM with citation validator -----------
  const validIds = new Set(cleaned.map((t) => t.id));
  const userPrompt = buildUserPrompt(slug, cleaned, feedbackForSlug);

  let page: CompiledPage;
  try {
    page = await chatCompletionsStructured<CompiledPage>(
      [
        { role: "system", content: COMPILE_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      {
        schema_name: "wiki_page",
        schema: PARAGRAPH_SCHEMA as unknown as Record<string, unknown>,
        model: "gpt-4o-mini",
        temperature: 0.2,
      },
    );
  } catch (err) {
    console.error("first compile attempt failed:", err);
    return jsonResponse(500, {
      success: false,
      error: "compile_failed_first_attempt",
      message: err instanceof Error ? err.message : String(err),
    });
  }

  let partial = false;
  let validation = validateCitations(page, validIds);
  if (!validation.ok) {
    // Retry once, surfacing rejected IDs.
    const retryPrompt =
      userPrompt +
      `\n\nThe previous attempt cited unknown IDs: ${validation.rejected.join(
        ", ",
      )}. Cite ONLY the IDs listed above; if you cannot ground a paragraph in the provided notes, drop it.`;
    try {
      page = await chatCompletionsStructured<CompiledPage>(
        [
          { role: "system", content: COMPILE_SYSTEM_PROMPT },
          { role: "user", content: retryPrompt },
        ],
        {
          schema_name: "wiki_page",
          schema: PARAGRAPH_SCHEMA as unknown as Record<string, unknown>,
          model: "gpt-4o-mini",
          temperature: 0,
        },
      );
      validation = validateCitations(page, validIds);
    } catch (err) {
      console.error("retry compile attempt failed:", err);
    }

    if (!validation.ok) {
      page = dropInvalidParagraphs(page, validIds);
      partial = true;
    }
  }

  if (page.paragraphs.length === 0) {
    return jsonResponse(200, {
      success: true,
      status: "refused",
      reason: "all_paragraphs_invalid",
      slug,
    });
  }

  const contentMd = renderMarkdown(page);

  // ---- 5. Persist with version increment + collision handling ----------------
  const oldestSourceAt = cleaned.reduce(
    (min, t) => (t.created_at < min ? t.created_at : min),
    cleaned[0].created_at,
  );
  const newestSourceAt = cleaned.reduce(
    (max, t) => (t.created_at > max ? t.created_at : max),
    cleaned[0].created_at,
  );

  const { data: latest } = await supabase
    .from("wiki_pages")
    .select("version")
    .eq("slug", slug)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextVersion = (latest?.version ?? 0) + 1;
  const idempotencyKey = await sha256Hex(
    `${slug}|${nextVersion}|${[...validIds].sort().join(",")}|${currentEmbeddingModel}`,
  );

  const usedSourceIds = new Set<string>();
  for (const p of page.paragraphs) {
    for (const c of p.citations) usedSourceIds.add(c);
  }

  const { data: inserted, error: insertErr } = await supabase
    .from("wiki_pages")
    .insert({
      slug,
      version: nextVersion,
      content_md: contentMd,
      embedding_model: currentEmbeddingModel,
      embedding_dimensions: 1536,
      source_thought_count: usedSourceIds.size,
      oldest_source_at: oldestSourceAt,
      newest_source_at: newestSourceAt,
      partial,
      idempotency_key: idempotencyKey,
    })
    .select("id, version, compiled_at")
    .single();

  if (insertErr) {
    if (insertErr.code === "23505") {
      // Concurrent writer won — return the current row.
      const { data: current } = await supabase
        .from("current_wiki_pages")
        .select("id, version, compiled_at")
        .eq("slug", slug)
        .maybeSingle();
      return jsonResponse(200, {
        success: true,
        status: "raced",
        slug,
        page_id: current?.id,
        version: current?.version,
        compiled_at: current?.compiled_at,
      });
    }
    console.error("wiki_pages insert failed:", insertErr);
    return jsonResponse(500, { success: false, error: insertErr.message });
  }

  // ---- 6. Persist source links ----------------------------------------------
  const pageId = inserted!.id;
  const sourceRows = [...usedSourceIds].map((thought_id) => ({
    page_id: pageId,
    thought_id,
  }));
  if (sourceRows.length > 0) {
    const { error: srcErr } = await supabase
      .from("wiki_sources")
      .insert(sourceRows);
    if (srcErr) {
      console.error("wiki_sources insert failed:", srcErr);
    }
  }

  return jsonResponse(200, {
    success: true,
    status: "compiled",
    slug,
    page_id: pageId,
    version: nextVersion,
    partial,
    source_thought_count: usedSourceIds.size,
    compiled_at: inserted!.compiled_at,
  });
});

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
