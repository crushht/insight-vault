import { BRAND } from "@/lib/brand";
import type { Metadata } from "next";
import AISettings from "@/components/settings/AISettings";
import { useTranslation } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  // oxlint-disable-next-line rules-of-hooks
  const { t } = await useTranslation();
  return {
    title: `${t("settings.ai.ai_settings")} | ${BRAND.nameZh}`,
  };
}

export default function AISettingsPage() {
  return <AISettings />;
}
