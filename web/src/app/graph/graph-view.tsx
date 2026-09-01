'use client';

import { useState, useCallback } from 'react';
import { useSimulation, DEFAULT_WIDTH, DEFAULT_HEIGHT, DEFAULT_RADIUS } from './graph-common';

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

interface SimNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  thought: ThoughtNode;
  degree: number;
}

interface SimEdge {
  source: string;
  target: string;
  contradiction: ContradictionEdge;
}

const TYPE_COLORS: Record<string, string> = {
  decision: '#f59e0b',
  insight: '#10b981',
  meeting: '#6366f1',
  action: '#ef4444',
  reference: '#3b82f6',
  question: '#8b5cf6',
  note: '#9ca3af',
};

export default function GraphView({
  thoughts,
  contradictions,
  thoughtMap,
}: {
  thoughts: ThoughtNode[];
  contradictions: ContradictionEdge[];
  thoughtMap: Map<string, ThoughtNode>;
}) {
  const [selectedNode, setSelectedNode] = useState<ThoughtNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<ContradictionEdge | null>(null);

  const sim = useSimulation(
    () => {
      const nodeIds = new Set<string>();
      const degree = new Map<string, number>();

      const simEdges: SimEdge[] = [];
      for (const c of contradictions) {
        simEdges.push({ source: c.thought_a_id, target: c.thought_b_id, contradiction: c });
        nodeIds.add(c.thought_a_id);
        nodeIds.add(c.thought_b_id);
        degree.set(c.thought_a_id, (degree.get(c.thought_a_id) ?? 0) + 1);
        degree.set(c.thought_b_id, (degree.get(c.thought_b_id) ?? 0) + 1);
      }

      const simNodes: SimNode[] = [];
      for (const id of nodeIds) {
        const thought = thoughtMap.get(id);
        if (!thought) continue;
        simNodes.push({
          id,
          x: DEFAULT_WIDTH / 2 + (Math.random() - 0.5) * 200,
          y: DEFAULT_HEIGHT / 2 + (Math.random() - 0.5) * 200,
          vx: 0,
          vy: 0,
          thought,
          degree: degree.get(id) ?? 0,
        });
      }

      return { nodes: simNodes, edges: simEdges };
    },
    (n) => DEFAULT_RADIUS + (n as SimNode).degree * 2,
    [thoughts, contradictions, thoughtMap],
  );

  const handleNodeClick = useCallback((node: SimNode) => {
    setSelectedNode(node.thought);
    setSelectedEdge(null);
  }, []);

  const handleEdgeClick = useCallback((edge: SimEdge) => {
    setSelectedEdge(edge.contradiction);
    setSelectedNode(null);
  }, []);

  if (!sim.simReady) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--text-secondary)]">
        Loading graph...
      </div>
    );
  }

  if (sim.nodesRef.current.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--text-secondary)]">
        No contradictions found. Run <code className="text-[var(--text-primary)]">brain audit</code>{' '}
        to detect contradictions, then revisit this page.
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
          {/* Edges */}
          {sim.edgesRef.current.map((edge) => {
            const a = sim.nodesRef.current.find((n) => n.id === edge.source);
            const b = sim.nodesRef.current.find((n) => n.id === edge.target);
            if (!a || !b) return null;
            const sw = Math.max(0.5, edge.contradiction.severity * 0.8);
            const op = 0.3 + edge.contradiction.confidence * 0.5;
            const color = edge.contradiction.status === 'open' ? '#f59e0b' : '#6b7280';
            return (
              <line
                key={edge.contradiction.id}
                className="edge"
                data-source={edge.source}
                data-target={edge.target}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={color}
                strokeWidth={sw}
                opacity={op}
                style={{ cursor: 'pointer' }}
                onClick={() => handleEdgeClick(edge)}
              />
            );
          })}
          {/* Nodes */}
          {sim.nodesRef.current.map((node) => {
            const r = DEFAULT_RADIUS + node.degree * 2;
            const color = TYPE_COLORS[node.thought.thought_type] ?? TYPE_COLORS.note;
            return (
              <g key={node.id}>
                <circle
                  className="node"
                  data-id={node.id}
                  cx={node.x}
                  cy={node.y}
                  r={r}
                  fill={color}
                  stroke="#1f2937"
                  strokeWidth={2}
                  opacity={0.85}
                  style={{ cursor: 'pointer' }}
                  onPointerDown={(e) => sim.handlePointerDown(e, node)}
                  onClick={() => handleNodeClick(node)}
                />
                <text
                  className="label"
                  data-id={node.id}
                  x={node.x}
                  y={node.y + r + 14}
                  textAnchor="middle"
                  fill="#9ca3af"
                  fontSize={10}
                  style={{ pointerEvents: 'none' }}
                >
                  {node.thought.topics.slice(0, 2).join(', ') || node.thought.thought_type}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Detail panel */}
      {(selectedNode || selectedEdge) && (
        <div className="w-80 shrink-0 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4 overflow-y-auto">
          {selectedNode && (
            <div>
              <button
                onClick={() => setSelectedNode(null)}
                className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] mb-3"
              >
                ← Close
              </button>
              <div
                className="inline-block px-2 py-0.5 rounded text-xs mb-2"
                style={{
                  backgroundColor:
                    (TYPE_COLORS[selectedNode.thought_type] ?? TYPE_COLORS.note) + '30',
                  color: TYPE_COLORS[selectedNode.thought_type] ?? TYPE_COLORS.note,
                }}
              >
                {selectedNode.thought_type}
              </div>
              <p className="text-sm text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed">
                {selectedNode.raw_text}
              </p>
              {selectedNode.topics.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-3">
                  {selectedNode.topics.map((t) => (
                    <span
                      key={t}
                      className="text-xs px-1.5 py-0.5 rounded bg-[var(--bg-secondary)] text-[var(--text-secondary)]"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}
              <div className="text-xs text-[var(--text-muted)] mt-3">
                {new Date(selectedNode.created_at).toLocaleString()}
              </div>
            </div>
          )}
          {selectedEdge && (
            <div>
              <button
                onClick={() => setSelectedEdge(null)}
                className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] mb-3"
              >
                ← Close
              </button>
              <div className="flex items-center gap-2 mb-2">
                <span
                  className="inline-block px-2 py-0.5 rounded text-xs"
                  style={{
                    backgroundColor: selectedEdge.status === 'open' ? '#f59e0b30' : '#6b728030',
                    color: selectedEdge.status === 'open' ? '#f59e0b' : '#6b7280',
                  }}
                >
                  {selectedEdge.status}
                </span>
                <span className="text-xs text-[var(--text-secondary)]">
                  severity {selectedEdge.severity}/5
                </span>
                <span className="text-xs text-[var(--text-secondary)]">
                  confidence {(selectedEdge.confidence * 100).toFixed(0)}%
                </span>
              </div>
              <p className="text-sm text-[var(--text-primary)] leading-relaxed">
                {selectedEdge.reason}
              </p>
              <div className="mt-3 text-xs text-[var(--text-muted)]">
                {new Date(selectedEdge.detected_at).toLocaleString()}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
