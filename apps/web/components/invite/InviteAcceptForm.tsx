"use client";

import { BRAND } from "@/lib/brand";
import { useTranslation } from "@/lib/i18n/client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
import { signIn } from "@/lib/auth/client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { AlertCircle, Clock, Loader2, Mail, UserPlus } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { useTRPC } from "@karakeep/shared-react/trpc";

const inviteAcceptSchema = z
  .object({
    name: z.string().min(1, "Name is required"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z
      .string()
      .min(8, "Password must be at least 8 characters"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

interface InviteAcceptFormProps {
  token: string;
}

export default function InviteAcceptForm({ token }: InviteAcceptFormProps) {
  const { t } = useTranslation();
  const api = useTRPC();
  const router = useRouter();

  const form = useForm<z.infer<typeof inviteAcceptSchema>>({
    resolver: zodResolver(inviteAcceptSchema),
  });

  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const {
    isPending: loading,
    data: inviteData,
    error,
  } = useQuery({
    ...api.invites.get.queryOptions({ token }),
    // 无效/过期 token 属于预期结果，重试只会让用户多等几秒
    retry: false,
  });

  useEffect(() => {
    if (error) {
      // 邀请查询只会因「token 无效 / 已使用」失败，直接给业务文案，
      // 避免把服务端的英文 message 直出给用户。
      setErrorMessage(t("invite.invalid_desc"));
    }
  }, [error, t]);

  const acceptInviteMutation = useMutation(
    api.invites.accept.mutationOptions(),
  );

  const handleBackToSignIn = () => {
    router.push("/signin");
  };

  if (loading) {
    return (
      <Card className="w-full">
        <CardHeader className="text-center">
          <CardTitle className="font-display text-h3 font-semibold tracking-tight">
            {t("invite.loading_title")}
          </CardTitle>
          <CardDescription>
            {t("invite.loading_desc")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!inviteData) {
    return (
      <Card className="w-full">
        <CardHeader className="text-center">
          <CardTitle className="font-display text-h3 font-semibold tracking-tight">
            {t("invite.invalid_title")}
          </CardTitle>
          <CardDescription>
            {t("invite.invalid_desc")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-center">
            <AlertCircle className="h-12 w-12 text-destructive" />
          </div>

          {errorMessage && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          )}

          <Button onClick={handleBackToSignIn} className="w-full">
            {t("auth.back_to_sign_in")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (inviteData.expired) {
    return (
      <Card className="w-full">
        <CardHeader className="text-center">
          <CardTitle className="font-display text-h3 font-semibold tracking-tight">
            {t("invite.expired_title")}
          </CardTitle>
          <CardDescription>
            {t("invite.expired_desc")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-center">
            <Clock className="h-12 w-12 text-warning" />
          </div>

          <div className="space-y-2 text-center">
            <p className="text-sm text-muted-foreground">
              {t("invite.expired_hint")}
            </p>
          </div>

          <Button
            onClick={handleBackToSignIn}
            variant="outline"
            className="w-full"
          >
            {t("auth.back_to_sign_in")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader className="text-center">
        <CardTitle className="font-display text-h3 font-semibold tracking-tight">
          {t("invite.accept_title")}
        </CardTitle>
        <CardDescription>
          {t("invite.accept_subtitle", { brand: BRAND.nameZh })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-center">
          <UserPlus className="h-12 w-12 text-primary" />
        </div>

        <div className="space-y-2 text-center">
          <div className="flex items-center justify-center space-x-2">
            <Mail className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{t("invite.invited_email")}</p>
          </div>
          <p className="font-medium text-foreground">{inviteData.email}</p>
        </div>

        <Form {...form}>
          <form
            // POST so a submit before hydration doesn't put the password in the URL.
            method="post"
            onSubmit={form.handleSubmit(async (value) => {
              try {
                await acceptInviteMutation.mutateAsync({
                  token,
                  name: value.name,
                  password: value.password,
                });

                // Sign in the user after successful account creation
                const resp = await signIn("credentials", {
                  email: inviteData.email,
                  password: value.password,
                });

                if (!resp || !resp.ok || resp.error) {
                  setErrorMessage(
                    resp?.error ??
                      t("invite.signin_failed"),
                  );
                  return;
                }

                router.replace("/");
              } catch (e) {
                if (e instanceof TRPCClientError) {
                  setErrorMessage(e.message);
                } else {
                  setErrorMessage(t("auth.unexpected_error"));
                }
              }
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
                      placeholder={t("auth.full_name_placeholder")}
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
                      placeholder={t("auth.create_password_placeholder")}
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
                      placeholder={t("auth.confirm_password_placeholder")}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <ActionButton
              type="submit"
              loading={
                form.formState.isSubmitting || acceptInviteMutation.isPending
              }
              className="w-full"
            >
              {form.formState.isSubmitting || acceptInviteMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t("invite.creating_account")}
                </>
              ) : (
                t("invite.create_and_sign_in")
              )}
            </ActionButton>

            <Button
              type="button"
              variant="ghost"
              onClick={handleBackToSignIn}
              className="w-full"
            >
              {t("auth.back_to_sign_in")}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
