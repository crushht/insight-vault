/**
 * 语义分块（chunking）—— RAG 的前置。
 *
 * 现状：上游把整篇压成 3000 字符 excerpt 做嵌入，长文信息大量丢失，
 * 也无法为回答给出「具体段落」级别的引用。
 *
 * 本模块的目标：
 * - 中文按「段落 → 句末标点（。！？；）」切，英文按段落 → 句子切；
 * - 每块目标 500–800 token，块间重叠约 15%，避免切断上下文；
 * - 保留 `startOffset/endOffset`，让 AI 引用能跳回原文位置。
 *
 * token 为**估算值**（中文 ≈1 token/字，其它 ≈1 token/4 字符），
 * 用于分块决策而非计费。
 */

export interface TextChunk {
  ordinal: number;
  text: string;
  startOffset: number;
  endOffset: number;
  tokenEstimate: number;
}

export interface ChunkOptions {
  /** 单块目标 token 上限，默认 800 */
  maxTokens?: number;
  /** 目标下限，低于它的尾块会尽量并进前一块，默认 200 */
  minTokens?: number;
  /** 块间重叠 token，默认 maxTokens 的 15% */
  overlapTokens?: number;
}

const SENTENCE_END = /[。！？!?；;…]/;
const PARAGRAPH_BREAK = /\n{2,}/;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  let zh = 0;
  let other = 0;
  for (const ch of text) {
    // CJK 统一表意文字 + 中文标点按「一字一 token」估算
    if (/[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef]/.test(ch)) {
      zh++;
    } else {
      other++;
    }
  }
  return Math.ceil(zh + other / 4);
}

interface Segment {
  text: string;
  start: number;
  end: number;
}

/** 把文本切成句子/段级别的原子单元，并记录原文偏移 */
function splitSegments(text: string): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;

  const pushParagraphs = (block: string, base: number) => {
    let localStart = 0;
    // 先在段落内部按句子切
    let sentenceStart = 0;
    for (let i = 0; i < block.length; i++) {
      if (SENTENCE_END.test(block[i])) {
        const piece = block.slice(sentenceStart, i + 1);
        if (piece.trim()) {
          segments.push({
            text: piece,
            start: base + sentenceStart,
            end: base + i + 1,
          });
        }
        sentenceStart = i + 1;
      }
    }
    const tail = block.slice(sentenceStart);
    if (tail.trim()) {
      segments.push({
        text: tail,
        start: base + sentenceStart,
        end: base + block.length,
      });
    }
    localStart = block.length;
    return localStart;
  };

  let idx = 0;
  while (idx < text.length) {
    PARAGRAPH_BREAK.lastIndex = 0;
    const rest = text.slice(idx);
    const m = rest.match(PARAGRAPH_BREAK);
    if (m && m.index !== undefined) {
      const block = text.slice(idx, idx + m.index);
      pushParagraphs(block, idx);
      idx += m.index + m[0].length;
      cursor = idx;
    } else {
      pushParagraphs(text.slice(idx), idx);
      idx = text.length;
      cursor = idx;
    }
  }
  void cursor;
  return segments;
}

export function chunkText(text: string, options: ChunkOptions = {}): TextChunk[] {
  const maxTokens = options.maxTokens ?? 800;
  const minTokens = options.minTokens ?? 200;
  const overlapTokens =
    options.overlapTokens ?? Math.max(1, Math.floor(maxTokens * 0.15));

  const trimmed = text ?? "";
  if (!trimmed.trim()) return [];

  const segments = splitSegments(trimmed);
  if (segments.length === 0) return [];

  const chunks: TextChunk[] = [];
  let current: Segment[] = [];
  let currentTokens = 0;

  const flush = () => {
    if (current.length === 0) return;
    const start = current[0].start;
    const end = current[current.length - 1].end;
    const chunkStr = trimmed.slice(start, end);
    chunks.push({
      ordinal: chunks.length,
      text: chunkStr,
      startOffset: start,
      endOffset: end,
      tokenEstimate: estimateTokens(chunkStr),
    });

    // 用尾部若干段作为下一块的重叠
    if (overlapTokens > 0) {
      const carry: Segment[] = [];
      let carryTokens = 0;
      for (let i = current.length - 1; i >= 0; i--) {
        carryTokens += estimateTokens(current[i].text);
        carry.unshift(current[i]);
        if (carryTokens >= overlapTokens) break;
      }
      current = carry;
      currentTokens = carryTokens;
    } else {
      current = [];
      currentTokens = 0;
    }
  };

  for (const seg of segments) {
    const segTokens = estimateTokens(seg.text);

    // 单段就超上限：硬切
    if (segTokens > maxTokens) {
      flush();
      current = [];
      currentTokens = 0;
      const raw = seg.text;
      const step = Math.max(1, Math.floor(maxTokens * 4)); // 约 maxTokens 个 token 的字符数
      for (let i = 0; i < raw.length; i += step) {
        const piece = raw.slice(i, Math.min(i + step, raw.length));
        const start = seg.start + i;
        const end = seg.start + Math.min(i + step, raw.length);
        chunks.push({
          ordinal: chunks.length,
          text: piece,
          startOffset: start,
          endOffset: end,
          tokenEstimate: estimateTokens(piece),
        });
      }
      continue;
    }

    if (currentTokens + segTokens > maxTokens && current.length > 0) {
      flush();
    }

    current.push(seg);
    currentTokens += segTokens;
  }

  if (current.length > 0) {
    const start = current[0].start;
    const end = current[current.length - 1].end;
    const chunkStr = trimmed.slice(start, end);
    const tokens = estimateTokens(chunkStr);
    // 尾块太短则并入上一块
    if (chunks.length > 0 && tokens < minTokens) {
      const prev = chunks[chunks.length - 1];
      const mergedText = trimmed.slice(prev.startOffset, end);
      prev.text = mergedText;
      prev.endOffset = end;
      prev.tokenEstimate = estimateTokens(mergedText);
    } else {
      chunks.push({
        ordinal: chunks.length,
        text: chunkStr,
        startOffset: start,
        endOffset: end,
        tokenEstimate: tokens,
      });
    }
  }

  return chunks;
}


/**
 * 纯 JS 的内容指纹（FNV-1a 32 位，输出 8 位十六进制）。
 *
 * 不依赖 node:crypto —— 这个包同时被移动端使用，不能引入 Node 内置模块。
 * 用途是「同一段文本是否变化」的快速判断，不用于安全场景。
 */
export function fnv1aHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // FNV prime 16777619，用 Math.imul 保持 32 位乘法
    hash = Math.imul(hash, 0x01000193);
  }
  // >>> 0 转无符号，再用 16 进制补零
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export interface ChunkRecord extends TextChunk {
  /** 内容指纹，用于判断块是否需要重新嵌入 */
  contentHash: string;
}

/**
 * 把正文转成「可直接写入 bookmarkChunks 的记录」。
 *
 * 之所以单独抽出来：worker 只负责取正文与调嵌入，分块 + 指纹的规则
 * 全部收敛在这里，方便单测与将来换切分策略。
 */
export function buildChunkRecords(
  text: string,
  options: ChunkOptions = {},
): ChunkRecord[] {
  return chunkText(text, options).map((chunk) => ({
    ...chunk,
    contentHash: fnv1aHash(`${chunk.ordinal}:${chunk.text}`),
  }));
}
