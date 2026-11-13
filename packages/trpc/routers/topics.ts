import { and, desc, eq, like, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { bookmarkChunks, bookmarks, contentReports } from "@karakeep/db/schema";
import { InferenceClientFactory } from "@karakeep/shared/inference";
import type { RagSource } from "@karakeep/shared/rag";
import { buildTopicDraft, buildTopicPrompt } from "@karakeep/shared/topics";

import { authedProcedure, router } from "../index";

/**
 * 智能专题（P6）。
 *
 * 「输入一个主题 → 从我的收藏里检索 → 整理成结构化报告」。
 *
 * 两条路径：
 * - 有 AI：调模型生成带 `[n]` 引用的报告；
 * - 无 AI：返回确定性草稿（资料清单 + 引用编号 + 待补充），不假装有结论。
 */

const MAX_SOURCES = 12;

function extractTerms(query: string): string[] {
  const terms = new Set<string>();
  for (const w of query.match(/[A-Za-z0-9_]{2,}/g) ?? []) terms.add(w.toLowerCase());
  for (const run of query.match(/[\u4e00-\u9fff]+/g) ?? []) {
    if (run.length <= 2) {
      terms.add(run);
      continue;
    }
    for (let i = 0; i + 2 <= run.length && i < 6; i++) {
      terms.add(run.slice(i, i + 2));
    }
  }
  return [...terms].slice(0, 8);
}

export const topicsAppRouter = router({
  /** 生成历史（专题与创作共用，按 kind 过滤） */
  reports: authedProcedure
    .input(
      z.object({
        kind: z.enum(["topic", "creation"]).default("topic"),
        limit: z.number().int().min(1).max(50).default(10),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: contentReports.id,
          title: contentReports.title,
          markdown: contentReports.markdown,
          mode: contentReports.mode,
          sourceCount: contentReports.sourceCount,
          createdAt: contentReports.createdAt,
        })
        .from(contentReports)
        .where(
          and(
            eq(contentReports.userId, ctx.user.id),
            eq(contentReports.kind, input.kind),
          ),
        )
        .orderBy(desc(contentReports.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      return { reports: rows };
    }),

  /** 删除一条生成历史 */
  deleteReport: authedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const deleted = await ctx.db
        .delete(contentReports)
        .where(
          and(
            eq(contentReports.id, input.id),
            eq(contentReports.userId, ctx.user.id),
          ),
        )
        .returning({ id: contentReports.id });

      if (deleted.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Report not found" });
      }
      return { deleted: deleted[0].id };
    }),

  generate: authedProcedure
    .input(
      z.object({
        topic: z.string().trim().min(1).max(200),
        limit: z.number().int().min(1).max(MAX_SOURCES).default(8),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const terms = extractTerms(input.topic);
      let sources: RagSource[] = [];

      if (terms.length > 0) {
        const rows = await ctx.db
          .select({
            bookmarkId: bookmarkChunks.bookmarkId,
            chunkId: bookmarkChunks.id,
            text: bookmarkChunks.text,
            title: bookmarks.title,
          })
          .from(bookmarkChunks)
          .leftJoin(bookmarks, eq(bookmarks.id, bookmarkChunks.bookmarkId))
          .where(
            and(
              eq(bookmarkChunks.userId, ctx.user.id),
              or(...terms.map((t) => like(bookmarkChunks.text, `%${t}%`))),
            ),
          )
          .limit(input.limit);

        sources = rows.map((r) => ({
          bookmarkId: r.bookmarkId,
          chunkId: r.chunkId,
          title: r.title ?? undefined,
          quote: r.text.slice(0, 600),
        }));
      }

      const draft = buildTopicDraft(input.topic, sources);
      const client = InferenceClientFactory.build();

      if (!client || sources.length === 0) {
        await ctx.db.insert(contentReports).values({
          userId: ctx.user.id,
          kind: "topic",
          title: input.topic,
          markdown: draft,
          sourceCount: sources.length,
          mode: "draft",
        });
        return {
          mode: "draft" as const,
          markdown: draft,
          sourceCount: sources.length,
        };
      }

      const { system, user } = buildTopicPrompt(input.topic, sources);
      const resp = await client.inferFromText(`${system}\n\n${user}`, {});
      await ctx.db.insert(contentReports).values({
        userId: ctx.user.id,
        kind: "topic",
        title: input.topic,
        markdown: resp.response,
        sourceCount: sources.length,
        mode: "ai",
      });
      return {
        mode: "ai" as const,
        markdown: resp.response,
        sourceCount: sources.length,
      };
    }),
});
