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
import { requestPasswordReset } from "@/lib/auth/client";
import { useTranslation } from "@/lib/i18n/client";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, CheckCircle } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";

export default function ForgotPasswordForm() {
  const { t } = useTranslation();
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const router = useRouter();

  const schema = useMemo(
    () =>
      z.object({
        email: z.string().email(t("auth.invalid_email")),
      }),
    [t],
  );

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (values: z.infer<typeof schema>) => {
    setErrorMessage("");
    const result = await requestPasswordReset(values.email);
    if (!result.ok) {
      setErrorMessage(result.error ?? t("auth.unexpected_error"));
      return;
    }
    setIsSubmitted(true);
  };

  return (
    <Card className="w-full">
      <CardHeader className="space-y-1.5 text-center">
        <CardTitle className="font-display text-h3 font-semibold tracking-tight">
          {isSubmitted ? t("auth.check_email_title") : t("auth.forgot_password")}
        </CardTitle>
        <CardDescription>
          {isSubmitted ? t("auth.check_email_desc") : t("auth.forgot_desc")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isSubmitted ? (
          <>
            <div className="flex items-center justify-center">
              <CheckCircle className="h-12 w-12 text-success" />
            </div>
            <Alert>
              <AlertDescription className="text-center">
                {t("auth.check_email_desc")}
              </AlertDescription>
            </Alert>
            <ActionButton
              variant="outline"
              loading={false}
              onClick={() => router.push("/signin")}
              className="w-full"
              data-testid="forgot-back"
            >
              {t("auth.back_to_sign_in")}
            </ActionButton>
          </>
        ) : (
          <>
            <Form {...form}>
              <form
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
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("common.email")}</FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          placeholder={t("auth.email_address_placeholder")}
                          data-testid="forgot-email"
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
                  data-testid="forgot-submit"
                >
                  {t("auth.send_reset_link")}
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
