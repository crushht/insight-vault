"use client";

import { Heart } from "lucide-react";
import Image from "next/image";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * 支持灵感仓。
 *
 * 没有会员、没有订阅、没有额度墙：
 * 产品免费使用，AI 靠你自己接的模型，觉得有用可以自愿打赏。
 */
export default function SupportPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="font-display text-h2 font-semibold tracking-tight">
          支持灵感仓
        </h1>
        <p className="mt-1 text-body text-muted-foreground">
          完全免费，不卖订阅。模型在「设置 → AI」里配；觉得好用可以自愿打赏。
        </p>
      </div>

      <Card>
        <CardHeader className="py-3">
          <CardTitle className="flex items-center gap-2 text-body">
            <Heart className="size-4 text-brand-600" />
            愿意的话，打赏一杯咖啡
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4 py-6">
          <div className="rounded-xl border border-border bg-white p-3 shadow-e1">
            <Image
              src="/donation-wechat.png"
              alt="微信赞赏码"
              width={260}
              height={354}
              className="rounded-lg"
              priority
            />
          </div>
          <p className="max-w-sm text-center text-caption text-muted-foreground">
            微信扫码，金额随意。打赏不为解锁任何东西 —— 所有功能本来就是免费的。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
