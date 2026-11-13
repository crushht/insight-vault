"use client";

import Link from "next/link";
import { Bookmark, Link2, Sparkles, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n/client";

/**
 * 空状态。两种形态：
 * - 默认：整页空（没有任何收藏时），给三步上手引导
 * - compact：编辑器卡片下方的轻量提示（新用户在收藏页时）
 * 全部使用语义 token，不写死颜色。
 */

const STEPS = [
  {
    icon: Link2,
    title: "粘贴一条链接",
    desc: "用上方「新项目」框，⌘/Ctrl + E 直接聚焦；拖入图片也行",
    href: null,
  },
  {
    icon: Upload,
    title: "把旧收藏搬过来",
    desc: "支持浏览器书签、Raindrop、Pocket 等 11 种格式",
    href: "/settings/import",
  },
  {
    icon: Sparkles,
    title: "配好 AI 模型",
    desc: "自动打标签、摘要、带引用的对话检索（也可以先不配）",
    href: "/settings/ai",
  },
] as const;

export default function NoBookmarksBanner({
  compact = false,
}: {
  compact?: boolean;
}) {
  const { t } = useTranslation();

  if (compact) {
    return (
      <div className="mt-8 flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-10 text-center">
        <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-brand-50">
          <Bookmark className="size-6 text-brand-600" strokeWidth={1.5} />
        </div>
        <h3 className="mb-1.5 text-h4 text-foreground">
          {t("banners.no_bookmarks.title")}
        </h3>
        <p className="max-w-md text-body text-muted-foreground">
          {t("banners.no_bookmarks.description")}
        </p>
        <p className="mt-3 text-caption text-muted-foreground/80">
          粘贴链接 · 拖入图片 · 直接写笔记
        </p>

        <ol className="mt-6 grid w-full max-w-xl gap-2 text-left sm:grid-cols-3">
          {STEPS.map((step, index) => {
            const Icon = step.icon;
            const inner = (
              <>
                <span className="mb-1 flex items-center gap-1.5">
                  <span className="flex size-5 items-center justify-center rounded-full bg-brand-600 text-[11px] font-semibold text-white">
                    {index + 1}
                  </span>
                  <Icon className="size-3.5 text-brand-600" />
                  <span className="text-label font-medium text-foreground">
                    {step.title}
                  </span>
                </span>
                <span className="block text-caption leading-relaxed text-muted-foreground">
                  {step.desc}
                </span>
              </>
            );
            return (
              <li
                key={step.title}
                className="rounded-lg border border-border bg-background px-3 py-2"
              >
                {step.href ? (
                  <Link href={step.href} className="block hover:text-brand-600">
                    {inner}
                  </Link>
                ) : (
                  inner
                )}
              </li>
            );
          })}
        </ol>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-border bg-surface-raised px-8 py-14 text-center shadow-e1">
      <div className="mb-5 flex size-16 items-center justify-center rounded-full bg-brand-50">
        <Bookmark className="size-8 text-brand-600" strokeWidth={1.5} />
      </div>
      <h2 className="mb-2 text-h3 font-semibold text-foreground">
        {t("banners.no_bookmarks.title")}
      </h2>
      <p className="mb-8 max-w-md text-body text-muted-foreground">
        {t("banners.no_bookmarks.description")}
      </p>

      <ol className="mb-8 grid w-full max-w-2xl gap-3 text-left sm:grid-cols-3">
        {STEPS.map((step, index) => {
          const Icon = step.icon;
          const body = (
            <>
              <div className="mb-2 flex items-center gap-2">
                <span className="flex size-6 items-center justify-center rounded-full bg-brand-600 text-caption font-semibold text-white">
                  {index + 1}
                </span>
                <Icon className="size-4 text-brand-600" />
                <span className="text-label font-medium text-foreground">
                  {step.title}
                </span>
              </div>
              <p className="text-caption leading-relaxed text-muted-foreground">
                {step.desc}
              </p>
            </>
          );
          const className =
            "rounded-xl border border-border bg-background px-4 py-3 transition-colors";
          return (
            <li key={step.title}>
              {step.href ? (
                <Link
                  href={step.href}
                  className={`${className} block hover:border-brand-400`}
                >
                  {body}
                </Link>
              ) : (
                <div className={className}>{body}</div>
              )}
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button asChild>
          <Link href="/settings/ai">去配置 AI 模型</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/settings/import">导入已有书签</Link>
        </Button>
      </div>
    </div>
  );
}
