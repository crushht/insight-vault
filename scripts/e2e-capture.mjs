// 收藏创建链路烟测：本地起一个假站点 → 收藏它的 URL → workers 去抓 →
// 断言标题被改写、抓取状态成功、能搜到。
//
// 不依赖外网，也不依赖 Meilisearch / Chrome：命令式 HTTP 抓取足以覆盖主链路。
//
// 用法：node scripts/e2e-capture.mjs

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3020);
const CONTENT_PORT = Number(process.env.E2E_CONTENT_PORT ?? 3021);
const base = `http://127.0.0.1:${WEB_PORT}`;
const contentBase = `http://127.0.0.1:${CONTENT_PORT}`;
const dataDir = mkdtempSync(path.join(os.tmpdir(), "iv-e2e-capture-"));
const secret = "e2e-capture-secret-0123456789abcdef";

const PAGE_TITLE = "本地烟测文章";
const BODY_TOKEN = "逆熵知识库";

let pass = 0;
let fail = 0;
const procs = [];

function ok(name, extra = "") {
  pass++;
  console.log(`PASS  ${name}${extra ? "  <- " + extra : ""}`);
}
function info(name, extra = "") {
  console.log(`INFO  ${name}${extra ? "  <- " + extra : ""}`);
}
function bad(name, extra = "") {
  fail++;
  console.log(`FAIL  ${name}${extra ? "  <- " + extra : ""}`);
}

const env = (() => {
  const e = { ...process.env };
  for (const k of Object.keys(e)) {
    if (k.startsWith("SMTP_")) delete e[k];
  }
  e.SMTP_HOST = "";
  e.LOCAL_AUTH_CODE = "1";
  e.DATA_DIR = dataDir;
  e.NEXTAUTH_SECRET = secret;
  e.NEXTAUTH_URL = base;
  // 抓取器默认拒绝内网地址（防 SSRF）；烟测要抓本机起的假站点，得显式放行
  e.CRAWLER_ALLOWED_INTERNAL_HOSTNAMES = "127.0.0.1,localhost";
  return e;
})();

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    timeout: 180_000,
    ...opts,
  });
  if (r.status !== 0) {
    throw new Error(
      `${cmd} ${args.join(" ")} 失败：${(r.stderr || r.stdout || "").slice(0, 600)}`,
    );
  }
}

function start(cmd, args, opts) {
  const p = spawn(cmd, args, {
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  });
  p.log = [];
  p.stdout?.on("data", (d) => p.log.push(String(d)));
  p.stderr?.on("data", (d) => p.log.push(String(d)));
  procs.push(p);
  return p;
}

function stopAll() {
  for (const p of procs.reverse()) {
    if (!p?.pid) continue;
    try {
      if (process.platform === "win32") {
        spawnSync("taskkill", ["/pid", String(p.pid), "/T", "/F"], {
          stdio: "ignore",
        });
      } else {
        p.kill("SIGTERM");
      }
    } catch {}
  }
}

async function waitHealth(url, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`等待 ${url} 超时`);
}

function startContentServer() {
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>${PAGE_TITLE}</title>
<meta name="description" content="用于验证收藏抓取链路的本地页面">
<meta property="og:title" content="${PAGE_TITLE}">
</head><body>
<h1>${PAGE_TITLE}</h1>
<p>这是一段用于测试的正文，里面藏着一个只出现在正文里的词：${BODY_TOKEN}。
抓取器应该把这段正文存下来，之后搜索这个词应当能命中这条收藏。</p>
<p>${BODY_TOKEN} 在标题和 URL 里都不存在，所以如果搜索能命中，说明正文确实被索引了。</p>
</body></html>`;
  const server = createServer((req, res) => {
    if (req.url === "/robots.txt") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("User-agent: *\nAllow: /\n");
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  });
  return new Promise((resolve) => {
    server.listen(CONTENT_PORT, "127.0.0.1", () => resolve(server));
  });
}

async function api(pathname, { method = "POST", body, cookie } = {}) {
  const res = await fetch(`${base}${pathname}`, {
    method,
    headers: {
      "content-type": "application/json",
      origin: base,
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text, res };
}

async function trpcQuery(proc, input, cookie) {
  const url = `${base}/api/trpc/${proc}?batch=1&input=${encodeURIComponent(
    JSON.stringify({ "0": { json: input } }),
  )}`;
  const res = await fetch(url, { headers: { cookie } });
  const raw = await res.text();
  let json = null;
  try {
    json = JSON.parse(raw);
  } catch {}
  if (process.env.E2E_VERBOSE && !json?.[0]?.result) {
    console.log(`  [trpc] ${proc} ${res.status} ${raw.slice(0, 300)}`);
  }
  return json?.[0]?.result?.data?.json ?? null;
}

async function trpcMutation(proc, input, cookie) {
  const res = await fetch(`${base}/api/trpc/${proc}?batch=1`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base, cookie },
    body: JSON.stringify({ "0": { json: input } }),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, data: json?.[0]?.result?.data?.json ?? null, raw: json };
}

async function main() {
  console.log(`# 抓取烟测  web=${base}  content=${contentBase}  data=${dataDir}`);

  console.log("… 建库（应用 + 队列）");
  run(process.execPath, ["--import", "tsx", "migrate.ts"], {
    cwd: path.join(root, "packages", "db"),
    env,
  });
  run(process.execPath, ["--import", "tsx", "scripts/migrateQueue.ts"], {
    cwd: path.join(root, "apps", "workers"),
    env,
  });

  console.log("… 起本地内容站");
  const contentServer = await startContentServer();

  console.log("… 起 workers（抓取靠它）");
  const workersEntry = path.join(root, "apps", "workers", "dist", "index.js");
  if (!existsSync(workersEntry)) {
    throw new Error("workers 还没构建：先 pnpm --filter @karakeep/workers run build");
  }
  start(process.execPath, [workersEntry], {
    cwd: path.join(root, "apps", "workers"),
    env: { ...env, USING_LEGACY_SEPARATE_CONTAINERS: "true" },
  });

  console.log("… 起 web（生产构建）");
  const standalone = path.join(root, "apps", "web", ".next", "standalone");
  const entry = path.join(standalone, "apps", "web", "server.js");
  if (!existsSync(entry)) {
    throw new Error("web 还没构建：先 pnpm --filter @karakeep/web run build");
  }
  // standalone 不带 static/public，补上目录联接（否则页面没有 JS）
  for (const [link, target] of [
    [path.join(standalone, "apps", "web", ".next", "static"), path.join(root, "apps", "web", ".next", "static")],
    [path.join(standalone, "apps", "web", "public"), path.join(root, "apps", "web", "public")],
  ]) {
    if (existsSync(link) || !existsSync(target)) continue;
    try {
      mkdirSync(path.dirname(link), { recursive: true });
      symlinkSync(target, link, "junction");
    } catch {}
  }
  start(process.execPath, [entry], {
    cwd: standalone,
    env: { ...env, NODE_ENV: "production", PORT: String(WEB_PORT) },
  });

  await waitHealth(`${base}/api/health`);

  // 注册一个账号
  const email = `cap-${Date.now()}@example.com`;
  const req1 = await api("/api/otp/request", {
    body: { email, purpose: "sign-up" },
  });
  const code = req1.json?.code;
  if (!code) throw new Error(`没拿到验证码：${req1.text.slice(0, 200)}`);
  const reg = await api("/api/otp/register", {
    body: { name: "Capture", email, password: "CapturePass1!", code },
  });
  if (!reg.res.status) throw new Error("注册失败");
  const cookie = reg.res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");

  // 收藏本地页面
  const created = await trpcMutation(
    "bookmarks.createBookmark",
    { type: "link", url: `${contentBase}/article` },
    cookie,
  );
  const bookmarkId = created.data?.id;
  if (!bookmarkId) {
    bad("创建链接收藏", `${created.status} ${JSON.stringify(created.raw).slice(0, 200)}`);
    return;
  }
  ok("创建链接收藏", bookmarkId);

  // 等抓取完成（title / crawlStatus 在 content 里）
  let bookmark = null;
  let link = null;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    bookmark = await trpcQuery(
      "bookmarks.getBookmark",
      { bookmarkId, includeContent: true },
      cookie,
    );
    link = bookmark?.content ?? null;
    if (link?.crawlStatus === "success") break;
    if (link?.title === PAGE_TITLE) break;
    await new Promise((r) => setTimeout(r, 1500));
  }

  if (link?.crawlStatus === "success") {
    ok("抓取状态 success", String(link.crawlStatus));
  } else {
    bad(
      "抓取状态 success",
      `status=${link?.crawlStatus} title=${link?.title}`,
    );
  }

  if (link?.title === PAGE_TITLE) {
    ok("标题被改写成页面标题", PAGE_TITLE);
  } else {
    bad("标题被改写成页面标题", String(link?.title));
  }

  // 搜标题：一定该命中
  const byTitle = await trpcQuery(
    "bookmarks.searchBookmarks",
    { text: PAGE_TITLE },
    cookie,
  );
  const titleHits = byTitle?.bookmarks?.map((b) => b.id) ?? [];
  if (titleHits.includes(bookmarkId)) {
    ok("按标题能搜到", `${titleHits.length} 条命中`);
  } else {
    bad("按标题能搜到", JSON.stringify(byTitle).slice(0, 200));
  }

  // 搜正文里的词：命中说明正文进了索引，没命中说明只索引了标题（信息，不算失败）
  const byBody = await trpcQuery(
    "bookmarks.searchBookmarks",
    { text: BODY_TOKEN },
    cookie,
  );
  const bodyHits = byBody?.bookmarks?.map((b) => b.id) ?? [];
  if (bodyHits.includes(bookmarkId)) {
    ok("按正文能搜到", `${bodyHits.length} 条命中`);
  } else {
    bad(
      "按正文能搜到",
      "正文没进 SQL 降级搜索（预期：htmlContent / bookmarkAssets.content 参与 LIKE）",
    );
  }

  contentServer.close();

  if (fail > 0 && process.env.E2E_VERBOSE) {
    for (const [i, p] of procs.entries()) {
      console.log(`--- 子进程 ${i} 日志尾 ---`);
      console.log(p.log?.join("")?.slice(-4000) ?? "");
    }
  }
}

try {
  await main();
} catch (e) {
  bad("烟测运行", String(e?.message ?? e).split("\n")[0]);
  for (const p of procs) {
    const tail = p.log?.join("")?.slice(process.env.E2E_VERBOSE ? -6000 : -600);
    if (tail) console.log(`--- 子进程日志 ---\n${tail}`);
  }
} finally {
  stopAll();
  await new Promise((r) => setTimeout(r, 1200));
  try {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 });
  } catch {
    console.log(`（临时数据目录没删掉，可手动清理：${dataDir}）`);
  }
  console.log(`\n== ${pass} passed, ${fail} failed ==`);
  if (fail > 0) process.exitCode = 1;
}
