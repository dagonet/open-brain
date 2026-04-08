import { SupabaseClient } from "@supabase/supabase-js";
export interface DeleteThoughtParams {
  id: string;
}
export async function deleteThought(
  supabase: SupabaseClient,
  params: DeleteThoughtParams
): Promise<string> {
  const { id } = params;
  const { data, error } = await supabase
    .from("thoughts")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null)
    .select("id");
  if (error) {
    return JSON.stringify({ error: error.message });
  }
  if (!data || data.length === 0) {
    return JSON.stringify({
      message: "Thought not found or already deleted.",
      id,
    });
  }
  return JSON.stringify({
    message: "Thought soft-deleted successfully.",
    id: data[0].id,
  });
}

import { z } from "zod";
import type { ToolDefinition } from "./registry.js";

export const definition: ToolDefinition = {
  name: "thoughts_delete",
  description: "Soft-delete a thought by ID. Sets deleted_at timestamp; does not permanently remove data.",
  schema: {
    id: z.string().uuid().describe("UUID of the thought to delete"),
  },
  handler: (deps, params) => deleteThought(deps.supabase, params as unknown as DeleteThoughtParams),
};