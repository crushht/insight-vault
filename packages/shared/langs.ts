/**
 * 界面语言：只支持简体中文与英文。
 *
 * 上游带了 30 多种语言，但本产品的用户基本只用这两种；
 * 保留全部会在语言选择器里堆一长串没人用的条目。
 * 默认语言是中文（见 apps/web/lib/i18n/settings.ts 的 fallbackLng）。
 */
export const langNameMappings: Record<string, string> = {
  zh: "简体中文",
  en: "English",
};

export const supportedLangs = Object.keys(langNameMappings);
