import { SupabaseClient } from "@supabase/supabase-js";
export async function systemStatus(supabase: SupabaseClient): Promise<string> {
  const [totalResult, statusResult, sourceResult, failuresResult] =
    await Promise.all([
      supabase
        .from("thoughts")
        .select("id", { count: "exact", head: true })
        .is("deleted_at", null),
      supabase
        .from("thoughts")
        .select("processing_status")
        .is("deleted_at", null),
      supabase
        .from("thoughts")
        .select("source")
        .is("deleted_at", null),
      supabase
        .from("thoughts")
        .select("id, raw_text, processing_status, source, created_at")
        .is("deleted_at", null)
        .neq("processing_status", "complete")
        .order("created_at", { ascending: false })
        .limit(5),
    ]);
  const byStatus: Record<string, number> = { complete: 0, partial: 0, failed: 0 };
  if (statusResult.data) {
    for (const row of statusResult.data) {
      const s = row.processing_status as string;
      byStatus[s] = (byStatus[s] ?? 0) + 1;
    }
  }
  const bySource: Record<string, number> = { slack: 0, cli: 0, mcp: 0 };
  if (sourceResult.data) {
    for (const row of sourceResult.data) {
      const s = row.source as string;
      bySource[s] = (bySource[s] ?? 0) + 1;
    }
  }
  return JSON.stringify({
    total_thoughts: totalResult.count ?? 0,
    by_status: byStatus,
    by_source: bySource,
    recent_failures: failuresResult.data ?? [],
    embedding_model: "text-embedding-3-small",
    embedding_dimensions: 1536,
  });
}

import { z } from "zod";
import type { ToolDefinition } from "./registry.js";

export const definition: ToolDefinition = {
  name: "system_status",
  description: "Get system status: total thoughts, counts by status and source, recent failures, and embedding config.",
  schema: {},
  handler: (deps) => systemStatus(deps.supabase),
};