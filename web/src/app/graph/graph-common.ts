'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

/** Base node fields required by the force simulation physics tick. */
export interface SimNodeBase {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** Base edge fields required by the force simulation physics tick. */
export interface SimEdgeBase {
  source: string;
  target: string;
}

export const DEFAULT_WIDTH = 900;
export const DEFAULT_HEIGHT = 650;
export const DEFAULT_RADIUS = 12;

/**
 * Shared force-simulation hook extracted from the original contradiction graph.
 *
 * Manages:
 *  - Graph construction (via buildGraph callback)
 *  - Physics tick (Coulomb repulsion, Hooke spring, center gravity, damping)
 *  - SVG render loop (queries elements by class / data-attribute)
 *  - Pointer drag handlers
 *
 * Each view supplies its own buildGraph and getNodeRadius functions and
 * renders its own SVG JSX. The hook handles everything else.
 */
export function useSimulation<N extends SimNodeBase, E extends SimEdgeBase>(
  buildGraph: () => { nodes: N[]; edges: E[] },
  getNodeRadius: (node: N) => number,
  deps: React.DependencyList,
  width: number = DEFAULT_WIDTH,
  height: number = DEFAULT_HEIGHT,
) {
  const svgRef = useRef<SVGSVGElement>(null);
  const animRef = useRef<number>(0);
  const [simReady, setSimReady] = useState(false);

  const nodesRef = useRef<N[]>([]);
  const edgesRef = useRef<E[]>([]);
  const dragRef = useRef<{ node: SimNodeBase; ox: number; oy: number } | null>(null);

  // Keep a live ref so the rAF render loop always sees the latest radius fn.
  const radiusFnRef = useRef(getNodeRadius);
  radiusFnRef.current = getNodeRadius;

  // ---------- physics tick ----------

  const startSimulation = useCallback(() => {
    const nodes = nodesRef.current;
    const edges = edgesRef.current;
    if (nodes.length === 0) return;

    const tick = () => {
      // Coulomb repulsion between all node pairs
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
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

      // Hooke spring attraction along edges
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

      // Apply velocity with damping, clamp to bounds
      for (const node of nodes) {
        node.vx *= 0.85;
        node.vy *= 0.85;
        node.x += node.vx;
        node.y += node.vy;
        node.x = Math.max(DEFAULT_RADIUS, Math.min(width - DEFAULT_RADIUS, node.x));
        node.y = Math.max(DEFAULT_RADIUS, Math.min(height - DEFAULT_RADIUS, node.y));
      }

      animRef.current = requestAnimationFrame(tick);
    };

    animRef.current = requestAnimationFrame(tick);
  }, [width, height]);

  // ---------- build graph & start sim ----------

  useEffect(() => {
    const { nodes, edges } = buildGraph();
    nodesRef.current = nodes;
    edgesRef.current = edges;
    if (nodes.length === 0) {
      setSimReady(true);
      return;
    }
    startSimulation();
    setSimReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  // ---------- SVG render loop ----------

  useEffect(() => {
    if (!simReady) return;
    const svg = svgRef.current;
    if (!svg) return;

    let raf: number;
    const render = () => {
      const nodes = nodesRef.current;

      const nodeEls = svg.querySelectorAll<SVGCircleElement>('circle.node');
      nodeEls.forEach((el) => {
        const id = el.getAttribute('data-id');
        const n = nodes.find((x) => x.id === id);
        if (n) {
          el.setAttribute('cx', String(n.x));
          el.setAttribute('cy', String(n.y));
          el.setAttribute('r', String(radiusFnRef.current(n)));
        }
      });

      const labelEls = svg.querySelectorAll<SVGTextElement>('text.label');
      labelEls.forEach((el) => {
        const id = el.getAttribute('data-id');
        const n = nodes.find((x) => x.id === id);
        if (n) {
          el.setAttribute('x', String(n.x));
          el.setAttribute('y', String(n.y + radiusFnRef.current(n) + 14));
        }
      });

      const lineEls = svg.querySelectorAll<SVGLineElement>('line.edge');
      lineEls.forEach((el) => {
        const src = el.getAttribute('data-source');
        const tgt = el.getAttribute('data-target');
        const a = nodes.find((x) => x.id === src);
        const b = nodes.find((x) => x.id === tgt);
        if (a && b) {
          el.setAttribute('x1', String(a.x));
          el.setAttribute('y1', String(a.y));
          el.setAttribute('x2', String(b.x));
          el.setAttribute('y2', String(b.y));
        }
      });

      raf = requestAnimationFrame(render);
    };

    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [simReady]);

  // ---------- cleanup on unmount ----------

  useEffect(() => {
    return () => cancelAnimationFrame(animRef.current);
  }, []);

  // ---------- pointer drag handlers ----------

  const handlePointerDown = useCallback((e: React.PointerEvent, node: SimNodeBase) => {
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
    dragRef.current = {
      node,
      ox: node.x - svgPt.x,
      oy: node.y - svgPt.y,
    };
  }, []);

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

  return {
    svgRef,
    simReady,
    nodesRef,
    edgesRef,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
  };
}
