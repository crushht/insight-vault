/**
 * 智能专题（P6）。
 *
 * 输入：一个研究主题 + 从收藏里检索到的片段。
 * 输出：一份结构化草稿（Markdown）。
 *
 * 两条路径：
 * 1. **有 AI**：拼 prompt 让模型生成带引用的报告（`buildTopicPrompt`）；
 * 2. **无 AI**：用 `buildTopicDraft` 产出**确定性草稿** —— 资料清单 + 编号引用 + 待补充项。
 *    它不假装是结论，但已经把「我有哪些素材」摊开，用户可以直接拿去写。
 */

import { assignCitationNumbers, type RagSource } from "./rag";

export interface TopicDraftOptions {
  /** 每个来源最多展示多少字 */
  excerptChars?: number;
}

/** 无 AI 时的确定性草稿：资料清单 + 引用编号 + 待补充 */
export function buildTopicDraft(
  topic: string,
  sources: RagSource[],
  options: TopicDraftOptions = {},
): string {
  const excerptChars = options.excerptChars ?? 160;
  const numbered = assignCitationNumbers(sources);

  const lines: string[] = [];
  lines.push(`# 专题：${topic.trim() || "（未命名）"}`);
  lines.push("");

  if (numbered.length === 0) {
    lines.push("> 你的收藏里没有与该主题相关的资料。");
    lines.push("");
    lines.push("建议：先收藏几篇相关资料，再回来生成专题。");
    return lines.join("\n");
  }

  // 按收藏分组，保留首次出现的编号
  const groups = new Map<string, { title?: string; items: typeof numbered }>();
  for (const s of numbered) {
    const key = s.bookmarkId;
    const g = groups.get(key) ?? { title: s.title, items: [] };
    g.items.push(s);
    groups.set(key, g);
  }

  lines.push("## 资料概览");
  lines.push("");
  lines.push(`共 ${groups.size} 条收藏、${numbered.length} 个相关片段。`);
  lines.push("");
  for (const [bookmarkId, g] of groups) {
    const nums = g.items.map((i) => `[${i.n}]`).join(" ");
    lines.push(`- ${g.title ? `《${g.title}》` : bookmarkId} ${nums}`);
  }
  lines.push("");

  lines.push("## 关键片段");
  lines.push("");
  for (const s of numbered) {
    const excerpt =
      s.quote.length > excerptChars
        ? `${s.quote.slice(0, excerptChars)}…`
        : s.quote;
    lines.push(`[${s.n}] ${excerpt}`);
    lines.push("");
  }

  lines.push("## 待补充");
  lines.push("");
  lines.push("- 结论与脉络需要 AI 模型生成（当前未配置或未启用）。");
  lines.push("- 可以手动把上面的片段整理成提纲，引用编号可直接对应原文。");
  return lines.join("\n");
}

/**
 * 有 AI 时的 prompt：要求输出带 `[n]` 引用的结构化报告。
 */
export function buildTopicPrompt(
  topic: string,
  sources: RagSource[],
): { system: string; user: string } {
  const numbered = assignCitationNumbers(sources);

  const system = [
    "你是一个研究助理，负责把用户自己的收藏整理成专题报告。",
    "要求：",
    "1) 只使用给定资料，不得引入外部知识；",
    "2) 用 Markdown 输出，结构为：概述 / 主要观点 / 分歧或空白 / 参考；",
    "3) 每一个事实句用 [n] 标注来源，编号必须来自资料列表；",
    "4) 资料不足以支撑结论时，在「分歧或空白」里明确写出来，不要编造；",
    "5) 用中文，简洁。",
  ].join("\n");

  const context =
    numbered.length === 0
      ? "（无资料）"
      : numbered
          .map((s) => `[${s.n}] ${s.title ? `《${s.title}》` : ""}${s.quote}`)
          .join("\n\n");

  return {
    system,
    user: `主题：${topic}\n\n资料：\n${context}`,
  };
}
