// detect-contradictions edge function
//
// Inspired by Andrej Karpathy's LLM Wiki gist
//   https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
// via Nate B Jones
//   https://www.youtube.com/watch?v=dxq7WtWxi44
//
// Walks recently-captured thoughts, finds embedding-similar pairs that an LLM
// judges to actually contradict, and persists them to the `contradictions`
// table for later resolution. Run on demand from the CLI (`brain audit`) or
// the MCP `contradictions_audit` tool — there is no per-capture trigger.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import {
  chatCompletionsStructured,
  generateEmbedding,
} from "../_shared/openai.ts";

interface AuditRequest {
  thought_id?: string;
  since?: string; // ISO timestamp
  candidate_limit?: number;
  similarity_threshold?: number;
  confidence_floor?: number;
}

interface ThoughtRow {
  id: string;
  raw_text: string;
  topics: string[] | null;
  embedding_model: string;
  created_at: string;
}

interface NeighbourRow {
  id: string;
  raw_text: string;
  topics: string[] | null;
  similarity: number;
  created_at: string;
}

interface ContradictionJudgment {
  contradicts: boolean;
  severity: number;
  confidence: number;
  reason: string;
}

const JUDGMENT_SCHEMA = {
  type: "object",
  properties: {
    contradicts: { type: "boolean" },
    severity: { type: "integer", enum: [1, 2, 3, 4, 5] },
    confidence: { type: "number" },
    reason: { type: "string" },
  },
  required: ["contradicts", "severity", "confidence", "reason"],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = `You are a careful logic checker. You receive two short notes a user captured at different times and decide whether they actually contradict each other.

Two notes contradict only when their factual claims cannot both be true at the same time. Notes that update, refine, or supersede an earlier statement DO contradict the earlier one (e.g. "we picked Postgres" then later "we switched to SQLite"). Notes that elaborate, agree, or are merely related do NOT contradict.

Return a JSON object with:
- contradicts: boolean
- severity: integer 1..5 where 1 is trivial wording difference and 5 is mutually exclusive material decisions
- confidence: number 0..1, your confidence that this really is a contradiction
- reason: short sentence explaining why (or why not)

If the notes are paraphrases, near-duplicates, or simply updates that do not negate the earlier note, return contradicts=false.`;

function getDenylist(): string[] {
  const raw = Deno.env.get("WIKI_TOPIC_DENYLIST") ?? "";
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

function topicsIntersectDenylist(
  topics: string[] | null,
  denylist: string[],
): boolean {
  if (denylist.length === 0 || !topics) return false;
  const lowered = topics.map((t) => t.toLowerCase());
  return denylist.some((d) => lowered.includes(d));
}

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return jsonResponse(405, { success: false, error: "Method not allowed" });
  }

  let body: AuditRequest = {};
  try {
    if (req.headers.get("content-length") !== "0") {
      body = await req.json();
    }
  } catch {
    body = {};
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
  const denylist = getDenylist();
  const candidateLimit = Math.max(1, Math.min(body.candidate_limit ?? 50, 200));
  const simThreshold = body.similarity_threshold ?? 0.78;
  const confidenceFloor = body.confidence_floor ?? 0.6;
  const currentEmbeddingModel = "text-embedding-3-small";

  const stats = {
    candidates_scanned: 0,
    pairs_judged: 0,
    contradictions_inserted: 0,
    duplicates_skipped: 0,
    errors: 0,
  };

  // ---- 1. Fetch candidate thoughts -------------------------------------------------
  let candidatesQuery = supabase
    .from("thoughts")
    .select("id, raw_text, topics, embedding_model, created_at, embedding")
    .is("deleted_at", null)
    .eq("embedding_model", currentEmbeddingModel)
    .not("embedding", "is", null)
    .order("created_at", { ascending: false })
    .limit(candidateLimit);

  if (body.thought_id) {
    candidatesQuery = candidatesQuery.eq("id", body.thought_id);
  }
  if (body.since) {
    candidatesQuery = candidatesQuery.gte("created_at", body.since);
  }

  const { data: candidates, error: candidatesErr } = await candidatesQuery;
  if (candidatesErr) {
    console.error("candidates query failed:", candidatesErr);
    return jsonResponse(500, { success: false, error: candidatesErr.message });
  }

  const filteredCandidates = (candidates ?? []).filter(
    (c: ThoughtRow & { embedding: unknown }) =>
      !topicsIntersectDenylist(c.topics, denylist),
  );

  stats.candidates_scanned = filteredCandidates.length;

  // Track pairs already considered in this run to avoid double-judging both directions.
  const seenPairs = new Set<string>();

  for (const candidate of filteredCandidates) {
    let embedding: number[];
    if (Array.isArray(candidate.embedding)) {
      embedding = candidate.embedding as number[];
    } else if (typeof candidate.embedding === "string") {
      try {
        embedding = JSON.parse(candidate.embedding);
      } catch {
        // Re-embed as a fallback (rare; pgvector text format)
        try {
          embedding = await generateEmbedding(candidate.raw_text);
        } catch (err) {
          console.error("embedding regen failed:", err);
          stats.errors += 1;
          continue;
        }
      }
    } else {
      stats.errors += 1;
      continue;
    }

    // ---- 2. Fetch nearest neighbours via match_thoughts -----------------------
    const { data: neighbours, error: matchErr } = await supabase.rpc(
      "match_thoughts",
      {
        query_embedding: JSON.stringify(embedding),
        match_count: 9, // 1 self + 8 neighbours
        filter_thought_type: null,
        filter_people: null,
        filter_topics: null,
        filter_days: null,
      },
    );
    if (matchErr) {
      console.error("match_thoughts failed:", matchErr);
      stats.errors += 1;
      continue;
    }

    const neighbourRows = (neighbours as NeighbourRow[] | null) ?? [];

    for (const neighbour of neighbourRows) {
      if (neighbour.id === candidate.id) continue;
      if (neighbour.similarity < simThreshold) continue;
      if (topicsIntersectDenylist(neighbour.topics, denylist)) continue;

      const [aId, bId] =
        candidate.id < neighbour.id
          ? [candidate.id, neighbour.id]
          : [neighbour.id, candidate.id];
      const pairKey = `${aId}|${bId}`;
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);

      stats.pairs_judged += 1;

      let judgment: ContradictionJudgment;
      try {
        judgment = await chatCompletionsStructured<ContradictionJudgment>(
          [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: `Note A:\n${candidate.raw_text}\n\nNote B:\n${neighbour.raw_text}`,
            },
          ],
          {
            schema_name: "contradiction_judgment",
            schema: JUDGMENT_SCHEMA as unknown as Record<string, unknown>,
            model: "gpt-4o-mini",
            temperature: 0,
          },
        );
      } catch (err) {
        console.error("LLM judge failed:", err);
        stats.errors += 1;
        continue;
      }

      if (!judgment.contradicts || judgment.confidence < confidenceFloor) {
        continue;
      }

      const idempotency_key = await sha256Hex(
        `${aId}|${bId}|${currentEmbeddingModel}`,
      );

      const { error: insertErr } = await supabase
        .from("contradictions")
        .insert({
          thought_a_id: aId,
          thought_b_id: bId,
          reason: judgment.reason.slice(0, 1000),
          severity: judgment.severity,
          confidence: judgment.confidence,
          status: "open",
          embedding_model: currentEmbeddingModel,
          idempotency_key,
        });

      if (insertErr) {
        // 23505 = unique_violation: already detected this pair (idempotency or pair_uniq)
        if (insertErr.code === "23505") {
          stats.duplicates_skipped += 1;
        } else {
          console.error("insert contradiction failed:", insertErr);
          stats.errors += 1;
        }
        continue;
      }

      stats.contradictions_inserted += 1;
    }
  }

  return jsonResponse(200, { success: true, ...stats });
});

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
