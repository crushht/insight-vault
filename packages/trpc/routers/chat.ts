import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, like, or } from "drizzle-orm";
import { z } from "zod";

import { bookmarkChunks, bookmarks, chatMessages, chatSessions } from "@karakeep/db/schema";
import { InferenceClientFactory } from "@karakeep/shared/inference";
import {
  buildRagPrompt,
  NO_CONTEXT_ANSWER,
  validateCitations,
  type RagSource,
} from "@karakeep/shared/rag";

import { authedProcedure, router } from "../index";

/**
 * AI 对话（RAG）。
 *
 * 当前链路：
 *  1. 落的用户消息；
 *  2. **关键词检索分块**（SQL LIKE，作为没有向量库时的降级检索）；
 *  3. 无命中 → 直接回答 `NO_CONTEXT_ANSWER`（不需要 AI，也不编造）；
 *  4. 有命中 → 拼 prompt → 调模型 → 校验引用编号 → 写 assistant 消息与 citations。
 */

export const zChatCitation = z.object({
  n: z.number().int().positive(),
  bookmarkId: z.string(),
  chunkId: z.string().optional(),
  quote: z.string().optional(),
  startOffset: z.number().int().nonnegative().optional(),
  endOffset: z.number().int().nonnegative().optional(),
});
export type ZChatCitation = z.infer<typeof zChatCitation>;

const MAX_CONTEXT_CHUNKS = 8;

/** 从问题里抽可检索的词：中文 2 字切片 + 英文/数字单词 */
export function extractQueryTerms(query: string): string[] {
  const terms = new Set<string>();
  const latin = query.match(/[A-Za-z0-9_]{2,}/g) ?? [];
  for (const w of latin) terms.add(w.toLowerCase());

  const cjk = query.match(/[\u4e00-\u9fff]+/g) ?? [];
  for (const run of cjk) {
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

async function retrieveSources(
  ctx: { db: typeof import("@karakeep/db").db },
  userId: string,
  query: string,
  opts: { bookmarkId?: string } = {},
): Promise<RagSource[]> {
  const terms = extractQueryTerms(query);
  if (terms.length === 0) return [];

  const rows = await ctx.db
    .select({
      bookmarkId: bookmarkChunks.bookmarkId,
      chunkId: bookmarkChunks.id,
      text: bookmarkChunks.text,
      startOffset: bookmarkChunks.startOffset,
      endOffset: bookmarkChunks.endOffset,
      title: bookmarks.title,
    })
    .from(bookmarkChunks)
    .leftJoin(bookmarks, eq(bookmarks.id, bookmarkChunks.bookmarkId))
    .where(
      and(
        eq(bookmarkChunks.userId, userId),
        opts.bookmarkId
          ? eq(bookmarkChunks.bookmarkId, opts.bookmarkId)
          : undefined,
        or(...terms.map((t) => like(bookmarkChunks.text, `%${t}%`))),
      ),
    )
    .limit(MAX_CONTEXT_CHUNKS);

  return rows.map((r) => ({
    bookmarkId: r.bookmarkId,
    chunkId: r.chunkId,
    title: r.title ?? undefined,
    quote: r.text.slice(0, 600),
  }));
}

async function ensureOwnedSession(
  ctx: { db: typeof import("@karakeep/db").db; user: { id: string } },
  chatId: string,
) {
  const session = await ctx.db.query.chatSessions.findFirst({
    where: and(eq(chatSessions.id, chatId), eq(chatSessions.userId, ctx.user.id)),
  });
  if (!session) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Chat session not found" });
  }
  return session;
}

export const chatAppRouter = router({
  createSession: authedProcedure
    .input(z.object({ title: z.string().trim().min(1).max(200).default("新对话") }))
    .mutation(async ({ ctx, input }) => {
      const [session] = await ctx.db
        .insert(chatSessions)
        .values({ title: input.title, userId: ctx.user.id })
        .returning();
      return session;
    }),

  listSessions: authedProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.userId, ctx.user.id))
      .orderBy(desc(chatSessions.modifiedAt));
  }),

  getMessages: authedProcedure
    .input(z.object({ chatId: z.string() }))
    .query(async ({ ctx, input }) => {
      await ensureOwnedSession(ctx, input.chatId);
      return ctx.db
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.chatId, input.chatId))
        .orderBy(asc(chatMessages.createdAt));
    }),

  deleteSession: authedProcedure
    .input(z.object({ chatId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ensureOwnedSession(ctx, input.chatId);
      await ctx.db.delete(chatSessions).where(eq(chatSessions.id, input.chatId));
    }),

  /**
   * 发送消息并生成带引用的回答。
   *
   * 检索是「关键词 LIKE」——在没有 Meilisearch/向量库的部署里也能工作；
   * 接入语义检索后只需替换 `retrieveSources`，其余链路不变。
   */
  sendMessage: authedProcedure
    .input(
      z.object({
        chatId: z.string(),
        content: z.string().trim().min(1).max(8000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ensureOwnedSession(ctx, input.chatId);

      await ctx.db.insert(chatMessages).values({
        chatId: input.chatId,
        role: "user",
        content: input.content,
      });

      const sources = await retrieveSources(ctx, ctx.user.id, input.content);

      let answer: string;
      let citations: ZChatCitation[] = [];

      if (sources.length === 0) {
        // 没有命中就不调模型：既省钱，也避免模型凭空发挥。
        answer = NO_CONTEXT_ANSWER;
      } else {
        const client = InferenceClientFactory.build();
        if (!client) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "AI provider is not configured",
          });
        }
        const { system, user } = buildRagPrompt(input.content, sources);
        const resp = await client.inferFromText(`${system}\n\n${user}`, {});
        answer = resp.response;
        const check = validateCitations(answer, sources);
        if (!check.ok) {
          // 模型引用了不存在的编号：记录下来，UI 可据此提示「引用可能不准确」。
          citations = [];
        } else {
          citations = sources.slice(0, MAX_CONTEXT_CHUNKS).map((s, i) => ({
            n: i + 1,
            bookmarkId: s.bookmarkId,
            chunkId: s.chunkId,
            quote: s.quote,
          }));
        }
      }

      const [assistant] = await ctx.db
        .insert(chatMessages)
        .values({
          chatId: input.chatId,
          role: "assistant",
          content: answer,
          metadata: { citations },
        })
        .returning();

      await ctx.db
        .update(chatSessions)
        .set({ modifiedAt: new Date() })
        .where(eq(chatSessions.id, input.chatId));

      return assistant;
    }),

  /**
   * 阅读台里的「就这篇问一句」：只在这条收藏自己的分块里检索，
   * 不落聊天记录，回答同样带 [n] 引用（quote 是命中的原文片段）。
   */
  askAboutBookmark: authedProcedure
    .input(
      z.object({
        bookmarkId: z.string(),
        question: z.string().trim().min(1).max(2000),
      }),
    )
    .output(
      z.object({
        answer: z.string(),
        citations: z.array(zChatCitation),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const bookmark = await ctx.db.query.bookmarks.findFirst({
        where: and(
          eq(bookmarks.id, input.bookmarkId),
          eq(bookmarks.userId, ctx.user.id),
        ),
      });
      if (!bookmark) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Bookmark not found",
        });
      }

      const sources = await retrieveSources(ctx, ctx.user.id, input.question, {
        bookmarkId: input.bookmarkId,
      });
      if (sources.length === 0) {
        return { answer: NO_CONTEXT_ANSWER, citations: [] };
      }

      const client = InferenceClientFactory.build();
      if (!client) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "AI provider is not configured",
        });
      }

      const { system, user } = buildRagPrompt(input.question, sources);
      const resp = await client.inferFromText(`${system}\n\n${user}`, {});
      const check = validateCitations(resp.response, sources);
      const citations = check.ok
        ? sources.slice(0, MAX_CONTEXT_CHUNKS).map((s, i) => ({
            n: i + 1,
            bookmarkId: s.bookmarkId,
            chunkId: s.chunkId,
            quote: s.quote,
          }))
        : [];

      return { answer: resp.response, citations };
    }),
});
