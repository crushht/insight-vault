# 决策记录 DECISIONS（ADR）

> 格式：背景 → 选项 → 决策 → 后果。编号不复用，废弃时标注 `Superseded by`。
> 目的：Agent 更换会话后，靠本文件恢复「为什么这样做」。

---

## ADR-001 以 Karakeep 为基座，不重写

**背景**：任务书要求「不从零开发已成熟功能」。Karakeep 提供 34 张表、147 个 procedure、12 个队列、成熟抓取流水线与全端客户端。

**选项**：A) Fork 并改造；B) 全部重写；C) 只借鉴数据模型。

**决策**：**A**。保留 monorepo 结构、数据模型、API 契约、抓取引擎；只改品牌层与新增能力。

**后果**：
- 优点：站在成熟工程上，风险低；后续可 rebase 上游安全修复。
- 代价：继承其技术债（后置作业无幂等、限流默认关、338 处硬编码色）。
- 约束：所有改动必须能追溯到「上游文件 + 我们的 diff」，方便未来合并。

---

## ADR-002 产品文档放 `docs/`，与上游 Docusaurus 站点共存

**背景**：上游 `docs/` 是 Docusaurus 站点（`docusaurus.config.ts` 指向 `docs/`）。任务书要求 `docs/PRODUCT_REQUIREMENTS.md` 等路径。

**选项**：A) 把站点移到 `docs-site/` 并改 workspace 与 lockfile；B) 产品文档另起目录；C) 直接放在 `docs/` 根，与站点共处。

**决策**：**C（暂定）**。第一阶段不做结构性搬迁，避免动 lockfile importer 键导致 `--frozen-lockfile` 失败。

**后果**：
- 现在：产品文档可直接按任务书路径访问；Docusaurus 构建可能把根级 md 当页面（仅影响文档站，不影响产品运行）。
- 待办：Phase 2 若重建文档站，再执行 A 并同步 `pnpm-workspace.yaml` 与 `pnpm-lock.yaml` 的 importer 键。

---

## ADR-003 继续使用 SQLite，不引入 Postgres

**背景**：产品卖点是「单机一键起、数据在自己手里」。

**选项**：A) 保持 SQLite；B) 迁 Postgres；C) 双后端。

**决策**：**A**，并修 WAL/`busy_timeout`。

**后果**：
- 部署零依赖；备份就是拷文件。
- 必须解决并发写（P0）；水平扩展上限受单机限制（对个人/小团队产品足够）。
- 搜索与向量仍外置 Meilisearch，不引入向量数据库。

---

## ADR-004 建独立 token 层，Tailwind 保持 3.4

**背景**：现有主题只有 12 个 hsl 变量 + `--radius`，字号/间距/阴影/字体族全裸奔；`--primary` 明暗是两种颜色。Tailwind 已到 v4（CSS-first），但上游锁 3.4。

**选项**：A) 升级 Tailwind v4；B) 保持 3.4，新增 `tokens.css` + 语义 preset；C) 换 CSS-in-JS。

**决策**：**B**。

**后果**：
- 升级 v4 会与 22 处 `tailwindcss@3.4.1>postcss-selector-parser` override 及 shadcn 魔改组件冲突，收益低风险高。
- 新 token 层是唯一真源，Web 与 Mobile 都从它派生（修跨端 `hsl`/`rgb` 冲突）。

---

## ADR-005 i18n 收敛为 en + zh

**背景**：34 个语言目录，实际加载 32（fa/he 不可达）；翻译已漂移（el 81KB vs zh 50KB）；200 个 tsx 无 i18n 引用。

**决策**：保留 en + zh-CN 两份为维护集合，其余目录移入 `locales/_archive/`（不删，便于未来恢复）。

**后果**：维护成本降一个数量级；社区若需其他语言，按需从 archive 恢复并接受漂移。

---

## ADR-006 桌面端先 PWA，Tauri 只做评估

**背景**：任务书要求 Windows/macOS 产品。原生封装意味着两套构建、签名、更新通道。

**决策**：Phase 8 先做 **PWA**（可安装、快捷键、离线、分享目标）；Tauri 封装仅在「PWA 无法满足的明确需求」出现后启动。

**后果**：交付周期短、维护成本低；「全局快捷键」「后台常驻」在 PWA 下能力受限，需在验收时明确告知。

---

## ADR-007 Inference 成为第六类插件

**背景**：assetstore / search / queue / ratelimit / vectorstore 五类插件可替换，但 AI provider 是 `inference.ts` 里的硬编码分支（`OPENAI_API_KEY` 存在时 Ollama 永久失效）。

**决策**：新增 `PluginType.Inference`，provider 通过注册表声明能力（text / vision / embedding / ocr / streaming / json），调用方只依赖接口。

**后果**：多 provider、故障转移、按任务绑定模型都能落地；需要把 `inference.ts` 的现有调用点逐步迁移，保持旧签名兼容一个版本。

---

## ADR-008 支付先接标准通道

**背景**：需要月/年订阅与订单状态机。

**决策**：**Stripe（国际）+ 支付宝（国内）** 双通道，统一 `orders` 表与 provider 无关的状态机；微信支付在 Phase 7 之后按需追加。不自研支付网关。

**后果**：合规与对账交给通道；需要 webhook 幂等表（见 DATABASE_DESIGN §8.5）；退款走通道 API + 本地状态同步。

---

## ADR-009 分块策略：语义边界 + 500–800 token + 15% 重叠

**背景**：现状整篇压成 3000 字符 excerpt，长文信息大量丢失，RAG 无法定位。

**选项**：A) 固定字符窗口；B) 按段落/标题的语义边界，超长再切；C) 交给 provider 的 file search。

**决策**：**B**。中文按「句末标点 + 段落」切，英文按句切；每块保留 `startOffset/endOffset` 供引用回跳。

**后果**：检索质量与引用精度同时提升；需要一张 `bookmark_chunks` 表与重算逻辑（换模型要重建）。

---

## ADR-010 引用格式：行内 `[n]` + 结构化 citations

**背景**：AI 回答必须可追溯（FR-AI-06）。

**决策**：正文用 `[n]` 上标；`chatMessages.metadata.citations` 存 `[{n, chunkId, bookmarkId, quote}]`；点击 `[n]` 跳到收藏详情并高亮原文段落 2 秒。无依据时输出固定文案「你的收藏里没有相关内容」。

**后果**：引用可校验（n 必须存在于 citations）；前端需要实现回跳锚点。

---

## ADR-011 本地开发关闭 `re2` 原生构建

**背景**：`pnpm install` 在无 MSVC 的 Windows 上失败（`re2` 需要 node-gyp 编译）。`re2` 仅被 `url-regex-safe` 作为 optional peer 使用。

**决策**：`pnpm-workspace.yaml` 中 `allowBuilds.re2: false`，并在文件内注明恢复条件。

**后果**：安装可在纯 Node 环境完成；`url-regex-safe` 回退到原生 RegExp（功能等价、性能略降）。生产镜像（Linux + build tools）可改回 `true`。

---

## ADR-012 中国内容源走 metascraper 站点插件

**背景**：全仓零中国站点代码；抓取流水线已支持 13 个 metascraper 插件，且插件返回 `readableContentHtml` 会绕过 Defuddle。

**决策**：新增 `metascraper-wechat / -bilibili / -xiaohongshu / -zhihu` 四个插件并注册到 `parseHtmlSubprocess.ts`；站点特殊逻辑（Referer、Cookie 过滤）放在 `resolveSiteAdapter()` 一个函数里，不散落。

**后果**：改动面小、可单测；解析失败必须写入 `adapterStatus`（`login_required` / `blocked` / `manual`）驱动 UI 降级。

---

## ADR-013 品牌字符串集中化

**背景**：品牌名散落在 22 处标题模板、metadata、manifest、8 处 Logo 引用、5 处外链、3 个 localStorage/cookie 键。

**决策**：新建 `apps/web/lib/brand.ts` 作为唯一真源；旧 localStorage 键「读旧写新」，避免用户偏好静默丢失。

**后果**：换品牌只改一个文件 + 静态资源；需一次性清理硬编码（P2-10）。

---

## ADR-014 测试护栏先行

**背景**：52 个 web E2E 依赖英文可访问名（多处 `exact:true`），且零视觉回归。任何文案/视觉改动都会让测试全红且无兜底。

**决策**：Phase 2 **先**加 `data-testid` 与视觉基线，**再**改 UI 与文案。

**后果**：前期多花 1–2 天，但后续每个阶段的「测试通过」才可信。

---

## ADR-015 数据隔离由应用层保证，不引入 RLS

**背景**：SQLite 无行级安全；上游靠 `WHERE userId` + 少数复合外键。

**决策**：保持应用层强制过滤，但补两道防线：① `isolation.test.ts` 全 procedure 交叉越权测试进 CI；② 新增 procedure 必须走 `createScopedAuthedProcedure` 并在 code review 检查 `userId` 过滤。

**后果**：不引入额外复杂度；防线依赖测试而非数据库。若未来迁 Postgres，再评估 RLS。

---

## ADR-016 修复 `/dashboard` 404 的方式

**背景**：实测 `GET /dashboard` 返回 404（`apps/web/app/dashboard` 下无 `page.tsx`）。

**决策**：新增 `apps/web/app/dashboard/page.tsx`，`redirect("/dashboard/bookmarks")`；同时保留 `/dashboard/bookmarks` 作为「知识首页」入口。

**后果**：外部链接与用户手输不再 404；避免直接改目录结构带来的路由回归。


---

## ADR-017 字体：系统中文栈优先，Web 字体后置

**背景**：上游只加载 Inter 且 `subsets:["latin"]`，中文全部回退系统字体；直接上 `next/font` 的中文字体会让首屏拉取数 MB。

**决策**：`--iv-font-sans` 用「Inter（保留 next/font 变量）→ 系统中文字体栈」；标题 `--iv-font-serif` 用 Noto Serif SC / 思源宋体 / Songti 的系统回退。中文 webfont 作为后续增强（子集化 + `unicode-range` 分包）再引入。

**后果**：零网络字体依赖、构建稳定、各平台观感一致（Windows=雅黑、macOS=苹方）；衬线标题在 Windows 上回退到宋体，需在 P2 后期评估是否值得引入 Noto Serif SC 子集。

---

## ADR-018 默认界面语言改为中文，E2E 显式钉成英文

**背景**：`fallbackLng` 与用户设置默认值都是 `en`，产品对中文用户默认英文；同时 52 个 E2E 用例依赖英文可访问名（`getByLabel("Email")` 等，`exact:true` 多处）。

**选项**：A) 保持英文默认；B) 改中文默认并重写全部 E2E 选择器；C) 改中文默认 + E2E 注入语言 cookie。

**决策**：**C**。`apps/web/lib/i18n/settings.ts` 的 `fallbackLng` 与 `userLocalSettings` 的 `lang` 默认值改为 `zh`；`packages/e2e_tests/utils/browser.ts` 的 page fixture 注入 `hoarder-user-local-settings={"lang":"en"}`。

**后果**：产品默认中文（`html lang=zh`），E2E 继续跑英文断言，两者互不干扰；未来若做多语言回归，只需再复制一个 fixture 注入 `zh` 的用例集。

---

## ADR-019 design token 落在 `tooling/tailwind/tokens.css`，不升级 Tailwind

**背景**：见 ADR-004。落地时发现 Tailwind 会把被 `@import` 的 CSS 当独立文件处理，`@layer base` 在没有 `@tailwind base` 的文件里会报错。

**决策**：`tokens.css` **不使用 `@layer` 包裹**，直接写 `:root` 与 `.dark`；`globals.css` 顶部 `@import "./tokens.css";`。shadcn 的 12 个语义变量全部改为引用 `--iv-*` 原始 token，使明暗两侧色相同源。

**后果**：`--primary` 不再出现「亮色近黑、暗色亮蓝」；`rounded-lg/md/sm` 由 token 接管（14/10/6px）；组件里可以用 `bg-brand-600`、`text-muted-foreground`、`shadow-e1`、`text-h4`、`text-body` 等语义类。


---

## ADR-020 i18next 键类型的增量缓存陷阱

**背景**：给 `translation.json` 新增键后，`t("common.create")` 仍报类型错误，提示改用相近的旧键。

**根因**：i18next 的键联合类型由 `typeof import(en/translation.json)` 推导；`tsc --noEmit` 的
增量缓存（`.tsbuildinfo`）不会因为 JSON 内容变化而失效，导致新键永远进不了类型。

**决策**：遇到「JSON 有、TS 说没有」，先用 `tsc --noEmit --incremental false` 验证；
确认是缓存问题后，正常跑一次 `pnpm typecheck` 即可（turbo 会刷新缓存）。

**后果**：不再为新键做「硬编码中文」之类的规避；CI 里应保证至少有一次非增量类型检查。


---

## ADR-021 admin 后台中文化暂缓：先解耦 e2e

**背景**：admin 组件里有 34 处硬编码英文（`Add User`、`Roles`、`Bookmark Quota` 等）。

**障碍**：`packages/e2e_tests/tests/web/admin.test.ts` 直接用英文字面量定位：

```ts
page.getByRole("dialog", { name: "Add User" })
dialog.getByLabel("Name", { exact: true })
page.getByRole("menuitem", { name: "User Settings", exact: true })
```

这些是**硬编码英文**，不随 `lang` cookie 变化 —— 一旦改成中文，管理员相关的 e2e 会全部失败，
而当前 admin 组件上没有任何 `data-testid` 兜底。

**决策**：暂不改 admin 文案；先把关键交互补上 `data-testid` 并把 e2e 改为按 testid 定位，
之后再做中文化（顺序同 ADR-014：护栏先行）。

**后果**：admin 后台暂时保留英文。这不会影响普通用户（管理员专用界面），
但 P2-11「i18n 全量覆盖」在这一块要延后。


---

## ADR-022 admin 中文化走 i18n，而不是先补 testid

**背景**：ADR-021 决定「admin 文案暂缓，先补 `data-testid` 再中文化」。

**新发现**：还有一条更直接的路径 —— **把文案接进 i18n，并让 `en` 的值保持与原文逐字一致**。
`admin.test.ts` 用 `getByRole("dialog",{name:"Add User"})`、`getByLabel("Name")` 定位，
而 e2e 已经注入了 `lang=en` cookie；只要英文资源里仍是 `Add User`，测试就不会红，
中文用户又能看到中文。

**决策**：`admin.*` 文案改用 `t()`，**不做 testid 迁移**。ADR-021 的 testid 路线降级为「可选加固」。

**后果**：
- 中文化的成本从「34 处 testid + 6 个测试文件」降到「加键 + 换文案」；
- 仍需保证 `en` 值逐字符等于旧文案（否则 e2e 失败）——这是这套方案的唯一纪律；
- 已按此方案改造 `AddUserDialog`（8 个键：title/name/email/password/confirm_password/role/role_user/role_admin），
  `en` 值保持 `Add User` / `Name` / … / `Admin` 不变。


---

## ADR-023 改代码补丁必须先在目标作用域内定位

**背景**：给 `updateBookmarkText` 加「编辑后重建分块」时，我用

```
await Promise.all([
  triggerSearchReindex(input.bookmarkId, {…
```

当锚点插入代码。结果这个片段在文件里第一处出现于 `updateBookmark`（另一个结构完全相同的 procedure），
补丁打进那里，目标 procedure 一行没改。随后两轮验证都失败，我还一度把它归因成「队列端口失配」。

**决策**：任何「按文本锚点插入代码」的操作，必须遵守两条：

1. **先在目标作用域内定位**：找到函数/procedure 的起始标记，再在其后的窗口内查找锚点；
2. **插入后立刻用行号回读确认**（`grep -n` 关键标记），而不是只看脚本打印的 "patched"。

**后果**：本项目已因此踩坑两次（把 hook 插进解构参数 §75、把 enqueue 插进另一个 procedure §104）。
两次都是「脚本说成功、实际改错位置」。这条纪律已写入 HANDOFF 陷阱清单第 16 条。


---

## ADR-024 AI 检索包含已归档的收藏

**背景**：`chat.ts` 的关键词检索只按 `userId` 过滤，没有排除 `archived` 的收藏。
也就是说，用户归档的笔记仍会被 AI 引用。

**决策**：**保持包含**。

**理由**：归档在这个产品里的语义是「从主视图收起来」，不是「删除」或「不再关心」。
知识库的价值恰恰在于「很久以前收的东西，需要时还能被找到」。
如果排除归档，用户会得到一个反直觉的结果：明明收藏过、也归档了，AI 却说没有。

**后果**：
- 这是**用户应该知道的行为** —— 应在产品说明里写清楚（当前 `USER_GUIDE.md` 未提及，待补）；
- 若将来引入「AI 上下文预算」类功能，归档内容应排在活跃内容之后，而不是直接丢弃。


---

## ADR-025 用本地 mock provider 验证 AI 链路，而不是等真实 Key

**背景**：本机到 GitHub / HuggingFace 不通，装不了 Ollama，也没有 API Key。
「真实 AI 生成」因此长期作为未验证项挂着，每次验证都停在 `412 AI provider is not configured`。

**决策**：写一个本地 mock（`artifacts/mock_llm.py`，约 90 行），实现 OpenAI 兼容的
`/v1/chat/completions`（含 `stream: true`）与 `/v1/embeddings`，
把「链路验证」与「模型质量」彻底解耦。

**结果**：

| 环节 | 验证 |
|---|---|
| 非流式生成 | `sendMessage` 200 + citations=3 |
| 真流式 | SSE 收到 2 帧，边界与 mock 的 pieces 一致 → 走的是 `inferFromTextStream` |
| 专题 AI 模式 | `mode=ai` |

**后果**：换真模型只需改三个环境变量（`OPENAI_BASE_URL` / `OPENAI_API_KEY` / `INFERENCE_TEXT_MODEL`），
代码零改动。mock 保留在仓库，后续任何 AI 改动都可用它回归。

**一般化**：**只要协议是标准的，「对方不可用」就不该阻止我方验证。**
把不确定性压缩到「对方返回的质量」这一项，是本项目在受限环境里最重要的一条方法。

---

## ADR-026 tRPC 的 query 只能 GET，mutation 才能 POST

**背景**：这个坑在本项目里踩了 **4 次**：

| 轮次 | 场景 | 现象 |
|---|---|---|
| §88 | 支付订单列表 | 405 |
| §93 | 收藏详情 | 500（编码 + 方法混淆） |
| §113 | 生成历史 | 400 |
| §122 | 搜索与导出 | 405 `Unsupported POST-request to query procedure` |

每次都浪费了一到两轮排查。

**决策**：写验证脚本时遵守两条硬规则：

1. **query → GET**，input 必须按 batch 格式并 URL 编码：
   `?batch=1&input={"0":{"json":{…}}}`
2. **mutation → POST**，body 是 `{"0":{"json":{…}}}`

**后果**：
- `artifacts/selfcheck.py` 里已有 `get()` / `post()` 两个助手，新脚本直接复用；
- 判断一个 procedure 是 query 还是 mutation：**只有 `.mutation(` 定义的才能 POST**。

**诊断口诀**：看到 `405 Unsupported POST-request to query procedure`，
不要怀疑路由或鉴权 —— **就是用了 POST 调 query**。


## ADR-027：桌面版用 Electron 而不是 Tauri

**背景**：需要「下载安装就能用」的形态，Web 版要用户自己起服务。

**备选**：
- Tauri（Rust + WebView，体积 ~10 MB）
- Electron（Node + Chromium，体积 ~140 MB）

**决定**：Electron。

**理由**：
1. 应用本身要跑一个 Node 服务（Next standalone + workers），Electron 自带 Node，
   用 `process.execPath` + `ELECTRON_RUN_AS_NODE=1` 就能直接 spawn，不需要额外打包 node sidecar；
2. Tauri 要用外部二进制 sidecar，跨平台打包 node 运行时更麻烦；
3. 体积不是这个产品的首要约束（用户装的是一套自托管知识库）。

**代价**：安装包 140 MB，冷启动约 30–40 秒（要拉起 Next server + 迁移 + workers）。

---

## ADR-028：桌面版自己跑数据库迁移，不依赖 web 进程

**背景**：桌面版首次启动后，workers 报 `no such table: importStagingBookmarks`。

**根因**：Karakeep 的 web 进程**不负责建表** —— Docker 镜像里是由 s6 的
`init-db-migration` 服务跑的。桌面版没有那一层。

**决定**：桌面主进程在 `whenReady` 里先同步执行 `migrate.cjs`，再起 server 与 workers。

**实现要点**：
1. `migrate.cjs` **不依赖 drizzle-orm** —— standalone 包里没有
   `drizzle-orm/better-sqlite3` 这个子路径（被 bundle 进 server.js 了）。
   改为读 `packages/db/drizzle/*.sql`，按 `--> statement-breakpoint` 切开逐句 `exec`，
   并在 `__drizzle_migrations` 里记账（重复执行跳过）。
2. `migrate.cjs` 必须放在 `resources/server/` 下（与 `node_modules` 同级），
   否则 `require("better-sqlite3")` 解析失败；放在 `app.asar` 内也不行，
   因为 spawn 出来的 node 进程读不了 asar。
3. **workers 必须在迁移之后启动** —— 之前三个进程同时 spawn，
   表现是 `workers.log` 里每 5 秒一条 `no such table`。

**顺序**：`runMigrations() → startServer() → waitForHealth() → startWorkers() → createWindow()`

---

## ADR-029 注册用「密码 + 6 位邮箱验证码」，登录用「邮箱 + 密码」

**背景**：任务书要求注册要设密码并收邮箱验证码；同时明确「已有账号登录只输邮箱和密码」。
上一轮只有两条独立路径：better-auth 默认注册（密码 → 发验证链接 → 回站点验证 → 再登录），
以及登录页的验证码登录。结果是注册要跨三次上下文切换，桌面端尤其难受。

**选项**：
- A. 保留上游 `/sign-up/email`，前端只做引导；
- B. 新写 `/api/otp/register`：先校验验证码（证明邮箱归属），再建账号并直接签发 session。

**决定**：B。

**实现要点**：
1. 验证码按用途分命名空间：`otp:signup:<email>`（15 分钟）/ `otp:<email>`（5 分钟），
   互不越权 —— 登录码不能拿去注册；
2. 建号仍走 better-auth 的 `auth.api.signUpEmail`（保留它的密码哈希、首个用户即管理员、
   配额钩子），拿到 `asResponse` 的 `Set-Cookie` 原样回传；
3. 注册成功后 `emailVerified = true`，并用 `markVerificationEmailHandled` 吞掉
   `sendOnSignUp` 那封重复的验证邮件；
4. 开了 `EMAIL_VERIFICATION_REQUIRED` 时注册不签 session，这时补一次 `signInEmail`。

**后果**：注册 → 填码 → 直接进收藏库；登录页只剩「邮箱 + 密码」是主路径。

---

## ADR-030 没有 SMTP 时，只对本机回环 + 非生产环境回显验证码

**背景**：桌面版默认不带 SMTP。若照搬「必须发邮件」，桌面版第一步注册就死锁。

**选项**：
- A. 无 SMTP 就直接 501（桌面版不可用）；
- B. 无 SMTP 就把码回给前端（简单，但公网实例等于没有验证）；
- C. 无 SMTP + 请求来自回环 + 服务端显式开关（桌面版 `DESKTOP_APP=1` 或非生产环境）才回显。

**决定**：C。

**实现要点**：
1. Next 即便直连也会补 `x-forwarded-*`，所以「本机」判定要同时看
   `x-forwarded-host`/`host` 是回环地址、`x-forwarded-for`/`x-real-ip` 也是回环；
2. 服务端开关：`DESKTOP_APP=1`（桌面版）、`LOCAL_AUTH_CODE=1`、或 `NODE_ENV !== "production"`；
3. 公网生产实例漏配 SMTP 时返回 501 并给出明确文案，不会把码发给陌生人。

**后果**：桌面版开箱即用；要真收邮件就在托盘「邮箱服务设置」里填 SMTP。

---

## ADR-031 登录默认 30 天持久 cookie，桌面版用持久分区

**背景**：用户要求「账号创建好之后要记住，不能每次进去都登录一遍」。

**事实**：better-auth 的 `setSessionCookie` 在 `rememberMe` 非 false 时写
`Max-Age = session.expiresIn`（本项目 30 天）；一旦带过 `dont_remember` cookie，
后续登录会退化成会话级 cookie。

**决定**：
1. 登录/注册一律显式 `rememberMe: true`（除非用户取消勾选），确保 cookie 带 `Max-Age`；
2. 界面上把「在这台设备上保持登录（30 天）」作为默认勾选项，取消勾选则 `rememberMe: false`；
3. 邮箱记在 `localStorage`（`iv.rememberedEmail`），下次打开只需补密码；
4. 桌面主窗口使用 `persist:insightvault` 分区，cookie 落到 userData；
5. `NEXTAUTH_SECRET` 持久化在 `userData/secret.txt`，否则重启后 cookie 签名对不上。

**验证**：`scripts/e2e-auth.mjs` 断言注册响应带 `Max-Age=2592000`，
并在杀进程重启服务后复用同一 cookie 直接进收藏库。

**补充（桌面版 365 天 + 老数据迁移）**：
- 桌面主进程给子进程注入 `AUTH_SESSION_DAYS=365`，`apps/web/server/auth.ts` 读这个变量决定
  `session.expiresIn`（默认 30，最大 3650）。单机自用没必要 30 天就重新登录。
- 1.0 早期版本的应用名是 npm 包名，userData 落在 `%APPDATA%\@karakeep\desktop`；
  改 `app.setName("InsightVault")` 之后必须迁移老目录，否则用户「明明注册过却登不进去」。
  `migrateLegacyData()` 在新目录还没有 `db.db` 时整体拷贝老数据 + 配对的 `secret.txt`，
  拷贝失败不阻塞启动（记 boot.log 后继续用新目录）。

---

## ADR-032 桌面版 SMTP 配置放 userData/smtp.json，以环境变量注入子进程

**背景**：桌面版要能真发邮件，但用户不该去编辑 `.env`、也不该把授权码写进安装目录。

**选项**：
- A. 让用户手改安装目录里的 `.env`（升级会丢，还得懂格式）；
- B. 托盘菜单里做一个表单窗口，存 `userData/smtp.json`（0600），重启服务时注入 `SMTP_*`。

**决定**：B。

**实现要点**：
1. 表单页是主进程写到 userData 的静态 HTML，`file://` 加载，`nodeIntegration` 只给这一页；
2. 保存后弹「立即重启服务 / 稍后」，`restartServices()` 用新环境变量重新 spawn；
3. `serverConfig` 在进程启动时解析 env，所以必须重启子进程才生效 —— 这一点写进 UI 文案。

