"use client";

import { useState } from "react";
import { Loader2, Mail } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * 邮箱验证码登录。
 *
 * 两步：填邮箱 → 发码；填 6 位码 → 登录。
 * 后端是自己实现的（`/api/otp/request` + `/api/otp/sign-in`），
 * 不走 better-auth 的 emailOTP 插件 —— 那个插件的 HTTP 路由在 1.7.16 里没挂上。
 */
export function OtpSignInForm() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const sendCode = async () => {
    if (!email.trim()) {
      setMsg({ ok: false, text: "请先填写邮箱" });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/otp/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        setMsg({ ok: false, text: data.message ?? "发送失败" });
        return;
      }
      setStage("code");
      setMsg({ ok: true, text: "验证码已发送，请查收邮件（5 分钟内有效）" });
    } catch {
      setMsg({ ok: false, text: "网络异常，请重试" });
    } finally {
      setBusy(false);
    }
  };

  const signIn = async () => {
    if (!/^\d{6}$/.test(code.trim())) {
      setMsg({ ok: false, text: "请输入 6 位数字验证码" });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/otp/sign-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), code: code.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        setMsg({ ok: false, text: data.message ?? "登录失败" });
        return;
      }
      // 服务端已经把 session cookie 写好了
      window.location.href = "/";
    } catch {
      setMsg({ ok: false, text: "网络异常，请重试" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-caption font-medium text-muted-foreground">
        <Mail className="size-3.5" />
        或用邮箱验证码登录
      </div>

      <Input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        autoComplete="email"
        disabled={busy || stage === "code"}
      />

      {stage === "code" && (
        <Input
          inputMode="numeric"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="6 位验证码"
          autoComplete="one-time-code"
          disabled={busy}
          className="tracking-[0.4em] text-center text-lg"
        />
      )}

      <div className="flex gap-2">
        {stage === "email" ? (
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => void sendCode()}
            disabled={busy}
          >
            {busy && <Loader2 className="mr-1 size-3.5 animate-spin" />}
            发送验证码
          </Button>
        ) : (
          <>
            <Button
              type="button"
              className="flex-1"
              onClick={() => void signIn()}
              disabled={busy}
            >
              {busy && <Loader2 className="mr-1 size-3.5 animate-spin" />}
              登录
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setStage("email");
                setCode("");
                setMsg(null);
              }}
              disabled={busy}
            >
              重新发码
            </Button>
          </>
        )}
      </div>

      {msg && (
        <p className={`text-caption ${msg.ok ? "text-success" : "text-destructive"}`}>
          {msg.text}
        </p>
      )}
    </div>
  );
}
