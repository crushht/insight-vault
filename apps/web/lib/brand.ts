/**
 * 品牌单一真源。
 * 任何面向用户的品牌名、标语、链接都必须从这里取，禁止在页面里硬编码。
 */
export const BRAND = {
  /** 英文品牌名（logo 字标、标题、manifest） */
  name: "INSIGHT VAULT",
  /** 中文短名（界面内高频出现） */
  nameZh: "灵感仓",
  /** 完整名称（关于页、页脚） */
  fullName: "灵感仓 INSIGHT VAULT",
  /** 一句话定位 */
  tagline: "把互联网收进仓库，让 AI 替你读懂它。",
  /** 站点描述（metadata / OG） */
  description:
    "灵感仓是一个 AI 个人知识管理系统：收藏网页、图片、PDF 与笔记，自动整理、语义检索，并用带引用的 AI 回答帮你理解与创作。",
  /** 对外链接 */
  siteUrl: "https://insightvault.app",
  repoUrl: "https://github.com/",
  supportEmail: "support@insightvault.app",
  /** 版权行 */
  copyright: `© ${new Date().getFullYear()} 灵感仓 INSIGHT VAULT`,
} as const;

/** 页面标题：`页面名 | 灵感仓`，没有页面名时用品牌名 */
export function pageTitle(page?: string | null): string {
  return page ? `${page} | ${BRAND.nameZh}` : BRAND.name;
}

/** 供 `<title>` 模板使用（Next metadata.template 需要 `%s` 占位符） */
export const TITLE_TEMPLATE = `%s | ${BRAND.nameZh}`;
