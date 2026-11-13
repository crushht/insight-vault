import { describe, expect, test } from "vitest";

import { getInMemoryDB } from "@karakeep/db/drizzle";
import {
  AssetTypes,
  assets,
  bookmarkAssets,
  bookmarks,
  users,
} from "@karakeep/db/schema";
import { parseSearchQuery } from "@karakeep/shared/searchQueryParser";
import { BookmarkTypes } from "@karakeep/shared/types/bookmarks";

import type { AuthedContext } from "..";
import { getBookmarksConditionFromMatcher } from "./search";

/**
 * 内容形态筛选（is:image / is:pdf / is:video / is:link -is:video）的 SQL 行为。
 * 这四条是侧栏「图片 / 视频 / 文章 / PDF」入口的底座。
 */

async function setup() {
  const db = getInMemoryDB(true);
  await db.insert(users).values({
    id: "user-1",
    name: "Test",
    email: "test@example.com",
    emailVerified: true,
    role: "user",
  });

  await db.insert(bookmarks).values([
    { id: "b-text", userId: "user-1", type: BookmarkTypes.TEXT, title: "笔记" },
    { id: "b-link", userId: "user-1", type: BookmarkTypes.LINK, title: "文章" },
    {
      id: "b-image",
      userId: "user-1",
      type: BookmarkTypes.ASSET,
      title: "图片",
    },
    {
      id: "b-pdf",
      userId: "user-1",
      type: BookmarkTypes.ASSET,
      title: "PDF",
    },
    {
      id: "b-video",
      userId: "user-1",
      type: BookmarkTypes.LINK,
      title: "视频",
    },
  ]);

  await db.insert(bookmarkAssets).values([
    { id: "b-image", assetType: "image", assetId: "a-image" },
    { id: "b-pdf", assetType: "pdf", assetId: "a-pdf" },
  ]);

  await db.insert(assets).values([
    {
      id: "a-video",
      assetType: AssetTypes.LINK_VIDEO,
      bookmarkId: "b-video",
      userId: "user-1",
      size: 1,
    },
  ]);

  const ctx = { db, user: { id: "user-1" } } as unknown as AuthedContext;
  return { db, ctx };
}

async function idsFor(
  ctx: AuthedContext,
  query: string,
): Promise<string[]> {
  const parsed = parseSearchQuery(query);
  if (!parsed.matcher) {
    throw new Error(`查询没有解析出 matcher: ${query}`);
  }
  const where = await getBookmarksConditionFromMatcher(ctx, parsed.matcher);
  const { db } = ctx;
  const rows = await db.select({ id: bookmarks.id }).from(bookmarks).where(where);
  return rows.map((r) => r.id).sort();
}

describe("assetKind 筛选", () => {
  test("is:image 只命中图片收藏", async () => {
    const { ctx } = await setup();
    expect(await idsFor(ctx, "is:image")).toEqual(["b-image"]);
  });

  test("is:pdf 只命 PDF 收藏", async () => {
    const { ctx } = await setup();
    expect(await idsFor(ctx, "is:pdf")).toEqual(["b-pdf"]);
  });

  test("is:video 只命中带视频资产的链接", async () => {
    const { ctx } = await setup();
    expect(await idsFor(ctx, "is:video")).toEqual(["b-video"]);
  });

  test("-is:video 排除视频", async () => {
    const { ctx } = await setup();
    expect(await idsFor(ctx, "-is:video")).toEqual([
      "b-image",
      "b-link",
      "b-pdf",
      "b-text",
    ]);
  });

  test("is:link -is:video 就是「文章」", async () => {
    const { ctx } = await setup();
    expect(await idsFor(ctx, "is:link -is:video")).toEqual(["b-link"]);
  });

  test("is:image is:pdf 同时要求两种形态 → 空", async () => {
    const { ctx } = await setup();
    expect(await idsFor(ctx, "is:image is:pdf")).toEqual([]);
  });
});
