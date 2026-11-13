"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ActionButton } from "@/components/ui/action-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { resetPassword } from "@/lib/auth/client";
import { useTranslation } from "@/lib/i18n/client";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, CheckCircle } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { zResetPasswordSchema } from "@karakeep/shared/types/users";

interface ResetPasswordFormProps {
  token: string;
}

export default function ResetPasswordForm({ token }: ResetPasswordFormProps) {
  const { t } = useTranslation();
  const [isSuccess, setIsSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const router = useRouter();

  const schema = useMemo(
    () =>
      z
        .object({
          confirmPassword: z.string(),
        })
        .extend(zResetPasswordSchema.pick({ newPassword: true }).shape)
        .refine((data) => data.newPassword === data.confirmPassword, {
          message: t("auth.passwords_dont_match"),
          path: ["confirmPassword"],
        }),
    [t],
  );

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (values: z.infer<typeof schema>) => {
    setErrorMessage("");
    const result = await resetPassword({
      token,
      newPassword: values.newPassword,
    });
    if (!result.ok) {
      setErrorMessage(
        result.code === "INVALID_TOKEN"
          ? t("auth.invalid_token")
          : (result.error ?? t("auth.unexpected_error")),
      );
      return;
    }
    setIsSuccess(true);
  };

  return (
    <Card className="w-full">
      <CardHeader className="space-y-1.5 text-center">
        <CardTitle className="font-display text-h3 font-semibold tracking-tight">
          {isSuccess ? t("auth.reset_success_title") : t("auth.reset_title")}
        </CardTitle>
        <CardDescription>
          {isSuccess ? t("auth.reset_success_desc") : t("auth.reset_desc")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isSuccess ? (
          <>
            <div className="flex items-center justify-center">
              <CheckCircle className="h-12 w-12 text-success" />
            </div>
            <Alert>
              <AlertDescription className="text-center">
                {t("auth.reset_success_desc")}
              </AlertDescription>
            </Alert>
            <ActionButton
              loading={false}
              onClick={() => router.push("/signin")}
              className="w-full"
              data-testid="reset-go-signin"
            >
              {t("auth.go_to_sign_in")}
            </ActionButton>
          </>
        ) : (
          <>
            <Form {...form}>
              <form
                // POST so a submit before hydration doesn't put the password in the URL.
                method="post"
                onSubmit={form.handleSubmit(onSubmit)}
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
                  name="newPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("auth.new_password")}</FormLabel>
                      <FormControl>
                        <Input
                          type="password"
                          placeholder={t("auth.new_password_placeholder")}
                          data-testid="reset-new-password"
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
                      <FormLabel>{t("auth.confirm_new_password")}</FormLabel>
                      <FormControl>
                        <Input
                          type="password"
                          placeholder={t(
                            "auth.confirm_new_password_placeholder",
                          )}
                          data-testid="reset-confirm-password"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <ActionButton
                  type="submit"
                  loading={form.formState.isSubmitting}
                  className="w-full"
                  data-testid="reset-submit"
                >
                  {t("auth.reset_submit")}
                </ActionButton>
              </form>
            </Form>

            <div className="text-center">
              <ActionButton
                variant="ghost"
                loading={false}
                onClick={() => router.push("/signin")}
                className="w-full"
              >
                {t("auth.back_to_sign_in")}
              </ActionButton>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
