import { z } from "zod";
import type { ToolDefinition } from "./registry.js";

export interface ContradictionsAuditParams {
  thought_id?: string;
  since?: string;
  candidate_limit?: number;
}

export async function contradictionsAudit(
  params: ContradictionsAuditParams,
): Promise<string> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return JSON.stringify({
      error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  const url = `${supabaseUrl}/functions/v1/detect-contradictions`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        thought_id: params.thought_id,
        since: params.since,
        candidate_limit: params.candidate_limit,
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
    return JSON.stringify({ error: "Failed to run audit", message });
  }
}

export const definition: ToolDefinition = {
  name: "contradictions_audit",
  description:
    "Trigger an on-demand audit pass for contradictions. Walks recent thoughts, finds embedding-similar pairs, and asks an LLM judge whether each pair actually contradicts. New rows go into the contradictions table; duplicates are silently skipped via idempotency keys.",
  schema: {
    thought_id: z
      .string()
      .optional()
      .describe(
        "Restrict the audit to this single thought (and its embedding neighbours).",
      ),
    since: z
      .string()
      .optional()
      .describe(
        "ISO timestamp. Only consider thoughts created at or after this time as candidates.",
      ),
    candidate_limit: z
      .number()
      .optional()
      .default(50)
      .describe("Max number of candidate thoughts to scan (1..200, default 50)"),
  },
  handler: (_deps, params) =>
    contradictionsAudit(params as unknown as ContradictionsAuditParams),
};
