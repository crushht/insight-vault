import { beforeEach, describe, expect, test, vi } from "vitest";

import { bookmarkChunks } from "@karakeep/db/schema";
import { BookmarkTypes } from "@karakeep/shared/types/bookmarks";

import type { CustomTestContext } from "../testUtils";
import { defaultBeforeEach } from "../testUtils";

/**
 * 阅读台「就这篇提问」：只在这条收藏自己的分块里检索，回答带 [n] 引用。
 * 模型用 mock，不依赖真实 Key。
 */

const inference = vi.hoisted(() => ({
  build: vi.fn(),
  infer: vi.fn(),
}));

vi.mock("@karakeep/shared/inference", async (original) => ({
  ...(await original<typeof import("@karakeep/shared/inference")>()),
  InferenceClientFactory: {
    build: inference.build,
  },
}));

beforeEach<CustomTestContext>(async (context) => {
  await defaultBeforeEach(true)(context);
  inference.build.mockReset();
  inference.infer.mockReset();
});

const CHUNK_TEXT =
  "向量数据库的召回率与延迟之间存在权衡。要提高召回率，通常需要增加索引的探测范围，代价是延迟上升。";

async function seedBookmarkWithChunk(ctx: CustomTestContext, text = CHUNK_TEXT) {
  const bookmark = await ctx.apiCallers[0].bookmarks.createBookmark({
    type: BookmarkTypes.TEXT,
    text: "一篇讲向量检索的笔记",
  });
  await ctx.db.insert(bookmarkChunks).values({
    id: "chunk-1",
    bookmarkId: bookmark.id,
    userId: bookmark.userId,
    ordinal: 0,
    text,
    tokenCount: 20,
    startOffset: 0,
    endOffset: text.length,
    contentHash: "hash-1",
    createdAt: new Date(),
  });
  return bookmark;
}

describe("chat.askAboutBookmark", () => {
  test("命中分块时返回答案与引用", async (ctx: CustomTestContext) => {
    const bookmark = await seedBookmarkWithChunk(ctx);
    inference.build.mockReturnValue({
      inferFromText: inference.infer,
    });
    inference.infer.mockResolvedValue({
      response: "召回率与延迟需要权衡 [1]。",
      totalTokens: 10,
    });

    const res = await ctx.apiCallers[0].chat.askAboutBookmark({
      bookmarkId: bookmark.id,
      question: "召回率怎么提高？",
    });

    expect(res.answer).toContain("[1]");
    expect(res.citations).toHaveLength(1);
    expect(res.citations[0].n).toBe(1);
    expect(res.citations[0].quote).toContain("召回率");
    expect(inference.infer).toHaveBeenCalledTimes(1);
  });

  test("没有命中分块时不调模型，直接回答资料中没有", async (
    ctx: CustomTestContext,
  ) => {
    const bookmark = await ctx.apiCallers[0].bookmarks.createBookmark({
      type: BookmarkTypes.TEXT,
      text: "空笔记",
    });

    const res = await ctx.apiCallers[0].chat.askAboutBookmark({
      bookmarkId: bookmark.id,
      question: "召回率怎么提高？",
    });

    expect(res.citations).toHaveLength(0);
    expect(res.answer.length).toBeGreaterThan(0);
    expect(inference.infer).not.toHaveBeenCalled();
  });

  test("有分块但没配模型时明确报 PRECONDITION_FAILED", async (
    ctx: CustomTestContext,
  ) => {
    const bookmark = await seedBookmarkWithChunk(ctx);
    inference.build.mockReturnValue(null);

    await expect(
      ctx.apiCallers[0].chat.askAboutBookmark({
        bookmarkId: bookmark.id,
        question: "召回率怎么提高？",
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  test("别人的收藏查不到（NOT_FOUND）", async (ctx: CustomTestContext) => {
    const bookmark = await seedBookmarkWithChunk(ctx);

    await expect(
      ctx.apiCallers[1].chat.askAboutBookmark({
        bookmarkId: bookmark.id,
        question: "召回率怎么提高？",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("引用编号越界时不返回引用（防伪造引用）", async (
    ctx: CustomTestContext,
  ) => {
    const bookmark = await seedBookmarkWithChunk(ctx);
    inference.build.mockReturnValue({ inferFromText: inference.infer });
    inference.infer.mockResolvedValue({
      response: "这个结论来自 [9]。",
      totalTokens: 10,
    });

    const res = await ctx.apiCallers[0].chat.askAboutBookmark({
      bookmarkId: bookmark.id,
      question: "召回率怎么提高？",
    });

    expect(res.citations).toHaveLength(0);
  });
});
