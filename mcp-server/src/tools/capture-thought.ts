import { createHash } from "node:crypto";
import { resolveProject } from "../config.js";

export interface CaptureThoughtParams {
  text: string;
  metadata?: Record<string, unknown>;
  /** If omitted, falls back to OPEN_BRAIN_DEFAULT_PROJECT env var. */
  project?: string;
}

export async function captureThought(
  params: CaptureThoughtParams
): Promise<string> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return JSON.stringify({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" });
  }

  const effectiveProject = resolveProject(params.project);

  const url = `${supabaseUrl}/functions/v1/capture-thought`;
  const idempotency_key = createHash("sha256")
    .update("mcp:" + params.text.trim().toLowerCase())
    .digest("hex");

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: params.text,
        source: "mcp",
        idempotency_key,
        metadata: params.metadata,
        ...(effectiveProject ? { project: effectiveProject } : {}),
      }),
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      return JSON.stringify({ error: data.error || `HTTP ${response.status}` });
    }

    const result: Record<string, unknown> = {
      success: true,
      is_duplicate: data.is_duplicate,
      thought_id: data.thought?.id,
      thought_type: data.thought?.thought_type,
      people: data.thought?.people,
      topics: data.thought?.topics,
    };

    // If the edge function returned a near-duplicate candidate, append guidance.
    if (data.duplicate_candidate) {
      const dc = data.duplicate_candidate;
      result.duplicate_candidate = dc;
      result.note =
        `Near-duplicate detected: ${dc.thought_id} (similarity ${dc.similarity}). Preview: "${dc.raw_text_preview}". Use thoughts_supersede if this replaces it.`;
    }

    return JSON.stringify(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return JSON.stringify({ error: "Failed to capture thought", message });
  }
}

import { z } from "zod";
import type { ToolDefinition } from "./registry.js";

export const definition: ToolDefinition = {
  name: "thoughts_capture",
  description: "Capture a thought, decision, insight, or note into Open Brain memory. The system automatically classifies it, extracts people/topics, and generates embeddings.",
  schema: {
    text: z.string().describe("The thought to capture. Can be a decision, insight, meeting note, action item, or general note."),
    metadata: z.record(z.unknown()).optional().describe("Optional metadata (e.g., { session_context: 'sprint planning' })"),
    project: z
      .string()
      .optional()
      .describe("Project to associate this thought with. Falls back to OPEN_BRAIN_DEFAULT_PROJECT env var if set."),
  },
  handler: (_deps, params) => captureThought(params as unknown as CaptureThoughtParams),
};
