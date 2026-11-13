import { and, eq, gt } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@karakeep/db";
import { accounts, users, verificationTokens } from "@karakeep/db/schema";
import { hashPassword } from "@karakeep/trpc/auth";

import { auth } from "@/server/auth";

/**
 * 用 6 位验证码验证邮箱，并直接登录。
 *
 * 和 `/api/otp/sign-in` 的区别：这里会把 `user.emailVerified` 置为 true。
 * 验证码接受两种来源（同一个码两用）：
 *   - `otp:verify:<email>` —— 注册时自动发的那封（15 分钟）
 *   - `otp:<email>`        —— 登录页点「发送验证码」时发的（5 分钟）
 * 这样用户从邮箱里拿到的码，既能验证邮箱也能登录，不用分辨是哪种。
 */

const zBody = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/),
});

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

  const candidates = [`otp:verify:${email}`, `otp:${email}`];
  let matched: { identifier: string } | null = null;

  for (const identifier of candidates) {
    const token = await db.query.verificationTokens.findFirst({
      where: and(
        eq(verificationTokens.identifier, identifier),
        eq(verificationTokens.value, parsed.code),
        gt(verificationTokens.expiresAt, new Date()),
      ),
    });
    if (token) {
      matched = { identifier };
      break;
    }
  }

  if (!matched) {
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

  // 标记邮箱已验证
  if (!user.emailVerified) {
    await db
      .update(users)
      .set({ emailVerified: true })
      .where(eq(users.id, user.id));
  }

  // 清掉两种码
  for (const identifier of candidates) {
    await db
      .delete(verificationTokens)
      .where(eq(verificationTokens.identifier, identifier));
  }

  // 顺便登录：临时换密码 → better-auth 正规登录 → 还原
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
      await db.insert(accounts).values({
        userId: user.id,
        providerId: "credential",
        accountId: user.id,
        password: tempHash,
      });
    }

    const res = (await auth.api.signInEmail({
      body: { email, password: tempPassword },
      headers: request.headers,
      asResponse: true,
    } as never)) as unknown as Response;

    if (credential) {
      await db
        .update(accounts)
        .set({ password: originalHash })
        .where(eq(accounts.id, credential.id));
    } else {
      await db
        .delete(accounts)
        .where(
          and(
            eq(accounts.userId, user.id),
            eq(accounts.providerId, "credential"),
          ),
        );
    }

    return res;
  } catch (e) {
    if (credential && originalHash !== null) {
      await db
        .update(accounts)
        .set({ password: originalHash })
        .where(eq(accounts.id, credential.id));
    }
    console.error("[otp] verify-email 登录失败:", e);
    // 邮箱已标记验证，登录失败也让前端知道
    return NextResponse.json(
      { ok: true, verified: true, signInFailed: true },
      { status: 200 },
    );
  }
}
