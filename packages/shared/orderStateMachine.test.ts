import { describe, expect, it } from "vitest";

import {
  allowedTransitions,
  applyTransition,
  canTransition,
  isPaidStatus,
  isTerminalStatus,
  type OrderStatus,
} from "./orderStateMachine";

describe("canTransition", () => {
  it("allows the happy path", () => {
    expect(canTransition("created", "pending")).toBe(true);
    expect(canTransition("pending", "paid")).toBe(true);
    expect(canTransition("paid", "fulfilled")).toBe(true);
    expect(canTransition("fulfilled", "refunding")).toBe(true);
    expect(canTransition("refunding", "refunded")).toBe(true);
  });

  it("rejects skipping paid", () => {
    expect(canTransition("created", "fulfilled")).toBe(false);
    expect(canTransition("pending", "fulfilled")).toBe(false);
  });

  it("rejects moving out of terminal states", () => {
    expect(canTransition("refunded", "paid")).toBe(false);
    expect(canTransition("canceled", "pending")).toBe(false);
    expect(canTransition("failed", "paid")).toBe(false);
  });

  it("allows refund from paid without fulfilment", () => {
    expect(canTransition("paid", "refunding")).toBe(true);
  });
});

describe("allowedTransitions", () => {
  it("lists what a paid order can do", () => {
    expect(allowedTransitions("paid").sort()).toEqual(["fulfilled", "refunding"]);
  });

  it("returns nothing for terminal states", () => {
    for (const s of ["refunded", "canceled", "failed"] as OrderStatus[]) {
      expect(allowedTransitions(s)).toEqual([]);
    }
  });
});

describe("isPaidStatus", () => {
  it("treats paid and fulfilled as paid", () => {
    expect(isPaidStatus("paid")).toBe(true);
    expect(isPaidStatus("fulfilled")).toBe(true);
  });

  it("does not treat pending or refunding as paid", () => {
    expect(isPaidStatus("pending")).toBe(false);
    expect(isPaidStatus("refunding")).toBe(false);
    expect(isPaidStatus("refunded")).toBe(false);
  });
});

describe("isTerminalStatus", () => {
  it("detects terminal states", () => {
    expect(isTerminalStatus("refunded")).toBe(true);
    expect(isTerminalStatus("canceled")).toBe(true);
    expect(isTerminalStatus("failed")).toBe(true);
  });

  it("detects non-terminal states", () => {
    expect(isTerminalStatus("paid")).toBe(false);
    expect(isTerminalStatus("refunding")).toBe(false);
  });
});

describe("applyTransition", () => {
  it("applies a legal transition", () => {
    const r = applyTransition("pending", "paid");
    expect(r).toEqual({ ok: true, status: "paid", changed: true });
  });

  it("is idempotent for the same status", () => {
    const r = applyTransition("paid", "paid");
    expect(r.ok).toBe(true);
    expect(r.changed).toBe(false);
    expect(r.status).toBe("paid");
  });

  it("refuses illegal transitions and keeps the old status", () => {
    const r = applyTransition("created", "refunded");
    expect(r.ok).toBe(false);
    expect(r.status).toBe("created");
    expect(r.reason).toContain("illegal transition");
  });

  it("protects against webhook replay after refund", () => {
    // 已退款订单又收到一次「已支付」回调
    const r = applyTransition("refunded", "paid");
    expect(r.ok).toBe(false);
    expect(r.status).toBe("refunded");
  });
});
