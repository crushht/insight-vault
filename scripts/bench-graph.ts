// 布局算法对比：旧实现（页面组件里那版，全对算斥力）vs 新实现（空间网格近似）。
// 用法：node --import tsx scripts/bench-graph.ts

import { layoutGraph, type GraphEdge, type GraphNode } from "../apps/web/lib/graph-layout";

const WIDTH = 900;
const HEIGHT = 560;

function makeGraph(n: number, edgeCount: number) {
  const nodes: GraphNode[] = Array.from({ length: n }, (_, i) => ({
    id: `n${i}`,
    kind: "concept",
    name: `节点 ${i}`,
    mentionCount: (i % 17) + 1,
  }));
  const edges: GraphEdge[] = Array.from({ length: edgeCount }, (_, i) => ({
    id: `e${i}`,
    from: `n${i % n}`,
    to: `n${(i * 7 + 3) % n}`,
    relation: "related",
    weight: 1,
  })).filter((e) => e.from !== e.to);
  return { nodes, edges };
}

/** 旧版：80 次迭代 × 全节点两两斥力（O(n²)） */
function legacyLayout(nodes: GraphNode[], edges: GraphEdge[]) {
  const pos = new Map<string, { x: number; y: number; vx: number; vy: number }>();
  nodes.forEach((n, i) => {
    const angle = (i / Math.max(1, nodes.length)) * Math.PI * 2;
    const r = Math.min(WIDTH, HEIGHT) * 0.32;
    pos.set(n.id, {
      x: WIDTH / 2 + Math.cos(angle) * r,
      y: HEIGHT / 2 + Math.sin(angle) * r,
      vx: 0,
      vy: 0,
    });
  });
  const ids = nodes.map((n) => n.id);
  for (let step = 0; step < 80; step++) {
    for (let i = 0; i < ids.length; i++) {
      const a = pos.get(ids[i])!;
      for (let j = i + 1; j < ids.length; j++) {
        const b = pos.get(ids[j])!;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) {
          dx = Math.random() - 0.5;
          dy = Math.random() - 0.5;
          d2 = 1;
        }
        const f = 2600 / d2;
        const d = Math.sqrt(d2);
        a.vx += (dx / d) * f;
        a.vy += (dy / d) * f;
        b.vx -= (dx / d) * f;
        b.vy -= (dy / d) * f;
      }
    }
    for (const e of edges) {
      const a = pos.get(e.from);
      const b = pos.get(e.to);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const f = (d - 110) * 0.02 * (e.weight || 1);
      a.vx += (dx / d) * f;
      a.vy += (dy / d) * f;
      b.vx -= (dx / d) * f;
      b.vy -= (dy / d) * f;
    }
    for (const id of ids) {
      const p = pos.get(id)!;
      p.vx += (WIDTH / 2 - p.x) * 0.004;
      p.vy += (HEIGHT / 2 - p.y) * 0.004;
      p.vx *= 0.82;
      p.vy *= 0.82;
      p.x = Math.max(24, Math.min(WIDTH - 24, p.x + p.vx));
      p.y = Math.max(24, Math.min(HEIGHT - 24, p.y + p.vy));
    }
  }
  return pos;
}

function time(fn: () => unknown, runs = 3) {
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    fn();
    samples.push(performance.now() - t);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

console.log("nodes\tedges\t旧实现(ms)\t新实现(ms)\t提升");
for (const n of [200, 500, 1000]) {
  const { nodes, edges } = makeGraph(n, n * 3);
  const oldMs = time(() => legacyLayout(nodes, edges), n >= 1000 ? 1 : 3);
  const newMs = time(() => layoutGraph(nodes, edges), 3);
  const speedup = oldMs / Math.max(0.01, newMs);
  console.log(
    `${n}\t${edges.length}\t${oldMs.toFixed(1)}\t\t${newMs.toFixed(1)}\t\t${speedup.toFixed(1)}×`,
  );
}
