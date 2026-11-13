import type { Metadata } from "next";
import Link from "next/link";

import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: `离线 | ${BRAND.nameZh}`,
};

/**
 * 离线兜底页。Service Worker 在导航失败且没有缓存副本时返回它，
 * 所以这里必须是**静态**的（不读 session、不发请求）。
 */
export default function OfflinePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-brand-50 text-2xl">
        ⚡
      </div>
      <h1 className="text-h3 font-semibold text-foreground">当前是离线状态</h1>
      <p className="max-w-md text-body leading-relaxed text-muted-foreground">
        灵感仓正在本地运行，但网络请求没有成功。已经打开过的页面会从缓存里恢复；
        新的收藏、AI 回答需要联网。
      </p>
      <div className="flex gap-2">
        <Link
          href="/dashboard/bookmarks"
          className="rounded-lg bg-brand-600 px-4 py-2 text-label text-white"
        >
          打开缓存里的收藏库
        </Link>
        <Link
          href="/"
          className="rounded-lg border border-border px-4 py-2 text-label text-foreground"
        >
          回首页
        </Link>
      </div>
      <p className="text-caption text-muted-foreground">
        网络恢复后刷新本页即可。
      </p>
    </main>
  );
}
