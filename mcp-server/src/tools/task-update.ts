import { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { ToolDefinition } from "./registry.js";

export interface TaskUpdateParams {
  id: string;
  title?: string;
  description?: string;
  priority?: number;
  linked_thought_ids?: string[];
  metadata?: Record<string, unknown>;
  status?: string;
  /** Optional note appended to status_history when status changes. */
  note?: string;
}

export async function taskUpdate(
  supabase: SupabaseClient,
  params: TaskUpdateParams,
): Promise<string> {
  const { id, title, description, priority, linked_thought_ids, metadata, status, note } = params;

  // Read the current task (must exist and not be deleted).
  const { data: current, error: readError } = await supabase
    .from("tasks")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (readError) {
    return JSON.stringify({ error: readError.message });
  }

  if (!current) {
    return JSON.stringify({ error: "not found" });
  }

  // Build the update payload with only the fields that changed.
  const updates: Record<string, unknown> = {};

  if (title !== undefined) updates.title = title;
  if (description !== undefined) updates.description = description;
  if (priority !== undefined) updates.priority = priority;
  if (linked_thought_ids !== undefined) updates.linked_thought_ids = linked_thought_ids;
  if (metadata !== undefined) updates.metadata = metadata;

  // If status is changing, append to status_history.
  if (status !== undefined && status !== current.status) {
    const history = Array.isArray(current.status_history) ? [...current.status_history] : [];
    history.push({
      status,
      at: new Date().toISOString(),
      note: note ?? null,
    });
    updates.status = status;
    updates.status_history = history;
  }

  // If status is 'cancelled', soft-delete.
  if (status === "cancelled" || (title === undefined && description === undefined && priority === undefined && linked_thought_ids === undefined && metadata === undefined && status === "cancelled")) {
    updates.deleted_at = new Date().toISOString();
  }

  const { data, error: writeError } = await supabase
    .from("tasks")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (writeError) {
    return JSON.stringify({ error: writeError.message });
  }

  return JSON.stringify(data);
}

export const definition: ToolDefinition = {
  name: "task_update",
  description:
    "Update a task by ID. Supports changing title, description, priority, linked_thought_ids, metadata, and status. When status changes, appends an entry to status_history. Setting status to 'cancelled' also sets deleted_at (soft-delete).",
  schema: {
    id: z.string().uuid().describe("UUID of the task to update."),
    title: z.string().optional().describe("New title."),
    description: z.string().optional().describe("New description."),
    priority: z
      .number()
      .int()
      .min(1)
      .max(5)
      .optional()
      .describe("New priority 1-5."),
    linked_thought_ids: z
      .array(z.string().uuid())
      .optional()
      .describe("New linked thought IDs."),
    metadata: z
      .record(z.unknown())
      .optional()
      .describe("New metadata JSON object (replaces existing)."),
    status: z
      .string()
      .optional()
      .describe("New status: open, in_progress, blocked, done, cancelled."),
    note: z
      .string()
      .optional()
      .describe("Optional note appended to status_history when status changes."),
  },
  handler: (deps, params) =>
    taskUpdate(deps.supabase, params as unknown as TaskUpdateParams),
};
