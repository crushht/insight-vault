/**
 * 订单状态机（P7）。
 *
 * 把「哪些状态能转到哪些状态」收敛成一张表，路由与 webhook 都调它，
 * 避免两处各写一套 if —— 那正是漏掉 `refunding` 这类中间态的原因。
 *
 *   created ──▶ pending ──▶ paid ──▶ fulfilled ──▶ refunding ──▶ refunded
 *      │            │          │                        │
 *      └▶ canceled  └▶ failed  └▶ refunding             └▶ failed
 */

export type OrderStatus =
  | "created"
  | "pending"
  | "paid"
  | "fulfilled"
  | "failed"
  | "refunding"
  | "refunded"
  | "canceled";

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  created: ["pending", "canceled", "failed"],
  pending: ["paid", "failed", "canceled"],
  paid: ["fulfilled", "refunding"],
  fulfilled: ["refunding"],
  refunding: ["refunded", "failed"],
  // 以下为终态
  failed: [],
  refunded: [],
  canceled: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function allowedTransitions(from: OrderStatus): OrderStatus[] {
  return [...(TRANSITIONS[from] ?? [])];
}

/** 是否为「已经收到钱」的状态（权益应生效） */
export function isPaidStatus(status: OrderStatus): boolean {
  return status === "paid" || status === "fulfilled";
}

/** 是否已终结（不会再变） */
export function isTerminalStatus(status: OrderStatus): boolean {
  return TRANSITIONS[status]?.length === 0;
}

export interface TransitionResult {
  ok: boolean;
  status: OrderStatus;
  /** 实际发生了状态变化（幂等重复调用时 false） */
  changed: boolean;
  reason?: string;
}

/**
 * 申请一次状态迁移。
 *
 * - 目标状态与当前相同：`ok=true, changed=false`（幂等，webhook 重放安全）；
 * - 非法迁移：`ok=false`，`status` 保持原值，`reason` 说明。
 */
export function applyTransition(
  current: OrderStatus,
  next: OrderStatus,
): TransitionResult {
  if (current === next) {
    return { ok: true, status: current, changed: false };
  }
  if (!canTransition(current, next)) {
    return {
      ok: false,
      status: current,
      changed: false,
      reason: `illegal transition ${current} -> ${next}`,
    };
  }
  return { ok: true, status: next, changed: true };
}
