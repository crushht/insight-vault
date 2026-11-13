"use client";

import { createContext, useContext } from "react";

/**
 * 搜索命中的关键词，由 dashboard layout 读一次、往下发。
 *
 * 为什么不用 `useSearchParams()` 直接在每个卡片里读：
 * 收藏列表里有几十上百张卡片，每张都订阅一次路由变化 ——
 * 任何 URL 抖动都会让全部卡片重渲染，界面看起来就是「一直在闪」。
 *
 * 这里只读一次，卡片通过 context 拿字符串，渲染开销降到最低。
 */
const SearchQueryContext = createContext<string | null>(null);

export function SearchQueryProvider({
  value,
  children,
}: {
  value: string | null;
  children: React.ReactNode;
}) {
  return (
    <SearchQueryContext.Provider value={value}>
      {children}
    </SearchQueryContext.Provider>
  );
}

export function useSearchQuery(): string | null {
  return useContext(SearchQueryContext);
}
