"use client";

import { useEffect, useRef, useState, useCallback } from "react";

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
  decision: "#f59e0b",
  insight: "#10b981",
  meeting: "#6366f1",
  action: "#ef4444",
  reference: "#3b82f6",
  question: "#8b5cf6",
  note: "#9ca3af",
};

const RADIUS = 12;

export default function GraphView({
  thoughts,
  contradictions,
  thoughtMap,
}: {
  thoughts: ThoughtNode[];
  contradictions: ContradictionEdge[];
  thoughtMap: Map<string, ThoughtNode>;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const animRef = useRef<number>(0);
  const [selectedNode, setSelectedNode] = useState<ThoughtNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<ContradictionEdge | null>(null);
  const [simReady, setSimReady] = useState(false);

  const nodesRef = useRef<SimNode[]>([]);
  const edgesRef = useRef<SimEdge[]>([]);
  const dragRef = useRef<{ node: SimNode; ox: number; oy: number } | null>(null);

  const width = 900;
  const height = 650;

  // Build graph from contradictions
  useEffect(() => {
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
        x: width / 2 + (Math.random() - 0.5) * 200,
        y: height / 2 + (Math.random() - 0.5) * 200,
        vx: 0,
        vy: 0,
        thought,
        degree: degree.get(id) ?? 0,
      });
    }

    nodesRef.current = simNodes;
    edgesRef.current = simEdges;
    runSimulation();
    setSimReady(true);
  }, [thoughts, contradictions, thoughtMap]);

  const runSimulation = useCallback(() => {
    const nodes = nodesRef.current;
    const edges = edgesRef.current;
    if (nodes.length === 0) return;

    const tick = () => {
      // Repulsion between all node pairs
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = 800 / (dist * dist);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          a.vx -= fx;
          a.vy -= fy;
          b.vx += fx;
          b.vy += fy;
        }
      }

      // Attraction along edges
      for (const edge of edges) {
        const a = nodes.find((n) => n.id === edge.source);
        const b = nodes.find((n) => n.id === edge.target);
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = (dist - 120) * 0.01;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }

      // Center gravity
      for (const node of nodes) {
        node.vx += (width / 2 - node.x) * 0.001;
        node.vy += (height / 2 - node.y) * 0.001;
      }

      // Apply velocity with damping
      for (const node of nodes) {
        node.vx *= 0.85;
        node.vy *= 0.85;
        node.x += node.vx;
        node.y += node.vy;
        node.x = Math.max(RADIUS, Math.min(width - RADIUS, node.x));
        node.y = Math.max(RADIUS, Math.min(height - RADIUS, node.y));
      }

      animRef.current = requestAnimationFrame(tick);
    };

    animRef.current = requestAnimationFrame(tick);
  }, [width, height]);

  // Render SVG
  useEffect(() => {
    if (!simReady) return;
    const svg = svgRef.current;
    if (!svg) return;

    let raf: number;
    const render = () => {
      const nodes = nodesRef.current;
      const edges = edgesRef.current;

      const nodeEls = svg.querySelectorAll<SVGCircleElement>("circle.node");
      nodeEls.forEach((el) => {
        const id = el.getAttribute("data-id");
        const n = nodes.find((x) => x.id === id);
        if (n) {
          el.setAttribute("cx", String(n.x));
          el.setAttribute("cy", String(n.y));
          const r = RADIUS + n.degree * 2;
          el.setAttribute("r", String(r));
        }
      });

      const labelEls = svg.querySelectorAll<SVGTextElement>("text.label");
      labelEls.forEach((el) => {
        const id = el.getAttribute("data-id");
        const n = nodes.find((x) => x.id === id);
        if (n) {
          el.setAttribute("x", String(n.x));
          el.setAttribute("y", String(n.y + RADIUS + n.degree * 2 + 14));
        }
      });

      const lineEls = svg.querySelectorAll<SVGLineElement>("line.edge");
      lineEls.forEach((el) => {
        const src = el.getAttribute("data-source");
        const tgt = el.getAttribute("data-target");
        const a = nodes.find((x) => x.id === src);
        const b = nodes.find((x) => x.id === tgt);
        if (a && b) {
          el.setAttribute("x1", String(a.x));
          el.setAttribute("y1", String(a.y));
          el.setAttribute("x2", String(b.x));
          el.setAttribute("y2", String(b.y));
        }
      });

      raf = requestAnimationFrame(render);
    };

    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [simReady]);

  // Cleanup simulation on unmount
  useEffect(() => {
    return () => cancelAnimationFrame(animRef.current);
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent, node: SimNode) => {
      e.preventDefault();
      (e.target as Element).setPointerCapture(e.pointerId);
      const svg = svgRef.current;
      if (!svg) return;
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      const svgPt = pt.matrixTransform(ctm.inverse());
      dragRef.current = { node, ox: node.x - svgPt.x, oy: node.y - svgPt.y };
    },
    [],
  );

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const svg = svgRef.current;
    if (!svg) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const svgPt = pt.matrixTransform(ctm.inverse());
    drag.node.x = svgPt.x + drag.ox;
    drag.node.y = svgPt.y + drag.oy;
  }, []);

  const handlePointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const handleNodeClick = useCallback((node: SimNode) => {
    setSelectedNode(node.thought);
    setSelectedEdge(null);
  }, []);

  const handleEdgeClick = useCallback((edge: SimEdge) => {
    setSelectedEdge(edge.contradiction);
    setSelectedNode(null);
  }, []);

  if (!simReady) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--text-secondary)]">
        Loading graph...
      </div>
    );
  }

  if (nodesRef.current.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--text-secondary)]">
        No contradictions found. Run <code className="text-[var(--text-primary)]">brain audit</code> to detect contradictions, then revisit this page.
      </div>
    );
  }

  return (
    <div className="flex gap-4 flex-1 min-h-0">
      <div className="flex-1 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl overflow-hidden">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-full"
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          {/* Edges */}
          {edgesRef.current.map((edge) => {
            const a = nodesRef.current.find((n) => n.id === edge.source);
            const b = nodesRef.current.find((n) => n.id === edge.target);
            if (!a || !b) return null;
            const sw = Math.max(0.5, edge.contradiction.severity * 0.8);
            const op = 0.3 + edge.contradiction.confidence * 0.5;
            const color = edge.contradiction.status === "open" ? "#f59e0b" : "#6b7280";
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
                style={{ cursor: "pointer" }}
                onClick={() => handleEdgeClick(edge)}
              />
            );
          })}
          {/* Nodes */}
          {nodesRef.current.map((node) => {
            const r = RADIUS + node.degree * 2;
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
                  style={{ cursor: "pointer" }}
                  onPointerDown={(e) => handlePointerDown(e, node)}
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
                  style={{ pointerEvents: "none" }}
                >
                  {node.thought.topics.slice(0, 2).join(", ") || node.thought.thought_type}
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
                  backgroundColor: (TYPE_COLORS[selectedNode.thought_type] ?? TYPE_COLORS.note) + "30",
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
                    backgroundColor: selectedEdge.status === "open" ? "#f59e0b30" : "#6b728030",
                    color: selectedEdge.status === "open" ? "#f59e0b" : "#6b7280",
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
