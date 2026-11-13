/**
 * URL 归一化：用于「同一条内容不要存两遍」的判断。
 *
 * 只做**安全的**归一化——不改变资源身份，只抹掉跟踪参数与书写差异：
 * - 去掉 hash
 * - hostname/lowercase
 * - 去掉营销跟踪参数（utm_*, fbclid, gclid, spm, share_token…）
 * - 剩余 query 排序，保证参数顺序不影响判重
 * - 去掉末尾斜杠（保留根路径 "/"）
 *
 * 不做：短链展开、大小写路径归一、协议升级（这些会改变语义，需要网络或策略）。
 */

const TRACKING_PARAMS = new Set([
  // 通用
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "fbclid",
  "gclid",
  "dclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "igshid",
  "yclid",
  "srsltid",
  // 中文站点常见
  "spm",
  "spm_id_from",
  "from_spmid",
  "vd_source",
  "unique_k",
  "share_tag",
  "scm",
  "from",
  "from_source",
  "share_source",
  "share_medium",
  "share_plat",
  "share_token",
  "share_from",
  "scene",
  "clicktime",
  "enterid",
  "sessionid",
  "isappinstalled",
  "wxshare",
  "chksm",
  "sharer_shareid",
]);

export function normalizeUrlForDedup(input: string): string {
  const raw = input.trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }

  url.hash = "";
  url.hostname = url.hostname.toLowerCase();

  const kept: [string, string][] = [];
  for (const [key, value] of url.searchParams.entries()) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) continue;
    kept.push([key, value]);
  }
  kept.sort(([a], [b]) => (a === b ? 0 : a < b ? -1 : 1));

  url.search = "";
  for (const [key, value] of kept) {
    url.searchParams.append(key, value);
  }

  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }

  return url.toString();
}

/** 两个 URL 是否指向同一条内容（按上述规则归一后比较） */
export function isSameUrlForDedup(a: string, b: string): boolean {
  return normalizeUrlForDedup(a) === normalizeUrlForDedup(b);
}
