import { describe, expect, it } from "vitest";

import { buildChunkRecords, chunkText, estimateTokens, fnv1aHash } from "./chunking";

const ZH_SENTENCE =
  "向量数据库用于存储高维向量并支持相似度检索。它在语义搜索中非常常见。";

describe("estimateTokens", () => {
  it("counts chinese characters roughly one token each", () => {
    expect(estimateTokens("你好世界")).toBe(4);
  });

  it("counts latin text at about four chars per token", () => {
    expect(estimateTokens("abcdefgh")).toBe(2);
  });

  it("returns zero for empty input", () => {
    expect(estimateTokens("")).toBe(0);
  });
});

describe("chunkText", () => {
  it("returns nothing for empty or whitespace input", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n\n  ")).toEqual([]);
  });

  it("keeps a short text in one chunk", () => {
    const chunks = chunkText(ZH_SENTENCE, { maxTokens: 200 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe(ZH_SENTENCE);
    expect(chunks[0].startOffset).toBe(0);
    expect(chunks[0].endOffset).toBe(ZH_SENTENCE.length);
    expect(chunks[0].ordinal).toBe(0);
  });

  it("splits long text into several chunks under the token cap", () => {
    const text = Array.from({ length: 40 }, () => ZH_SENTENCE).join("\n\n");
    const chunks = chunkText(text, { maxTokens: 120, overlapTokens: 20 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.tokenEstimate).toBeLessThanOrEqual(140);
      expect(c.text.length).toBeGreaterThan(0);
    }
  });

  it("offsets point back into the original text", () => {
    const text = Array.from({ length: 20 }, () => ZH_SENTENCE).join("\n\n");
    const chunks = chunkText(text, { maxTokens: 120 });
    for (const c of chunks) {
      expect(text.slice(c.startOffset, c.endOffset)).toBe(c.text);
    }
  });

  it("produces overlapping windows", () => {
    const text = Array.from({ length: 30 }, () => ZH_SENTENCE).join("\n\n");
    const chunks = chunkText(text, { maxTokens: 100, overlapTokens: 30 });
    let overlapped = false;
    for (let i = 1; i < chunks.length; i++) {
      if (chunks[i].startOffset < chunks[i - 1].endOffset) overlapped = true;
    }
    expect(overlapped).toBe(true);
  });

  it("hard-splits a single very long segment", () => {
    const text = "字".repeat(5000);
    const chunks = chunkText(text, { maxTokens: 100 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.text.length).toBeGreaterThan(0);
    }
  });

  it("merges a tiny tail into the previous chunk", () => {
    const text =
      Array.from({ length: 12 }, () => ZH_SENTENCE).join("\n\n") + "\n\n短";
    const chunks = chunkText(text, { maxTokens: 120, minTokens: 100 });
    expect(chunks[chunks.length - 1].text.endsWith("短")).toBe(true);
  });

  it("numbers chunks consecutively from zero", () => {
    const text = Array.from({ length: 25 }, () => ZH_SENTENCE).join("\n\n");
    const chunks = chunkText(text, { maxTokens: 100 });
    chunks.forEach((c, i) => expect(c.ordinal).toBe(i));
  });
});


describe("fnv1aHash", () => {
  it("is stable for the same input", () => {
    expect(fnv1aHash("hello world")).toBe(fnv1aHash("hello world"));
  });

  it("differs for different inputs", () => {
    expect(fnv1aHash("hello world")).not.toBe(fnv1aHash("hello worlD"));
  });

  it("returns 8 hex chars", () => {
    expect(fnv1aHash("任何文本")).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("buildChunkRecords", () => {
  it("keeps the same chunk boundaries as chunkText", () => {
    const text = Array.from({ length: 20 }, () => ZH_SENTENCE).join("\n\n");
    const chunks = chunkText(text, { maxTokens: 120 });
    const records = buildChunkRecords(text, { maxTokens: 120 });
    expect(records.map((r) => r.text)).toEqual(chunks.map((c) => c.text));
    expect(records.map((r) => r.startOffset)).toEqual(
      chunks.map((c) => c.startOffset),
    );
  });

  it("gives every record a content hash", () => {
    const records = buildChunkRecords(ZH_SENTENCE);
    expect(records).toHaveLength(1);
    expect(records[0].contentHash).toMatch(/^[0-9a-f]{8}$/);
  });

  it("is deterministic across calls", () => {
    const a = buildChunkRecords(ZH_SENTENCE);
    const b = buildChunkRecords(ZH_SENTENCE);
    expect(a[0].contentHash).toBe(b[0].contentHash);
  });

  it("changes the hash when the text changes", () => {
    const a = buildChunkRecords(ZH_SENTENCE);
    const b = buildChunkRecords(ZH_SENTENCE + "补充一句。");
    expect(a[0].contentHash).not.toBe(b[0].contentHash);
  });

  it("returns nothing for empty text", () => {
    expect(buildChunkRecords("")).toEqual([]);
  });
});
