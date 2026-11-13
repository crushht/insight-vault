/**
 * 知识图谱的力导向布局（纯函数，可单测、可基准测）。
 *
 * 原实现放在页面组件里：迭代 80 次、每次对「所有节点两两」算斥力 ——
 * 200 节点是 160 万次，500 节点就 1000 万次，直接卡主线程。
 *
 * 这里改成「空间网格」近似：把画布切成格子，只对相邻 3×3 格子里的节点算斥力，
 * 远处节点的斥力本就衰减到可忽略（f = k/d²）。复杂度从 O(n²·iters) 降到
 * 近似 O(n·iters)，500 节点也能在几十毫秒内算完。
 */

export interface GraphNode {
  id: string;
  kind: string;
  name: string;
  description?: string | null;
  mentionCount: number;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  relation: string;
  weight: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface LayoutOptions {
  width?: number;
  height?: number;
  iterations?: number;
  /** 斥力系数（越大越散） */
  repulsion?: number;
  /** 弹簧静止长度 */
  linkDistance?: number;
  /** 迭代提前收敛阈值（平均位移小于它就停） */
  minMovement?: number;
}

const DEFAULTS = {
  width: 900,
  height: 560,
  iterations: 120,
  repulsion: 2600,
  linkDistance: 110,
  minMovement: 0.02,
};

export function layoutGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  options: LayoutOptions = {},
): Map<string, Point> {
  const {
    width,
    height,
    iterations,
    repulsion,
    linkDistance,
    minMovement,
  } = { ...DEFAULTS, ...options };

  const n = nodes.length;
  const result = new Map<string, Point>();
  if (n === 0) return result;

  // 单点直接放中间
  if (n === 1) {
    result.set(nodes[0].id, { x: width / 2, y: height / 2 });
    return result;
  }

  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  const vx = new Float64Array(n);
  const vy = new Float64Array(n);
  const index = new Map<string, number>();
  nodes.forEach((node, i) => index.set(node.id, i));

  // 初始摆成一圈，布局更快稳定
  const radius = Math.min(width, height) * 0.32;
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * Math.PI * 2;
    xs[i] = width / 2 + Math.cos(angle) * radius;
    ys[i] = height / 2 + Math.sin(angle) * radius;
  }

  const edgePairs: [number, number, number][] = [];
  for (const edge of edges) {
    const a = index.get(edge.from);
    const b = index.get(edge.to);
    if (a === undefined || b === undefined || a === b) continue;
    edgePairs.push([a, b, Math.max(1, edge.weight || 1)]);
  }

  // 网格：格子边长取「节点平均间距」的 1.5 倍，9 格邻域大约覆盖 linkDistance 的两倍
  const cell = Math.max(
    40,
    Math.sqrt((width * height) / Math.max(1, n)) * 1.5,
  );
  const cols = Math.max(1, Math.ceil(width / cell));
  const rows = Math.max(1, Math.ceil(height / cell));
  const buckets: number[][] = Array.from({ length: cols * rows }, () => []);
  const cellOf = (x: number, y: number) => {
    const cx = Math.min(cols - 1, Math.max(0, Math.floor(x / cell)));
    const cy = Math.min(rows - 1, Math.max(0, Math.floor(y / cell)));
    return cy * cols + cx;
  };

  for (let step = 0; step < iterations; step++) {
    // 每轮重建网格（坐标在动）
    for (const bucket of buckets) bucket.length = 0;
    for (let i = 0; i < n; i++) {
      buckets[cellOf(xs[i], ys[i])].push(i);
    }

    // 斥力：只算同格 + 相邻格
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const bucket = buckets[cy * cols + cx];
        if (bucket.length === 0) continue;
        for (let dy = 0; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dy === 0 && dx < 0) continue; // 避免同一对被算两次
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
            const other = buckets[ny * cols + nx];
            if (other.length === 0) continue;
            const same = dx === 0 && dy === 0;
            for (let ii = 0; ii < bucket.length; ii++) {
              const i = bucket[ii];
              for (
                let jj = same ? ii + 1 : 0;
                jj < other.length;
                jj++
              ) {
                const j = other[jj];
                let ddx = xs[i] - xs[j];
                let ddy = ys[i] - ys[j];
                let d2 = ddx * ddx + ddy * ddy;
                if (d2 < 1) {
                  ddx = (i % 7) - 3 + 0.5;
                  ddy = (j % 5) - 2 + 0.5;
                  d2 = ddx * ddx + ddy * ddy;
                }
                const d = Math.sqrt(d2);
                const f = repulsion / d2;
                vx[i] += (ddx / d) * f;
                vy[i] += (ddy / d) * f;
                vx[j] -= (ddx / d) * f;
                vy[j] -= (ddy / d) * f;
              }
            }
          }
        }
      }
    }

    // 弹簧
    for (const [a, b, weight] of edgePairs) {
      const ddx = xs[b] - xs[a];
      const ddy = ys[b] - ys[a];
      const d = Math.max(1, Math.sqrt(ddx * ddx + ddy * ddy));
      const f = (d - linkDistance) * 0.02 * weight;
      vx[a] += (ddx / d) * f;
      vy[a] += (ddy / d) * f;
      vx[b] -= (ddx / d) * f;
      vy[b] -= (ddy / d) * f;
    }

    // 向心 + 阻尼 + 边界
    let movement = 0;
    for (let i = 0; i < n; i++) {
      vx[i] += (width / 2 - xs[i]) * 0.004;
      vy[i] += (height / 2 - ys[i]) * 0.004;
      vx[i] *= 0.82;
      vy[i] *= 0.82;
      xs[i] = Math.max(24, Math.min(width - 24, xs[i] + vx[i]));
      ys[i] = Math.max(24, Math.min(height - 24, ys[i] + vy[i]));
      movement += Math.abs(vx[i]) + Math.abs(vy[i]);
    }

    // 收敛就提前停，省掉剩下的迭代
    if (movement / n < minMovement) break;
  }

  nodes.forEach((node, i) => result.set(node.id, { x: xs[i], y: ys[i] }));
  return result;
}

/** 只给「提及次数最高的前 N 个」画标签，避免大图上一片文字糊在一起 */
export function pickLabelledNodes<T extends { id: string; mentionCount: number }>(
  nodes: T[],
  limit = 40,
  alwaysInclude?: string | null,
): Set<string> {
  const top = [...nodes]
    .sort((a, b) => b.mentionCount - a.mentionCount)
    .slice(0, Math.max(0, limit))
    .map((n) => n.id);
  const set = new Set(top);
  if (alwaysInclude) set.add(alwaysInclude);
  return set;
}
