import { and, eq, inArray, like, or } from "drizzle-orm";
import { z } from "zod";

import { bookmarkChunks, bookmarks, contentReports } from "@karakeep/db/schema";
import {
  buildCreationDraft,
  buildCreationPrompt,
  CREATION_TEMPLATES,
  type CreationKind,
} from "@karakeep/shared/creation";
import { InferenceClientFactory } from "@karakeep/shared/inference";
import type { RagSource } from "@karakeep/shared/rag";

import { authedProcedure, publicProcedure, router } from "../index";

/**
 * 创作工作台（P6）。
 *
 * `generate` 的检索与专题一致：关键词命中 chunks → 有 AI 走 prompt，无 AI 返回骨架草稿。
 */

const MAX_SOURCES = 12;

const zKind = z.enum([
  "article",
  "video_script",
  "topic_plan",
  "study_notes",
  "ppt_outline",
  "research_report",
]);

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

export const creationAppRouter = router({
  /** 产物类型目录（前端下拉直接用） */
  kinds: publicProcedure.query(() => {
    return Object.values(CREATION_TEMPLATES).map((t) => ({
      kind: t.kind,
      label: t.label,
      sections: t.sections,
    }));
  }),

  generate: authedProcedure
    .input(
      z.object({
        kind: zKind,
        brief: z.string().trim().min(1).max(2000),
        limit: z.number().int().min(1).max(MAX_SOURCES).default(8),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const terms = extractTerms(input.brief);
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

      const client = InferenceClientFactory.build();
      const kind = input.kind as CreationKind;

      if (!client || sources.length === 0) {
        const draftMd = buildCreationDraft(kind, input.brief, sources);
        await ctx.db.insert(contentReports).values({
          userId: ctx.user.id,
          kind: "creation",
          title: input.brief.slice(0, 60),
          markdown: draftMd,
          sourceCount: sources.length,
          mode: "draft",
        });
        return {
          mode: "draft" as const,
          markdown: draftMd,
          sourceCount: sources.length,
        };
      }

      const { system, user } = buildCreationPrompt(kind, input.brief, sources);
      const resp = await client.inferFromText(`${system}\n\n${user}`, {});
      await ctx.db.insert(contentReports).values({
        userId: ctx.user.id,
        kind: "creation",
        title: input.brief.slice(0, 60),
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
