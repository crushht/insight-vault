import { auth } from "@/server/auth";

/**
 * better-auth 的 catch-all 路由。
 *
 * 注意 `emailOTP` 插件的几个端点：插件本身在实例里是活的
 * （`auth.$context.options.plugins` 里有 `email-otp`，`auth.api.signInEmailOTP` 等
 * 也都在），但 1.7.16 的 `auth.handler()` 没有把它们挂到 HTTP 路由上，
 * 表现为 404。这里手动转发这几个端点。
 *
 * 每个端点的 input 类型不同，不能共用一个 opts 对象，
 * 所以下面各自构造（`as never` 只是绕过泛型推断，运行时没有问题）。
 */

type Json = Record<string, unknown>;

async function readBody(request: Request): Promise<Json> {
  if (request.method !== "POST") return {};
  try {
    return (await request.json()) as Json;
  } catch {
    return {};
  }
}

async function forwardOtp(
  request: Request,
  path: string,
): Promise<Response | null> {
  const body = await readBody(request);
  const headers = request.headers;

  switch (path) {
    case "/api/auth/email-otp/send-verification-otp":
      return (await auth.api.sendVerificationOTP({
        body,
        headers,
        asResponse: true,
      } as never)) as unknown as Response;

    case "/api/auth/email-otp/check-verification-otp":
      return (await auth.api.checkVerificationOTP({
        body,
        headers,
        asResponse: true,
      } as never)) as unknown as Response;

    case "/api/auth/email-otp/verify-email":
      return (await auth.api.verifyEmailOTP({
        body,
        headers,
        asResponse: true,
      } as never)) as unknown as Response;

    case "/api/auth/sign-in/email-otp":
      return (await auth.api.signInEmailOTP({
        body,
        headers,
        asResponse: true,
      } as never)) as unknown as Response;

    case "/api/auth/email-otp/request-password-reset":
      return (await auth.api.requestPasswordResetEmailOTP({
        body,
        headers,
        asResponse: true,
      } as never)) as unknown as Response;

    default:
      return null;
  }
}

async function handler(request: Request) {
  const { pathname } = new URL(request.url);

  if (pathname.includes("otp")) {
    try {
      const res = await forwardOtp(request, pathname);
      if (res) return res;
    } catch (e) {
      const err = e as Error & { status?: number; body?: unknown };
      console.error("[otp-forward] failed:", err);
      return Response.json(
        {
          message: "OTP endpoint failed",
          detail: err?.message ?? String(e),
          name: err?.name ?? null,
          status: err?.status ?? null,
          stack: (err?.stack ?? "").split("\n").slice(0, 6).join(" | "),
        },
        { status: 500 },
      );
    }
  }

  return auth.handler(request);
}

export { handler as GET, handler as POST };
