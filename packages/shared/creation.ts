/**
 * 创作工作台（P6）。
 *
 * 六类产物：文章 / 短视频脚本 / 选题策划 / 学习笔记 / PPT 大纲 / 研究报告。
 *
 * 与专题一样分两条路径：
 * - 有 AI：`buildCreationPrompt` 生成带引用约束的 prompt；
 * - 无 AI：`buildCreationDraft` 输出**骨架 + 可用素材**，用户自己填。
 *
 * 硬约束（写进 system）：只使用用户自己的收藏，且每句事实带 `[n]`。
 */

import { assignCitationNumbers, type RagSource } from "./rag";

export type CreationKind =
  | "article"
  | "video_script"
  | "topic_plan"
  | "study_notes"
  | "ppt_outline"
  | "research_report";

export interface CreationTemplate {
  kind: CreationKind;
  label: string;
  /** 输出结构（章节骨架） */
  sections: string[];
  /** 给模型的额外要求 */
  guidance: string;
}

export const CREATION_TEMPLATES: Record<CreationKind, CreationTemplate> = {
  article: {
    kind: "article",
    label: "文章",
    sections: ["标题", "导语", "正文（分节）", "结论", "参考"],
    guidance: "正文分 3–5 节，每节一个明确论点；避免空话，优先用素材里的具体事实。",
  },
  video_script: {
    kind: "video_script",
    label: "短视频脚本",
    sections: ["镜号", "画面", "台词", "时长"],
    guidance: "以表格形式输出分镜；总时长控制在 60–90 秒；每镜一行。",
  },
  topic_plan: {
    kind: "topic_plan",
    label: "选题策划",
    sections: ["选题", "目标读者", "核心冲突/看点", "素材支撑", "风险"],
    guidance: "给出 5 个候选选题，每个都要说明「素材里有哪些内容能支撑它」。",
  },
  study_notes: {
    kind: "study_notes",
    label: "学习笔记",
    sections: ["概念", "要点", "例子", "疑问"],
    guidance: "用问答式整理；「疑问」里写出资料未覆盖、需要进一步查证的点。",
  },
  ppt_outline: {
    kind: "ppt_outline",
    label: "PPT 大纲",
    sections: ["封面", "目录", "分页要点", "总结页"],
    guidance: "每页给出标题 + 3 条以内的要点；总页数 8–12 页。",
  },
  research_report: {
    kind: "research_report",
    label: "研究报告",
    sections: ["摘要", "背景", "现状", "分歧与空白", "结论", "参考"],
    guidance: "结论必须能被素材支撑；资料不足的部分写进「分歧与空白」，不要猜测。",
  },
};

export interface CreationPrompt {
  system: string;
  user: string;
}

export function buildCreationPrompt(
  kind: CreationKind,
  brief: string,
  sources: RagSource[],
): CreationPrompt {
  const tpl = CREATION_TEMPLATES[kind];
  const numbered = assignCitationNumbers(sources);

  const system = [
    `你是用户的写作助手，任务类型：${tpl.label}。`,
    "铁律：",
    "1) 只使用下面提供的用户资料，不得引入外部知识或编造事实；",
    "2) 每一个事实句后用 [n] 标注来源编号；编号必须来自资料列表；",
    "3) 资料不足以支撑某一部分时，明确写「资料不足」，不要用通顺的废话填满；",
    `4) 输出结构：${tpl.sections.join(" / ")}；`,
    `5) ${tpl.guidance}`,
    "6) 用中文。",
  ].join("\n");

  const context =
    numbered.length === 0
      ? "（无资料）"
      : numbered
          .map((s) => `[${s.n}] ${s.title ? `《${s.title}》` : ""}${s.quote}`)
          .join("\n\n");

  return {
    system,
    user: `需求：${brief}\n\n资料：\n${context}`,
  };
}

/**
 * 无 AI 时的骨架：章节 + 可用素材 + 引用编号，供用户自己填。
 */
export function buildCreationDraft(
  kind: CreationKind,
  brief: string,
  sources: RagSource[],
): string {
  const tpl = CREATION_TEMPLATES[kind];
  const numbered = assignCitationNumbers(sources);

  const lines: string[] = [];
  lines.push(`# ${tpl.label}草稿`);
  lines.push("");
  lines.push(`> 需求：${brief || "（未填写）"}`);
  lines.push("");

  for (const section of tpl.sections) {
    lines.push(`## ${section}`);
    lines.push("");
    lines.push("（待填写）");
    lines.push("");
  }

  lines.push("## 可用素材");
  lines.push("");
  if (numbered.length === 0) {
    lines.push("> 你的收藏里没有相关素材。先收藏几篇，再回来写。");
  } else {
    for (const s of numbered) {
      const excerpt = s.quote.length > 200 ? `${s.quote.slice(0, 200)}…` : s.quote;
      lines.push(`- [${s.n}] ${s.title ? `《${s.title}》` : ""}${excerpt}`);
    }
  }
  lines.push("");
  lines.push("> 这是骨架，不是成稿。配置 AI 模型后可生成完整内容。");

  return lines.join("\n");
}
