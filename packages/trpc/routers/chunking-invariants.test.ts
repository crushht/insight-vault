import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 源码不变量测试（防回归）。
 *
 * 背景（PHASE_2_REPORT §98–§99）：文字笔记曾经完全不产生 chunk，原因有两层，
 * 都是「顺序/分支」级别的错误 —— 常规单元测试抓不到，但一旦被改回去就会复发：
 *
 *   1. `bookmarks.ts` 的 TEXT 分支只在 `enableAutoIndexing` 为真时才入队 embeddings；
 *   2. `embeddingsWorker.run()` 里向量库的空值检查排在分块逻辑之前。
 *
 * 这里直接对源码做结构性断言：改动一旦破坏这两点，测试立刻失败。
 * 这不是优雅的测试方式，但它拦的是一类"改一行就静默失效"的风险。
 */

const REPO_ROOT = join(__dirname, "..", "..", "..");

function read(relPath: string): string {
  return readFileSync(join(REPO_ROOT, relPath), "utf8");
}

describe("chunk persistence invariants", () => {
  it("embeddings worker persists chunks before checking the vector store", () => {
    const src = read("apps/workers/workers/embeddingsWorker.ts");

    const chunkIdx = src.indexOf("await persistBookmarkChunks(");
    const vectorIdx = src.indexOf("await getVectorStoreClient()");

    expect(chunkIdx).toBeGreaterThan(-1);
    expect(vectorIdx).toBeGreaterThan(-1);
    // 分块必须先于向量库检查
    expect(chunkIdx).toBeLessThan(vectorIdx);
  });

  it("text bookmarks enqueue embeddings unconditionally", () => {
    const src = read("packages/trpc/routers/bookmarks.ts");

    // 文件里有两处（事务内 insert 与创建后的入队 switch），从后半段开始找入队那处
    const start = src.lastIndexOf("case BookmarkTypes.TEXT:");
    expect(start).toBeGreaterThan(-1);
    // 取该 case 到下一个 case 之间的片段
    const nextCase = src.indexOf("case BookmarkTypes.", start + "case BookmarkTypes.TEXT:".length);
    const branch = src.slice(start, nextCase === -1 ? start + 1200 : nextCase);

    expect(branch).toContain("EmbeddingsQueue.enqueue");
    // 不允许再被自动索引开关挡住
    expect(branch).not.toContain("if (serverConfig.embedding.enableAutoIndexing)");
  });

  it("crawler post-crawl jobs enqueue embeddings unconditionally", () => {
    const src = read("apps/workers/workers/crawlerWorker.ts");

    const start = src.indexOf("async function enqueuePostCrawlJobs(");
    expect(start).toBeGreaterThan(-1);
    const branch = src.slice(start, start + 1600);

    expect(branch).toContain("EmbeddingsQueue.enqueue");
    expect(branch).not.toContain("if (serverConfig.embedding.enableAutoIndexing)");
  });

  it("text updates enqueue an embedding rebuild", () => {
    const src = read("packages/trpc/routers/bookmarks.ts");

    // 注意：文件里有多个结构相同的 procedure，必须先在目标 procedure 范围内定位
    const start = src.indexOf("updateBookmarkText:");
    expect(start).toBeGreaterThan(-1);
    const branch = src.slice(start, start + 2600);

    expect(branch).toContain("EmbeddingsQueue.enqueue");
    // 编辑不应触发重新打标签（省 token），但要重建分块
    expect(branch).toContain("runTaggingOnComplete: false");
  });
});
