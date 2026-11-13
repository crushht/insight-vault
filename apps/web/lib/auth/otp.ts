/**
 * 邮箱验证码（OTP）的公共实现。
 *
 * 两个用途共用一套存储（`verification_tokens` 表）：
 *   - sign-up：注册时验证邮箱归属（15 分钟）
 *   - sign-in：免密码登录（5 分钟）
 *
 * 为什么不直接使用 better-auth 的 emailOTP 插件：1.7.16 的 `auth.handler()`
 * 没有把插件路由挂上去（404），所以这里自己发码、自己校验，登录仍然走
 * better-auth 的 `auth.api.signInEmail` 以拿到它签发的 session cookie。
 *
 * 投递策略：
 *   - 配了 SMTP → 发邮件；
 *   - 没配 SMTP 但请求来自本机回环地址（桌面版就是这种）→ 直接把码回给前端，
 *     界面上显示「本地模式验证码」。这样单机 / 本地优先的安装开箱即用；
 *   - 其它情况 → 明确报错，不静默失败。
 */

import { and, eq, gt, lt } from "drizzle-orm";

import { db } from "@karakeep/db";
import { verificationTokens } from "@karakeep/db/schema";
import serverConfig from "@karakeep/shared/config";
import { sendOtpEmail } from "@karakeep/trpc/email";

export type OtpPurpose = "sign-in" | "sign-up";

const TTL_MS: Record<OtpPurpose, number> = {
  "sign-in": 5 * 60 * 1000,
  "sign-up": 15 * 60 * 1000,
};

/** 每个邮箱的发码冷却与小时上限（内存级，够单实例用）。 */
const COOLDOWN_MS = 60 * 1000;
const MAX_PER_HOUR = 8;
const HOUR_MS = 60 * 60 * 1000;

const lastSentAt = new Map<string, number>();
const sentWindow = new Map<string, number[]>();

export interface SendOtpResult {
  /** 投递方式：邮件 / 本地直显 */
  delivery: "email" | "inline";
  /** delivery === "inline" 时才有值 */
  code?: string;
  expiresInMinutes: number;
}

export function identifierFor(purpose: OtpPurpose, email: string): string {
  return purpose === "sign-up" ? `otp:signup:${email}` : `otp:${email}`;
}

export function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function checkThrottle(key: string): string | null {
  const now = Date.now();
  const last = lastSentAt.get(key);
  if (last && now - last < COOLDOWN_MS) {
    return `发送太频繁，请 ${Math.ceil((COOLDOWN_MS - (now - last)) / 1000)} 秒后再试`;
  }
  const window = (sentWindow.get(key) ?? []).filter((t) => now - t < HOUR_MS);
  if (window.length >= MAX_PER_HOUR) {
    return "该邮箱一小时内发送次数过多，请稍后再试";
  }
  lastSentAt.set(key, now);
  window.push(now);
  sentWindow.set(key, window);
  return null;
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "127.0.0.1" ||
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname === ""
  );
}

function isLoopbackIp(ip: string): boolean {
  return (
    ip === "" ||
    ip === "127.0.0.1" ||
    ip === "localhost" ||
    ip === "::1" ||
    ip === "::ffff:127.0.0.1"
  );
}

/**
 * 判断请求是不是来自本机（桌面版 / 本地部署）。
 *
 * Next 即便直连也会补 `x-forwarded-for` / `x-forwarded-host`，所以两边都要看：
 * Host 必须是回环地址，客户端 IP 也必须是回环；经过反代的公网请求会被第一关挡掉。
 */
export function isLocalRequest(headers: Headers): boolean {
  const host = (
    headers.get("x-forwarded-host") ??
    headers.get("host") ??
    ""
  ).toLowerCase();
  const hostname = host.replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  if (!isLoopbackHost(hostname)) {
    return false;
  }
  const ip = (
    headers.get("x-forwarded-for") ??
    headers.get("x-real-ip") ??
    ""
  )
    .split(",")[0]
    .trim()
    .toLowerCase();
  return isLoopbackIp(ip);
}

/**
 * 本地模式是否允许「验证码直接回显」。
 *
 *   - `LOCAL_AUTH_CODE=1`：显式打开（自动化测试、纯本地跑也用这个，压过 SMTP 配置）
 *   - 桌面版（DESKTOP_APP=1）
 *   - 非生产环境（本地开发）
 *
 * 并且必须来自本机回环，公网实例即使忘了配 SMTP 也不会把码发给陌生人。
 */
function inlineCodeAllowed(): boolean {
  if (process.env.LOCAL_AUTH_CODE === "1") {
    return true;
  }
  return (
    process.env.DESKTOP_APP === "1" || process.env.NODE_ENV !== "production"
  );
}

export function canDeliverOtpInline(headers: Headers): boolean {
  if (!isLocalRequest(headers)) {
    return false;
  }
  if (process.env.LOCAL_AUTH_CODE === "1") {
    return true;
  }
  return !serverConfig.email.smtp && inlineCodeAllowed();
}

export async function issueOtp(
  email: string,
  purpose: OtpPurpose,
): Promise<string> {
  const identifier = identifierFor(purpose, email);
  const code = generateOtp();

  // 每邮箱每用途只保留最新一个码；顺手清掉过期行
  await db
    .delete(verificationTokens)
    .where(eq(verificationTokens.identifier, identifier));
  await db
    .delete(verificationTokens)
    .where(lt(verificationTokens.expiresAt, new Date()));
  await db.insert(verificationTokens).values({
    identifier,
    value: code,
    expiresAt: new Date(Date.now() + TTL_MS[purpose]),
  });

  return code;
}

/** 发送验证码。返回投递方式；本地模式下直接把码带回去。 */
export async function sendOtp(
  email: string,
  purpose: OtpPurpose,
  headers: Headers,
): Promise<SendOtpResult> {
  const throttle = checkThrottle(`${purpose}:${email}`);
  if (throttle) {
    throw new OtpError(throttle, 429);
  }

  const code = await issueOtp(email, purpose);

  if (serverConfig.email.smtp) {
    try {
      await sendOtpEmail(email, code, {
        expiresInMinutes: TTL_MS[purpose] / 60000,
        purpose: purpose === "sign-up" ? "email-verification" : "sign-in",
      });
    } catch (e) {
      console.error("[otp] 发信失败:", e);
      await db
        .delete(verificationTokens)
        .where(
          eq(verificationTokens.identifier, identifierFor(purpose, email)),
        );
      throw new OtpError("邮件发送失败，请检查 SMTP 配置后再试", 502);
    }
    return {
      delivery: "email",
      expiresInMinutes: TTL_MS[purpose] / 60000,
    };
  }

  if (canDeliverOtpInline(headers)) {
    return {
      delivery: "inline",
      code,
      expiresInMinutes: TTL_MS[purpose] / 60000,
    };
  }

  await db
    .delete(verificationTokens)
    .where(eq(verificationTokens.identifier, identifierFor(purpose, email)));
  throw new OtpError(
    "本实例没有配置邮件服务（SMTP），无法发送验证码。请联系管理员。",
    501,
  );
}

/**
 * 注册流程用验证码证明了邮箱归属之后，better-auth 的 `sendVerificationEmail`
 * 钩子还会再发一封（`sendOnSignUp`）。这个集合用来吞掉那次重复发送。
 * 进程内即可：注册的校验与建号出现在同一个请求里。
 */
const verificationEmailHandled = new Set<string>();

export function markVerificationEmailHandled(email: string) {
  const key = email.toLowerCase();
  verificationEmailHandled.add(key);
  setTimeout(() => verificationEmailHandled.delete(key), 2 * 60 * 1000);
}

export function shouldSkipVerificationEmail(email: string): boolean {
  const key = email.toLowerCase();
  if (!verificationEmailHandled.has(key)) {
    return false;
  }
  verificationEmailHandled.delete(key);
  return true;
}

export class OtpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "OtpError";
  }
}

/**
 * 校验验证码。命中即视为一次性凭据，会被删掉。
 * 允许一次传入多个用途（例如注册码也能直接用来登录）。
 */
export async function consumeOtp(
  email: string,
  code: string,
  purposes: OtpPurpose[],
): Promise<OtpPurpose | null> {
  for (const purpose of purposes) {
    const identifier = identifierFor(purpose, email);
    const row = await db.query.verificationTokens.findFirst({
      where: and(
        eq(verificationTokens.identifier, identifier),
        eq(verificationTokens.value, code),
        gt(verificationTokens.expiresAt, new Date()),
      ),
    });
    if (!row) {
      continue;
    }
    await db
      .delete(verificationTokens)
      .where(eq(verificationTokens.identifier, identifier));
    return purpose;
  }
  return null;
}
