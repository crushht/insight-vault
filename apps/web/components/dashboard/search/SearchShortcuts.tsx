"use client";

import Link from "next/link";
import { Clock, Sparkles, Trash2 } from "lucide-react";

/**
 * 搜索页的空查询状态：给几个能直接点的查询示例 + 本机搜索历史。
 * 目的是让「不知道怎么搜」的用户第一次就能拿到结果。
 */

const EXAMPLES: { label: string; query: string }[] = [
  { label: "图片", query: "is:image" },
  { label: "视频", query: "is:video" },
  { label: "PDF", query: "is:pdf" },
  { label: "我收藏的", query: "is:fav" },
  { label: "有高亮的", query: "has:highlights" },
  { label: "还没看完的链接", query: "is:link -is:archived" },
];

function href(query: string) {
  return `/dashboard/search?q=${encodeURIComponent(query)}`;
}

export function SearchShortcuts({
  recent,
  onClearRecent,
}: {
  recent: string[];
  onClearRecent: () => void;
}) {
  return (
    <div className="mb-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1 text-caption text-muted-foreground">
          <Sparkles className="size-3.5" />
          试试
        </span>
        {EXAMPLES.map((e) => (
          <Link
            key={e.query}
            href={href(e.query)}
            className="rounded-full border border-border px-3 py-1 text-caption text-muted-foreground transition-colors hover:border-brand-400 hover:text-brand-600"
          >
            {e.label}
          </Link>
        ))}
      </div>

      {recent.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1 text-caption text-muted-foreground">
            <Clock className="size-3.5" />
            最近
          </span>
          {recent.map((q) => (
            <Link
              key={q}
              href={href(q)}
              className="rounded-full bg-surface-sunken px-3 py-1 text-caption text-foreground/80 transition-colors hover:text-brand-600"
            >
              {q.length > 28 ? `${q.slice(0, 28)}…` : q}
            </Link>
          ))}
          <button
            type="button"
            onClick={onClearRecent}
            className="flex items-center gap-1 rounded-full px-2 py-1 text-caption text-muted-foreground transition-colors hover:text-destructive"
            aria-label="清空搜索历史"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
