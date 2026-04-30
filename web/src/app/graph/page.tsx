import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import Sidebar from "@/components/Sidebar";
import { fetchDashboardCounts } from "@/lib/dashboard-counts";
import GraphView from "./graph-view";

interface ThoughtNode {
  id: string;
  raw_text: string;
  thought_type: string;
  topics: string[];
  created_at: string;
}

interface ContradictionEdge {
  id: string;
  thought_a_id: string;
  thought_b_id: string;
  reason: string;
  severity: number;
  confidence: number;
  status: string;
  detected_at: string;
}

export default async function GraphPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const [{ data: contradictions }, { data: thoughts }] = await Promise.all([
    supabase
      .from("contradictions")
      .select("*")
      .order("detected_at", { ascending: false })
      .limit(500),
    supabase
      .from("thoughts")
      .select("id, raw_text, thought_type, topics, created_at")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1000),
  ]);

  const navCounts = await fetchDashboardCounts();
  const edgeList = (contradictions as ContradictionEdge[] | null) ?? [];
  const thoughtList = (thoughts as ThoughtNode[] | null) ?? [];

  const thoughtMap = new Map(thoughtList.map((t) => [t.id, t]));

  return (
    <div className="flex min-h-screen">
      <Sidebar
        totalThoughts={navCounts.totalThoughts}
        wikiPages={navCounts.wikiPages}
        openContradictions={navCounts.openContradictions}
      />
      <main className="flex-1 p-6 md:p-8 flex flex-col">
        <header className="mb-4">
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">
            Contradiction Graph
          </h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            Each node is a thought, colored by type. Edges are contradictions —
            thicker = higher severity. Drag nodes to explore.
          </p>
        </header>
        <GraphView
          thoughts={thoughtList}
          contradictions={edgeList}
          thoughtMap={thoughtMap}
        />
      </main>
    </div>
  );
}
