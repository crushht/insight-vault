import { describe, expect, it } from "vitest";

import { buildTopicDraft, buildTopicPrompt } from "./topics";

const A = {
  bookmarkId: "b1",
  chunkId: "c1",
  title: "向量数据库选型",
  quote: "HNSW 是一种近似最近邻算法，适合大规模召回。",
};
const B = {
  bookmarkId: "b1",
  chunkId: "c2",
  title: "向量数据库选型",
  quote: "IVF 更省内存，但召回率略低。",
};
const C = {
  bookmarkId: "b2",
  chunkId: "c9",
  title: "RAG 实践笔记",
  quote: "分块大小会显著影响检索质量。",
};

describe("buildTopicDraft", () => {
  it("says so when there is no material", () => {
    const md = buildTopicDraft("向量数据库", []);
    expect(md).toContain("没有与该主题相关的资料");
    expect(md).toContain("先收藏几篇相关资料");
  });

  it("has a title with the topic", () => {
    const md = buildTopicDraft("向量数据库", [A]);
    expect(md.startsWith("# 专题：向量数据库")).toBe(true);
  });

  it("groups sources by bookmark and numbers them", () => {
    const md = buildTopicDraft("向量数据库", [A, B, C]);
    expect(md).toContain("共 2 条收藏、3 个相关片段");
    expect(md).toContain("[1]");
    expect(md).toContain("[2]");
    expect(md).toContain("[3]");
    expect(md).toContain("《向量数据库选型》");
    expect(md).toContain("《RAG 实践笔记》");
  });

  it("includes excerpts and truncates long ones", () => {
    const long = { ...A, quote: "很".repeat(300) };
    const md = buildTopicDraft("主题", [long], { excerptChars: 40 });
    expect(md).toContain("…");
  });

  it("always lists what is missing", () => {
    const md = buildTopicDraft("主题", [A]);
    expect(md).toContain("## 待补充");
    expect(md).toContain("AI 模型生成");
  });

  it("handles a blank topic", () => {
    const md = buildTopicDraft("   ", [A]);
    expect(md).toContain("（未命名）");
  });
});

describe("buildTopicPrompt", () => {
  it("requires citations and forbids outside knowledge", () => {
    const { system } = buildTopicPrompt("主题", [A]);
    expect(system).toContain("不得引入外部知识");
    expect(system).toContain("[n]");
    expect(system).toContain("分歧或空白");
  });

  it("puts every source into the user prompt with numbers", () => {
    const { user } = buildTopicPrompt("向量数据库", [A, B, C]);
    expect(user).toContain("主题：向量数据库");
    expect(user).toContain("[1]");
    expect(user).toContain("[3]");
    expect(user).toContain("《向量数据库选型》");
  });

  it("marks empty context explicitly", () => {
    const { user } = buildTopicPrompt("主题", []);
    expect(user).toContain("（无资料）");
  });
});
