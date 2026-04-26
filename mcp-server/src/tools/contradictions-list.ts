import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolDefinition } from "./registry.js";

export interface ContradictionsListParams {
  status?: "open" | "resolved" | "ignored" | "false_positive";
  since?: string;
  limit?: number;
}

interface ContradictionRow {
  id: string;
  thought_a_id: string;
  thought_b_id: string;
  reason: string;
  severity: number;
  confidence: number;
  status: string;
  detected_at: string;
  resolved_at: string | null;
}

export async function contradictionsList(
  supabase: SupabaseClient,
  params: ContradictionsListParams,
): Promise<string> {
  const limit = Math.max(1, Math.min(params.limit ?? 50, 200));

  let query = supabase
    .from("contradictions")
    .select(
      "id, thought_a_id, thought_b_id, reason, severity, confidence, status, detected_at, resolved_at",
    )
    .order("detected_at", { ascending: false })
    .limit(limit);

  if (params.status) {
    query = query.eq("status", params.status);
  }
  if (params.since) {
    query = query.gte("detected_at", params.since);
  }

  const { data, error } = await query;
  if (error) {
    return JSON.stringify({ error: error.message });
  }

  return JSON.stringify({
    status: "ok",
    contradictions: (data as ContradictionRow[] | null) ?? [],
  });
}

export const definition: ToolDefinition = {
  name: "contradictions_list",
  description:
    "List contradictions detected between pairs of the user's captured thoughts. Defaults to all statuses; pass status:'open' to see what still needs resolution.",
  schema: {
    status: z
      .enum(["open", "resolved", "ignored", "false_positive"])
      .optional()
      .describe("Filter by status (default: all)"),
    since: z
      .string()
      .optional()
      .describe(
        "ISO timestamp. If set, only return contradictions detected at or after this time.",
      ),
    limit: z
      .number()
      .optional()
      .default(50)
      .describe("Max rows to return (1..200, default 50)"),
  },
  handler: (deps, params) =>
    contradictionsList(
      deps.supabase,
      params as unknown as ContradictionsListParams,
    ),
};
