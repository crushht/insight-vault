// 灵感仓 INSIGHT VAULT · 桌面版主进程
//
// 做的事：跑数据库迁移 → 起 Next standalone + workers → 等健康检查 →
// 开窗口 → 退出时收掉子进程。
//
// 成熟度相关的几处：
// - 单实例锁：重复启动不会起第二个服务，而是唤起已有窗口
// - 启动画面：服务就绪前有反馈，不会「点了没反应」
// - 托盘：关窗口不退出（后台继续抓取），从托盘再打开
// - 全局快捷键：Ctrl/Cmd+Shift+K 随时唤起
// - 窗口位置/大小记忆，并且校验落在可见屏幕内
// - 子进程崩溃自动重启（带退避与次数上限）
// - 会话持久化：Electron 默认 session 会把 30 天有效的 cookie 落盘，
//   所以登录一次之后，重开应用仍是登录态

const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  screen,
  shell,
} = require("electron");
const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");

// 自动更新：只有打包后才有意义（dev 下 electron-updater 会去找 dev-app-update.yml）
let autoUpdater = null;
try {
  ({ autoUpdater } = require("electron-updater"));
} catch {
  autoUpdater = null;
}

const PORT = 3210;
const APP_ID = "app.insightvault.desktop";
const isDev = !app.isPackaged;

app.setAppUserModelId(APP_ID);
// userData 目录名（%APPDATA%\InsightVault）。必须在第一次 getPath 之前设置，
// 否则会落到 npm 包名 `@karakeep/desktop` 那种反人类的目录里。
app.setName("InsightVault");

let mainWindow = null;
let splashWindow = null;
let tray = null;
let serverProc = null;
let workersProc = null;
let quitting = false;
const restartCount = { server: 0, workers: 0 };

// ---------------- 日志（打包版没有控制台，只能写文件） ----------------

function appDir() {
  return path.join(require("node:os").homedir(), ".insight-vault");
}

function __bootLog(msg) {
  try {
    fs.mkdirSync(appDir(), { recursive: true });
    fs.appendFileSync(
      path.join(appDir(), "boot.log"),
      `[${new Date().toISOString()}] ${msg}\n`,
    );
  } catch {}
}

process.on("uncaughtException", (e) =>
  __bootLog("UNCAUGHT " + (e?.stack ?? e)),
);
process.on("unhandledRejection", (e) =>
  __bootLog("REJECT " + (e?.stack ?? e)),
);

// ---------------- 路径 ----------------

function dataDir() {
  return path.join(app.getPath("userData"), "data");
}

function iconPath() {
  return isDev
    ? path.join(__dirname, "build", "icon.png")
    : path.join(process.resourcesPath, "icon.png");
}

function serverRoot() {
  return isDev
    ? path.join(__dirname, "..", "web", ".next", "standalone")
    : path.join(process.resourcesPath, "server");
}

function workersRoot() {
  return isDev
    ? path.join(__dirname, "..", "workers")
    : path.join(process.resourcesPath, "workers");
}

function logDir() {
  const dir = path.join(app.getPath("userData"), "logs");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function stateFile() {
  return path.join(app.getPath("userData"), "window-state.json");
}

function getOrCreateSecret() {
  const file = path.join(app.getPath("userData"), "secret.txt");
  try {
    if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
  } catch {}
  const secret = require("node:crypto").randomBytes(36).toString("base64");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

// ---------------- 启动画面 ----------------

function createSplash() {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;height:100%;background:#FBFBF9;color:#1d2422;
      font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;
      display:flex;align-items:center;justify-content:center}
    .box{text-align:center;padding:28px 32px;width:100%}
    .mark{width:56px;height:56px;margin:0 auto 14px;border-radius:16px;
      background:linear-gradient(135deg,#0B6E6E,#12908E);color:#fff;
      display:flex;align-items:center;justify-content:center;font-size:26px;font-weight:600}
    h1{font-size:17px;margin:0 0 6px;letter-spacing:.02em}
    p{font-size:12px;color:#6b7472;margin:0 0 18px}
    .bar{height:3px;border-radius:3px;background:#E7E9E7;overflow:hidden}
    .bar i{display:block;height:100%;width:38%;background:#0B6E6E;border-radius:3px;
      animation:run 1.15s ease-in-out infinite}
    @keyframes run{0%{margin-left:-38%}100%{margin-left:100%}}
  </style></head><body><div class="box">
    <div class="mark">灵</div>
    <h1>灵感仓 INSIGHT VAULT</h1>
    <p id="msg">正在启动本地服务…</p>
    <div class="bar"><i></i></div>
  </div></body></html>`;

  splashWindow = new BrowserWindow({
    width: 420,
    height: 240,
    frame: false,
    resizable: false,
    show: true,
    center: true,
    backgroundColor: "#FBFBF9",
    skipTaskbar: false,
    title: "灵感仓",
    icon: iconPath(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  splashWindow.loadURL(
    "data:text/html;charset=utf-8," + encodeURIComponent(html),
  );
  splashWindow.on("closed", () => {
    splashWindow = null;
  });
}

function splashMessage(text) {
  if (!splashWindow || splashWindow.isDestroyed()) return;
  splashWindow.webContents
    .executeJavaScript(
      `(()=>{const m=document.getElementById('msg');if(m)m.textContent=${JSON.stringify(text)};})()`,
    )
    .catch(() => {});
}

function closeSplash() {
  if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
  splashWindow = null;
}

// ---------------- 老版本数据目录迁移 ----------------
//
// 1.0 早期版本的应用名是 npm 包名，数据落在 %APPDATA%\@karakeep\desktop。
// 后来加了 app.setName("InsightVault")，路径变了 —— 不搬的话用户会「明明注册过却登不进去」。
// 这里在第一次启动（新目录还没有 db）时把老目录整体搬过来，并把配对的 secret.txt 一起带过来。

function legacyDataDir() {
  return path.join(app.getPath("appData"), "@karakeep", "desktop", "data");
}

function migrateLegacyData() {
  const target = dataDir();
  const legacy = legacyDataDir();
  if (path.resolve(target) === path.resolve(legacy)) return;

  const targetDb = path.join(target, "db.db");
  const legacyDb = path.join(legacy, "db.db");
  if (fs.existsSync(targetDb) || !fs.existsSync(legacyDb)) return;

  try {
    fs.mkdirSync(target, { recursive: true });
    fs.cpSync(legacy, target, { recursive: true });
    const legacySecret = path.join(path.dirname(legacy), "secret.txt");
    const targetSecret = path.join(app.getPath("userData"), "secret.txt");
    if (fs.existsSync(legacySecret) && !fs.existsSync(targetSecret)) {
      fs.copyFileSync(legacySecret, targetSecret);
    }
    __bootLog(`[migrate] 已从旧数据目录迁移：${legacy} -> ${target}`);
  } catch (e) {
    __bootLog(`[migrate] 旧数据迁移失败（继续用新目录）：${e?.message ?? e}`);
  }
}

// ---------------- 数据库迁移 ----------------

function migrationsFolder() {
  return isDev
    ? path.join(__dirname, "..", "..", "packages", "db", "drizzle")
    : path.join(process.resourcesPath, "server", "packages", "db", "drizzle");
}

function litequeMigrationsFolder() {
  return isDev
    ? path.join(__dirname, "..", "..", "node_modules", "liteque", "dist", "drizzle")
    : path.join(process.resourcesPath, "liteque-drizzle");
}

function runMigrations() {
  const script = isDev
    ? path.join(__dirname, "migrate.cjs")
    : path.join(process.resourcesPath, "server", "migrate.cjs");

  if (!fs.existsSync(script)) {
    __bootLog("[migrate] 跳过：找不到 migrate.cjs（" + script + "）");
    return;
  }

  splashMessage("正在检查数据库…");

  const r = spawnSync(process.execPath, [script], {
    cwd: serverRoot(),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      DATA_DIR: dataDir(),
      MIGRATIONS_FOLDER: migrationsFolder(),
      LITEQUE_MIGRATIONS: litequeMigrationsFolder(),
    },
    encoding: "utf8",
    timeout: 90_000,
  });

  __bootLog(
    `[migrate] exit=${r.status} | out=${(r.stdout || "").trim().slice(0, 200)} | err=${(r.stderr || "").trim().slice(0, 300)}`,
  );
  if (r.status !== 0) {
    throw new Error(
      `数据库初始化失败：${(r.stderr || r.stdout || "未知错误").trim().slice(0, 400)}`,
    );
  }
}

// ---------------- 子进程 ----------------

function childEnv() {
  const env = {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(PORT),
    HOSTNAME: "127.0.0.1",
    DATA_DIR: dataDir(),
    NEXTAUTH_URL: `http://127.0.0.1:${PORT}`,
    NEXTAUTH_SECRET: getOrCreateSecret(),
    // 桌面版是单机自用：登录一次管一年，不再每次开都问密码
    AUTH_SESSION_DAYS: "365",
    // 桌面版是单机自用：没有 SMTP 时，验证码直接回显在界面上（本地模式）
    DESKTOP_APP: "1",
    // 图片与扫描件走视觉模型读字（模型来自「设置 → AI」，这里只开开关）
    OCR_USE_LLM: "true",
  };

  // 邮件服务只认用户在「邮箱服务设置」里填的那份。
  // 不能让随包 .env 或调用方环境里的 SMTP_* 漏进来 —— 那会把别人的授权码带进安装包。
  for (const key of [
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_SECURE",
    "SMTP_USER",
    "SMTP_PASSWORD",
    "SMTP_FROM",
  ]) {
    delete env[key];
  }

  return { ...env, ...smtpEnv() };
}

/**
 * 开发模式下 `next build` 产出的 standalone 包里不带 static/public，
 * 直接跑会得到一个「无样式、无脚本」的页面。这里用目录联接（Windows 不需要管理员
 * 权限）把它们补进去，让 `electron .` 和打包后的表现一致。
 */
function ensureDevAssets() {
  if (!isDev) return;
  const webRoot = path.join(__dirname, "..", "web");
  const standaloneWeb = path.join(
    webRoot,
    ".next",
    "standalone",
    "apps",
    "web",
  );
  if (!fs.existsSync(standaloneWeb)) return;

  const pairs = [
    {
      link: path.join(standaloneWeb, ".next", "static"),
      target: path.join(webRoot, ".next", "static"),
    },
    {
      link: path.join(standaloneWeb, "public"),
      target: path.join(webRoot, "public"),
    },
  ];

  for (const { link, target } of pairs) {
    try {
      if (!fs.existsSync(target) || fs.existsSync(link)) continue;
      fs.mkdirSync(path.dirname(link), { recursive: true });
      fs.symlinkSync(target, link, "junction");
      __bootLog(`[dev] 已链接 ${link}`);
    } catch (e) {
      __bootLog(`[dev] 链接失败 ${link}: ${e?.message ?? e}`);
    }
  }
}

function startServer() {
  const root = serverRoot();
  const entry = fs.existsSync(path.join(root, "apps", "web", "server.js"))
    ? path.join(root, "apps", "web", "server.js")
    : path.join(root, "server.js");

  __bootLog(`startServer | entry=${entry} | exists=${fs.existsSync(entry)}`);
  if (!fs.existsSync(entry)) {
    throw new Error(`找不到服务入口：${entry}`);
  }

  const dir = logDir();
  const outFd = fs.openSync(path.join(dir, "server.log"), "a");
  const errFd = fs.openSync(path.join(dir, "server-err.log"), "a");

  serverProc = spawn(process.execPath, [entry], {
    cwd: root,
    env: { ...childEnv(), ELECTRON_RUN_AS_NODE: "1" },
    stdio: ["ignore", outFd, errFd],
  });
  serverProc.on("error", (e) =>
    __bootLog("server spawn error: " + (e?.stack ?? e)),
  );
  serverProc.on("exit", (code, signal) => {
    __bootLog(`server exited code=${code} signal=${signal}`);
    serverProc = null;
    if (quitting) return;
    scheduleRestart("server", startServer);
  });
  splashMessage("本地服务启动中…");
}

/**
 * workers 必须在迁移完成、web 就绪之后再起 ——
 * 否则它会对着空库每分钟刷一堆 `no such table`。
 */
function startWorkers() {
  const wroot = workersRoot();
  // 打包版放的是 tsdown 产物 index.js；开发模式没有 index.js，但有 dist/index.js
  const candidates = [path.join(wroot, "index.js"), path.join(wroot, "dist", "index.js")];
  const wentry = candidates.find((p) => fs.existsSync(p));
  if (!wentry) {
    __bootLog("[workers] 未找到 index.js：" + candidates.join(" / "));
    return;
  }
  const dir = logDir();
  const outFd = fs.openSync(path.join(dir, "workers.log"), "a");
  const errFd = fs.openSync(path.join(dir, "workers-err.log"), "a");

  workersProc = spawn(process.execPath, [wentry], {
    cwd: wroot,
    env: {
      ...childEnv(),
      ELECTRON_RUN_AS_NODE: "1",
      USING_LEGACY_SEPARATE_CONTAINERS: "true",
    },
    stdio: ["ignore", outFd, errFd],
  });
  workersProc.on("error", (e) =>
    __bootLog("workers spawn error: " + (e?.stack ?? e)),
  );
  workersProc.on("exit", (code) => {
    __bootLog(`workers exited code=${code}`);
    workersProc = null;
    if (quitting) return;
    scheduleRestart("workers", startWorkers, 3000);
  });
  __bootLog("startWorkers | spawned");
}

/**
 * 子进程意外退出时自动拉起。上限 3 次；之后弹窗提示并让用户手动重启，
 * 免得陷入「崩溃 → 重启 → 崩溃」的死循环。
 */
function scheduleRestart(kind, start, delay = 1500) {
  const n = restartCount[kind] ?? 0;
  if (n >= 3) {
    __bootLog(`[${kind}] 连续退出 ${n} 次，放弃自动重启`);
    dialog.showErrorBox(
      "灵感仓服务已停止",
      `本地服务连续退出 ${n} 次，已停止自动重启。\n日志：${logDir()}\n可从托盘菜单「重启服务」再试一次。`,
    );
    return;
  }
  restartCount[kind] = n + 1;
  __bootLog(`[${kind}] ${delay}ms 后自动重启（第 ${n + 1} 次）`);
  setTimeout(() => {
    if (quitting) return;
    try {
      start();
    } catch (e) {
      __bootLog(`[${kind}] 重启失败：${e?.stack ?? e}`);
    }
  }, delay);
}

function stopChildren() {
  for (const p of [serverProc, workersProc]) {
    if (p && !p.killed) {
      try {
        p.kill("SIGTERM");
      } catch {}
    }
  }
  serverProc = null;
  workersProc = null;
}

function restartServices() {
  __bootLog("手动重启服务");
  restartCount.server = 0;
  restartCount.workers = 0;
  stopChildren();
  setTimeout(() => {
    try {
      startServer();
    } catch (e) {
      __bootLog("配置问题：重启失败 " + (e?.stack ?? e));
    }
  }, 800);
}

// ---------------- 就绪检测 ----------------

function waitForHealth(timeoutMs = 120_000) {
  __bootLog(`waitForHealth | port=${PORT}`);
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (Date.now() > deadline) {
        __bootLog("waitForHealth TIMEOUT");
        reject(new Error("服务启动超时"));
        return;
      }
      const req = http.get(
        { host: "127.0.0.1", port: PORT, path: "/api/health", timeout: 2000 },
        (res) => {
          res.resume();
          if (res.statusCode === 200) resolve();
          else setTimeout(tick, 500);
        },
      );
      req.on("error", () => setTimeout(tick, 500));
      req.on("timeout", () => {
        req.destroy();
        setTimeout(tick, 500);
      });
    };
    tick();
  });
}

function portFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, "127.0.0.1");
  });
}

// ---------------- 邮箱服务（SMTP）设置 ----------------
//
// 桌面版默认不带 SMTP：注册/登录的验证码走「本地模式」（直接显示在界面上）。
// 想真收邮件，就在这里填一次 SMTP —— 存到 userData/smtp.json，重启服务后生效。

function smtpFile() {
  return path.join(app.getPath("userData"), "smtp.json");
}

function loadSmtpConfig() {
  try {
    // 记事本存过的文件可能带 BOM，JSON.parse 会直接失败
    const raw = fs.readFileSync(smtpFile(), "utf8").replace(/^\uFEFF/, "");
    const cfg = JSON.parse(raw);
    if (cfg && typeof cfg.host === "string" && cfg.host.trim()) {
      return cfg;
    }
  } catch {}
  return null;
}

function smtpEnv() {
  const cfg = loadSmtpConfig();
  if (!cfg) return {};
  const env = {
    SMTP_HOST: String(cfg.host).trim(),
    SMTP_PORT: String(cfg.port || 587),
    SMTP_SECURE: cfg.secure ? "true" : "false",
  };
  if (cfg.user) env.SMTP_USER = String(cfg.user);
  if (cfg.password) env.SMTP_PASSWORD = String(cfg.password);
  if (cfg.from) env.SMTP_FROM = String(cfg.from);
  return env;
}

let smtpWin = null;

function openSmtpSettings() {
  if (smtpWin && !smtpWin.isDestroyed()) {
    smtpWin.focus();
    return;
  }
  const file = path.join(app.getPath("userData"), "smtp-form.html");
  fs.writeFileSync(file, SMTP_FORM_HTML, "utf8");
  smtpWin = new BrowserWindow({
    width: 520,
    height: 560,
    title: "邮箱服务（SMTP）设置",
    parent: mainWindow ?? undefined,
    modal: false,
    backgroundColor: "#FBFBF9",
    icon: iconPath(),
    autoHideMenuBar: true,
    webPreferences: {
      // 本页是本机生成的静态表单，不加载任何远程内容
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  smtpWin.loadFile(file);
  smtpWin.on("closed", () => {
    smtpWin = null;
  });
}

ipcMain.handle("smtp:load", () => loadSmtpConfig() ?? {});

ipcMain.handle("smtp:save", async (_event, data) => {
  const host = String(data?.host ?? "").trim();
  if (!host) {
    return { ok: false, message: "SMTP 服务器地址不能为空" };
  }
  const port = Number(data?.port ?? 587);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    return { ok: false, message: "端口不合法（常见：465 加密 / 587 STARTTLS）" };
  }
  const cfg = {
    host,
    port,
    secure: Boolean(data?.secure),
    user: String(data?.user ?? "").trim(),
    password: String(data?.password ?? ""),
    from: String(data?.from ?? "").trim(),
    updatedAt: new Date().toISOString(),
  };
  try {
    fs.writeFileSync(smtpFile(), JSON.stringify(cfg, null, 2), { mode: 0o600 });
  } catch (e) {
    return { ok: false, message: "保存失败：" + (e?.message ?? e) };
  }
  if (smtpWin && !smtpWin.isDestroyed()) smtpWin.close();
  const { response } = await dialog.showMessageBox({
    type: "info",
    title: "已保存",
    message: "邮箱服务设置已保存",
    detail: "重启本地服务后生效。之后注册/登录的验证码会发送到邮箱。",
    buttons: ["立即重启服务", "稍后"],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) {
    restartServices();
  }
  return { ok: true };
});

const SMTP_FORM_HTML = `<!doctype html><html><head><meta charset="utf-8">
<title>邮箱服务设置</title><style>
  html,body{margin:0;background:#FBFBF9;color:#1d2422;
    font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;font-size:14px}
  .wrap{padding:22px 24px}
  h1{font-size:16px;margin:0 0 4px}
  p.hint{color:#6b7472;font-size:12px;margin:0 0 18px;line-height:1.6}
  label{display:block;margin:12px 0 4px;font-size:12px;color:#4b5452}
  input{width:100%;box-sizing:border-box;padding:9px 11px;border:1px solid #D8DCDA;
    border-radius:9px;background:#fff;font-size:13px;outline:none}
  input:focus{border-color:#0B6E6E;box-shadow:0 0 0 3px rgba(11,110,110,.12)}
  .row{display:flex;gap:12px}.row>div{flex:1}
  .check{display:flex;align-items:center;gap:8px;margin-top:14px;font-size:12px;color:#4b5452}
  .actions{display:flex;justify-content:flex-end;gap:10px;margin-top:22px}
  button{border:0;border-radius:9px;padding:9px 18px;font-size:13px;cursor:pointer}
  .primary{background:#0B6E6E;color:#fff}.primary:disabled{opacity:.6;cursor:default}
  .ghost{background:#EDEFEE;color:#33403d}
  .msg{margin-top:12px;font-size:12px;min-height:16px}
  .msg.err{color:#B3261E}.msg.ok{color:#0B6E6E}
</style></head><body><div class="wrap">
  <h1>邮箱服务（SMTP）</h1>
  <p class="hint">填写后，注册与免密码登录的 6 位验证码会发到用户邮箱。<br>
  不填则使用「本地模式」：验证码直接显示在注册/登录页面上（仅本机可用）。</p>
  <label>SMTP 服务器</label>
  <input id="host" placeholder="smtp.qq.com" autocomplete="off">
  <div class="row">
    <div><label>端口</label><input id="port" placeholder="465" inputmode="numeric"></div>
    <div><label>发件人（可选）</label><input id="from" placeholder="灵感仓 &lt;you@example.com&gt;"></div>
  </div>
  <label>账号</label>
  <input id="user" placeholder="you@example.com" autocomplete="off">
  <label>密码 / 授权码</label>
  <input id="password" type="password" autocomplete="off">
  <div class="check"><input id="secure" type="checkbox" style="width:auto"> 使用 SSL/TLS（465 端口勾选；587 不勾）</div>
  <div class="actions">
    <button class="ghost" onclick="window.close()">取消</button>
    <button class="primary" id="save">保存并重启服务</button>
  </div>
  <div class="msg" id="msg"></div>
</div>
<script>
  const { ipcRenderer } = require('electron');
  const $ = (id) => document.getElementById(id);
  (async () => {
    try {
      const cfg = await ipcRenderer.invoke('smtp:load');
      $('host').value = cfg.host || '';
      $('port').value = cfg.port || 465;
      $('user').value = cfg.user || '';
      $('password').value = cfg.password || '';
      $('from').value = cfg.from || '';
      $('secure').checked = cfg.secure !== false;
    } catch (e) {}
  })();
  $('save').addEventListener('click', async () => {
    const msg = $('msg');
    msg.className = 'msg';
    msg.textContent = '保存中…';
    $('save').disabled = true;
    const res = await ipcRenderer.invoke('smtp:save', {
      host: $('host').value,
      port: $('port').value,
      user: $('user').value,
      password: $('password').value,
      from: $('from').value,
      secure: $('secure').checked,
    });
    $('save').disabled = false;
    if (!res || !res.ok) {
      msg.className = 'msg err';
      msg.textContent = (res && res.message) || '保存失败';
      return;
    }
    msg.className = 'msg ok';
    msg.textContent = '已保存';
  });
</script></body></html>`;

// ---------------- 窗口 ----------------

function loadWindowState() {
  try {
    const raw = fs.readFileSync(stateFile(), "utf8");
    const s = JSON.parse(raw);
    if (typeof s.width === "number" && typeof s.height === "number") {
      // 上次可能在已经拔掉的扩展屏上，校验一下是否还在可见区域
      if (
        typeof s.x === "number" &&
        typeof s.y === "number" &&
        screen.getAllDisplays().some((d) => {
          const a = d.workArea;
          return (
            s.x >= a.x - 50 &&
            s.y >= a.y - 50 &&
            s.x < a.x + a.width &&
            s.y < a.y + a.height
          );
        })
      ) {
        return s;
      }
      return { width: s.width, height: s.height };
    }
  } catch {}
  return { width: 1440, height: 900 };
}

function saveWindowState(win) {
  if (!win || win.isDestroyed()) return;
  try {
    const b = win.getNormalBounds();
    fs.writeFileSync(
      stateFile(),
      JSON.stringify({ x: b.x, y: b.y, width: b.width, height: b.height }),
    );
  } catch {}
}

async function createWindow() {
  const s = loadWindowState();
  mainWindow = new BrowserWindow({
    x: s.x,
    y: s.y,
    width: s.width,
    height: s.height,
    minWidth: 900,
    minHeight: 600,
    title: "灵感仓",
    backgroundColor: "#FBFBF9",
    show: false,
    icon: iconPath(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      // 会话（登录 cookie）落盘在 userData 里，重开应用不用重新登录
      partition: "persist:insightvault",
    },
  });

  mainWindow.once("ready-to-show", () => {
    closeSplash();
    mainWindow.show();
  });

  // 关闭窗口时最小化到托盘，而不是退出（桌面软件的常规行为）
  mainWindow.on("close", (e) => {
    if (!quitting) {
      e.preventDefault();
      mainWindow.hide();
      if (process.platform === "darwin") app.dock?.hide?.();
    }
  });

  mainWindow.on("resize", () => saveWindowState(mainWindow));
  mainWindow.on("move", () => saveWindowState(mainWindow));

  // 外链走系统浏览器
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(`http://127.0.0.1:${PORT}`)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  // 本地工具不需要任何浏览器权限（摄像头/麦克风/通知…）
  mainWindow.webContents.session.setPermissionRequestHandler(
    (_wc, _permission, callback) => callback(false),
  );

  mainWindow.webContents.on(
    "did-fail-load",
    (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return;
      __bootLog(`did-fail-load ${errorCode} ${errorDescription} ${validatedURL}`);
      closeSplash();
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>灵感仓</title>
        <style>html,body{height:100%;margin:0;background:#FBFBF9;color:#1d2422;
        font-family:system-ui,"Segoe UI","Microsoft YaHei",sans-serif;display:flex;
        align-items:center;justify-content:center;text-align:center}
        .b{max-width:420px;padding:32px}h1{font-size:18px;margin:0 0 8px}
        p{color:#6b7472;font-size:13px;line-height:1.7}
        button{margin-top:16px;padding:10px 22px;border:0;border-radius:10px;
        background:#0B6E6E;color:#fff;font-size:14px;cursor:pointer}</style></head>
        <body><div class="b"><h1>本地服务没有响应</h1>
        <p>${errorDescription}（${errorCode}）</p>
        <p>可以点下面的按钮重试；如果一直失败，请从托盘菜单退出后重新打开灵感仓。</p>
        <button onclick="location.href='http://127.0.0.1:${PORT}/'">重试</button>
        </div></body></html>`;
      mainWindow.loadURL(
        "data:text/html;charset=utf-8," + encodeURIComponent(html),
      );
    },
  );

  // Ctrl+= / Ctrl+- / Ctrl+0 缩放（无菜单栏时的最小可用集合）
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || !input.control) return;
    const wc = mainWindow?.webContents;
    if (!wc) return;
    const level = wc.getZoomLevel();
    if (input.key === "=" || input.key === "+") {
      wc.setZoomLevel(Math.min(level + 0.5, 3));
      event.preventDefault();
    } else if (input.key === "-") {
      wc.setZoomLevel(Math.max(level - 0.5, -3));
      event.preventDefault();
    } else if (input.key === "0") {
      wc.setZoomLevel(0);
      event.preventDefault();
    }
  });

  await mainWindow.loadURL(`http://127.0.0.1:${PORT}`);
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    void createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  if (process.platform === "darwin") app.dock?.show?.();
}

// ---------------- 托盘与快捷键 ----------------

function openPath(p) {
  void shell.openPath(p).catch(() => {});
}

// ---------------- 自动更新 ----------------
//
// 打包后从发布渠道拉 latest.yml 比对版本；发现新版本后台下载，下完提示重启安装。
// 更新源默认是 GitHub Releases（package.json 的 build.publish），
// 也可以用环境变量 IV_UPDATE_URL 指向任意静态托管（国内更稳），只需放三个文件：
//   InsightVault-<ver>-win-x64.exe / .blockmap / latest.yml

function updaterUsable() {
  return !!autoUpdater && app.isPackaged;
}

function setupAutoUpdater() {
  if (!updaterUsable()) return;

  const override = process.env.IV_UPDATE_URL;
  if (override) {
    const base = override.replace(/\/+$/, "");
    autoUpdater.setFeedURL({ provider: "generic", url: `${base}/` });
    console.log("[updater] 使用自定义更新源:", base);
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = {
    info: (m) => console.log("[updater]", m),
    warn: (m) => console.warn("[updater]", m),
    error: (m) => console.error("[updater]", m),
    debug: () => {},
  };

  autoUpdater.on("update-available", (info) => {
    void dialog.showMessageBox({
      type: "info",
      title: "发现新版本",
      message: `灵感仓 ${info.version} 正在后台下载`,
      detail: "下载完成后会提示你重启安装，数据不受影响。",
      buttons: ["知道了"],
    });
  });

  autoUpdater.on("error", (err) => {
    console.error("[updater] 检查/下载失败:", err?.message ?? err);
  });

  autoUpdater.on("update-downloaded", (info) => {
    void dialog
      .showMessageBox({
        type: "info",
        title: "更新已就绪",
        message: `灵感仓 ${info.version} 已下载完成`,
        detail: "重启后完成安装。",
        buttons: ["立即重启", "稍后"],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) {
          quitting = true;
          setImmediate(() => autoUpdater.quitAndInstall());
        }
      });
  });

  // 启动 20 秒后查一次（等本地服务起来），之后每 6 小时一次
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 20_000);
  setInterval(
    () => {
      autoUpdater.checkForUpdates().catch(() => {});
    },
    6 * 60 * 60 * 1000,
  );
}

async function checkForUpdatesInteractive() {
  if (!updaterUsable()) {
    void dialog.showMessageBox({
      type: "info",
      title: "检查更新",
      message: "当前运行的是开发版，不检查更新。",
      detail: "安装版会从发布渠道自动检查。",
    });
    return;
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    const remote = result?.updateInfo?.version;
    if (!remote || remote === app.getVersion()) {
      void dialog.showMessageBox({
        type: "info",
        title: "检查更新",
        message: `已经是最新版本（v${app.getVersion()}）`,
      });
    } else {
      void dialog.showMessageBox({
        type: "info",
        title: "发现新版本",
        message: `v${remote} 正在后台下载`,
        detail: "下载完成后会提示重启安装。",
      });
    }
  } catch (e) {
    void dialog.showMessageBox({
      type: "error",
      title: "检查更新失败",
      message: String(e?.message ?? e).slice(0, 300),
      detail: "如果是网络问题，可以设置环境变量 IV_UPDATE_URL 指向自建更新源。",
    });
  }
}

function createTray() {
  const img = nativeImage.createFromPath(iconPath());
  tray = new Tray(
    img.isEmpty()
      ? nativeImage.createEmpty()
      : img.resize({ width: 18, height: 18 }),
  );
  tray.setToolTip("灵感仓");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "打开灵感仓", click: () => showWindow() },
      {
        label: "快速收藏剪贴板链接",
        click: () => {
          const text = clipboard.readText().trim();
          showWindow();
          if (/^https?:\/\//i.test(text)) {
            mainWindow
              ?.loadURL(
                `http://127.0.0.1:${PORT}/dashboard/bookmarks?addUrl=${encodeURIComponent(text)}`,
              )
              .catch(() => {});
          }
        },
      },
      { type: "separator" },
      {
        label: "重启本地服务",
        click: () => {
          restartServices();
          showWindow();
        },
      },
      { label: "打开数据目录", click: () => openPath(dataDir()) },
      { label: "打开日志目录", click: () => openPath(logDir()) },
      { label: "邮箱服务设置（SMTP）…", click: () => openSmtpSettings() },
      { label: "检查更新…", click: () => void checkForUpdatesInteractive() },
      { type: "separator" },
      {
        label: "关于",
        click: () => {
          const detail = [
            "本地优先的个人知识仓：收藏 → 抓取 → 检索 → AI 对话。",
            "",
            `数据目录：${dataDir()}`,
            `本地端口：127.0.0.1:${PORT}`,
            "快捷键：Ctrl/Cmd+Shift+K 唤起窗口",
          ].join("\n");
          void dialog
            .showMessageBox({
              type: "info",
              title: "关于灵感仓",
              message: `灵感仓 INSIGHT VAULT ${app.getVersion()}`,
              detail,
              buttons: ["复制诊断信息", "好"],
              defaultId: 1,
              cancelId: 1,
            })
            .then(({ response }) => {
              if (response === 0) {
                clipboard.writeText(
                  [
                    `灵感仓 ${app.getVersion()}`,
                    `平台：${process.platform} ${process.arch}`,
                    `Electron：${process.versions.electron} / Node：${process.versions.node}`,
                    `数据目录：${dataDir()}`,
                    `日志目录：${logDir()}`,
                    detail,
                  ].join("\n"),
                );
              }
            });
        },
      },
      { type: "separator" },
      {
        label: "退出",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on("click", () => showWindow());
}

function registerShortcuts() {
  // Ctrl/Cmd+Shift+K 唤起主窗口
  const ok = globalShortcut.register("CommandOrControl+Shift+K", () => {
    showWindow();
  });
  __bootLog(`globalShortcut Cmd/Ctrl+Shift+K registered=${ok}`);
}

// ---------------- 生命周期 ----------------

// 单实例锁：第二次启动直接唤起已有窗口
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  __bootLog("another instance is running, quitting");
  app.quit();
} else {
  app.on("second-instance", () => showWindow());

  app.whenReady().then(async () => {
    __bootLog(
      `boot start | packaged=${app.isPackaged} | execPath=${process.execPath} | version=${app.getVersion()}`,
    );
    fs.mkdirSync(dataDir(), { recursive: true });

    // 无菜单栏，靠托盘 + 快捷键；文本编辑的 Ctrl+C/V 由 Chromium 原生处理
    Menu.setApplicationMenu(null);

    createSplash();

    if (!(await portFree(PORT))) {
      closeSplash();
      dialog.showErrorBox(
        "端口被占用",
        `端口 ${PORT} 已被其它程序占用。请关掉占用它的程序后重试。`,
      );
      app.quit();
      return;
    }

    try {
      migrateLegacyData();
      runMigrations();
      splashMessage("正在启动本地服务…");
      ensureDevAssets();
      startServer();
      await waitForHealth();
      splashMessage("正在启动后台任务…");
      startWorkers();
    } catch (e) {
      const msg = String(e?.stack ?? e?.message ?? e);
      closeSplash();
      try {
        fs.appendFileSync(
          path.join(app.getPath("userData"), "startup-error.log"),
          `[${new Date().toISOString()}]\n${msg}\n\n`,
        );
      } catch {}
      dialog.showErrorBox("启动失败", msg.slice(0, 800));
      stopChildren();
      app.quit();
      return;
    }

    await createWindow();
    createTray();
    registerShortcuts();
    setupAutoUpdater();

    app.on("activate", () => showWindow());
  });
}

app.on("window-all-closed", () => {
  // 有托盘时，关窗口不退出
  if (process.platform === "darwin") return;
  if (!tray) {
    stopChildren();
    app.quit();
  }
});

app.on("before-quit", () => {
  quitting = true;
  stopChildren();
  globalShortcut.unregisterAll();
});

process.on("exit", stopChildren);
