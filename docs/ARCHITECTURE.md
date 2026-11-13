# 架构设计 ARCHITECTURE

> 基线：Karakeep `fc22787`。本文件描述**现状（As-Is）**与**目标（To-Be）**两套架构，并标注每一项改动的落点。
> 证据：`docs/audit/01-database.md`、`02-api-auth.md`、`03-workers-jobs.md`、`04-web-frontend.md`、`05-ai-search.md`

---

## 1. 一句话架构

**单进程 Web（Next.js 16 + Hono） + 单进程 Workers + SQLite（业务库 + 队列） + Meilisearch（全文与向量） + Headless Chrome（抓取）**，通过插件系统在五类后端（资产存储 / 搜索 / 队列 / 限流 / 向量）上可替换。

这是「单机可跑、Docker 一行起、无需外部中间件」的架构——正是个人知识管理产品最需要的形态。我们**保留**它，不引入 Postgres/Kafka/Redis 作为必需依赖。

---

## 2. As-Is 部署拓扑

```mermaid
graph TB
  subgraph Client["客户端"]
    WEB["Web / PWA<br/>Next.js 16.4.1"]
    EXT["浏览器扩展<br/>Chrome/Edge"]
    MOB["移动端<br/>Expo RN 0.86"]
    CLI["CLI / MCP Server"]
  end

  subgraph Node["Node 运行时"]
    NEXT["apps/web<br/>Next App Router + Hono @ /api"]
    WORK["apps/workers<br/>12 个队列消费者"]
  end

  subgraph Infra["基础设施"]
    DB[("SQLite<br/>DATA_DIR/*.db")]
    MEILI[("Meilisearch<br/>bookmarks / bookmarks_vectors")]
    CHROME["Headless Chrome<br/>BROWSER_WEB_URL :9222"]
    FS[("资产存储<br/>filesystem / S3")]
  end

  WEB & EXT & MOB & CLI -->|HTTP/JSON, tRPC, REST v1| NEXT
  NEXT -->|Drizzle ORM| DB
  NEXT -->|入队| DB
  NEXT -->|查询| MEILI
  WORK -->|消费| DB
  WORK -->|CDP 抓取| CHROME
  WORK -->|写索引/向量| MEILI
  WORK -->|读写信箱| FS
  NEXT --> FS
```

**关键事实（均有代码证据）**

| 事实 | 证据 |
|---|---|
| 单一 Hono 应用挂在 Next 的 `/api` 下 | `apps/web/app/api/[[...route]]/route.ts:21` → `packages/api/index.ts:86-93` |
| REST **不绕过** tRPC，而是进程内 `createCallerFactory` 调 procedure | `packages/api/middlewares/auth.ts:9-37`、`routes/bookmarks.ts:56-63` |
| 队列后端是 SQLite 队列（liteque），可换 restate | `packages/shared-server/src/queues.ts`、`plugins/queue-liteque`、`plugins/queue-restate` |
| 向量不进 SQLite，写 Meilisearch 独立索引 | `plugins/vectorstore-meilisearch`、`embeddingsWorker.ts` |
| 混合检索在应用层做 RRF，不在 Meili 里做 | `packages/trpc/routers/bookmarks.ts:1157-1180`、`searchRanking.ts:13-47` |
| 订阅状态被物化进 `users` 列，热路径不查订阅表 | `lib/subscriptionEntitlements.ts:11-87`、`quotaService.ts:25-123` |

---

## 3. 请求链路（同步）

```mermaid
sequenceDiagram
  participant B as 浏览器
  participant N as Next App Router
  participant H as Hono /api
  participant T as tRPC Procedure
  participant M as models/*.ts
  participant D as SQLite (Drizzle)

  B->>N: 页面请求（RSC）
  N->>T: 服务端 caller（部分页面直连）
  N-->>B: HTML + RSC payload
  B->>H: tRPC / REST 调用
  H->>H: auth 中间件（Bearer API key 优先 → cookie session 回落）
  H->>T: createCaller
  T->>T: 权限构造器（public / authed / scoped / admin）
  T->>M: 业务函数
  M->>D: Drizzle 查询（强制 userId 过滤）
  D-->>M: rows
  M-->>T: 领域对象
  T-->>H: 结果 / TRPCError
  H-->>B: JSON（REST 侧由 trpcAdapter 转 HTTPException）
```

**权限构造器**（`packages/trpc/index.ts:133-237`）：

| 构造器 | 语义 | 限流 |
|---|---|---|
| `publicProcedure` | 匿名可访问 | 1000/min |
| `authedProcedure` | 登录用户 | 3000/min |
| `createScopedAuthedProcedure(resource)` | query→`read`，mutation→`readwrite` | — |
| `sessionProcedure` | 拒绝 API key，仅 session | — |
| `createAdminScopedProcedure` | scope + `role === admin` | — |

---

## 4. 异步链路（收藏全生命周期）

```mermaid
sequenceDiagram
  participant U as 用户/扩展
  participant W as Web(tRPC)
  participant Q as 队列(SQLite)
  participant C as crawlerWorker
  participant P as 解析子进程
  participant I as inferenceWorker
  participant E as embeddingsWorker
  participant S as searchWorker
  participant M as Meilisearch

  U->>W: bookmarks.create(url)
  W->>W: 归一化 + 去重检查 + 配额
  W->>Q: link_crawler_queue.enqueue
  W-->>U: 立即返回 bookmark(id, status=loading)
  Q->>C: 消费
  C->>C: 域名限速
  C->>C: 类型探测(GET, 2MB 上限)
  alt 是 PDF/图片
    C->>C: handleAsAssetBookmark → asset_preprocessing_queue
  else 是网页
    C->>C: crawlPage（CDP + SSRF + adblock + autoconsent）
    C->>P: 解析（metascraper → Defuddle/Readability → DOMPurify）
    C->>C: 元数据落库 + 正文落库
    C->>C: monolith 全页归档
  end
  C->>Q: 派发 openai_queue / embeddings_queue / search_indexing / webhook / video
  Q->>I: 标签 + 摘要
  Q->>E: 向量（写 Meilisearch）
  Q->>S: 全文索引
  S->>M: 写入 bookmarks
  E->>M: 写入 bookmarks_vectors
```

### 已知缺陷（必须在 Phase 3 修）

| 缺陷 | 影响 | 证据 | 修法 |
|---|---|---|---|
| `enqueuePostCrawlJobs` 在归档**之前**执行 | 归档失败 → 整 job 重试 → 重复推断 + 重复 webhook（无幂等键） | `crawlerWorker.ts:472` vs `:475-485` | 归档前置，或给后置作业加幂等键 |
| 默认并发全为 1 | 单慢域名占满 crawler；单慢 webhook 阻塞全站 | `config.ts:139-146` | 按队列类型分别提高并发 |
| `restate` 后端 `cancelAllNonRunning()` 未实现 | 管理端统计恒 0、批量取消失效 | `queue-restate/src/index.ts:72-94` | 锁死 liteque 为默认，restate 标注实验 |
| 首次抓取无幂等键 | 用户连点会产生重复任务 | `bookmarks.ts:506-511` | 用 URL 归一化 + 时间窗去重 |
| 只监听 SIGTERM，不等待在飞作业 | 部署重启丢任务 | `exit.ts:5-11`、`index.ts:188-194` | 优雅退出的 drain 窗口 |

---

## 5. 数据层总览

详细表结构见 [DATABASE_DESIGN](DATABASE_DESIGN.md)。要点：

- **33 张表**，全部在 `packages/db/schema.ts`；
- **97 个迁移**，`packages/db/drizzle/0096_*` 为最新；
- 单一 SQLite 文件（WAL），队列与业务共库或分库取决于插件；
- 用户隔离靠 `userId` 列 + 外键，所有单用户查询强制过滤；
- 共享列表是唯一跨用户读通路，且做了字段级脱敏。

---

## 6. 插件与扩展点

```mermaid
graph LR
  P["globalThis 插件注册表<br/>shared/plugins.ts"] --> A[assetstore]
  P --> S[search]
  P --> Q[queue]
  P --> R[ratelimit]
  P --> V[vectorstore]
  A --> A1[filesystem]
  A --> A2[S3]
  S --> S1[meilisearch]
  Q --> Q1[liteque]
  Q --> Q2[restate]
  R --> R1[memory]
  R --> R2[redis]
  V --> V1[meilisearch]
```

规则：**last-one-wins**，加载顺序决定覆盖关系（`shared-server/src/plugins.ts:24-39`）。

**没有** Inference 插件类型——AI provider 走 `inference.ts` 的硬编码分支（`210-250`）。这是我们要补的第六类插件。

---

## 7. To-Be 架构（灵感仓）

### 7.1 新增的六个模块

```mermaid
graph TB
  subgraph New["新增层"]
    REG["AI Provider Registry<br/>packages/shared/ai/registry.ts"]
    CHUNK["语义分块<br/>packages/shared/ai/chunking.ts"]
    RAG["RAG 引擎<br/>packages/shared/ai/rag/*"]
    GRAPH["知识图谱提取<br/>apps/workers/workers/entityWorker.ts"]
    METER["用量计量<br/>packages/shared/ai/metering.ts"]
    ENT["权益门禁<br/>packages/trpc/lib/entitlements.ts"]
  end
  REG --> CHUNK --> RAG --> GRAPH
  METER --> ENT
  RAG -.->|写引用| DB[(chatMessages.metadata)]
  GRAPH -.->|写实体| DB2[(entities / entityEdges)]
  ENT -.->|读 users.tier| DB
```

| 模块 | 位置 | 依赖的上游结构 |
|---|---|---|
| Provider Registry | `packages/shared/ai/registry.ts` | 复用 `inference.ts` 的 `InferenceClient` / `EmbeddingClient` 接口 |
| 语义分块 | `packages/shared/ai/chunking.ts` | 新表 `bookmarkChunks`（迁移 0097+） |
| RAG | `packages/shared/ai/rag/{retrieve,compose,cite}.ts` + `trpc/routers/chat.ts` | 复用 `chatSessions` / `chatMessages`（迁移 0088 已建） |
| 知识图谱 | `apps/workers/workers/entityWorker.ts` + `trpc/routers/graph.ts` | 新表 `entities` / `entityEdges` |
| 用量计量 | `packages/shared/ai/metering.ts` + `aiUsage` 表 | 复用 `eventLogger` 思路 |
| 权益门禁 | `packages/trpc/lib/entitlements.ts` | 复用 `users.tier` 三列物化设计 |

### 7.2 推理接口改造（RAG 的前置）

现状接口只接受**单条 prompt / 单条 user message，无 streaming**，这是 RAG 长不出来的根因（`inference.ts:130-140`、`:344`）。

```ts
// 目标接口（保持向后兼容：旧签名变为 messages 的单元素特例）
interface ChatMessage { role: "system" | "user" | "assistant" | "tool"; content: string; }

interface InferenceClient {
  chat(req: { messages: ChatMessage[]; temperature?: number; maxTokens?: number;
              stream?: boolean; jsonSchema?: object }): Promise<ChatResult> | AsyncIterable<ChatChunk>;
  capabilities(): { text: boolean; vision: boolean; json: boolean; streaming: boolean };
}
```

### 7.3 检索架构（目标）

```mermaid
graph LR
  Q["用户查询"] --> P["searchQueryParser<br/>（操作符解析）"]
  P --> F["全文腿<br/>Meili bookmarks"]
  P --> V["向量腿<br/>Meili bookmarks_vectors（chunk 级）"]
  P --> K["结构化腿<br/>SQLite（tag/list/date）"]
  F --> RRF["RRF 融合 k=60"]
  V --> RRF
  K --> RRF
  RRF --> RR["可选 rerank"]
  RR --> AGG["chunk → bookmark 聚合"]
  AGG --> OUT["结果 + 命中片段"]
```

与现状的差异：**向量从「文档级」升级为「块级」**，并新增聚合与片段高亮。

### 7.4 商业化门禁

```mermaid
sequenceDiagram
  participant C as 客户端
  participant P as 付费 procedure
  participant E as entitlements
  participant U as users(tier/配额)
  participant Q as aiUsage
  C->>P: AI 请求
  P->>E: requireFeature(userId, "ai_chat")
  E->>U: 读 tier + 已用量
  alt 额度充足
    E-->>P: allow
    P->>Q: 记录用量（token/模型/延迟）
    P-->>C: 正常响应
  else 超额
    E-->>P: deny(reason=quota)
    P-->>C: 402/403 + 升级引导
  end
```

---

## 8. 部署形态

### 8.1 单机（默认，Phase 1–8）

```yaml
services:
  web:        # Next standalone，:3000
  workers:    # 队列消费者，无端口
  meilisearch: # :7700，持久卷
  chrome:     # CDP :9222
volumes:
  data:       # DATA_DIR：SQLite + 资产
  meilisearch:
```

环境变量见 [TECHNICAL_AUDIT](TECHNICAL_AUDIT.md) §7。

### 8.2 生产（Phase 9 目标）

| 关注点 | 方案 |
|---|---|
| 反向代理 | Caddy/Nginx，TLS 终止 |
| 备份 | `backup_queue` 定时导出 + 卷快照 |
| 可观测 | OTEL traces（已有 `tracing.ts`）+ 结构化日志 + `/api/metrics` |
| 扩容 | Web 无状态可横向；Workers 按队列拆进程；Meilisearch 独立实例 |
| 多租户 | 单实例内多用户（已支持）；单用户单实例（自托管）两种模式 |

---

## 9. 跨端架构

```mermaid
graph TB
  subgraph Shared["共享层"]
    T["@karakeep/shared（类型/工具/import-export）"]
    TR["@karakeep/trpc（API 契约）"]
    SR["@karakeep/shared-react（hooks + 少量 UI）"]
  end
  WEB["apps/web"] --> T & TR & SR
  MOB["apps/mobile"] --> T & TR & SR
  EXT["apps/browser-extension"] --> T & TR
  CLI["apps/cli"] --> T & TR
  MCP["apps/mcp"] --> T & TR
```

**必须遵守的跨端规则**：

1. 业务逻辑只写在 `packages/trpc` 与 `packages/shared`，客户端不复制；
2. 数据模型只在 `packages/db` 定义，客户端从 tRPC 类型推导；
3. 跨端共享的 UI 只有 Button/Popover/Textarea/BookmarkHtmlHighlighter——**共享 UI 的 token 必须两端一致**（当前不一致，见 [UI_DESIGN_SYSTEM](UI_DESIGN_SYSTEM.md) §2.4）。

---

## 10. 安全与隔离（架构级约束）

| 约束 | 实现 | 验证 |
|---|---|---|
| 所有单用户查询带 `userId` | models/*.ts | CODE REVIEW + E2E 越权用例 |
| 共享列表字段级脱敏 | `models/bookmarks.ts:810-823`、`highlights.service.ts:43-52` | 单测 |
| AI Key 只在服务端 | `config.ts` 读取，客户端只拿布尔 | 单测（序列化检查） |
| 抓取 SSRF 防护 | `network.ts` 子请求校验 | 单测（已有 `network.test.ts`） |
| 上传类型/大小校验 | asset 路由 + 配额 | E2E |
| 限流 | `plugins/ratelimit-*`（**当前默认关闭**） | 需在 Phase 3 打开 |

**已知待修**：`lists.removeFromList` 缺 `ensureBookmarkOwnership`（`routers/lists.ts:146-157`），editor 可移除他人加入的条目——Phase 7 前必须修。

---

## 11. 技术债清单（按优先级）

| # | 债务 | 影响 | 阶段 |
|---|---|---|---|
| 1 | 后置作业先于归档，无幂等 | 重复推断/重复 webhook | 3 |
| 2 | 限流默认关闭 | 成本裸奔 | 3 |
| 3 | 无分块 | 长文检索质量差、RAG 不可用 | 5 |
| 4 | 推理接口无 messages/streaming | RAG 不可实现 | 5 |
| 5 | 前端 338 处硬编码色 + 387 任意值 | 品牌化无法收敛 | 2 |
| 6 | i18n 覆盖不全（200 个 tsx 无引用） | 中文体验割裂 | 2 |
| 7 | 主色明暗不一致 + 跨端 token 冲突 | 品牌不一致 | 2 |
| 8 | e2e 依赖英文可访问名 | 文案一改全红 | 2 |
| 9 | `restate` 后端能力缺口 | 迁移后管理端失真 | 9 |
| 10 | 邀请码永不过期 | 付费席位不可审计 | 7 |
