// 灵感仓 Service Worker —— 只做「离线壳 + 静态资源缓存」，不碰接口。
//
// 策略：
//   - 页面导航：网络优先（4 秒超时）→ 命中缓存的同一页 → 离线页 /offline
//   - _next/static 与图片字体样式：缓存优先（装一次就离线可用）
//   - /api/*：完全不拦（离线时由页面自己报错，不喂过期数据）
//
// 退出登录时前端会 postMessage({type:"clear"})，清掉所有缓存，避免共用浏览器时看到上一个账号的页面。

const VERSION = "insight-vault-v2";
const SHELL_CACHE = `${VERSION}-shell`;
const STATIC_CACHE = `${VERSION}-static`;
const SHELL_URLS = ["/offline", "/icon-512.png", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // addAll 里任何一个失败会整体失败，逐个加更稳
      await Promise.all(
        SHELL_URLS.map((url) => cache.add(url).catch(() => undefined)),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => !k.startsWith(VERSION))
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "clear") {
    event.waitUntil(
      caches
        .keys()
        .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
        .then(() => event.source?.postMessage?.({ type: "cleared" })),
    );
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstPage(request));
    return;
  }

  if (
    url.pathname.startsWith("/_next/static/") ||
    /\.(?:css|js|mjs|woff2?|ttf|png|jpe?g|webp|avif|svg|ico)$/.test(url.pathname)
  ) {
    event.respondWith(cacheFirstAsset(request));
  }
});

async function networkFirstPage(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const fresh = await withTimeout(fetch(request), 4000);
    if (fresh && fresh.ok) {
      // 只缓存同源 GET 页面；带 Set-Cookie 的响应照样能缓存 HTML，但只在本机浏览器里
      cache.put(request, fresh.clone()).catch(() => undefined);
    }
    return fresh;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    const offline = await cache.match("/offline");
    if (offline) return offline;
    return new Response(
      `<!doctype html><meta charset="utf-8"><title>离线</title>
       <body style="font-family:system-ui;padding:48px;text-align:center">
       <h1>当前离线</h1><p>联网后刷新即可继续。</p></body>`,
      { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }
}

async function cacheFirstAsset(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const fresh = await fetch(request);
  if (fresh.ok) {
    cache.put(request, fresh.clone()).catch(() => undefined);
  }
  return fresh;
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}
