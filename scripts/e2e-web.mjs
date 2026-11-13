// Web 端 Playwright 冒烟测试：注册（密码 + 邮箱验证码）→ 自动登录 → 会话保持 → 邮箱密码登录。
//
// 自己拉一套干净的环境：临时 DATA_DIR + 迁移 + next dev（强制关掉 SMTP，走本地模式），
// 跑完自动清理，不会污染开发库，也不依赖外网。
//
// 用法：
//   node scripts/e2e-web.mjs                 # 默认端口 3010
//   E2E_PORT=3011 node scripts/e2e-web.mjs
//
// 前置：根目录装过依赖（playwright / next / tsx 都在 node_modules 里），
//       且本机有 Playwright 的 chromium（`npx playwright install chromium`）。

import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.E2E_PORT ?? 3010);
const base = `http://127.0.0.1:${port}`;
const dataDir = mkdtempSync(path.join(os.tmpdir(), "iv-e2e-web-"));
const shotDir = path.join(root, "..", "artifacts", "visual", "e2e-web");
const secret = "e2e-web-secret-0123456789abcdef0123456789";

let pass = 0;
let fail = 0;
let server = null;

function ok(name, extra = "") {
  pass++;
  console.log(`PASS  ${name}${extra ? "  <- " + extra : ""}`);
}

function bad(name, extra = "") {
  fail++;
  console.log(`FAIL  ${name}${extra ? "  <- " + extra : ""}`);
}

async function check(name, fn) {
  try {
    const extra = await fn();
    ok(name, extra ?? "");
  } catch (e) {
    bad(name, String(e?.message ?? e).split("\n")[0]);
  }
}

function childEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("SMTP_")) delete env[key];
  }
  // 保险：即使 shell / .env 里还有 SMTP，也强制走本地模式（验证码直接回显）
  env.SMTP_HOST = "";
  env.LOCAL_AUTH_CODE = "1";
  env.DATA_DIR = dataDir;
  env.NEXTAUTH_SECRET = secret;
  env.NEXTAUTH_URL = base;
  env.PORT = String(port);
  env.RATE_LIMITING_ENABLED = "false";
  return env;
}

function runMigrations(env) {
  const r = spawnSync(process.execPath, ["--import", "tsx", "migrate.ts"], {
    cwd: path.join(root, "packages", "db"),
    env,
    encoding: "utf8",
    timeout: 180_000,
  });
  if (r.status !== 0) {
    throw new Error(
      `数据库迁移失败：${(r.stderr || r.stdout || "").slice(0, 600)}`,
    );
  }

  // 队列库（liteque 的 tasks 表）。不建的话「新建收藏」会在入队时 500
  const q = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/migrateQueue.ts"],
    {
      cwd: path.join(root, "apps", "workers"),
      env,
      encoding: "utf8",
      timeout: 180_000,
    },
  );
  if (q.status !== 0) {
    throw new Error(
      `队列库迁移失败：${(q.stderr || q.stdout || "").slice(0, 600)}`,
    );
  }
}

async function waitHealth(timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 800));
  }
  throw new Error("服务启动超时（/api/health 一直没通）");
}

function ensureLink(link, target) {
  if (existsSync(link) || !existsSync(target)) return;
  try {
    mkdirSync(path.dirname(link), { recursive: true });
    symlinkSync(target, link, "junction");
  } catch {}
}

/** 收尾：把测试期间建的 junction 拆掉，否则 electron-builder 复制时会报错。 */
function removeLinks() {
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

/**
 * 起服务。默认用**生产构建**（`.next/standalone`）：和桌面版跑的是同一份产物，
 * 而且 dev（Turbopack）在当前环境里客户端水合不稳定，不适合当回归基准。
 * 想跑 dev 设 E2E_MODE=dev。
 */
function startServer(env) {
  const mode = process.env.E2E_MODE ?? "prod";

  if (mode === "dev") {
    const nextBin = path.join(
      root,
      "node_modules",
      "next",
      "dist",
      "bin",
      "next",
    );
    server = spawn(process.execPath, [nextBin, "dev", "-p", String(port)], {
      cwd: path.join(root, "apps", "web"),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    console.log("… 模式：next dev");
  } else {
    const webRoot = path.join(root, "apps", "web");
    const standalone = path.join(webRoot, ".next", "standalone");
    const entry = path.join(standalone, "apps", "web", "server.js");
    if (!existsSync(entry)) {
      throw new Error(
        "没有 standalone 构建：先跑 pnpm --filter @karakeep/web run build，或设 E2E_MODE=dev",
      );
    }
    // 生产包里不带 static/public，按桌面版的做法补目录联接
    ensureLink(
      path.join(standalone, "apps", "web", ".next", "static"),
      path.join(webRoot, ".next", "static"),
    );
    ensureLink(
      path.join(standalone, "apps", "web", "public"),
      path.join(webRoot, "public"),
    );
    // `next build` 会把 apps/web/.env 复制进 standalone；测试要的是「没有 SMTP」的干净实例
    for (const f of readdirSync(path.join(standalone, "apps", "web"))) {
      if (f === ".env" || f.startsWith(".env.")) {
        rmSync(path.join(standalone, "apps", "web", f), { force: true });
      }
    }
    server = spawn(process.execPath, [entry], {
      cwd: standalone,
      env: { ...env, NODE_ENV: "production" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    console.log("… 模式：standalone（生产构建）");
  }

  const log = [];
  server.stdout.on("data", (d) => log.push(String(d)));
  server.stderr.on("data", (d) => log.push(String(d)));
  server.log = log;
}

function stopServer() {
  if (server && server.pid) {
    try {
      if (process.platform === "win32") {
        spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], {
          stdio: "ignore",
        });
      } else {
        server.kill("SIGTERM");
      }
    } catch {}
  }
  server = null;
}

/**
 * 找一台能用的浏览器：
 *   1. E2E_CHANNEL 指定（如 msedge / chrome）
 *   2. 系统 Edge
 *   3. 本机 ms-playwright 里任意版本 chromium（driver 与浏览器版本略有差异也能跑）
 *   4. 默认（会去要完全匹配的版本，通常就是这里报错）
 */
async function launchBrowser() {
  const attempts = [];
  if (process.env.E2E_CHANNEL) {
    attempts.push({ channel: process.env.E2E_CHANNEL });
  }
  attempts.push({ channel: "msedge" });

  const cacheDir = path.join(
    os.homedir(),
    "AppData",
    "Local",
    "ms-playwright",
  );
  try {
    for (const dir of readdirSync(cacheDir)) {
      if (!dir.startsWith("chromium-")) continue;
      const exe = path.join(cacheDir, dir, "chrome-win64", "chrome.exe");
      if (existsSync(exe)) attempts.push({ executablePath: exe });
    }
  } catch {}
  attempts.push({});

  let lastError = null;
  for (const options of attempts) {
    try {
      const browser = await chromium.launch(options);
      const how = options.channel
        ? `channel=${options.channel}`
        : options.executablePath
          ? `executablePath=${options.executablePath}`
          : "默认 chromium";
      console.log(`… 浏览器：${how}`);
      return browser;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError ?? new Error("没有可用的浏览器");
}

async function main() {
  console.log(`# Playwright 冒烟测试  base=${base}  data=${dataDir}`);
  const env = childEnv();

  console.log("… 初始化数据库");
  runMigrations(env);

  console.log("… 启动 next dev（无 SMTP，本地模式）");
  startServer(env);
  await waitHealth();

  mkdirSync(shotDir, { recursive: true });

  const browser = await launchBrowser();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "zh-CN",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(90_000);

  if (process.env.E2E_DEBUG) {
    page.on("console", (m) =>
      console.log(`  [browser:${m.type()}] ${m.text()}`.slice(0, 300)),
    );
    page.on("response", async (r) => {
      if (!r.url().includes("/api/")) return;
      const body = await r.text().catch(() => "");
      console.log(`  [http] ${r.status()} ${r.url().replace(base, "")} ${body.slice(0, 200)}`);
    });
    page.on("requestfailed", (r) =>
      console.log(`  [http-fail] ${r.url()} ${r.failure()?.errorText ?? ""}`),
    );
  }

  const email = `ui-${Date.now()}@example.com`;
  const password = "UiPassw0rd!";

  try {
    // 1) 登录页
    await check("登录页渲染", async () => {
      await page.goto(`${base}/signin`, { waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { name: /欢迎回来/ }).waitFor();
      await page.locator('[data-testid="signin-email"]').waitFor();
      await page.locator('[data-testid="signin-password"]').waitFor();
      const remember = page.locator('[data-testid="signin-remember-me"]');
      const checked = await remember.isChecked();
      if (!checked) throw new Error("「保持登录」默认没有勾上");
      const otpEntry = await page
        .getByText("已有账号但想免密码登录")
        .count();
      if (otpEntry !== 0) {
        throw new Error("没配 SMTP 时不应该出现验证码登录入口");
      }
      await page.screenshot({ path: path.join(shotDir, "signin.png") });
      return "标题/输入框/保持登录/无验证码入口 都对";
    });

    // 2) 注册（密码 + 验证码，本地模式自动填码）
    await check("注册 → 自动登录", async () => {
      await page.getByRole("link", { name: "注册" }).first().click();
      await page.waitForURL(/\/signup/);
      await page.locator('[data-testid="signup-name"]').fill("界面测试");
      await page.locator('[data-testid="signup-email"]').fill(email);
      await page.locator('[data-testid="signup-password"]').fill(password);
      await page
        .locator('[data-testid="signup-confirm-password"]')
        .fill(password);
      await page.locator('[data-testid="signup-send-code"]').click();
      const codeInput = page.locator('[data-testid="signup-code"]');
      await page.waitForFunction(
        () => {
          const el = document.querySelector(
            '[data-testid="signup-code"]',
          );
          return !!el && el.value.length === 6;
        },
        undefined,
        { timeout: 30_000 },
      );
      const hint = await page.getByText(/本地模式验证码/).count();
      if (hint === 0) throw new Error("没有出现本地模式验证码提示");
      await page.locator('[data-testid="signup-submit"]').click();
      await page.waitForURL(/\/dashboard\/bookmarks/, { timeout: 60_000 });
      return page.url().replace(base, "");
    });

    // 3) 刷新仍在登录态
    await check("刷新后仍在登录态", async () => {
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle").catch(() => {});
      if (!/\/dashboard\/bookmarks/.test(page.url())) {
        throw new Error(`被踢回登录页：${page.url()}`);
      }
      await page.screenshot({ path: path.join(shotDir, "dashboard.png") });
      return page.url().replace(base, "");
    });

    // 4) 清 cookie 后被拦回登录页，且邮箱已记住
    await check("未登录访问受保护页 → 回登录页", async () => {
      await context.clearCookies();
      await page.goto(`${base}/dashboard/bookmarks`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForURL(/\/signin/, { timeout: 30_000 });
      return page.url().replace(base, "");
    });

    // 5) 邮箱 + 密码登录（邮箱自动预填）
    await check("邮箱 + 密码登录（邮箱已预填）", async () => {
      const emailInput = page.locator('[data-testid="signin-email"]');
      await emailInput.waitFor();
      await page.waitForFunction(
        (expected) => {
          const el = document.querySelector('[data-testid="signin-email"]');
          return !!el && el.value === expected;
        },
        email,
        { timeout: 15_000 },
      );
      await page.locator('[data-testid="signin-password"]').fill(password);
      await page.locator('[data-testid="signin-submit"]').click();
      await page.waitForURL(/\/dashboard\/bookmarks/, { timeout: 60_000 });
      return page.url().replace(base, "");
    });

    // 6) 错误密码有明确提示
    await check("错误密码给出提示", async () => {
      await context.clearCookies();
      await page.goto(`${base}/signin`, { waitUntil: "domcontentloaded" });
      await page.locator('[data-testid="signin-email"]').fill(email);
      await page
        .locator('[data-testid="signin-password"]')
        .fill("WrongPassword!");
      await page.locator('[data-testid="signin-submit"]').click();
      await page.getByText(/不正确|错误|Invalid|incorrect/i).first().waitFor({
        timeout: 30_000,
      });
      return "出现错误提示，未跳转";
    });

    // 7) 重新登录（顺便验「登录过一次之后本机记住邮箱」）
    await check("用邮箱 + 密码重新登录", async () => {
      await page.locator('[data-testid="signin-password"]').fill(password);
      await page.locator('[data-testid="signin-submit"]').click();
      await page.waitForURL(/\/dashboard\/bookmarks/, { timeout: 60_000 });
      return page.url().replace(base, "");
    });

    // 8) 新建一条文字笔记
    const noteText = `Playwright 笔记 ${Date.now()}`;
    await check("新建文字笔记", async () => {
      const editor = page.locator('[data-testid="bookmark-editor"]');
      await editor.waitFor();
      await editor.fill(noteText);
      await page.getByRole("button", { name: "保存" }).first().click();
      // 保存成功的信号：输入框被清空（列表刷新是异步的，别用「立刻出现」当判据）
      await page.waitForFunction(
        () => {
          const el = document.querySelector('[data-testid="bookmark-editor"]');
          return !!el && el.value.trim() === "";
        },
        undefined,
        { timeout: 30_000 },
      );
      await page.reload({ waitUntil: "networkidle" });
      await page.getByText(noteText).first().waitFor({ timeout: 60_000 });
      return noteText;
    });

    // 9) 搜索命中刚建的笔记
    await check("搜索命中新建的笔记", async () => {
      await page.goto(
        `${base}/dashboard/search?q=${encodeURIComponent("Playwright 笔记")}`,
        { waitUntil: "networkidle" },
      );
      await page.getByText(noteText).first().waitFor({ timeout: 60_000 });
      return "搜索结果里出现该笔记";
    });

    // 10) 分类页（is:image）能渲染，不崩
    await check("分类页 is:image 渲染", async () => {
      await page.goto(`${base}/dashboard/search?q=is%3Aimage`, {
        waitUntil: "networkidle",
      });
      await page.getByRole("link", { name: "图片", exact: true }).first().waitFor();
      const body = await page.locator("body").innerText();
      if (/Application error|Unhandled Runtime/i.test(body)) {
        throw new Error("页面出现错误覆盖层");
      }
      return "侧栏与空态正常";
    });

    // 11) 设置页：AI 预设与基本信息
    await check("设置页可打开（AI 预设 / 信息）", async () => {
      await page.goto(`${base}/settings/ai`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "DeepSeek" }).first().waitFor({
        timeout: 30_000,
      });
      await page.goto(`${base}/settings/info`, { waitUntil: "networkidle" });
      const body = await page.locator("body").innerText();
      if (/Application error|Unhandled Runtime/i.test(body)) {
        throw new Error("/settings/info 出现错误覆盖层");
      }
      return "AI 预设与设置页都正常";
    });

    // 12) 手机宽度不横向溢出
    await check("390 宽不横向溢出", async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${base}/dashboard/bookmarks`, { waitUntil: "networkidle" });
      await page.waitForTimeout(600);
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      if (scrollWidth > clientWidth + 1) {
        throw new Error(`横向溢出：scrollWidth=${scrollWidth} clientWidth=${clientWidth}`);
      }
      await page.screenshot({
        path: path.join(shotDir, "mobile-bookmarks.png"),
      });
      await page.setViewportSize({ width: 1440, height: 900 });
      return `${clientWidth}px 无溢出`;
    });

    // 13) 键盘可达：Tab 能到收藏卡片（链接），Enter 能打开
    await check("键盘能 Tab 到收藏卡片并打开", async () => {
      await page.goto(`${base}/dashboard/bookmarks`, { waitUntil: "networkidle" });
      let reached = false;
      let href = "";
      for (let i = 0; i < 120; i++) {
        await page.keyboard.press("Tab");
        const info = await page.evaluate(() => {
          const el = document.activeElement;
          const anchor = el?.closest?.("a");
          return {
            isAnchor: el?.tagName === "A",
            href: anchor?.getAttribute("href") ?? "",
            text: (el?.textContent ?? "").slice(0, 120),
          };
        });
        // 只认「聚焦到的就是链接本身」：祖先进程容器的 textContent 也含这段文字，不能算。
        // 收藏卡片的可点区域是 /dashboard/preview/<id> 这个链接。
        if (info.isAnchor && /\/dashboard\/preview\//.test(info.href)) {
          reached = true;
          href = info.href;
          break;
        }
      }
      if (!reached) {
        throw new Error("Tab 120 次仍未聚焦到收藏卡片链接（键盘不可达）");
      }
      await page.keyboard.press("Enter");
      await page.waitForTimeout(1800);
      const opened =
        page.url().includes("/dashboard/preview/") ||
        (await page.locator('[role="dialog"]').count()) > 0;
      if (!opened) {
        throw new Error(`Enter 没能打开收藏详情（url=${page.url()} href=${href}）`);
      }
      return `Tab 命中 ${href}，Enter 后 ${page.url().replace(base, "")}`;
    });


  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

try {
  await main();
} catch (e) {
  bad("测试框架运行", String(e?.message ?? e).split("\n")[0]);
  if (server?.log?.length) {
    console.log("--- server log tail ---");
    console.log(server.log.join("").slice(-2000));
  }
} finally {
  stopServer();
  removeLinks();
  await new Promise((r) => setTimeout(r, 1500));
  try {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 });
  } catch (e) {
    console.log(`（临时数据目录没删掉，可手动清理：${dataDir}）`);
  }
  console.log(`\n== ${pass} passed, ${fail} failed ==`);
  if (fail > 0) process.exitCode = 1;
}
