import { describe, expect, it } from "vitest";

import {
  assignCitationNumbers,
  buildRagPrompt,
  extractCitationNumbers,
  NO_CONTEXT_ANSWER,
  validateCitations,
} from "./rag";

const A = { bookmarkId: "b1", chunkId: "c1", title: "文章一", quote: "向量数据库用于相似度检索。" };
const B = { bookmarkId: "b2", chunkId: "c9", title: "文章二", quote: "HNSW 是一种近似最近邻算法。" };

describe("assignCitationNumbers", () => {
  it("numbers from 1 in order", () => {
    const out = assignCitationNumbers([A, B]);
    expect(out.map((s) => s.n)).toEqual([1, 2]);
  });

  it("deduplicates by bookmark + chunk", () => {
    const out = assignCitationNumbers([A, A, B]);
    expect(out).toHaveLength(2);
    expect(out.map((s) => s.bookmarkId)).toEqual(["b1", "b2"]);
  });

  it("falls back to quote prefix when chunkId is missing", () => {
    const noChunk = { bookmarkId: "b3", quote: "同一段话" };
    const out = assignCitationNumbers([noChunk, { ...noChunk }]);
    expect(out).toHaveLength(1);
  });

  it("returns empty for empty input", () => {
    expect(assignCitationNumbers([])).toEqual([]);
  });
});

describe("buildRagPrompt", () => {
  it("includes every source with its number", () => {
    const { user } = buildRagPrompt("向量检索怎么选型？", [A, B]);
    expect(user).toContain("[1]");
    expect(user).toContain("[2]");
    expect(user).toContain("向量数据库用于相似度检索。");
    expect(user).toContain("HNSW 是一种近似最近邻算法。");
    expect(user).toContain("向量检索怎么选型？");
  });

  it("tells the model to admit missing context", () => {
    const { system } = buildRagPrompt("x", []);
    expect(system).toContain(NO_CONTEXT_ANSWER);
  });

  it("marks the context as empty when there are no sources", () => {
    const { user } = buildRagPrompt("任意问题", []);
    expect(user).toContain("（无）");
  });

  it("includes the title when present", () => {
    const { user } = buildRagPrompt("q", [A]);
    expect(user).toContain("《文章一》");
  });
});

describe("extractCitationNumbers", () => {
  it("collects unique numbers in ascending order", () => {
    expect(extractCitationNumbers("结论 [2] 与 [1]，又见 [2]。")).toEqual([1, 2]);
  });

  it("ignores bracketed text that is not a number", () => {
    expect(extractCitationNumbers("见 [abc] 与 [0]")).toEqual([]);
  });

  it("returns empty when there is no citation", () => {
    expect(extractCitationNumbers("没有引用")).toEqual([]);
  });
});

describe("validateCitations", () => {
  it("accepts citations within range", () => {
    expect(validateCitations("答案 [1][2]", [A, B])).toEqual({ ok: true, invalid: [] });
  });

  it("flags citations beyond the source count", () => {
    const res = validateCitations("答案 [3]", [A, B]);
    expect(res.ok).toBe(false);
    expect(res.invalid).toEqual([3]);
  });
});
