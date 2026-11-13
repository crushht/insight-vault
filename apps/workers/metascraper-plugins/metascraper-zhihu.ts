/**
 * 知乎（zhihu.com）解析插件。
 *
 * 知乎的回答/文章正文在 `RichText` 系列容器里，页面其余部分是导航、
 * 推荐与广告。命中时直接取正文容器，未命中（登录墙、折叠页）则退回
 * 通用提取。
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

export function isZhihuUrl(url?: string): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "zhihu.com" || host.endsWith(".zhihu.com");
  } catch {
    return false;
  }
}

const CONTENT_SELECTORS = [
  "div.RichText",
  "div.Post-RichText",
  "div.RichContent-inner",
  "article",
];

export default function metascraperZhihu() {
  return {
    pkgName: "metascraper-zhihu",
    test: ({ url }: RuleContext) => isZhihuUrl(url),

    title: [
      attrRule('meta[property="og:title"]', "content"),
      textRule("h1.QuestionHeader-title"),
      textRule("h1.Post-Title"),
    ],
    author: [
      attrRule('meta[name="author"]', "content"),
      textRule("div.AuthorInfo-name"),
    ],
    date: [
      attrRule('meta[itemprop="datePublished"]', "content"),
      attrRule('meta[property="article:published_time"]', "content"),
    ],
    image: [attrRule('meta[property="og:image"]', "content")],
    description: [attrRule('meta[property="og:description"]', "content")],
    publisher: () => "知乎",
    lang: () => "zh-CN",

    readableContentHtml: [
      ({ htmlDom }: RuleContext): string | undefined => {
        for (const selector of CONTENT_SELECTORS) {
          const node = htmlDom(selector).first();
          if (node.length) {
            const html = node.html();
            if (html && html.trim()) {
              return `<div class="zhihu-content">${html}</div>`;
            }
          }
        }
        return undefined;
      },
    ],
  };
}
