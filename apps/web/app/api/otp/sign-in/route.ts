import { and, eq, gt } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@karakeep/db";
import { accounts, users, verificationTokens } from "@karakeep/db/schema";
import { hashPassword } from "@karakeep/trpc/auth";

import { auth } from "@/server/auth";

/**
 * 用邮箱验证码登录。
 *
 * 思路：better-auth 的 `signInEmail` 是完整可用的（生成 session + Set-Cookie），
 * 只是它要密码。所以这里：
 *   1. 校验 6 位码；
 *   2. 把该用户的密码**临时**换成一个随机值；
 *   3. 调 `auth.api.signInEmail`，把它的 Response（含 Set-Cookie）原样透传；
 *   4. 无论成功失败都把原密码 hash 写回去。
 *
 * 这样不需要复现 better-auth 的 cookie 签名，也不用改它的配置。
 */

const zBody = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/),
});

const IDENTIFIER_PREFIX = "otp:";

export async function POST(request: Request) {
  let parsed: z.infer<typeof zBody>;
  try {
    parsed = zBody.parse(await request.json());
  } catch {
    return NextResponse.json(
      { message: "请输入邮箱与 6 位验证码" },
      { status: 400 },
    );
  }

  const email = parsed.email.trim().toLowerCase();
  const identifier = `${IDENTIFIER_PREFIX}${email}`;

  // 1) 校验码
  const token = await db.query.verificationTokens.findFirst({
    where: and(
      eq(verificationTokens.identifier, identifier),
      eq(verificationTokens.value, parsed.code),
      gt(verificationTokens.expiresAt, new Date()),
    ),
  });
  if (!token) {
    return NextResponse.json(
      { message: "验证码不正确或已过期" },
      { status: 401 },
    );
  }

  const user = await db.query.users.findFirst({
    where: eq(users.email, email),
  });
  if (!user) {
    return NextResponse.json({ message: "账号不存在" }, { status: 401 });
  }

  // 2) 备份原密码，改成一个一次性随机密码
  const credential = await db.query.accounts.findFirst({
    where: and(
      eq(accounts.userId, user.id),
      eq(accounts.providerId, "credential"),
    ),
  });
  const originalHash = credential?.password ?? null;

  const tempPassword = `__otp_${crypto.randomUUID()}__`;
  const tempHash = await hashPassword(tempPassword);

  try {
    if (credential) {
      await db
        .update(accounts)
        .set({ password: tempHash })
        .where(eq(accounts.id, credential.id));
    } else {
      // 只有 OAuth 账号、没有密码：建一条 credential 记录
      await db.insert(accounts).values({
        userId: user.id,
        providerId: "credential",
        accountId: user.id,
        password: tempHash,
      });
    }

    // 3) 走 better-auth 的正规登录，拿它的 Set-Cookie
    const res = (await auth.api.signInEmail({
      body: { email, password: tempPassword },
      headers: request.headers,
      asResponse: true,
    } as never)) as unknown as Response;

    // 4) 恢复原密码（没有原密码就删掉临时记录）
    if (credential) {
      await db
        .update(accounts)
        .set({ password: originalHash })
        .where(eq(accounts.id, credential.id));
    } else {
      await db.delete(accounts).where(
        and(
          eq(accounts.userId, user.id),
          eq(accounts.providerId, "credential"),
        ),
      );
    }

    // 消费掉验证码
    await db
      .delete(verificationTokens)
      .where(eq(verificationTokens.identifier, identifier));

    return res;
  } catch (e) {
    // 出错也要把密码还原
    if (credential && originalHash !== null) {
      await db
        .update(accounts)
        .set({ password: originalHash })
        .where(eq(accounts.id, credential.id));
    }
    console.error("[otp] 登录失败:", e);
    return NextResponse.json(
      { message: "登录失败，请稍后重试" },
      { status: 500 },
    );
  }
}
