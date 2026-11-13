// PWA 离线壳烟测：断网（直接把服务器停掉）后刷新，应该看到缓存里的页面而不是浏览器错误页。
//
// 注意：不要用 Playwright 的 `context.setOffline(true)` 来模拟 —— 它不会作用到
// Service Worker 的请求，测出来永远是浏览器错误页（本项目踩过）。真停服务才准。
//
// 用法：node scripts/e2e-pwa.mjs

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
const PORT = Number(process.env.E2E_PWA_PORT ?? 3029);
const base = `http://127.0.0.1:${PORT}`;
const dataDir = mkdtempSync(path.join(os.tmpdir(), "iv-e2e-pwa-"));
const secret = "e2e-pwa-secret-0123456789abcdef012";

let pass = 0;
let fail = 0;
let server = null;

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
  if (r.status !== 0) throw new Error((r.stderr || r.stdout).slice(0, 500));
}

function ensureAssets(standalone) {
  const webRoot = path.join(root, "apps", "web");
  for (const [link, target] of [
    [path.join(standalone, "apps", "web", ".next", "static"), path.join(webRoot, ".next", "static")],
    [path.join(standalone, "apps", "web", "public"), path.join(webRoot, "public")],
  ]) {
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

function startServer() {
  const standalone = path.join(root, "apps", "web", ".next", "standalone");
  const entry = path.join(standalone, "apps", "web", "server.js");
  if (!existsSync(entry)) throw new Error("先 pnpm --filter @karakeep/web run build");
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

function stopServer() {
  if (!server?.pid) return;
  try {
    spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  } catch {}
  server = null;
}

async function main() {
  console.log(`# PWA 离线烟测  base=${base}  data=${dataDir}`);
  console.log("… 建库");
  run(process.execPath, ["--import", "tsx", "migrate.ts"], path.join(root, "packages", "db"));
  run(process.execPath, ["--import", "tsx", "scripts/migrateQueue.ts"], path.join(root, "apps", "workers"));

  console.log("… 起 web");
  startServer();
  await waitHealth();

  const sw = await fetch(`${base}/sw.js`);
  const swText = await sw.text();
  if (sw.ok && swText.includes("insight-vault-v1")) ok("/sw.js 可访问", `${swText.length} 字节`);
  else bad("/sw.js 可访问", `HTTP ${sw.status}`);

  const h = { "content-type": "application/json", origin: base };
  const email = `pwa-${Date.now()}@example.com`;
  const d1 = await (await fetch(`${base}/api/otp/request`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({ email, purpose: "sign-up" }),
  })).json();
  const reg = await fetch(`${base}/api/otp/register`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({ name: "PWA", email, password: "PwaPassw0rd!", code: d1.code }),
  });
  if (!reg.ok) throw new Error("注册失败");
  const cookie = reg.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

  const browser = await chromium.launch({ channel: "msedge" });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: "zh-CN" });
  const [cn, cv] = cookie.split("=");
  await ctx.addCookies([{ name: cn, value: cv, url: base }]);
  const page = await ctx.newPage();
  page.setDefaultTimeout(45_000);

  await page.goto(`${base}/dashboard/bookmarks`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  const active = await page.evaluate(async () => !!(await navigator.serviceWorker.ready).active);
  if (active) ok("Service Worker 已激活");
  else bad("Service Worker 已激活");

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
  if (controlled) ok("页面已被 SW 接管");
  else bad("页面已被 SW 接管");

  console.log("… 停掉服务器，模拟真断网");
  stopServer();
  await new Promise((r) => setTimeout(r, 1200));

  const visit = async (pathname) => {
    try {
      const res = await page.goto(base + pathname, { waitUntil: "domcontentloaded", timeout: 15_000 });
      const text = await page.locator("body").innerText().catch(() => "");
      return { status: res?.status() ?? null, text };
    } catch (e) {
      return { status: null, text: "", error: String(e.message).slice(0, 80) };
    }
  };

  const cached = await visit("/dashboard/bookmarks");
  if (cached.status === 200 && /图片|收藏|灵感仓/.test(cached.text)) {
    ok("断网后仍能打开收藏库（缓存页）", cached.text.replace(/\n+/g, " | ").slice(0, 40));
  } else {
    bad("断网后仍能打开收藏库（缓存页）", JSON.stringify(cached).slice(0, 120));
  }

  const offlinePage = await visit("/offline");
  if (offlinePage.status === 200 && offlinePage.text.includes("离线")) {
    ok("断网兜底页可打开");
  } else {
    bad("断网兜底页可打开", JSON.stringify(offlinePage).slice(0, 120));
  }

  await browser.close();
}

try {
  await main();
} catch (e) {
  bad("烟测运行", String(e?.message ?? e).split("\n")[0]);
  if (server?.log?.length) console.log(server.log.join("").slice(-1200));
} finally {
  stopServer();
  removeAssets();
  await new Promise((r) => setTimeout(r, 1000));
  try {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 });
  } catch {
    console.log(`（临时数据目录没删掉：${dataDir}）`);
  }
  console.log(`\n== ${pass} passed, ${fail} failed ==`);
  if (fail > 0) process.exitCode = 1;
}
