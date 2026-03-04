import { SupabaseClient } from "@supabase/supabase-js";
export interface ListRecentParams {
  days?: number;
  limit?: number;
}
export async function listRecent(
  supabase: SupabaseClient,
  params: ListRecentParams
): Promise<string> {
  const { days = 7, limit = 20 } = params;
  const since = new Date();
  since.setDate(since.getDate() - days);
  const { data, error } = await supabase
    .from("thoughts")
    .select("*")
    .is("deleted_at", null)
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    return JSON.stringify({ error: error.message });
  }
  return JSON.stringify(data);
}