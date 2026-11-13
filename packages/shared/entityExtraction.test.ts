import { describe, expect, it } from "vitest";

import {
  extractCooccurrenceRelations,
  extractEntities,
  normalizeEntityName,
} from "./entityExtraction";

describe("normalizeEntityName", () => {
  it("lowercases latin and collapses spaces", () => {
    expect(normalizeEntityName("  Vector   Database ")).toBe("vector database");
  });

  it("converts full-width characters", () => {
    expect(normalizeEntityName("ＡＰＩ")).toBe("api");
  });

  it("keeps chinese as-is", () => {
    expect(normalizeEntityName("向量数据库")).toBe("向量数据库");
  });
});

describe("extractEntities", () => {
  it("extracts book-titled concepts", () => {
    const out = extractEntities("我读过《深入理解计算机系统》，很有收获。");
    expect(out.map((e) => e.name)).toContain("深入理解计算机系统");
    expect(out.find((e) => e.name === "深入理解计算机系统")?.kind).toBe("concept");
  });

  it("extracts quoted concepts", () => {
    const out = extractEntities("这篇文章讲了「语义分块」的做法。");
    expect(out.map((e) => e.name)).toContain("语义分块");
  });

  it("extracts organizations by suffix", () => {
    const out = extractEntities("他在清华大学做研究，也在阿里巴巴集团工作。");
    const names = out.map((e) => e.name);
    expect(names.some((n) => n.includes("大学"))).toBe(true);
    expect(names.some((n) => n.includes("集团"))).toBe(true);
  });

  it("extracts places by suffix", () => {
    const out = extractEntities("项目落地在浙江省杭州市。");
    expect(out.some((e) => e.kind === "place")).toBe(true);
  });

  it("extracts tech keywords", () => {
    const out = extractEntities("我们用 TypeScript 和 React 写了前端，后端是 Go。");
    const names = out.filter((e) => e.kind === "tech").map((e) => e.name);
    expect(names).toContain("TypeScript");
    expect(names).toContain("React");
    expect(names).toContain("Go");
  });

  it("extracts definition patterns as concepts", () => {
    const out = extractEntities("HNSW 是一种近似最近邻算法。");
    expect(out.some((e) => e.name.includes("HNSW"))).toBe(true);
  });

  it("deduplicates by kind and normalized name", () => {
    const out = extractEntities("React 很好用。另一处又提到 React 和 react。");
    const tech = out.filter((e) => e.normalizedName === "react");
    expect(tech).toHaveLength(1);
  });

  it("ignores too short fragments", () => {
    const out = extractEntities("《A》");
    expect(out.find((e) => e.name === "A")).toBeUndefined();
  });

  it("carries a quote for verification", () => {
    const out = extractEntities("前文铺垫。这里提到《知识图谱》这个概念。后文继续。");
    const target = out.find((e) => e.name === "知识图谱");
    expect(target?.quote).toContain("知识图谱");
  });

  it("returns empty for empty text", () => {
    expect(extractEntities("")).toEqual([]);
  });
});

describe("extractCooccurrenceRelations", () => {
  it("links entities appearing in the same sentence", () => {
    const text = "我们用 React 和 TypeScript 开发。另一句无关。";
    const entities = extractEntities(text);
    const rels = extractCooccurrenceRelations(text, entities);
    expect(rels.length).toBeGreaterThan(0);
    expect(rels[0].relation).toBe("co_occurs");
  });

  it("does not link entities in different sentences", () => {
    const text = "这里只有 React。那里只有 Go。";
    const entities = extractEntities(text);
    const rels = extractCooccurrenceRelations(text, entities);
    expect(rels).toEqual([]);
  });
});
