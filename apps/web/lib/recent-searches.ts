/**
 * 搜索历史（只存本机，不上传）。
 *
 * 纯函数，方便单测；localStorage 由调用方注入，SSR / 隐私模式下取不到就返回空。
 */

export const RECENT_SEARCH_KEY = "iv.recentSearches";
export const MAX_RECENT_SEARCHES = 8;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function parseRecentSearches(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.trim())
      .filter((v) => v.length > 0)
      .slice(0, MAX_RECENT_SEARCHES);
  } catch {
    return [];
  }
}

export function pushRecentSearch(list: string[], query: string): string[] {
  const q = query.trim();
  if (!q) return list;
  const next = [q, ...list.filter((v) => v !== q)];
  return next.slice(0, MAX_RECENT_SEARCHES);
}

export function loadRecentSearches(storage: StorageLike | null): string[] {
  if (!storage) return [];
  try {
    return parseRecentSearches(storage.getItem(RECENT_SEARCH_KEY));
  } catch {
    return [];
  }
}

export function saveRecentSearches(
  storage: StorageLike | null,
  list: string[],
): void {
  if (!storage) return;
  try {
    storage.setItem(RECENT_SEARCH_KEY, JSON.stringify(list));
  } catch {
    // 配额满 / 隐私模式，忽略
  }
}

/** 记录一次搜索，返回更新后的列表。 */
export function recordRecentSearch(
  storage: StorageLike | null,
  query: string,
): string[] {
  const next = pushRecentSearch(loadRecentSearches(storage), query);
  saveRecentSearches(storage, next);
  return next;
}
