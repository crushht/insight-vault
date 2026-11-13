# API 与认证授权审计

> 审计对象：`E:\fork\2\insight-vault`（Karakeep 完整快照，commit `fc22787`）
> 审计范围：`packages/trpc`（tRPC 层）＋ `packages/api`（Hono REST 层）＋ `packages/open-api`（规格生成）＋ `apps/web/server`（上下文与会话装配）＋ `packages/shared`（限流/配额/插件契约）
> 方法：纯只读静态审计。所有结论均标注 `path:line` 作为证据，不修改任何源码。
> 说明：本文件只写 `docs/audit/`，不触碰业务代码。

## 0. 结论摘要

| # | 结论 | 严重度 | 证据 |
|---|---|---|---|
| C1 | 双栈但非同构：REST 并不绕过 tRPC，而是用 `createCallerFactory` 在进程内调用 tRPC procedure，因此**授权逻辑只有一份**（middleware 层），REST 层只做 HTTP 形状适配 | 信息 | `packages/api/middlewares/auth.ts:9-37`、`packages/api/routes/bookmarks.ts:33` |
| C2 | 认证是「session cookie / API key」双通道，API key 优先且失败后**静默回落**到 cookie | 信息 | `apps/web/server/api/client.ts:16-38` |
| C3 | tRPC 共 **147** 个 procedure（19 个 router），权限三分：`public` 9 个、`admin` 30 个、登录用户 108 个 | 信息 | `packages/trpc/routers/_app.ts:22-42`、sec.2 全量清单 |
| C4 | REST 共 **67** 个端点（`/api/v1/*` 58 个 + 根级 9 个），**不存在 v2 前缀** | 信息 | `packages/api/index.ts:29-93`、sec.3 |
| C5 | 单用户数据路径的 `userId` 过滤是完整的；共享列表是**唯一**的跨用户读通路，且做了字段脱敏 | 通过 | `packages/trpc/models/bookmarks.ts:810-823`、`packages/trpc/models/lists.ts:411-483` |
| C6 | **越权风险 R1**：`lists.removeFromList` 不校验 bookmark 归属，编辑器协作者可把**别人**的 bookmark 从共享列表移除（跨用户写，完整性破坏，不泄露内容） | 中 | `packages/trpc/routers/lists.ts:133-157`、`packages/trpc/models/lists.ts:1211-1228` |
| C7 | 多处写操作仅按 `bookmarkId` 落库、不带 `userId` 条件，安全性完全依赖前置 middleware 顺序（纵深防御缺口） | 中 | `packages/trpc/routers/bookmarks.ts:1644-1650`、`847-850`、`771-779` |
| C8 | 邀请码 token **永不过期**（表无 `expiresAt`，`get` 硬编码 `expired: false`） | 中 | `packages/db/schema.ts:905-917`、`packages/trpc/routers/invites.ts:134-150` |
| C9 | 订阅状态**不参与每次请求的鉴权**，而是被物化进 `users.bookmarkQuota/storageQuota/browserCrawlingEnabled`，由配额服务与 worker 读取 | 信息（商业化改造关键） | `packages/trpc/lib/subscriptionEntitlements.ts:50-87` |
| C10 | 插件系统有 5 类扩展点（assetstore/search/queue/ratelimit/vectorstore），**AI provider 不在插件系统内**，走 `inference.ts` 的硬编码工厂 | 信息 | `packages/shared/plugins.ts:10-16`、`packages/shared/inference.ts:210-250` |

---

## 1. 通信架构（tRPC + REST 双栈）

### 1.1 进程内只有一个 Hono 应用

```
Next.js App Router
└── apps/web/app/api/[[...route]]/route.ts:21   new Hono().basePath("/api").use(nextAuth).route("/", @karakeep/api)
    ├── /api/health              packages/api/index.ts:86
    ├── /api/version             packages/api/index.ts:87
    ├── /api/trpc/*              packages/api/index.ts:88  → @hono/trpc-server
    ├── /api/v1/*                packages/api/index.ts:89  → 版本化 REST
    ├── /api/assets/*            packages/api/index.ts:90  → 与 /api/v1/assets 同一 router（别名）
    ├── /api/public/*            packages/api/index.ts:91  → 签名 token 公开资产
    ├── /api/metrics             packages/api/index.ts:92  → Bearer token
    └── /api/webhooks/*          packages/api/index.ts:93  → Stripe / RevenueCat
```

- 路由装配：`packages/api/index.ts:29-43`（`v1` 子应用 10 个 router）、`69-93`（根应用 8 个挂载点）。
- 每个请求先经过 `nextAuth` 中间件构造 `ctx`：`apps/web/app/api/[[...route]]/route.ts:11-19`。
- 全局中间件顺序：`logger → powered-by → (otel) → cors → registerMetrics → ctx 断言 → trpcAdapter → 路由`
  （`packages/api/index.ts:51-85`）。

### 1.2 tRPC 初始化与 context

`packages/trpc/index.ts:72-97`：

- `initTRPC.context<Context>().create({ transformer: superjson, errorFormatter })`。
- `Context` 结构（`packages/trpc/index.ts:50-57`）：`{ user, auth?, db, req: { ip } }`；`AuthedContext`（`59-66`）把 `user` 收窄为非空。
- `RequestAuth` 三态（`34-48`）：`{type:"apiKey", keyId, scopes}` / `{type:"session"}` / `{type:"internal"}` / `null`。`internal` 的注释明确说明它来自 worker 与 impersonation，且**豁免面向用户的限流**（`43-46`）。

context 的实际生产者是 `apps/web/server/api/client.ts`：

| 分支 | 触发条件 | 结果 | 证据 |
|---|---|---|---|
| API key | `Authorization: Bearer <token>` 且 `authenticateApiKey` 成功 | `auth.type = "apiKey"`，携带 `keyId` 与 `scopes` | `apps/web/server/api/client.ts:16-32` |
| 回落 | Bearer 解析/校验抛错（**catch 后静默继续**） | 继续走 cookie 分支 | `apps/web/server/api/client.ts:33-36` |
| Session | `getServerAuthSession()` 命中 | `auth.type = "session"` | `apps/web/server/api/client.ts:41-63` |
| 匿名 | 两者皆无 | `user: null`，`auth: null` | `apps/web/server/api/client.ts:52-58` |

`getServerAuthSession` 是 `cache()` 包裹的 better-auth `getSession`，并显式 `disableRefresh`（`apps/web/server/auth.ts:580-615`，特别是 `583-589`）。

### 1.3 middleware 链（tRPC）

`packages/trpc/index.ts:101-237`，自底向上：

1. `procedure`（基座，`101-130`）
   - `rejectMutationsInReadOnlyModes`：只读/降级模式下所有 mutation 抛 `FORBIDDEN`（`102-114`）。
   - 指标埋点：`apiRequestDurationSummary` / `apiRequestsTotalCounter`（`115-128`）。
   - `createTracingMiddleware()`（`130`）。
2. `publicProcedure` = `procedure` + `globalPublic` 限流 1000 req/60s（`133-139`）。
3. `authedProcedure` = `procedure` + `globalAuthed` 限流 3000 req/60s + `isAuthed` 断言 `user.id`（`141-162`）。
4. `createScopedAuthedProcedure(resource)`：仅当 `auth.type === "apiKey"` 时校验 `<resource>:read|readwrite`，session 直接放行（`187-205`）。**query 映射为 `read`，mutation 映射为 `readwrite`**（`193`）。
5. `sessionProcedure` = `authedProcedure` + `rejectApiKeyAuth()`（`207`，实现 `173-185`）——即「必须是浏览器会话，不允许 API key」。
6. `createAdminScopedProcedure(resource)` = `authedProcedure` + `admin:<resource>:<access>` scope 校验 + `user.role === "admin"` 强制（`209-237`，角色检查在 `230-236`）。

错误格式（`packages/trpc/index.ts:74-96`）：

- 生产环境把 `INTERNAL_SERVER_ERROR` 的 message 统一替换为 `Internal server error`（`83-87`）。
- `BAD_REQUEST` 且 `cause instanceof ZodError` 时附 `data.zodError = z.flattenError(cause)`（`88-93`）。
- 每次错误自增 `apiErrorsTotalCounter{type,path,code}`（`76-80`）。

REST 侧错误同样收敛：`packages/api/middlewares/trpcAdapter.ts:16-28` 把 `TRPCError` 转成 `HTTPException`，并在生产环境隐藏内部错误 message，同时过滤掉 Hono 状态码联合类型里不存在的 `499`（`10-14`）。

### 1.4 REST 复用 tRPC（关键架构事实）

REST 路由不做业务逻辑，只做「HTTP 形状 ↔ procedure 入参」的翻译：

```ts
// packages/api/middlewares/auth.ts:9-37
c.set("api", createCaller(c.get("ctx")));   // 进程内 caller
...
// packages/api/routes/bookmarks.ts:56-63
const bookmark = await c.var.api.bookmarks.createBookmark({ ...body, source: body.source || "api" });
```

推论：

- **REST 与 tRPC 共享同一套授权**（`ensureBookmarkOwnership`、`createScopedAuthedProcedure`、admin 角色检查），不存在“绕过 REST 就打不到 middleware”的旁路。
- 但 REST 的**输入校验**是 Hono `zValidator` 的二次校验（`@hono/zod-validator`，如 `packages/api/routes/bookmarks.ts:38-47`），与 procedure 的 `input()` 可能漂移（例如 REST `GET /bookmarks` 自行拼装 query schema，`packages/api/utils/types.ts:8-31`）。

### 1.5 版本语义：没有 v2

检索全仓 `/v2` 只命中与 REST 无关的三处：

- API key 前缀 `ak1`/`ak2`：`packages/trpc/auth.ts:14-15`。
- 搜索游标判别联合 `ver: z.literal(1)`：`packages/shared/types/bookmarks.ts:353-358`。
- RevenueCat 上游 API：`packages/trpc/lib/revenueCat.ts:214`。

因此 REST 实际只有 **`/api/v1` + 根级别名**；`/api/assets/*` 与 `/api/v1/assets/*` 指向同一 router（`packages/api/index.ts:39` 与 `90`），属于历史别名而非版本演进。

---

## 2. tRPC Router 全量清单

> 权限级别定义：
> - `public` = `publicProcedure`（无认证）
> - `user` = `authedProcedure` / `createScopedAuthedProcedure` / `sessionProcedure`（需登录；API key 需对应 scope，标注在 scope 列）
> - `admin` = `createAdminScopedProcedure`（需 `role=admin` 且 `admin:*` scope）
> 「行号」为 procedure 声明行（`packages/trpc/routers/<file>.ts`）。

### 2.1 总览

| Router | 文件 | procedure 数 | 默认 procedure 构造器 | scope 资源 |
|---|---|---|---|---|
| bookmarks | `bookmarks.ts` | 16 | `createScopedAuthedProcedure("bookmarks")` `:85` | `bookmarks` |
| lists | `lists.ts` | 22 | `createScopedAuthedProcedure("lists")` `:24` | `lists` |
| tags | `tags.ts` | 7 | `createScopedAuthedProcedure("tags")` `:23` | `tags` |
| admin | `admin.ts` | 23 | `createAdminScopedProcedure(...)` `:53-56` | `admin:*` |
| subscriptions | `subscriptions.ts` | 10 | `createScopedAuthedProcedure("subscriptions")` `:323-324` | `subscriptions` |
| importSessions | `importSessions.ts` | 9 | `createScopedAuthedProcedure("importSessions")` `:21-23` | `importSessions` |
| highlights | `highlights.ts` | 7 | `createScopedAuthedProcedure("highlights")` `:19` | `highlights` |
| apiKeys | `apiKeys.ts` | 6 | 混用 `sessionProcedure`/`authedProcedure`/`publicProcedure` `:37-211` | — |
| invites | `invites.ts` | 6 | `createAdminScopedProcedure("users")` + `publicProcedure` `:18` | `admin:users` |
| feeds | `feeds.ts` | 6 | `createScopedAuthedProcedure("feeds")` `:16` | `feeds` |
| users | `users.ts` | 11 | `usersProcedure` + `adminUsersProcedure` `:23-24` | `users` / `admin:users` |
| webhooks | `webhooks.ts` | 4 | `createScopedAuthedProcedure("webhooks")` `:24` | `webhooks` |
| rules | `rules.ts` | 4 | `createScopedAuthedProcedure("rules")` `:17` | `rules` |
| prompts | `prompts.ts` | 4 | `createScopedAuthedProcedure("prompts")` `:14` | `prompts` |
| backups | `backups.ts` | 4 | `createScopedAuthedProcedure("backups")` `:12` | `backups` |
| assets | `assets.ts` | 4 | `createScopedAuthedProcedure("assets")` `:12` | `assets` |
| publicBookmarks | `publicBookmarks.ts` | 2 | `publicProcedure` `:16,38` | — |
| problemReports | `problemReports.ts` | 1 | `sessionProcedure` `:13` | — |
| config | `config.ts` | 1 | `publicProcedure` `:7` | — |
| **合计** | | **147** | | |

根 router 聚合：`packages/trpc/routers/_app.ts:22-42`，19 个键。

### 2.2 bookmarks（16）

| procedure | 类型 | 权限 | 额外中间件／备注 | 行号 |
|---|---|---|---|---|
| `createBookmark` | mutation | user | `bookmarks.createBookmark` 限流 30/60s；`createEventLogMiddleware("bookmark.create")`；配额检查 | `242-249` |
| `updateBookmark` | mutation | user | `ensureBookmarkOwnership` | `570-758` |
| `updateBookmarkText` | mutation | user | 已标记 DEPRECATED；`ensureBookmarkOwnership` | `762-809` |
| `deleteBookmark` | mutation | user | eventLog；`ensureBookmarkOwnership` | `811-819` |
| `recrawlBookmark` | mutation | user | 限流 200/30min；`ensureBookmarkOwnership` | `820-851` |
| `preserveVideo` | mutation | user | 限流 50/30min；`ensureBookmarkOwnership`；需 `crawler.downloadVideoOnDemand` | `852-894` |
| `updateReadingProgress` | mutation | user | **`ensureBookmarkAccess`**（非 ownership） | `895-935` |
| `getReadingProgress` | query | user | `ensureBookmarkAccess` | `936-955` |
| `getBookmark` | query | user | `ensureBookmarkAccess`；`bookmarks.queried` 事件 | `956-970` |
| `getBookmarkReadableContent` | query | user | `ensureBookmarkAccess` | `971-985` |
| `searchBookmarks` | query | user | 语义限流 300/60s（仅 `searchMode != fts`） | `986-1223` |
| `checkUrl` | query | user | 无中间件，SQL 内带 `userId` | `1224-1271` |
| `getBookmarks` | query | user | 无中间件，`loadMulti` 内带 `userId` | `1272-1282` |
| `updateTags` | mutation | user | `ensureBookmarkOwnership` | `1284-1485` |
| `getBrokenLinks` | query | user | SQL 内带 `userId` | `1486-1539` |
| `summarizeBookmark` | mutation | user | 限流 100/30min；`createEventLogMiddleware`；`ensureBookmarkOwnership` | `1540-1669` |

**入参 zod 字段（bookmark 完整 CRUD 与搜索）**

- 创建 `createBookmark` ← `zNewBookmarkRequestSchema`（`packages/trpc/routers/bookmarks.ts:251`；定义 `packages/shared/types/bookmarks.ts:242-279`）
  - 公共部分：`title`（≤`MAX_BOOKMARK_TITLE_LENGTH`，nullish）、`archived?`、`favourited?`、`note?`、`summary?`、`createdAt?`（`z.coerce.date()`）、`crawlPriority?`（`"low"|"normal"`）、`importSessionId?`（deprecated）、`source?`（`zBookmarkSourceSchema`）
  - 判别联合 `type`（`260-278`）：
    - `"link"`：`url`（`zBookmarkUrlSchema`）、`precrawledArchiveId?`
    - `"text"`：`text`、`sourceUrl?`
    - `"asset"`：`assetType`（`"image"|"pdf"`）、`assetId`、`fileName?`、`sourceUrl?`
  - 输出 = `zBookmarkSchema` 合并 `{ alreadyExists: boolean }`（`252-258`）
- 更新 `updateBookmark` ← `zUpdateBookmarksRequestSchema`（`571`；定义 `packages/shared/types/bookmarks.ts:311-335`）
  - `bookmarkId`、`archived?`、`favourited?`、`summary?`（nullish）、`note?`、`title?`（nullish）、`createdAt?`
  - 链接专属：`url?`、`description?`、`author?`、`publisher?`、`datePublished?`、`dateModified?`（均 nullish/可选）
  - 文本专属：`text?`；资产专属：`assetContent?`
- 列表查询 `getBookmarks` ← `zGetBookmarksRequestSchema`（`1274`；定义 `packages/shared/types/bookmarks.ts:287-301`）
  - `archived?`、`favourited?`、`tagId?`、`listId?`、`rssFeedId?`、`limit`（1..`MAX_NUM_BOOKMARKS_PER_PAGE`=100）、`cursor`（`zCursorV2`）、`useCursorV2?`（历史兼容，未使用，见 `295-298` 注释）、`sortOrder`（默认 `"desc"`，排除 `relevance`）、`includeContent`（默认 `false`）
  - `ids` 被刻意排除在公开 schema 之外，仅服务端可传（`packages/trpc/models/bookmarks.ts:431-433` 注释）
- 搜索 `searchBookmarks` ← `zSearchBookmarksRequestSchema`（`989`；定义 `packages/shared/types/bookmarks.ts:361-368`）
  - `text`（必填）、`limit?`（1..100）、`cursor?`（`{ver:1, offset}`，`353-358`）、`sortOrder?`（默认 `"relevance"`）、`searchMode?`（`"fts"|"semantic"|"hybrid"`，默认 `"fts"`，`359-360`）、`includeContent?`（默认 `false`）
  - 输出：`{ bookmarks: zBookmarkSchema[], nextCursor: zSearchBookmarksCursor|null }`（`991-996`）
- 标签增量 `updateTags`：`{ bookmarkId, attach: zManipulatedTagSchema[], detach: zManipulatedTagSchema[] }`，输出 `{attached, detached}`（`1284-1297`）；`zManipulatedTagSchema` = `{tagId?, tagName?, attachedBy?}` 且要求二者至少一个（`packages/shared/types/bookmarks.ts:341-351`）

**搜索过程内部（`986-1223`）**

- 关键词解析 `parseSearchQuery(input.text)`（`1004`），支持 matcher 语法（`is:fav` 等）。
- 过滤条件强制注入 `{type:"eq", field:"userId", value: ctx.user.id}`（`1023-1029`）。
- 模式门禁：非 `fts` 需 `experimentalFeatures.semanticSearch && embedding.enableAutoIndexing`，否则 `BAD_REQUEST`（`1006-1015`）。
- `fts`：`client.search({query, filter, sort: createdAt, limit, offset})`（`1041-1056`）。
- `semantic`：`limit = offset + limit + 1` 后切片（`1152-1156`），阈值 `SEMANTIC_SCORE_THRESHOLD = 0.6`（`93`）。
- `hybrid`：FTS 与向量各自取 `HYBRID_CANDIDATES_PER_SOURCE`（=100，`86`）后 `reciprocalRankFusion` 融合（`1160-1179`），语义失败自动降级到 FTS（`1069-1078`、`1168-1170`）。
- 游标 `{ver:1, offset}` 为**偏移量游标**（`1216-1221`），非稳定键游标；数据高频写入时语义搜索页间可能重复/遗漏（属实现取舍，非漏洞）。

### 2.3 lists（22）

| procedure | 类型 | 权限 | 中间件链 | 行号 |
|---|---|---|---|---|
| `create` | mutation | user | eventLog | `77-85` |
| `edit` | mutation | user | viewer→**owner** | `86-102` |
| `merge` | mutation | user | 内部 `ensureCanManage()` ×2 | `103-116` |
| `delete` | mutation | user | viewer→owner | `117-132` |
| `addToList` | mutation | user | viewer→editor→**bookmarkOwnership** | `133-145` |
| `removeFromList` | mutation | user | viewer→editor（**无 bookmarkOwnership**） | `146-157` |
| `get` | query | user | viewer | `158-168` |
| `list` | query | user | — | `169-178` |
| `getListsOfBookmark` | query | user | **bookmarkOwnership** | `179-190` |
| `stats` | query | user | — | `191-200` |
| `regenRssToken` | mutation | user | viewer→owner | `203-219` |
| `clearRssToken` | mutation | user | viewer→owner | `220-230` |
| `getRssToken` | query | user | viewer→owner | `231-246` |
| `addCollaborator` | mutation | user | 限流 20/15min→viewer→owner | `249-278` |
| `removeCollaborator` | mutation | user | viewer→owner | `279-290` |
| `updateCollaboratorRole` | mutation | user | viewer→owner | `291-303` |
| `getCollaborators` | query | user | viewer | `304-341` |
| `acceptInvitation` | mutation | user | `ensureInvitationAccess` | `343-352` |
| `declineInvitation` | mutation | user | `ensureInvitationAccess` | `354-363` |
| `revokeInvitation` | mutation | user | `ensureInvitationAccess` | `365-374` |
| `getPendingInvitations` | query | user | — | `376-402` |
| `leaveList` | mutation | user | viewer | `404-413` |

三级列表权限定义在 `packages/trpc/models/lists.ts:488-520`：`canUserView`（owner/editor/viewer/public 全 true）、`canUserEdit`（owner/editor）、`canUserManage`（仅 owner）。中间件包装在 `packages/trpc/routers/lists.ts:26-58`。

### 2.4 tags（7）

| procedure | 类型 | 权限 | 备注 | 行号 |
|---|---|---|---|---|
| `create` | mutation | user | eventLog | `39-47` |
| `get` | query | user | `ensureTagOwnership` | `49-59` |
| `delete` | mutation | user | `ensureTagOwnership` | `60-69` |
| `deleteUnused` | mutation | user | — | `70-79` |
| `update` | mutation | user | `ensureTagOwnership` | `80-87` |
| `merge` | mutation | user | 内部按 userId 过滤 | `88-103` |
| `list` | query | user | 分页可选 | `104-125` |

`ensureTagOwnership` 通过 `Tag.fromId(ctx, tagId)` 反查并过滤 `bookmarkTags.userId`（`packages/trpc/routers/tags.ts:25-36`、`packages/trpc/models/tags.ts:119,189,227`）。

### 2.5 admin（23，全部 `admin`）

| procedure | 类型 | admin scope | 行号 |
|---|---|---|---|
| `stats` | query | `admin:system:read` | `68` |
| `backgroundJobsStats` | query | `admin:jobs:read` | `87` |
| `recrawlLinks` | mutation | `admin:bookmarks:readwrite` | `268` |
| `reindexAllBookmarks` | mutation | `admin:bookmarks:readwrite` | `303` |
| `regenerateAllBookmarkEmbeddings` | mutation | `admin:bookmarks:readwrite` | `330` |
| `reprocessAssetsFixMode` | mutation | `admin:bookmarks:readwrite` | `405` |
| `reRunInferenceOnAllBookmarks` | mutation | `admin:bookmarks:readwrite` | `435` |
| `runAdminMaintenanceTask` | mutation | `admin:jobs:readwrite` | `469` |
| `userStats` | query | `admin:users:read` | `474` |
| `getUser` | query | `admin:users:read` | `516` |
| `createUser` | mutation | `admin:users:readwrite` | `540` |
| `updateUser` | mutation | `admin:users:readwrite` | `560` |
| `resetPassword` | mutation | `admin:users:readwrite` | `607` |
| `purgeBookmarksOverQuota` | mutation | `admin:users:readwrite` | `631` |
| `getAdminNoticies` | query | `admin:system:read` | `686` |
| `checkConnections` | query | `admin:system:read` | `697` |
| `getBookmarkDebugInfo` | query | `admin:bookmarks:read` | `850` |
| `adminRecrawlBookmark` | mutation | `admin:bookmarks:readwrite` | `930` |
| `adminReindexBookmark` | mutation | `admin:bookmarks:readwrite` | `959` |
| `adminRegenerateBookmarkEmbedding` | mutation | `admin:bookmarks:readwrite` | `979` |
| `adminRetagBookmark` | mutation | `admin:bookmarks:readwrite` | `1012` |
| `adminResummarizeBookmark` | mutation | `admin:bookmarks:readwrite` | `1038` |
| `forceStripeSync` | mutation | `admin:system:readwrite` | `1071` |

`admin.resetPassword` 走 `setUserPassword`（`packages/trpc/routers/admin.ts:607`、`packages/trpc/auth.ts:235-253`），即管理员可直接重置任意用户密码——高权能力，需独立审计日志（目前仅有 eventLog，见 `packages/trpc/routers/admin.ts:607` 上下文）。

### 2.6 subscriptions（10）

| procedure | 类型 | 权限 | 备注 | 行号 |
|---|---|---|---|---|
| `getSubscriptionStatus` | query | user | 综合 Stripe + IAP + manualTier | `327-399` |
| `getSubscriptionPrice` | query | user | 调 Stripe `prices.retrieve` | `401-439` |
| `createCheckoutSession` | mutation | user | Stripe Checkout，`metadata.userId` | `441-552` |
| `syncWithStripe` | mutation | user | 强制回源 Stripe | `554-566` |
| `createPortalSession` | mutation | user | Billing Portal | `568-592` |
| `getQuotaUsage` | query | user | 书签数 + 资产字节 | `594-634` |
| `updateSubscriptionTier` | mutation | **admin** | 手工授予 tier/配额 | `641-725` |
| `syncWithRevenueCat` | mutation | user | 限流 10/60s | `729-752` |
| `handleRevenueCatWebhook` | mutation | **public** | 校验 `authorization` 头 | `754-819` |
| `handleWebhook` | mutation | **public** | `stripe.webhooks.constructEvent` 验签 | `821-867` |

### 2.7 importSessions（9）

`createImportSession`(m,`56`)、`getImportSessionStats`(q,`76`)、`listImportSessions`(q,`84`)、`deleteImportSession`(m,`92`)、`stageImportedBookmarks`(m,`101`，单批 ≤50 条，`119`)、`finalizeImportStaging`(m,`130`)、`pauseImportSession`(m,`137`)、`resumeImportSession`(m,`144`)、`getImportSessionResults`(q,`151`)。资源级鉴权统一由 `ensureImportSessionAccess`（`38-53`）+ service 内 `userId` 过滤（`packages/trpc/models/importSessions.repo.ts:46`）。

### 2.8 highlights（7）

| procedure | 类型 | 权限 | 资源校验 | 行号 |
|---|---|---|---|---|
| `create` | mutation | user | `ensureBookmarkOwnership` | `54-60` |
| `getForBookmark` | query | user | `ensureBookmarkAccess`（可读共享） | `61-71` |
| `get` | query | user | `ensureHighlightOwnership` | `72-78` |
| `getAll` | query | user | repo 按 `userId` 过滤 | `79-98` |
| `search` | query | user | repo 按 `userId` 过滤 | `99-120` |
| `delete` | mutation | user | `ensureHighlightOwnership` | `121-127` |
| `update` | mutation | user | `ensureHighlightOwnership` | `128-134` |

`ensureHighlightOwnership` → `HighlightsService.get` → `assertOwnership`（`packages/trpc/models/highlights.service.ts:25-34`）。

### 2.9 apiKeys（6）

| procedure | 类型 | 权限 | 说明 | 行号 |
|---|---|---|---|---|
| `create` | mutation | **session** | 拒绝 API key 自建 key；`scopes` 缺省 = `fullaccess` | `37-61` |
| `regenerate` | mutation | session | 轮换 keyId+secret | `62-89` |
| `revoke` | mutation | user | API key 只能删自己（比较 `keyId`） | `93-117` |
| `list` | query | session | 不返回 secret/keyHash | `118-147` |
| `exchange` | mutation | **public** | 邮箱+密码换 key；限流 10/15min | `150-210` |
| `validate` | mutation | **public** | 校验 key 有效性；限流 30/60s | `211-230` |

### 2.10 users（11）

| procedure | 类型 | 权限 | 备注 | 行号 |
|---|---|---|---|---|
| `list` | query | **admin** | `User.getAll` | `27-38` |
| `delete` | mutation | **admin** | 禁止删自己 | `39-58` |
| `deleteAccount` | mutation | user | 本地账号必须验密码 | `59-73` |
| `whoami` | query | user | | `74-79` |
| `bookmarkCounts` | query | user | | `80-85` |
| `stats` | query | user | | `86-91` |
| `wrapped` | query | user | 恒抛 `BAD_REQUEST`（功能下线） | `92-97` |
| `hasWrapped` | query | user | 同上 | `98-103` |
| `settings` | query | user | | `104-109` |
| `updateSettings` | mutation | user | | `110-115` |
| `updateAvatar` | mutation | user | 资产归属在 model 内校验 | `116-125` |

### 2.11 其余 router

- **invites（6）**：`create`(m,admin,`21`)、`list`(q,admin,`79`)、`get`(q,**public**,`115`)、`accept`(m,**public**,`152`)、`revoke`(m,admin,`208`)、`resend`(m,admin,`232`)。
- **feeds（6）**：`create`(m,`49`)、`update`(m,`55`)、`get`(q,`62`)、`list`(q,`69`)、`delete`(m,`75`)、`fetchNow`(m,`81`)；资源校验 `ensureFeedOwnership`（`31-46`）。
- **webhooks（4）**：`create`(m,`59`)、`update`(m,`66`)、`list`(q,`74`)、`delete`(m,`80`)；响应统一经 `toPublicWebhook` 脱去 `token`（`16-22`）。
- **rules（4）**：`create`(m,`88`)、`update`(m,`96`)、`delete`(m,`105`)、`list`(q,`111`)。
- **prompts（4）**：`create`(m,`49`)、`update`(m,`64`)、`list`(q,`88`)、`delete`(m,`96`)。
- **backups（4）**：`list`(q,`15`)、`get`(q,`22`)、`delete`(m,`34`)、`triggerBackup`(m,`45`，限流 5/小时)。
- **assets（4）**：`list`(q,`15`)、`attachAsset`(m,`44`)、`replaceAsset`(m,`59`)、`detachAsset`(m,`72`)。
- **publicBookmarks（2）**：`getPublicListMetadata`(q,public,`16`)、`getPublicBookmarksInList`(q,public,`38`)。
- **problemReports（1）**：`submit`(m, session,`13`，限流 5/小时)。
- **config（1）**：`clientConfig`(q, public,`7`)。

---

## 3. REST v1/v2 端点清单

### 3.1 版本事实

- 仅 `/api/v1/*`（`packages/api/index.ts:29-43`）与根级别名（`86-93`）。
- `/api/assets/*`（根）与 `/api/v1/assets/*` 复用同一 `assets` router（`packages/api/index.ts:39`、`90`）。
- 不存在 `/api/v2`。若需要“v2 差异”，工程上可用的等价信息是：
  - 共享 schema 的**向后兼容字段**：`zGetBookmarksRequestSchema.useCursorV2`（`packages/shared/types/bookmarks.ts:295-298`，注释明确说明已不使用）。
  - 游标形态：REST 暴露扁平字符串 `"<id>_<ISO>"`（`packages/api/utils/pagination.ts:13-23,32-35`），tRPC 用结构体 `{id, createdAt}`（`zCursorV2`），搜索用 `{ver:1, offset}`（`packages/shared/types/bookmarks.ts:353-358`）——三种游标并存是当前最大的“版本感”来源。
  - API key 代际：`ak1`（bcrypt）与 `ak2`（sha256）并存（`packages/trpc/auth.ts:14-15,132-146`）。

### 3.2 全量端点（67）

认证列：`A` = 需登录（`authMiddleware`，`packages/api/middlewares/auth.ts:24-37`）；`A+scope` = 另需 API key scope（`apiKeyScopeMiddleware`，`packages/api/middlewares/apiKeyScopes.ts:14-39`）；`Admin` = `adminAuthMiddleware`（`auth.ts:39-59`）；`✗` = 无认证。

| # | METHOD | 路径 | 用途 | 认证 | 证据 |
|---|---|---|---|---|---|
| 1 | GET | `/api/v1/bookmarks` | 书签分页列表（`favourited/archived/sortOrder/includeContent/cursor/limit`） | A | `packages/api/routes/bookmarks.ts:36-53` |
| 2 | POST | `/api/v1/bookmarks` | 创建书签（`source` 缺省 `"api"`），命中重复返回 200，否则 201 | A | `bookmarks.ts:56-63` |
| 3 | GET | `/api/v1/bookmarks/search` | 全文/语义/混合搜索（`q` 必填） | A | `bookmarks.ts:66-103` |
| 4 | GET | `/api/v1/bookmarks/check-url` | URL 去重查询 | A | `bookmarks.ts:106-119` |
| 5 | POST | `/api/v1/bookmarks/singlefile` | 上传单文件归档并建 link 书签（`ifexists` 策略） | A+`assets:readwrite`+`bookmarks:readwrite`，只读模式拒绝，体积上限 | `bookmarks.ts:121-215` |
| 6 | GET | `/api/v1/bookmarks/{bookmarkId}/content` | 可读正文分页（markdown/plain，`maxChars`、ETag、409 内容变更） | A | `bookmarks.ts:218-303` |
| 7 | GET | `/api/v1/bookmarks/{bookmarkId}` | 书签详情 | A | `bookmarks.ts:306-318` |
| 8 | PATCH | `/api/v1/bookmarks/{bookmarkId}` | 更新书签（body 省略 `bookmarkId`） | A | `bookmarks.ts:321-336` |
| 9 | DELETE | `/api/v1/bookmarks/{bookmarkId}` | 删除书签（204） | A | `bookmarks.ts:339-343` |
| 10 | GET | `/api/v1/bookmarks/{bookmarkId}/lists` | 书签所属列表 | A | `bookmarks.ts:346-350` |
| 11 | GET | `/api/v1/bookmarks/{bookmarkId}/assets` | 书签资产列表 | A | `bookmarks.ts:353-357` |
| 12 | POST | `/api/v1/bookmarks/{bookmarkId}/assets` | 挂载资产（201） | A | `bookmarks.ts:360-368` |
| 13 | PUT | `/api/v1/bookmarks/{bookmarkId}/assets/{assetId}` | 替换资产（204） | A | `bookmarks.ts:371-385` |
| 14 | DELETE | `/api/v1/bookmarks/{bookmarkId}/assets/{assetId}` | 解绑资产（204） | A | `bookmarks.ts:388-393` |
| 15 | POST | `/api/v1/bookmarks/{bookmarkId}/tags` | 批量打标签 | A | `bookmarks.ts:396-409` |
| 16 | DELETE | `/api/v1/bookmarks/{bookmarkId}/tags` | 批量去标签（body 传 tags） | A | `bookmarks.ts:412-425` |
| 17 | POST | `/api/v1/bookmarks/{bookmarkId}/summarize` | 触发 AI 摘要 | A | `bookmarks.ts:428-434` |
| 18 | GET | `/api/v1/bookmarks/{bookmarkId}/highlights` | 书签高亮 | A | `bookmarks.ts:437-441` |
| 19 | GET | `/api/v1/highlights` | 高亮分页 | A | `routes/highlights.ts:14-20` |
| 20 | POST | `/api/v1/highlights` | 建高亮（201） | A | `highlights.ts:21-25` |
| 21 | GET | `/api/v1/highlights/{highlightId}` | 高亮详情 | A | `highlights.ts:26-32` |
| 22 | PATCH | `/api/v1/highlights/{highlightId}` | 改高亮 | A | `highlights.ts:33-45` |
| 23 | DELETE | `/api/v1/highlights/{highlightId}` | 删高亮（返回被删对象，200） | A | `highlights.ts:46-52` |
| 24 | GET | `/api/v1/lists` | 我的列表（含协作） | A | `routes/lists.ts:15-18` |
| 25 | POST | `/api/v1/lists` | 建列表（201） | A | `lists.ts:19-23` |
| 26 | GET | `/api/v1/lists/{listId}` | 列表详情 | A | `lists.ts:24-28` |
| 27 | PATCH | `/api/v1/lists/{listId}` | 改列表 | A | `lists.ts:29-38` |
| 28 | DELETE | `/api/v1/lists/{listId}` | 删列表（204） | A | `lists.ts:39-43` |
| 29 | GET | `/api/v1/lists/{listId}/bookmarks` | 列表内书签 | A | `lists.ts:44-59` |
| 30 | PUT | `/api/v1/lists/{listId}/bookmarks/{bookmarkId}` | 加入列表（204） | A | `lists.ts:60-65` |
| 31 | DELETE | `/api/v1/lists/{listId}/bookmarks/{bookmarkId}` | 移出列表（204） | A | `lists.ts:66-71` |
| 32 | GET | `/api/v1/tags` | 标签分页（base64url 游标） | A | `routes/tags.ts:20-37` |
| 33 | POST | `/api/v1/tags` | 建标签（201） | A | `tags.ts:40-44` |
| 34 | GET | `/api/v1/tags/{tagId}` | 标签详情（含统计） | A | `tags.ts:47-51` |
| 35 | PATCH | `/api/v1/tags/{tagId}` | 改标签 | A | `tags.ts:54-63` |
| 36 | DELETE | `/api/v1/tags/{tagId}` | 删标签（204） | A | `tags.ts:66-70` |
| 37 | GET | `/api/v1/tags/{tagId}/bookmarks` | 标签下书签 | A | `tags.ts:73-88` |
| 38 | GET | `/api/v1/users/me` | 当前用户 | A | `routes/users.ts:9-12` |
| 39 | GET | `/api/v1/users/me/stats` | 当前用户统计 | A | `users.ts:15-18` |
| 40 | POST | `/api/v1/assets` | 上传资产（`file` 或 `image`） | A+`assets:readwrite`，限流 30/60s，只读模式拒绝 | `routes/assets.ts:17-46` |
| 41 | GET | `/api/v1/assets/{assetId}/signed-url` | 生成公开签名 URL（1h） | A+`assets:read` | `assets.ts:47-65` |
| 42 | GET | `/api/v1/assets/{assetId}` | 读取/流式下载资产（支持 Range） | A+`assets:read` | `assets.ts:66-73` |
| 43 | PUT | `/api/v1/admin/users/{userId}` | 管理员改用户 | Admin | `routes/admin.ts:16-26` |
| 44 | POST | `/api/v1/admin/jobs/trigger/recrawl` | 触发全量重抓 | Admin | `admin.ts:29-46` |
| 45 | POST | `/api/v1/admin/jobs/trigger/reindex` | 触发全量重建索引 | Admin | `admin.ts:49-62` |
| 46 | POST | `/api/v1/admin/jobs/trigger/inference` | 触发全量推理 | Admin | `admin.ts:65-80` |
| 47 | GET | `/api/v1/rss/lists/{listId}` | 列表 RSS（`?token=` 或公开列表） | ✗ | `routes/rss.ts:12-56` |
| 48 | GET | `/api/v1/backups` | 备份列表 | A | `routes/backups.ts:9-12` |
| 49 | POST | `/api/v1/backups` | 触发备份（201） | A | `backups.ts:15-18` |
| 50 | GET | `/api/v1/backups/{backupId}` | 备份详情 | A | `backups.ts:21-25` |
| 51 | GET | `/api/v1/backups/{backupId}/download` | 下载备份（302 跳 `/api/assets/{id}`） | A | `backups.ts:28-35` |
| 52 | DELETE | `/api/v1/backups/{backupId}` | 删备份（204） | A | `backups.ts:38-42` |
| 53 | GET | `/api/v1/feeds` | RSS 订阅列表 | A | `routes/feeds.ts:15-18` |
| 54 | POST | `/api/v1/feeds` | 建订阅（201） | A | `feeds.ts:21-25` |
| 55 | GET | `/api/v1/feeds/{feedId}` | 订阅详情 | A | `feeds.ts:28-32` |
| 56 | PATCH | `/api/v1/feeds/{feedId}` | 改订阅 | A | `feeds.ts:35-44` |
| 57 | DELETE | `/api/v1/feeds/{feedId}` | 删订阅（204） | A | `feeds.ts:47-51` |
| 58 | POST | `/api/v1/feeds/{feedId}/fetch` | 立即抓取（204） | A | `feeds.ts:54-58` |
| 59 | GET | `/api/health` | 存活探针 | ✗ | `routes/health.ts:9-14` |
| 60 | GET | `/api/version` | 版本号 | ✗ | `routes/version.ts:10-14` |
| 61 | POST | `/api/assets` | 同 #40（根级别名） | A+`assets:readwrite` | `packages/api/index.ts:90`、`routes/assets.ts:17` |
| 62 | GET | `/api/assets/{assetId}/signed-url` | 同 #41（别名） | A+`assets:read` | `index.ts:90` |
| 63 | GET | `/api/assets/{assetId}` | 同 #42（别名） | A+`assets:read` | `index.ts:90` |
| 64 | GET | `/api/public/assets/{assetId}?token=` | 签名 token 公开读资产 | ✗（HMAC token） | `routes/public/assets.ts:16-49` |
| 65 | GET | `/api/metrics` | Prometheus 指标 | Bearer `PROMETHEUS_AUTH_TOKEN` | `routes/metrics.ts:26-30` |
| 66 | POST | `/api/webhooks/stripe` | Stripe 事件入口（`stripe-signature`） | ✗（验签） | `routes/webhooks.ts:14-44` |
| 67 | POST | `/api/webhooks/revenuecat` | RevenueCat 事件入口（`authorization`） | ✗（共享 token） | `webhooks.ts:45-71` |

补充：
- `/api/trpc/*`（`packages/api/routes/trpc.ts:12-29`）不是 REST 端点，是 tRPC HTTP 传输，`createContext` 直接复用 `c.var.ctx`（`17-19`）。
- 公开签名资产 token 结构 = `{assetId, userId}` + HMAC-SHA256 + 过期时间，校验时同时比对 `assetId` 与 `assets.userId`（`packages/api/routes/public/assets.ts:27-46`、`packages/shared/signedTokens.ts:50-109`）。
- 资产响应统一加 `nosniff`、严格 CSP sandbox、`private, immutable` 缓存（`packages/api/utils/assets.ts:26-44`）。

### 3.3 OpenAPI 生成方式（`packages/open-api`）

- 依赖 `@asteasolutions/zod-to-openapi`，通过 `zod-extend.ts`（`packages/open-api/zod-extend.ts`）给 zod 挂 `.openapi()`。
- 每个资源一个 `OpenAPIRegistry`：`admin/assets/backups/bookmarks/common/feeds/highlights/lists/tags/users`（`packages/open-api/index.ts:10-19`），合并后 `OpenApiGeneratorV3(registry.definitions).generateDocument(...)`（`35-117`）。
- 安全方案 `bearerAuth`（`bearerFormat: "JWT"`，实为 Karakeep API key）：`packages/open-api/lib/common.ts:4-12`。
- 服务地址 `{address}/api/v1`（`packages/open-api/index.ts:106-115`）。
- 产出/校验：`writeDocumentation()` 写 `karakeep-openapi-spec.json`，`checkDocumentation()` 在 `check` 模式下做逐字节比对并以退出码 1 表示漂移（`120-143`）——适合放进 CI 作为“契约未更新”门禁。
- 覆盖度：共 **56** 条 `registerPath`；**未纳入规格**的实现端点包括 `POST /bookmarks/singlefile`、`GET /rss/lists/{listId}`、`GET /public/assets/{assetId}`、`/health`、`/version`、`/metrics`、`/webhooks/*`。这与“v1 主干已文档化、边缘端点未文档化”的现状一致，商业化前应补齐支付/RSS/公开资产三条。

---

## 4. 认证与会话

### 4.1 认证栈

| 维度 | 事实 | 证据 |
|---|---|---|
| 认证框架 | better-auth **1.7.16**（Drizzle adapter，sqlite provider） | `apps/web/package.json:63`、`apps/web/server/auth.ts:411-419` |
| 端点白名单 | 仅允许 `/ok /error /get-session /sign-in/email /sign-up/email /sign-out /send-verification-email /verify-email /request-password-reset /reset-password /change-password /sign-in/social /callback/:id`，其余一律 404 | `apps/web/server/auth.ts:54-68`、`288-291` |
| 内置限流 | **关闭** better-auth 自带限流，改用自己的 `checkRateLimit` | `apps/web/server/auth.ts:408-410`、`218-246` |
| origin 校验 | 显式 `disableOriginCheck: false`（注释说明测试环境也不放过） | `apps/web/server/auth.ts:401-407` |
| trustedOrigins | `karakeep://` + 配置项，`*` 指代“请求自身 host” | `apps/web/server/auth.ts:189-205` |
| session 有效期 | `expiresIn 30d`、`updateAge 24h`、降级模式 `disableSessionRefresh` | `apps/web/server/auth.ts:420-424` |
| session 存储 | `session` 表：`token`（明文 text，unique）、`userId`、`expiresAt`、`ipAddress`、`userAgent` | `packages/db/schema.ts:165-186` |
| cookie 策略 | **未显式配置**：`betterAuth({...})` 无 `advanced.cookies` / `useSecureCookies`，全仓仅本地设置用 `sameSite:"lax"`；即沿用 better-auth 默认（`httpOnly` + `secure` 依 baseURL + `sameSite=lax`） | `apps/web/server/auth.ts:394-410`（无 cookie 段）、对比 `apps/web/lib/userLocalSettings/userLocalSettings.ts:29-30` |
| 服务端 session 读取 | `getSession({ query: { disableRefresh: true } })`，`cache()` 去重 | `apps/web/server/auth.ts:580-615` |

**结论**：session 是**有状态、DB 存 token** 的模型（非 JWT），登出/改密可即时失效（`revokeSessionsOnPasswordReset: true`，`apps/web/server/auth.ts:432`）。token 在库中未做哈希（schema 无哈希列，代码中亦无哈希逻辑），安全性依赖数据库边界；对自托管场景可接受，多租户/SaaS 化前建议改为“cookie 存原始 token、库存 sha256”。

### 4.2 密码

- 哈希：bcrypt，`BCRYPT_SALT_ROUNDS = 10`（`packages/trpc/auth.ts:13`、`186-188`）。
- 历史格式兼容：`bcrypt-salted:<salt>:<hash>` 前缀走 `bcrypt(password+salt)` 校验（`packages/trpc/auth.ts:184-203`）。
- 防时序侧信道：
  - 用户不存在时仍跑一次 `bcrypt.compare`（`packages/trpc/auth.ts:263-271`）。
  - OAuth-only 账号走 `DUMMY_PASSWORD_HASH`（真实 bcrypt hash，成本因子一致，`24-27`、`226-233`）。
- 重置密码邮件**故意不 await**，避免“是否存在该邮箱”的时延预言机（`apps/web/server/auth.ts:438-454`）。
- 邀请注册与管理员建号都直接写 `accounts(providerId="credential")`（`packages/trpc/auth.ts:235-253`）。

### 4.3 API key

| 项 | 事实 | 证据 |
|---|---|---|
| 明文格式 | `ak2_<keyId>_<secret>`；解析要求恰好 3 段且前缀 ∈ {`ak1`,`ak2`} | `packages/trpc/auth.ts:29-36,99-114` |
| 熵 | `keyId` = 10 bytes hex(80bit)，`secret` = 16 bytes hex(128bit) | `packages/trpc/auth.ts:29-33` |
| 存储 | 仅存 `keyId`（unique）+ `keyHash`；`scopes` JSON 列 | `packages/db/schema.ts:213-234` |
| ak2 校验 | `sha256(secret)` 后 `timingSafeEqual` | `packages/trpc/auth.ts:136-143` |
| ak1（遗留） | `bcrypt.compare(secret, hash)` | `packages/trpc/auth.ts:132-135` |
| 定位 | 先按 `keyId` 查行，再比对 secret | `packages/trpc/auth.ts:117-127` |
| 使用时间 | `lastUsedAt` 10 分钟节流、fire-and-forget、只读模式跳过 | `packages/trpc/auth.ts:152-166` |
| scope 模型 | `fullaccess` 或 `<resource>:read|readwrite`，管理域 `admin:<resource>:<access>` | `packages/shared/types/apiKeys.ts:3-27,72-105` |
| 提权规则 | 持有 `readwrite` 自动满足对应 `read`；`fullaccess` 满足一切 | `packages/shared/types/apiKeys.ts:92-106` |

**当 API key 无法用于高风险端点时**：`sessionProcedure` 拒绝所有 API key（`packages/trpc/index.ts:207`），作用于 `apiKeys.create/regenerate/list`、`problemReports.submit`。这是“key 不能自我繁殖”的正确设计。

**观察**：`apiKeys.create` 只校验 `zApiKeyScopesSchema`（`packages/trpc/routers/apiKeys.ts:42`），并未限制普通用户申请 `admin:*` scope。安全性由 `createAdminScopedProcedure` 的**角色检查**兜底（`packages/trpc/index.ts:230-236`），因此当前不构成越权；但这是“scope 与 role 双轨”的耦合点，任何新增的“只看 scope 不看 role”的 procedure 都会变成提权洞。

### 4.4 邮箱验证 / 密码重置 / 邀请

- 邮箱验证：`emailVerification.sendOnSignUp = emailVerificationRequired`，token 24h（`apps/web/server/auth.ts:456-470`）；邮件内明确 “expire in 24 hours”（`packages/trpc/email.ts:79`）。校验链接拼装时对 `callbackURL` 做 `validateRedirectUrl` 白名单校验（`apps/web/server/auth.ts:330-343`）。
- 密码重置：token 1h（`apps/web/server/auth.ts:433`）、成功后撤销全部会话（`432`）、OAuth-only 账号静默跳过（`441-443`）。
- `emailVerificationRequired` 与 SMTP 是**强绑定**：未配 SMTP 时启动即配置校验失败（`packages/shared/config.ts:610-617`），避免“要求验证却发不出信”。
- 邀请码：
  - 生成：`randomBytes(32).toString("hex")`（256bit），落库明文（`packages/trpc/routers/invites.ts:50-59`、`packages/db/schema.ts:905-917`）。
  - 消费：`accept` 校验 token→邮箱未被占用→建号（`role:"user"`、`emailVerified:true`）→删邀请（`invites.ts:152-206`）。
  - **风险 R3（中）**：`invites` 表**没有** `expiresAt`（`packages/db/schema.ts:905-917` 仅 `usedAt`），`get` 直接硬编码 `expired: false`（`invites.ts:146-149`），`accept` 也不做过期判断（`168-177`）。邀请链接一旦泄露即长期有效；`resend` 只轮换 token（`250-257`）。
  - 邀请 token 明文存储 + 无过期，建议：加 `expiresAt`（默认 7d）、`usedAt` 落值、库内存哈希、`resend` 时使旧 token 立即失效。

### 4.5 admin 判定逻辑

1. **首个用户自动为 admin**：`databaseHooks.user.create.before` 里 `role: (await isFirstUser()) ? "admin" : "user"`（`apps/web/server/auth.ts:511-520`，`isFirstUser` 定义 `155-160`）。
2. better-auth 字段层面 `role.input = false`（`apps/web/server/auth.ts:471-477`），即注册请求**不能**自带 role —— 防自封 admin。
3. session 投影为二值：`role: session.user.role === "admin" ? "admin" : "user"`（`apps/web/server/auth.ts:602-611`）。
4. 授权点：`createAdminScopedProcedure` 的 `isAdmin` 中间件（`packages/trpc/index.ts:230-236`）；REST 侧 `adminAuthMiddleware` 独立再查一次 `ctx.user.role`（`packages/api/middlewares/auth.ts:51-55`）。
5. 管理员不能删自己（`packages/trpc/routers/users.ts:47-52`）；`deleteAsAdmin` 内部再次 `invariant(role === "admin")`（`packages/trpc/models/users.ts:185-189`）。

### 4.6 内部身份（internal）

- `buildImpersonatingAuthedContext(userId)` 返回 `auth: { type: "internal" }`、`req.ip = null`（`packages/trpc/lib/impersonate.ts:19-31`）。
- 用途：worker（备份、规则引擎、配额清理）与**公开列表/RSS** 的“以属主身份读取”（`packages/trpc/models/lists.ts:216-233`）。
- 风险面：internal 身份**跳过全部限流**（`packages/shared/ratelimiting.ts:55-57`、`packages/trpc/lib/rateLimit.ts:29-37`），且跳过 API key scope 检查（`packages/trpc/index.ts:188-191`：非 apiKey 直接放行）。因此 internal context 一旦被外部可控路径拼出来，就是完全绕过。当前唯一入口是 `getPublicListContents`（受 `public=true` 或 rssToken 约束，`lists.ts:161-181`），**未发现用户可控注入**。

---

## 5. 授权与数据隔离（含风险结论）

### 5.1 三层模型

| 层 | 机制 | 位置 |
|---|---|---|
| L1 路由级 | `publicProcedure` / `authedProcedure` / `sessionProcedure` / `createScopedAuthedProcedure` / `createAdminScopedProcedure` | `packages/trpc/index.ts:133-237` |
| L2 资源级 middleware | `ensureBookmarkOwnership`、`ensureBookmarkAccess`、`ensureListAtLeast{Viewer,Editor,Owner}`、`ensureHighlightOwnership`、`ensureFeedOwnership`、`ensureWebhookOwnership`、`ensureImportSessionAccess`、`ensureInvitationAccess`、`ensurePromptOwnership`、`ensureRuleOwnership`、`ensureTagOwnership` | `bookmarks.ts:95-129`、`lists.ts:26-74`、`highlights.ts:36-51`、`feeds.ts:31-46`、`webhooks.ts:41-56`、`importSessions.ts:38-53`、`lists.ts:60-74`、`prompts.ts:16-46`、`rules.ts:19-30`、`tags.ts:25-36` |
| L3 查询级 | SQL `where userId = ctx.user.id`（或经资源对象转交） | 见 5.2 |

### 5.2 各 router 的 `userId` 强制过滤位置

| Router | 强制过滤点 | 证据 |
|---|---|---|
| bookmarks | 无 filter 路径、tag 路径、rss 路径三条主查询 | `packages/trpc/models/bookmarks.ts:588`、`550`、`571` |
| bookmarks（旁路查询） | 去重、断链、标签创建 | `packages/trpc/routers/bookmarks.ts:138`、`1519`、`1368` |
| bookmarks（按 id 读取） | `bareFromId` → `isAllowedToAccessBookmark`（owner 或“可见列表成员”） | `models/bookmarks.ts:116-147` |
| lists | 属主分支 / 协作分支 | `models/lists.ts:99`、`125` |
| lists（汇总） | `getAllOwned` / `getAll` | `models/lists.ts:388`、`421` |
| tags | 7 处 | `models/tags.ts:119,189,227,275,319,346,423` |
| highlights | repo 层 getAll/search/get | `models/highlights.repo.ts:64,103` |
| assets | list/attach、`canUserView` | `models/assets.ts:64,71,113,225-251` |
| feeds | `FeedsService` | `models/feeds.repo.ts:45,51` |
| importSessions | `ImportSessionsService` | `models/importSessions.repo.ts:46` |
| webhooks | `WebhooksService` | `models/webhooks.repo.ts:44,50` |
| rules | 6 处 | `models/rules.ts:25,68,158,202,213` |
| backups | 6 处 | `models/backups.ts:21,44,98,133,152` |
| users | 统计/清理类查询 | `models/users.ts:401,440,459,463,467,476,544,592` |
| prompts | middleware 单点校验 `prompt.userId` | `routers/prompts.ts:20-43` |
| subscriptions | 全部按 `ctx.user.id` | `routers/subscriptions.ts:330,336,339,462,556,575,596,614,620` |

### 5.3 共享列表：唯一的跨用户通路

- 判定入口：`BareBookmark.isAllowedToAccessBookmark` = 属主直接通过，否则取 `List.forBookmark` 并要求 `canUserView()`（`models/bookmarks.ts:138-147`）。
- `forBookmark` **只在 owner / collaborator 时**返回 `userRole`，否则 `userRole=null` 被 `flatMap` 丢弃（`models/lists.ts:452-482`）。因此**公共列表不会**让任意登录用户通过 `getBookmark` 读到内容——这是易被误判的一处，实际是安全的。
- 共享读的字段脱敏（重要，做得好）：
  - 非属主看不到 `archived`/`favourited`/`note`（`models/bookmarks.ts:810-823`）。
  - 高亮的 `note` 仅作者可见（`models/highlights.service.ts:43-52`）。
  - 协作者邮箱仅属主可见（`models/lists.ts:910-970`，`email: isOwner ? c.user.email : null`）。
  - 公共列表用 `asPublicBookmark()`（`models/bookmarks.ts:867+`）走独立精简 schema（`packages/shared/types/bookmarks.ts:370-397`）。
- `getPublicListContents` 用属主 impersonation 上下文读取，但只返回 `asPublicBookmark`，且注释解释了为何按 `listId` 而非 `ids` 过滤（`models/lists.ts:216-258`）。

### 5.4 风险点（含结论）

#### R1｜`lists.removeFromList` 缺 bookmark 归属校验（**中**，跨用户写）

- `addToList` 的链是 `viewer → editor → ensureBookmarkOwnership`（`routers/lists.ts:133-145`）。
- `removeFromList` 的链只有 `viewer → editor`（`routers/lists.ts:146-157`）；模型层 `removeBookmark` 也只 `ensureCanEdit()` 后按 `(listId, bookmarkId)` 直接删（`models/lists.ts:1211-1228`）。
- 后果：共享列表的 **editor 协作者**可以把**其他成员**加入的 bookmark 从列表移除。不泄露内容（bookmark 本体与权限不变），但破坏共享列表完整性，且会触发对方 `removedFromList` 规则链（`1229-1246`）。
- 设计意图证据：`mergeInto` 的注释明确“只搬自己加入的书签，和 `addToList` 一致”（`models/lists.ts:1272-1273`），说明 `addToList` 的归属约束是**有意**的，`removeFromList` 是遗漏而非策略。
- 修复建议（不改代码，仅结论）：在 `routers/lists.ts:146` 的链上补 `.use(ensureBookmarkOwnership)`，或在 `removeBookmark` 内校验 `bookmarks.userId === ctx.user.id`（属主可保留“清理他人条目”的特权则用 `canUserManage()` 分支）。

#### R2｜写操作仅按 id 落库，安全性依赖中间件顺序（**中 / 纵深防御**）

| 位置 | 缺失条件 | 现有保护 |
|---|---|---|
| `summarizeBookmark` 更新书签 | `.where(eq(bookmarks.id, input.bookmarkId))` 无 userId | `ensureBookmarkOwnership`（`routers/bookmarks.ts:1559`） |
| `recrawlBookmark` 更新 crawlStatus | `.where(eq(bookmarkLinks.id, ...))` 无 userId | `ensureBookmarkOwnership`（`835`） |
| `updateBookmarkText` | `.where(eq(bookmarkTexts.id, ...))` 无 userId | `ensureBookmarkOwnership`（`769`） |
| `updateTags` 的 detach | `delete(tagsOnBookmarks).where(bookmarkId + tagId)` 无 userId | 标签 id 先经 `userId` 过滤（`1317-1334`） |

这些写法本身不会越权（middleware 已挡），但一旦有人新增“复用同一段 SQL 但不挂 middleware”的 procedure 就会直接变成 IDOR。建议按 `bookmarks.ts:694-699` 的写法统一：`and(eq(bookmarks.userId, ctx.user.id), eq(bookmarks.id, ...))`。

#### R3｜`updateReadingProgress` / `getReadingProgress` 用 Access 而非 Ownership（**低 / 设计取舍**）

- `routers/bookmarks.ts:895-935`、`936-955` 使用 `ensureBookmarkAccess`。
- 写入目标是 `userReadingProgress`，唯一键 `(bookmarkId, userId)`（`916-934`），因此只影响调用者自己的阅读状态，不污染属主数据。
- 结论：可接受，但应在契约中明确“viewer 也能写自己的阅读进度”，否则审计时会被当作写入越权。

#### R4｜`lists.getListsOfBookmark` 与 `getBookmark` 权限不一致（**低 / 一致性**）

- `getBookmark` 用 Access（`routers/bookmarks.ts:956-965`），共享列表 viewer 可读；
- `getListsOfBookmark` 用 Ownership（`routers/lists.ts:179-190`），同一 viewer 会拿到 403。
- 后果：协作视图里“这本书在哪些列表”会失败；属功能不一致而非越权。REST `GET /bookmarks/{id}/lists` 因此也会 403（`routes/bookmarks.ts:346-350`）。

#### R5｜公开 `clientConfig` 暴露 demo 凭据（**信息 / 可接受**）

- `config.clientConfig` 是 `publicProcedure`（`routers/config.ts:7-9`），schema 含 `demoMode.email/password`（`packages/shared/types/config.ts:3-11`）。
- 这是 demo 模式的**有意**设计（公开演示账号），但 SaaS 化时必须确保 `demoMode` 未配置，否则等于公开一组有效凭据。

#### R6｜邀请码无过期（见 4.4，**中**）

#### R7｜`getBrokenLinks` / `checkUrl` 的 URL 前缀匹配（**信息**）

- `checkUrl` 用 `like(url, normalizedInput%)` 做粗筛再精确比对（`routers/bookmarks.ts:1255-1268`），带 `userId` 条件（`1257`），无跨用户泄露；但 `like` 前缀扫描在 URL 极多时可能放大查询成本（性能而非安全问题）。

### 5.5 隔离结论

- **未发现可越权读取他人书签 / 资产 / 高亮 / 令牌的 IDOR**。所有“按 id 取对象”的入口都先过 `bareFromId`/`fromId`（内部含 `canUserView`/`ensureOwnership`），且测试覆盖较厚（`bookmarks.test.ts` 64KB、`sharedLists.test.ts` 90KB、`admin.test.ts` 31KB）。
- 唯一的**跨用户写**是 R1（列表成员关系），性质是完整性而非机密性。
- 需要优先修的加固项：R1（归属校验）、R2（SQL 层 userId）、R6（邀请过期）。
- 需要写进产品契约的项：R3（viewer 可写自己的阅读进度）、R4（`getListsOfBookmark` 权限）。

---

## 6. 限流、配额、存储

### 6.1 限流契约与身份

`packages/shared/ratelimiting.ts`：

- `RateLimitConfig = { name, windowMs, maxRequests }`（`3-7`）。
- `RateLimitClient.checkRateLimit(config, key) / reset / clear`（`13-36`），由 `PluginManager.getClient(PluginType.RateLimit)` 提供（`38-40`）。
- **身份键**（`50-65`）：`internal → null`（不限流）；登录 → `user:<id>`；匿名 → `ip:<ip>`；两者皆无 → `null`（不限流）。注释明确说明“用 user id 而不是 IP，因为客户端 IP 来自可伪造的 header”（`43-47`）。

限流键的拼装位置不同（这是配 per-user 限流时最需要注意的点）：

- tRPC：`key = ${identity}:${opts.path}`（`packages/trpc/lib/rateLimit.ts:46`）——**按 procedure 路径**分桶。
- REST：`key = ${identity}:${config.name}`（`packages/api/middlewares/rateLimit.ts:36`）——**按配置名**分桶。

### 6.2 全量限流配置

| 层 | name | 窗口 / 上限 | 生效条件 | 证据 |
|---|---|---|---|---|
| tRPC 全局 public | `globalPublic` | 60s / 1000 | 所有 `publicProcedure` | `packages/trpc/index.ts:133-139` |
| tRPC 全局 authed | `globalAuthed` | 60s / 3000 | 所有 `authedProcedure` 系 | `packages/trpc/index.ts:141-149` |
| bookmarks | `bookmarks.createBookmark` | 60s / 30 | mutation | `routers/bookmarks.ts:243-249` |
| bookmarks | `bookmarks.createBookmark.highVolume` | 5min / 30 | **非拒绝**，命中后降级到低优先级队列 | `routers/bookmarks.ts:203-207`、`217-239`、`487-505` |
| bookmarks | `bookmarks.recrawlBookmark` | 30min / 200 | mutation | `820-827` |
| bookmarks | `bookmarks.preserveVideo` | 30min / 50 | mutation | `853-859` |
| bookmarks | `bookmarks.searchBookmarks.semantic` | 60s / 300 | 仅 `searchMode != "fts"` | `149-153`、`170-190`、`990` |
| bookmarks | `bookmarks.summarizeBookmark` | 30min / 100 | mutation | `1541-1547` |
| bookmarks | `bookmarks.queried`（事件） | 10min | 只发事件不拦截 | `148`、`155-168` |
| lists | `lists.addCollaborator` | 15min / 20 | mutation | `262-268` |
| apiKeys | `apiKey.exchange` | 15min / 10 | public | `151-157` |
| apiKeys | `apiKey.validate` | 60s / 30 | public | `212-218` |
| subscriptions | `subscriptions.syncWithRevenueCat` | 60s / 10 | mutation | `732-738` |
| problemReports | `problemReports.submit` | 1h / 5 | session | `14-20` |
| backups | `backups.triggerBackup` | 1h / 5 | mutation | `46-52` |
| invites | `invites.get` | 60s / 10 | public | `116-122` |
| invites | `invites.accept` | 60s / 10 | public | `153-159` |
| REST | `assets.upload` | 60s / 30 | `POST /assets` | `packages/api/routes/assets.ts:21-25` |
| better-auth | `auth.login` | 15min / 10（键 = `login:<ip>:<email>`） | `/sign-in/email` | `apps/web/server/auth.ts:91-96`、`231-233` |
| better-auth | `auth.signup` | 60s / 3 | `/sign-up/email` | `97-101` |
| better-auth | `auth.sendVerificationEmail` | 5min / 3 | | `102-106` |
| better-auth | `auth.verifyEmail` | 5min / 10 | | `107-111` |
| better-auth | `auth.requestPasswordReset` | 15min / 3 | | `112-116` |
| better-auth | `auth.resetPassword` | 5min / 10 | | `117-121` |
| better-auth | `auth.changePassword` | 15min / 5 | | `122-126` |

**总开关**：`serverConfig.rateLimiting.enabled`（`packages/shared/config.ts:555-557`），关闭时 tRPC 与 REST 限流都**直接 next()**（`packages/trpc/lib/rateLimit.ts:25-27`、`packages/api/middlewares/rateLimit.ts:18-20`），better-auth 限流同样短路（`apps/web/server/auth.ts:224-226`）。客户端未注册时同样放行（`packages/trpc/lib/rateLimit.ts:41-44`），这是可用性优先的取舍，SaaS 场景应改成“未注册即拒绝或降级到内存实现”。

### 6.3 如何配置 per-user 限流（操作配方）

1. 选定资源与窗口，写一个 `RateLimitConfig`。
2. 在目标 procedure 上挂 `createRateLimitMiddleware(config)`，位置**必须在** `authedProcedure` 之后（否则 `ctx.user` 为空，会退化为 IP 桶）：

```ts
myProcedure
  .use(createRateLimitMiddleware({ name: "myFeature.action", windowMs: 60_000, maxRequests: 10 }))
  .input(...)
  .mutation(...)
```

证据：`packages/trpc/routers/bookmarks.ts:242-249`（挂在 `bookmarksProcedure` 之后）、`packages/trpc/lib/rateLimit.ts:29-33`（读 `ctx.user?.id`）。

3. 需要“按租户/等级”差异化时，当前配置模型**不支持**——`RateLimitConfig` 只有固定 `maxRequests`，`identity` 只有 `user:` / `ip:` 两种前缀（`packages/shared/ratelimiting.ts:3-7,50-65`）。可行的最小改造（不改现有代码即可验证的路线）：
   - 路线 A（推荐，零契约变更）：在 middleware 里按 `ctx.user` 的 tier 选择不同 `config` 对象，例如 `name: "upload:" + tier`，让桶天然按 tier 分开。
   - 路线 B：扩展 `RateLimitConfig` 加 `tierLimits?: Record<string, number>`，在 `RateLimitClient` 实现里解析；需同步改 `ratelimit-memory` 与 `ratelimit-redis` 两个插件。
4. 验证：`ratelimit-memory` / `ratelimit-redis` 的测试里有现成的 key 形态断言（如 `"user1:/api/v2"`），可直接复用为回归基线（`packages/plugins/ratelimit-memory/src/index.test.ts:101`）。

### 6.4 配额与存储

| 项 | 事实 | 证据 |
|---|---|---|
| 书签数配额 | `QuotaService.canCreateBookmark(InTransaction)`，`bookmarkQuota === null` 表示无限 | `packages/shared-server/src/services/quotaService.ts:25-92` |
| 书签创建闸门 | 在事务内检查，超限抛 `FORBIDDEN` | `packages/trpc/routers/bookmarks.ts:352-362` |
| 存储配额 | `checkStorageQuota` 返回**一次性批准令牌** `QuotaApproved`，写盘时凭令牌放行 | `packages/shared-server/src/services/quotaService.ts:94-123`、`packages/shared/storageQuota.ts:6-19` |
| 令牌不可自造 | 构造器 private，仅 `QuotaApproved._create` 可建 | `packages/shared/storageQuota.ts:6-19` |
| 上传闸门 | 上传前算配额 → 落临时文件 → 入库 → `saveAssetFromFile({quotaApproved})` | `packages/api/utils/upload.ts:87-131` |
| 上传体积 | `MAX_UPLOAD_SIZE_BYTES = maxAssetSizeMb * 1MB`，外层 bodyLimit +1MiB 余量 | `packages/api/utils/upload.ts:20-28`、`83-85` |
| MIME 校验 | `file-type` 嗅探；浏览器声称支持但嗅探失败 → 拒绝 | `packages/api/utils/upload.ts:68-82` |
| 配额来源 | free/paid 两档来自 `serverConfig.quotas.{free,paid}` | `packages/shared/config.ts:581-592` |
| 配额落地 | 订阅变化时把 tier 配额写进 `users` 列 | `packages/trpc/lib/subscriptionEntitlements.ts:50-87` |
| 文件存储 | 插件式（filesystem / s3），接口见 `AssetStore` | `packages/shared/assetdb.ts:67-108` |

**结论**：配额是“用户列上的物化值”而非“实时读订阅表”，因此**改订阅不会即时生效**，必须经过 `applyUserTierQuotas`（Stripe webhook / RevenueCat sync / admin 授权三条路径）。这在商业化时是优点（读路径零额外查询）也是坑（任何绕过这三条路径的 tier 变更都不会更新配额）。

---

## 7. 插件扩展点（新增搜索后端 / 存储 / 队列 / 限流的具体接口契约）

### 7.1 插件模型

`packages/shared/plugins.ts`：

- 5 类 `PluginType`：`assetstore`、`search`、`queue`、`ratelimit`、`vectorstore`（`10-16`）。
- 每类映射到固定接口：`AssetStore` / `SearchIndexClient` / `QueueClient` / `RateLimitClient` / `VectorStoreClient`（`18-24`）。
- 注册表结构 `TPlugin<T> = { type, name, provider: { getClient() } }`（`26-34`）。
- **last-one-wins**：`getClient` 取 `providers[len-1]`（`74-82`）；`register` 对同名 provider 幂等去重（`65-72`）。
- 全局状态挂在 `globalThis`，避免 Next.js 多 bundle 下重复注册（`39-58`）。
- 调试：`logAllPlugins()` 打印每类已注册列表（`96-109`）。

加载顺序（决定“谁最后赢”）在 `packages/shared-server/src/plugins.ts:24-39`：

```
assetstore-filesystem → assetstore-s3
queue-liteque → queue-restate
search-meilisearch
vectorstore-meilisearch
ratelimit-memory → ratelimit-redis
```

即：S3 覆盖 filesystem、restate 覆盖 liteque、redis 覆盖 memory（各自内部还有 `isConfigured()` 守卫，如 `packages/plugins/search-meilisearch/index.ts:6-11`）。

### 7.2 五类接口契约（必备方法）

| 插件类型 | 接口 | 必选成员 | 定义位置 |
|---|---|---|---|
| assetstore | `AssetStore` | `saveAsset`、`saveAssetFromFile`、`readAsset`、`createAssetReadStream`、`readAssetMetadata`、`getAssetSize`、`deleteAsset`、`deleteUserAssets`、`getAllAssets(): AsyncGenerator` | `packages/shared/assetdb.ts:67-108` |
| search | `SearchIndexClient` | `addDocuments(docs, {batch?})`、`deleteDocuments(ids)`、`search(SearchOptions)`、`clearIndex()` | `packages/shared/search.ts:71-79` |
| vectorstore | `VectorStoreClient` | `addVectors`、`deleteVectors`、`search({vector,filter,limit,rankingScoreThreshold?})`、`findSimilar({id,...})`、`clearIndex`、`getHealth` | `packages/shared/vectorStore.ts:52-84` |
| queue | `QueueClient` | `prepare`、`start`、`createQueue<T>(name, opts)`、`createRunner<T,R>(queue, funcs, opts)`、`shutdown?` | `packages/shared/queueing.ts:94-104` |
| ratelimit | `RateLimitClient` | `checkRateLimit(config,key)`、`reset(config,key)`、`clear()` | `packages/shared/ratelimiting.ts:13-36` |

搜索文档 / 向量文档的字段契约（新增后端必须能存这些）：

- `zBookmarkSearchDocument`：`id`、`userId`、`url`、`title`、`linkTitle`、`description`、`content`、`metadata`、`fileName`、`createdAt`、`note`、`summary`、`tags[]`、`publisher`、`author`、`datePublished`、`dateModified`（`packages/shared/search.ts:5-23`）。
- 可过滤字段被**限制为 `userId` | `id`**（`packages/shared/search.ts:30-41`）——这是多租户隔离的硬约束；新增后端必须支持 `eq`/`in` 两种过滤，否则 `searchBookmarks` 的 `userId` 注入（`packages/trpc/routers/bookmarks.ts:1023-1029`）会失效。
- `zBookmarkVectorDocument`：`id`、`userId`、`vector[]`；过滤字段同为 `userId` | `id`（`packages/shared/vectorStore.ts:5-24`）。

### 7.3 新增一个 provider 的完整步骤（以“新建搜索后端”为例）

1. **建包**：`packages/plugins/search-<name>/index.ts` + `src/index.ts`。
2. **实现接口**：`class <Name>Provider implements PluginProvider<SearchIndexClient>`，提供 `getClient()` 与静态 `isConfigured()`（参考 `packages/plugins/search-meilisearch/index.ts:6-11`）。
3. **自注册**（副作用 import 即生效）：
   ```ts
   if (<Name>Provider.isConfigured()) {
     PluginManager.register({ type: PluginType.Search, name: "<Name>", provider: new <Name>Provider() });
   }
   ```
4. **暴露 exports**：在 `packages/plugins/package.json` 的 `exports` 里加 `"./search-<name>": "./search-<name>/index.ts"`（现有 10 条，见该文件）。**漏了这步会在 `loadAllPlugins` 时报模块解析失败。**
5. **加入加载顺序**：在 `packages/shared-server/src/plugins.ts` 的 `loadAllPlugins()` 中 import；位置决定优先级（后 import 者覆盖前者，`24-39`）。
6. **配置项**：在 `packages/shared/config.ts` 对应段落加字段（如 `search` 段 `491` 起、`assetStore` 段 `537-549`、`redis` 段 `558-560`），并同步 zod schema；否则 `isConfigured()` 无从判断。
7. **依赖**：`@karakeep/shared-server` 已依赖 `@karakeep/plugins`（其 `package.json` 的 `dependencies`），新插件自身的第三方依赖加到 `packages/plugins/package.json`。
8. **测试**：参照 `packages/plugins/ratelimit-memory/src/index.test.ts`、`.../ratelimit-redis/src/tests/*.test.ts` 的写法；`pnpm test --filter=@karakeep/plugins`。
9. **验证**：启动后 `logAllPlugins()` 会打印该类型下的注册列表（`packages/shared/plugins.ts:96-109`），确认新名字在最后一行（即生效者）。

### 7.4 AI provider 不在插件系统内（重要）

新增“AI/推理 provider”走的是**硬编码工厂**，不是 `PluginManager`：

- 接口：`EmbeddingClient { generateEmbeddingFromText(inputs) }`、`InferenceClient extends EmbeddingClient { inferFromText, inferFromImage }`（`packages/shared/inference.ts:125-140`）。
- 工厂：`InferenceClientFactory.build()` 按 `openAIApiKey → ollamaBaseUrl → null` 顺序选择（`packages/shared/inference.ts:210-221`）；`EmbeddingClientFactory.build()` 在此基础上再叠加独立的 embedding 配置（`223-250`）。
- 新增 provider 的最小改动：① 实现 `InferenceClient`；② 在 `InferenceClientFactory.build()` 里插分支；③ 在 `packages/shared/config.ts` 的 `inference` 段（`377` 起）/ `embedding` 段（`421` 起）加配置；④ 若需结构化输出，注意 `mapOpenAIResponseFormat` 与 `serverConfig.inference.outputSchema` 的耦合（`152-168`）。
- 结论：如果商业化需要“多家 AI provider 热切换”，应先把 `InferenceClientFactory` 改造成 `PluginType.Inference`（新增枚举 + 接口映射 + 加载顺序），否则会继续堆 `if`。

### 7.5 三条可直接落地的扩展建议

1. **`PluginType.Inference`**：把 `inference.ts:210-250` 的两个工厂收敛成插件，允许按租户选模型（商业化最关键的差异化点）。
2. **`SearchIndexClient` 的 `FilterableAttributes` 扩展**：当前只有 `userId|id`（`packages/shared/search.ts:30`）。要做“团队共享搜索”，必须扩到 `listId`/`orgId`，同时改 `searchBookmarks` 的 filter 注入（`packages/trpc/routers/bookmarks.ts:1023-1029`），否则跨租户检索无法安全表达。
3. **`RateLimitClient` 增加 `consume(config, key, cost)`**：现有接口只能“一次算一次”（`packages/shared/ratelimiting.ts:20-23`），做“按存储字节/按 AI token 计量”的配额时无法表达权重。

---

## 8. 商业化改造点（订阅状态如何进入鉴权、支付回调端点建议）

### 8.1 现状：订阅不进入请求时鉴权

调用链事实：

1. 订阅真相在 `subscriptions`（Stripe）与 `inAppSubscriptions`（iap）两张表（`packages/db/schema.ts:919+`、`967+`）。
2. 判定函数：`isPaidStatus(status)` = `active|trialing|past_due`（`packages/trpc/lib/subscriptionEntitlements.ts:11-13`）；`getActivePaidSubscriptionProvider` 先 Stripe 后 IAP（`15-38`）。
3. **物化**：`applyUserTierQuotas(trx, userId)` 把 `bookmarkQuota/storageQuota/browserCrawlingEnabled` 写到 `users`，并在付费生效时清空 `manualTierName`（`50-87`）。
4. **只有三处触发物化**：Stripe webhook / `syncWithStripe`（`packages/trpc/routers/subscriptions.ts:118-299`）、RevenueCat sync/webhook（`729-819`）、admin `updateSubscriptionTier`（`641-725`）。
5. **请求时读取的是 `users` 列**，不是订阅表：
   - 书签配额：`QuotaService`（`packages/shared-server/src/services/quotaService.ts:25-92`）
   - 存储配额：`checkStorageQuota`（`94-123`）
   - 浏览器抓取：worker 读 `users.browserCrawlingEnabled`（`apps/workers/workers/crawlerWorker.ts:366-382`、`1239`）
6. **没有任何 tRPC/REST middleware 检查 `isPaidStatus`**（`packages/trpc/index.ts:133-237` 全量可见，无订阅相关中间件）。

**结论**：当前是“**配额式 + 特性开关式**”商业化，不是“**路由级订阅门禁**”。优点是热路径零额外查询；缺点是无法表达“这个端点仅付费可用”，也无法在降级瞬间切断已签发 session 的访问。

### 8.2 建议的接入方式（新增 tier 中间件）

在 `packages/trpc/index.ts` 现有构造器旁新增一档，复用 `createScopedAuthedProcedure` 的形状：

```ts
// 伪代码，仅示意插入点；真实实现需新文件
export function createPaidProcedure() {
  return authedProcedure.use(async (opts) => {
    const u = await opts.ctx.db.query.users.findFirst({
      where: eq(users.id, opts.ctx.user.id),
      columns: { manualTierName: true, bookmarkQuota: true },   // ← 与 QuotaService 同源
    });
    // 判定优先级必须与 applyUserTierQuotas 完全一致，否则出现“付费但被拒”
    if (!u?.manualTierName && /* 无 active 订阅 */) throw new TRPCError({ code: "FORBIDDEN" });
    return opts.next();
  });
}
```

关键约束（来自现有代码，必须遵守）：

- **判定优先级必须复用 `getActivePaidSubscriptionProvider`**（`packages/trpc/lib/subscriptionEntitlements.ts:15-38`），否则会与 `applyUserTierQuotas` 的分支顺序打架（付费 > 手工 > 免费，`50-87`）。
- **不要直接查 `subscriptions`**，除非同时处理 IAP（两表取或）。
- 中间件要放在 `authedProcedure` 之后、`createEventLogMiddleware` 之前/之后均可，但**必须在 mutation 的 `input()` 之前**，以便尽早拒绝。
- 若要做“降级后立即失效”，需在 session 读取处加入 tier 快照（`apps/web/server/auth.ts:580-612` 是唯一投影点），否则只能等 `users` 列更新。

### 8.3 支付回调端点建议

现状已有两个入口（保留即可，不建议重写）：

| 入口 | 现状 | 证据 |
|---|---|---|
| `POST /api/webhooks/stripe` | 取 `stripe-signature` → `subscriptions.handleWebhook` → `stripe.webhooks.constructEvent` 验签 → 白名单事件 → 按 `customer` 回源同步 | `packages/api/routes/webhooks.ts:14-44`、`packages/trpc/routers/subscriptions.ts:821-867`、`61-80` |
| `POST /api/webhooks/revenuecat` | 取 `authorization` 头 → 共享 token 比对 → 事件仅作触发器，状态一律回源 RevenueCat | `packages/api/routes/webhooks.ts:45-71`、`subscriptions.ts:754-819`、`packages/trpc/lib/revenueCat.ts` |

已有优点：**不信任事件体**（只当触发信号，`subscriptions.ts:791-806`），因此事件重放/字段伪造的影响被压到最小；Stripe 侧还有 `allowedEvents` 白名单（`61-80`）。

建议补齐的 5 项（按优先级）：

1. **幂等表**：新增 `webhookEvents(provider, eventId, receivedAt, processedAt)`，在 `processEvent` 前 `insert ... on conflict do nothing`（当前 `packages/trpc/routers/subscriptions.ts:301-321` 无幂等控制，重复事件会重复回源）。
2. **显式 200 语义**：目前 `handleWebhook` 内部错误统一转 500（`857-866`），Stripe 会重试——这是对的；但 `unknown customer` 时 `syncStripeDataToDatabase` 只 `console.warn` 并返回（`139-147`），应改成“记录并 200”，避免 Stripe 无意义重试。
3. **多 Provider 抽象**：新增 `POST /api/webhooks/:provider`，用 `provider → { verify(rawBody, headers), toSubject(event) }` 的注册表替换两条 if 分支；这样接 Paddle/LemonSqueezy 时不必再动 `packages/api/index.ts:93`。
4. **订阅变更事件入审计流**：`logEvent` 已覆盖 `subscription.synced / webhook_received / checkout_started / portal_opened`（`subscriptions.ts:122, 316, 442, 569`），建议把 `transition`（upgrade/downgrade/…，`91-116`）作为独立字段落库，供财务对账。
5. **回调端点限流与来源限制**：两个 webhook 目前**无限流**（`packages/api/routes/webhooks.ts` 全文件无 `createRateLimitMiddleware`），虽有验签兜底，建议按 IP 加一个宽松窗口（如 600/60s），防止构造大量无效签名打满 `constructEvent` 的 CPU。

### 8.4 商业化改造清单（可直接排期）

| # | 改造 | 落点 | 说明 |
|---|---|---|---|
| B1 | 新增 `createPaidProcedure` / `createTierProcedure(tier)` | `packages/trpc/index.ts` 旁 | 见 8.2；判定复用 `isPaidStatus` + `getActivePaidSubscriptionProvider` |
| B2 | 在 `clientConfig` 暴露 `tier` 与 `features[]` | `packages/shared/types/config.ts:3-53`、`routers/config.ts:7` | 前端做付费墙需要，当前只有 `stripe.isConfigured` |
| B3 | 订阅降级即时生效 | `apps/web/server/auth.ts:580-612` | 在 session 投影处带 tier 快照，或在 `createPaidProcedure` 内实时判定（B1 已覆盖） |
| B4 | webhook 幂等 + 多 provider | 新表 + `packages/api/routes/webhooks.ts` | 见 8.3 第 1、3 项 |
| B5 | API key 与订阅绑定 | `packages/shared/types/apiKeys.ts:3-27` | 现有 scope 是资源粒度，缺 `plan` 维度；建议在 `apiKeys` 表加 `tierAtCreation` 仅作审计，不做运行时门禁（避免与 B1 重复判定） |
| B6 | 邀请码加过期（安全前置） | `packages/db/schema.ts:905-917` | 商业化后邀请码=付费席位，必须可过期可审计（对应 R6） |
| B7 | 列表移除权限收紧 | `packages/trpc/routers/lists.ts:146` | 对应 R1，多租户协作场景会放大该问题 |
| B8 | OpenAPI 补支付/RSS/公开资产端点 | `packages/open-api/index.ts:10-33` | 商业化后第三方集成依赖契约完整性（当前 56 条 path 缺 7 类端点） |

---

## 附录 A：证据索引（按文件）

- `packages/trpc/index.ts`：context/授权构造器/错误格式/限流挂载
- `packages/trpc/auth.ts`：API key 生成与校验、bcrypt、密码兼容
- `packages/trpc/email.ts`：5 类邮件（验证/邀请/重置/列表邀请/问题报告）
- `packages/trpc/stats.ts`：Prometheus 指标（队列、用户、订阅、资产、书签、tRPC）
- `packages/trpc/routers/_app.ts`：19 router 聚合
- `packages/trpc/routers/bookmarks.ts`（1670 行）：16 procedure + 搜索融合 + 语义限流
- `packages/trpc/models/bookmarks.ts`：`bareFromId` / `isAllowedToAccessBookmark` / `loadMulti` / `asZBookmark`
- `packages/trpc/models/lists.ts`（1306 行）：三级权限、协作者、RSS token、`forBookmark`
- `packages/trpc/lib/subscriptionEntitlements.ts`：tier → 配额物化
- `packages/api/index.ts`：Hono 路由树
- `packages/api/middlewares/{auth,apiKeyScopes,rateLimit,trpcAdapter,readOnlyMode}.ts`：REST 侧横切
- `packages/api/routes/*.ts`：67 个端点的实现
- `packages/open-api/index.ts` + `lib/*.ts`：56 条 path 的规格生成
- `packages/shared/{ratelimiting,storageQuota,plugins,search,vectorStore,queueing,assetdb,inference,signedTokens,config}.ts`：扩展点与配额契约
- `packages/shared-server/src/{plugins.ts,services/quotaService.ts}`：插件加载顺序、配额服务
- `apps/web/server/auth.ts`：better-auth 配置、限流表、admin 判定
- `apps/web/server/api/client.ts`：context 双通道装配
- `packages/db/schema.ts`：`session`/`apiKey`/`invites`/`subscriptions`/`inAppSubscriptions`
