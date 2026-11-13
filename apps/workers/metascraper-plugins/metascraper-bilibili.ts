/**
 * B 站（bilibili.com / b23.tv）解析插件。
 *
 * 只做「元数据尽量准」：标题、UP 主、封面、简介、发布时间。
 * 不下载视频本体（版权与体积都不合适），正文用简介文本，
 * 让收藏至少可检索、可被 AI 读懂。
 */
type RuleContext = { htmlDom: any; url?: string };

function textRule(selector: string) {
  return ({ htmlDom }: RuleContext): string | undefined => {
    const el = htmlDom(selector).first();
    const value = el.length ? String(el.text()).trim() : "";
    return value || undefined;
  };
}

function attrRule(selector: string, attribute: string) {
  return ({ htmlDom }: RuleContext): string | undefined => {
    const value = htmlDom(selector).first().attr(attribute);
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  };
}

export function isBilibiliUrl(url?: string): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "bilibili.com" || host.endsWith(".bilibili.com") || host === "b23.tv";
  } catch {
    return false;
  }
}

export default function metascraperBilibili() {
  return {
    pkgName: "metascraper-bilibili",
    test: ({ url }: RuleContext) => isBilibiliUrl(url),

    title: [
      attrRule('meta[property="og:title"]', "content"),
      textRule("h1.video-title"),
      attrRule('meta[name="title"]', "content"),
    ],
    author: [
      attrRule('meta[itemprop="author"]', "content"),
      textRule("a.up-name"),
      attrRule('meta[name="author"]', "content"),
    ],
    date: [
      attrRule('meta[itemprop="datePublished"]', "content"),
      textRule("div.video-info-detail-list span.pubdate-text"),
    ],
    image: [attrRule('meta[property="og:image"]', "content")],
    description: [
      attrRule('meta[property="og:description"]', "content"),
      textRule("div.desc-info"),
      textRule("#v_desc"),
    ],
    publisher: () => "哔哩哔哩",
    lang: () => "zh-CN",

    // 用简介当正文；没有简介时返回 undefined，退回通用提取
    readableContentHtml: [
      ({ htmlDom }: RuleContext): string | undefined => {
        const desc =
          htmlDom("div.desc-info").first().html() ??
          htmlDom("#v_desc").first().html();
        if (desc && String(desc).trim()) {
          return `<div class="bilibili-desc">${desc}</div>`;
        }
        return undefined;
      },
    ],
  };
}
