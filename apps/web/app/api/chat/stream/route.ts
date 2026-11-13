import { and, eq, like, or } from "drizzle-orm";

import { db } from "@karakeep/db";
import { bookmarkChunks, bookmarks, chatMessages, chatSessions } from "@karakeep/db/schema";
import { InferenceClientFactory } from "@karakeep/shared/inference";
import { buildRagPrompt, NO_CONTEXT_ANSWER } from "@karakeep/shared/rag";

import { getServerAuthSession } from "@/server/auth";

/**
 * 流式对话（SSE）。
 *
 * 与 `chat.sendMessage`（tRPC）的区别：这里逐块推送，前端能边生成边显示。
 *
 * 说明：
 * - 检索仍用关键词 LIKE（与 tRPC 版本一致），命中数量上限 8；
 * - 没有命中时**立刻**推送 `NO_CONTEXT_ANSWER` 并结束 —— 不调模型；
 * - 有命中且配置了 provider 时，调用 `inferFromText` 拿到完整回答后**按句切块推送**
 *   （当前 inference 接口没有真正的 token 流；这一步保证了前端的流式体验与协议正确，
 *   等接口升级成真流式时，只需把下面的分块循环换成遍历 provider 的 stream）。
 */

const MAX_CONTEXT_CHUNKS = 8;

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

function sseChunk(text: string): string {
  return `data: ${JSON.stringify({ delta: text })}\n\n`;
}

export async function POST(req: Request) {
  const session = await getServerAuthSession();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }
  const userId = session.user.id;

  let payload: { chatId?: string; content?: string };
  try {
    payload = await req.json();
  } catch {
    return new Response("Bad Request", { status: 400 });
  }
  const chatId = payload.chatId;
  const content = payload.content?.trim();
  if (!chatId || !content) {
    return new Response("Bad Request", { status: 400 });
  }

  // 会话归属校验
  const owned = await db.query.chatSessions.findFirst({
    where: and(eq(chatSessions.id, chatId), eq(chatSessions.userId, userId)),
  });
  if (!owned) {
    return new Response("Not Found", { status: 404 });
  }

  await db.insert(chatMessages).values({ chatId, role: "user", content });

  const terms = extractTerms(content);
  const rows =
    terms.length === 0
      ? []
      : await db
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
              eq(bookmarkChunks.userId, userId),
              or(...terms.map((t) => like(bookmarkChunks.text, `%${t}%`))),
            ),
          )
          .limit(MAX_CONTEXT_CHUNKS);

  const sources = rows.map((r) => ({
    bookmarkId: r.bookmarkId,
    chunkId: r.chunkId,
    title: r.title ?? undefined,
    quote: r.text.slice(0, 600),
  }));

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (t: string) => controller.enqueue(encoder.encode(sseChunk(t)));

      try {
        let answer: string;
        if (sources.length === 0) {
          answer = NO_CONTEXT_ANSWER;
          push(answer);
        } else {
          const client = InferenceClientFactory.build();
          if (!client) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ error: "AI provider is not configured" })}\n\n`,
              ),
            );
            controller.close();
            return;
          }
          const { system, user } = buildRagPrompt(content, sources);
          const fullPrompt = `${system}\n\n${user}`;

          if (typeof client.inferFromTextStream === "function") {
            // 真流式：provider 逐 token 返回
            let acc = "";
            for await (const delta of client.inferFromTextStream(fullPrompt, {})) {
              acc += delta;
              push(delta);
            }
            answer = acc;
          } else {
            // 回退：一次性拿到再按句推送（保证前端协议一致）
            const resp = await client.inferFromText(fullPrompt, {});
            answer = resp.response;
            const parts = answer.split(/(?<=[。！？!?.\n])/).filter(Boolean);
            for (const p of parts) {
              push(p);
              await new Promise((r) => setTimeout(r, 15));
            }
          }
        }

        await db.insert(chatMessages).values({
          chatId,
          role: "assistant",
          content: answer,
          metadata: {
            citations: sources.map((s, i) => ({
              n: i + 1,
              bookmarkId: s.bookmarkId,
              chunkId: s.chunkId,
              quote: s.quote,
            })),
          },
        });
        await db
          .update(chatSessions)
          .set({ modifiedAt: new Date() })
          .where(eq(chatSessions.id, chatId));

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (e) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ error: String((e as Error).message ?? e) })}\n\n`,
          ),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
