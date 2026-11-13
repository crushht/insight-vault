/**
 * 把回答里的 `[n]` 拆成「文本段 + 引用段」，供前端渲染成可点击的上标。
 *
 * 放在 lib 里而不是组件里，是因为这段解析要能单测：
 * 引用编号一旦渲染错位，用户点进去看到的就是另一条收藏。
 */

export interface CitationInput {
  n: number;
  bookmarkId: string;
}

export interface CitationSegment {
  /** 文本片段；引用段时为空串 */
  text: string;
  /** 引用编号（引用段才有） */
  n?: number;
  /** 对应的收藏 id（找不到映射时为空，前端渲染成纯文本） */
  bookmarkId?: string;
}

const CITATION_RE = /\[(\d{1,3})\]/g;

export function splitCitations(
  content: string,
  citations: CitationInput[],
): CitationSegment[] {
  const byN = new Map(citations.map((c) => [c.n, c.bookmarkId]));
  const segments: CitationSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  CITATION_RE.lastIndex = 0;
  while ((match = CITATION_RE.exec(content)) !== null) {
    const [raw, numStr] = match;
    const n = Number(numStr);
    const bookmarkId = byN.get(n);

    if (match.index > lastIndex) {
      segments.push({ text: content.slice(lastIndex, match.index) });
    }

    if (bookmarkId) {
      segments.push({ text: "", n, bookmarkId });
    } else {
      // 未知编号（模型编的，或引用列表被裁剪）：原样保留，不做成链接
      segments.push({ text: raw });
    }
    lastIndex = match.index + raw.length;
  }

  if (lastIndex < content.length) {
    segments.push({ text: content.slice(lastIndex) });
  }

  return segments;
}
