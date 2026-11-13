import { describe, expect, it } from "vitest";

import {
  buildCreationDraft,
  buildCreationPrompt,
  CREATION_TEMPLATES,
  type CreationKind,
} from "./creation";

const S1 = {
  bookmarkId: "b1",
  chunkId: "c1",
  title: "向量数据库选型",
  quote: "HNSW 是一种近似最近邻算法。",
};
const S2 = {
  bookmarkId: "b2",
  chunkId: "c2",
  title: "RAG 实践",
  quote: "分块大小显著影响检索质量。",
};

const KINDS: CreationKind[] = [
  "article",
  "video_script",
  "topic_plan",
  "study_notes",
  "ppt_outline",
  "research_report",
];

describe("CREATION_TEMPLATES", () => {
  it("has all six kinds", () => {
    expect(Object.keys(CREATION_TEMPLATES).sort()).toEqual([...KINDS].sort());
  });

  it("each template has sections and guidance", () => {
    for (const k of KINDS) {
      expect(CREATION_TEMPLATES[k].sections.length).toBeGreaterThan(2);
      expect(CREATION_TEMPLATES[k].guidance.length).toBeGreaterThan(5);
    }
  });
});

describe("buildCreationPrompt", () => {
  it("carries the no-outside-knowledge rule", () => {
    const { system } = buildCreationPrompt("article", "写一篇文章", [S1]);
    expect(system).toContain("不得引入外部知识");
    expect(system).toContain("[n]");
    expect(system).toContain("资料不足");
  });

  it("includes the kind's structure", () => {
    const { system } = buildCreationPrompt("research_report", "写报告", [S1]);
    expect(system).toContain("摘要");
    expect(system).toContain("分歧与空白");
  });

  it("puts brief and numbered sources into the user prompt", () => {
    const { user } = buildCreationPrompt("article", "写一篇关于选型的文章", [S1, S2]);
    expect(user).toContain("写一篇关于选型的文章");
    expect(user).toContain("[1]");
    expect(user).toContain("[2]");
    expect(user).toContain("《向量数据库选型》");
  });

  it("marks empty context", () => {
    const { user } = buildCreationPrompt("article", "写", []);
    expect(user).toContain("（无资料）");
  });
});

describe("buildCreationDraft", () => {
  it("contains every section of the template", () => {
    const md = buildCreationDraft("ppt_outline", "做一个分享", [S1]);
    for (const s of CREATION_TEMPLATES.ppt_outline.sections) {
      expect(md).toContain(`## ${s}`);
    }
  });

  it("lists usable material with numbers", () => {
    const md = buildCreationDraft("article", "写", [S1, S2]);
    expect(md).toContain("[1]");
    expect(md).toContain("[2]");
    expect(md).toContain("可用素材");
  });

  it("says so when there is no material", () => {
    const md = buildCreationDraft("article", "写", []);
    expect(md).toContain("没有相关素材");
  });

  it("is explicitly a skeleton, not a finished draft", () => {
    const md = buildCreationDraft("article", "写", [S1]);
    expect(md).toContain("这是骨架，不是成稿");
  });

  it("keeps the brief visible", () => {
    const md = buildCreationDraft("study_notes", "学习 RAG", []);
    expect(md).toContain("学习 RAG");
  });
});
