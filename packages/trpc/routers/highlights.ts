import { experimental_trpcMiddleware } from "@trpc/server";
import { z } from "zod";

import {
  DEFAULT_NUM_HIGHLIGHTS_PER_PAGE,
  zGetAllHighlightsResponseSchema,
  zHighlightSchema,
  zNewHighlightSchema,
  zUpdateHighlightSchema,
} from "@karakeep/shared/types/highlights";
import { zCursorV2 } from "@karakeep/shared/types/pagination";

import { EmbeddingsQueue } from "@karakeep/shared-server";

import type { AuthedContext } from "../index";
import { createScopedAuthedProcedure, router } from "../index";
import { actorFromContext } from "../lib/actor";
import { HighlightsService } from "../models/highlights.service";
import { ensureBookmarkAccess, ensureBookmarkOwnership } from "./bookmarks";

const highlightsProcedure = createScopedAuthedProcedure("highlights").use(
  (opts) => {
    return opts.next({
      ctx: {
        ...opts.ctx,
        actor: actorFromContext(opts.ctx),
        highlightsService: new HighlightsService(opts.ctx.db),
      },
    });
  },
);

type HighlightsContext = AuthedContext & {
  actor: ReturnType<typeof actorFromContext>;
  highlightsService: HighlightsService;
};

const ensureHighlightOwnership = experimental_trpcMiddleware<{
  ctx: HighlightsContext;
  input: { highlightId: string };
}>().create(async (opts) => {
  const highlight = await opts.ctx.highlightsService.get(
    opts.ctx.actor,
    opts.input.highlightId,
  );

  return opts.next({
    ctx: {
      ...opts.ctx,
      highlight,
    },
  });
});


/**
 * 高亮变更后重建分块。
 *
 * 高亮文本会进入 chunk（见 embeddingsWorker 的 buildChunkSourceText），
 * 所以增删改高亮都必须重建，否则 AI 会读到"已删除的高亮"或读不到"刚加的高亮"。
 * 失败只记日志，不影响高亮本身的写入。
 */
async function rebuildChunksForHighlight(bookmarkId: string, userId: string) {
  try {
    await EmbeddingsQueue.enqueue(
      { bookmarkId, type: "embed", runTaggingOnComplete: false },
      { groupId: userId },
    );
  } catch (e) {
    console.warn(`[highlights] failed to enqueue chunk rebuild for ${bookmarkId}: ${e}`);
  }
}

export const highlightsAppRouter = router({
  create: highlightsProcedure
    .input(zNewHighlightSchema)
    .output(zHighlightSchema)
    .use(ensureBookmarkOwnership)
    .mutation(async ({ input, ctx }) => {
      const created = await ctx.highlightsService.create(ctx.actor, input);
      await rebuildChunksForHighlight(input.bookmarkId, ctx.user.id);
      return created;
    }),
  getForBookmark: highlightsProcedure
    .input(z.object({ bookmarkId: z.string() }))
    .output(z.object({ highlights: z.array(zHighlightSchema) }))
    .use(ensureBookmarkAccess)
    .query(async ({ ctx }) => {
      const highlights = await ctx.highlightsService.getForBookmark(
        ctx.actor,
        ctx.bookmark.id,
      );
      return { highlights };
    }),
  get: highlightsProcedure
    .input(z.object({ highlightId: z.string() }))
    .output(zHighlightSchema)
    .use(ensureHighlightOwnership)
    .query(({ ctx }) => {
      return ctx.highlight;
    }),
  getAll: highlightsProcedure
    .input(
      z.object({
        cursor: z.any().nullish(),
        limit: z
          .number()
          .int()
          .min(1)
          .optional()
          .default(DEFAULT_NUM_HIGHLIGHTS_PER_PAGE),
      }),
    )
    .output(zGetAllHighlightsResponseSchema)
    .query(async ({ input, ctx }) => {
      return await ctx.highlightsService.getAll(
        ctx.actor,
        input.cursor,
        input.limit,
      );
    }),
  search: highlightsProcedure
    .input(
      z.object({
        text: z.string(),
        cursor: zCursorV2.nullish(),
        limit: z
          .number()
          .int()
          .min(1)
          .optional()
          .default(DEFAULT_NUM_HIGHLIGHTS_PER_PAGE),
      }),
    )
    .output(zGetAllHighlightsResponseSchema)
    .query(async ({ input, ctx }) => {
      return await ctx.highlightsService.search(
        ctx.actor,
        input.text,
        input.cursor,
        input.limit,
      );
    }),
  delete: highlightsProcedure
    .input(z.object({ highlightId: z.string() }))
    .output(zHighlightSchema)
    .use(ensureHighlightOwnership)
    .mutation(async ({ ctx }) => {
      const res = await ctx.highlightsService.delete(ctx.highlight);
      await rebuildChunksForHighlight(ctx.highlight.bookmarkId, ctx.user.id);
      return res;
    }),
  update: highlightsProcedure
    .input(zUpdateHighlightSchema)
    .output(zHighlightSchema)
    .use(ensureHighlightOwnership)
    .mutation(async ({ input, ctx }) => {
      const res = await ctx.highlightsService.update(ctx.highlight, input);
      await rebuildChunksForHighlight(ctx.highlight.bookmarkId, ctx.user.id);
      return res;
    }),
});
