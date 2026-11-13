# 技术审计 TECHNICAL AUDIT — Karakeep 基线

- 审计对象：`karakeep-app/karakeep`，commit **`fc22787`**（"test(e2e): fix flaky web tests after full page loads (#3319)"）
- 克隆方式：`git clone --depth 1`，落盘 `E:\fork\2\upstream-karakeep`（只读参考）
- 产品工作副本：`E:\fork\2\insight-vault`（同一快照，`git init` 后首个提交为上游基线）
- 审计时间：2026-11-08
- 结论可信度：**每一条都带 `path:line`**，详细证据在 `docs/audit/01..05`

---

## 1. 审计方法与工具（真实使用记录）

| 工具 | 用途 | 产出 |
|---|---|---|
| **源码通读**（read/grep） | 5 个并行专项审计 | `docs/audit/01-database.md`（1019 行）、`02-api-auth.md`（555 行）、`03-workers-jobs.md`（405 行）、`04-web-frontend.md`（518 行）、`05-ai-search.md`（647 行） |
| **REA 6.3.0**（`analyze-javascript-application`） | 静态调用图与模块图，验证「谁引用谁」 | `artifacts/rea-web.json`（apps/web：377 文件 / 339 JS / 159,087 AST 节点 / 应用图 5,567 节点·7,565 边 / 语义图 66,386 节点·60,093 关系 / 0 解析失败）、`artifacts/rea-extension.json`（扩展：54 文件 / 398 节点·715 边） |
| **Craft Anything 0.5.0**（`web_site_open` + `web_site_capture` + `web_walkthrough_record`） | 真实页面视觉与设计 token 采集、登录态页面录制 | `artifacts/visual/karakeep-home`、`raindrop-home`、`mymind-home`（截图 1440/390 + design tokens + 布局测量）、`karakeep-signin`、`karakeep-app-bookmarks`、`karakeep-app-settings`、`karakeep-app-tags` |
| **本地运行验证** | 证明「可运行」而非「可编译」 | 见 §6 |

REA 的诚实边界（其自身 limitations 原文）：静态分析不执行 bundle 引导代码，动态/混淆表达式可能无法解析，静态关系**不证明**运行时执行。因此凡涉及「运行时行为」的结论，均以本地实际运行结果为准（§6）。

---

## 2. 规模基线（真实计数）

| 维度 | 数值 | 证据 |
|---|---|---|
| workspace 包 | 20（apps 7 + packages 11 + tooling/tools/docs） | `pnpm-workspace.yaml` |
| 数据库表 | **34**（题面 33，多出 `importStagingBookmarks`） | `packages/db/schema.ts` |
| 迁移文件 | 97（最新 `0096_add_highlight_text_anchors.sql`） | `packages/db/drizzle/` |
| tRPC procedure | **147**（19 个 router；public 9 / admin 30 / 登录 108） | `packages/trpc/routers/*` |
| REST 端点 | **67**（`/api/v1` 58 + 根级 9；无 v2） | `packages/api/routes/*` |
| OpenAPI 注册路径 | 56（缺 singlefile/rss/public-assets/health/version/metrics/webhooks 七类） | `packages/open-api/lib/*` |
| 后台队列 | **12** | `packages/shared-server/src/queues.ts:81-364` |
| Worker runner | **12**（11 个具名 + `inference/inferenceWorker.ts`）+ 1 个 import 轮询器 | `apps/workers/index.ts:37-110` |
| Web 页面 | 44 个 `page.tsx` / 10 个 `layout.tsx` | `apps/web/app` |
| Web 组件 | **221**（ui 47 / dashboard 107 / settings 24 / admin 14 / 其他 39） | `apps/web/components` |
| 共享组件 | 6 个文件（Button/Popover/Textarea/BookmarkHtmlHighlighter/ScrollProgressTracker/highlights） | `packages/shared-react/components` |
| i18n 键 | 1002（22 个一级分组），34 个语言目录（实际加载 32） | `apps/web/lib/i18n`、`packages/shared/langs.ts` |
| 单元测试 | 7 文件 / 56 用例 | `apps/web/**/*.test.tsx` |
| E2E | 31 文件 / 175 用例（web 11 文件 / 52 用例） | `packages/e2e_tests` |

---

## 3. 模块地图与结论

```
apps/
├─ web             Next.js 16.4.1 App Router + Hono(/api)          → audit/04
├─ workers         12 队列消费者，抓取/推理/索引/媒体             → audit/03
├─ browser-extension  WXT + React                                  → audit/04 §2
├─ mobile          Expo RN 0.86                                    → audit/04 附录
├─ cli / mcp       对 REST v1 的薄封装                             → audit/02
└─ landing         营销站（Vite/Astro 风格）                       → —
packages/
├─ db              Drizzle + better-sqlite3，34 表 / 97 迁移       → audit/01
├─ trpc            业务逻辑核心，147 procedure                     → audit/02
├─ api             Hono REST 适配层，进程内调 tRPC                 → audit/02
├─ shared          config / inference / search / prompts / 队列契约→ audit/05
├─ shared-server   队列实例、插件加载、事件日志、tracing           → audit/03
├─ shared-react    跨端 hooks + 少量 UI                            → audit/04
├─ plugins         5 类插件：assetstore/search/queue/ratelimit/vectorstore
├─ sdk / open-api  客户端 SDK 与 OpenAPI 描述
└─ e2e_tests       vitest + playwright 作为库
```

### 3.1 数据库（详见 `audit/01-database.md`）

- **单库单文件**：`${DATA_DIR}/db.db`（better-sqlite3 13 + drizzle 0.45，同步 API）；队列另有 liteque 自管的 `queue.db`。
- **34 表 / 69 个命名索引 / 0 视图 / 0 触发器 / 0 FTS 虚表**。
- 结构性事实：`bookmarks` 主表 + 三张 PK 共享的 1:1 内容分表（`bookmarkLinks` / `bookmarkTexts` / `bookmarkAssets`），资产字节在 FS/S3，库里只有元数据。
- **排序键陷阱**：列名叫 `createdAt`，实际语义是 `lastSavedAt`（`schema.ts:243-252`），0092 迁移把排序键换成了它。
- **索引分类**：唯一性 17 / 租户分页 4 / 父实体反查 43 / 去重名称 5 / **全文检索 0**。仍有 8 个前缀重复索引（写放大）。
- **隔离**：21 张表自持 `userId`、9 张继承、4 张全局；**无 RLS、无触发器**，全靠应用层 WHERE；唯一 DB 级租户校验是规则引擎的复合外键。
- **共享列表是刻意的隔离破口**：协作者可读列表内全部书签，但**搜索只按 `userId` 过滤，共享内容搜不到**（产品级缺陷，Phase 4 修）。
- 沉睡表：`config`、`chatSessions`、`chatMessages` 运行时零引用。

### 3.2 API 与认证（详见 `audit/02-api-auth.md`）

- **双栈但单一授权源**：REST 不绕过 tRPC，而是 `createCallerFactory` 进程内调用 procedure（`packages/api/middlewares/auth.ts:9-37`）——授权逻辑只有一份。
- context 双通道：Bearer API key 优先，失败**静默回落** cookie session（`apps/web/server/api/client.ts:16-38`）。
- 构造器分层：`publicProcedure`(1000/min) / `authedProcedure`(3000/min) / `createScopedAuthedProcedure` / `sessionProcedure`（拒 key）/ `createAdminScopedProcedure`（scope + role）。
- **隔离总体干净**：单用户查询 userId 过滤完整；共享读路径字段级脱敏（note/favourited/archived、协作者邮箱）；公共列表不能让登录用户借道读私有接口。
- **真实风险**：
  - R1（中）`lists.removeFromList` 缺 `ensureBookmarkOwnership`（`routers/lists.ts:146-157`），editor 可移除他人加入的条目——完整性破坏，不泄内容。
  - R3（中）邀请码永不过期（`invites` 表无 `expiresAt`，`invites.ts:146-149` 硬编码 `expired:false`）。
  - R6（信息）普通用户可申请 `admin:*` scope（`apiKeys.ts:42`），靠 role 兜底。
- **商业化接入点**：订阅已物化进 `users` 三列，热路径零查询；新增门禁必须复用 `getActivePaidSubscriptionProvider` 优先级，否则「付费却被拒」。

### 3.3 后台任务（详见 `audit/03-workers-jobs.md`）

- 12 个队列，`link_crawler_queue` 是入口；抓取五步：域名限速 → 类型探测 → `crawlPage`（CDP + 重定向守卫 + 子请求 SSRF + autoconsent）→ 子进程解析（metascraper 13 插件 → Defuddle/Readability → DOMPurify）→ 落库并派发。
- **媒体能力**：截图/PDF/全页归档/WebP banner/图片 OCR（Tesseract 或 LLM）/PDF 文本与首页图/yt-dlp 下载齐全；**无 ffmpeg、无转码、无缩略图、无转录**。
- **中国源零代码**：全仓仅 `parseHtmlSubprocess.ts:136-142` 一处注释提到 Bilibili API extractor 被刻意禁用。
- **三个高危**：
  - `enqueuePostCrawlJobs`（`:472`）在归档（`:475-485`）之前，归档失败 → 整 job 重试 → 重复推断 + 重复 webhook（无幂等键）。
  - 默认并发全为 1（`config.ts:139-146`）。
  - `restate` 后端 `cancelAllNonRunning()` 未实现、统计恒 0（`queue-restate/src/index.ts:72-94`）。

### 3.4 AI 与搜索（详见 `audit/05-ai-search.md`）

- **Provider 只有两条硬编码分支**：OpenAI 兼容 + 原生 Ollama；`OPENAI_API_KEY` 存在时 Ollama 永久失效；无注册表、无故障转移。
- **接口只收单条 prompt / 单条 user message，无 `messages`、无 streaming** —— RAG 无法在现接口上生长。
- **无分块**：整篇压成 3000 字符 excerpt、上限 8000、一次请求 1 条输入（源码自带 TODO 承认）。
- 向量写 Meilisearch 独立索引 `bookmarks_vectors`；混合检索是应用层 RRF（k=60）融合全文 top100 + 向量 top100；阈值 0.6。
- **Chat 只有表**：`chatSessions`/`chatMessages`（迁移 0088）无 router / worker / UI / 引用 / 流式。
- **用量只进日志与 OTEL**，不落库、无配额。
- 坑：AI 标签落库是**全量替换**（先 DELETE `attachedBy='ai'` 再 INSERT），重试会丢标签；换嵌入模型无维度检测。

### 3.5 Web 前端（详见 `audit/04-web-frontend.md`）

- Next 16.4.1 / React 19.2.3 / **Tailwind v3.4（不是 v4）** / shadcn（已魔改，不能重刷）。
- 主题只有 **12 个 hsl 变量 + `--radius`**；**`--primary` 亮色是近黑、暗色是亮蓝**——同一按钮两种品牌色。
- **338 处硬编码调色板（56 文件）+ 387 处任意值 + 63 文件 156 处硬编码英文**。
- 字体只有 Inter 且 `subsets:["latin"]` → 中文全部回退系统字体。
- **不存在 `(dashboard)` 路由组**：实际目录是 `app/dashboard`，URL 真实存在；详情弹层是 `@modal` 并行路由 + `(.)preview/[bookmarkId]` 拦截，另有独立全页入口，**两处必须同步改**。
- **e2e 硬阻塞**：52 个 web 用例全部依赖英文可访问名（多处 `exact:true`），改文案即全红；当前**零视觉回归测试**。

---

## 4. 缺陷清单（按严重度）

| # | 级别 | 缺陷 | 位置 | 影响 | 计划 |
|---|---|---|---|---|---|
| 1 | **P0** | 无 `busy_timeout`、WAL 默认关，Web+Workers 双进程写库 | `sqlite.ts:26-46`、`config.ts:307` | `SQLITE_BUSY` 偶发失败 | Phase 3 |
| 2 | **P0** | 后置作业先于归档、无幂等键 | `crawlerWorker.ts:472` vs `:475-485` | 重复推断 + 重复 webhook | Phase 3 |
| 3 | **P0** | 限流默认关闭 | `rateLimit.ts:25-27` | 语义搜索裸奔烧嵌入费 | Phase 3 |
| 4 | **P0** | 大列表分页触发 `TEMP B-TREE` | `listId`/`tagId` + `lastSavedAt` 排序 | 列表越大越慢 | Phase 4 |
| 5 | **P1** | 共享列表内容搜不到 | `lib/search.ts` 只按 userId 过滤 | 协作功能价值打折 | Phase 4 |
| 6 | **P1** | `lists.removeFromList` 缺归属校验 | `routers/lists.ts:146-157` | 协作者可删他人条目 | Phase 4 |
| 7 | **P1** | 邀请码永不过期 | `invites.ts:146-149` | 付费席位不可审计 | Phase 7 |
| 8 | **P1** | schema 漂移（`attachedAt` 亲和、`attachedBy` 可空、3 个默认值只在 DDL） | `schema.ts` vs 迁移 | `drizzle-kit generate` 会产错 | Phase 5 |
| 9 | **P1** | 路由缺 `/dashboard` 首页 | `apps/web/app/dashboard` 无 `page.tsx` | 访问 `/dashboard` 直接 404（**已实测确认**） | Phase 2 |
| 10 | **P2** | 默认并发全为 1 | `config.ts:139-146` | 单慢域名/慢 webhook 阻塞 | Phase 3 |
| 11 | **P2** | `apps/web` 的 `test` 脚本是 vitest watch | `apps/web/package.json:15` | CI 会挂住 | Phase 2 |
| 12 | **P2** | `components.json` 的 css 路径失效 | `components.json:8` | shadcn CLI 不可用 | Phase 2 |
| 13 | **P2** | 22 处标题模板硬编码品牌名 + 3 个 localStorage 键含品牌名 | 多文件 | 换品牌会丢用户偏好 | Phase 2 |
| 14 | **P2** | 中文 OCR / 中文分词未验证 | — | 中文检索质量未知 | Phase 3 |

---

## 5. 改造机会（按投入产出排序）

1. **分块 + chunk 级向量**：一张新表 + 一个 worker 改动，同时解锁语义质量与 RAG（Phase 5 前置）。
2. **Provider 注册表 + 用量计量**：把 `inference.ts` 的硬分支拆成 providers/ + registry，工厂层统一记 `aiUsage`。
3. **中文内容适配**：metascraper 站点插件是最低成本的落点（返回 `readableContentHtml` 可绕过 Defuddle）。
4. **Token 层重建**：12 个变量换成完整语义层，解决品牌一致性与跨端冲突。
5. **知识图谱**：复用 `normalizedName` 生成列与 `(userId, id)` 复合外键两套既有模式。

---

## 6. 本地运行验证（Phase 1 硬性要求：必须真的跑起来）

环境：Windows 11 / Node **v24.18.0** / pnpm **11.28.9**（corepack）/ 无 Docker / 无 MSVC。

| 步骤 | 命令 | 结果 |
|---|---|---|
| 依赖安装 | `corepack pnpm install` | 首次因 `re2` 需 MSVC 编译失败；按 ADR-011 关闭该构建后 **成功（41.4s，3129 包）** |
| 数据库迁移 | `corepack pnpm --filter @karakeep/db run migrate` | **成功**，生成 `.data/db.db`（626,688 B），97 个迁移全部应用 |
| Web 启动 | `corepack pnpm --filter @karakeep/web run dev` | **Next.js 16.4.1 Turbopack Ready in 2.3s**，插件加载：assetstore=Filesystem、queue=Liteque、ratelimit=In-Memory；search/vectorstore 未启用（未配 Meilisearch） |
| Workers 启动 | `corepack pnpm --filter @karakeep/workers run start` | **成功**，12 个 worker 全部启动，`Listening on http://127.0.0.1:60460`；adblock 规则因 `raw.githubusercontent.com` 不可达降级（不影响抓取主流程）；因无 `BROWSER_WEB_URL` 进入 **browserless 模式** |
| 健康检查 | `GET /api/health` | **200**（46 B） |
| 版本 | `GET /api/version` | **200**（21 B） |
| 首页 | `GET /` | **200**（35,850 B，重定向到 `/signin`） |
| 注册 | `POST /api/auth/sign-up/email` | 首次成功创建 `audit@insightvault.local`，**第一个用户自动 `role=admin`** |
| 登录 | `POST /api/auth/sign-in/email` | **200**，返回 session cookie `better-auth.session_token` |
| 受保护页面 | `GET /dashboard/bookmarks`、`/settings/ai`、`/dashboard/tags` | **200**（72 KB / 113 KB / 51 KB） |
| **路由缺陷复现** | `GET /dashboard` | **404** —— 确认 P1-#9 |
| 真实 UI 截图 | Craft Anything walkthrough（注入 session cookie） | `artifacts/visual/karakeep-app-*`（1440×900，登录态） |

**未验证/未启用**（诚实边界）：

- **Meilisearch 未启动** → 全文/语义搜索在本机不可用（`MEILI_ADDR` 未配，插件注册为空）。
- **无 Headless Chrome** → 抓取走 browserless（fetch）路径，浏览器渲染类站点（SPA、微信、小红书）尚未验证。
- **未配置 AI Key** → 标签/摘要/嵌入未实际运行。
- **移动端、浏览器扩展未构建运行**（Expo prebuild 与 WXT 构建需要在 Phase 8 单独验证）。
- **Docker 部署未验证**（本机无 Docker）。

---

## 7. 环境变量清单（运行所需，按用途）

| 变量 | 必需 | 作用 | 备注 |
|---|---|---|---|
| `DATA_DIR` | **是** | SQLite 与资产的根目录 | 唯一必填项 |
| `NEXTAUTH_SECRET` | **是** | 会话 cookie 与令牌签名 | 缺失则无法登录 |
| `NEXTAUTH_URL` | 建议 | 站点基址（回调/邮件链接） | 本地 `http://localhost:3000` |
| `MEILI_ADDR` | 否 | 全文搜索与向量库地址 | 不设则搜索禁用 |
| `MEILI_MASTER_KEY` | 否 | Meilisearch 鉴权 | 生产必设 |
| `MEILI_VECTOR_ADDR` | 否 | 向量索引独立实例 | 可与主实例分离 |
| `BROWSER_WEB_URL` | 否 | Chrome CDP 端点 | 不设则 browserless 模式 |
| `BROWSER_COOKIE_PATH` | 否 | 注入抓取用 Cookie | 中国站点适配关键 |
| `OPENAI_API_KEY` | 否 | AI 推理 | 存在时 Ollama 被禁用 |
| `OPENAI_BASE_URL` | 否 | OpenAI 兼容端点 | 可指 Ollama `/v1`、中转 |
| `INFERENCE_TEXT_MODEL` / `INFERENCE_IMAGE_MODEL` | 否 | 文本/视觉模型 | 默认值见 `config.ts` |
| `EMBEDDING_TEXT_MODEL` / `EMBEDDING_DIMENSIONS` | 否 | 嵌入模型与维度 | 换模型需重建索引 |
| `DISABLE_SIGNUPS` | 否 | 关闭注册 | 默认 `false` |
| `MAX_BOOKMARKS_PER_USER` / `STORAGE_QUOTA_*` | 否 | 配额 | 商业化会用订阅覆盖 |
| `RATE_LIMITING_ENABLED` | 否 | 限流开关 | **默认 false（建议上线前打开）** |

> 完整清单见上游 `docs/docs/03-configuration/`；我们自己的部署变量表将在 Phase 9 的《部署文档》中冻结。

---

## 8. 结论

1. **基座可用**：这是一个工程完成度很高的项目——单机可跑、插件可换、抓取流水线成熟、API 双栈授权统一。不要重写，不要换框架。
2. **真正的缺口在「理解」层**：分块、RAG、图谱、用量——上游留了表和接口的位置，但没有实现。这正是灵感仓的差异化空间。
3. **品牌重构的真正阻力不在 CSS**：而在 338 处硬编码色、63 个文件硬编码英文、52 个依赖英文文案的 E2E。**先建护栏（data-testid + 视觉基线），再改视觉**。
4. **两个必须先修的稳定性问题**：SQLite 并发写（WAL/busy_timeout）与后置作业无幂等。它们会在真实用户量下立刻暴露。
5. 上游质量高但不等于可直接商用：邀请码永不过期、限流默认关闭、无订单模型、无用量计量——商业化部分基本要自建。
