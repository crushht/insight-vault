// 真实模型链路烟测：把 web + workers 指向一个真实的 OpenAI 兼容端点（本地网关 / 云厂商 / Ollama 都行），
// 验证「分块 → 检索 → 带引用回答 → 专题 → 流式」。
//
// 用法（不传就跳过，方便 CI 里当可选步骤）：
//   AI_BASE_URL=http://127.0.0.1:8788/v1 AI_KEY=sk-xxx AI_MODEL=deepseek-v4.1-flash node scripts/e2e-ai-real.mjs
//
// 注意：Key 只走环境变量，不落盘、不进仓库。

import { spawn, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  readFileSync,
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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.E2E_REAL_PORT ?? 3035);
const base = `http://127.0.0.1:${PORT}`;
const dataDir = mkdtempSync(path.join(os.tmpdir(), "iv-e2e-real-"));
const secret = "e2e-real-secret-0123456789abcdef012";

const AI_BASE_URL = process.env.AI_BASE_URL ?? "";
const AI_KEY = process.env.AI_KEY ?? "";
const AI_MODEL = process.env.AI_MODEL ?? "deepseek-v4.1-flash";
// AI_CONFIG_SRC：改走「桌面版那种 ai-config.json（Key 加密）」路径，验证文件配置也能用
const AI_CONFIG_SRC = process.env.AI_CONFIG_SRC ?? "";
const AI_SECRET_FILE = process.env.AI_SECRET_FILE ?? "";

const NOTE =
  "HNSW 是一种基于多层可导航小世界图的近似最近邻检索算法，查询复杂度约为对数级。" +
  "它的代价是内存占用高：每个向量要保存多层邻居。分块大小会明显影响检索召回质量。";
const QUESTION = "HNSW 的代价是什么？";

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

const fileSecret = AI_SECRET_FILE && existsSync(AI_SECRET_FILE)
  ? readFileSync(AI_SECRET_FILE, "utf8").trim()
  : null;

const env = (() => {
  const e = { ...process.env };
  for (const k of Object.keys(e)) if (k.startsWith("SMTP_")) delete e[k];
  e.SMTP_HOST = "";
  e.LOCAL_AUTH_CODE = "1";
  e.DATA_DIR = dataDir;
  e.NEXTAUTH_SECRET = fileSecret ?? secret;
  e.NEXTAUTH_URL = base;
  if (!AI_CONFIG_SRC) {
    e.OPENAI_API_KEY = AI_KEY;
    e.OPENAI_BASE_URL = AI_BASE_URL;
    e.INFERENCE_TEXT_MODEL = AI_MODEL;
    e.INFERENCE_IMAGE_MODEL = AI_MODEL;
  }
  // 网关不提供 embeddings 时，分块照跑（分块与向量化解耦）
  e.EMBEDDING_ENABLE_AUTO_INDEXING = "false";
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

async function main() {
  if (!AI_CONFIG_SRC && (!AI_BASE_URL || !AI_KEY)) {
    console.log("跳过：没有设置 AI_BASE_URL / AI_KEY（或用 AI_CONFIG_SRC 指定配置文件）");
    return;
  }
  if (AI_CONFIG_SRC) {
    if (!existsSync(AI_CONFIG_SRC)) throw new Error("AI_CONFIG_SRC 指向的文件不存在");
    copyFileSync(AI_CONFIG_SRC, path.join(dataDir, "ai-config.json"));
    console.log("… 使用配置文件走 AI：", AI_CONFIG_SRC);
  }
  console.log(`# 真实模型烟测  model=${AI_MODEL}  endpoint=${AI_BASE_URL}  web=${base}`);

  // 先直接探一下端点，避免把「网关不通」误判成应用问题
  const probe = AI_BASE_URL ? await fetch(`${AI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${AI_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [{ role: "user", content: "只回复：ok" }],
      max_tokens: 10,
    }),
  }).catch((e) => ({ ok: false, status: 0, text: async () => String(e.message) })) : null;
  if (probe) {
    const probeText = await probe.text();
    if (probe.ok) {
      ok("端点直连可用", `HTTP 200，${probeText.length} 字节`);
    } else {
      bad("端点直连可用", `HTTP ${probe.status} ${probeText.slice(0, 160)}`);
      return;
    }
  }

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

  const h = { "content-type": "application/json", origin: base };
  const email = `real-${Date.now()}@example.com`;
  const d1 = await (await fetch(`${base}/api/otp/request`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({ email, purpose: "sign-up" }),
  })).json();
  const reg = await fetch(`${base}/api/otp/register`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({ name: "REAL", email, password: "RealPassw0rd!", code: d1.code }),
  });
  if (!reg.ok) throw new Error("注册失败");
  const cookie = reg.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

  const bookmark = await trpcMut("bookmarks.createBookmark", { type: "text", text: NOTE }, cookie);

  // 等分块就绪：直接问，直到拿到带引用的回答（最多 3 分钟，模型是真实调用）
  let answer = "";
  let citations = [];
  const started = Date.now();
  const deadline = started + 180_000;
  let attempts = 0;
  while (Date.now() < deadline) {
    attempts++;
    const res = await trpcMut(
      "chat.askAboutBookmark",
      { bookmarkId: bookmark.id, question: QUESTION },
      cookie,
    ).catch((e) => ({ answer: `ERR ${e.message}`, citations: [] }));
    answer = res?.answer ?? "";
    citations = Array.isArray(res?.citations) ? res.citations : [];
    if (citations.length > 0 && !answer.startsWith("ERR")) break;
    await new Promise((r) => setTimeout(r, 5000));
  }
  const elapsed = Math.round((Date.now() - started) / 1000);

  if (answer && !answer.startsWith("ERR")) ok("真实模型返回了回答", `${elapsed}s / ${attempts} 次尝试`);
  else bad("真实模型返回了回答", answer.slice(0, 120));

  if (/\[\d+\]/.test(answer)) ok("回答里带 [n] 引用标记", (answer.match(/\[\d+\]/) ?? [])[0]);
  else bad("回答里带 [n] 引用标记", answer.slice(0, 120));

  if (citations.length > 0) ok("引用数组非空", `${citations.length} 条`);
  else bad("引用数组非空", "模型没按格式引用（引用为空）");

  console.log("\n--- 模型回答 ---");
  console.log(answer.slice(0, 400));
  console.log("----------------\n");

  // 专题报告（真实模型）
  const topic = await trpcMut("topics.generate", { topic: "HNSW 检索的代价", limit: 5 }, cookie).catch((e) => ({
    mode: "error",
    markdown: e.message,
  }));
  if (topic?.mode === "ai" && (topic.markdown ?? "").length > 40) {
    ok("专题报告由真实模型生成", `${topic.markdown.length} 字符 / ${topic.sourceCount} 个来源`);
  } else {
    bad("专题报告由真实模型生成", JSON.stringify(topic).slice(0, 160));
  }

  // 流式
  const chat = await trpcMut("chat.createSession", { title: "真实模型流式" }, cookie);
  const streamRes = await fetch(`${base}/api/chat/stream`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base, cookie },
    body: JSON.stringify({ chatId: chat.id, content: QUESTION }),
  });
  const streamText = await streamRes.text();
  const deltas = (streamText.match(/"delta"/g) ?? []).length;
  if (streamRes.ok && deltas > 0) ok("流式对话推送 delta", `${deltas} 帧`);
  else bad("流式对话推送 delta", `HTTP ${streamRes.status} ${streamText.slice(0, 120)}`);
}

try {
  await main();
} catch (e) {
  bad("烟测运行", String(e?.message ?? e).split("\n")[0]);
  for (const p of procs) {
    const tail = p.log?.join("")?.slice(-800);
    if (tail) console.log(`--- 子进程日志 ---\n${tail}`);
  }
} finally {
  stopAll();
  removeAssets();
  await new Promise((r) => setTimeout(r, 1200));
  try {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 });
  } catch {}
  console.log(`\n== ${pass} passed, ${fail} failed ==`);
  if (fail > 0) process.exitCode = 1;
}
