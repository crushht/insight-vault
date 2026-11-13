"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import Markdown from "react-markdown";
import { ArrowLeft, BookOpen, MessageSquare, Sparkles } from "lucide-react";

import { useTRPC } from "@karakeep/shared-react/trpc";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * 阅读工作台（P6）。
 *
 * 左侧正文、右侧 AI 面板。与上游的 `/dashboard/preview` 区别：
 * 这里专注「读」——更大的正文区、更少的元数据、AI 入口就在手边。
 */
export default function ReadPage() {
  const params = useParams<{ bookmarkId: string }>();
  const bookmarkId = params.bookmarkId;
  const api = useTRPC();

  const bookmark = useQuery(
    api.bookmarks.getBookmark.queryOptions({
      bookmarkId,
      includeContent: true,
    }),
  );

  const data = bookmark.data;
  const isLink = data?.content?.type === "link";
  const isText = data?.content?.type === "text";
  // htmlContent 只在 includeContent:true 时返回，类型上是可选字段
  const html = isLink
    ? (data?.content as { htmlContent?: string | null } | undefined)?.htmlContent
    : undefined;
  const noteText = isText
    ? (data?.content as { text?: string } | undefined)?.text
    : undefined;
  const summary = data?.summary;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 lg:flex-row">
      {/* 正文 */}
      <Card className="min-w-0 flex-1">
        <CardHeader className="border-b border-border py-3">
          <div className="flex items-center gap-2">
            <Link
              href="/dashboard/bookmarks"
              className="text-muted-foreground transition-colors hover:text-foreground"
              aria-label="返回收藏库"
            >
              <ArrowLeft className="size-4" />
            </Link>
            <BookOpen className="size-4 text-brand-600" />
            <CardTitle className="truncate text-body">
              {data?.title ?? "加载中…"}
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          {bookmark.isLoading && (
            <div className="space-y-2">
              <div className="h-4 w-2/3 animate-pulse rounded bg-surface-sunken" />
              <div className="h-4 w-full animate-pulse rounded bg-surface-sunken" />
              <div className="h-4 w-5/6 animate-pulse rounded bg-surface-sunken" />
            </div>
          )}
          {bookmark.isError && (
            <p className="text-body text-destructive">
              加载失败：{String((bookmark.error as { message?: string })?.message ?? "")}
            </p>
          )}
          {noteText ? (
            <div className="prose prose-sm max-w-none dark:prose-invert">
              <Markdown>{noteText}</Markdown>
            </div>
          ) : null}
          {data && !html && !noteText && (
            <p className="text-body text-muted-foreground">
              这条收藏没有可提取的正文（可能是纯链接、图片或尚未抓取完成）。
            </p>
          )}
          {html && (
            <div
              className="prose prose-sm max-w-none dark:prose-invert"
              // 正文在上游抓取时已过 DOMPurify；这里直接渲染
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}
        </CardContent>
      </Card>

      {/* AI 面板 */}
      <aside className="w-full shrink-0 space-y-4 lg:w-80">
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="flex items-center gap-2 text-body">
              <Sparkles className="size-4 text-brand-600" />
              AI 摘要
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {summary ? (
              <p className="whitespace-pre-wrap text-body leading-relaxed">
                {summary}
              </p>
            ) : (
              <p className="text-caption text-muted-foreground">
                还没有摘要。抓取完成后会自动生成（需要配置 AI 模型）。
              </p>
            )}
            <Link
              href="/dashboard/chat"
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-label transition-colors hover:border-border-strong"
            >
              <MessageSquare className="size-3.5" />
              用我的收藏提问
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-body">这条收藏</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-caption text-muted-foreground">
            <p>类型：{data?.content?.type ?? "—"}</p>
            <p>
              保存于：
              {data?.createdAt
                ? new Date(data.createdAt).toLocaleString("zh-CN")
                : "—"}
            </p>
            {data?.tags?.length ? (
              <p className="flex flex-wrap gap-1">
                标签：
                {data.tags.map((tg) => (
                  <span
                    key={tg.id}
                    className="rounded-full bg-surface-sunken px-2 py-0.5"
                  >
                    {tg.name}
                  </span>
                ))}
              </p>
            ) : null}
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
