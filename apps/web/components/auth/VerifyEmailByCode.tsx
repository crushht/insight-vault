"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * 用 6 位验证码验证邮箱（替代点开邮件里的链接）。
 *
 * 注册时我们发的是验证码而不是链接 —— 因为桌面端/手机端点到邮箱再点回来太麻烦。
 * 链接方式仍然可用（上游逻辑保留），这里只是多给一条路。
 */
export function VerifyEmailByCode({ defaultEmail = "" }: { defaultEmail?: string }) {
  const [email, setEmail] = useState(defaultEmail);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async () => {
    if (!email.trim() || !/^\d{6}$/.test(code.trim())) {
      setMsg({ ok: false, text: "请填写邮箱与 6 位验证码" });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/otp/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), code: code.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        setMsg({ ok: false, text: data.message ?? "验证失败" });
        return;
      }
      // 服务端会把 session cookie 一并写好
      window.location.href = "/";
    } catch {
      setMsg({ ok: false, text: "网络异常，请重试" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface-sunken/40 p-4">
      <p className="text-caption font-medium text-muted-foreground">
        收到的是 6 位验证码？在这里直接填
      </p>
      <Input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        autoComplete="email"
        disabled={busy}
      />
      <Input
        inputMode="numeric"
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
        placeholder="6 位验证码"
        autoComplete="one-time-code"
        disabled={busy}
        className="text-center text-lg tracking-[0.4em]"
      />
      <Button type="button" className="w-full" onClick={() => void submit()} disabled={busy}>
        {busy && <Loader2 className="mr-1 size-3.5 animate-spin" />}
        验证并登录
      </Button>
      {msg && (
        <p className={`text-caption ${msg.ok ? "text-success" : "text-destructive"}`}>
          {msg.text}
        </p>
      )}
    </div>
  );
}
