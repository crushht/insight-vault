"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ActionButton } from "@/components/ui/action-button";
import { Alert, AlertTitle } from "@/components/ui/alert";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { signIn } from "@/lib/auth/client";
import { useClientConfig } from "@/lib/clientConfig";
import { useTranslation } from "@/lib/i18n/client";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Eye, EyeOff, Lock } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";

const signInSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

/** 上次登录用的邮箱，下次进来直接填好，只需补密码。 */
export const REMEMBERED_EMAIL_KEY = "iv.rememberedEmail";

export default function CredentialsForm() {
  const { t } = useTranslation();
  const [signinError, setSigninError] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const clientConfig = useClientConfig();

  const oAuthError = searchParams.get("error");
  if (oAuthError && !signinError) {
    setSigninError(`${t("auth.oauth_failed")}: ${oAuthError}`);
  }

  const form = useForm<z.infer<typeof signInSchema>>({
    resolver: zodResolver(signInSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  // 客户端取一次上次的邮箱：放 useEffect 里避免 SSR / CSR 首帧不一致
  const emailFromQuery = searchParams.get("email") ?? "";
  useEffect(() => {
    if (emailFromQuery) {
      form.setValue("email", emailFromQuery);
      return;
    }
    try {
      const saved = window.localStorage.getItem(REMEMBERED_EMAIL_KEY);
      if (saved && !form.getValues("email")) {
        form.setValue("email", saved);
      }
    } catch {
      // 隐私模式下 localStorage 可能不可用，忽略
    }
  }, [form, emailFromQuery]);

  if (clientConfig.auth.disablePasswordAuth) {
    return (
      <div className="space-y-4">
        {signinError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{signinError}</AlertTitle>
          </Alert>
        )}
        <Alert>
          <Lock className="h-4 w-4" />
          <AlertTitle>{t("auth.password_auth_disabled")}</AlertTitle>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Form {...form}>
        <form
          // POST so a submit before hydration doesn't put the password in the URL.
          method="post"
          onSubmit={form.handleSubmit(async (value) => {
            const email = value.email.trim();
            setSigninError("");
            const resp = await signIn("credentials", {
              email,
              password: value.password,
              rememberMe,
            });
            if (!resp.ok) {
              if (resp.code === "INVALID_EMAIL_OR_PASSWORD") {
                setSigninError(t("auth.incorrect_credentials"));
              } else if (resp.code === "EMAIL_NOT_VERIFIED") {
                router.replace(
                  `/verify-email?email=${encodeURIComponent(email)}`,
                );
              } else {
                setSigninError(resp.error ?? t("auth.incorrect_credentials"));
              }
              return;
            }
            try {
              if (rememberMe) {
                window.localStorage.setItem(REMEMBERED_EMAIL_KEY, email);
              } else {
                window.localStorage.removeItem(REMEMBERED_EMAIL_KEY);
              }
            } catch {
              // ignore
            }
            router.replace("/dashboard/bookmarks");
          })}
          className="space-y-4"
        >
          {signinError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>{signinError}</AlertTitle>
            </Alert>
          )}

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
                    data-testid="signin-email"
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
                  <div className="relative">
                    <Input
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      placeholder={t("auth.password_placeholder")}
                      data-testid="signin-password"
                      className="pr-10"
                      {...field}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? "隐藏密码" : "显示密码"}
                      className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                      tabIndex={-1}
                    >
                      {showPassword ? (
                        <EyeOff className="size-4" />
                      ) : (
                        <Eye className="size-4" />
                      )}
                    </button>
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <label className="flex cursor-pointer items-center gap-2 text-label text-muted-foreground">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              className="size-4 rounded border-border accent-brand-600"
              data-testid="signin-remember-me"
            />
            在这台设备上保持登录（{clientConfig.auth.sessionDays} 天）
          </label>

          <ActionButton
            ignoreDemoMode
            type="submit"
            loading={form.formState.isSubmitting}
            className="w-full"
            data-testid="signin-submit"
          >
            {t("auth.sign_in")}
          </ActionButton>

          <div className="text-center">
            <Link
              href="/forgot-password"
              className="text-label text-muted-foreground underline decoration-border underline-offset-4 transition-colors hover:text-brand-600"
            >
              {t("auth.forgot_password")}
            </Link>
          </div>
        </form>
      </Form>

      <div className="text-center">
        <p className="text-label text-muted-foreground">
          {t("auth.no_account")}{" "}
          <Link
            href="/signup"
            className="font-medium text-brand-600 transition-colors hover:text-brand-700"
          >
            {t("auth.sign_up")}
          </Link>
        </p>
      </div>
    </div>
  );
}
