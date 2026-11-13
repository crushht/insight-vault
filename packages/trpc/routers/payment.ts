import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { orders, userEntitlements, users } from "@karakeep/db/schema";
import {
  applyTransition,
  type OrderStatus,
} from "@karakeep/shared/orderStateMachine";

import { authedProcedure, publicProcedure, router } from "../index";

/**
 * 订单与订阅计费（P7）。
 *
 * 现阶段不接真实支付通道：
 * - `createOrder` 落一张 `created` 订单并返回「待支付」；
 * - `advanceOrder` 供后台/联调推进状态，**必须走状态机**，非法迁移直接拒绝；
 * - 真实通道接入时，只需把「支付成功回调」映射成 `advanceOrder(paid)`。
 */

export const PLANS = {
  pro_month: { amountMinor: 2900, currency: "CNY", tier: "pro", periodDays: 30 },
  pro_year: { amountMinor: 28800, currency: "CNY", tier: "pro", periodDays: 365 },
  max_month: { amountMinor: 7900, currency: "CNY", tier: "max", periodDays: 30 },
  max_year: { amountMinor: 78800, currency: "CNY", tier: "max", periodDays: 365 },
} as const;

const zPlan = z.enum(["pro_month", "pro_year", "max_month", "max_year"]);


const GB = 1024 * 1024 * 1024;

/** 各档位的资源上限（权益表与 users 配额列共用同一份数值） */
const TIER_LIMITS = {
  pro: {
    aiTokensLimit: 5_000_000,
    aiCallsLimit: 5_000,
    storageLimit: 50 * GB,
  },
  max: {
    aiTokensLimit: 30_000_000,
    aiCallsLimit: 30_000,
    storageLimit: 500 * GB,
  },
} as const;

/**
 * 订单进入「已付费」时同步权益。
 *
 * 只写 `userEntitlements`（可审计的权益来源）；上游热路径读的 `users.*Quota`
 * 保持原逻辑不动，避免与既有配额代码打架。后续可在同一处补上物化。
 */
async function syncEntitlements(
  ctx: { db: typeof import("@karakeep/db").db },
  userId: string,
  planId: keyof typeof PLANS,
) {
  const plan = PLANS[planId];
  const tier = plan.tier as "pro" | "max";
  const limits = TIER_LIMITS[tier];
  const now = new Date();
  const periodEnd = new Date(now.getTime() + plan.periodDays * 24 * 60 * 60 * 1000);

  await ctx.db
    .insert(userEntitlements)
    .values({
      userId,
      tier,
      source: "manual",
      periodStart: now,
      periodEnd,
      ...limits,
    })
    .onConflictDoUpdate({
      target: userEntitlements.userId,
      set: {
        tier,
        periodStart: now,
        periodEnd,
        ...limits,
        updatedAt: new Date(),
      },
    });
}


/**
 * 退款/取消后回收权益，降回免费版。
 *
 * 只降不删：保留一条 tier=free 的记录，便于审计「什么时候被降级的」。
 * 若用户还有其它有效订单，调用方应先重算（当前实现是最简单的一刀切）。
 */
async function revokeEntitlements(
  ctx: { db: typeof import("@karakeep/db").db },
  userId: string,
) {
  const now = new Date();
  await ctx.db
    .insert(userEntitlements)
    .values({
      userId,
      tier: "free",
      source: "manual",
      periodStart: now,
      periodEnd: null,
      aiTokensLimit: 200_000,
      aiCallsLimit: 200,
      storageLimit: GB,
    })
    .onConflictDoUpdate({
      target: userEntitlements.userId,
      set: {
        tier: "free",
        periodStart: now,
        periodEnd: null,
        aiTokensLimit: 200_000,
        aiCallsLimit: 200,
        storageLimit: GB,
        updatedAt: now,
      },
    });
}


/**
 * 按「当前仍然有效的订单」重算权益。
 *
 * 这修正了 `revokeEntitlements` 的一刀切问题：用户可能同时有年付 Pro 与月付 Max，
 * 退掉后者不应该把他降到免费版。
 *
 * 规则：取仍处于 paid/fulfilled 的订单中**最近创建**的一笔，按它的 plan 同步；
 * 一笔都没有才降回 free。
 */
async function recomputeEntitlements(
  ctx: { db: typeof import("@karakeep/db").db },
  userId: string,
) {
  const active = await ctx.db
    .select({ plan: orders.plan })
    .from(orders)
    .where(
      and(
        eq(orders.userId, userId),
        inArray(orders.status, ["paid", "fulfilled"]),
      ),
    )
    .orderBy(desc(orders.createdAt))
    .limit(1);

  if (active.length === 0) {
    await revokeEntitlements(ctx, userId);
    return;
  }

  await syncEntitlements(ctx, userId, active[0].plan as keyof typeof PLANS);
}

export const paymentAppRouter = router({
  /** 计划目录（公开，定价页可直接用） */
  plans: publicProcedure.query(() => {
    return Object.entries(PLANS).map(([id, p]) => ({
      id,
      amountMinor: p.amountMinor,
      currency: p.currency,
      tier: p.tier,
      periodDays: p.periodDays,
    }));
  }),

  createOrder: authedProcedure
    .input(z.object({ plan: zPlan }))
    .mutation(async ({ ctx, input }) => {
      const plan = PLANS[input.plan];
      const providerRef = `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      const [order] = await ctx.db
        .insert(orders)
        .values({
          userId: ctx.user.id,
          provider: "local",
          providerRef,
          plan: input.plan,
          amountMinor: plan.amountMinor,
          currency: plan.currency,
          status: "created",
        })
        .returning();

      return {
        order,
        // 未接入真实通道前，明确告诉前端「暂无支付链接」
        paymentUrl: null,
      };
    }),

  myEntitlement: authedProcedure.query(async ({ ctx }) => {
    const row = await ctx.db.query.userEntitlements.findFirst({
      where: eq(userEntitlements.userId, ctx.user.id),
    });
    return (
      row ?? {
        userId: ctx.user.id,
        tier: "free" as const,
        source: "manual" as const,
        periodStart: null,
        periodEnd: null,
        aiTokensLimit: 200_000,
        aiCallsLimit: 200,
        storageLimit: GB,
        updatedAt: new Date(),
      }
    );
  }),

  myOrders: authedProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(orders)
      .where(eq(orders.userId, ctx.user.id))
      .orderBy(desc(orders.createdAt))
      .limit(50);
  }),

  /**
   * 推进订单状态。仅管理员可用（真实支付接入后由 webhook 调用内部版本）。
   */
  /** 后台订单列表（管理员） */
  adminOrders: authedProcedure
    .input(
      z.object({
        status: z
          .enum([
            "created",
            "pending",
            "paid",
            "fulfilled",
            "failed",
            "refunding",
            "refunded",
            "canceled",
          ])
          .optional(),
        limit: z.number().int().min(1).max(200).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin only" });
      }

      const rows = await ctx.db
        .select({
          id: orders.id,
          userId: orders.userId,
          email: users.email,
          plan: orders.plan,
          status: orders.status,
          amountMinor: orders.amountMinor,
          currency: orders.currency,
          createdAt: orders.createdAt,
          paidAt: orders.paidAt,
          refundedAt: orders.refundedAt,
        })
        .from(orders)
        .leftJoin(users, eq(users.id, orders.userId))
        .where(input.status ? eq(orders.status, input.status) : undefined)
        .orderBy(desc(orders.createdAt))
        .limit(input.limit);

      return { orders: rows, total: rows.length };
    }),

  advanceOrder: authedProcedure
    .input(
      z.object({
        orderId: z.string(),
        to: z.enum([
          "pending",
          "paid",
          "fulfilled",
          "failed",
          "refunding",
          "refunded",
          "canceled",
        ]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin only" });
      }

      const order = await ctx.db.query.orders.findFirst({
        where: eq(orders.id, input.orderId),
      });
      if (!order) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
      }

      const result = applyTransition(order.status as OrderStatus, input.to);
      if (!result.ok) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: result.reason ?? "Illegal transition",
        });
      }
      if (!result.changed) {
        return order; // 幂等：状态没变
      }

      const now = new Date();
      const [updated] = await ctx.db
        .update(orders)
        .set({
          status: result.status,
          ...(result.status === "paid" ? { paidAt: now } : {}),
          ...(result.status === "refunded" ? { refundedAt: now } : {}),
        })
        .where(and(eq(orders.id, order.id), eq(orders.userId, order.userId)))
        .returning();

      // 收到钱的那一刻同步权益（paid 与 fulfilled 都算已付费）
      if (result.status === "paid" || result.status === "fulfilled") {
        await syncEntitlements(ctx, order.userId, order.plan as keyof typeof PLANS);
      }

      // 退款或取消：按剩余有效订单重算（没有其它订单才降回免费版）
      if (result.status === "refunded" || result.status === "canceled") {
        await recomputeEntitlements(ctx, order.userId);
      }

      return updated;
    }),
});
