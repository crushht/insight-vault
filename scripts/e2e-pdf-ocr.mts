// PDF / OCR 端到端验证（需要真实视觉模型）。
//
//   1. 建库 → 起 workers（带 AI env）+ web
//   2. 三种素材都走应用真实的「资产预处理」链路：
//        a. 有文本层的 PDF      → pdf2json 抽文本
//        b. 扫描件（只有图片的 PDF）→ 本次新增的兜底：pdfjs 渲染 → 视觉模型 OCR
//        c. 图片                → LLM OCR（OCR_USE_LLM=1）
//   3. 从 bookmarkAssets.content 断言抽到的文字
//
// 用法：
//   AI_BASE_URL=http://127.0.0.1:8788/v1 AI_KEY=xxx AI_MODEL=deepseek-v4.1-flash \
//   pnpm exec tsx scripts/e2e-pdf-ocr.ts

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.E2E_PDF_PORT ?? 3036);
const base = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "iv-e2e-pdf-"));
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "iv-e2e-pdf-work-"));
const secret = "e2e-pdf-secret-0123456789abcdef01234";

const AI_BASE_URL = process.env.AI_BASE_URL ?? "";
const AI_KEY = process.env.AI_KEY ?? "";
const AI_MODEL = process.env.AI_MODEL ?? "deepseek-v4.1-flash";

// 先把 env 落到本进程，再动态 import 依赖 env 的包（config.ts 在模块加载时就校验）
const CHILD_ENV: Record<string, string> = {
  SMTP_HOST: "",
  LOCAL_AUTH_CODE: "1",
  DATA_DIR: dataDir,
  NEXTAUTH_SECRET: secret,
  NEXTAUTH_URL: base,
  OPENAI_API_KEY: AI_KEY,
  OPENAI_BASE_URL: AI_BASE_URL,
  INFERENCE_TEXT_MODEL: AI_MODEL,
  INFERENCE_IMAGE_MODEL: AI_MODEL,
  OCR_USE_LLM: "true",
  EMBEDDING_ENABLE_AUTO_INDEXING: "false",
};
for (const [k, v] of Object.entries(CHILD_ENV)) process.env[k] = v;

const { db } = await import("@karakeep/db");
const { assets: assetsTable, AssetTypes, bookmarkAssets } = await import(
  "@karakeep/db/schema"
);
const { saveAssetFromFile } = await import("@karakeep/shared-server");
const { eq } = await import("drizzle-orm");

let pass = 0;
let fail = 0;
const procs: Array<{ pid?: number; log: string[] }> = [];

function ok(n: string, extra = "") {
  pass++;
  console.log(`PASS  ${n}${extra ? "  <- " + extra : ""}`);
}
function bad(n: string, extra = "") {
  fail++;
  console.log(`FAIL  ${n}${extra ? "  <- " + extra : ""}`);
}

const env = { ...process.env, ...CHILD_ENV } as NodeJS.ProcessEnv;

function run(cmd: string, args: string[], cwd: string) {
  const r = spawnSync(cmd, args, { cwd, env, encoding: "utf8", timeout: 180_000 });
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || "").slice(0, 500));
}

function start(cmd: string, args: string[], cwd: string, extraEnv: Record<string, string> = {}) {
  const p = spawn(cmd, args, { cwd, env: { ...env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"] });
  const rec = { pid: p.pid, log: [] as string[] };
  p.stdout?.on("data", (d) => rec.log.push(String(d)));
  p.stderr?.on("data", (d) => rec.log.push(String(d)));
  procs.push(rec);
  return rec;
}

function stopAll() {
  for (const p of [...procs].reverse()) {
    if (!p.pid) continue;
    try {
      spawnSync("taskkill", ["/pid", String(p.pid), "/T", "/F"], { stdio: "ignore" });
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

async function trpcMut(proc: string, input: unknown, cookie: string) {
  const res = await fetch(`${base}/api/trpc/${proc}?batch=1`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base, cookie },
    body: JSON.stringify({ "0": { json: input } }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`tRPC ${proc} HTTP ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text)?.[0]?.result?.data?.json ?? null;
}

/** 按应用自己的上传路径落一个资产：assets 行 + 文件 + 返回 assetId */
async function uploadAsset(userId: string, filePath: string, contentType: string, fileName: string) {
  const assetId = randomUUID().replace(/-/g, "").slice(0, 20);
  const size = fs.statSync(filePath).size;
  await db.insert(assetsTable).values({
    id: assetId,
    assetType: AssetTypes.UNKNOWN,
    bookmarkId: null,
    userId,
    contentType,
    size,
    fileName,
  });
  await saveAssetFromFile({
    userId,
    assetId,
    assetPath: filePath,
    metadata: { contentType, fileName },
    quotaApproved: { userId, approvedSize: size },
  } as never);
  return { assetId, size, fileName };
}

async function waitAssetContent(bookmarkId: string, timeoutMs = 240_000) {
  const Deadline = Date.now() + timeoutMs;
  const Database = (await import("better-sqlite3")).default;
  let last = "";
  while (Date.now() < Deadline) {
    let row: { content?: string | null } | undefined;
    try {
      const sdb = new Database(path.join(dataDir, "db.db"), { readonly: true });
      row = sdb
        .prepare("select content from bookmarkAssets where id = ?")
        .get(bookmarkId) as { content?: string | null } | undefined;
      sdb.close();
    } catch (e) {
      last = String((e as Error).message).slice(0, 60);
    }
    const content = row?.content ?? "";
    if (content.trim().length > 0) return content;
    await new Promise((r) => setTimeout(r, 2500));
  }
  return last;
}

async function main() {
  if (!AI_BASE_URL || !AI_KEY) {
    console.log("跳过：没有设置 AI_BASE_URL / AI_KEY（PDF OCR 需要视觉模型）");
    return;
  }
  console.log(`# PDF/OCR 烟测  model=${AI_MODEL}  endpoint=${AI_BASE_URL}  web=${base}`);

  run(process.execPath, ["--import", "tsx", "migrate.ts"], path.join(root, "packages", "db"));
  run(process.execPath, ["--import", "tsx", "scripts/migrateQueue.ts"], path.join(root, "apps", "workers"));

  console.log("… 起 workers（资产预处理在这里跑）");
  start(process.execPath, [path.join(root, "apps", "workers", "dist", "index.js")], path.join(root, "apps", "workers"));

  console.log("… 起 web");
  const standalone = path.join(root, "apps", "web", ".next", "standalone");
  start(process.execPath, [path.join(standalone, "apps", "web", "server.js")], standalone, {
    NODE_ENV: "production",
    PORT: String(PORT),
  });
  await waitHealth();

  // 注册（拿 userId + cookie）
  const h = { "content-type": "application/json", origin: base };
  const email = `pdf-${Date.now()}@example.com`;
  const d1 = (await (await fetch(`${base}/api/otp/request`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({ email, purpose: "sign-up" }),
  })).json()) as { code: string };
  const reg = await fetch(`${base}/api/otp/register`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({ name: "PDF", email, password: "PdfPassw0rd!", code: d1.code }),
  });
  if (!reg.ok) throw new Error("注册失败");
  const cookie = reg.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const userRow = await db.query.users.findFirst({
    where: (t, { eq }) => eq(t.email, email),
  });
  const userId = userRow?.id;
  if (!userId) throw new Error("拿不到 userId");

  // 用 Playwright 生成两种 PDF
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ channel: "msedge" });
  const page = await browser.newPage();

  const textPdf = path.join(workDir, "text.pdf");
  await page.setContent(
    `<html><body style="font-family:sans-serif;padding:40px">
      <h1>向量检索速览</h1>
      <p>HNSW 是一种近似最近邻算法，查询复杂度约为对数级。</p>
      <p>分块大小会明显影响检索召回质量，需要按语料调整。</p>
    </body></html>`,
  );
  await page.pdf({ path: textPdf, format: "A4" });

  // 现场生成一张带文字的图（不依赖仓库里的截图，避免被别的脚本清掉）
  const pngPath = path.join(workDir, "shot.png");
  await page.setContent(
    `<html><body style="font-family:sans-serif;padding:48px;background:#fff">
       <h1 style="font-size:64px;margin:0 0 24px">灵感仓 OCR 测试图</h1>
       <p style="font-size:32px;line-height:1.6">这一行文字应该被视觉模型读出来：向量检索与召回率。</p>
     </body></html>`,
  );
  await page.setViewportSize({ width: 1200, height: 500 });
  await page.screenshot({ path: pngPath });
  const b64 = fs.readFileSync(pngPath).toString("base64");
  const scannedPdf = path.join(workDir, "scanned.pdf");
  await page.setContent(
    `<html><body style="margin:0"><img src="data:image/png;base64,${b64}" style="width:100%"></body></html>`,
  );
  await page.pdf({ path: scannedPdf, format: "A4", printBackground: true });
  await browser.close();

  // a) 文本层 PDF
  {
    const up = await uploadAsset(userId, textPdf, "application/pdf", "text.pdf");
    const bm = await trpcMut("bookmarks.createBookmark", { type: "asset", assetType: "pdf", assetId: up.assetId, fileName: "text.pdf" }, cookie);
    console.log("[debug] upload:", JSON.stringify(up), "| bookmark:", JSON.stringify(bm).slice(0, 200));
    const content = await waitAssetContent(bm.id);
    if (/向量检索|HNSW/.test(content)) ok("文本层 PDF 抽出正文", `${content.length} 字符`);
    else bad("文本层 PDF 抽出正文", content.slice(0, 80) || "（空）");
  }

  // b) 扫描件（只有图片的 PDF）→ 视觉 OCR 兜底
  {
    const up = await uploadAsset(userId, scannedPdf, "application/pdf", "scanned.pdf");
    const bm = await trpcMut("bookmarks.createBookmark", { type: "asset", assetType: "pdf", assetId: up.assetId, fileName: "scanned.pdf" }, cookie);
    const content = await waitAssetContent(bm.id);
    const hit = /灵\s*感\s*仓|系统状态|设置|数据目录/.test(content);
    if (content.length > 20 && hit) ok("扫描版 PDF 走视觉 OCR 读出文字", `${content.length} 字符`);
    else bad("扫描版 PDF 走视觉 OCR 读出文字", content.slice(0, 80) || "（空）");
  }

  // c) 图片 → LLM OCR
  {
    const up = await uploadAsset(userId, pngPath, "image/png", "shot.png");
    const bm = await trpcMut("bookmarks.createBookmark", { type: "asset", assetType: "image", assetId: up.assetId, fileName: "shot.png" }, cookie);
    const content = await waitAssetContent(bm.id);
    const hit = /灵\s*感\s*仓|系统状态/.test(content);
    if (hit) ok("图片 LLM OCR 读出截图文字", `${content.length} 字符`);
    else bad("图片 LLM OCR 读出截图文字", content.slice(0, 80) || "（空）");
  }
}

try {
  await main();
} catch (e) {
  bad("烟测运行", String((e as Error)?.message ?? e).split("\n")[0]);
  console.log(String((e as Error)?.stack ?? "").split("\n").slice(0, 6).join("\n"));
  for (const p of procs) {
    const tail = p.log.join("").slice(-800);
    if (tail) console.log(`--- 子进程日志 ---\n${tail}`);
  }
} finally {
  if (fail > 0) {
    for (const pr of procs) {
      const tail = pr.log.join("").split("\n").filter((l) => /OCR|pdf|PDF|视觉|error|Error|fail/.test(l)).slice(-15).join("\n");
      if (tail) console.log("--- 子进程相关日志 ---\n" + tail);
    }
  }
  stopAll();
  await new Promise((r) => setTimeout(r, 1200));
  for (const d of [dataDir, workDir]) {
    try {
      fs.rmSync(d, { recursive: true, force: true, maxRetries: 5 });
    } catch {}
  }
  console.log(`\n== ${pass} passed, ${fail} failed ==`);
  if (fail > 0) process.exitCode = 1;
}
