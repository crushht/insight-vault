import { TRPCError } from "@trpc/server";
import { and, eq, inArray, or, sql, count } from "drizzle-orm";
import { z } from "zod";

import {
  bookmarkChunks,
  bookmarks,
  entities,
  entityMentions,
  entityRelations,
} from "@karakeep/db/schema";
import {
  extractCooccurrenceRelations,
  extractEntities,
} from "@karakeep/shared/entityExtraction";

import { authedProcedure, router } from "../index";

/**
 * 知识图谱查询 + 重建（P6）。
 *
 * `rebuildFromBookmark` 用**规则抽取**（`shared/entityExtraction`）给单条收藏重建图谱：
 * 无 AI 也能工作；有 AI 时可以在此之上叠加 LLM 结果并用规则做校验。
 *
 * 所有读写都按 userId 过滤。
 */

const MAX_NODES = 500;

const zEntityKind = z.enum([
  "person",
  "place",
  "org",
  "product",
  "tech",
  "concept",
  "topic",
]);

export const graphAppRouter = router({
  overview: authedProcedure
    .input(
      z
        .object({
          kinds: z.array(zEntityKind).optional(),
          limit: z.number().int().min(10).max(MAX_NODES).default(200),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 200;
      const where = input?.kinds?.length
        ? and(eq(entities.userId, ctx.user.id), inArray(entities.kind, input.kinds))
        : eq(entities.userId, ctx.user.id);

      const nodes = await ctx.db
        .select({
          id: entities.id,
          kind: entities.kind,
          name: entities.name,
          description: entities.description,
          mentionCount: entities.mentionCount,
        })
        .from(entities)
        .where(where)
        .orderBy(sql`${entities.mentionCount} DESC`)
        .limit(limit);

      if (nodes.length === 0) {
        return { nodes: [], edges: [] };
      }

      const nodeIds = nodes.map((n) => n.id);
      const edges = await ctx.db
        .select({
          id: entityRelations.id,
          from: entityRelations.fromEntityId,
          to: entityRelations.toEntityId,
          relation: entityRelations.relation,
          weight: entityRelations.weight,
        })
        .from(entityRelations)
        .where(
          and(
            eq(entityRelations.userId, ctx.user.id),
            inArray(entityRelations.fromEntityId, nodeIds),
            inArray(entityRelations.toEntityId, nodeIds),
          ),
        );

      const [{ value: totalNodes }] = await ctx.db
        .select({ value: count() })
        .from(entities)
        .where(eq(entities.userId, ctx.user.id));

      return { nodes, edges, total: Number(totalNodes) };
    }),

  /** 删除一个实体（连同它的提及与关系） */
  deleteEntity: authedProcedure
    .input(z.object({ entityId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const owned = await ctx.db.query.entities.findFirst({
        where: and(
          eq(entities.id, input.entityId),
          eq(entities.userId, ctx.user.id),
        ),
      });
      if (!owned) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Entity not found" });
      }

      // 显式清理关系与提及（不依赖级联，避免像 §141 那样留孤儿）
      await ctx.db
        .delete(entityRelations)
        .where(
          or(
            eq(entityRelations.fromEntityId, input.entityId),
            eq(entityRelations.toEntityId, input.entityId),
          ),
        );
      await ctx.db
        .delete(entityMentions)
        .where(eq(entityMentions.entityId, input.entityId));
      await ctx.db.delete(entities).where(eq(entities.id, input.entityId));

      return { deleted: input.entityId };
    }),

  entity: authedProcedure
    .input(z.object({ entityId: z.string() }))
    .query(async ({ ctx, input }) => {
      const entity = await ctx.db.query.entities.findFirst({
        where: and(eq(entities.id, input.entityId), eq(entities.userId, ctx.user.id)),
      });
      if (!entity) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Entity not found" });
      }

      const mentions = await ctx.db
        .select({
          id: entityMentions.id,
          bookmarkId: entityMentions.bookmarkId,
          chunkId: entityMentions.chunkId,
          quote: entityMentions.quote,
          confidence: entityMentions.confidence,
        })
        .from(entityMentions)
        .where(
          and(
            eq(entityMentions.entityId, entity.id),
            eq(entityMentions.userId, ctx.user.id),
          ),
        )
        .limit(50);

      return { entity, mentions };
    }),

  stats: authedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({ kind: entities.kind })
      .from(entities)
      .where(eq(entities.userId, ctx.user.id));

    const byKind: Record<string, number> = {};
    for (const r of rows) {
      byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
    }
    return { total: rows.length, byKind };
  }),

  /**
   * 用某条收藏的正文重建它的实体与关系。
   *
   * 幂等：先删除该收藏的旧提及与由它作为证据的关系，再重新写入。
   */
  rebuildFromBookmark: authedProcedure
    .input(z.object({ bookmarkId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const bookmark = await ctx.db.query.bookmarks.findFirst({
        where: and(
          eq(bookmarks.id, input.bookmarkId),
          eq(bookmarks.userId, ctx.user.id),
        ),
      });
      if (!bookmark) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Bookmark not found" });
      }

      const chunks = await ctx.db
        .select({ id: bookmarkChunks.id, text: bookmarkChunks.text })
        .from(bookmarkChunks)
        .where(
          and(
            eq(bookmarkChunks.bookmarkId, input.bookmarkId),
            eq(bookmarkChunks.userId, ctx.user.id),
          ),
        );

      const text = chunks.map((c) => c.text).join("\n\n");
      if (!text.trim()) {
        return { entities: 0, mentions: 0, relations: 0, reason: "no_text" as const };
      }

      const extracted = extractEntities(text);

      // 清掉这条收藏之前的提及（关系按证据收藏清理）
      await ctx.db
        .delete(entityMentions)
        .where(
          and(
            eq(entityMentions.bookmarkId, input.bookmarkId),
            eq(entityMentions.userId, ctx.user.id),
          ),
        );
      await ctx.db
        .delete(entityRelations)
        .where(
          and(
            eq(entityRelations.evidenceBookmarkId, input.bookmarkId),
            eq(entityRelations.userId, ctx.user.id),
          ),
        );

      // upsert 实体（唯一键：userId + kind + normalizedName）
      const idByKey = new Map<string, string>();
      for (const e of extracted) {
        const existing = await ctx.db.query.entities.findFirst({
          where: and(
            eq(entities.userId, ctx.user.id),
            eq(entities.kind, e.kind),
            eq(entities.normalizedName, e.normalizedName),
          ),
        });
        if (existing) {
          idByKey.set(`${e.kind}:${e.normalizedName}`, existing.id);
          continue;
        }
        const [row] = await ctx.db
          .insert(entities)
          .values({
            userId: ctx.user.id,
            kind: e.kind,
            name: e.name,
            normalizedName: e.normalizedName,
          })
          .returning({ id: entities.id });
        idByKey.set(`${e.kind}:${e.normalizedName}`, row.id);
      }

      // 提及
      let mentions = 0;
      const firstChunk = chunks[0];
      for (const e of extracted) {
        const entityId = idByKey.get(`${e.kind}:${e.normalizedName}`);
        if (!entityId) continue;
        await ctx.db.insert(entityMentions).values({
          entityId,
          bookmarkId: input.bookmarkId,
          userId: ctx.user.id,
          chunkId: firstChunk?.id,
          quote: e.quote,
        });
        mentions++;
      }

      // 关系（同句共现）
      let relations = 0;
      const cooccur = extractCooccurrenceRelations(text, extracted);
      for (const rel of cooccur) {
        const fromId = [...idByKey.entries()].find(
          ([k]) => k.endsWith(`:${rel.from}`),
        )?.[1];
        const toId = [...idByKey.entries()].find(
          ([k]) => k.endsWith(`:${rel.to}`),
        )?.[1];
        if (!fromId || !toId || fromId === toId) continue;
        const existing = await ctx.db.query.entityRelations.findFirst({
          where: and(
            eq(entityRelations.userId, ctx.user.id),
            eq(entityRelations.fromEntityId, fromId),
            eq(entityRelations.toEntityId, toId),
            eq(entityRelations.relation, rel.relation),
          ),
        });
        if (existing) continue;
        await ctx.db.insert(entityRelations).values({
          userId: ctx.user.id,
          fromEntityId: fromId,
          toEntityId: toId,
          relation: rel.relation,
          evidenceBookmarkId: input.bookmarkId,
        });
        relations++;
      }

      // 重算 mentionCount（简单可靠，避免累加漂移）
      for (const entityId of new Set(idByKey.values())) {
        await ctx.db
          .update(entities)
          .set({
            mentionCount: sql`(SELECT COUNT(*) FROM ${entityMentions} WHERE ${entityMentions.entityId} = ${entityId})`,
          })
          .where(eq(entities.id, entityId));
      }

      return {
        entities: idByKey.size,
        mentions,
        relations,
        reason: "ok" as const,
      };
    }),
});
