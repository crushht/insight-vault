"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Copy, Download, Sparkles } from "lucide-react";

import { useTRPC } from "@karakeep/shared-react/trpc";

import { downloadMarkdown, sanitizeFilename } from "@/lib/markdown-download";

import { ActionButton } from "@/components/ui/action-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function TopicsPage() {
  const api = useTRPC();
  const [topic, setTopic] = useState("");
  const [copied, setCopied] = useState(false);

  const generate = useMutation(api.topics.generate.mutationOptions());
  const removeReport = useMutation(
    api.topics.deleteReport.mutationOptions({
      onSettled: async () => {
        await history.refetch();
      },
    }),
  );
  const [reportLimit, setReportLimit] = useState(10);
  const history = useQuery(
    api.topics.reports.queryOptions({ kind: "topic", limit: reportLimit }),
  );
  const result = generate.data;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="flex items-center gap-2 text-body">
            <Sparkles className="size-4 text-brand-600" />
            智能专题
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-caption text-muted-foreground">
            输入一个研究主题，从你的收藏里检索相关资料并整理成结构化报告。
            没有配置 AI 时会生成「素材清单 + 引用编号」的草稿。
          </p>
          <div className="flex gap-2">
            <input
              className="h-9 flex-1 rounded-md border border-input bg-surface-raised px-3 text-body outline-none focus-visible:border-brand-500"
              placeholder="例如：向量数据库选型"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && topic.trim()) {
                  generate.mutate({ topic: topic.trim() });
                }
              }}
              data-testid="topic-input"
            />
            <ActionButton
              ignoreDemoMode
              disabled={!topic.trim()}
              loading={generate.isPending}
              onClick={() => generate.mutate({ topic: topic.trim() })}
              data-testid="topic-generate"
            >
              生成
            </ActionButton>
          </div>
          {generate.isError && (
            <p className="text-caption text-destructive">
              {String(
                (generate.error as { message?: string } | null)?.message ??
                  "生成失败",
              )}
            </p>
          )}
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between py-3">
            <CardTitle className="text-body">
              {result.mode === "ai" ? "AI 生成" : "素材草稿"}
              <span className="ml-2 text-caption font-normal text-muted-foreground">
                {result.sourceCount} 个相关片段
              </span>
            </CardTitle>
            <ActionButton
              variant="outline"
              size="sm"
              loading={false}
              ignoreDemoMode
              onClick={() => {
                void navigator.clipboard.writeText(result.markdown).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
            >
              <Copy className="size-3.5" />
              {copied ? "已复制" : "复制"}
            </ActionButton>
            <ActionButton
              variant="outline"
              size="sm"
              ignoreDemoMode
              loading={false}
              className="ml-2"
              onClick={() =>
                downloadMarkdown(
                  sanitizeFilename(topic, "专题"),
                  result.markdown,
                )
              }
              data-testid="download-md"
            >
              <Download className="size-3.5" />
              下载 .md
            </ActionButton>
          </CardHeader>
          <CardContent>
            <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-lg bg-surface-sunken p-4 text-label leading-relaxed">
              {result.markdown}
            </pre>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-body">
            历史
            <span className="ml-2 text-caption font-normal text-muted-foreground">
              最近 {history.data?.reports.length ?? 0} 条
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 p-0">
          {history.data?.reports.length === 0 && (
            <p className="p-3 text-caption text-muted-foreground">还没有生成记录。</p>
          )}
          {history.data?.reports.map((r) => (
            <div
              key={r.id}
              className="flex w-full items-center justify-between gap-2 border-b border-border/60 px-3 py-2 text-caption last:border-0 hover:bg-accent"
            >
              <button
                type="button"
                onClick={() =>
                  downloadMarkdown(sanitizeFilename(r.title, "专题"), r.markdown)
              }
                className="flex flex-1 items-center justify-between text-left"
                title="点击下载 .md"
              >
                <span className="max-w-[60%] truncate">{r.title}</span>
                <span className="text-muted-foreground">
                  {r.mode === "ai" ? "AI" : "草稿"} · {r.sourceCount} 片段 ·{" "}
                  {new Date(r.createdAt).toLocaleDateString("zh-CN")}
                </span>
              </button>
              <button
                type="button"
                onClick={() => removeReport.mutate({ id: r.id })}
                className="text-muted-foreground transition-colors hover:text-destructive"
                title="删除这条记录"
                aria-label={`删除记录 ${r.title}`}
              >
                ×
              </button>
            </div>
          ))}
          {(history.data?.reports.length ?? 0) >= reportLimit && (
            <button
              type="button"
              onClick={() => setReportLimit((n) => n + 10)}
              className="w-full px-3 py-2 text-caption text-muted-foreground hover:bg-accent"
            >
              加载更多
            </button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
