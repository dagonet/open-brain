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