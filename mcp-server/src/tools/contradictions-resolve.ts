import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolDefinition } from "./registry.js";
import { captureThought } from "./capture-thought.js";

export interface ContradictionsResolveParams {
  id: string;
  decision: "resolved" | "ignored" | "false_positive";
  note?: string;
}

export async function contradictionsResolve(
  supabase: SupabaseClient,
  params: ContradictionsResolveParams,
): Promise<string> {
  const { data: existing, error: fetchErr } = await supabase
    .from("contradictions")
    .select("id, thought_a_id, thought_b_id, status")
    .eq("id", params.id)
    .maybeSingle();

  if (fetchErr) {
    return JSON.stringify({ error: fetchErr.message });
  }
  if (!existing) {
    return JSON.stringify({ error: "Contradiction not found", id: params.id });
  }
  if (existing.status !== "open") {
    return JSON.stringify({
      status: "already_resolved",
      id: params.id,
      previous_status: existing.status,
    });
  }

  const { error: updateErr } = await supabase
    .from("contradictions")
    .update({
      status: params.decision,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", params.id);

  if (updateErr) {
    return JSON.stringify({ error: updateErr.message });
  }

  // Capture an audit thought so the resolution itself becomes searchable.
  const auditText = [
    `Resolved contradiction ${params.id} as ${params.decision}.`,
    `Thought A: ${existing.thought_a_id}`,
    `Thought B: ${existing.thought_b_id}`,
    params.note ? `Note: ${params.note}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  await captureThought({
    text: auditText,
    metadata: {
      kind: "contradiction-resolution",
      contradiction_id: params.id,
      decision: params.decision,
    },
  });

  return JSON.stringify({
    status: "resolved",
    id: params.id,
    decision: params.decision,
  });
}

export const definition: ToolDefinition = {
  name: "contradictions_resolve",
  description:
    "Resolve a previously detected contradiction. The chosen decision flows into future wiki compilations: 'resolved' or 'ignored' contradictions no longer exclude their thoughts from wiki compilation; 'false_positive' marks the audit as wrong.",
  schema: {
    id: z.string().describe("Contradiction UUID from contradictions_list"),
    decision: z
      .enum(["resolved", "ignored", "false_positive"])
      .describe("How to dispose of this contradiction"),
    note: z
      .string()
      .optional()
      .describe("Optional explanation captured into the audit thought"),
  },
  handler: (deps, params) =>
    contradictionsResolve(
      deps.supabase,
      params as unknown as ContradictionsResolveParams,
    ),
};
