"use client";

import { useMemo, useState } from "react";
import GraphView from "./graph-view";
import EntityGraphView from "./entity-graph-view";

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

export default function GraphTabs({
  thoughts,
  contradictions,
  entities,
  entityEdges,
}: {
  thoughts: ThoughtNode[];
  contradictions: ContradictionEdge[];
  entities: EntityNodeRow[];
  entityEdges: EntityEdgeRow[];
}) {
  const [tab, setTab] = useState<"contradictions" | "entities">("contradictions");

  const thoughtMap = useMemo(
    () => new Map(thoughts.map((t) => [t.id, t])),
    [thoughts],
  );

  return (
    <>
      <header className="mb-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">
            Graph View
          </h1>
        </div>
        <div className="flex gap-2 mt-3">
          <button
            onClick={() => setTab("contradictions")}
            className={`${
              tab === "contradictions"
                ? "bg-[var(--text-primary)] text-[var(--bg-primary)]"
                : "bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }` + " px-4 py-1.5 rounded-lg text-sm font-medium transition-colors"}
          >
            Contradictions
          </button>
          <button
            onClick={() => setTab("entities")}
            className={`${
              tab === "entities"
                ? "bg-[var(--text-primary)] text-[var(--bg-primary)]"
                : "bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }` + " px-4 py-1.5 rounded-lg text-sm font-medium transition-colors"}
          >
            Entities
          </button>
        </div>
        {tab === "contradictions" && (
          <p className="text-sm text-[var(--text-secondary)] mt-2">
            Each node is a thought, colored by type. Edges are contradictions
            imposed on the timeline of thought events.
          </p>
        )}
        {tab === "entities" && (
          <p className="text-sm text-[var(--text-secondary)] mt-2">
            Each node is an entity, sized by mention count and colored by
            type. Edges show co-occurrence across thoughts.
          </p>
        )}
      </header>
      {tab === "contradictions" ? (
        <GraphView
          thoughts={thoughts}
          contradictions={contradictions}
          thoughtMap={thoughtMap}
        />
      ) : (
        <EntityGraphView entities={entities} edges={entityEdges} />
      )}
    </>
  );
}
