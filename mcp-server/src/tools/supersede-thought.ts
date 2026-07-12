import { SupabaseClient } from "@supabase/supabase-js";

export interface SupersedeParams {
  new_thought_id: string;
  old_thought_id: string;
}

export async function supersedeThought(
  supabase: SupabaseClient,
  params: SupersedeParams,
): Promise<string> {
  const { new_thought_id, old_thought_id } = params;

  // Validate: IDs must be different.
  if (new_thought_id === old_thought_id) {
    return JSON.stringify({
      error: "new_thought_id and old_thought_id must be different.",
    });
  }

  // Validate: both thoughts exist.
  const { data: thoughts, error: lookupError } = await supabase
    .from("thoughts")
    .select("id, deleted_at, lifecycle_status")
    .in("id", [new_thought_id, old_thought_id]);

  if (lookupError) {
    return JSON.stringify({ error: lookupError.message });
  }

  if (!thoughts || thoughts.length < 2) {
    const found = new Set(
      (thoughts ?? []).map((t: Record<string, unknown>) => t.id),
    );
    const missing: string[] = [];
    if (!found.has(new_thought_id)) missing.push(new_thought_id);
    if (!found.has(old_thought_id)) missing.push(old_thought_id);
    return JSON.stringify({
      error: `Thought(s) not found: ${missing.join(", ")}`,
    });
  }

  // Deleted check.
  for (const t of thoughts as Array<Record<string, unknown>>) {
    if (t.deleted_at !== null) {
      return JSON.stringify({
        error: `Thought ${t.id} has been deleted.`,
      });
    }
  }

  // Lifecycle check: old thought must not be already superseded or archived.
  const oldThought = (thoughts as Array<Record<string, unknown>>).find(
    (t) => t.id === old_thought_id,
  );
  if (oldThought?.lifecycle_status === "superseded") {
    return JSON.stringify({
      error: `Thought ${old_thought_id} is already superseded.`,
    });
  }
  if (oldThought?.lifecycle_status === "archived") {
    return JSON.stringify({
      error: `Thought ${old_thought_id} has been archived and cannot be superseded.`,
    });
  }

  // Set supersedes_id on the new thought to point at the old thought.
  const { error: updateError } = await supabase
    .from("thoughts")
    .update({ supersedes_id: old_thought_id })
    .eq("id", new_thought_id);

  if (updateError) {
    return JSON.stringify({ error: updateError.message });
  }

  // Set lifecycle_status on the old thought to 'superseded'.
  const { error: oldUpdateError } = await supabase
    .from("thoughts")
    .update({ lifecycle_status: "superseded" })
    .eq("id", old_thought_id);

  if (oldUpdateError) {
    return JSON.stringify({ error: oldUpdateError.message });
  }

  return JSON.stringify({
    success: true,
    message: `Thought ${new_thought_id} now supersedes ${old_thought_id}. The old thought is excluded from default search results.`,
  });
}

import { z } from "zod";
import type { ToolDefinition } from "./registry.js";

export const definition: ToolDefinition = {
  name: "thoughts_supersede",
  description:
    "Mark new_thought_id as superseding old_thought_id — the old thought is excluded from default search results. Use this when a capture returned a duplicate_candidate and the new thought replaces the old one.",
  schema: {
    new_thought_id: z
      .string()
      .uuid()
      .describe("UUID of the new thought that replaces the old one."),
    old_thought_id: z
      .string()
      .uuid()
      .describe(
        "UUID of the thought being superseded. It will be excluded from default search results.",
      ),
  },
  handler: (deps, params) =>
    supersedeThought(deps.supabase, params as unknown as SupersedeParams),
};
