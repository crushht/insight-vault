// 导入 / 导出端到端烟测。
//
//   1. 建库（应用 + 队列）→ 起生产构建 web
//   2. 注册账号，用 tRPC 造 30 条文字收藏
//   3. GET /api/bookmarks/export?format=json|md → 断言条数与标题
//   4. 用 Playwright 在 /settings/import 上传一份 Raindrop CSV（5 条）
//   5. 等导入落地 → 再导出一次，断言总数 = 35 且新标题都在
//
// 用法：node scripts/e2e-import-export.mjs

import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.E2E_IE_PORT ?? 3026);
const base = `http://127.0.0.1:${PORT}`;
const dataDir = mkdtempSync(path.join(os.tmpdir(), "iv-e2e-ie-"));
const secret = "e2e-ie-secret-0123456789abcdef0123";
const SEED = 30;
const IMPORT = 5;

let pass = 0;
let fail = 0;
let server = null;
let workers = null;

function ok(n, extra = "") {
  pass++;
  console.log(`PASS  ${n}${extra ? "  <- " + extra : ""}`);
}
function bad(n, extra = "") {
  fail++;
  console.log(`FAIL  ${n}${extra ? "  <- " + extra : ""}`);
}

const env = (() => {
  const e = { ...process.env };
  for (const k of Object.keys(e)) if (k.startsWith("SMTP_")) delete e[k];
  e.SMTP_HOST = "";
  e.LOCAL_AUTH_CODE = "1";
  e.DATA_DIR = dataDir;
  e.NEXTAUTH_SECRET = secret;
  e.NEXTAUTH_URL = base;
  return e;
})();

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, env, encoding: "utf8", timeout: 180_000 });
  if (r.status !== 0) {
    throw new Error(`${cmd} 失败：${(r.stderr || r.stdout || "").slice(0, 500)}`);
  }
}

async function waitHealth(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("服务启动超时");
}

/**
 * standalone 包不带 .next/static 与 public（桌面版是打包时单独拷的），
 * 这里补上目录联接，否则页面没有 JS，点上传毫无反应。
 */
function ensureAssets(standalone) {
  const webRoot = path.join(root, "apps", "web");
  const pairs = [
    [path.join(standalone, "apps", "web", ".next", "static"), path.join(webRoot, ".next", "static")],
    [path.join(standalone, "apps", "web", "public"), path.join(webRoot, "public")],
  ];
  for (const [link, target] of pairs) {
    if (existsSync(link) || !existsSync(target)) continue;
    try {
      mkdirSync(path.dirname(link), { recursive: true });
      symlinkSync(target, link, "junction");
    } catch {}
  }
}

function removeAssets() {
  const webRoot = path.join(root, "apps", "web");
  for (const rel of [
    path.join(".next", "standalone", "apps", "web", ".next", "static"),
    path.join(".next", "standalone", "apps", "web", "public"),
  ]) {
    const p = path.join(webRoot, rel);
    try {
      if (lstatSync(p).isSymbolicLink()) unlinkSync(p);
    } catch {}
  }
}

function startServer() {
  const standalone = path.join(root, "apps", "web", ".next", "standalone");
  const entry = path.join(standalone, "apps", "web", "server.js");
  if (!existsSync(entry)) {
    throw new Error("先 pnpm --filter @karakeep/web run build");
  }
  ensureAssets(standalone);
  server = spawn(process.execPath, [entry], {
    cwd: standalone,
    env: { ...env, NODE_ENV: "production", PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.log = [];
  server.stdout.on("data", (d) => server.log.push(String(d)));
  server.stderr.on("data", (d) => server.log.push(String(d)));
}

/**
 * 导入是「暂存 → 后台任务落库」，没有 workers 就永远停在 staged。
 */
function startWorkers() {
  const entry = path.join(root, "apps", "workers", "dist", "index.js");
  if (!existsSync(entry)) {
    throw new Error("先 pnpm --filter @karakeep/workers run build");
  }
  workers = spawn(process.execPath, [entry], {
    cwd: path.join(root, "apps", "workers"),
    env: { ...env, NODE_ENV: "production", USING_LEGACY_SEPARATE_CONTAINERS: "true" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  workers.log = [];
  workers.stdout.on("data", (d) => workers.log.push(String(d)));
  workers.stderr.on("data", (d) => workers.log.push(String(d)));
}

function stopServer() {
  for (const p of [server, workers]) {
    if (!p?.pid) continue;
    try {
      spawnSync("taskkill", ["/pid", String(p.pid), "/T", "/F"], {
        stdio: "ignore",
      });
    } catch {}
  }
}

function raindropCsv(tag) {
  const rows = ["id,title,note,excerpt,url,folder,tags,created,cover,highlights,lastUpdate"];
  for (let i = 1; i <= IMPORT; i++) {
    rows.push(
      [
        i,
        `导入探针${tag}-${i}`,
        "",
        "",
        `https://example.com/import-${tag}-${i}`,
        "导入测试",
        `csv,tag${i}`,
        "2026-01-02T03:04:05Z",
        "",
        "",
        "",
      ].join(","),
    );
  }
  return rows.join("\n");
}

async function exportJson(cookie) {
  const res = await fetch(`${base}/api/bookmarks/export?format=json`, {
    headers: { cookie },
  });
  if (!res.ok) throw new Error(`导出失败 HTTP ${res.status}`);
  return res.json();
}

/** tRPC query（GET + batch 格式） */
async function trpcQuery(proc, input, cookie) {
  const url = `${base}/api/trpc/${proc}?batch=1&input=${encodeURIComponent(
    JSON.stringify({ "0": { json: input } }),
  )}`;
  const res = await fetch(url, { headers: { cookie } });
  if (!res.ok) throw new Error(`tRPC ${proc} HTTP ${res.status}`);
  const json = await res.json();
  return json?.[0]?.result?.data?.json ?? null;
}

async function main() {
  console.log(`# 导入导出烟测  base=${base}  data=${dataDir}`);

  console.log("… 建库");
  run(process.execPath, ["--import", "tsx", "migrate.ts"], path.join(root, "packages", "db"));
  run(
    process.execPath,
    ["--import", "tsx", "scripts/migrateQueue.ts"],
    path.join(root, "apps", "workers"),
  );

  console.log("… 起 workers（导入暂存要靠它落库）");
  startWorkers();

  console.log("… 起 web");
  startServer();
  await waitHealth();

  // 注册
  const h = { "content-type": "application/json", origin: base };
  const email = `ie-${Date.now()}@example.com`;
  const r1 = await fetch(`${base}/api/otp/request`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({ email, purpose: "sign-up" }),
  });
  const d1 = await r1.json();
  const r2 = await fetch(`${base}/api/otp/register`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({ name: "IE", email, password: "IePassw0rd!", code: d1.code }),
  });
  if (!r2.ok) throw new Error("注册失败");
  const cookie = r2.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

  // 造 30 条文字收藏
  const titles = Array.from({ length: SEED }, (_, i) => `导出探针 ${String(i + 1).padStart(3, "0")}`);
  for (const text of titles) {
    const res = await fetch(`${base}/api/trpc/bookmarks.createBookmark?batch=1`, {
      method: "POST",
      headers: { ...h, cookie },
      body: JSON.stringify({ "0": { json: { type: "text", text } } }),
    });
    if (!res.ok) throw new Error(`创建收藏失败 HTTP ${res.status}`);
  }

  // 导出 JSON
  const exported = await exportJson(cookie);
  const count = exported.bookmarks?.length ?? 0;
  if (count === SEED) ok("导出 JSON 条数", String(count));
  else bad("导出 JSON 条数", `期望 ${SEED}，实际 ${count}`);

  const exportedTitles = new Set(
    (exported.bookmarks ?? []).map(
      (b) => b.title ?? (b.content?.type === "text" ? b.content.text : "") ?? "",
    ),
  );
  const missing = titles.filter((t) => !exportedTitles.has(t));
  if (missing.length === 0) ok("导出 JSON 含全部标题");
  else bad("导出 JSON 含全部标题", `缺 ${missing.length} 条，例如 ${missing[0]}`);

  // 导出 Markdown（走 tRPC exportAll；HTTP 路由只支持 json / netscape）
  const mdExport = await trpcQuery(
    "bookmarks.exportAll",
    { format: "markdown", limit: 5000 },
    cookie,
  );
  const md = typeof mdExport === "string" ? mdExport : JSON.stringify(mdExport ?? "");
  if (md.includes(titles[0]) && titles.every((t) => md.includes(t))) {
    ok("导出 Markdown 含全部标题", `${md.length} 字符`);
  } else {
    bad("导出 Markdown 含全部标题", `长度 ${md.length}`);
  }

  // UI 导入 Raindrop CSV
  const tag = String(Date.now()).slice(-5);
  const browser = await chromium.launch({ channel: "msedge" });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, locale: "zh-CN" });
  const [cn, cv] = cookie.split("=");
  await ctx.addCookies([{ name: cn, value: cv, url: base }]);
  const page = await ctx.newPage();
  page.setDefaultTimeout(90_000);
  await page.goto(`${base}/settings/import`, { waitUntil: "networkidle" });
  const fileInput = page.locator('[data-testid="import-raindrop-input"]');
  if ((await fileInput.count()) === 0) {
    bad("找到 Raindrop 上传入口", "没有 data-testid=import-raindrop-input");
  } else {
    await fileInput.setInputFiles({
      name: "raindrop.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(raindropCsv(tag), "utf8"),
    });
    ok("上传 Raindrop CSV", `tag=${tag}`);

    // 等导入落地：轮询导出，直到 5 个新标题都出现
    const wanted = Array.from({ length: IMPORT }, (_, i) => `导入探针${tag}-${i + 1}`);
    let seen = 0;
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const data = await exportJson(cookie).catch(() => null);
      const all = new Set(
        (data?.bookmarks ?? []).map(
          (b) =>
            b.title ?? (b.content?.type === "text" ? b.content.text : "") ?? "",
        ),
      );
      seen = wanted.filter((t) => all.has(t)).length;
      if (seen === IMPORT) break;
      await page.waitForTimeout(2000);
    }
    if (seen === IMPORT) ok("导入的 5 条全部入库", `${seen}/${IMPORT}`);
    else bad("导入的 5 条全部入库", `${seen}/${IMPORT}`);

    const final = await exportJson(cookie).catch(() => null);
    const total = final?.bookmarks?.length ?? 0;
    if (total === SEED + IMPORT) ok("导入后总数", String(total));
    else bad("导入后总数", `期望 ${SEED + IMPORT}，实际 ${total}`);
  }
  await browser.close();
}

try {
  await main();
} catch (e) {
  bad("烟测运行", String(e?.message ?? e).split("\n")[0]);
  if (server?.log?.length) {
    console.log("--- server log ---");
    console.log(server.log.join("").slice(-1500));
  }
} finally {
  stopServer();
  removeAssets();
  await new Promise((r) => setTimeout(r, 1200));
  try {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 });
  } catch {
    console.log(`（临时数据目录没删掉：${dataDir}）`);
  }
  console.log(`\n== ${pass} passed, ${fail} failed ==`);
  if (fail > 0) process.exitCode = 1;
}
