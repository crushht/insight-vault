import { BRAND } from "@/lib/brand";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useTranslation } from "@/lib/i18n/server";
import { oauthProviders } from "@/server/auth";
import { Info } from "lucide-react";

import serverConfig from "@karakeep/shared/config";

import CredentialsForm from "./CredentialsForm";
import { OtpSignInForm } from "./OtpSignInForm";
import OAuthAutoRedirect from "./OAuthAutoRedirect";
import SignInProviderButton from "./SignInProviderButton";

export default async function SignInForm() {
  // Next 的 server component 里，这个 helper 就是个异步取字典的函数，
  // 不是 React Hook —— lint 规则会误判，这里显式放行。
  // oxlint-disable-next-line react-hooks/rules-of-hooks
  const { t } = await useTranslation();
  const providerValues = oauthProviders;

  return (
    <div className="w-full">
      {/* Auto-redirect to OAuth provider if configured */}
      {providerValues && providerValues.length > 0 && (
        <OAuthAutoRedirect oauthProviderId={providerValues[0].id} />
      )}
      <Card className="w-full border-border shadow-e1">
        <CardHeader className="space-y-1.5 text-center">
          <CardTitle className="font-display text-h3 font-semibold tracking-tight">
            {t("auth.welcome_back")}
          </CardTitle>
          <CardDescription className="text-body text-muted-foreground">
            {t("auth.sign_in_to", { brand: BRAND.nameZh })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {serverConfig.demoMode && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                <div className="space-y-1">
                  <p className="font-semibold">{t("auth.demo_mode")}</p>
                  <p>
                    {t("common.email")}: {serverConfig.demoMode.email}
                  </p>
                  <p>
                    {t("common.password")}: {serverConfig.demoMode.password}
                  </p>
                </div>
              </AlertDescription>
            </Alert>
          )}

          <CredentialsForm />
          {serverConfig.email.smtp && (
            <details className="group pt-1">
              <summary className="cursor-pointer list-none text-center text-caption text-muted-foreground underline decoration-border underline-offset-4 transition-colors hover:text-brand-600">
                已有账号但想免密码登录？用邮箱验证码
              </summary>
              <div className="pt-4">
                <OtpSignInForm />
              </div>
            </details>
          )}

          {providerValues && providerValues.length > 0 && (
            <>
              <div className="flex w-full items-center gap-3">
                <div className="h-px flex-1 bg-border" />
                <span className="text-caption uppercase tracking-wider text-muted-foreground">
                  {t("auth.or")}
                </span>
                <div className="h-px flex-1 bg-border" />
              </div>
              <div className="space-y-2">
                {providerValues.map((provider) => (
                  <SignInProviderButton
                    key={provider.id}
                    provider={{ id: provider.id, name: provider.name }}
                  />
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
