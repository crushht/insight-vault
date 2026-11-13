// 备份 / 恢复端到端烟测。
//
//   1. 建库（应用 + 队列）→ 起 workers（备份是后台任务）+ web
//   2. 造数据：3 条收藏 + 1 个列表（含 1 条）+ 标签
//   3. backups.triggerBackup → 等 status=success → 找到磁盘上的 zip → 解包读 JSON 对账
//   4. 删掉全部收藏（模拟数据丢失）→ 走应用自己的导入流水线（createImportSession → stage → finalize）
//      把备份里的书签导回来 → 断言数量恢复
//
// 用法：node scripts/e2e-backup.mjs

import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.E2E_BACKUP_PORT ?? 3033);
const base = `http://127.0.0.1:${PORT}`;
const dataDir = mkdtempSync(path.join(os.tmpdir(), "iv-e2e-bk-"));
const workDir = mkdtempSync(path.join(os.tmpdir(), "iv-e2e-bk-work-"));
const secret = "e2e-bk-secret-0123456789abcdef012345";

const NOTES = [
  "备份烟测笔记 A：向量检索与召回率",
  "备份烟测笔记 B：本地优先的知识库",
  "备份烟测笔记 C：长文摘要的三段式",
];

let pass = 0;
let fail = 0;
const procs = [];

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

function start(cmd, args, cwd, extraEnv = {}) {
  const p = spawn(cmd, args, { cwd, env: { ...env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"] });
  p.log = [];
  p.stdout?.on("data", (d) => p.log.push(String(d)));
  p.stderr?.on("data", (d) => p.log.push(String(d)));
  procs.push(p);
  return p;
}

function stopAll() {
  for (const p of [...procs].reverse()) {
    if (!p?.pid) continue;
    try {
      spawnSync("taskkill", ["/pid", String(p.pid), "/T", "/F"], { stdio: "ignore" });
    } catch {}
  }
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

async function trpcMut(proc, input, cookie) {
  const res = await fetch(`${base}/api/trpc/${proc}?batch=1`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base, cookie },
    body: JSON.stringify({ "0": { json: input } }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`tRPC ${proc} HTTP ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text)?.[0]?.result?.data?.json ?? null;
}

async function trpcQuery(proc, input, cookie) {
  const url = `${base}/api/trpc/${proc}?batch=1&input=${encodeURIComponent(JSON.stringify({ "0": { json: input } }))}`;
  const res = await fetch(url, { headers: { cookie } });
  const text = await res.text();
  if (!res.ok) throw new Error(`tRPC ${proc} HTTP ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text)?.[0]?.result?.data?.json ?? null;
}

function findBackupFile(dir, assetId) {
  let found = null;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        walk(full);
        continue;
      }
      const st = statSync(full);
      // 资产存储按 assets/<userId>/<assetId>/<file> 分层，assetId 是目录名
      if (assetId && full.includes(assetId)) {
        found = { file: full, size: st.size, mtimeMs: st.mtimeMs };
        return;
      }
    }
  };
  walk(dir);
  return found;
}

async function main() {
  console.log(`# 备份恢复烟测  base=${base}  data=${dataDir}`);

  run(process.execPath, ["--import", "tsx", "migrate.ts"], path.join(root, "packages", "db"));
  run(process.execPath, ["--import", "tsx", "scripts/migrateQueue.ts"], path.join(root, "apps", "workers"));

  console.log("… 起 workers");
  start(process.execPath, [path.join(root, "apps", "workers", "dist", "index.js")], path.join(root, "apps", "workers"));

  console.log("… 起 web");
  const standalone = path.join(root, "apps", "web", ".next", "standalone");
  ensureAssets(standalone);
  start(process.execPath, [path.join(standalone, "apps", "web", "server.js")], standalone, {
    NODE_ENV: "production",
    PORT: String(PORT),
  });
  await waitHealth();

  // 注册
  const h = { "content-type": "application/json", origin: base };
  const email = `bk-${Date.now()}@example.com`;
  const d1 = await (await fetch(`${base}/api/otp/request`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({ email, purpose: "sign-up" }),
  })).json();
  const reg = await fetch(`${base}/api/otp/register`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({ name: "BK", email, password: "BkPassw0rd!", code: d1.code }),
  });
  if (!reg.ok) throw new Error("注册失败");
  const cookie = reg.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

  // 造数据
  const ids = [];
  for (const text of NOTES) {
    const bm = await trpcMut("bookmarks.createBookmark", { type: "text", text }, cookie);
    ids.push(bm.id);
  }
  await trpcMut(
    "bookmarks.updateTags",
    { bookmarkId: ids[0], attach: [{ tagName: "备份测试" }], detach: [] },
    cookie,
  );
  const list = await trpcMut("lists.create", { name: "备份清单", icon: "🚀", description: "" }, cookie);
  await trpcMut("lists.addToList", { listId: list.id, bookmarkId: ids[1] }, cookie);
  console.log(`… 数据就绪：${ids.length} 条收藏 / 1 个列表 / 1 个标签`);

  // 触发备份
  const backup = await trpcMut("backups.triggerBackup", {}, cookie);
  let status = backup?.status ?? "pending";
  let assetId = backup?.assetId ?? null;
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline && status !== "success") {
    await new Promise((r) => setTimeout(r, 2000));
    const listRes = await trpcQuery("backups.list", {}, cookie).catch(() => null);
    const latest = listRes?.backups?.[0];
    status = latest?.status ?? status;
    assetId = latest?.assetId ?? assetId;
  }
  if (status === "success") ok("备份任务完成（status=success）");
  else bad("备份任务完成（status=success）", `当前 ${status}`);

  const zip = findBackupFile(dataDir, assetId);
  if (zip && zip.size > 0) ok("备份产物落盘", `${path.basename(zip.file)} ${Math.round(zip.size / 1024)} KB`);
  else bad("备份产物落盘", "DATA_DIR 下没找到备份文件");

  // 资产存储可能不带扩展名：复制成 .zip 再解
  const zipCopy = path.join(workDir, "backup.zip");
  if (zip) {
    try {
      spawnSync("powershell", ["-NoProfile", "-Command", `Copy-Item -LiteralPath '${zip.file}' -Destination '${zipCopy}' -Force`], { encoding: "utf8" });
      zip.file = zipCopy;
    } catch {}
  }

  // 解包读 JSON
  let backupJson = null;
  if (zip) {
    const outDir = path.join(workDir, "unzip");
    mkdirSync(outDir, { recursive: true });
    const r = spawnSync("powershell", [
      "-NoProfile",
      "-Command",
      `Expand-Archive -LiteralPath '${zip.file}' -DestinationPath '${outDir}' -Force`,
    ], { encoding: "utf8" });
    if (r.status !== 0) bad("解压备份包", (r.stderr || "").slice(0, 120));
    const jsons = [];
    const walk = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name.endsWith(".json")) jsons.push(full);
      }
    };
    walk(outDir);
    const main = jsons.sort((a, b) => statSync(b).size - statSync(a).size)[0];
    if (main) {
      backupJson = JSON.parse(readFileSync(main, "utf8"));
      ok("备份包含导出 JSON", `${path.basename(main)} ${Math.round(statSync(main).size / 1024)} KB`);
    } else {
      bad("备份包含导出 JSON", "zip 里没有 json");
    }
  }

  if (backupJson) {
    const count = backupJson.bookmarks?.length ?? 0;
    if (count === NOTES.length) ok("备份里书签齐全", String(count));
    else bad("备份里书签齐全", `期望 ${NOTES.length}，实际 ${count}`);
    if ((backupJson.lists?.length ?? 0) >= 1) ok("备份里带列表");
    else bad("备份里带列表", "lists 为空");
    const tagged = backupJson.bookmarks?.some((b) => (b.tags ?? []).includes("备份测试"));
    if (tagged) ok("备份里带标签");
    else bad("备份里带标签");
  }

  // 模拟数据丢失
  for (const id of ids) {
    await trpcMut("bookmarks.deleteBookmark", { bookmarkId: id }, cookie).catch(() => {});
  }
  const afterDelete = await trpcQuery("bookmarks.searchBookmarks", { text: "备份烟测" }, cookie);
  const left = afterDelete?.bookmarks?.length ?? 0;
  if (left === 0) ok("已清空（模拟数据丢失）");
  else bad("已清空（模拟数据丢失）", `还剩 ${left}`);

  // 走应用自己的导入流水线恢复
  const session = await trpcMut("importSessions.createImportSession", { name: `恢复-${Date.now()}` }, cookie);
  const sessionId = session?.id;
  if (!sessionId) throw new Error("创建导入会话失败");

  const staged = (backupJson?.bookmarks ?? []).slice(0, 50).map((b) => ({
    type: b.content?.type === "link" ? "link" : "text",
    url: b.content?.type === "link" ? b.content.url : undefined,
    title: b.title ?? undefined,
    content: b.content?.type === "text" ? b.content.text : undefined,
    note: b.note ?? undefined,
    tags: b.tags ?? [],
    listIds: [],
    archived: b.archived ?? false,
  }));
  await trpcMut("importSessions.stageImportedBookmarks", { importSessionId: sessionId, bookmarks: staged }, cookie);
  await trpcMut("importSessions.finalizeImportStaging", { importSessionId: sessionId }, cookie);

  // 等落库
  let restored = 0;
  const restoreDeadline = Date.now() + 120_000;
  while (Date.now() < restoreDeadline) {
    const res = await trpcQuery("bookmarks.searchBookmarks", { text: "备份烟测" }, cookie).catch(() => null);
    restored = res?.bookmarks?.length ?? 0;
    if (restored >= NOTES.length) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (restored >= NOTES.length) ok("恢复后收藏回来了", `${restored}/${NOTES.length}`);
  else bad("恢复后收藏回来了", `${restored}/${NOTES.length}`);
}

try {
  await main();
} catch (e) {
  bad("烟测运行", String(e?.message ?? e).split("\n")[0]);
  for (const p of procs) {
    const tail = p.log?.join("")?.slice(-600);
    if (tail) console.log(`--- 子进程日志 ---\n${tail}`);
  }
} finally {
  stopAll();
  removeAssets();
  await new Promise((r) => setTimeout(r, 1200));
  for (const d of [dataDir, workDir]) {
    try {
      rmSync(d, { recursive: true, force: true, maxRetries: 5 });
    } catch {
      console.log(`（临时目录没删掉：${d}）`);
    }
  }
  console.log(`\n== ${pass} passed, ${fail} failed ==`);
  if (fail > 0) process.exitCode = 1;
}
