# Web 前端审计

> 审计对象：`apps/web` + `packages/shared-react`（Karakeep 快照 commit `fc22787`，本地基线 commit `872d383`）
> 审计方式：只读静态阅读，所有结论均标注 `path:line`。行号以当前快照为准。
> 目的：为「灵感仓 INSIGHT VAULT」品牌重构（Next.js 16 + React 19.2 + Tailwind）提供可执行的替换/新增/重写清单。

---

## 1. 技术栈与构建

### 1.1 框架与运行时版本

| 项 | 版本 / 值 | 证据 |
| --- | --- | --- |
| Next.js | `16.4.1`（精确锁版本，无 `^`） | `apps/web/package.json:77` |
| React / React DOM | `19.2.3` / `19.2.3` | `apps/web/package.json:80`、`apps/web/package.json:82` |
| TypeScript | 走 workspace 预设 `@karakeep/tsconfig/base.json` | `apps/web/tsconfig.json:2` |
| 构建模式 | `next build --experimental-build-mode compile`（编译产物与启动分离） | `apps/web/package.json:11` |
| dev | `next dev`；另有 `portless` 局域网变体 | `apps/web/package.json:8`、`apps/web/package.json:9` |
| 输出 | `output: "standalone"`（Docker 自包含） | `apps/web/next.config.mjs:9` |
| 包管理 / 任务编排 | pnpm `11.28.9` + turbo `^2.10.13` | `package.json:14`、`package.json` workspace 脚本 `test`/`typecheck`/`preflight` |

React 19.2 + Next 16.4 已经在位，说明**不需要做框架大版本升级**，品牌重构是纯 UI/设计系统层面的工作。这一点与任务前提「目标 Next.js 16 + React 19.2 + Tailwind」完全吻合——现有基座即是目标基座。

### 1.2 构建配置要点（`apps/web/next.config.mjs`）

- **SVG 双通道**：Turbopack 规则用 `@svgr/webpack` 把 `*.svg` 转成 React 组件（`apps/web/next.config.mjs:10-17`），同时保留 webpack 的同名规则（`apps/web/next.config.mjs:18-24`）。Logo 即通过此机制以组件形式引入（`apps/web/components/KarakeepIcon.tsx:1`）。
- **CORS 只覆盖 `/api/*`**：放开 `Access-Control-Allow-Origin: *` 与 `Allow-Credentials: true`（`apps/web/next.config.mjs:25-54`）。注意这是既存事实（RFC 不允许 `*` + credentials 同时生效，浏览器会拒），重构时若动 API 前缀需要一并处理。
- **`typescript.ignoreBuildErrors: true`**（`apps/web/next.config.mjs:59`）：构建不做类型检查，类型门禁靠 `pnpm typecheck` 独立执行（`apps/web/package.json:16`）。含义是**重构期间构建不会因类型错误而红**，必须显式跑 typecheck。
- **`transpilePackages` 被注释掉**（`apps/web/next.config.mjs:56`）：workspace 包靠 Next 16 默认行为解析。
- **`allowedDevOrigins`** 从环境变量注入（`apps/web/next.config.mjs:61`），`agentRules: false`（`apps/web/next.config.mjs:63`）。
- **没有 `images` 配置**：`next.config.mjs` 全文无 `images` 键。而卡片图使用 `next/image` 的地方全部显式 `unoptimized`（`apps/web/components/dashboard/bookmarks/LinkCard.tsx`、`TextCard.tsx`、`AssetCard.tsx`、`BookmarkLayoutAdaptingCard.tsx`、`apps/web/components/dashboard/preview/LinkContentSection.tsx` 等 8 个文件）。**品牌重构若要换成 CDN 图片域，必须新增 `images.remotePatterns`**，否则 `<Image>` 会直接抛错。
- **PWA**：`app/manifest.ts` 硬编码品牌名与图标清单（`apps/web/app/manifest.ts:5-6`、`apps/web/app/manifest.ts:50`、`apps/web/app/manifest.ts:57`）。

### 1.3 Tailwind 版本与主题扩展策略

- **Tailwind 是 v3.4，不是 v4**：`tailwindcss: ^3.4.1`（`apps/web/package.json:119`），PostCSS 走经典插件链 `tailwindcss` + `autoprefixer`（`apps/web/postcss.config.cjs:2-5`）。**没有 `@tailwindcss/postcss`，没有 CSS-first `@theme`**。这是重构中最大的一个版本决策点（见 §9）。
- 应用侧 config 极薄，只做两件事：继承 workspace preset + 追加 shared-react 的扫描路径：

  ```ts
  // apps/web/tailwind.config.ts:5-11
  const config = {
    content: [...web.content, "../../packages/shared-react/components/**/*.{ts,tsx}"],
    presets: [web],
  } satisfies Config;
  ```

- 真正的主题定义在 `tooling/tailwind`，并被两个 app 共享（`tooling/tailwind/package.json` exports `./native`、`./web`、`./globals.css`）：
  - `tooling/tailwind/base.ts:4` → `darkMode: ["class"]`（class 策略）
  - `tooling/tailwind/base.ts:20-55` → 颜色全部指向 CSS 变量 `hsl(var(--x))`
  - `tooling/tailwind/base.ts:56-58` → 全局默认 `borderColor`
  - `tooling/tailwind/web.ts:12-16` → 只扩展了 `borderRadius`（lg/md/sm 由 `--radius` 派生）
  - `tooling/tailwind/web.ts:17-39` → 三个 keyframes（accordion-down/up、pulse-border）
  - `tooling/tailwind/web.ts:42` → 插件只有 `tailwindcss-animate` + `@tailwindcss/typography`

  换算：**主题扩展只做了「颜色 + 圆角 + 三个动画」，没有扩展 fontSize / spacing / boxShadow / fontFamily / screens**（见 §5）。

### 1.4 shadcn/ui 配置

```json
// apps/web/components.json:3-13
"style": "default", "rsc": true, "tsx": true,
"tailwind": { "config": "tailwind.config.ts", "css": "app/globals.css",
              "baseColor": "slate", "cssVariables": true, "prefix": "" },
"iconLibrary": "lucide"
```

- `"style": "default"` = 旧版 shadcn 默认风格（非 `new-york`），组件源码被 fork 进仓库并**大量魔改**（例如 `apps/web/components/ui/dialog.tsx:42` 自带 `rounded-xl` / `shadow-2xl` / 自定义动画，`apps/web/components/ui/dialog.tsx:31-36` 增加 `hideCloseBtn` 参数）。**结论：不能直接 `shadcn init` 重刷，会覆盖手工定制。**
- `css` 字段指向 `app/globals.css`，但**该文件不存在**：真实样式从包引用（`apps/web/app/layout.tsx:5` → `import "@karakeep/tailwind-config/globals.css"`）。`components.json` 的这条路径是**失效配置**，任何 shadcn CLI 操作都会出问题。
- 注册了两个第三方 registry（`apps/web/components.json:18-21`：ai-elements、ncdai），说明**AI 对话类组件曾计划引入**（呼应 §7.6）。
- `baseColor: slate` 与 §5 的 `--primary: 222.2 47.4% 11.2%`（slate-900 系）一致；暗色则偏离 slate 走向纯黑（`tooling/tailwind/globals.css:41-42`）。

### 1.5 其他关键依赖（决定重构成本）

| 依赖 | 用途 | 证据 |
| --- | --- | --- |
| `@tanstack/react-query` 5.90.2 | 全站客户端缓存 | `apps/web/package.json:58-59` |
| `@trpc/*` 11.9 + `@trpc/tanstack-react-query` | 类型安全 API | `apps/web/package.json:60-62` |
| `i18next` 23 + `react-i18next` 15 + `i18next-resources-to-backend` | 自研 i18n（不用 next-intl） | `apps/web/package.json:72-73`、`apps/web/package.json:88` |
| `next-themes` 0.4.6 | 暗色模式 | `apps/web/package.json:78` |
| `zustand` 5.0.5 | 轻量全局状态 | `apps/web/package.json:102` |
| `nuqs` 2.4.3 | URL query state（仅 Adapter 层） | `apps/web/package.json:79`、`apps/web/app/layout.tsx:3` |
| `lexical` 0.20.x（8 个包） | 富文本/Markdown 编辑器 | `apps/web/package.json:30-36` |
| `cmdk` 1.1.1 | 命令面板/自动补全 | `apps/web/package.json:67` |
| `sonner` 2.0.7 | Toast | `apps/web/package.json:98` |
| `react-masonry-css` / `react-intersection-observer` | 瀑布流 + 无限滚动 | `apps/web/package.json:91`、`apps/web/package.json:89` |
| `modern-screenshot` / `react-tweet` / `react-syntax-highlighter` | 分享图 / 推文嵌入 / 代码高亮 | `apps/web/package.json:76`、`apps/web/package.json:93`、`apps/web/package.json:92` |
| `@marsidev/react-turnstile` | 注册人机校验 | `apps/web/package.json:37` |
| `better-auth` 1.7.16 + `hono` 4.13 | 认证与会话 | `apps/web/package.json:63`、`apps/web/package.json:71` |
| `@emoji-mart/react` | 列表图标选择 | `apps/web/package.json:21-22` |

---

## 2. 路由与页面清单

### 2.1 结构性事实（先纠正前提）

1. **不存在 `(dashboard)` 路由组**。实际目录是普通目录 `apps/web/app/dashboard`，因此 URL 前缀 `/dashboard` 真实存在，**不能通过删括号来改 URL**。
2. 详情弹层的并行路由槽名是 **`@modal`**，被拦截路由写作 `(.)preview`（同级拦截），对应独立全页 `/dashboard/preview/[bookmarkId]`。
3. 统计口径：`page.tsx` **44** 个、`layout.tsx` **10** 个、`route.ts`/`route.tsx` **6** 个、`error.tsx` 1、`not-found.tsx` 2、`default.tsx` 1、`manifest.ts` 1。

### 2.2 顶层与鉴权区

| 路由 | 文件 | 类型 | 用途 |
| --- | --- | --- | --- |
| `/` | `apps/web/app/page.tsx:4-10` | RSC | 纯重定向：有会话→`/dashboard/bookmarks`，否则→`/signin` |
| `/signin` | `apps/web/app/signin/page.tsx:6-21` | RSC | 居中 Logo(80px) + `SignInForm` |
| `/signup` | `apps/web/app/signup/page.tsx:11-36` | RSC | 支持 `redirectUrl` / `skipSessionRedirect`（移动端回跳） |
| `/forgot-password` | `apps/web/app/forgot-password/page.tsx:6-21` | RSC | `ForgotPasswordForm` |
| `/reset-password` | `apps/web/app/reset-password/page.tsx:6-29` | RSC | `token` 缺失则回落 `/signin` |
| `/verify-email` | `apps/web/app/verify-email/page.tsx:23-` | **Client** | 读 `token`/`email`，`useMutation` 验证，含移动端深链跳转（`apps/web/app/verify-email/page.tsx:45-52`） |
| `/check-email` | `apps/web/app/check-email/page.tsx:20-138` | **Client** | 验证邮件提示 + 重发（文案全硬编码，见 §6.4） |
| `/logout` | `apps/web/app/logout/page.tsx:9-22` | **Client** | 副作用页：`signOut()`→清搜索历史→`/` |
| `/invite/[token]` | `apps/web/app/invite/[token]/page.tsx:6-25` | RSC | `InviteAcceptForm` |

> 8 个鉴权页共用同一版式：`flex min-h-screen items-center justify-center bg-background px-4 py-12 sm:px-6 lg:px-8` + `max-w-md space-y-8`（如 `apps/web/app/signin/page.tsx:13-14`、`apps/web/app/signup/page.tsx:28-29`）。**这是天然可抽取的 AuthShell**，目前 8 份重复。

### 2.3 Dashboard 区（`/dashboard/*`）

| 路由 | 文件 | 用途 / 数据来源 |
| --- | --- | --- |
| layout（含 `@modal` 槽） | `apps/web/app/dashboard/layout.tsx:25-122` | RSC 守卫：无会话 `redirect("/")`（`:32-35`）；并行取 `api.lists.list()` + `api.users.settings()`（`:37-40`）；`UNAUTHORIZED/NOT_FOUND` → `/logout`（`:42-52`）；注入 `SidebarLayout` + 侧栏 + `@modal`（`:103-119`） |
| `/dashboard/bookmarks` | `apps/web/app/dashboard/bookmarks/page.tsx:4-9` | 首页信息流，`query={{archived:false}}` + 编辑器卡 |
| `/dashboard/archive` | `apps/web/app/dashboard/archive/page.tsx:25-33` | 归档列表，标题**硬编码** `🗄️ Archive`（`:17`） |
| `/dashboard/favourites` | `apps/web/app/dashboard/favourites/page.tsx:13-24` | 收藏列表，标题**硬编码** `⭐️ Favourites`（`:18`） |
| `/dashboard/highlights` | `apps/web/app/dashboard/highlights/page.tsx:15-29` | RSC 直连 `api.highlights.getAll({})`（`:18`） |
| `/dashboard/search` | `apps/web/app/dashboard/search/page.tsx:10-53` | **Client**；`useBookmarkSearch()` 无限查询 + `Suspense` |
| `/dashboard/tags` | `apps/web/app/dashboard/tags/page.tsx:13-15` | `AllTagsView`，页面本身只是壳 |
| `/dashboard/tags/[tagId]` | `apps/web/app/dashboard/tags/[tagId]/page.tsx:25-61` | RSC 直连 `api.tags.get` + 读 `?includeArchived`（`:46-49`） |
| `/dashboard/lists` | `apps/web/app/dashboard/lists/page.tsx:9-44` | RSC 并发 `lists.list()` + `users.bookmarkCounts()`（`:12-15`） |
| `/dashboard/lists/[listId]` | `apps/web/app/dashboard/lists/[listId]/page.tsx:27-68` | RSC 直连；按 `userRole` 决定是否显示编辑器卡（`:54`、`:64`） |
| `/dashboard/feeds/[feedId]` | `apps/web/app/dashboard/feeds/[feedId]/page.tsx:6-29` | RSC 直连 `api.feeds.get`，`showEditorCard:false` |
| `/dashboard/cleanups` | `apps/web/app/dashboard/cleanups/page.tsx:6-24` | 重复标签合并入口 |
| `/dashboard/preview/[bookmarkId]` | `apps/web/app/dashboard/preview/[bookmarkId]/page.tsx:6-28` | **独立全页**预览（直接刷新/分享链接的落点），高度用 `calc(100dvh - theme(spacing.16) …)`（`:25`） |
| `@modal/(.)preview/[bookmarkId]` | `apps/web/app/dashboard/@modal/(.)preview/[bookmarkId]/page.tsx:14-47` | **拦截路由**：同一个组件以 `Dialog` 形式弹出，`onOpenChange(false)` → `router.back()`（`:22-27`），`DialogContent` 覆写为 `h-[90%] max-w-[90%]`（`:36-39`） |
| `@modal/[...catchAll]` | `apps/web/app/dashboard/@modal/[...catchAll]/page.tsx:1-3` | 返回 `null`（兜底，避免硬导航时 404） |
| `@modal/default` | `apps/web/app/dashboard/@modal/default.tsx:1-3` | 返回 `null` |
| `error` | `apps/web/app/dashboard/error.tsx:5-7` | Client 错误边界 → `ErrorFallback` |
| `not-found` | `apps/web/app/dashboard/not-found.tsx:7-45` | 全硬编码英文 + `bg-slate-50`（`:9`、`:21`） |

### 2.4 Settings 区（`/settings/*`）——14 个页面 + 4 个子 layout

| 路由 | 文件 | 备注 |
| --- | --- | --- |
| layout | `apps/web/app/settings/layout.tsx:114-149` | 会话守卫 + `Sidebar`/`MobileSidebar`；导航项由 `settingsSidebarItems(t)` 生成（`:30-112`），**按 serverConfig 条件渲染**订阅（`:53-61`）与 AI（`:62-70`） |
| `/settings` | `apps/web/app/settings/page.tsx:3-6` | 重定向 `/settings/info` |
| `/settings/info` | `apps/web/app/settings/info/page.tsx:19-31` | 6 张卡片：头像/资料/改密/选项/阅读器/删号 |
| `/settings/stats` | `apps/web/app/settings/stats/page.tsx:1-603`（Client） | 用量统计，色彩最杂乱处之一（hardcoded palette 命中多） |
| `/settings/subscription` | `apps/web/app/settings/subscription/page.tsx:18-34` | 未配置 Stripe/RevenueCat 则回 `/settings`（`:19-24`） |
| `/settings/ai` | `apps/web/app/settings/ai/page.tsx:13-15` | `AISettings` 全量客户端组件 |
| `/settings/feeds` | `apps/web/app/settings/feeds/page.tsx:13-15` | RSS 订阅 |
| `/settings/backups` | `apps/web/app/settings/backups/page.tsx:7-16` | **唯一**用 `useTranslation`（client）的 settings 页 |
| `/settings/import` | `apps/web/app/settings/import/page.tsx:13-15` | 迁移/导入导出 |
| `/settings/import/[sessionId]` | `apps/web/app/settings/import/[sessionId]/page.tsx:13-19` | 导入会话详情 |
| `/settings/api-keys` | `apps/web/app/settings/api-keys/page.tsx:16-28` | 服务端读 role 传 `isAdmin`（`:19-20`） |
| `/settings/broken-links` | `apps/web/app/settings/broken-links/page.tsx:1-560`（Client） | 失效链接治理，表格 + 批量重试 |
| `/settings/webhooks` | `apps/web/app/settings/webhooks/page.tsx:13-15` | Webhook CRUD |
| `/settings/rules` | `apps/web/app/settings/rules/page.tsx:19-84`（Client） | 规则引擎编辑器；新建时**硬编码**规则默认文案（`:36-37`） |
| `/settings/assets` | `apps/web/app/settings/assets/page.tsx:1-183` | 资源管理 |
| 子 layout ×4 | `apps/web/app/settings/{assets,broken-links,rules,stats}/layout.tsx` | 仅承担 `generateMetadata`（如 `apps/web/app/settings/assets/layout.tsx:4-10`），是「按段设置浏览器标题」的绕行方案 |

### 2.5 Admin 区（`/admin/*`）——5 个页面

| 路由 | 文件 | 备注 |
| --- | --- | --- |
| layout | `apps/web/app/admin/layout.tsx:45-65` | `session.user.role !== "admin"` → `/`（`:51-53`）；`AdminNotices` + 侧栏 |
| `/admin` | `apps/web/app/admin/page.tsx:3-6` | 重定向 `/admin/overview` |
| `/admin/overview` | `apps/web/app/admin/overview/page.tsx:14-20` | `BasicStats` + `ServiceConnections` |
| `/admin/users` | `apps/web/app/admin/users/page.tsx:19-38` | **唯一使用 server-side 预取 + HydrationBoundary 的页面**（`:20-28`） |
| `/admin/background_jobs` | `apps/web/app/admin/background_jobs/page.tsx:13-15` | 队列运维 |
| `/admin/admin_tools` | `apps/web/app/admin/admin_tools/page.tsx:13-18` | 书签调试器 |

### 2.6 Reader / Public / API

| 路由 | 文件 | 类型 | 备注 |
| --- | --- | --- | --- |
| `/reader/[bookmarkId]` | `apps/web/app/reader/[bookmarkId]/page.tsx:21-189` | **Client** | 整页阅读器：`useQuery` 取 highlights + bookmark（`:25-34`）；顶部 sticky 工具条（`:57-82`）；右侧高亮抽屉（`:150-186`） |
| reader layout | `apps/web/app/reader/layout.tsx:10-38` | RSC | 会话守卫 + `UserSettingsContextProvider` + `ReaderSettingsProvider` |
| `/public/lists/[listId]` | `apps/web/app/public/lists/[listId]/page.tsx:40-83` | RSC | 匿名可读；`generateMetadata` 走 `publicBookmarks.getPublicListMetadata`（`:9-38`） |
| public layout | `apps/web/app/public/layout.tsx:1-10` | RSC | `bg-panel` 全高容器，无导航 |
| public not-found | `apps/web/app/public/lists/[listId]/not-found.tsx` | — | 独立 404（`bg-slate-100`、`text-gray-*`） |
| `GET / POST /api/auth/[...all]` | `apps/web/app/api/auth/[...all]/route.tsx:1-7` | Route Handler | better-auth 挂载 |
| 全量 REST `/api/*` | `apps/web/app/api/[[...route]]/route.ts:21-28` | Route Handler | Hono 单入口，`basePath("/api")`，导出 GET/POST/PATCH/DELETE/OPTIONS/PUT |
| `GET /api/bookmarks/export` | `apps/web/app/api/bookmarks/export/route.tsx:22-112` | Route Handler | 支持 `json` / `netscape`；`force-dynamic`（`:22`） |
| `.well-known/api-catalog` | `apps/web/app/.well-known/api-catalog/route.ts:4-6` | Route Handler | 硬编码 docs 与 OpenAPI 原始地址 |
| `.well-known/change-password` | `apps/web/app/.well-known/change-password/route.ts` | Route Handler | 标准跳转 |
| `.well-known/security.txt` | `apps/web/app/.well-known/security.txt/route.ts:11` | Route Handler | 硬编码 `security@karakeep.com` |
| `manifest.webmanifest` | `apps/web/app/manifest.ts:3-60` | — | PWA 清单 |

### 2.7 `@modal` 并行路由的完整链路（读代码得出，非猜测）

1. 用户在网格里点卡片 → 前端导航到 `/dashboard/preview/<id>`。
2. Next 命中拦截路由 `@modal/(.)preview/[bookmarkId]`，**URL 变成 `/dashboard/preview/<id>`，但页面不卸载**，改为渲染 `Dialog`（`apps/web/app/dashboard/@modal/(.)preview/[bookmarkId]/page.tsx:30-46`）。
3. 关闭：`onOpenChange(false)` → `setOpen(false)` + `router.back()`（`:22-27`）。
4. 直接打开/刷新该 URL → 走非拦截的 `apps/web/app/dashboard/preview/[bookmarkId]/page.tsx`，渲染同一 `BookmarkPreview` 组件但撑满全屏（`:24-27`）。
5. `@modal` 槽本身在 `dashboard/layout.tsx` 的 `SidebarLayout` 中被插入到 `<main>` 内部（`apps/web/components/shared/sidebar/SidebarLayout.tsx:35`），因此弹层天生在滚动容器里。

> 重构风险：`@modal` 槽和 `/dashboard/preview` 双份入口**必须同步改造**，否则「点开是弹层、刷新是全页」两套布局会视觉不一致。

---

## 3. 数据流与状态管理

### 3.1 三种数据通道并存

**通道 A：Server Component 直连 tRPC caller（主流）**

```ts
// apps/web/server/api/client.ts:66-68
const createCaller = createCallerFactory(appRouter);
export const api = createCaller(createContext);
```

- 该 caller 在服务端进程内直接调用 router，**不经过 HTTP**，无网络开销、无需鉴权头（上下文来自 `getServerAuthSession()`，`apps/web/server/api/client.ts:41-64`）。
- 扫描统计：`await api.` 出现 **14** 次，分布在 **9** 个文件：
  `app/dashboard/{feeds/[feedId],highlights,lists/[listId],preview/[bookmarkId],tags/[tagId]}/page.tsx`、`app/public/lists/[listId]/page.tsx`、`components/dashboard/bookmarks/Bookmarks.tsx`、`components/settings/{ApiKeySettings,UserDetails}.tsx`。
- 典型用法：`Bookmarks` 服务端组件先取首屏（`apps/web/components/dashboard/bookmarks/Bookmarks.tsx:26-28`），再把结果当 `initialData` 传给客户端无限查询（`apps/web/components/dashboard/bookmarks/UpdatableBookmarksGrid.tsx:41-48`）。

**通道 B：`serverTrpc` 预取 + `HydrationBoundary`（仅 1 处）**

```ts
// apps/web/server/api/trpc.ts:8-23
export const getQueryClient = cache(() => new QueryClient({...staleTime: 60s}));
export const serverTrpc = createTRPCOptionsProxy({ ctx: () => createContext(), router: appRouter, queryClient: getQueryClient });
```

- 唯一消费者是 `apps/web/app/admin/users/page.tsx:20-28`：并发 `prefetchQuery` 三个 query，然后 `dehydrate` 注入。
- 其余页面**没有**采用这个模式——即「服务端预取 + 客户端接管」只覆盖了 1 个页面，是全站可优化点，但也是重构时**唯一需要小心的水合路径**。

**通道 C：客户端 `useTRPC()` + TanStack Query（主力）**

```ts
// apps/web/lib/providers.tsx:72-88
createTRPCClient<AppRouter>({ links: [loggerLink(...), httpBatchLink({ url: "/api/trpc", transformer: superjson })] })
```

量化（本快照全量扫描 `apps/web` 337 个 ts/tsx）：

| 模式 | 次数 |
| --- | --- |
| `useTRPC()` | 81 |
| `queryOptions(` | 61 |
| `mutationOptions(` | 58 |
| `useQuery(` | 55 |
| `useMutation(` | 64 |
| `useInfiniteQuery(` | 7 |
| `infiniteQueryOptions(` | 7 |
| `useSuspenseQuery` | 5 |
| 旧式 `api.xxx.useQuery()`（tRPC v10 风格） | **0** |
| `useSWR` | **0** |
| 原生 `fetch(`（业务层） | 5 |

> 结论：**已完全迁移到 tRPC v11 + TanStack Query 的 options 工厂风格**，没有 SWR、没有遗留 hook 形态。改造成本低。

### 3.2 QueryClient / Provider 装配

`apps/web/lib/providers.tsx:53-114` 单点装配，嵌套顺序（由外到内）：

`ClientConfigProvider` → `UserLocalSettingsCtx` → `SessionProvider` → `QueryClientProvider` → `TRPCProvider` → `CustomI18nextProvider` → `ThemeProvider` → `ThemeColorSync` + `TooltipProvider`。

- QueryClient：`staleTime: 60 * 1000`，浏览器侧用模块级单例避免 Suspense 期间重建（`apps/web/lib/providers.tsx:25-51`）。
- `TRPC_MAX_URL_LENGTH_INTERNAL` 限制批处理 URL 长度（`apps/web/lib/providers.tsx:83`）。
- 根布局同时挂了 `ReactQueryDevtools`（`apps/web/app/layout.tsx:90`）与 `Toaster`（`apps/web/app/layout.tsx:92`）。

### 3.3 缓存失效策略（跨端共享）

`packages/shared-react/hooks/query-invalidation.ts:27-77` 实现了一个**去抖 250ms、最长等待 3s** 的失效合并器，避免批量操作时 N 次失效风暴。每个 mutation hook 都按需组合 `pathFilter()` / `queryFilter()`（例：`packages/shared-react/hooks/bookmarks.ts:185-217` 更新标签后同时失效 bookmark 详情、tag 详情、bookmark 列表、infinite 列表、tags 列表、lists 统计）。

> 品牌重构若改变数据结构（例如把 `tags` 换成 `collections`），这里的路径过滤器全部要跟着改。

### 3.4 状态管理：zustand（5 个 store）+ React Context

| Store | 职责 | 证据 |
| --- | --- | --- |
| `useBulkActionsStore` | 批量选择/可见书签/列表上下文 | `apps/web/lib/bulkActions.ts:28-106` |
| `useSortOrderStore` | 排序（默认 `desc`） | `apps/web/lib/store/useSortOrderStore.ts` |
| `useKeyboardNavigationStore` | 键盘焦点索引/快捷键弹窗 | `apps/web/lib/store/useKeyboardNavigationStore.ts` |
| `useInBookmarkGridStore` | 是否在网格内（驱动 Header 工具条显隐） | `apps/web/lib/store/useInBookmarkGridStore.ts` |
| `useInSearchPageStore` | 是否在搜索页 | `apps/web/lib/store/useInSearchPageStore.ts` |
| `useProblemReportStore` | 反馈弹窗开关 | `apps/web/lib/store/useProblemReportStore.ts` |

Context 类状态：
- `UserLocalSettingsCtx`（布局/语言/列数/显示项，`apps/web/lib/userLocalSettings/bookmarksLayout.tsx:11-21`）
- `UserSettingsContext`（服务端用户设置，`apps/web/lib/userSettings.tsx:9-45`，内部仍走 `useQuery` 且 `initialData`）
- `SessionOverridesContext`（阅读器实时预览，`apps/web/lib/readerSettings.tsx:45-80`）

**持久化双轨**：
- 展示偏好写 **cookie**，通过 Server Action 读改写（`apps/web/lib/userLocalSettings/userLocalSettings.ts:12-32`，`maxAge: 34560000`）。
- 阅读器偏好写 **localStorage**，键名 `karakeep-reader-settings`（`apps/web/lib/readerSettings.tsx:20`、`:32-35`）——**这是品牌名泄漏到存储键的例子**，改名会静默丢用户设置。

### 3.5 `nuqs`

仅装配了 Adapter（`apps/web/app/layout.tsx:83-84`），**业务层未使用 `useQueryState`**（全量扫描无命中）。搜索状态是手写 URLSearchParams（`apps/web/lib/hooks/bookmark-search.ts:22-32`）。属于"已装未用"的依赖。

---

## 4. 组件体系与复用边界

### 4.1 数量统计（`apps/web/components` 下共 **221** 个文件）

| 目录 | 文件数 | 说明 |
| --- | --- | --- |
| `ui/` | **47** | shadcn 基底 + 自研（含 `ui/markdown/` 4 个） |
| `dashboard/` | **107** | 业务组件 |
| `settings/` | 24 | 设置页组件 |
| `admin/` | 14 | 管理后台 |
| `shared/sidebar/` | 7 | 侧栏骨架 |
| `signin/` | 6 | 登录表单组 |
| `wrapped/` | 4 | 年度总结 |
| `utils/` | 3 | `BookmarkSavedToast` / `ValidAccountCheck` / `useShowArchived` |
| `public/` | 2 | 公开列表 |
| `invite/` `signup/` `subscription/` | 各 1 | — |
| 根级 | 4 | `DemoModeBanner` / `KarakeepIcon` / `theme-color-sync` / `theme-provider` |

`dashboard/` 内部再分：`bookmarks` 32、`preview` 22、`lists` 15、`tags` 12、`rules` 5、`search` 4、`header` 2、`sidebar` 2、`highlights` 2、`feeds` 1、`cleanups` 1。

### 4.2 `ui/` 清单（47）

`action-button`、`action-confirming-dialog`、`alert`、`avatar`、`back-button`、`badge`、`button`、`calendar`、`card`、`collapsible`、`command`、`copy-button`、`dialog`、`dropdown-menu`、`field`、`file-picker-button`、`form`、`formatted-date`、`full-page-spinner`、`info-tooltip`、`input`、`kbd`、`label`、`multiple-choice-dialog`、`popover`、`progress`、`radio-group`、`relative-time`、`scroll-area`、`select`、`separator`、`skeleton`、`slider`、`sonner`、`spinner`、`switch`、`table`、`tabs`、`textarea`、`toast`、`toggle`、`tooltip`、`user-avatar`、`markdown/{markdown-editor, markdown-readonly, theme, plugins/toolbar-plugin}`。

其中 **Radix 底座 18 个**，直接依赖清单见 `apps/web/package.json:39-56`：avatar、collapsible、dialog、dropdown-menu、label、progress、radio-group、scroll-area、select、separator、slider、slot、switch、tabs、toast、toggle、tooltip、visually-hidden。`@radix-ui/react-popover` 不在 web 依赖里，而由共享包提供（`packages/shared-react/package.json:10`），web 的 `components/ui/popover.tsx` 是转发壳。

### 4.3 `packages/shared-react`（web ↔ mobile 共享层）——只有 6 个组件文件

| 文件 | 用途 | 谁在用 |
| --- | --- | --- |
| `packages/shared-react/components/ui/button.tsx` | **全站唯一 Button 实现**（cva 变体 + 尺寸） | web 直接转发（见下）/ mobile |
| `packages/shared-react/components/ui/popover.tsx` | Popover 三件套 | web 转发 |
| `packages/shared-react/components/ui/textarea.tsx` | Textarea | web 转发 |
| `packages/shared-react/components/BookmarkHtmlHighlighter.tsx` | 划词高亮 + 高亮气泡表单（474 行） | web reader + mobile |
| `packages/shared-react/components/ScrollProgressTracker.tsx` | 阅读进度条/位置恢复 | web reader + mobile |
| `packages/shared-react/components/highlights.ts` | 高亮色表（Tailwind 类名映射） | 上两者 |

**复用边界的真实形状**：web 的 `components/ui/{button,popover,textarea}.tsx` 只是**再导出 + 加 web 专属包装**，例如：

```tsx
// apps/web/components/ui/button.tsx:13-17
export { Button, buttonVariants, type ButtonProps } from "@karakeep/shared-react/components/ui/button";
```

并额外提供 `ButtonWithTooltip`（`apps/web/components/ui/button.tsx:19-36`）、`ActionButton`（`apps/web/components/ui/action-button.tsx:20-41`，含 demoMode 禁用与 loading 替换）。

> **重构要点**：改 Button 的视觉，等于同时改 Web 与移动端（`packages/shared-react/components/ui/button.tsx:7-44` 是唯一定义处）。这是最高杠杆、也最容易失控的单点。

另有 21 个 hooks 与 3 个 provider/context 在 shared-react（`hooks/{assets,bookmarks,highlights,lists,rules,tags,users,query-invalidation,reader-settings,reading-progress,search-history,use-debounce}.ts`、`hooks/{bookmark-grid,bookmark-list}-context.tsx`、`providers/{client-config,trpc}-provider.tsx`、`trpc.ts`），但 **hooks 全量共享、组件几乎不共享**——即业务 UI 是 web 独占的。

### 4.4 重复实现（重构时可合并的候选）

1. **`cn()` 两份**：`apps/web/lib/utils.ts:5-7` 与 `packages/shared-react/lib/utils.ts:5-7` 完全相同（clsx + tailwind-merge）。
2. **Button/Textarea/Popover 的"再导出壳"**：web 侧 3 个文件只为加 tooltip/转发，`align` 后可以直接在 shared-react 内做。
3. **两套图片卡片**：`LinkCard` / `TextCard` / `AssetCard` / `UnknownCard` 各自实现图区与布局，再套 `BookmarkLayoutAdaptingCard`，4 种 layout（masonry/grid/list/compact）在 `BookmarksGrid` 里靠 `bookmarkLayoutSwitch` 分支（`apps/web/components/dashboard/bookmarks/BookmarksGrid.tsx:245-266`）。
4. **`console.log` 级别的死代码**：`apps/web/components/dashboard/header/ProfileOptions.tsx:112` 使用了 `border-new-gray-200`，该 token 在 `tooling/tailwind/*` 中不存在 → 该 class 永远不生效（Tailwind 会忽略未定义工具类）。

---

## 5. 设计系统现状

### 5.1 颜色 token（全部 HSL，位于 `tooling/tailwind/globals.css`）

| token | 亮色 | 暗色 | 证据 |
| --- | --- | --- | --- |
| `--background` | `0 0% 100%` (纯白) | `0 0% 1.2%` (近纯黑) | `tooling/tailwind/globals.css:7`、`:41` |
| `--foreground` | `222.2 84% 4.9%` | `0 0% 96%` | `:8`、`:42` |
| `--panel` | `210 40% 96.1%` | `0 0% 3.9%` | `:10`、`:44` |
| `--card` | `0 0% 100%` | `0 0% 7%` | `:12`、`:46` |
| `--popover` | `0 0% 100%` | `0 0% 8.5%` | `:15`、`:49` |
| `--primary` | `222.2 47.4% 11.2%`（slate-900） | `223 87% 57%`（蓝） | `:18`、`:52` |
| `--secondary` | `210 40% 96.1%` | `0 0% 10.5%` | `:21`、`:55` |
| `--muted` / `--muted-foreground` | `210 40% 96.1%` / `215.4 16.3% 46.9%` | `0 0% 10%` / `0 0% 54%` | `:24-25`、`:58-59` |
| `--accent` | `210 40% 96.1%`（浅灰） | `0 0% 11%` | `:27`、`:61` |
| `--destructive` | `357.2 100% 45.3%` | `358.7 100% 69.6%` | `:30`、`:64` |
| `--border` / `--input` / `--ring` | `214.3 31.8% 91.4%` / 同 / `215 20.2% 65.1%` | `0 0% 10.5%` / `0 0% 14.5%` / `223 87% 57%` | `:33-35`、`:67-69` |

**结构性缺陷（对品牌重构最要命）**：`--primary` 在亮色是「近黑」（slate-900），暗色是「亮蓝」。这意味着**同一个按钮在明暗两种模式下是两种完全不同的品牌色**。任何品牌主色落地都必须同时改 `:18` 与 `:52`，不能只改一处。

**跨端 token 语义漂移**：移动端有自己的一套（`apps/mobile/globals.css:7-25`），且用的是 **`rgb()` 空格语法而非 `hsl()`**：
- 移动端 `--primary: 0 123 255`（蓝），`--accent: 255 40 84`（红粉）——而 Web 的 `accent` 是浅灰。
- 移动端缺少 `--panel` 与 `--radius`（`apps/mobile/globals.css` 全文无）。
- 移动端用 `@media (prefers-color-scheme: dark)`（`apps/mobile/globals.css:28`），Web 用 `.dark` class —— **两套暗色机制**。

因此 shared-react 里写 `bg-accent` 的组件，在 Web 是浅灰、在移动端是红粉。做统一品牌色时必须同时改两处，否则跨端不一致。

### 5.2 字体

- 全站只有一种字体：`Inter`（`apps/web/app/layout.tsx:2`、`:18-21`），仅 `subsets: ["latin"]`，`fallback: ["sans-serif"]`，通过 `body className={inter.className}` 应用（`apps/web/app/layout.tsx:82`）。
- **没有 CSS 变量导出**（未使用 `variable:`），所以 Tailwind 的 `font-sans` 里没有任何自定义字体族；`tooling/tailwind/base.ts` 未扩展 `fontFamily`。
- **中文界面会退回系统字体**：`subsets` 只有 latin，中文走 fallback。对「灵感仓」中文化目标而言，**必须引入中文字体（含 `display: swap`、子集体积控制）**，这是新增层工作。
- 阅读器字体是**内联 style 而非 class**（`apps/web/app/reader/[bookmarkId]/page.tsx:111-114`、`:132-135`），取值来自 `READER_FONT_FAMILIES`（`packages/shared/types/readers.ts:10-14`：`ui-serif, Georgia…` / `ui-sans-serif, system-ui…` / `ui-monospace…`）。改品牌字体需要动这个映射（跨端共享）。
- 编辑器有独立的 Markdown 主题：`apps/web/components/ui/markdown/theme.ts`。

### 5.3 圆角 / 阴影 / 间距 / 字号

- **圆角**：唯一 token 是 `--radius: 0.5rem`（`tooling/tailwind/globals.css:37`），派生出 `rounded-lg|md|sm`（`tooling/tailwind/web.ts:12-16`）。**但实际使用高度离散**：`rounded-md` 85 次、`rounded-full` 68、`rounded-lg` 59、`rounded-sm` 11、`rounded-xl` 9、`rounded-2xl` 3、`rounded-none` 4。`rounded-xl/2xl` **完全绕过 token**（如 `apps/web/components/dashboard/bookmarks/EditorCard.tsx:193` 的 `rounded-xl`、`apps/web/app/dashboard/@modal/(.)preview/[bookmarkId]/page.tsx:37` 的 `rounded-xl`、`apps/web/components/ui/dialog.tsx:42` 的 `rounded-xl`）。→ **视觉上圆角不统一是现状事实**。
- **阴影**：未扩展 `boxShadow`。使用 `shadow-sm` 26 次、`shadow-lg` 8、`shadow-md` 8、`shadow-none` 6、`shadow-2xl` 2。弹层里出现 `shadow-2xl`（`apps/web/components/ui/dialog.tsx:42`）、批量操作条也是 `shadow-2xl`（`apps/web/components/dashboard/BulkBookmarksAction.tsx:373`）。
- **间距**：零自定义，全部原生 Tailwind 4px 栅格。没有 `--space-*` 语义层。
- **字号**：零自定义 `fontSize`。实际使用 `text-sm` 248 次、`text-xs` 109、`text-2xl` 36、`text-lg` 27、`text-base` 13、`text-xl` 10、`text-3xl` 10、`text-4xl` 2。→ 存在大量 **`text-2xl` 直接当页面标题**的写法（如 `apps/web/app/dashboard/archive/page.tsx:17`、`apps/web/app/dashboard/highlights/page.tsx:23`、`apps/web/app/dashboard/cleanups/page.tsx:12`），没有 `h1/h2` 语义化字号阶梯。
- **任意值类**：`[..]` 形式的任意值共 **387** 处（如 `h-[calc(100dvh-theme(spacing.16)...)]`、`w-[--radix-popover-trigger-width]`、`text-[10px]`）。→ 说明现有 token 表达力不足，重构时应收敛成语义 token。

### 5.4 硬编码调色板（品牌重构的最大雷区）

扫描 `apps/web` + `packages/shared-react` 的 tsx/ts：

- **338 处**直接使用 Tailwind 调色板色值（`bg-*/text-*/border-*/from-*/to-*` + 色阶），分布在 **56 个文件**。
- 色相分布：`gray` 79、`slate` 61、`blue` 55、`green` 37、`red` 33、`amber` 27、`yellow` 15、`purple` 11、`rose` 6、`orange` 6、`emerald` 4、`teal` 2、`sky` 1、`violet` 1。
- Top 文件：`apps/web/components/wrapped/WrappedContent.tsx` 51、`apps/web/components/settings/ImportSessionDetail.tsx` 36、`apps/web/components/admin/BackgroundJobs.tsx` 29、`apps/web/components/admin/ServiceConnections.tsx` 27、`apps/web/components/settings/ImportSessionCard.tsx` 24、`apps/web/app/settings/broken-links/page.tsx` 23。

典型就地证据：
- AI 标签紫：`apps/web/components/dashboard/bookmarks/TagsEditor.tsx:328` → `bg-purple-500 text-white`
- 页面底色：`apps/web/app/dashboard/not-found.tsx:9` → `bg-slate-50`
- 高亮基色：`packages/shared-react/components/highlights.ts:4-7` → `bg-{red,green,blue,yellow}-200`
- 高亮文字色：`packages/shared-react/components/BookmarkHtmlHighlighter.tsx:441` → `text-gray-600`（暗色下几乎不可读）
- demo 横幅：`apps/web/components/DemoModeBanner.tsx:3` → `bg-yellow-100 … text-black`
- 邮箱蓝色图标：`apps/web/app/check-email/page.tsx:89` → `text-blue-600`

> 这些颜色**不随主题切换、不随品牌色变**。品牌重构必须逐条替换为语义 token（`--ai`、`--highlight-*`、`--surface-sunken` 等）。

### 5.5 暗色模式实现

- 机制：`next-themes` → `attribute="class"`，`defaultTheme="system"`，`enableSystem`，`disableTransitionOnChange`（`apps/web/lib/providers.tsx:97-102`）。
- Tailwind 侧声明 `darkMode: ["class"]`（`tooling/tailwind/base.ts:4`），与 `next-themes` 对齐。
- 双色令牌通过 `.dark { … }` 覆盖（`tooling/tailwind/globals.css:40-70`）。
- 根部 `suppressHydrationWarning`（`apps/web/app/layout.tsx:80`），并有 `ThemeColorSync` 在挂载后改写 `meta[name="theme-color"]`（`apps/web/components/theme-color-sync.tsx:21-34`），静态回退值写死在 `apps/web/lib/themeColors.ts:8-11`（`light: #ffffff`、`dark: #030303`）。
- 副作用：`ThemeProvider` 传了 `scriptProps={{ "data-cfasync": "false" }}`（`apps/web/components/theme-provider.tsx:9`）。
- **RTL**：`dir` 由 `lang === "ar"` 决定（`apps/web/app/layout.tsx:75`、`:79`），即 RTL 支持是"语言驱动"而非独立开关。

### 5.6 设计系统结论（一句话）

> 现有系统是「**shadcn slate 默认主题 + 一份 hsl 变量表 + 大量就地硬编码**」的半成品：令牌只覆盖了颜色与派生圆角，字号/间距/阴影/字体族/语义层级全部缺失，且 338 处硬编码色 + 387 处任意值把视觉一致性彻底击穿。**品牌重构无法靠"换 12 个 CSS 变量"完成**，必须重建 token 层（含语义层）并批量清洗硬编码。

---

## 6. 国际化改造可行性

### 6.1 技术形态

| 项 | 事实 | 证据 |
| --- | --- | --- |
| 库 | `i18next` + `react-i18next`（非 next-intl、非 next-i18next） | `apps/web/lib/i18n/client.ts:3-9` |
| 命名空间 | **只有一个**：`translation` | `apps/web/lib/i18n/settings.ts:5`、`apps/web/lib/i18n/locales/en/` 下仅 `translation.json` |
| 语言文件数 | **34 个目录**（每个含一个 `translation.json`） | `apps/web/lib/i18n/locales/` |
| 可用语言 | `supportedLangs` 取自 `langNameMappings`，**32 个** | `packages/shared/langs.ts:1-33` |
| 缺口 | `fa`（波斯语）、`he`（希伯来语）**有翻译文件但不在 supportedLangs** → 永不加载 | `apps/web/lib/i18n/locales/fa/`、`/he/` vs `packages/shared/langs.ts` |
| 语言来源 | 服务端 cookie（`UserLocalSettings.lang`），不是 URL 段 | `apps/web/lib/userLocalSettings/userLocalSettings.ts:12-17`、`apps/web/lib/i18n/server.ts:27` |
| 加载方式 | `i18next-resources-to-backend` 动态 `import()` 每个语言一个 JSON | `apps/web/lib/i18n/client.ts:17-22`、`apps/web/lib/i18n/server.ts:11-19` |
| 类型安全 | 通过 `CustomTypeOptions` 把 `en/translation.json` 变成键联合类型 | `apps/web/@types/i18next.d.ts:1-13` |
| cookie 名 | `i18next` | `apps/web/lib/i18n/settings.ts:6` |

### 6.2 键规模

`en/translation.json` 共 **1002 个叶子键**，22 个一级分组：

| 分组 | 叶子数 | 分组 | 叶子数 |
| --- | --- | --- | --- |
| `settings` | 440 | `search` | 62 |
| `admin` | 108 | `actions` | 53 |
| `lists` | 81 | `common` | 40 |
| `editor` | 36 | `wrapped` | 33 |
| `tags` | 28 | `problem_report` | 22 |
| `keyboard_shortcuts` | 19 | `toasts` | 18 |
| `preview` | 15 | `view_options` | 10 |
| `bookmark_editor` / `options` / `version` | 8 / 8 / 8 | `layouts` | 4 |
| `dialogs` / `cleanups` | 3 / 3 | `banners` | 2 |
| `highlights` | 1 | — | — |

复数形式已用 i18next 的 `_one` / `_other`（如 `apps/web/lib/i18n/locales/en/translation.json` 中 `lists.items_count_one` / `_other`），插值用 `{{count}}` / `{{value}}` / `{{date}}`。

### 6.3 服务端/客户端双实例

- 服务端：每次调用 `createInstance()` + `getFixedT()`（`apps/web/lib/i18n/server.ts:9-35`）。命名空间函数叫 `useTranslation`，但**实际是 async 函数、不是 hook**——因此 `generateMetadata` 与 RSC 都能用，且每个文件都带 `// oxlint-disable-next-line rules-of-hooks`（例：`apps/web/app/dashboard/tags/page.tsx:6`、`apps/web/app/settings/info/page.tsx:12`）。
- 客户端：模块级单例 + `changeLanguage`（`apps/web/lib/i18n/client.ts:15-31`、`apps/web/lib/i18n/provider.tsx:11-13`）。

### 6.4 覆盖度实况（这是改造难度的真正决定因素）

对 `apps/web` 328 个 ts/tsx 做扫描：

- **200 个文件完全没有 i18n 引用**。其中真正需要翻译的 ~90 个（其余是 store/hook/util/纯布局）。
- 启发式命中「疑似硬编码英文 UI 文案」**156 处，分布在 63 个文件**。Top：
  `AISettings.tsx` 11、`EditBookmarkDialog.tsx` 8、`SignUpForm.tsx` 7、`BackgroundJobs.tsx` 6、`AttachmentBox.tsx` 6、`ReaderView.tsx` 6、`WebhookSettings.tsx` 6、`DeleteAccount.tsx` 5、`FeedSettings.tsx` 5。

**未走 i18n 的硬编码文案实证**（全部来自阅读）：

| 位置 | 文案 |
| --- | --- |
| `apps/web/components/dashboard/bookmarks/BookmarksGrid.tsx:276` | `Load More` |
| `apps/web/components/dashboard/BulkBookmarksAction.tsx:48-49` | `Something went wrong` / `There was a problem with your request.` |
| `apps/web/components/dashboard/BulkBookmarksAction.tsx:96` | `` `${links.length} bookmarks will be …` `` |
| `apps/web/components/dashboard/BulkBookmarksAction.tsx:110` | `Copying is only available over https` |
| `apps/web/components/dashboard/BulkBookmarksAction.tsx:324-325` | `Delete Bookmarks` / `Are you sure you want to delete these bookmarks?` |
| `apps/web/components/dashboard/BulkBookmarksAction.tsx:340-346` | `Remove Bookmarks from List` / `Are you sure you want to remove … bookmarks from this list?` |
| `apps/web/components/dashboard/bookmarks/BookmarkTagsEditor.tsx:18` | `Tags has been updated!` |
| `apps/web/components/dashboard/bookmarks/TagsEditor.tsx:162` | `` `Create "${trimmedInputValue}"` `` |
| `apps/web/components/dashboard/bookmarks/TagsEditor.tsx:351` | `Remove {tag.name}` |
| `apps/web/components/dashboard/bookmarks/TagsEditor.tsx:397` | `No tags found.` |
| `apps/web/components/dashboard/preview/ReaderView.tsx:73` | `Highlight has been created!` |
| `apps/web/components/dashboard/preview/BookmarkPreview.tsx:92` | `By {author}` |
| `apps/web/components/dashboard/preview/BookmarkPreview.tsx:117` | `Published {fromNow}` |
| `apps/web/components/dashboard/preview/BookmarkPreview.tsx:196` | `Untitled` |
| `apps/web/components/dashboard/bookmarks/SummarizeBookmarkArea.tsx:66,77,89` | `bg-gray-200 … text-gray-600` 相关的 `aria-label="Collapse"/"Expand"` |
| `apps/web/components/ui/dialog.tsx:51` | `<span className="sr-only">Close</span>` |
| `apps/web/components/DemoModeBanner.tsx:4` | `Demo mode is on. All modifications are disabled.` |
| `apps/web/app/dashboard/archive/page.tsx:17,19` | `🗄️ Archive` / `Archived bookmarks won't appear in the homepage` |
| `apps/web/app/dashboard/favourites/page.tsx:18` | `⭐️ Favourites` |
| `apps/web/app/dashboard/not-found.tsx:21,24,33,39` | `Page Not Found` / `Go Back` / `Go Home` |
| `apps/web/app/reader/[bookmarkId]/page.tsx:63,120,123,155,158` | `Reader View` / `By {author}` / **`8 min`（写死的阅读时长）** / `Highlights` / `saved` |
| `apps/web/app/check-email/page.tsx:37,42,62,65,82,89,124,132` | 全页英文 |
| `apps/web/app/verify-email/page.tsx:47,55` | `Your email has been successfully verified! …` |
| `apps/web/components/signin/SignInForm.tsx:30` | `Sign in to your Karakeep account` |
| `apps/web/components/signup/SignUpForm.tsx:97` | `Join Karakeep to start organizing your bookmarks` |
| `apps/web/components/admin/CreateInviteDialog.tsx:82` | `Send an invitation to a new user to join Karakeep. …` |
| `apps/web/components/invite/InviteAcceptForm.tsx:173` | `Complete your account setup to join Karakeep` |
| `apps/web/components/shared/sidebar/SidebarVersion.tsx:73` | `` `Karakeep v${displayVersion}` `` |
| `apps/web/app/settings/rules/page.tsx:36-37` | `New Rule` / `Description of the new rule`（新建规则的默认值） |

**`packages/shared-react` 完全没有 i18n**：`BookmarkHtmlHighlighter.tsx` 里 `Color`（`:89`）、`Note`（`:110`）、`Add a note (optional)...`（`:112`）、`Save`（`:121`）、`Cancel`（`:124`）、`Delete highlight`（`:132`）。这些字符串在 Web 与移动端**同时出现且无法通过翻译文件修改**。

### 6.5 改造可行性判定

**结论：i18n 架构可直接复用，文案替换成本中等偏低；真正的成本在「先把漏翻译补齐」。**

- ✅ 优势：单命名空间 + 单 JSON + 类型化键 + cookie 驱动 → **换品牌文案只需重写 `en/translation.json`（1002 键）+ 补 63 个文件的硬编码**，无需改动任何加载逻辑、路由或 Provider。
- ✅ 新增中文语言包：`apps/web/lib/i18n/locales/zh/translation.json` 已存在（50KB），需要按新文案全量重写。
- ⚠️ 阻力 1：**34 份语言文件**。若只做中文/英文双语，建议**删到 2 个目录**并同步收缩 `supportedLangs`（`packages/shared/langs.ts:1-33`），否则每改一个键要面对 34 份陈旧文件。当前 `zh`(50KB) 与 `en`(54KB) 体量接近，但 `ar`(71KB)/`el`(81KB)/`ru`(76KB) 明显更大，说明多语言翻译已长期漂移。
- ⚠️ 阻力 2：**品牌名词分布在非翻译资源里**——`metadata`（`apps/web/app/layout.tsx:24-25`、`:47`）、`manifest`（`apps/web/app/manifest.ts:5-6`）、路由 handler（`.well-known`）、以及 12 处页面 `title` 模板 `` `${…} | Karakeep` ``（见 §9.1）。这些**不在 translation.json 内**，必须单独处理。
- ⚠️ 阻力 3：**共享层文案**（`BookmarkHtmlHighlighter`）需要先给 shared-react 引入 i18n 或改为 `props` 注入。

---

## 7. 关键交互流程拆解（代码实证）

### 7.1 新增收藏（EditorCard）

固定入口：网格首位插入 `<StyledBookmarkCard><EditorCard /></StyledBookmarkCard>`（`apps/web/components/dashboard/bookmarks/BookmarksGrid.tsx:234-238`）。

流程：
1. **聚焦**：全局快捷键 `mod+e` 聚焦输入框（`apps/web/components/dashboard/bookmarks/EditorCard.tsx:53-55`），卡片右上角提示 `Kbd ⌘ + E`（`:200`）。
2. **提交判定**：`onSubmit` 取 trim 后文本 → `tryToImportUrls` 尝试按行 `new URL()` 解析（`:114-123`、`:78-97`）：
   - 单 URL → `mutate({ type: LINK, url })`（`:92`）
   - 多 URL → 弹出 `MultipleChoiceDialog`，让用户在「作为文本导入」与「拆成多个书签」间二选一（`:251-295`、`:96`）
   - 解析失败 → `mutate({ type: TEXT, text })`（`:121`）
3. **图片粘贴**：`onPaste` 拦截剪贴板里的 `image/*`，逐张 `uploadAsset(blob)`（`:140-155`、`:227-232`）。
4. **回车语义**：`Cmd/Ctrl+Enter` 提交（`:223-225`）；裸 `Enter` 若当前行是 `- [ ] ` 则自动续写 todo（`:162-184`）。
5. **提交后**：`useCreateBookmarkWithPostHook`（`packages/shared-react/hooks/bookmarks.ts:51-72`）→ 失效 `getBookmarks` / `searchBookmarks` → 再执行 `useBookmarkPostCreationHook`（`packages/shared-react/hooks/bookmarks.ts:222-265`），**按当前网格上下文自动补全**：若在看收藏页就顺手 favourite、在列表页就加入该列表、在标签页就挂该标签。这是"上下文感知创建"，产品逻辑很巧，重构时**不要误删**。
6. **已存在**：`resp.alreadyExists` 时用 `BookmarkSavedToast`（`apps/web/components/dashboard/bookmarks/EditorCard.tsx:59-64`）。
7. **布局自适应高度**：`cardHeight` 由 layout 决定（`:133-138`），`list` 布局下 textarea 自增高至半屏（`:99-112`）。

> 品牌重构触点：`rounded-xl`/`bg-card`/`p-4`（`:193`）、`border-none` 的 textarea（`:209`）、按钮文案 `` `${t("actions.save")} (⌘ + Enter)` ``（`:247`）。

### 7.2 详情弹层（`@modal`）

链路见 §2.7。组件内部（`apps/web/components/dashboard/preview/BookmarkPreview.tsx`）：
- 数据：`useQuery(api.bookmarks.getBookmark.queryOptions(...))`，`refetchInterval` 由 `getBookmarkRefreshInterval(data)` 决定（`:141-157`）——**爬取中自动轮询，完成后停止**。
- 双布局：`lg` 以上「左内容 + 右详情栏（w-1/3，可折叠）」（`:237-258`）；`lg` 以下改为 Tabs（content/details，`:260-287`）。
- 详情栏编排（`:192-232`）：标题 → 原文链接 → 元数据（作者/出版社/发布日期）→ AI 摘要 → 标签编辑 → 笔记编辑 → 附件 → 高亮 → 操作栏（仅 owner）。
- 权限：`isOwner = session?.user?.id === bookmark.userId`（`:164`），非 owner 全部 `readOnly`。
- 内容分流：`LINK` → `LinkContentSection`；`TEXT` → `TextContentSection`；`ASSET` → `AssetContentSection`（`:167-180`）；爬取中 → `ContentLoading`（`:186-190`）。

### 7.3 搜索页与筛选器

- **状态即 URL**：`?q=` + `?mode=`（`apps/web/lib/hooks/bookmark-search.ts:22-32`），`mode` 缺省 `fts`。
- **拦截路由防重置**：只有在 `/dashboard/search` 路径下才刷新「最近一次搜索」引用，避免打开预览弹层时 query 被清空（`apps/web/lib/hooks/bookmark-search.ts:42-47`）。
- **查询语言**：`parseSearchQuery`（来自 `@karakeep/shared/searchQueryParser`）解析 `is:fav`、`has:tags`、`url:…` 等限定符（`apps/web/lib/hooks/bookmark-search.ts:50-53`）。纯限定符无正文时强制退回 `fts`（`:61-68`）。
- **三模式切换**：`fts` / `hybrid` / `semantic`，后两者标 `experimental`（`apps/web/components/dashboard/search/SearchModeSelector.tsx:19-40`、`:110-114`）；仅当 `semanticSearchEnabled` 时渲染（`apps/web/components/dashboard/search/SearchInput.tsx:235-240`）。
- **排序联动**：`fts` 用 store 里的 sortOrder，语义/混合模式强制 `relevance`（`apps/web/lib/hooks/bookmark-search.ts:139-141`）。
- **自动补全**：`cmdk` + `useSearchAutocomplete`，含历史（localStorage，`useSearchHistory`）与限定符分组（`apps/web/components/dashboard/search/SearchInput.tsx:242-322`）。
- **IME 处理**：中文输入法 composition 期间不触发搜索，`compositionend` 才触发（`:117-129`）——**中文化适配已经在位**。
- **"保存搜索"**：当输入是纯限定符（`result === "full"` 且 `text` 为空）时，右上角出现保存按钮 → 打开 `EditListModal` 预填 `type: "smart"`（`:200-224`、`:206-213`）。

### 7.4 标签管理

- **就地编辑**：`TagsEditor`（438 行）实现「胶囊 + 输入框 + 弹层建议 + 乐观更新」。乐观态用 `temp-` 前缀临时 id（`apps/web/components/dashboard/bookmarks/TagsEditor.tsx:52-62`、`:192-204`），服务端返回后按 name 对齐替换（`:76-96`）。
- **创建语义**：输入的词若不精确匹配已有标签，则把 `Create "xxx"` 置顶（`:157-168`）。
- **删除语义**：退格删除最后一个标签（`:236-249`）；胶囊上的 × 删除（`:337-353`）。
- **AI/Human 区分**：`attachedBy === "ai"` 用紫色 + Sparkles 图标（`:327-336`）——**品牌化必改点**。
- **页面级管理**：`/dashboard/tags` → `AllTagsView`；标签详情 `TagHeader` + 书签流；重命名/合并/删除分别有独立 Modal（`RenameTagModal`/`MergeTagModal`/`DeleteTagConfirmationDialog`）；拖拽合并由 `lib/drag-and-drop.ts` + i18n 文案 `tags.drag_and_drop_merging` 支撑。
- **清理**：`/dashboard/cleanups` → `TagDuplicationDetection`（相似标签建议合并）。

### 7.5 批量操作

- 选择态：`useBulkActionsStore`（`apps/web/lib/bulkActions.ts:28`），网格挂载时把可见书签灌入 store（`apps/web/components/dashboard/bookmarks/BookmarksGrid.tsx:198-206`）。
- 入口：网格内才显示工具条（`apps/web/components/dashboard/GlobalActions.tsx:13-18`）。
- 工具条：`createPortal` 到 `document.body`，`fixed` 底部居中，`rounded-2xl shadow-2xl backdrop-blur-sm` + `animate-in`（`apps/web/components/dashboard/BulkBookmarksAction.tsx:368-382`）。
- 动作清单（`:162-266`）：复制链接、移出列表（仅 manual 列表 + editor/owner）、加入列表、编辑标签、收藏、归档、离线归档、刷新、删除、全选/取消、退出。移动端只显示图标（`:277-292`）。
- 键盘：`useBookmarkKeyboardNavigation`（20KB 实现，含方向键、`x` 选择、`f` 收藏、`e` 归档、`d` 删除，见 i18n `keyboard_shortcuts.*`）+ 帮助弹窗 `KeyboardShortcutsDialog`。
- 路由切换自动退出批量态（`:86-91`）。

### 7.6 阅读器与高亮

- 入口两处：整页 `/reader/[bookmarkId]`（`apps/web/app/reader/[bookmarkId]/page.tsx`）与预览内 `ReaderView`（`apps/web/components/dashboard/preview/ReaderView.tsx`）。
- 内容源：`api.bookmarks.getBookmark({ includeContent: true })` → 只取 `content.htmlContent`（`apps/web/components/dashboard/preview/ReaderView.tsx:40-53`）。
- 高亮渲染：`BookmarkHTMLHighlighter` 用 `dangerouslySetInnerHTML` 注入 HTML（`packages/shared-react/components/BookmarkHtmlHighlighter.tsx:451-461`），再按 `startOffset/endOffset` 拆分文本节点包 `span`（`:423-447`）。
- **锚点容错**：偏移只是提示，真正定位用 `createHighlightResolver` + 存储的 `text/prefix/suffix` 重新对齐（`:220-229`），后端表结构也有对应字段（迁移 `packages/db/drizzle/0096_add_highlight_text_anchors.sql`）。
- 交互：`pointerup` 取选区 → `position: fixed` 虚拟锚点弹气泡（避免被 `transform` 祖先影响，`:59-71`）；已有高亮点击可改色/改备注/删除（`:301-326`）。
- 阅读进度：`ScrollProgressTracker` + `useReadingProgress`，含"继续阅读"横幅（`apps/web/components/dashboard/preview/ReadingProgressBanner.tsx`）。
- 阅读设置：`ReaderSettingsPopover` 提供字号/行高/字族，支持「仅本设备（localStorage）」与「所有设备（服务端）」双写（`apps/web/lib/readerSettings.tsx:106-151`）。
- **注意**：整页阅读器把阅读时长写死为 `8 min`（`apps/web/app/reader/[bookmarkId]/page.tsx:123`），不是计算值。

### 7.7 AI 能力现状：**没有聊天界面**

- `apps/web` 与 `packages/shared-react` 全量 grep 无 chat 组件、无 chat 页面、无 chat hook。
- tRPC 的 19 个 router 里没有 chat（`packages/trpc/routers/_app.ts:21-41`）。
- **但数据库有 chat 表**：`chatSessions` / `chatMessages`（`packages/db/drizzle/0088_add_chat_tables.sql:1-22`）——**schema 已就位、UI 与 API 未实现**。
- 现有 AI 触点只有两个：
  1. 摘要：`SummarizeBookmarkArea`（`apps/web/components/dashboard/bookmarks/SummarizeBookmarkArea.tsx`），按钮文案 `actions.summarize_with_ai`（`:147`），展开后带"重新摘要/删除摘要"（`:59-96`）。
  2. 设置：`/settings/ai` → `AISettings`（自动打标、自动摘要、打标规则、prompt 预览、策展标签）。
- `components.json` 里注册的 `@ai-elements` registry（`apps/web/components.json:19`）说明**曾计划引入对话组件但未落地**。

> 对品牌重构的含义：**"AI 聊天界面"属于新增层，不是改造层**。可以按全新信息架构设计，但要注意 DB 已有 `chatSessions/chatMessages`，新 UI 应直接对接这两张表以省一次迁移。

---

## 8. 测试现状与 Playwright 基线

### 8.1 单测（Vitest）

| 项 | 事实 | 证据 |
| --- | --- | --- |
| 配置 | 极简：`vite-tsconfig-paths` + alias `@/* → ./*`，**无 environment、无 setupFiles** | `apps/web/vitest.config.ts:7-13` |
| runner 命令 | `"test": "vitest"` → **watch 模式**，CI 里靠 turbo 调用会挂住 | `apps/web/package.json:15` |
| 测试文件 | 7 个 | 见下表 |
| 用例总数 | **56** | `test()` 22+4+3、`it()` 8+7+8+4 |

| 文件 | 用例 | 覆盖 |
| --- | --- | --- |
| `apps/web/server/auth.test.ts` | 22（5 describe） | better-auth 路由白名单、OAuth、限流、回调跳转 |
| `apps/web/lib/bulkActions.test.ts` | 8 | 选择/全选/上下文 |
| `apps/web/lib/hooks/useBookmarkKeyboardNavigation.test.ts` | 8 | 键盘导航矩阵 |
| `apps/web/lib/hooks/useBookmarkBulkActions.test.ts` | 7 | 批量 mutation 编排 |
| `apps/web/lib/date-format.test.ts` | 4 | 语言归一到 Intl |
| `apps/web/app/.well-known/well-known.test.ts` | 4 | `.well-known` 输出 |
| `apps/web/lib/problemReport/recentErrors.test.ts` | 3 | 最近错误采集 |

**覆盖盲区（明确）**：没有任何组件渲染测试（`@testing-library/react` 在 devDeps `apps/web/package.json:108` 但**零使用**）、没有设计系统/token 快照测试、没有 i18n 键完整性测试（`fill-translations` skill 与 `.agents/skills` 存在但不在 CI）。→ **品牌重构缺少"视觉回归"护栏**，这是必须在新增层补的。

### 8.2 E2E（Vitest + Playwright Chromium，不是 `@playwright/test` runner）

| 项 | 事实 | 证据 |
| --- | --- | --- |
| runner | `vitest run`，Playwright 只作为**库**在 fixture 里 `chromium.launch()` | `packages/e2e_tests/package.json:13`、`packages/e2e_tests/utils/browser.ts:9-26` |
| 全局准备 | `startContainers.ts` + `seed.ts` | `packages/e2e_tests/vitest.config.ts:13` |
| include | `tests/**/*.test.ts` | `packages/e2e_tests/vitest.config.ts:15` |
| 超时 | 单测 60s，teardown 30s，worker 类用 `WORKER_TEST_TIMEOUT = 180000` | `packages/e2e_tests/vitest.config.ts:14-16`、`packages/e2e_tests/utils/browser.ts:109` |
| 视口 / locale | `1440×900` + `en-US` + `baseURL http://localhost:${port}` | `packages/e2e_tests/utils/browser.ts:15-19` |
| 脚本 | `test` / `test:web` / `test:no-build` | `packages/e2e_tests/package.json:13-16` |
| 依赖镜像 | `docker-compose.yml` + nginx（`setup/nginx/default.conf`）+ aimock（`setup/aimock/inference.json`） | 目录结构 |

**用例规模：31 个文件 / 175 个 `it()`**

| 分组 | 文件数 | 用例 | 说明 |
| --- | --- | --- | --- |
| `tests/web/` | 11 | **52** | 真实浏览器 UI 流程 |
| `tests/api/` | 10 | 64 | REST/tRPC 契约 |
| `tests/assetdb/` | 3 | 44 | 存储后端一致性 |
| `tests/workers/` | 6 | 14 | 爬取/推理/导入/视频 |
| `tests/docker/` | 1 | 1 | 权限 |

`tests/web/` 明细：`admin` 7、`lists` 8、`bookmark-actions` 8、`settings` 6、`tags` 6、`bookmarks` 4、`search` 4、`settings-data` 3、`highlights` 3、`previews` 2、`signup` 1。

### 8.3 Playwright 基线的脆弱性（对品牌重构是**硬阻塞**）

现有用例用**英文可访问名 / placeholder / 文案**做选择器，且有多处**精确匹配**：

```ts
// packages/e2e_tests/utils/browser.ts:77-79
await page.getByLabel("Email", { exact: true }).fill(email);
await page.getByLabel("Password", { exact: true }).fill(password);
await page.getByRole("button", { name: "Sign In", exact: true }).click();

// packages/e2e_tests/utils/browser.ts:100-104
return page.getByRole("textbox", {
  name: "Paste a link, write a note or drop an image…", exact: true });
```

```ts
// packages/e2e_tests/tests/web/bookmarks.test.ts:35
await page.getByRole("button", { name: /^Save/ }).click();
// :55-56
const search = page.getByPlaceholder("Search titles, text, URLs, and tags…");
// :69 / :71
bookmark.getByRole("button", { name: "Favorite", exact: true })
bookmark.getByRole("button", { name: "Unfavorite", exact: true })
// :88 / :94
page.getByRole("link", { name: "Archive", exact: true })
bookmark.getByRole("button", { name: "Un-archive", exact: true })
// :103
page.getByRole("dialog", { name: "Delete Bookmark?" })
```

这些字符串目前来自 `en/translation.json`（如 `editor.placeholder_v2`、`search.keyword_placeholder`、`actions.favorite`）。**一旦更换品牌文案或切换中文，52 个 web 用例会大面积失败。**

另外两个易踩的坑：
1. **流式渲染双份 DOM**：`packages/e2e_tests/utils/browser.ts:36-46` 专门等 `div[hidden][id^='S:']` 消失，否则 locator 会匹配两次。改布局时如果引入新的 Suspense 边界要复测。
2. **水合时序**：`waitForHydration` 靠 `__reactFiber$` 键探测（`packages/e2e_tests/utils/browser.ts:58-68`）。若改成 React 19 的新 API 或换渲染器，这个探针可能失效。

### 8.4 测试结论

- 单测薄到无法保护 UI；**唯一可用的行为护栏是 52 个 web e2e**，而它们恰好绑定在要改的文案上。
- 建议顺序（写入 §9 新增层）：先补 `data-testid` 层（`data-bookmark-index` 已经是好范式，见 `apps/web/components/dashboard/bookmarks/BookmarksGrid.tsx`），再改文案，最后跑 e2e。

---

## 9. 品牌重构改造清单

分层原则：**替换层**＝只换值/资源，不改结构；**新增层**＝加文件/加 token/加测试，不动现有逻辑；**重写层**＝必须改结构或推翻现有实现。

### 9.1 替换层（低风险，可按清单机械执行）

| # | 目标 | 文件:行 | 动作 |
| --- | --- | --- | --- |
| R1 | 品牌名（站点元数据） | `apps/web/app/layout.tsx:24`、`:25`、`:47` | `Karakeep` → `灵感仓 INSIGHT VAULT` / `Insight Vault` |
| R2 | 站点描述 | `apps/web/app/layout.tsx:26-27` | 重写 tagline |
| R3 | PWA 名称/描述 | `apps/web/app/manifest.ts:5-6`、`:50`、`:57` | 同步改名 + 截图 label |
| R4 | PWA 主题色 | `apps/web/app/manifest.ts:9-10`、`apps/web/lib/themeColors.ts:8-11` | 与 §5.1 新 `--background` 对齐 |
| R5 | **22 处**页面标题模板（`${t(...)} \| Karakeep`） | `apps/web/app/dashboard/{archive,favourites,highlights}/page.tsx`、`dashboard/tags/page.tsx:9`、`dashboard/tags/[tagId]/page.tsx:15`、`dashboard/lists/[listId]/page.tsx:17`、`settings/{ai,api-keys,feeds,import,import/[sessionId],info,subscription,webhooks}/page.tsx`、`settings/{assets,broken-links,rules,stats}/layout.tsx`、`admin/{overview,users,background_jobs,admin_tools}/page.tsx` | 抽成常量（建议新增 `apps/web/lib/brand.ts`），避免 22 处手改漂移 |
| R6 | 公开列表页品牌 | `apps/web/app/public/lists/[listId]/page.tsx:18`、`:21`、`:23`、`:36` | 同上 |
| R7 | Logo 组件 | `apps/web/components/KarakeepIcon.tsx:1-8` | 换 SVG 源；保持 `fill-foreground` 契约 |
| R8 | Logo 资源 | `apps/web/public/icons/{karakeep-full,karakeep-text,logo-*,logo-icon,logo-icon-dark,logo-text}.svg`/`.png`、`favicon.ico`、`blur.avif`、`screenshots/{desktop,mobile}.png` | 等尺寸替换 |
| R9 | 字标尺寸 | `apps/web/app/signin/page.tsx:16`、`signup/page.tsx:31`、`reset-password/page.tsx:24`、`forgot-password/page.tsx:16`、`invite/[token]/page.tsx:20`、`apps/web/components/dashboard/header/Header.tsx:19`、`apps/web/components/public/lists/PublicListHeader.tsx:22` | 换新 Logo 后复核准比例 |
| R10 | 外部链接（品牌站/文档/X） | `apps/web/components/dashboard/header/ProfileOptions.tsx:172`、`:182`、`:192`；`apps/web/components/dashboard/search/SearchInput.tsx:226`；`apps/web/components/dashboard/lists/EditListModal.tsx:397` | 指向新域 |
| R11 | `.well-known` 品牌信息 | `apps/web/app/.well-known/security.txt/route.ts:11`；`apps/web/app/.well-known/api-catalog/route.ts:4-6` | 换联系邮箱与 spec 地址（**注意 `well-known.test.ts:19` 会断言旧邮箱**，需同步改测试） |
| R12 | 导出文件名 | `apps/web/app/api/bookmarks/export/route.tsx:96`、`:107`；`apps/web/components/settings/ImportExport.tsx:68` | `karakeep-export-*` → 新前缀 |
| R13 | 版本水印 | `apps/web/components/shared/sidebar/SidebarVersion.tsx:73` | `Karakeep v…` |
| R14 | Wrapped 分享文案/文件名 | `apps/web/components/wrapped/ShareButton.tsx:15`、`:48`、`:49`；`WrappedContent.tsx:118`、`:382` | 品牌化 |
| R15 | 本地存储键（**谨慎**） | `apps/web/lib/readerSettings.tsx:20`、`apps/web/components/shared/sidebar/SidebarVersion.tsx:31`、`packages/shared-react/hooks/search-history.ts:6` | 改键=丢老用户偏好；建议**保留旧键读取 + 写新键** |
| R16 | 拖拽 MIME | `apps/web/lib/bookmark-drag.ts:5` | 内部协议，可保留 |
| R17 | 移动端深链 scheme | `apps/web/server/auth.ts:196`、`apps/web/server/auth.test.ts:303`、`:316` | 与移动端 `app.config.js` 同步 |
| R18 | 全量文案 | `apps/web/lib/i18n/locales/*/translation.json`（1002 键） | 重写 `en`；`zh` 全量重译；其余语言**建议直接删除**（见 §6.5） |
| R19 | AI 标签紫 | `apps/web/components/dashboard/bookmarks/TagsEditor.tsx:328` | → `bg-ai text-ai-foreground` 语义 token |
| R20 | 高亮色板 | `packages/shared-react/components/highlights.ts:4-13`；`apps/web/components/dashboard/preview/highlights.ts` | → `bg-highlight-{x}`；同步修 `BookmarkHtmlHighlighter.tsx:441` 的 `text-gray-600` |

### 9.2 新增层（只加文件/加 token，不动现有骨架）

| # | 目标 | 建议落地位置 | 说明 |
| --- | --- | --- | --- |
| N1 | **设计令牌层**（语义化） | 新 `tooling/tailwind/tokens.css` + 扩展 `tooling/tailwind/base.ts` | 在现有 12 个变量之外补：`--surface` / `--surface-raised` / `--surface-sunken`、`--brand` / `--brand-foreground` / `--brand-subtle`、`--highlight-{red,green,blue,yellow}`、`--ai`、`--success` / `--warning` / `--danger`、`--ring-offset`。**必须同时定义 `:root` 与 `.dark`** |
| N2 | **字体族与字阶** | 扩展 `tooling/tailwind/base.ts` 的 `fontFamily` / `fontSize` / `lineHeight` / `letterSpacing` | `apps/web/app/layout.tsx:18-21` 的 Inter 需增加 `variable` 并支持中文子集（或引入 `Noto Sans SC` / 自定义中文字体）。字阶建议 `display/h1/h2/h3/body/body-sm/caption/mono`，替换当前 248 处裸 `text-sm` |
| N3 | **间距与阴影标尺** | `tooling/tailwind/base.ts` | 把 `shadow-sm/lg/2xl` 收敛成 `shadow-e1/e2/e3/e4`；把散落的 `rounded-xl/2xl` 收敛成 `--radius-lg/xl` |
| N4 | **AuthShell 组件** | 新 `apps/web/components/auth/AuthShell.tsx` | 消灭 8 份 `min-h-screen … max-w-md … KarakeepLogo height={80}` 重复（`apps/web/app/signin/page.tsx:13-19` 等） |
| N5 | **Brand 常量模块** | 新 `apps/web/lib/brand.ts` | 导出 `BRAND_NAME`、`BRAND_TAGLINE`、`BRAND_DOMAIN`、`DOCS_URL`、`SOCIAL_URL`，供 R1/R5/R6/R10/R13 引用 |
| N6 | **品牌图标/插画资源** | 新 `apps/web/public/brand/` | 与现有 `public/icons/` 分离，便于灰度切换 |
| N7 | **视觉回归基线** | 新 `packages/e2e_tests/tests/web/visual/`（复用现有 `chromium.launch()` fixture） | 对 8 条关键路由截图：`/signin`、`/dashboard/bookmarks`、`/dashboard/preview/<id>`（弹层）、`/dashboard/search`、`/dashboard/tags`、`/settings/info`、`/reader/<id>`、`/public/lists/<id>`。**这是当前唯一的品牌护栏** |
| N8 | **i18n 键完整性测试** | 新 `apps/web/lib/i18n/locales.test.ts` | 断言各语言键集合与 `en` 一致；顺手删掉 `fa`/`he` 或补进 `packages/shared/langs.ts` |
| N9 | **共享层文案注入** | 扩 `packages/shared-react/components/BookmarkHtmlHighlighter.tsx` 的 props | 给 `HighlightForm` 加 `labels?: {...}`，让 Web 从 `t()` 注入，移动端传自己的 i18n |
| N10 | **`data-testid` 层** | 优先 `apps/web/components/dashboard/bookmarks/*`、`apps/web/components/ui/dialog.tsx` | 让 e2e 不再依赖英文可访问名，改文案不炸测试 |
| N11 | **AI 对话 UI（可选）** | 新 `apps/web/app/dashboard/chat/` + `packages/trpc/routers/chat.ts` | DB 表已在（`packages/db/drizzle/0088_add_chat_tables.sql`）。走 `components.json:19` 已注册的 `@ai-elements` registry |
| N12 | **`images.remotePatterns`** | `apps/web/next.config.mjs`（当前**无** `images` 键） | 若品牌图走 CDN，必须加；否则维持 `unoptimized`（8 处） |

### 9.3 重写层（必须改结构）

| # | 目标 | 文件 | 原因 |
| --- | --- | --- | --- |
| W1 | **主色语义重定义** | `tooling/tailwind/globals.css:18`、`:52` | `--primary` 亮色=近黑、暗色=亮蓝，同一按钮两套品牌色。**新品牌主色必须同时改写明暗两侧，并同步 `--ring`（`:35`/`:69`）** |
| W2 | **跨端 token 统一** | `apps/web` 的 `hsl()` vs `apps/mobile/globals.css:7-25` 的 `rgb()` | 语法不同、`accent` 语义冲突（Web 浅灰 / 移动端红粉）、移动端无 `--panel`/`--radius`。共享组件（`button/popover/textarea`）在两端的实际颜色不同 → **必须统一为同一套变量 + 同一语法** |
| W3 | **338 处硬编码色清洗** | 56 个文件，Top：`apps/web/components/wrapped/WrappedContent.tsx`(51)、`apps/web/components/settings/ImportSessionDetail.tsx`(36)、`apps/web/components/admin/BackgroundJobs.tsx`(29)、`apps/web/components/admin/ServiceConnections.tsx`(27)、`apps/web/components/settings/ImportSessionCard.tsx`(24)、`apps/web/app/settings/broken-links/page.tsx`(23) | 这些颜色不随主题/品牌变化，是视觉不一致的根因 |
| W4 | **387 处任意值类收敛** | 全仓 tsx | `[calc(100dvh-theme(spacing.16)...)]`（`apps/web/app/dashboard/preview/[bookmarkId]/page.tsx:25`）、`w-[--radix-popover-trigger-width]`、`text-[10px]` 等应替换为语义 token 或组件内常量 |
| W5 | **`Button` 变体体系重做** | `packages/shared-react/components/ui/button.tsx:7-44` | 9 个 variant（含 `destructiveOutline`/`ghostDestructive`/`border`/`none`）+ 6 个 size。品牌重构的核心组件，**改动影响 Web + 移动端**；建议重排为 `brand / neutral / danger / ghost / link` × `sm/md/lg/icon` |
| W6 | **`Dialog` 基础件重做** | `apps/web/components/ui/dialog.tsx:42` | 硬编码 `rounded-xl border bg-background p-6 shadow-2xl` + 自定义动画；弹层质感=品牌第一印象。注意 `hideCloseBtn` 是自研参数（`:31-36`），重写时保留 |
| W7 | **`BookmarkPreview` 双布局重构** | `apps/web/components/dashboard/preview/BookmarkPreview.tsx:234-288` | 右栏固定 `w-1/3`（`:253`）、移动端 Tabs 二选一（`:260-287`）。新品牌若要「单列 + 抽屉」需重写，**且必须同步 `@modal` 与 `/dashboard/preview` 两个入口** |
| W8 | **`@modal` 拦截路由与全页入口对齐** | `apps/web/app/dashboard/@modal/(.)preview/[bookmarkId]/page.tsx:36-39` + `apps/web/app/dashboard/preview/[bookmarkId]/page.tsx:25` | 两处分别硬编码 `h-[90%] max-w-[90%]` 与 `calc(100dvh-…)`，视觉必然不一致 |
| W9 | **Dashboard 外壳重构** | `apps/web/components/shared/sidebar/SidebarLayout.tsx:23-44`、`apps/web/components/dashboard/header/Header.tsx:16-29` | 当前是「sticky Header(64px) + 左栏 240/288px + `<main>` 圆角卡片浮起（`sm:mb-2 sm:me-2 sm:rounded-xl sm:border`）」。`64px` 是**跨 4 个文件的魔数**：`apps/web/components/shared/sidebar/SidebarLayout.tsx:26`（`min-h-[calc(100vh-64px)]`）、`apps/web/components/shared/sidebar/Sidebar.tsx:21`（`h-[calc(100vh-64px)]`）、`apps/web/app/dashboard/preview/[bookmarkId]/page.tsx:25`（`theme(spacing.16)`）、`apps/web/app/reader/[bookmarkId]/page.tsx:151`（`calc(100vh-3.5rem)`）→ 应改为 `--app-header-h` 单一变量 |
| W10 | **阅读器排版体系** | `apps/web/app/reader/[bookmarkId]/page.tsx:111-114`、`:132-135`；`packages/shared/types/readers.ts:10-14` | 字号/行高/字族**内联 style**，字族映射写死在共享包。品牌字体落地必须改这里，并考虑中文断行/标点 |
| W11 | **高亮渲染器** | `packages/shared-react/components/BookmarkHtmlHighlighter.tsx:439-447` | `span` 直接塞 Tailwind 类 + `text-gray-600`，且用 `dangerouslySetInnerHTML`。品牌色板 + 暗色可读性 + XSS 面都需重新设计 |
| W12 | **路由组与 URL 决策** | `apps/web/app/dashboard/`（普通目录） | 若新 IA 想改 URL（如 `/library`），必须真移动目录 + 全量改 `href` + 改 e2e 断言；**「删括号就能改前缀」不成立** |
| W13 | **鉴权页品牌化** | 8 个 `app/{signin,signup,reset-password,forgot-password,verify-email,check-email,invite/[token],logout}` | 目前 6 个是 RSC + 统一版式，2 个（verify-email/check-email）是 client 且文案硬编码（`apps/web/app/check-email/page.tsx:56-138`）。建议统一到 N4 的 AuthShell 并按新视觉重做 |
| W14 | **i18n 目录裁剪** | `apps/web/lib/i18n/locales/`（34 个）+ `packages/shared/langs.ts:1-33`（32 项） | `fa`/`he` 有文件不可达；多语言已漂移（`el` 81KB vs `zh` 50KB）。建议收敛到 `en` + `zh` |
| W15 | **测试策略重排** | `apps/web/vitest.config.ts:9-13`、`packages/e2e_tests/utils/browser.ts:77-104`、`packages/e2e_tests/tests/web/*` | `apps/web` 的 `test` 是 watch 模式（`apps/web/package.json:15`）；52 个 web e2e 绑定英文文案。重构前先落 N10（testid），重构后逐文件修选择器 |
| W16 | **`components.json` 修正** | `apps/web/components.json:8` | `css: "app/globals.css"` 指向不存在的文件 → shadcn CLI 无法工作。改成 `../../tooling/tailwind/globals.css` 或落地一个真实的 `app/globals.css` 转发层 |

### 9.4 执行顺序建议（依赖关系）

1. **N1–N3**（token 层）→ 2. **W1–W2**（主色 + 跨端统一）→ 3. **W5–W6**（Button/Dialog 基础件）→ 4. **W3–W4**（硬编码清洗，可并行）→ 5. **N5 + R1–R14**（品牌字符串与资源，纯机械）→ 6. **W9–W10**（外壳与阅读器）→ 7. **W7–W8**（弹层双入口）→ 8. **R18 + W14**（文案重写与语言裁剪）→ 9. **N7 + N10 + W15**（护栏与测试修复，可与 5–8 交错）。

> **不要先做第 8 步**：一旦文案改成中文，52 个 web e2e 立即全红，且没有 testid 兜底，会失去唯一的行为护栏。

---

## 附录 A：本次审计的量化口径

| 指标 | 值 | 采集方式 |
| --- | --- | --- |
| `apps/web` ts/tsx 文件数 | 337 | 递归遍历，排除 `node_modules`/`.next` |
| `apps/web/components` 文件数 | 221 | 同上 |
| `page.tsx` / `layout.tsx` / `route.*` | 44 / 10 / 6 | 文件名统计 |
| `useTRPC()` 调用点 | 81 | 正则计数 |
| `useQuery` / `useMutation` / `useInfiniteQuery` | 55 / 64 / 7 | 正则计数 |
| `await api.`（服务端 caller） | 14 次 / 9 文件 | 正则计数 |
| i18n 叶子键（en） | 1002 | JSON 递归 |
| locale 目录 / 可用语言 | 34 / 32 | 目录比对 `langNameMappings` |
| 无 i18n 引用文件 | 200 | 正则 `useTranslation` 或 `@/lib/i18n` |
| 疑似硬编码英文文案 | 156 处 / 63 文件 | 启发式（JSX 文本 + 常见属性） |
| 硬编码 Tailwind 调色板 | 338 处 / 56 文件 | 正则色相+色阶 |
| 任意值类 `[..]` | 387 | 正则 |
| 单测用例 | 56 | `it()`/`test()` 计数 |
| E2E 用例 | 175（31 文件），其中 web 52（11 文件） | 同上 |

## 附录 B：本次审计**没有**覆盖的部分（明确边界）

- `apps/mobile`：仅对照了 `apps/mobile/globals.css` 与 `apps/mobile/tailwind.config.js` 的 token 差异（W2 的证据），未做移动端完整审计。
- `apps/landing`（Astro 官网）：独立技术栈，不属于本次 `apps/web` 范围。
- `packages/trpc` / `packages/db`：仅作为数据流与 AI 能力证据引用（`_app.ts`、`0088_add_chat_tables.sql`），未审计。
- 运行时行为：本次为纯静态阅读，**未启动 dev server 做视觉核对**；所有"看起来怎样"的判断均来自 className 与组件结构，不含截图。
