import { SupabaseClient } from "@supabase/supabase-js";

export interface ListPeopleParams {
  limit?: number;
}

export async function listPeople(
  supabase: SupabaseClient,
  params: ListPeopleParams
): Promise<string> {
  const { limit = 50 } = params;

  const { data, error } = await supabase
    .from("thoughts")
    .select("people, created_at")
    .is("deleted_at", null)
    .not("people", "is", null);

  if (error) {
    return JSON.stringify({ error: error.message });
  }

  const map = new Map<string, { count: number; last_mentioned_at: string }>();
  for (const row of data ?? []) {
    for (const person of row.people ?? []) {
      const existing = map.get(person);
      if (existing) {
        existing.count++;
        if (row.created_at > existing.last_mentioned_at) {
          existing.last_mentioned_at = row.created_at;
        }
      } else {
        map.set(person, { count: 1, last_mentioned_at: row.created_at });
      }
    }
  }

  const results = [...map.entries()]
    .map(([person, stats]) => ({ person, ...stats }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);

  return JSON.stringify(results);
}
