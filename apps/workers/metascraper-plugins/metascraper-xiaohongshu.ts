/**
 * 小红书（xiaohongshu.com / xhslink.com）解析插件。
 *
 * 现实约束：小红书风控最强，未登录/被判定为爬虫时返回的是登录墙或
 * 极简壳页面，`#detail-desc` 之类的容器根本不存在。
 *
 * 因此这里的原则是 **尽力而为 + 明确降级**：
 * - 能拿到多少字段就拿多少（标题 / 作者 / 封面 / 正文片段）；
 * - 拿不到就让 `readableContentHtml` 返回 undefined，由上游走通用提取；
 * - 最终仍失败时，UI 引导用户用浏览器扩展剪藏（保存当前页 HTML）。
 *
 * 不做：伪造登录态、绕过风控、抓取私密笔记。
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

export function isXiaohongshuUrl(url?: string): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host === "xiaohongshu.com" ||
      host.endsWith(".xiaohongshu.com") ||
      host === "xhslink.com" ||
      host.endsWith(".xhslink.com")
    );
  } catch {
    return false;
  }
}

const CONTENT_SELECTORS = [
  "#detail-desc",
  "div.note-content",
  "div.desc",
  "article",
];

export default function metascraperXiaohongshu() {
  return {
    pkgName: "metascraper-xiaohongshu",
    test: ({ url }: RuleContext) => isXiaohongshuUrl(url),

    title: [
      attrRule('meta[property="og:title"]', "content"),
      textRule("#detail-title"),
      textRule("div.title"),
    ],
    author: [
      attrRule('meta[name="author"]', "content"),
      textRule(".author-wrapper .username"),
      textRule("span.username"),
    ],
    date: [attrRule('meta[property="article:published_time"]', "content")],
    image: [attrRule('meta[property="og:image"]', "content")],
    description: [
      attrRule('meta[property="og:description"]', "content"),
      textRule("#detail-desc"),
    ],
    publisher: () => "小红书",
    lang: () => "zh-CN",

    readableContentHtml: [
      ({ htmlDom }: RuleContext): string | undefined => {
        for (const selector of CONTENT_SELECTORS) {
          const node = htmlDom(selector).first();
          if (node.length) {
            const html = node.html();
            if (html && String(html).trim().length > 0) {
              return `<div class="xiaohongshu-content">${html}</div>`;
            }
          }
        }
        return undefined;
      },
    ],
  };
}
