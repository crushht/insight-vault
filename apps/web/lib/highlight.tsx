import React from "react";

/**
 * 把命中词包成 <mark>。
 *
 * 无 Meilisearch 时搜索走 SQL LIKE，没有服务端高亮，所以在前端做一次：
 * 让用户一眼看到「为什么这条会被搜出来」。
 *
 * 规则：
 * - 大小写不敏感；
 * - 长词优先（避免「向量数据库」被「向量」抢先切碎）；
 * - 最多高亮 20 段，防止超长文本拖慢渲染。
 */
export function highlightText(
  text: string,
  query: string | null | undefined,
): React.ReactNode {
  const q = query?.trim();
  if (!q || q.length < 1) {
    return text;
  }

  // 把查询按空白拆成词，长的排前面
  const terms = q
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .sort((a, b) => b.length - a.length)
    .slice(0, 5)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

  if (terms.length === 0) {
    return text;
  }

  const re = new RegExp(`(${terms.join("|")})`, "gi");
  const parts = text.split(re);
  if (parts.length === 1) {
    return text;
  }

  return (
    <>
      {parts.slice(0, 41).map((part, i) =>
        i % 2 === 1 ? (
          <mark
            key={i}
            className="rounded-sm bg-warning/30 px-0.5 text-foreground"
          >
            {part}
          </mark>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        ),
      )}
    </>
  );
}
