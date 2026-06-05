// compile-wiki edge function
//
// Inspired by Andrej Karpathy's LLM Wiki gist
//   https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
// via Nate B Jones
//   https://www.youtube.com/watch?v=dxq7WtWxi44
//
// Compiles a markdown wiki page for a given topic slug from the user's
// captured thoughts. Source notes are shown to the model as bracketed [n]
// indices; paragraphs cite by number and the server maps each index back to
// a thought UUID. Out-of-range indices are stripped (one retry first); a
// paragraph survives if it keeps >=1 valid citation, otherwise it is dropped
// and the page is persisted with `partial=true`. The response reports
// `citation_validity` (valid/attempted cites) as the fidelity signal. The
// compile model is configurable via the WIKI_COMPILE_MODEL env var.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { chatCompletionsStructured } from "../_shared/openai.ts";

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

// Raw LLM output: citations are 1-based indices into the batch's thought
// list (the [n] shown in the prompt). resolveAndSalvage maps these to UUIDs.
interface RawCompiledPage {
  paragraphs: Array<{ markdown: string; citations: number[] }>;
  summary: string;
}

// Post-resolution shape used by every downstream step (render, persistence):
// citations are thought UUID strings.
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
            // 1-based indices into the source-note list shown in the prompt.
            // No minimum/maximum: strict mode support is unreliable, so the
            // range is validated server-side in resolveAndSalvage.
            items: { type: "integer" },
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
- Every paragraph MUST cite its sources in the "citations" array using the bracketed [number] shown next to each note (integers only, e.g. [3, 12]). Cite ONLY numbers that appear in the notes; NEVER invent a number or cite one that is not listed.
- Put those numbers ONLY in the "citations" array. Do NOT write the [number] markers inline in the "markdown" prose — the reader never sees the numbering.
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

function getCompileModel(): string {
  const m = Deno.env.get("WIKI_COMPILE_MODEL")?.trim();
  return m && m.length > 0 ? m : "gpt-4o-mini";
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
  paraTarget: string,
): string {
  const lines: string[] = [];
  lines.push(`Topic slug: ${slug}`);
  lines.push("");
  lines.push(`Write ${paraTarget} paragraphs.`);
  lines.push("");
  lines.push(
    "Source notes ([n] — created_at — text). Cite paragraphs by the [n] number:",
  );
  thoughts.forEach((t, i) => {
    const date = t.created_at.slice(0, 10);
    lines.push(
      `- [${i + 1}] — ${date} — ${t.raw_text.replace(/\s+/g, " ").trim()}`,
    );
  });
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

interface BatchResult {
  paragraphs: CompiledPage["paragraphs"];
  summary: string;
  attempted: number; // total citation indices the model emitted
  valid: number; // indices that resolved to a real source
  partial: boolean; // an index was stripped or a paragraph dropped
}

// Map an index-cited raw page onto UUID citations, salvaging as much as
// possible: out-of-range indices are stripped, a paragraph survives if it
// keeps >=1 valid citation. `attempted`/`valid` feed the citation-validity
// metric (the fidelity signal). Duplicate indices within a paragraph collapse
// to one UUID but still count toward `attempted`/`valid` equally.
function resolveAndSalvage(
  raw: RawCompiledPage,
  thoughts: ThoughtRow[],
): { page: CompiledPage; attempted: number; valid: number; dropped: number } {
  let attempted = 0;
  let valid = 0;
  let dropped = 0;
  const paragraphs: CompiledPage["paragraphs"] = [];

  for (const p of raw.paragraphs) {
    const seen = new Set<string>();
    const uuids: string[] = [];
    for (const c of p.citations ?? []) {
      attempted++;
      const idx = Number(c);
      if (Number.isInteger(idx) && idx >= 1 && idx <= thoughts.length) {
        valid++;
        const id = thoughts[idx - 1].id;
        if (!seen.has(id)) {
          seen.add(id);
          uuids.push(id);
        }
      }
    }
    if (uuids.length > 0) {
      paragraphs.push({ markdown: p.markdown, citations: uuids });
    } else {
      dropped++;
    }
  }

  return { page: { paragraphs, summary: raw.summary }, attempted, valid, dropped };
}

// Compile one batch of thoughts into UUID-cited paragraphs. Indices are
// batch-local ([1..thoughts.length]); the model never sees a UUID. Retries
// once at temperature 0 if any index was out of range, then salvages.
// Reusable for both the single-shot path and (Phase 3) per-chunk compiles.
async function compileBatch(
  slug: string,
  thoughts: ThoughtRow[],
  feedback: string[],
  paraTarget: string,
  model: string,
): Promise<BatchResult> {
  const userPrompt = buildUserPrompt(slug, thoughts, feedback, paraTarget);

  let raw = await chatCompletionsStructured<RawCompiledPage>(
    [
      { role: "system", content: COMPILE_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    {
      schema_name: "wiki_page",
      schema: PARAGRAPH_SCHEMA as unknown as Record<string, unknown>,
      model,
      temperature: 0.2,
    },
  );
  let result = resolveAndSalvage(raw, thoughts);

  // One retry only if the model cited an index with no matching note.
  if (result.valid < result.attempted) {
    const retryPrompt =
      userPrompt +
      `\n\nThe previous attempt cited numbers with no matching note. Cite ONLY the [n] numbers shown above (1 to ${thoughts.length}); if you cannot ground a paragraph in the notes, drop it.`;
    try {
      raw = await chatCompletionsStructured<RawCompiledPage>(
        [
          { role: "system", content: COMPILE_SYSTEM_PROMPT },
          { role: "user", content: retryPrompt },
        ],
        {
          schema_name: "wiki_page",
          schema: PARAGRAPH_SCHEMA as unknown as Record<string, unknown>,
          model,
          temperature: 0,
        },
      );
      result = resolveAndSalvage(raw, thoughts);
    } catch (err) {
      console.error("retry compile attempt failed:", err);
      // Keep the first-attempt salvage; partial below still reflects it.
    }
  }

  return {
    paragraphs: result.page.paragraphs,
    summary: result.page.summary,
    attempted: result.attempted,
    valid: result.valid,
    partial: result.dropped > 0 || result.valid < result.attempted,
  };
}

// The model often echoes the [n] citation indices inline in the prose. Those
// numbers are meaningless to a reader (canonical sources render in the
// per-paragraph "*Sources:*" footer), so strip bracketed integer runs like
// "[5]" or "[5, 12, 33]" and tidy the surrounding whitespace/punctuation.
function stripInlineCiteMarkers(md: string): string {
  return md
    .replace(/\s*\[\d+(?:\s*,\s*\d+)*\]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,;:])/g, "$1");
}

function renderMarkdown(page: CompiledPage): string {
  const blocks: string[] = [];
  for (const p of page.paragraphs) {
    blocks.push(stripInlineCiteMarkers(p.markdown).trim());
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

  // ---- 4. Compile via structured-output LLM (index-alias citations) -----------
  const model = getCompileModel();

  let compiled: BatchResult;
  try {
    compiled = await compileBatch(slug, cleaned, feedbackForSlug, "3 to 8", model);
  } catch (err) {
    console.error("compile attempt failed:", err);
    return jsonResponse(500, {
      success: false,
      error: "compile_failed",
      message: err instanceof Error ? err.message : String(err),
    });
  }

  const page: CompiledPage = {
    paragraphs: compiled.paragraphs,
    summary: compiled.summary,
  };
  const partial = compiled.partial;

  if (page.paragraphs.length === 0) {
    return jsonResponse(200, {
      success: true,
      status: "refused",
      reason: "all_paragraphs_invalid",
      slug,
    });
  }

  // Citation validity (valid/attempted) is the fidelity signal — distinct
  // from cluster-coverage, which is a synthesis property, not a defect.
  const citationValidity =
    compiled.attempted > 0 ? compiled.valid / compiled.attempted : 1;
  if (citationValidity < 0.9) {
    console.warn(
      `compile-wiki low citation validity for "${slug}": ${compiled.valid}/${compiled.attempted} (${citationValidity.toFixed(2)}) model=${model}`,
    );
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
  const clusterSourceIds = cleaned.map((t) => t.id);
  const idempotencyKey = await sha256Hex(
    `${slug}|${nextVersion}|${[...clusterSourceIds].sort().join(",")}|${currentEmbeddingModel}`,
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
    citation_validity: Number(citationValidity.toFixed(3)),
    cited: usedSourceIds.size,
    cluster_size: cleaned.length,
    model,
    compiled_at: inserted!.compiled_at,
  });
});

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
