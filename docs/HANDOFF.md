# 交接说明 HANDOFF

> 给下一个接手的人 / Agent。读完这一页，你应该能在 5 分钟内跑起来、知道什么已经做了、下一步该动哪里、以及哪些坑别再踩。

---

## 0. 接手第一件事：看队列

```bash
node scripts/tasks.mjs next    # 下一件该做的（含为什么 / 验收命令）
node scripts/tasks.mjs list    # 全队列
node scripts/tasks.mjs start <id> / done <id> --note "..." / block <id> --reason "..."
```

队列在 `docs/queue.json`，是「做到哪了」的唯一真源。**收尾前把当前项标 done 或 block**，
下一轮（或下一个人）就不用重新回忆。外部条件缺失（证书、GitHub 仓库、模型 Key）时用 `block` 标注原因，
`next` 会跳过它继续给下一条。

---

## 1. 一句话现状

**核心链路全部可跑**（收藏 → 抓取 → 分块 → 搜索 → AI 对话（流式）/ 专题 / 创作 → 图谱 → 会员），
账号体系已经按产品要求收敛为「注册=密码+邮箱验证码 / 登录=邮箱+密码 / 默认 30 天免登录」，
Windows 桌面版具备启动画面、托盘、全局快捷键、服务自恢复与 SMTP 设置；
**真实 AI 推理与真实支付未接，macOS / Linux 未出包**。

---

## 2. 五分钟上手

```bash
cd E:\fork\2\insight-vault

corepack enable
pnpm install                      # 已装过可跳过

# 环境（已存在则跳过）
# .env 里需要：DATA_DIR、NEXTAUTH_SECRET
# 想让验证码真的发邮件：SMTP_HOST / SMTP_PORT / SMTP_SECURE / SMTP_USER / SMTP_PASSWORD / SMTP_FROM

pnpm --filter @karakeep/db run migrate

# 一条命令起前后端（先 workers、等端口、再 web、最后健康检查）
powershell -File dev.ps1
# 或双击仓库根目录的「启动灵感仓.cmd」

# 停止 / 看状态 / 重启
powershell -File dev.ps1 -Stop
powershell -File dev.ps1 -Status
powershell -File dev.ps1 -Restart
```

- 登录：`audit@insightvault.local` / `AuditPass123!`（首个账号，管理员）
- 健康检查：`curl localhost:3000/api/health`
- 若 `pnpm typecheck` 报 `Unable to find package manager binary`：
  `$env:PATH = "E:\fork\2\.bin;" + $env:PATH`（那里有 corepack 的 pnpm shim）

### 桌面版

```bash
# 开发模式（需要先 build 过 web，standalone 才有内容）
pnpm --filter @karakeep/web run build
pnpm --filter @karakeep/workers run build
cd apps/desktop && npx electron .          # 打包版路径逻辑会自动切到 resources/

# 出安装包
cd apps/desktop && npx electron-builder --win --x64   # 产物 release/InsightVault-1.0.0-win-x64.exe
```

启动日志：`%USERPROFILE%\.insight-vault\boot.log`；服务日志：`%APPDATA%\InsightVault\logs\`；
数据：`%APPDATA%\InsightVault\data\`。

---

## 3. 改过哪些地方（按包）

| 位置 | 我们的改动 |
|---|---|
| `tooling/tailwind/` | `tokens.css`（品牌 token）、`base.ts`（语义色/字号/阴影）、`globals.css`（衬线标题、`.ai-surface`） |
| `apps/web/app/layout.tsx` | 品牌 metadata、Inter 改 variable |
| `apps/web/app/dashboard/layout.tsx` | 侧栏新增：AI 对话 / 知识图谱 / 智能专题 / 创作工作台 / 会员中心 |
| `apps/web/app/dashboard/{chat,graph,topics,create,membership}/` | 五个新页面 |
| `apps/web/components/{signin,signup,invite}/` | 认证四页 + 邀请页中文化；**登录页记住邮箱 + 保持登录；注册页密码+验证码** |
| `apps/web/lib/auth/otp.ts` | 验证码发/校/节流、本机回显判定（ADR-029/030） |
| `apps/web/app/api/otp/{request,register,sign-in,verify-email}/` | 发码 / 注册即登录 / 免密码登录 / 验证邮箱 |
| `apps/web/server/auth.ts` | 验证码钩子、跳过重复验证邮件、会话 30 天 |
| `apps/web/components/BrandLogo.tsx`、`lib/brand.ts` | 品牌标记与真源 |
| `apps/web/components/ui/{card,input,dialog}.tsx`、`shared-react/.../button.tsx` | 组件四件套 token 化 |
| `apps/workers/workers/crawlerWorker.ts` | 归档前置 + 失败不致命；`getAssetReferer` |
| `apps/workers/workers/embeddingsWorker.ts` | `persistBookmarkChunks`（分块落库） |
| `apps/workers/metascraper-plugins/metascraper-{wechat,bilibili,zhihu,xiaohongshu}.ts` | 四个中国源适配器 |
| `packages/db/schema.ts` + `drizzle/0097..0100` | chunks / graph / orders / entitlements |
| `packages/trpc/routers/{chat,graph,payment,topics,creation}.ts` | 新增五个 router |
| `packages/trpc/lib/search.ts` | 共享列表内容可搜 |
| `packages/shared/{chunking,rag,entityExtraction,topics,creation,orderStateMachine,urlNormalization}.ts` | 七个新模块（共 91 个单测） |
| `apps/desktop/main.js` | 桌面主进程：启动画面、托盘、快捷键、服务自恢复、窗口记忆、SMTP 设置、权限收紧 |
| `apps/desktop/migrate.cjs` | 不依赖 drizzle 的迁移执行器 |
| `apps/browser-extension/` | 8 个文件品牌化 |
| `docs/` | 20+ 份文档（含 `RELEASE.md`、`CHANGELOG.md`） |
| `.github/workflows/` | 只保留 `ci.yml`（typecheck+单测+构建）与 `release.yml`（tag → GHCR 镜像 + Release） |

---

## 4. 已完成 / 未完成

### 已完成（有端到端证据）

- 收藏抓取链路（含四个中国源，带降级）
- SQLite WAL + `busy_timeout`（双进程写库）
- 后置作业幂等（归档前置、失败不致命）
- URL 归一化去重（10 单测）
- **注册（邮箱+密码+验证码）→ 自动登录**：`scripts/e2e-auth.mjs` 10 项断言通过
- **登录（邮箱+密码）**、**30 天持久会话**（杀进程重启后同一 cookie 仍可进收藏库）
- **验证码本地模式**：无 SMTP + 本机回环 → 码直接显示并自动填入
- 认证四页 + 邀请页中文化
- 组件四件套 + design token
- 语义分块（19 单测）+ chunk 落库
- RAG 拼装与引用校验（13 单测）
- AI 对话（路由 + 页面 + 端到端）
- 智能专题（9 单测 + 路由 + 页面 + 端到端）
- 创作工作台（11 单测 + 路由 + 页面 + 端到端）
- 知识图谱（三表 + API + 页面 + 规则抽取 + 写入 + 端到端）
- 订单状态机（14 单测）、payment 路由、权益同步、退款回收、多订单重算
- 流式对话：SSE 后端 + 前端消费 + 浏览器交互验证
- 引用 `[n]` 可点击回跳（8 单测）
- 多级收藏夹、图谱表格视图、Raindrop CSV 导入、专题/创作导出 `.md`
- **Windows 桌面版**：单实例、启动画面、托盘、`Ctrl/Cmd+Shift+K`、服务自恢复、SMTP 设置窗

### 未完成（按优先级）

| 优先级 | 事项 | 建议起点 |
|---|---|---|
| P1 | 真实 AI 推理 | 配 `OPENAI_API_KEY` 或 `OLLAMA_*`，跑标签/摘要/对话/专题各一次 |
| P1 | 真实支付通道 | `packages/trpc/routers/payment.ts` + webhooks；幂等表已就绪 |
| P2 | 全量 e2e（Playwright） | 起 Meilisearch + Chrome 后跑 `packages/e2e_tests`（本机没跑过） |
| P2 | macOS / Linux 出包 | 配置已写，未实测；需要对应平台机器 |
| P2 | 代码签名 | 需要 OV/EV 证书，消 SmartScreen |
| P3 | 移动端 | 按要求不做，源码保留 |
| P3 | 阅读器 AI 面板 | `app/reader/[bookmarkId]` |

---

## 5. 已知陷阱（全部踩过）

1. **`pnpm typecheck` 找不到 pnpm** → 把 `E:\fork\2\.bin` 加进 PATH（turbo 需要可执行文件）。
2. **`re2` 编译失败（无 MSVC）** → `pnpm-workspace.yaml` 里 `allowBuilds.re2: false`（ADR-011）。
3. **i18n 新键不被 TS 识别** → `tsc --noEmit --incremental false` 验证；是 `.tsbuildinfo` 缓存（ADR-020）。
4. **改 `translation.json` 后页面 500** → 多半是 trailing comma；改完立刻 `json.load` 校验。
5. **`curl` 看不到 `data-testid`** → 客户端组件挂载后才有，要用浏览器 DOM 验证。
6. **WAL 下只拷 `db.db` 会丢数据** → 连 `-wal`/`-shm` 一起，或用 `VACUUM INTO`。
7. **验证权益逻辑前先清历史订单** → 遗留的 `paid` 订单会让结果看起来像 bug。
8. **PowerShell 发中文 JSON 会 400** → 用 node/python 发请求，别用 `Invoke-RestMethod` 手拼。
9. **`Button` 没有 `loading` prop** → 那是 `ActionButton` 的（且 `loading` 必填）。
10. **Tailwind 的 `@layer` 不能放进被 `@import` 的 CSS** → `tokens.css` 直接写 `:root`/`.dark`（ADR-019）。
11. **新页面在 390px 会崩** → 固定宽度侧栏必须带 `lg:` 断点。
12. **`@layer`/`globals.css` 改动后要重启 dev** → Tailwind 预设是按启动时读取的。
13. **批量正则改 CSS 类名后必须抽查语法** → 曾生成非法类 `bg-warning/100/10`，Tailwind 直接忽略。
14. **`DATA_DIR` 绝对不能放在项目目录里** → SQLite 的 `-wal`/`-shm` 高频写入会让 dev watcher 死循环。
15. **Liteque 是进程内队列 + web 通过 HTTP 端口找 workers** → **先起 workers，再起 web**。
16. **本机 shell 里有 `ELECTRON_RUN_AS_NODE=1`** →
    直接 `electron .` 会当成 node 跑，报 `Electron failed to install correctly`。
    启动前 `Remove-Item Env:ELECTRON_RUN_AS_NODE`（DSH 会话继承了这个变量）。
17. **不要用 `Get-Content | Set-Content` 改动含中文的文件** →
    PowerShell 会把 UTF-8 读成 GBK 再写回，中文变乱码且可能吃掉换行（本项目踩过一次 e2e 脚本）。
    用编辑器 / 写文件工具，别用文本管道。
18. **`next build` 时 EPERM 删不掉 `standalone/node_modules/better-sqlite3/*.node`** →
    有旧的桌面版 / dev 服务还在跑并占用该文件；先关进程再 build。
19. **vitest 会读到本机 `.env`** → `server/auth.test.ts` 里「没配 SMTP」的用例会被本地 SMTP 配置带偏，
    已在 `setup()` 里默认 `stubEnv("SMTP_HOST", "")`。
20. **`date-format.test.ts` 依赖时区/默认语言** → 用本地时间构造日期、回退断言改为对比运行环境默认输出。
21. **`next dev`（Turbopack）在本机不水合**：页面能渲染、点击全无反应，控制台只有 `_next/hmr` WebSocket 报错。
    生产构建正常。判断「功能坏了」前先用生产构建复现；Playwright 套件默认就跑生产构建。
22. **桌面版改过 `app.setName` 会换 userData 目录** → 老版本数据在 `%APPDATA%\@karakeep\desktop`，
    新版本在 `%APPDATA%\InsightVault`。`migrateLegacyData()` 已做自动迁移；手工迁移时连 `secret.txt` 一起搬。
23. **改 `.env` 里的 SMTP 不会影响桌面版** → 桌面版的邮件配置在 `%APPDATA%\InsightVault\smtp.json`
    （托盘 →「邮箱服务设置」），主进程会清掉继承来的 `SMTP_*` 再注入自己的。
24. **`queue.db` 的 `tasks` 表不由应用迁移创建** → liteque 自己建（`prepareQueue`）。
    桌面版 `migrate.cjs` 现在会把 `liteque-drizzle` 一起跑到 `queue.db`；
    只起 web 不起 workers 时，**新建收藏会 500 `no such table: tasks`**（书签已写库，接口报错）。
    e2e harness 里也补了这一步。
25. **`next build` 时 EPERM 删不掉 `.next/standalone/node_modules/better-sqlite3/*.node`**
    → 有桌面版 / 临时服务器进程还活着；`Get-NetTCPConnection -State Listen` 找端口再 kill。
26. **`migrate.cjs` 的记账 hash 必须保持「纯文件名」** → 一旦加了前缀（本项目试过 `app:`），
    已应用的迁移会被当成新的全部重跑，撞到 `no such column` 直接起不来。
    `db.db` / `queue.db` 各自有独立的 `__drizzle_migrations`，本来就不会互相污染。

---

## 6. 确认没坏（命令 + 期望）

```bash
pnpm typecheck                                   # 期望 22/22
pnpm --filter @karakeep/shared exec vitest run   # 期望 235 passed
pnpm --filter @karakeep/trpc exec vitest run     # 期望 555 passed（28 文件）
pnpm --filter @karakeep/web exec vitest run      # 期望 65 passed（8 文件）
pnpm --filter @karakeep/web run lint             # 期望 0 errors（20 warnings 是历史噪声）
pnpm --filter @karakeep/web run build            # 期望产出 .next/standalone
curl -s localhost:3000/api/health                # 期望 200

# 账号链路（无需 SMTP：本地模式自动回显验证码）
node scripts/e2e-auth.mjs http://127.0.0.1:3000 --save-cookie C:\tmp\iv.cookie
node scripts/e2e-auth.mjs http://127.0.0.1:3000 --use-cookie  C:\tmp\iv.cookie   # 重启服务后再跑

# 浏览器端（Playwright，自带临时库 + 生产构建 standalone，跑完自动清理）
pnpm test:e2e:web                              # 期望 12 passed

python ..\artifacts\health-check.py              # 一键体检：文档 + 死链 + 主链路
```

---

## 7. 文档地图
| 想知道什么 | 看哪 |
|---|---|
| 产品要做什么 | `docs/PRODUCT_REQUIREMENTS.md` |
| 上游代码怎么组织的 | `docs/TECHNICAL_AUDIT.md` + `docs/audit/01..05` |
| 数据模型与迁移纪律 | `docs/DATABASE_DESIGN.md` |
| 设计系统怎么落地 | `docs/UI_DESIGN_SYSTEM.md` |
| 下一步该做什么 | `docs/DEVELOPMENT_ROADMAP.md` |
| 为什么这么决定 | `docs/DECISIONS.md`（32 条 ADR） |
| 怎么测 | `docs/TEST_PLAN.md` |
| 怎么部署 / 怎么用 | `docs/DEPLOYMENT.md` / `docs/USER_GUIDE.md` |
| 怎么发布到 GitHub | `docs/RELEASE.md` |
| 这一版改了什么 | `CHANGELOG.md` |
| 逐轮做了什么 | `docs/PHASE_2_REPORT.md` |
| 交付到什么程度 | `docs/FINAL_ACCEPTANCE.md` |
| 验证脚本怎么跑 | `artifacts/SCRIPTS.md` |
