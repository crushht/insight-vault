"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

import { SearchQueryProvider } from "@/lib/search-query-context";

function Bridge({ children }: { children: React.ReactNode }) {
  const q = useSearchParams().get("q");
  return <SearchQueryProvider value={q}>{children}</SearchQueryProvider>;
}

/**
 * 把 URL 里的搜索词读一次，往下发。
 *
 * 用 Suspense 包住是 Next 的硬要求：`useSearchParams()` 在未包 Suspense 的
 * client 组件里会触发整页 CSR bailout —— 表现为「页面闪一下」。
 */
export function SearchQueryBridge({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={children}>
      <Bridge>{children}</Bridge>
    </Suspense>
  );
}
