"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import { useTRPC } from "@karakeep/shared-react/trpc";

import { ActionButton } from "@/components/ui/action-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * 后台订单管理（P7）。
 *
 * 只做「看」与「推进状态」两件事 —— 真实支付通道接入后，这里的推进动作
 * 会被 webhook 取代，但保留它用于客服补单与退款处理。
 */

const NEXT_ACTIONS: Record<string, { to: string; label: string }[]> = {
  created: [{ to: "pending", label: "标记待支付" }],
  pending: [
    { to: "paid", label: "标记已支付" },
    { to: "failed", label: "标记失败" },
  ],
  paid: [
    { to: "fulfilled", label: "标记已履约" },
    { to: "refunding", label: "发起退款" },
  ],
  refunding: [{ to: "refunded", label: "确认退款" }],
};

const STATUS_LABEL: Record<string, string> = {
  created: "已创建",
  pending: "待支付",
  paid: "已支付",
  fulfilled: "已履约",
  failed: "失败",
  refunding: "退款中",
  refunded: "已退款",
  canceled: "已取消",
};

export default function AdminOrdersPage() {
  const api = useTRPC();
  const [busy, setBusy] = useState<string | null>(null);

  const orders = useQuery(
    api.payment.adminOrders.queryOptions({ limit: 100 }),
  );
  const advance = useMutation(
    api.payment.advanceOrder.mutationOptions({
      onSettled: async () => {
        setBusy(null);
        await orders.refetch();
      },
    }),
  );

  const rows = orders.data?.orders ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-body">
            订单
            <span className="ml-2 text-caption font-normal text-muted-foreground">
              共 {rows.length} 条（最近 100）
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {orders.isLoading && (
            <p className="p-4 text-caption text-muted-foreground">加载中…</p>
          )}
          {orders.isError && (
            <p className="p-4 text-caption text-destructive">
              {String((orders.error as { message?: string })?.message ?? "加载失败")}
            </p>
          )}
          {!orders.isLoading && rows.length === 0 && (
            <p className="p-4 text-caption text-muted-foreground">暂无订单。</p>
          )}
          {rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-caption">
                <thead className="border-b border-border text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-normal">用户</th>
                    <th className="px-2 py-2 text-left font-normal">方案</th>
                    <th className="px-2 py-2 text-left font-normal">状态</th>
                    <th className="px-2 py-2 text-right font-normal">金额</th>
                    <th className="px-2 py-2 text-left font-normal">创建时间</th>
                    <th className="px-2 py-2 text-left font-normal">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((o) => (
                    <tr key={o.id} className="border-b border-border/60 last:border-0">
                      <td className="max-w-[12rem] truncate px-3 py-2">
                        {o.email ?? o.userId}
                      </td>
                      <td className="px-2 py-2">{o.plan}</td>
                      <td className="px-2 py-2">
                        <span className="rounded-full bg-surface-sunken px-2 py-0.5">
                          {STATUS_LABEL[o.status] ?? o.status}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {(o.amountMinor / 100).toFixed(2)} {o.currency}
                      </td>
                      <td className="px-2 py-2 text-muted-foreground">
                        {new Date(o.createdAt).toLocaleString("zh-CN")}
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex flex-wrap gap-1">
                          {(NEXT_ACTIONS[o.status] ?? []).map((a) => (
                            <ActionButton
                              key={a.to}
                              size="sm"
                              variant="outline"
                              loading={busy === `${o.id}:${a.to}`}
                              ignoreDemoMode
                              onClick={() => {
                                setBusy(`${o.id}:${a.to}`);
                                advance.mutate({ orderId: o.id, to: a.to as never });
                              }}
                            >
                              {a.label}
                            </ActionButton>
                          ))}
                          {!(NEXT_ACTIONS[o.status] ?? []).length && (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
