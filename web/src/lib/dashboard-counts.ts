import { createClient } from "@/lib/supabase-server";

export interface DashboardCounts {
  totalThoughts: number;
  wikiPages: number;
  openContradictions: number;
}

/**
 * Fetch the three navigation counts shown in the Sidebar.
 * Single round-trip via Promise.all; uses HEAD count={count: 'exact'}
 * so we never pull row data, just the totals.
 */
export async function fetchDashboardCounts(): Promise<DashboardCounts> {
  const supabase = await createClient();

  const [thoughtsRes, wikiRes, contradictionsRes] = await Promise.all([
    supabase
      .from("thoughts")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null),
    supabase
      .from("current_wiki_pages")
      .select("id", { count: "exact", head: true }),
    supabase
      .from("contradictions")
      .select("id", { count: "exact", head: true })
      .eq("status", "open"),
  ]);

  return {
    totalThoughts: thoughtsRes.count ?? 0,
    wikiPages: wikiRes.count ?? 0,
    openContradictions: contradictionsRes.count ?? 0,
  };
}
