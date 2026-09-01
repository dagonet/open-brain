import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase-server';
import Sidebar from '@/components/Sidebar';
import { fetchDashboardCounts } from '@/lib/dashboard-counts';
import GraphTabs from './graph-tabs';

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

interface EntityNodeRow {
  entity_key: string;
  display_name: string;
  entity_type: string;
  mention_count: number;
  thought_count: number;
  thought_ids: string[];
  last_mentioned_at: string;
}

interface EntityEdgeRow {
  source_key: string;
  target_key: string;
  weight: number;
  shared_thought_ids: string[];
}

export default async function GraphPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/login');
  }

  const [{ data: contradictions }, { data: thoughts }, { data: entityNodes }] = await Promise.all([
    supabase
      .from('contradictions')
      .select('*')
      .order('detected_at', { ascending: false })
      .limit(500),
    supabase
      .from('thoughts')
      .select('id, raw_text, thought_type, topics, created_at')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1000),
    supabase
      .from('entity_nodes')
      .select('*')
      .order('thought_count', { ascending: false })
      .limit(60),
  ]);

  // Entity edges constrained to the top-60 entity keys
  const keys = (entityNodes ?? []).map((e: Record<string, unknown>) => e.entity_key as string);
  let entityEdgesData: EntityEdgeRow[] | null = [];
  if (keys.length > 0) {
    const { data } = await supabase
      .from('entity_edges')
      .select('*')
      .in('source_key', keys)
      .in('target_key', keys)
      .order('weight', { ascending: false })
      .limit(150);
    entityEdgesData = data as EntityEdgeRow[] | null;
  }

  const navCounts = await fetchDashboardCounts();
  const edgeList = (contradictions as ContradictionEdge[] | null) ?? [];
  const thoughtList = (thoughts as ThoughtNode[] | null) ?? [];
  const entityNodeList = (entityNodes as EntityNodeRow[] | null) ?? [];
  const entityEdgeList = entityEdgesData ?? [];

  return (
    <div className="flex min-h-screen">
      <Sidebar
        totalThoughts={navCounts.totalThoughts}
        wikiPages={navCounts.wikiPages}
        openContradictions={navCounts.openContradictions}
      />
      <main className="flex-1 p-6 md:p-8 flex flex-col">
        <GraphTabs
          thoughts={thoughtList}
          contradictions={edgeList}
          entities={entityNodeList}
          entityEdges={entityEdgeList}
        />
      </main>
    </div>
  );
}
