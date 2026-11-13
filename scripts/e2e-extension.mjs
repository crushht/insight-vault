// 浏览器扩展构建 + 加载烟测。
//
//   1. 检查 dist/（先跑 pnpm --filter @karakeep/browser-extension run build）
//   2. 校验 manifest（MV3 / 名称 / 权限 / 背景脚本 / popup）
//   3. 用「加载已解压扩展」的方式真加载一次，等 service worker 起来
//   4. 打开扩展的 popup 页面，确认能渲染、没有 JS 报错
//
// 用法：node scripts/e2e-extension.mjs
//
// 注意：扩展只能在有头模式加载；脚本会短暂弹出一个浏览器窗口。

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "apps", "browser-extension", "dist");
const profile = mkdtempSync(path.join(os.tmpdir(), "iv-ext-profile-"));

let pass = 0;
let fail = 0;
function ok(n, extra = "") {
  pass++;
  console.log(`PASS  ${n}${extra ? "  <- " + extra : ""}`);
}
function bad(n, extra = "") {
  fail++;
  console.log(`FAIL  ${n}${extra ? "  <- " + extra : ""}`);
}

function findBundledChromium() {
  const cacheDir = path.join(os.homedir(), "AppData", "Local", "ms-playwright");
  try {
    for (const dir of readdirSync(cacheDir)) {
      if (!dir.startsWith("chromium-")) continue;
      const exe = path.join(cacheDir, dir, "chrome-win64", "chrome.exe");
      if (existsSync(exe)) return exe;
    }
  } catch {}
  return null;
}

async function launchWithExtension() {
  const args = [
    `--disable-extensions-except=${dist}`,
    `--load-extension=${dist}`,
    "--no-first-run",
  ];
  const attempts = [
    { channel: "msedge", headless: false, args },
    { headless: false, args },
  ];
  const bundled = findBundledChromium();
  if (bundled) attempts.push({ executablePath: bundled, headless: false, args });

  let lastError = null;
  for (const options of attempts) {
    try {
      const ctx = await chromium.launchPersistentContext(profile, options);
      const how = options.channel
        ? `channel=${options.channel}`
        : options.executablePath
          ? `executablePath=${options.executablePath}`
          : "默认 chromium";
      return { ctx, how };
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError ?? new Error("无法启动带扩展的浏览器");
}

async function main() {
  console.log(`# 扩展烟测  dist=${dist}`);

  if (!existsSync(path.join(dist, "manifest.json"))) {
    throw new Error("dist 为空：先跑 pnpm --filter @karakeep/browser-extension run build");
  }

  const manifest = JSON.parse(readFileSync(path.join(dist, "manifest.json"), "utf8"));
  const checks = [
    [manifest.manifest_version === 3, "manifest 是 MV3", `v${manifest.manifest_version}`],
    [String(manifest.name).includes("灵感仓"), "名称是品牌名", String(manifest.name)],
    [!!manifest.background?.service_worker, "有 background service worker", manifest.background?.service_worker ?? ""],
    [!!manifest.action?.default_popup, "有 popup", manifest.action?.default_popup ?? ""],
    [
      Array.isArray(manifest.permissions) &&
        ["storage", "contextMenus", "activeTab"].every((p) => manifest.permissions.includes(p)),
      "权限齐全",
      (manifest.permissions ?? []).join(","),
    ],
  ];
  for (const [cond, name, extra] of checks) {
    if (cond) ok(name, String(extra));
    else bad(name, String(extra));
  }

  const { ctx, how } = await launchWithExtension();
  console.log(`… 浏览器：${how}`);
  try {
    let worker = ctx.serviceWorkers()[0];
    if (!worker) {
      worker = await ctx.waitForEvent("serviceworker", { timeout: 20_000 }).catch(() => null);
    }
    if (!worker) {
      bad("扩展 service worker 已注册", "20 秒内没等到（可能浏览器禁用了 --load-extension）");
      return;
    }
    const extId = new URL(worker.url()).host;
    ok("扩展 service worker 已注册", extId);

    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 160)));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text().slice(0, 160));
    });

    await page.goto(`chrome-extension://${extId}/index.html`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.waitForTimeout(2500);
    const text = await page.locator("body").innerText().catch(() => "");
    const rendered = text.trim().length > 10;
    if (rendered) ok("popup 能渲染", text.replace(/\n+/g, " | ").slice(0, 60));
    else bad("popup 能渲染", "页面几乎为空");

    if (/邮箱/.test(text) && /登录/.test(text)) ok("popup 已中文化");
    else bad("popup 已中文化", text.replace(/\n+/g, " | ").slice(0, 60));

    if (!/karakeep\.com/i.test(text)) ok("不再出现上游域名/品牌");
    else bad("不再出现上游域名/品牌", (text.match(/[a-z.]*karakeep\.com/i) ?? [""])[0]);

    const realErrors = errors.filter(
      (e) => !/favicon|net::ERR|Failed to load resource/i.test(e),
    );
    if (realErrors.length === 0) ok("popup 无 JS 报错");
    else bad("popup 无 JS 报错", realErrors.slice(0, 2).join(" / "));

    await page.screenshot({ path: path.join(root, "..", "artifacts", "visual", "e2e-web", "extension-popup.png") });
  } finally {
    await ctx.close().catch(() => {});
  }
}

try {
  await main();
} catch (e) {
  bad("烟测运行", String(e?.message ?? e).split("\n")[0]);
} finally {
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
  } catch {}
  console.log(`\n== ${pass} passed, ${fail} failed ==`);
  if (fail > 0) process.exitCode = 1;
}
