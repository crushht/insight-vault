"use client";

import type { TurnstileInstance } from "@marsidev/react-turnstile";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { ActionButton } from "@/components/ui/action-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { registerWithCode, requestEmailCode } from "@/lib/auth/client";
import { useClientConfig } from "@/lib/clientConfig";
import { useTranslation } from "@/lib/i18n/client";
import { zodResolver } from "@hookform/resolvers/zod";
import { Turnstile } from "@marsidev/react-turnstile";
import { AlertCircle, CheckCircle2, Loader2, UserX } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  zUserNameSchema,
} from "@karakeep/shared/types/users";

const signUpWithCodeSchema = z
  .object({
    name: zUserNameSchema,
    email: z.string().email("请输入有效的邮箱地址"),
    password: z
      .string()
      .min(PASSWORD_MIN_LENGTH, `密码至少 ${PASSWORD_MIN_LENGTH} 位`)
      .max(PASSWORD_MAX_LENGTH),
    confirmPassword: z.string(),
    code: z.string().regex(/^\d{6}$/, "请输入 6 位数字验证码"),
    turnstileToken: z.string().optional(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "两次输入的密码不一致",
    path: ["confirmPassword"],
  });

interface SignUpFormProps {
  redirectUrl: string;
}

export default function SignUpForm({ redirectUrl }: SignUpFormProps) {
  const { t } = useTranslation();
  const form = useForm<z.infer<typeof signUpWithCodeSchema>>({
    resolver: zodResolver(signUpWithCodeSchema),
    defaultValues: {
      email: "",
      name: "",
      password: "",
      confirmPassword: "",
      code: "",
      turnstileToken: "",
    },
  });
  const [errorMessage, setErrorMessage] = useState("");
  const [codeHint, setCodeHint] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [sendingCode, setSendingCode] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const clientConfig = useClientConfig();
  const turnstileSiteKey = clientConfig.turnstile?.siteKey;
  const turnstileRef = useRef<TurnstileInstance>(null);

  useEffect(() => {
    if (cooldown <= 0) {
      return;
    }
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  if (
    clientConfig.auth.disableSignups ||
    clientConfig.auth.disablePasswordAuth
  ) {
    return (
      <Card className="w-full">
        <CardHeader className="space-y-1.5 text-center">
          <CardTitle className="font-display text-h3 font-semibold tracking-tight">
            {t("auth.sign_up_unavailable")}
          </CardTitle>
          <CardDescription>{t("auth.signups_disabled")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <Alert>
              <UserX className="h-4 w-4" />
              <AlertDescription>
                {t("auth.signups_disabled_hint")}
              </AlertDescription>
            </Alert>
            <Button asChild className="w-full">
              <Link href="/signin">{t("auth.back_to_sign_in")}</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const sendCode = async () => {
    const email = form.getValues("email").trim();
    const emailValid = z.string().email().safeParse(email).success;
    if (!emailValid) {
      form.setError("email", {
        type: "manual",
        message: "请先填写有效的邮箱地址",
      });
      return;
    }
    form.clearErrors("email");
    setSendingCode(true);
    setCodeHint(null);
    try {
      const result = await requestEmailCode(email, "sign-up");
      if (!result.ok) {
        setCodeHint({ ok: false, text: result.message ?? "发送失败" });
        return;
      }
      setCooldown(60);
      if (result.delivery === "inline" && result.code) {
        // 本地模式（未配置 SMTP）：直接把码填进去，省一次手动输入
        form.setValue("code", result.code);
        setCodeHint({
          ok: true,
          text: `本地模式验证码：${result.code}（${result.expiresInMinutes ?? 15} 分钟内有效，已自动填入）`,
        });
      } else {
        setCodeHint({
          ok: true,
          text: `验证码已发送到 ${email}，${result.expiresInMinutes ?? 15} 分钟内有效`,
        });
      }
    } finally {
      setSendingCode(false);
    }
  };

  return (
    <Card className="w-full">
      <CardHeader className="space-y-1.5 text-center">
        <CardTitle className="font-display text-h3 font-semibold tracking-tight">
          {t("auth.sign_up_title")}
        </CardTitle>
        <CardDescription>
          {t("auth.sign_up_subtitle", { brand: BRAND.nameZh })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <Form {...form}>
          <form
            // POST so a submit before hydration doesn't put the password in the URL.
            method="post"
            onSubmit={form.handleSubmit(async (value) => {
              if (turnstileSiteKey && !value.turnstileToken) {
                form.setError("turnstileToken", {
                  type: "manual",
                  message: "请先完成人机校验",
                });
                return;
              }
              form.clearErrors("turnstileToken");
              setErrorMessage("");
              const resp = await registerWithCode({
                name: value.name,
                email: value.email.trim(),
                password: value.password,
                code: value.code.trim(),
                turnstileToken: value.turnstileToken,
              });
              if (!resp.ok) {
                setErrorMessage(resp.error ?? "注册失败，请稍后重试");
                if (turnstileSiteKey) {
                  turnstileRef.current?.reset();
                  form.setValue("turnstileToken", "");
                }
                return;
              }
              try {
                window.localStorage.setItem(
                  "iv.rememberedEmail",
                  value.email.trim(),
                );
              } catch {
                // ignore
              }
              // 服务端已经写好 session cookie，整页跳转即可（注册完就是登录态）
              if (resp.signInRequired) {
                window.location.href = `/signin?email=${encodeURIComponent(value.email.trim())}`;
                return;
              }
              window.location.href = redirectUrl;
            })}
            className="space-y-4"
          >
            {errorMessage && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{errorMessage}</AlertDescription>
              </Alert>
            )}

            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("auth.full_name")}</FormLabel>
                  <FormControl>
                    <Input
                      type="text"
                      autoComplete="nickname"
                      placeholder={t("auth.full_name_placeholder")}
                      data-testid="signup-name"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("common.email")}</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      autoComplete="email"
                      spellCheck={false}
                      placeholder={t("auth.email_placeholder")}
                      data-testid="signup-email"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("common.password")}</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      autoComplete="new-password"
                      placeholder={t("auth.create_password_placeholder")}
                      data-testid="signup-password"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("auth.confirm_password")}</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      autoComplete="new-password"
                      placeholder={t("auth.confirm_password_placeholder")}
                      data-testid="signup-confirm-password"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>邮箱验证码</FormLabel>
                  <div className="flex gap-2">
                    <FormControl>
                      <Input
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        placeholder="6 位数字"
                        maxLength={6}
                        className="tracking-[0.3em]"
                        data-testid="signup-code"
                        {...field}
                      />
                    </FormControl>
                    <Button
                      type="button"
                      variant="outline"
                      className="shrink-0"
                      onClick={() => void sendCode()}
                      disabled={sendingCode || cooldown > 0}
                      data-testid="signup-send-code"
                    >
                      {sendingCode && (
                        <Loader2 className="mr-1 size-3.5 animate-spin" />
                      )}
                      {cooldown > 0 ? `${cooldown}s 后重发` : "发送验证码"}
                    </Button>
                  </div>
                  <FormMessage />
                  {codeHint && (
                    <p
                      className={`flex items-start gap-1 text-caption ${codeHint.ok ? "text-success" : "text-destructive"}`}
                    >
                      {codeHint.ok && (
                        <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
                      )}
                      <span>{codeHint.text}</span>
                    </p>
                  )}
                </FormItem>
              )}
            />

            {turnstileSiteKey && (
              <FormField
                control={form.control}
                name="turnstileToken"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>人机校验</FormLabel>
                    <FormControl>
                      <Turnstile
                        ref={turnstileRef}
                        siteKey={turnstileSiteKey}
                        onSuccess={(token) => {
                          field.onChange(token);
                          form.clearErrors("turnstileToken");
                        }}
                        onExpire={() => field.onChange("")}
                        onError={() => {
                          field.onChange("");
                          form.setError("turnstileToken", {
                            type: "manual",
                            message: "人机校验失败，请刷新后重试",
                          });
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <ActionButton
              type="submit"
              loading={form.formState.isSubmitting}
              className="w-full"
              data-testid="signup-submit"
            >
              {t("auth.sign_up")}
            </ActionButton>

            {(clientConfig.legal.termsOfServiceUrl ||
              clientConfig.legal.privacyPolicyUrl) && (
              <p className="text-center text-caption text-muted-foreground">
                点击「注册」即表示你同意
                {clientConfig.legal.termsOfServiceUrl && (
                  <Link
                    href={clientConfig.legal.termsOfServiceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-foreground"
                  >
                    服务条款
                  </Link>
                )}
                {clientConfig.legal.termsOfServiceUrl &&
                  clientConfig.legal.privacyPolicyUrl &&
                  " 与 "}
                {clientConfig.legal.privacyPolicyUrl && (
                  <Link
                    href={clientConfig.legal.privacyPolicyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-foreground"
                  >
                    隐私政策
                  </Link>
                )}
                。
              </p>
            )}
          </form>
        </Form>

        <div className="text-center">
          <p className="text-label text-muted-foreground">
            {t("auth.already_have_account")}{" "}
            <Link
              href="/signin"
              className="font-medium text-brand-600 transition-colors hover:text-brand-700"
            >
              {t("auth.sign_in")}
            </Link>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
