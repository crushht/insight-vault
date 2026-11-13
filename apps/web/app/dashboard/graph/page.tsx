"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Network } from "lucide-react";

import { useTRPC } from "@karakeep/shared-react/trpc";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { layoutGraph, pickLabelledNodes } from "@/lib/graph-layout";
import { useTranslation } from "@/lib/i18n/client";

const WIDTH = 900;
const HEIGHT = 560;

interface Node {
  id: string;
  kind: string;
  name: string;
  description: string | null;
  mentionCount: number;
}

interface Edge {
  id: string;
  from: string;
  to: string;
  relation: string;
  weight: number;
}

const KIND_COLOR: Record<string, string> = {
  person: "hsl(var(--iv-ai-from))",
  place: "hsl(var(--iv-ai-to))",
  org: "hsl(var(--iv-brand-600))",
  product: "hsl(var(--iv-amber-500))",
  tech: "hsl(var(--iv-info))",
  concept: "hsl(var(--iv-brand-500))",
  topic: "hsl(var(--iv-text-secondary))",
};

export default function GraphPage() {
  useTranslation();
  const api = useTRPC();
  const [selected, setSelected] = useState<string | null>(null);
  // 默认 200；实体多的时候可以拉到 500（后端上限），布局已能在几十毫秒内算完
  const [nodeLimit, setNodeLimit] = useState(200);

  const overview = useQuery(
    api.graph.overview.queryOptions({ limit: nodeLimit }),
  );
  const detail = useQuery(
    api.graph.entity.queryOptions(
      { entityId: selected ?? "" },
      { enabled: Boolean(selected) },
    ),
  );

  const removeEntity = useMutation(
    api.graph.deleteEntity.mutationOptions({
      onSettled: async () => {
        setSelected(null);
        await overview.refetch();
      },
    }),
  );
  const nodes = (overview.data?.nodes ?? []) as Node[];
  const edges = (overview.data?.edges ?? []) as Edge[];
  const total = (overview.data as { total?: number } | undefined)?.total ?? nodes.length;
  const truncatedHint =
    total > nodes.length ? `已显示前 ${nodes.length} 个（共 ${total} 个）` : undefined;
  const pos = useMemo(
    () => layoutGraph(nodes, edges, { width: WIDTH, height: HEIGHT }),
    [nodes, edges],
  );

  // 边合成一条 path：500 条边 = 1 个 DOM 节点，而不是 500 个 <line>
  const edgePath = useMemo(() => {
    const parts: string[] = [];
    for (const e of edges) {
      const a = pos.get(e.from);
      const b = pos.get(e.to);
      if (!a || !b) continue;
      parts.push(`M${a.x.toFixed(1)} ${a.y.toFixed(1)}L${b.x.toFixed(1)} ${b.y.toFixed(1)}`);
    }
    return parts.join("");
  }, [edges, pos]);

  // 标签只给提及最多的前 N 个 + 当前选中，避免大图文字糊成一团；
  // 节点越多，标签越少（500 个点时 40 个标签会挤在一起）
  const labelled = useMemo(
    () =>
      pickLabelledNodes(nodes, nodes.length > 300 ? 16 : 40, selected),
    [nodes, selected],
  );

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <Card className="min-w-0 flex-1">
        <CardHeader className="border-b border-border py-3">
          <CardTitle className="flex items-center gap-2 text-body-lg">
            <Network className="size-4 text-brand-600" />
            知识图谱
            <span className="text-caption font-normal text-muted-foreground">
              {nodes.length} 个实体 · {edges.length} 条关系
            </span>
            {total > 200 && (
              <label className="ml-auto flex items-center gap-1 text-caption font-normal text-muted-foreground">
                显示
                <select
                  value={nodeLimit}
                  onChange={(e) => setNodeLimit(Number(e.target.value))}
                  className="rounded-md border border-border bg-background px-1.5 py-0.5 text-caption text-foreground"
                  aria-label="图谱显示节点数"
                >
                  <option value={200}>200</option>
                  <option value={500}>500</option>
                </select>
              </label>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {nodes.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
              <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-brand-50">
                <Network className="size-6 text-brand-600" />
              </div>
              <p className="text-h4 text-foreground">还没有图谱</p>
              <p className="mt-1 max-w-md text-body text-muted-foreground">
                图谱来自对收藏正文的实体抽取。等抽取任务跑过之后，
                这里会显示人物、组织、技术与概念之间的关系。
              </p>
            </div>
          ) : (
            <svg
              viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
              className="h-auto w-full"
              role="img"
              aria-label="知识图谱"
            >
              {edgePath && (
                <path
                  d={edgePath}
                  fill="none"
                  stroke="hsl(var(--border-strong))"
                  strokeWidth={1}
                  strokeOpacity={0.9}
                />
              )}
              {nodes.map((n) => {
                const p = pos.get(n.id)!;
                const r = 6 + Math.min(10, Math.sqrt(n.mentionCount) * 2);
                return (
                  <g
                    key={n.id}
                    onClick={() => setSelected(n.id)}
                    className="cursor-pointer"
                  >
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={r}
                      fill={KIND_COLOR[n.kind] ?? "hsl(var(--iv-text-tertiary))"}
                      opacity={selected && selected !== n.id ? 0.45 : 0.95}
                    />
                    {labelled.has(n.id) && (
                      <text
                        x={p.x}
                        y={p.y - r - 4}
                        textAnchor="middle"
                        className="fill-foreground text-[10px]"
                      >
                        {n.name.slice(0, 12)}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          )}
        </CardContent>
      </Card>

      <aside className="w-full shrink-0 lg:w-72">
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-body">
              实体列表
              <span className="ml-2 text-caption font-normal text-muted-foreground">
                {truncatedHint ?? "图谱的表格替代视图"}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-64 overflow-y-auto p-0">
            {nodes.length === 0 ? (
              <p className="p-3 text-caption text-muted-foreground">暂无实体。</p>
            ) : (
              <table className="w-full text-caption">
                <thead className="sticky top-0 bg-surface-raised text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-3 py-1.5 text-left font-normal">名称</th>
                    <th className="px-2 py-1.5 text-left font-normal">类型</th>
                    <th className="px-2 py-1.5 text-right font-normal">提及</th>
                    <th className="w-6">
                      <span className="sr-only">删除</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {nodes.map((n) => (
                    <tr
                      key={n.id}
                      onClick={() => setSelected(n.id)}
                      className={`cursor-pointer border-b border-border/60 last:border-0 hover:bg-accent ${
                        selected === n.id ? "bg-brand-50" : ""
                      }`}
                    >
                      <td className="max-w-[9rem] truncate px-3 py-1.5">{n.name}</td>
                      <td className="px-2 py-1.5 text-muted-foreground">{n.kind}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {n.mentionCount}
                      </td>
                      <td className="w-6 px-1 py-1.5 text-right">
                        <button
                          type="button"
                          title="删除该实体"
                          aria-label={`删除实体 ${n.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            removeEntity.mutate({ entityId: n.id });
                          }}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-body">实体详情</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-body">
            {!selected && (
              <p className="text-muted-foreground">点击左侧节点查看详情。</p>
            )}
            {detail.data && (
              <>
                <p className="font-medium">{detail.data.entity.name}</p>
                <p className="text-caption text-muted-foreground">
                  {detail.data.entity.kind} · 提及 {detail.data.entity.mentionCount} 次
                </p>
                {detail.data.entity.description && (
                  <p className="text-muted-foreground">
                    {detail.data.entity.description}
                  </p>
                )}
                <div className="border-t border-border pt-2">
                  <p className="mb-1 text-caption text-muted-foreground">
                    出现于 {detail.data.mentions.length} 条收藏
                  </p>
                  {detail.data.mentions.slice(0, 8).map((m) => (
                    <p
                      key={m.id}
                      className="truncate text-caption text-muted-foreground"
                    >
                      · {m.quote?.slice(0, 40) ?? m.bookmarkId}
                    </p>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
