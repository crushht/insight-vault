import { describe, expect, it } from "vitest";

import type { GraphEdge, GraphNode } from "./graph-layout";
import { layoutGraph, pickLabelledNodes } from "./graph-layout";

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

describe("layoutGraph", () => {
  it("空图返回空", () => {
    expect(layoutGraph([], []).size).toBe(0);
  });

  it("单点放中间", () => {
    const pos = layoutGraph([{ id: "a", kind: "x", name: "a", mentionCount: 1 }], []);
    expect(pos.get("a")).toEqual({ x: 450, y: 280 });
  });

  it("所有点都在画布内且不重叠", () => {
    const { nodes, edges } = makeGraph(60, 90);
    const pos = layoutGraph(nodes, edges);
    expect(pos.size).toBe(nodes.length);
    const seen = new Set<string>();
    for (const [, p] of pos) {
      expect(p.x).toBeGreaterThanOrEqual(24);
      expect(p.x).toBeLessThanOrEqual(900 - 24);
      expect(p.y).toBeGreaterThanOrEqual(24);
      expect(p.y).toBeLessThanOrEqual(560 - 24);
      // 坐标四舍五入到 1 位，避免「两个点重合」被判成重叠
      seen.add(`${p.x.toFixed(1)},${p.y.toFixed(1)}`);
    }
    expect(seen.size).toBeGreaterThan(nodes.length * 0.9);
  });

  it("1000 节点 / 3000 边能在 300ms 内算完", () => {
    const { nodes, edges } = makeGraph(1000, 3000);
    const started = performance.now();
    const pos = layoutGraph(nodes, edges);
    const elapsed = performance.now() - started;
    expect(pos.size).toBe(nodes.length);
    expect(elapsed).toBeLessThan(300);
  });

  it("同样的输入两次结果一致（没有用随机数）", () => {
    const { nodes, edges } = makeGraph(40, 60);
    const a = layoutGraph(nodes, edges);
    const b = layoutGraph(nodes, edges);
    for (const [id, p] of a) {
      expect(b.get(id)!.x).toBeCloseTo(p.x, 6);
      expect(b.get(id)!.y).toBeCloseTo(p.y, 6);
    }
  });
});

describe("pickLabelledNodes", () => {
  const nodes = Array.from({ length: 100 }, (_, i) => ({
    id: `n${i}`,
    mentionCount: i,
  }));

  it("取提及次数最高的前 N 个", () => {
    const set = pickLabelledNodes(nodes, 10);
    expect(set.size).toBe(10);
    expect(set.has("n99")).toBe(true);
    expect(set.has("n0")).toBe(false);
  });

  it("选中的节点一定带标签", () => {
    const set = pickLabelledNodes(nodes, 5, "n0");
    expect(set.has("n0")).toBe(true);
  });
});
