/**
 * RAG 的「拼装层」—— 纯函数，不碰网络与数据库。
 *
 * 职责：
 * - 给检索到的片段分配稳定的引用编号（`[1] [2] …`）；
 * - 把片段拼成带编号的上下文，供模型引用；
 * - 生成 system 指令，明确要求「只用给定资料」「无依据就直说」。
 *
 * 这样 worker / 路由 / 前端都能复用同一套编号规则，引用不会错位。
 */

export interface RagSource {
  bookmarkId: string;
  chunkId?: string;
  title?: string;
  /** 片段原文（引用时展示给用户的那段） */
  quote: string;
}

export interface NumberedSource extends RagSource {
  /** 从 1 开始的引用编号 */
  n: number;
}

/** 按 (bookmarkId, chunkId) 去重，并分配 1..N 的编号 */
export function assignCitationNumbers(sources: RagSource[]): NumberedSource[] {
  const seen = new Set<string>();
  const out: NumberedSource[] = [];
  for (const s of sources) {
    const key = `${s.bookmarkId}::${s.chunkId ?? s.quote.slice(0, 32)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...s, n: out.length + 1 });
  }
  return out;
}

export interface RagPrompt {
  system: string;
  user: string;
}

export const NO_CONTEXT_ANSWER = "你的收藏里没有相关内容。";

export function buildRagPrompt(
  question: string,
  sources: RagSource[],
): RagPrompt {
  const numbered = assignCitationNumbers(sources);

  const system = [
    "你是一个个人知识库助手。回答必须遵守：",
    "1) 只使用下面提供的用户资料，不得引入外部知识；",
    "2) 每一个事实句后面用 [n] 标注来源编号，编号必须来自资料列表；",
    "3) 如果资料不足以回答，直接说「" + NO_CONTEXT_ANSWER + "」，不要猜测；",
    "4) 用中文回答，简洁、具体。",
  ].join("\n");

  if (numbered.length === 0) {
    return {
      system,
      user: `问题：${question}\n\n资料：（无）`,
    };
  }

  const context = numbered
    .map((s) => {
      const title = s.title ? `《${s.title}》` : "";
      return `[${s.n}] ${title}${s.quote}`;
    })
    .join("\n\n");

  return {
    system,
    user: `问题：${question}\n\n资料：\n${context}`,
  };
}

/** 从模型输出里抽出引用编号（用于校验模型没有编造来源） */
export function extractCitationNumbers(answer: string): number[] {
  const found = new Set<number>();
  const re = /\[(\d{1,3})\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(answer)) !== null) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0) found.add(n);
  }
  return [...found].sort((a, b) => a - b);
}

/** 校验回答中的编号是否都在给定来源范围内 */
export function validateCitations(
  answer: string,
  sources: RagSource[],
): { ok: boolean; invalid: number[] } {
  const max = assignCitationNumbers(sources).length;
  const invalid = extractCitationNumbers(answer).filter((n) => n > max);
  return { ok: invalid.length === 0, invalid };
}
