import { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { ToolDefinition } from "./registry.js";

export interface TaskGetParams {
  id: string;
}

export async function taskGet(
  supabase: SupabaseClient,
  params: TaskGetParams,
): Promise<string> {
  const { id } = params;

  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    return JSON.stringify({ error: error.message });
  }

  if (!data) {
    return JSON.stringify({ error: "not found" });
  }

  return JSON.stringify(data);
}

export const definition: ToolDefinition = {
  name: "task_get",
  description:
    "Get a single task by ID. Returns the task row or {error:'not found'} if the task does not exist or has been deleted.",
  schema: {
    id: z.string().uuid().describe("UUID of the task to retrieve."),
  },
  handler: (deps, params) => taskGet(deps.supabase, params as unknown as TaskGetParams),
};
