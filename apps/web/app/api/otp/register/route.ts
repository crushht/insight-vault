import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@karakeep/db";
import { users } from "@karakeep/db/schema";
import serverConfig from "@karakeep/shared/config";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  zUserNameSchema,
} from "@karakeep/shared/types/users";
import { verifyTurnstileToken } from "@karakeep/trpc/lib/turnstile";

import { TURNSTILE_TOKEN_HEADER } from "@/lib/auth/constants";
import {
  consumeOtp,
  markVerificationEmailHandled,
  OtpError,
} from "@/lib/auth/otp";
import { auth } from "@/server/auth";

/**
 * 注册：邮箱 + 密码 + 邮箱验证码，一次完成。
 *
 * 为什么不用 better-auth 默认的 `/sign-up/email`：
 *   1. 它只会发一封「验证链接 / 验证码」的邮件，用户还得再走一步；
 *   2. 只有 SMTP 可用时它才能发信，本地（桌面版）场景直接卡住。
 *
 * 这里的顺序是：先校验验证码（证明邮箱归属）→ 再建账号 → 标记邮箱已验证
 * → 直接签发 session（cookie 一并带回去），用户注册完就是登录态。
 */

const zBody = z.object({
  name: zUserNameSchema.optional(),
  email: z.string().email(),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
  code: z.string().regex(/^\d{6}$/),
  turnstileToken: z.string().optional(),
});

function jsonError(message: string, status: number) {
  return NextResponse.json({ message }, { status });
}

/** 把 better-auth 响应里的 Set-Cookie 搬到我们自己的 JSON 响应上。 */
function forwardCookies(from: Response, body: unknown, status = 200) {
  const out = NextResponse.json(body, { status });
  const cookies =
    typeof (from.headers as { getSetCookie?: () => string[] }).getSetCookie ===
    "function"
      ? (from.headers as { getSetCookie: () => string[] }).getSetCookie()
      : [];
  for (const cookie of cookies) {
    out.headers.append("set-cookie", cookie);
  }
  return out;
}

export async function POST(request: Request) {
  if (serverConfig.auth.disableSignups) {
    return jsonError("本实例已关闭注册", 403);
  }
  if (serverConfig.auth.disablePasswordAuth) {
    return jsonError("本实例已关闭密码登录", 403);
  }

  let parsed: z.infer<typeof zBody>;
  try {
    parsed = zBody.parse(await request.json());
  } catch (e) {
    const message =
      e instanceof z.ZodError
        ? (e.issues[0]?.message ?? "参数不合法")
        : "参数不合法";
    return jsonError(message, 400);
  }

  const email = parsed.email.trim().toLowerCase();
  const name = (parsed.name ?? "").trim() || email.split("@")[0] || "用户";

  if (serverConfig.auth.turnstile.enabled) {
    const result = await verifyTurnstileToken(
      request.headers.get(TURNSTILE_TOKEN_HEADER) ??
        parsed.turnstileToken ??
        "",
      request.headers.get("x-forwarded-for") ?? null,
    );
    if (!result.success) {
      return jsonError("人机校验未通过，请重试", 400);
    }
  }

  const existing = await db.query.users.findFirst({
    where: eq(users.email, email),
  });
  if (existing) {
    return jsonError("该邮箱已注册，请直接登录", 409);
  }

  // 验证码必须对应「注册」用途（登录码不能拿来注册）
  let purpose: Awaited<ReturnType<typeof consumeOtp>> = null;
  try {
    purpose = await consumeOtp(email, parsed.code, ["sign-up"]);
  } catch (e) {
    console.error("[register] 校验验证码失败:", e);
    return jsonError("验证服务异常，请稍后重试", 500);
  }
  if (purpose !== "sign-up") {
    return jsonError("验证码不正确或已过期，请重新获取", 401);
  }

  // 已验证过邮箱，别再让 better-auth 的注册钩子重复发一封验证邮件
  markVerificationEmailHandled(email);

  let signUpResponse: Response;
  try {
    signUpResponse = (await auth.api.signUpEmail({
      body: { name, email, password: parsed.password },
      headers: request.headers,
      asResponse: true,
    } as never)) as unknown as Response;
  } catch (e) {
    const message =
      e instanceof OtpError
        ? e.message
        : ((e as { body?: { message?: string } })?.body?.message ??
          "注册失败，请稍后重试");
    console.error("[register] 创建账号失败:", e);
    return jsonError(message, 400);
  }

  if (!signUpResponse.ok) {
    const data = (await signUpResponse
      .json()
      .catch(() => null)) as { message?: string } | null;
    return jsonError(data?.message ?? "注册失败，请稍后重试", signUpResponse.status);
  }

  // 验证码已证明邮箱归属
  await db
    .update(users)
    .set({ emailVerified: true })
    .where(eq(users.email, email));

  // requireEmailVerification 打开时，注册不会直接签 session，这里补一次登录
  if (serverConfig.auth.emailVerificationRequired) {
    try {
      const signInResponse = (await auth.api.signInEmail({
        body: { email, password: parsed.password },
        headers: request.headers,
        asResponse: true,
      } as never)) as unknown as Response;
      return forwardCookies(signInResponse, { ok: true });
    } catch (e) {
      console.error("[register] 自动登录失败:", e);
      return NextResponse.json({
        ok: true,
        signInRequired: true,
        message: "账号已创建，请用邮箱和密码登录",
      });
    }
  }

  return forwardCookies(signUpResponse, { ok: true });
}
