import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@karakeep/db";
import { users } from "@karakeep/db/schema";

import { OtpError, sendOtp } from "@/lib/auth/otp";

/**
 * 发送邮箱验证码。
 *
 * purpose：
 *   - "sign-in"（默认）：已注册账号免密码登录，5 分钟有效；
 *   - "sign-up"：注册时验证邮箱归属，15 分钟有效。
 *
 * 没配 SMTP 时，只有**本机回环请求**会把验证码直接回给前端（桌面版开箱即用）；
 * 其它来源一律 501，避免公网实例把验证码发给随便一个人。
 */

const zBody = z.object({
  email: z.string().email(),
  purpose: z.enum(["sign-in", "sign-up"]).default("sign-in"),
});

export async function POST(request: Request) {
  let parsed: z.infer<typeof zBody>;
  try {
    parsed = zBody.parse(await request.json());
  } catch {
    return NextResponse.json({ message: "请输入有效的邮箱地址" }, { status: 400 });
  }

  const email = parsed.email.trim().toLowerCase();

  const user = await db.query.users.findFirst({
    where: eq(users.email, email),
  });

  if (parsed.purpose === "sign-up") {
    if (user) {
      return NextResponse.json(
        { message: "该邮箱已注册，请直接登录" },
        { status: 409 },
      );
    }
  } else if (!user) {
    // 不暴露「该邮箱是否注册过」：无论存在与否都返回成功
    return NextResponse.json({ ok: true, delivery: "email" });
  }

  try {
    const result = await sendOtp(email, parsed.purpose, request.headers);
    return NextResponse.json({
      ok: true,
      delivery: result.delivery,
      code: result.code,
      expiresInMinutes: result.expiresInMinutes,
      message:
        result.delivery === "inline"
          ? "未配置邮件服务（SMTP），已启用本地模式：验证码直接显示在下方"
          : "验证码已发送，请查收邮件",
    });
  } catch (e) {
    if (e instanceof OtpError) {
      return NextResponse.json({ message: e.message }, { status: e.status });
    }
    console.error("[otp] request failed:", e);
    return NextResponse.json({ message: "发送失败，请稍后重试" }, { status: 500 });
  }
}
