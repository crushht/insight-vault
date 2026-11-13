/**
 * 微信公众号（mp.weixin.qq.com）解析插件。
 *
 * 为什么需要它：
 * - 微信文章的正文在 `#js_content` 里，且页面有大量导航/推荐噪声，
 *   Defuddle / Readability 常把「推荐阅读」「相关文章」一起抓进来；
 * - 图片有防盗链（需要 Referer），正文 HTML 里保留原始 img 链接即可，
 *   后续由资产流水线按需下载；
 * - 登录墙/环境验证的页面拿不到 `#js_content`，此时插件返回 undefined，
 *   上游退回通用提取，最终由 UI 引导用户用扩展剪藏。
 *
 * 返回 `readableContentHtml` 会**直接**成为正文，跳过启发式提取。
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

export function isWechatArticleUrl(url?: string): boolean {
  if (!url) return false;
  try {
    return new URL(url).hostname.toLowerCase() === "mp.weixin.qq.com";
  } catch {
    return false;
  }
}

export default function metascraperWechat() {
  return {
    pkgName: "metascraper-wechat",
    test: ({ url }: RuleContext) => isWechatArticleUrl(url),

    title: [
      attrRule('meta[property="og:title"]', "content"),
      textRule("#activity-name"),
    ],
    author: [
      textRule("#js_name"),
      attrRule('meta[name="author"]', "content"),
    ],
    date: [
      attrRule('meta[property="article:published_time"]', "content"),
      textRule("#publish_time"),
    ],
    image: [attrRule('meta[property="og:image"]', "content")],
    description: [attrRule('meta[name="description"]', "content")],
    publisher: () => "微信公众号",
    lang: () => "zh-CN",

    // 直接给出正文，绕过 Defuddle / Readability
    readableContentHtml: [
      ({ htmlDom }: RuleContext): string | undefined => {
        const body = htmlDom("#js_content");
        return body.length ? (body.html() ?? undefined) : undefined;
      },
    ],
  };
}
