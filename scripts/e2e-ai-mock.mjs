// AI 链路端到端烟测：本地起一个 OpenAI 兼容的 mock，证明「分块 → 检索 → 带引用回答 → 专题报告」整条链能用，
// 不依赖外网、也不需要真实模型 Key。
//
// 用法：node scripts/e2e-ai-mock.mjs

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MOCK_PORT = Number(process.env.E2E_MOCK_PORT ?? 11436);
const PORT = Number(process.env.E2E_AI_PORT ?? 3031);
const base = `http://127.0.0.1:${PORT}`;
const mockBase = `http://127.0.0.1:${MOCK_PORT}`;
const dataDir = mkdtempSync(path.join(os.tmpdir(), "iv-e2e-ai-"));
const secret = "e2e-ai-secret-0123456789abcdef01234";

const ANSWER = "根据你的收藏，HNSW 是一种近似最近邻算法，适合大规模向量检索[1]。";
const NOTE = "HNSW 是一种近似最近邻算法，适合大规模向量检索，代价是内存占用更高。";
const QUESTION = "HNSW 是什么？";

let pass = 0;
let fail = 0;
const procs = [];
let mock = null;

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
  // —— AI：指向本地 mock ——
  e.OPENAI_API_KEY = "mock-key";
  e.OPENAI_BASE_URL = `${mockBase}/v1`;
  e.INFERENCE_TEXT_MODEL = "mock-gpt";
  e.INFERENCE_IMAGE_MODEL = "mock-gpt";
  e.EMBEDDING_OPENAI_API_KEY = "mock-key";
  e.EMBEDDING_OPENAI_BASE_URL = `${mockBase}/v1`;
  e.EMBEDDING_TEXT_MODEL = "mock-embed";
  e.EMBEDDING_DIMENSIONS = "1536";
  e.EMBEDDING_ENABLE_AUTO_INDEXING = "true";
  return e;
})();

function startMock() {
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (req.url?.includes("/chat/completions")) {
        let body = {};
        try {
          body = JSON.parse(raw || "{}");
        } catch {}
        if (body.stream) {
          res.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            connection: "keep-alive",
          });
          const pieces = ANSWER.match(/.{1,12}/gs) ?? [ANSWER];
          for (const piece of pieces) {
            res.write(
              `data: ${JSON.stringify({
                id: "mock-1",
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model: "mock-gpt",
                choices: [{ index: 0, delta: { content: piece }, finish_reason: null }],
              })}\n\n`,
            );
          }
          res.write(
            `data: ${JSON.stringify({
              id: "mock-1",
              object: "chat.completion.chunk",
              choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            })}\n\n`,
          );
          res.write("data: [DONE]\n\n");
          res.end();
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: "mock-1",
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: "mock-gpt",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: ANSWER },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
          }),
        );
        return;
      }
      if (req.url?.includes("/embeddings")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            object: "list",
            data: [{ object: "embedding", index: 0, embedding: new Array(1536).fill(0.01) }],
            model: "mock-embed",
            usage: { prompt_tokens: 1, total_tokens: 1 },
          }),
        );
        return;
      }
      if (req.url?.includes("/models")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: "mock-gpt" }] }));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });
  });
  return new Promise((resolve) => server.listen(MOCK_PORT, "127.0.0.1", () => resolve(server)));
}

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, env, encoding: "utf8", timeout: 180_000 });
  if (r.status !== 0) throw new Error((r.stderr || r.stdout).slice(0, 500));
}

function start(cmd, args, cwd, extraEnv = {}) {
  const p = spawn(cmd, args, {
    cwd,
    env: { ...env, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
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

async function trpcQuery(proc, input, cookie) {
  const url = `${base}/api/trpc/${proc}?batch=1&input=${encodeURIComponent(JSON.stringify({ "0": { json: input } }))}`;
  const res = await fetch(url, { headers: { cookie } });
  const text = await res.text();
  if (!res.ok) throw new Error(`tRPC ${proc} HTTP ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text)?.[0]?.result?.data?.json ?? null;
}

async function trpcMutation(proc, input, cookie) {
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
  console.log(`# AI 链路烟测  web=${base}  mock=${mockBase}  data=${dataDir}`);

  console.log("… 起 mock LLM");
  mock = await startMock();

  console.log("… 建库（应用 + 队列）");
  run(process.execPath, ["--import", "tsx", "migrate.ts"], path.join(root, "packages", "db"));
  run(process.execPath, ["--import", "tsx", "scripts/migrateQueue.ts"], path.join(root, "apps", "workers"));

  console.log("… 起 workers（分块/向量化靠它）");
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
  const email = `ai-${Date.now()}@example.com`;
  const d1 = await (await fetch(`${base}/api/otp/request`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({ email, purpose: "sign-up" }),
  })).json();
  const reg = await fetch(`${base}/api/otp/register`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({ name: "AI", email, password: "AiPassw0rd!", code: d1.code }),
  });
  if (!reg.ok) throw new Error("注册失败");
  const cookie = reg.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

  // 造一条笔记（正文含 HNSW，等 workers 分块）
  await trpcMutation("bookmarks.createBookmark", { type: "text", text: NOTE }, cookie);
  const session = await trpcMutation("chat.createSession", { title: "AI 烟测" }, cookie);
  const chatId = session?.id;
  if (!chatId) throw new Error("创建会话失败");

  // 轮询直到分块就绪（回答里出现 [1]）
  let answer = "";
  let citations = [];
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const msg = await trpcMutation("chat.sendMessage", { chatId, content: QUESTION }, cookie);
    answer = msg?.content ?? "";
    citations = Array.isArray(msg?.metadata?.citations) ? msg.metadata.citations : [];
    if (citations.length > 0) break;
    await new Promise((r) => setTimeout(r, 2000));
  }

  if (answer.includes("[1]")) ok("对话回答带引用标记", answer.slice(0, 40));
  else bad("对话回答带引用标记", answer.slice(0, 60) || "（空）");

  if (citations.length > 0) ok("引用数组非空", `${citations.length} 条，quote=${String(citations[0]?.quote ?? "").slice(0, 20)}`);
  else bad("引用数组非空", "轮询 120 秒仍未拿到引用（分块或检索没跑起来）");

  // 专题报告
  const topic = await trpcMutation("topics.generate", { topic: "HNSW 检索", limit: 5 }, cookie);
  if (topic?.mode === "ai" && topic.markdown?.includes("[1]")) {
    ok("专题报告由模型生成且带引用", `sourceCount=${topic.sourceCount}`);
  } else {
    bad("专题报告由模型生成且带引用", JSON.stringify(topic).slice(0, 120));
  }

  // 流式对话
  const streamRes = await fetch(`${base}/api/chat/stream`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base, cookie },
    body: JSON.stringify({ chatId, content: QUESTION }),
  });
  const streamText = await streamRes.text();
  if (streamRes.ok && streamText.includes('"delta"')) {
    ok("流式对话推送 delta", `${streamText.length} 字节`);
  } else {
    bad("流式对话推送 delta", `HTTP ${streamRes.status} ${streamText.slice(0, 80)}`);
  }

  mock.close();
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
  mock?.close?.();
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
