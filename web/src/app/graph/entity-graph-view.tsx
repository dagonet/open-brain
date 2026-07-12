"use client";

import { useCallback, useState } from "react";
import {
  useSimulation,
  SimNodeBase,
  SimEdgeBase,
  DEFAULT_WIDTH,
  DEFAULT_HEIGHT,
  DEFAULT_RADIUS,
} from "./graph-common";

interface EntityNode {
  entity_key: string;
  display_name: string;
  entity_type: string;
  mention_count: number;
  thought_count: number;
  thought_ids: string[];
  last_mentioned_at: string;
}

interface EntityEdge {
  source_key: string;
  target_key: string;
  weight: number;
  shared_thought_ids: string[];
}

interface EntitySimNode extends SimNodeBase {
  entity: EntityNode;
  degree: number;
}

interface EntitySimEdge extends SimEdgeBase {
  edge_data: EntityEdge;
}

const ENTITY_COLORS: Record<string, string> = {
  function: "#3b82f6",
  variable: "#10b981",
  constant: "#f59e0b",
  script: "#ef4444",
  version: "#8b5cf6",
  task: "#6366f1",
  process: "#ec4899",
  issue: "#84cc16",
  person: "#14b8a6",
  document: "#f97316",
  project: "#a855f7",
  tool: "#06b6d4",
  library: "#0ea5e9",
  concept: "#d946ef",
  location: "#22c55e",
};

const FALLBACK_COLOR = "#78716c";

function entityRadius(entity: EntityNode): number {
  return Math.max(DEFAULT_RADIUS, Math.min(36, Math.sqrt(entity.mention_count) * 3));
}

export default function EntityGraphView({
  entities,
  edges,
}: {
  entities: EntityNode[];
  edges: EntityEdge[];
}) {
  const [selectedEntity, setSelectedEntity] = useState<EntityNode | null>(null);

  const sim = useSimulation(
    () => {
      const idSet = new Set(entities.map((e) => e.entity_key));
      const constrainedEdges = edges.filter(
        (e) => idSet.has(e.source_key) && idSet.has(e.target_key),
      );
      const degree = new Map<string, number>();
      for (const e of constrainedEdges) {
        degree.set(e.source_key, (degree.get(e.source_key) ?? 0) + 1);
        degree.set(e.target_key, (degree.get(e.target_key) ?? 0) + 1);
      }
      const nodes: EntitySimNode[] = entities.map((e) => ({
        id: e.entity_key,
        x: DEFAULT_WIDTH / 2 + (Math.random() - 0.5) * 200,
        y: DEFAULT_HEIGHT / 2 + (Math.random() - 0.5) * 200,
        vx: 0,
        vy: 0,
        entity: e,
        degree: degree.get(e.entity_key) ?? 0,
      }));
      const simEdges: EntitySimEdge[] = constrainedEdges.map((e) => ({
        source: e.source_key,
        target: e.target_key,
        edge_data: e,
      }));
      return { nodes, edges: simEdges };
    },
    (n) => entityRadius(n.entity),
    [entities, edges],
  );

  const handleNodeClick = useCallback((node: EntitySimNode) => {
    setSelectedEntity(node.entity);
  }, []);

  if (!sim.simReady) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--text-secondary)]">
        Loading entity graph...
      </div>
    );
  }

  if (sim.nodesRef.current.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--text-secondary)]">
        No entities found. Capture more thoughts to build an entity graph.
      </div>
    );
  }

  return (
    <div className="flex gap-4 flex-1 min-h-0">
      <div className="flex-1 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl overflow-hidden">
        <svg
          ref={sim.svgRef}
          viewBox={`0 0 ${DEFAULT_WIDTH} ${DEFAULT_HEIGHT}`}
          className="w-full h-full"
          onPointerMove={sim.handlePointerMove}
          onPointerUp={sim.handlePointerUp}
        >
          {sim.edgesRef.current.map((edge) => {
            const e = edge as EntitySimEdge;
            const a = sim.nodesRef.current.find(
              (n) => n.id === e.source,
            );
            const b = sim.nodesRef.current.find(
              (n) => n.id === e.target,
            );
            if (!a || !b) return null;
            const sw = Math.max(0.5, e.edge_data.weight * 0.05);
            return (
              <line
                key={`${e.source}-${e.target}`}
                className="edge"
                data-source={e.source}
                data-target={e.target}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="#57534e"
                strokeWidth={sw}
                opacity={0.4}
              />
            );
          })}

          {sim.nodesRef.current.map((node) => {
            const n = node as EntitySimNode;
            const r = entityRadius(n.entity);
            const color =
              ENTITY_COLORS[n.entity.entity_type] ?? FALLBACK_COLOR;
            return (
              <g key={n.id}>
                <circle
                  className="node"
                  data-id={n.id}
                  cx={n.x}
                  cy={n.y}
                  r={r}
                  fill={color}
                  stroke="#292524"
                  strokeWidth={2}
                  opacity={0.9}
                  style={{ cursor: "pointer" }}
                  onPointerDown={(e) => sim.handlePointerDown(e, n)}
                  onClick={() => handleNodeClick(n)}
                />
                <text
                  className="label"
                  data-id={n.id}
                  x={n.x}
                  y={n.y + r + 14}
                  textAnchor="middle"
                  fill="#a8a29e"
                  fontSize={10}
                  style={{ pointerEvents: "none" }}
                >
                  {n.entity.display_name.slice(0, 24)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {selectedEntity && (
        <div className="w-80 shrink-0 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4 overflow-y-auto">
          <button
            onClick={() => setSelectedEntity(null)}
            className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] mb-3"
          >
            ← Close
          </button>
          <div
            className="inline-block px-2 py-0.5 rounded text-xs mb-2"
            style={{
              backgroundColor:
                (ENTITY_COLORS[selectedEntity.entity_type] ??
                  FALLBACK_COLOR) + "30",
              color:
                ENTITY_COLORS[selectedEntity.entity_type] ?? FALLBACK_COLOR,
            }}
          >
            {selectedEntity.entity_type}
          </div>
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-1">
            {selectedEntity.display_name}
          </h2>
          <div className="flex flex-wrap gap-2 mt-2 text-xs text-[var(--text-secondary)]">
            <span>Mentions: {selectedEntity.mention_count}</span>
            <span>Thoughts: {selectedEntity.thought_count}</span>
          </div>
          <div className="text-xs text-[var(--text-muted)] mt-2">
            {new Date(selectedEntity.last_mentioned_at).toLocaleString()}
          </div>
        </div>
      )}
    </div>
  );
}
