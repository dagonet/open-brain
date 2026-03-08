import { SupabaseClient } from "@supabase/supabase-js";

export interface WeeklyReviewParams {
  days?: number;
}

export async function weeklyReview(
  supabase: SupabaseClient,
  params: WeeklyReviewParams
): Promise<string> {
  const { days = 7 } = params;
  const since = new Date();
  since.setDate(since.getDate() - days);

  const { data, error } = await supabase
    .from("thoughts")
    .select(
      "id, raw_text, thought_type, source, people, topics, action_items, action_items_resolved, created_at"
    )
    .is("deleted_at", null)
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false });

  if (error) {
    return JSON.stringify({ error: error.message });
  }

  const rows = data ?? [];
  const by_type: Record<string, number> = {};
  const by_source: Record<string, number> = {};
  const peopleSet = new Set<string>();
  const topicsSet = new Set<string>();
  const open_action_items: { thought_id: string; items: string[] }[] = [];
  const thoughts_by_type: Record<
    string,
    { id: string; text: string; created_at: string }[]
  > = {};

  for (const row of rows) {
    const type = row.thought_type ?? "unknown";
    by_type[type] = (by_type[type] ?? 0) + 1;

    const src = row.source ?? "unknown";
    by_source[src] = (by_source[src] ?? 0) + 1;

    for (const p of row.people ?? []) peopleSet.add(p);
    for (const t of row.topics ?? []) topicsSet.add(t);

    if (row.action_items?.length && !row.action_items_resolved) {
      open_action_items.push({
        thought_id: row.id,
        items: row.action_items,
      });
    }

    if (!thoughts_by_type[type]) thoughts_by_type[type] = [];
    thoughts_by_type[type].push({
      id: row.id,
      text: (row.raw_text ?? "").slice(0, 150),
      created_at: row.created_at,
    });
  }

  return JSON.stringify({
    period_days: days,
    total_thoughts: rows.length,
    by_type,
    by_source,
    people_mentioned: [...peopleSet].sort(),
    topics_mentioned: [...topicsSet].sort(),
    open_action_items,
    thoughts_by_type,
  });
}
