/**
 * 规则型实体抽取（P6 的「无 AI 也能工作」的底座）。
 *
 * 为什么先做规则：
 * - 没有配置 AI 的部署也应该有图谱，哪怕是粗粒度的；
 * - 规则层的结果可以作为 LLM 抽取的**校验**（LLM 抽出的实体若在文本里找不到，直接丢弃）；
 * - 纯函数、可单测，不依赖网络。
 *
 * 抽到的类型：person / place / org / product / tech / concept / topic。
 * 宁可少抽，不乱抽——错误实体会污染图谱，而漏抽只是少一条边。
 */

export type EntityKind =
  | "person"
  | "place"
  | "org"
  | "product"
  | "tech"
  | "concept"
  | "topic";

export interface ExtractedEntity {
  name: string;
  normalizedName: string;
  kind: EntityKind;
  /** 首次出现处的上下文片段，便于回跳与人工校验 */
  quote: string;
}

/** 全角转半角 + 折叠空白 + 英文小写，用于判重 */
export function normalizeEntityName(name: string): string {
  const halfWidth = name
    .replace(/[\uff01-\uff5e]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
    )
    .replace(/\u3000/g, " ");
  return halfWidth.trim().replace(/\s+/g, " ").toLowerCase();
}

const ORG_SUFFIX = /(有限公司|股份有限公司|集团|大学|学院|研究院|研究所|实验室|基金会|委员会|科技|工作室|团队)$/;
const PLACE_SUFFIX = /(省|市|县|区|镇|村|街道|自治区|特别行政区)$/;
const TECH_KEYWORDS = [
  "SQL",
  "HTTP",
  "HTTPS",
  "API",
  "RAG",
  "LLM",
  "GPU",
  "CPU",
  "SQLite",
  "Postgres",
  "Redis",
  "Docker",
  "Kubernetes",
  "React",
  "Next.js",
  "Node.js",
  "TypeScript",
  "Python",
  "Rust",
  "Go",
  "Java",
  "向量数据库",
  "嵌入",
  "分词",
  "索引",
  "知识图谱",
];

function quoteAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 12);
  const end = Math.min(text.length, index + length + 12);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

export function extractEntities(text: string): ExtractedEntity[] {
  const found = new Map<string, ExtractedEntity>();

  const push = (rawName: string, kind: EntityKind, index: number) => {
    const name = rawName.trim().replace(/\s+/g, " ");
    if (name.length < 2 || name.length > 40) return;
    const normalizedName = normalizeEntityName(name);
    if (!normalizedName) return;
    if (found.has(`${kind}:${normalizedName}`)) return;
    found.set(`${kind}:${normalizedName}`, {
      name,
      normalizedName,
      kind,
      quote: quoteAround(text, index, name.length),
    });
  };

  // 1) 《书名号》→ concept
  for (const m of text.matchAll(/《([^》]{2,40})》/g)) {
    push(m[1], "concept", m.index ?? 0);
  }

  // 2) 中文引号「」与英文双引号 → concept
  for (const m of text.matchAll(/[「“"]([^」”"]{2,30})[」”"]/g)) {
    push(m[1], "concept", m.index ?? 0);
  }

  // 3) 机构/地点后缀
  for (const m of text.matchAll(/[\u4e00-\u9fff]{2,20}(?:有限公司|大学|学院|研究院|研究所|实验室|集团)/g)) {
    push(m[0], "org", m.index ?? 0);
  }
  for (const m of text.matchAll(/[\u4e00-\u9fff]{2,10}(?:省|市|县|自治区)/g)) {
    push(m[0], "place", m.index ?? 0);
  }

  // 4) 英文技术词（保持原大小写，判重用归一化）
  for (const kw of TECH_KEYWORDS) {
    const idx = text.indexOf(kw);
    if (idx >= 0) push(kw, "tech", idx);
  }

  // 5) 「X 是一种 / 是一款 / 指的是」→ concept
  for (const m of text.matchAll(/([\u4e00-\u9fffA-Za-z0-9\-]{2,20})\s*(?:是一种|是一款|指的是|是一个)/g)) {
    push(m[1], "concept", m.index ?? 0);
  }

  // 6) 英文大写短语（2 个词以上）→ product
  for (const m of text.matchAll(/\b([A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+)+)\b/g)) {
    push(m[1], "product", m.index ?? 0);
  }

  return [...found.values()];
}

/**
 * 同一段文字里共现的实体 → 生成 `related_to` 关系候选。
 * 只做「同句共现」这一条最保守的规则。
 */
export function extractCooccurrenceRelations(
  text: string,
  entities: ExtractedEntity[],
): { from: string; to: string; relation: string }[] {
  const out: { from: string; to: string; relation: string }[] = [];
  const sentences = text.split(/[。！？!?；;\n]+/).filter((s) => s.trim());

  for (const sentence of sentences) {
    const present = entities.filter((e) => sentence.includes(e.name));
    for (let i = 0; i < present.length; i++) {
      for (let j = i + 1; j < present.length; j++) {
        out.push({
          from: present[i].normalizedName,
          to: present[j].normalizedName,
          relation: "co_occurs",
        });
      }
    }
  }
  return out;
}
