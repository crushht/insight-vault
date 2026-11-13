# AI 与搜索审计

> 审计对象：`E:\fork\2\insight-vault`（Karakeep 完整快照，commit `fc22787`）
> 审计方式：只读源码通读 + 调用链追踪，未修改任何源码
> 审计范围：AI 推理、嵌入、搜索、RAG/对话、图片与 PDF 理解、用量与隔离
> 产出：第四阶段「AI 知识引擎」地基评估

---

## 0. 结论速览

| 结论 | 判定 | 关键证据 |
| --- | --- | --- |
| Provider 抽象层 | 只有 **OpenAI 兼容** 与 **原生 Ollama** 两条实现，二选一，无插件化 provider 注册表 | `packages/shared/inference.ts:210-221`、`packages/shared/inference.ts:307-597` |
| 模型能力分类 | 文本 / 视觉 / 嵌入 三档模型分开配置；**OCR 无独立模型**（LLM OCR 复用视觉模型）；**对话模型是死配置** | `packages/shared/config.ts:86-91`、`packages/shared/config.ts:390`、`packages/shared/inference.ts:566-582` |
| 嵌入存储 | 不落库。向量写入 Meilisearch 独立索引 `bookmarks_vectors`（userProvided embedder），一文档一向量 | `packages/plugins/vectorstore-meilisearch/src/index.ts:153`、`:240-287`、`apps/workers/workers/embeddingsWorker.ts:376-387` |
| 分块 | **不存在分块**。整篇压成单条文本 → 单个向量 | `apps/workers/workers/embeddingsWorker.ts:257-345`、`:458-460` |
| 混合检索 | Meilisearch 侧是 **纯向量**（`semanticRatio: 1.0`）；混合由 **应用层 RRF** 对「全文 top100 + 向量 top100」融合实现 | `packages/plugins/vectorstore-meilisearch/src/index.ts:80-91`、`packages/trpc/routers/bookmarks.ts:1157-1180`、`packages/trpc/lib/searchRanking.ts:13-47` |
| Chat / RAG | **不存在**。仅有两张空表 + 两个未被消费的 env | `packages/db/schema.ts:686-725`、`packages/shared/config.ts:81-82`、`packages/trpc/routers/_app.ts:22-42` |
| 引用（citations） | 无 | 同上（无任何 chat/citation 代码路径） |
| 流式输出 | 无（Ollama 客户端内部流式仅为规避 ollama-js 的 bug） | `packages/shared/inference.ts:508-548` |
| 自动标签 | 已具备，含标签风格 / 白名单 / 相似书签标签增强 / 先删后插 | `apps/workers/workers/inference/tagging.ts:630-739`、`:479-507` |
| 自动摘要 | 已具备但**仅对 LINK 生效**，且默认关闭 | `apps/workers/workers/inference/summarize.ts:98-127`、`packages/shared/config.ts:109` |
| AI 分类（taxonomy）| **缺失**，全仓库无分类模型/字段 | grep `classify|category` 无业务命中 |
| 关键词抽取 | **缺失**（标签代理部分职能） | `packages/shared/prompts.ts:54-92` 仅 tags |
| 用量统计 | **缺失**，token 只进日志与 OTEL，无表、无聚合、无配额 | `apps/workers/workers/inference/summarize.ts:172-179`、`packages/shared-server/src/eventLogTypes.ts:21-47`、`apps/workers/metrics.ts:16-20` |
| 用户隔离（检索/向量/标签） | **已具备**，三处均以 `userId` 过滤 | `packages/trpc/routers/bookmarks.ts:1028`、`:1125-1129`、`apps/workers/workers/inference/tagging.ts:561-567` |

需求差距总账：**11 项需求 → 已具备 3 / 部分具备 5 / 缺失 3**（明细见 §9）。

---

## 1. AI Provider 架构（含时序）

### 1.1 抽象层形状

推理层只有两个窄接口，没有任何「provider 注册表」概念：

```ts
// packages/shared/inference.ts:125-140
export interface EmbeddingClient {
  generateEmbeddingFromText(inputs: string[]): Promise<EmbeddingResponse>;
}
export interface InferenceClient extends EmbeddingClient {
  inferFromText(prompt, opts): Promise<InferenceResponse>;
  inferFromImage(prompt, contentType, image, opts): Promise<InferenceResponse>;
}
```

- 返回值只有 `{ response, totalTokens }` / `{ embeddings, totalTokens, promptTokens }`：`packages/shared/inference.ts:10-19`
- 可选参数只有 `schema` 与 `abortSignal`：`packages/shared/inference.ts:115-123`
- 因此**没有**：system prompt 位、多轮 messages 位、温度/推理参数位、工具调用位、流式回调位。这是「单轮文本进、单段文本出」的形态，直接决定了 RAG 对话无法在现有接口上长出来。

### 1.2 工厂与选择优先级

```ts
// packages/shared/inference.ts:210-221
static build(): InferenceClient | null {
  if (serverConfig.inference.openAIApiKey) return OpenAIInferenceClient.fromConfig();
  if (serverConfig.inference.ollamaBaseUrl) return OllamaInferenceClient.fromConfig();
  return null;
}
```

- **硬优先级**：`OPENAI_API_KEY` 存在时 Ollama 永远不生效（官方文档同样提示 "MAKE SURE YOU DON'T HAVE OPENAI_API_KEY set, otherwise it takes precedence"，`docs/docs/03-configuration/02-different-ai-providers.md:53`）。
- 嵌入客户端多一层解耦：`EMBEDDING_OPENAI_API_KEY` / `EMBEDDING_OPENAI_BASE_URL` 任一存在即走独立 `OpenAIEmbeddingClient`，API Key 回落到 `OPENAI_API_KEY`；否则整体回落到推理工厂：`packages/shared/inference.ts:223-250`。
  - 这意味着**可以**做「文本用 Ollama、嵌入用 OpenAI」这类混搭，但**不能**做「文本用 provider A、视觉用 provider B」。
- 未配置任何 provider 时返回 `null`，调用方一律「静默跳过」而非报错：`apps/workers/workers/inference/inferenceWorker.ts:86-92`、`apps/workers/workers/embeddingsWorker.ts:429-438`、`apps/workers/workers/searchWorker.ts:161-167`。
- 超时与代理统一走 undici 自定义 fetch（长连接池复用）：`packages/shared/customFetch.ts:1-45`、`packages/shared/inference.ts:192-208`。

### 1.3 OpenAI 兼容实现

| 关注点 | 行为 | 证据 |
| --- | --- | --- |
| 端点 | `new OpenAI({ apiKey, baseURL })`，兼容 OpenAI / Ollama `/v1` / Gemini / OpenRouter / LM Studio | `packages/shared/inference.ts:192-208` |
| 请求头 | 固定注入 `X-Title: Karakeep`、`HTTP-Referer`（OpenRouter 排行用） | `packages/shared/inference.ts:198-201` |
| 文本调用 | 单条 `user` message，无 system 角色 | `packages/shared/inference.ts:344` |
| 视觉调用 | `image_url` + `data:<ct>;base64,<img>`，**`detail: "low"` 硬编码** | `packages/shared/inference.ts:396-403` |
| 输出上限 | `useMaxCompletionTokens ? max_completion_tokens : max_tokens` | `packages/shared/inference.ts:349-351` |
| 推理强度 | 透传 `reasoning_effort` | `packages/shared/inference.ts:356` |
| 服务档 | 透传 `service_tier` | `packages/shared/inference.ts:346-348` |
| 空响应容忍 | 文本调用 `allowEmpty=false`；视觉调用在 `schema===null`（如 OCR）时允许空串 | `packages/shared/inference.ts:363-365`、`:416-418` |

`detail: "low"` 是一个实际质量瓶颈：图片被降采样后再送模型，小字 OCR 与细节 caption 都会受影响（`packages/shared/inference.ts:401`）。

### 1.4 Ollama 原生实现

- 使用 `ollama.generate`（**completion 形态，不是 chat**），`stream: true` + 手工拼接收敛：`packages/shared/inference.ts:495-529`。
- 结构化输出用 Zod 4 原生 `z.toJSONSchema`：`packages/shared/inference.ts:497-507`。
- 上下文与输出上限映射为 `options.num_ctx` / `options.num_predict`：`packages/shared/inference.ts:510-513`。
- `keep_alive` 可配：`packages/shared/inference.ts:509`。
- 嵌入调用 `truncate: true`，并在注释里承认「未来要做分片，目前先截断」：`packages/shared/inference.ts:587-593`——这是分块缺失的第二处自我承认。
- 已知 ollama-js bug 的规避：出错时保留已累积内容继续反序列化，token 数置 `NaN`：`packages/shared/inference.ts:530-540`。

### 1.5 结构化输出策略

三种模式，由 `INFERENCE_OUTPUT_SCHEMA` 决定（默认 `structured`）：

```ts
// packages/shared/inference.ts:152-168
structured → zodResponseFormat(schema, "schema")
json       → { type: "json_object" }
plain      → undefined
```

- `INFERENCE_SUPPORTS_STRUCTURED_OUTPUT=true/false` 会覆盖成 `structured`/`plain`：`packages/shared/config.ts:406-411`。
- 调用方只在打标签时传 schema（`z.object({ tags: z.array(z.string()) })`）：`apps/workers/workers/inference/tagging.ts:43-45`；摘要显式 `schema: null`：`apps/workers/workers/inference/summarize.ts:161-164`。
- 即便有结构化输出，标签侧仍保留**三层容错 JSON 解析**（整体 parse → ```json 代码块 → 首尾花括号切片）：`apps/workers/workers/inference/tagging.ts:47-81`。这是对「模型不守格式」的补偿，也说明结构化输出并非全链路可信。

### 1.6 错误处理与重试分层

| 层 | 机制 | 证据 |
| --- | --- | --- |
| HTTP（OpenAI 分支） | undici `headersTimeout`/`bodyTimeout` = `OPENAI_TIMEOUT_SEC`；未设置时回落到 OpenAI SDK 默认 600s（**不是** `INFERENCE_FETCH_TIMEOUT_SEC`），可挂代理 | `packages/shared/inference.ts:192-208`、`packages/shared/customFetch.ts:9-45` |
| HTTP（Ollama 分支） | 固定使用 `INFERENCE_FETCH_TIMEOUT_SEC`（默认 300s） | `packages/shared/inference.ts:459-462`、`packages/shared/config.ts:85` |
| OpenAI 语义错误 | 显式区分 `refusal` / `finish_reason==="length"`（提示调大 `INFERENCE_MAX_OUTPUT_TOKENS`）/ 其它空响应 | `packages/shared/inference.ts:279-305` |
| 嵌入维度 | 逐条校验长度 vs `EMBEDDING_DIMENSIONS`，不一致直接抛错 | `packages/shared/inference.ts:31-40` |
| 作业层 | `OpenAIQueue` 3 次重试、`EmbeddingsQueue` 3 次、`SearchIndexingQueue` 5 次 | `packages/shared-server/src/queues.ts:130-135`、`:165-173`、`:183-191` |
| 状态回写 | 重试耗尽才写 `taggingStatus`/`summarizationStatus`/`embeddingStatus='failure'` | `apps/workers/workers/inference/inferenceWorker.ts:60-70`、`apps/workers/workers/embeddingsWorker.ts:48-66` |
| 降级 | 向量/嵌入不可用时，混合检索自动降级为全文检索 | `packages/trpc/routers/bookmarks.ts:1069-1078`、`:1114-1115` |
| 取消 | `AbortSignal` 从作业一路透传；Ollama 额外绑定 `ollama.abort()` | `packages/shared/inference.ts:488-494`、`:541-545` |

值得注意的**语义缺口**：嵌入失败时仍会补发一次「无向量」的打标签任务，避免书签永久无标签：`apps/workers/workers/embeddingsWorker.ts:59-64`、`:128-148`。这是业务连续性设计，不是通用重试策略。

### 1.7 token 统计现状

- 非流式（OpenAI）：直接取 `chatCompletion.usage.total_tokens`：`packages/shared/inference.ts:366`、`:419`。
- 流式（Ollama）：累加 `eval_count + prompt_eval_count`：`packages/shared/inference.ts:518-529`。
- 嵌入：优先 `usage.prompt_tokens/total_tokens`，Ollama 回落到 `prompt_eval_count`/`eval_count`：`packages/shared/inference.ts:86-113`。
- **终点是日志，不是数据库**：`addLogFields({"inference.total_tokens": ...})`。见 `apps/workers/workers/inference/summarize.ts:172-179`、`apps/workers/workers/inference/tagging.ts:401-404`、`packages/trpc/routers/bookmarks.ts:1639-1642`。
- 事件日志 schema 里确实有 `inference.total_tokens` 字段，但没有按用户累计的物化：`packages/shared-server/src/eventLogTypes.ts:21-47`。
- Prometheus 只统计作业成功/失败次数，无 token、无时延、无成本：`apps/workers/metrics.ts:16-20`。

### 1.8 端到端时序（一次书签入库）

```
用户/API/扩展
   │  POST bookmarks.createBookmark
   ▼
[trpc] bookmarks.createBookmark                      packages/trpc/routers/bookmarks.ts:259-559
   ├─ LINK  → LinkCrawlerQueue.enqueue                :506-511
   ├─ TEXT  → EmbeddingsQueue(embed, runTaggingOnComplete)   :515-523
   │         └ 若未开启自动索引 → OpenAIQueue(tag)      :524-532
   └─ ASSET → AssetPreprocessingQueue(fixMode=false)   :535-544

[workers] crawlerWorker.enqueuePostCrawlJobs          apps/workers/workers/crawlerWorker.ts:1767-1808
   ├─ enableAutoIndexing ? EmbeddingsQueue(embed) : OpenAIQueue(tag)   :1780-1797
   ├─ OpenAIQueue(summarize)                          :1798-1804
   └─ triggerSearchReindex(bookmarkId)                :1807-1808

[workers] EmbeddingsWorker.runEmbed                   apps/workers/workers/embeddingsWorker.ts:399-499
   ├─ fetchBookmark(link/text/asset + tags)           :150-164
   ├─ buildEmbeddingText(单条文本，≤8k 字符)           :257-345
   ├─ EmbeddingClientFactory.build()                  :429-438
   ├─ generateEmbeddingFromText([text]) ──► Provider  :458-460
   │        （OpenAI /v1/embeddings 或 Ollama /api/embed）
   ├─ EmbeddingsQueue(index, vector)                  :480-491
   │        └ Meilisearch bookmarks_vectors.addVectors  packages/plugins/vectorstore-meilisearch/src/index.ts:61-73
   └─ OpenAIQueue(tag, 携带 vector)                    :492-494

[workers] OpenAiWorker.runTagging                     apps/workers/workers/inference/tagging.ts:630-739
   ├─ 用户级开关/风格/白名单/语言                       :649-694
   ├─ getPotentiallyRelevantTags(vector search 近邻)    :551-628
   ├─ buildTextPrompt / buildImagePrompt               :93-142、:144-187
   ├─ inferFromText / inferFromImage ──► Provider      :302-306、:175-186
   ├─ connectTags：删旧 AI 标签 → 建新标签 → 关联        :415-524
   ├─ WebhooksService.triggerWebhook("ai tagged")       :726-735
   └─ triggerSearchReindex                              :737-738

[workers] OpenAiWorker.runSummarization                apps/workers/workers/inference/summarize.ts:48-193
   ├─ 全局开关 + 用户开关双重闸门                        :53-58、:90-95
   ├─ 仅 LINK 分支拼 Title/Description/Content/...      :98-121
   ├─ buildSummaryPrompt(contextLength 截断)            :150-155
   ├─ inferFromText(schema=null)                        :161-164
   └─ UPDATE bookmarks.summary + triggerSearchReindex   :181-192

[workers] SearchIndexingWorker.runIndex                apps/workers/workers/searchWorker.ts:64-141
   └─ Meilisearch index "bookmarks".addDocuments        packages/plugins/search-meilisearch/src/index.ts:51-68
```

### 1.9 该层的结构性局限（改造前必须知道）

1. **无 provider 注册表**：新增 Anthropic/Gemini 原生 SDK 必须改工厂二分逻辑，而不是注册插件（对照检索侧的 `PluginManager`，推理侧没有等价物）。证据：`packages/shared/inference.ts:210-221` vs `packages/shared/plugins.ts:55-110`。
2. **能力与 provider 强耦合**：文本与视觉共用一个客户端、一个 baseURL、一个 API Key（`packages/shared/inference.ts:317-331`）。无法「小模型打标签 + 大模型对话」。
3. **无多轮 messages**：单 `user` message 决定了摘要/标签可以，对话不行（`packages/shared/inference.ts:344`）。
4. **无采样参数**：未设置 temperature/top_p，行为完全取决于 provider 默认值，标签可复现性差。
5. **无 prompt 缓存/前缀复用**：每次都是全新请求，长 prompt（curated tags + 近邻标签 + 正文）重复计费。
6. **无成本/用量闭环**：见 §1.7、§10。

---

## 2. 模型能力矩阵与环境变量

### 2.1 能力矩阵

| 能力 | 是否有专属模型位 | 环境变量 | 默认值 | 实际调用点 |
| --- | --- | --- | --- | --- |
| 文本生成（打标签） | ✅ 独立 | `INFERENCE_TEXT_MODEL` | `gpt-6-luna` | `apps/workers/workers/inference/tagging.ts:298-305` |
| 文本生成（摘要） | ❌ 复用文本模型 | 同上 | 同上 | `apps/workers/workers/inference/summarize.ts:161-164` |
| 视觉理解（打标签） | ✅ 独立 | `INFERENCE_IMAGE_MODEL` | `gpt-4o-mini` | `apps/workers/workers/inference/tagging.ts:172-186` |
| OCR（LLM 路径） | ❌ 复用视觉模型 | `OCR_USE_LLM` + 视觉模型 | `false` | `apps/workers/workers/assetPreprocessingWorker.ts:139-169` |
| OCR（本地路径） | ✅ Tesseract 语言包 | `OCR_LANGS` | `eng` | `apps/workers/workers/assetPreprocessingWorker.ts:120-137` |
| 嵌入 | ✅ 独立（可独立 Key/URL） | `EMBEDDING_TEXT_MODEL` | `text-embedding-3-small` | `packages/shared/inference.ts:259-276`、`:584-597` |
| 嵌入维度 | ✅ | `EMBEDDING_DIMENSIONS` | `1536` | `packages/shared/config.ts:97`、`:645-657` |
| 对话 | ⚠️ 有配置位但**无消费方** | `CHAT_MODEL` | `INFERENCE_TEXT_MODEL`（派生） | `packages/shared/config.ts:390`（全仓库唯一引用） |
| 重排（rerank） | ❌ 不存在 | — | — | grep 无命中 |
| 分类（taxonomy） | ❌ 不存在 | — | — | grep 无命中 |

结论：**三档能力（文本/视觉/嵌入）已分离，OCR 与对话未分离**。OCR 走视觉模型意味着「OCR 想换更准的模型」会连带影响图片打标签质量。

### 2.2 环境变量全表（AI / 检索相关）

#### 推理

| 变量 | 默认 | 含义 | 证据 |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | 无 | 存在即选用 OpenAI 兼容客户端 | `packages/shared/config.ts:71`、`inference.ts:212` |
| `OPENAI_BASE_URL` | 无 | 兼容端点（Ollama `/v1`、Gemini、OpenRouter…） | `config.ts:72` |
| `OPENAI_PROXY_URL` | 无 | 推理专用 HTTP 代理 | `config.ts:73`、`inference.ts:202-207` |
| `OPENAI_TIMEOUT_SEC` | 无（OpenAI SDK 默认 600s） | 单请求超时；**不回落** `INFERENCE_FETCH_TIMEOUT_SEC` | `config.ts:74`、`inference.ts:196-207` |
| `OPENAI_SERVICE_TIER` | 无 | `auto/default/flex` | `config.ts:75`、`inference.ts:346-348` |
| `OPENAI_REASONING_EFFORT` | 无 | `none/minimal/low/medium/high/xhigh` | `config.ts:76-78`、`inference.ts:356` |
| `OLLAMA_BASE_URL` | 无 | 原生 Ollama 端点（次优先级） | `config.ts:79`、`inference.ts:216-218` |
| `OLLAMA_KEEP_ALIVE` | 无 | 模型驻留时长 | `config.ts:80`、`inference.ts:509` |
| `INFERENCE_TEXT_MODEL` | `gpt-6-luna` | 文本模型 | `config.ts:86` |
| `INFERENCE_IMAGE_MODEL` | `gpt-4o-mini` | 视觉模型 | `config.ts:87` |
| `INFERENCE_CONTEXT_LENGTH` | `2048` | **prompt 截断预算（含模板）** | `config.ts:101`、`prompts.server.ts:67-70` |
| `INFERENCE_MAX_OUTPUT_TOKENS` | `2048` | 输出上限 | `config.ts:102` |
| `INFERENCE_USE_MAX_COMPLETION_TOKENS` | 派生（纯 OpenAI 时 `true`） | 新旧参数名切换 | `config.ts:103`、`:400-405` |
| `INFERENCE_SUPPORTS_STRUCTURED_OUTPUT` | 无 | 覆盖 `INFERENCE_OUTPUT_SCHEMA` | `config.ts:104`、`:406-411` |
| `INFERENCE_OUTPUT_SCHEMA` | `structured` | `structured/json/plain` | `config.ts:105-107` |
| `INFERENCE_ENABLE_AUTO_TAGGING` | `true` | 全局自动打标签开关 | `config.ts:108` |
| `INFERENCE_ENABLE_AUTO_SUMMARIZATION` | **`false`** | 全局自动摘要开关（默认关！） | `config.ts:109` |
| `INFERENCE_LANG` | `english` | 标签/摘要输出语言默认值 | `config.ts:186` |
| `INFERENCE_JOB_TIMEOUT_SEC` | `30` | 作业级超时 | `config.ts:84` |
| `INFERENCE_FETCH_TIMEOUT_SEC` | `300` | HTTP 级超时（仅 Ollama 原生分支使用） | `config.ts:85`、`inference.ts:461` |
| `INFERENCE_NUM_WORKERS` | `1` | 推理并发 | `config.ts:140` |

#### 嵌入

| 变量 | 默认 | 含义 | 证据 |
| --- | --- | --- | --- |
| `EMBEDDING_OPENAI_API_KEY` | 无（回落 `OPENAI_API_KEY`） | 嵌入独立凭证 | `config.ts:89`、`inference.ts:229-237` |
| `EMBEDDING_OPENAI_BASE_URL` | 无（回落 `OPENAI_BASE_URL`） | 嵌入独立端点 | `config.ts:90`、`inference.ts:240-242` |
| `EMBEDDING_TEXT_MODEL` | `text-embedding-3-small` | 嵌入模型 | `config.ts:91` |
| `EMBEDDING_TEXT_MODEL_DIMENSION_OVERRIDE` | 无 | 请求侧 `dimensions` 参数，**必须等于 `EMBEDDING_DIMENSIONS`** | `config.ts:92-96`、`:645-657`、`inference.ts:266-270` |
| `EMBEDDING_DIMENSIONS` | `1536` | 向量维度，同时配置 Meili embedder | `config.ts:97`、`vectorstore-meilisearch/src/index.ts:262-280` |
| `EMBEDDING_CONTEXT_LENGTH` | `8000` | **嵌入文本字符预算**（非 token） | `config.ts:98`、`embeddingsWorker.ts:341-344` |
| `EMBEDDING_NUM_WORKERS` | `1` | 嵌入并发 | `config.ts:99`、`embeddingsWorker.ts:69` |
| `EMBEDDING_JOB_TIMEOUT_SEC` | `60` | 嵌入作业超时 + Meili 任务等待上限 | `config.ts:100`、`vectorstore-meilisearch/src/index.ts:132` |
| `EMBEDDING_ENABLE_AUTO_INDEXING` | 派生（纯 OpenAI 时 `true`） | 是否自动建索引；关掉后不生成向量 | `config.ts:88`、`:426-430`、`embeddingsWorker.ts:407-415` |

#### 语义搜索与 OCR

| 变量 | 默认 | 含义 | 证据 |
| --- | --- | --- | --- |
| `SEMANTIC_SEARCH_ENABLED` | `true` | 实验特性开关 | `config.ts:83`、`:419` |
| `CHAT_ENABLED` | **`false`** | 对话开关（**无消费方**） | `config.ts:81`、`:415-417`、`:686-688` |
| `CHAT_MODEL` | 回落文本模型 | 对话模型（**无消费方**） | `config.ts:82`、`:390` |
| `OCR_LANGS` | `eng` | Tesseract 语言包，逗号分隔；空串=禁用 OCR | `config.ts:111-114`、`assetPreprocessingWorker.ts:121-123` |
| `OCR_CONFIDENCE_THRESHOLD` | `50` | 置信度低于此值丢弃结果 | `config.ts:115`、`assetPreprocessingWorker.ts:130-132` |
| `OCR_USE_LLM` | `false` | 用视觉模型做 OCR | `config.ts:116`、`assetPreprocessingWorker.ts:299-309` |
| `OCR_CACHE_DIR` | 无（回落 `os.tmpdir()`） | Tesseract 语言包缓存 | `config.ts:110`、`assetPreprocessingWorker.ts:125-127` |

#### 检索插件（不经 `config.ts`，由插件自读）

| 变量 | 默认 | 含义 | 证据 |
| --- | --- | --- | --- |
| `MEILI_ADDR` / `MEILI_MASTER_KEY` | 无 | 全文搜索 Meilisearch | `packages/plugins/search-meilisearch/src/env.ts:3-9` |
| `MEILI_VECTOR_ADDR` / `MEILI_VECTOR_MASTER_KEY` | 无（回落主实例） | 向量专用 Meilisearch 实例 | `packages/plugins/vectorstore-meilisearch/src/env.ts:3-17` |
| `MEILI_BATCH_SIZE` | `50` | 批量写入文档数 | `packages/plugins/vectorstore-meilisearch/src/env.ts:10` |
| `MEILI_BATCH_TIMEOUT_MS` | `500` | 批量刷写间隔 | `packages/plugins/vectorstore-meilisearch/src/env.ts:11` |

### 2.3 面向客户端的派生配置

`clientConfig` 只暴露极少数布尔值，且**语义搜索开关是三者与的关系**：

```ts
// packages/shared/config.ts:689-694
search: {
  semanticSearchEnabled:
    serverConfig.experimentalFeatures.semanticSearch &&
    serverConfig.embedding.enableAutoIndexing &&
    serverConfig.embedding.isConfigured,
}
```

这导致一个常见坑：用户配了 Key 但 `EMBEDDING_ENABLE_AUTO_INDEXING=false`，UI 上语义搜索直接消失（`apps/web/components/dashboard/search/SearchInput.tsx:82`、`:235`）。而服务端仍可能在 `searchMode` 非 fts 时报 `BAD_REQUEST`（`packages/trpc/routers/bookmarks.ts:1006-1015`）。

### 2.4 配置校验

目前只有一条 AI 相关硬校验（维度覆盖必须与维度一致），其余全部靠「返回 null + 日志」：

- `packages/shared/config.ts:645-657`（`EMBEDDING_TEXT_MODEL_DIMENSION_OVERRIDE` vs `EMBEDDING_DIMENSIONS`）
- 缺失 Key 时仅 `logger.error` 后返回 null：`packages/shared/inference.ts:229-237`
- Meilisearch 版本不达 v1.13 直接禁用向量能力（返回 null）：`packages/plugins/vectorstore-meilisearch/src/index.ts:194-214`

这意味着**配置错误是静默的**。对「灵感仓」这种多租户产品，需要在启动期做 fail-fast 校验。

---

## 3. Prompt 资产清单

### 3.1 模板总表

| # | 函数 | 位置 | 用途 | 输入 | 输出契约 | 调用点 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `buildImagePrompt` | `packages/shared/prompts.ts:15-49` | 图片打标签 | lang / 自定义 prompt / 标签风格 / 白名单 / 近邻标签 | JSON `{ tags: string[] }`，目标 10–15 个 | `tagging.ts:175-186` |
| 2 | `constructTextTaggingPrompt` | `packages/shared/prompts.ts:54-92` | 文本打标签 | 同上 + 正文 | JSON `{ tags: string[] }`，目标 3–5 个 | `prompts.server.ts:59-66` |
| 3 | `constructSummaryPrompt` | `packages/shared/prompts.ts:97-108` | 摘要 | lang + 正文 | **纯文本**，3–4 句 | `prompts.server.ts:88` |
| 4 | `buildTextPromptUntruncated` | `packages/shared/prompts.ts:113-127` | 仅 UI 预览（不截断） | 同上 | 同上 | grep 无生产调用（仅设置页演示） |
| 5 | `buildSummaryPromptUntruncated` | `packages/shared/prompts.ts:132-142` | 仅 UI 预览 | 同上 | 同上 | 同上 |
| 6 | `buildOCRPrompt` | `packages/shared/prompts.ts:147-157` | 图片 OCR | 无 | 纯文本，无文字返回空串 | `assetPreprocessingWorker.ts:152` |
| 7 | `buildTextPrompt`（服务端） | `packages/shared/prompts.server.ts:49-79` | 文本打标签 + token 截断 | 同上 + `contextLength` | 同 #2 | `tagging.ts:115-126`、`:130-139`、`:260-268` |
| 8 | `buildSummaryPrompt`（服务端） | `packages/shared/prompts.server.ts:81-94` | 摘要 + token 截断 | 同上 | 同 #3 | `summarize.ts:150-155`、`bookmarks.ts:1617-1622` |
| 9 | `getTagStylePrompt` | `packages/shared/utils/tag.ts:12-30` | 标签风格指令片段 | 7 种风格 | 一行指令 | #1/#2 内联 |
| 10 | `getCuratedTagsPrompt` | `packages/shared/utils/tag.ts:32-37` | 白名单强约束 | tag 名数组 | 「ONLY use tags from …」 | #1/#2 内联 |
| 11 | `getPotentialRelevantTagsPrompt` | `packages/shared/utils/tag.ts:39-46` | 近邻标签增强 | 相似书签标签 | 「reuse if possible」 | #1/#2 内联 |

**数量**：6 条真实模板（3 组业务 + 2 组预览 + 1 组 OCR），5 个可复用指令片段。全仓库**没有** classify / extract-keywords / chat-system / citation 模板。

### 3.2 输入输出 schema 明细

| 模板 | 输入结构 | 截断方式 | 输出解析 |
| --- | --- | --- | --- |
| 文本打标签 | `URL / Title / Description / Content` 四段拼接（`tagging.ts:118-121`），TEXT 类型直接塞正文（`tagging.ts:130-139`），PDF 为 `Content: <asset.content>`（`tagging.ts:263`） | 模板先算 token，剩余预算给正文，`o200k_base` 编码，先按 `length*8` 字符粗切再精切 | `openAIResponseSchema.parse` + 三层 JSON 兜底（`tagging.ts:47-81`）→ 去 `#` 前缀 + trim（`:392-400`） |
| 图片打标签 | 图片 base64 + contentType | 不截断（受模型侧限制） | 同上；GIF 直接跳过（`:164-169`） |
| 摘要 | `Title/Description/Content/Publisher/Author/URL`（`summarize.ts:114-121`；手动摘要缺 URL，`bookmarks.ts:1588-1594`） | 同上 token 截断 | 纯文本，空则抛错（`summarize.ts:166-170`） |
| OCR | 图片 base64 | 不截断 | 纯文本，空串合法（`inference.ts:416-418`） |

### 3.3 用户自定义 prompt

- 表结构：`customPrompts(userId, text, enabled, appliesTo)`，`appliesTo ∈ {all_tagging, text, images, summary}`：`packages/db/schema.ts:668-684`。
- CRUD 全走 tRPC 且带归属校验：`packages/trpc/routers/prompts.ts:48-115`。
- 取值逻辑：打标签取 `all_tagging + text|images`（`tagging.ts:189-213`），摘要取 `summary`（`summarize.ts:136-144`）。
- 占位符替换：`$tags` / `$aiTags` / `$userTags`，通过「伪装成用户的 tRPC 客户端」读取标签列表：`tagging.ts:215-237`。这是 prompt 层唯一的动态注入点，也是**潜在越权面**（内部 API 调用链），值得在改造时收敛。
- UI：`apps/web/components/settings/AISettings.tsx:457`（`PromptEditor`）、`:560`（`PromptRow`）、`:696`（`TaggingRules`）、`:762`（`PromptDemo`）。

### 3.4 Prompt 层缺口

1. 无 system 角色，所有指令都在 user message 里（`inference.ts:344`）——对强指令遵循模型友好，对弱模型不友好。
2. 无 few-shot 示例；标签质量完全依赖文字规则（`prompts.ts:30-43`）。
3. 无输出长度/语言的后置校验（只说「必须用 X 语言」，不验证）。
4. 无 prompt 版本号，自定义 prompt 改动无法回溯到历史书签的标签来源。
5. 无「分类 / 关键词 / 实体」模板 —— 需求项 3 的缺口根源就在这里。

---

## 4. 分块与向量化链路

### 4.1 队列契约

```ts
// packages/shared-server/src/queues.ts:137-173
"embed"  → { bookmarkId, force?, runTaggingOnComplete=true }
"index"  → { bookmarkId, userId, embedding:number[] }
"delete" → { bookmarkId }
```

设计意图（源码注释明确写出）：`embed` 只负责生成，不写库，因此**索引重试不会触发重复打标签**；`index` 的慢任务（Meili 建索引）重试被隔离。这是本仓库里最成熟的一处工程细节（`queues.ts:137-144`、`embeddingsWorker.ts:395-399`）。

### 4.2 嵌入文本的构建（分块的替代品）

`buildEmbeddingText` 按固定字段顺序拼一段「文档画像」，再整体截断：

| 顺序 | 字段 | 上限 | 证据 |
| --- | --- | --- | --- |
| 1 | `Title` | — | `embeddingsWorker.ts:262` |
| 2 | `Type` | — | `:263` |
| 3 | `Tags`（排序后逗号连接） | — | `:265-268` |
| 4 | `Summary` | — | `:270` |
| 5 | `Note` | — | `:271` |
| 6 | LINK：`Domain`/`URL`(去 query)/`Page title`/`Description`/`Author`/`Publisher`/`Published` | — | `:275-292` |
| 7 | TEXT：`Source URL`/`Source domain` | — | `:293-304` |
| 8 | ASSET：`Source URL`/`Source domain`/`File name`/`Asset type`/`Metadata` | metadata 800 字符 | `:305-323`、`:30`、`:203-231` |
| 9 | `Content excerpt` | `max(500, min(3000, 0.4×contextLength))` → 默认 **3000 字符** | `:327-334`、`:29`、`:247-255` |
| 10 | 整体再截断 | `EMBEDDING_CONTEXT_LENGTH`（默认 8000 字符） | `:340-344` |

**关键判定：没有分块。** 一个书签 = 一个向量，10 万字的 PDF 与 200 字的笔记在向量空间里是同等粒度的两个点。长文检索只能靠「前 3000 字符代表全文」，这是当前语义检索质量的天花板。

源码里的两处自我承认：
- `packages/shared/inference.ts:590-592`：「in the future we want to add a way to split the input into multiple parts」
- `embeddingsWorker.ts:29-30`：只有一个常量 `MAX_EMBEDDING_CONTENT_EXCERPT_LENGTH = 3000`

### 4.3 批量策略

- 队列层：并发 = `EMBEDDING_NUM_WORKERS`（默认 1）（`embeddingsWorker.ts:69`）。
- 请求层：`generateEmbeddingFromText([embeddingText])` —— **每次作业只发 1 条输入**（`embeddingsWorker.ts:458-460`）。接口本身支持 `string[]`（`inference.ts:126`），但生产路径从不批量。这既是成本问题也是吞吐问题。
- 存储层：Meilisearch 有批量队列（`MEILI_BATCH_SIZE=50` / `MEILI_BATCH_TIMEOUT_MS=500`），见 `packages/plugins/vectorstore-meilisearch/src/index.ts:52-58`、`:61-73`。也就是说**写入是批量的，推理不是**。

### 4.4 存储位置与索引配置

- 索引名 `bookmarks_vectors`，主键 `id`：`packages/plugins/vectorstore-meilisearch/src/index.ts:153`、`:219-227`。
- 文档形态：`{ id, userId, _vectors: { default: number[] } }`：`:19-25`、`:62-68`。
- embedder 配置为 `userProvided`，维度取 `EMBEDDING_DIMENSIONS`（我们自己算向量，Meili 不负责嵌入）：`:261-286`。
- 可过滤属性仅 `id`、`userId`：`:243`、`:248-259`。
- 向量索引与全文索引是**两个独立索引**（`bookmarks` vs `bookmarks_vectors`），且允许落在两个 Meilisearch 实例（`MEILI_VECTOR_ADDR`）。

### 4.5 失败、重试与状态机

| 场景 | 行为 | 证据 |
| --- | --- | --- |
| 向量库未配置 | 跳过向量，仍补发打标签 | `embeddingsWorker.ts:358-368` |
| 无嵌入客户端 | 跳过，仍补发打标签 | `:429-438` |
| 无内容可嵌 | 跳过，仍补发打标签 | `:441-449` |
| 返回空向量 | 抛错（进重试） | `:462-469` |
| 自动索引关闭且非 force | 跳过 | `:407-415` |
| 重试耗尽 | 写 `embeddingStatus='failure'` + 补发无向量打标签 | `:48-66` |
| index 成功 | 写 `embeddingStatus='success'` | `:80-104`（`type==='index'` 才写 success） |

状态字段：`bookmarks.embeddingStatus ∈ {pending, failure, success}`，默认 `pending`：`packages/db/schema.ts:268-270`。

### 4.6 重建能力

管理员可全量重建：先 `clearIndex()`，再按 keyset 分页（1000/页）批量入队，`force:true, runTaggingOnComplete:false`：`packages/trpc/routers/admin.ts:330-390`。

**缺失**：没有「模型/维度变更检测」。换 `EMBEDDING_TEXT_MODEL` 或改 `EMBEDDING_DIMENSIONS` 后，旧向量与新向量会混在同一索引里（Meili embedder 维度不匹配会整体失效），必须手动触发全量重建。这是一个必须补的运维开关。

---

## 5. 搜索架构（全文 + 向量 + 混合）

### 5.1 三层结构

```
                     ┌────────────────────────────────────────────┐
 tRPC searchBookmarks│ packages/trpc/routers/bookmarks.ts:986-1223 │
                     └───────┬───────────────────────┬────────────┘
                             │ fts                   │ semantic
                             ▼                       ▼
              getSearchClient()            getVectorStoreClient()
                             │                       │
                             ▼                       ▼
        Meili index "bookmarks"        Meili index "bookmarks_vectors"
        (全文/前缀/排序)                 (userProvided 向量, cosine)
                             │                       │
                             └────────► RRF ◄────────┘
                        packages/trpc/lib/searchRanking.ts:13-47
```

统一检索接口由两个插件抽象承载，均为「最后注册者胜出」：

- `SearchIndexClient`：`packages/shared/search.ts:71-83`，实现 `addDocuments/deleteDocuments/search/clearIndex`
- `VectorStoreClient`：`packages/shared/vectorStore.ts:52-88`，多出 `findSimilar` 与 `getHealth`
- 插件加载顺序固定，Meili 是唯一实现：`packages/shared-server/src/plugins.ts:24-38`、`packages/shared/plugins.ts:74-82`

### 5.2 全文检索实现

- 文档字段：`id/userId/url/title/linkTitle/description/content/metadata/fileName/createdAt/note/summary/tags/publisher/author/datePublished/dateModified`：`packages/shared/search.ts:5-23`
- 索引构建时 `content` 的来源按类型分派（链路正文 → 资产 OCR/PDF 文本 → TEXT 正文）：`apps/workers/workers/searchWorker.ts:90-120`
- 查询参数：`attributesToRetrieve:["id"]`、`showRankingScore:true`、**`matchingStrategy:"all"`**：`packages/plugins/search-meilisearch/src/index.ts:86-94`
- 可过滤 `id/userId`，可排序 `createdAt`：`packages/plugins/search-meilisearch/src/index.ts:194-221`
- 结果只回 `id + _rankingScore`，正文由 DB 二次加载：`packages/trpc/routers/bookmarks.ts:1196-1200`

`matchingStrategy: "all"` 是召回率杀手：多词查询要求全部命中，中文分词下容易 0 结果。这是「灵感仓」体验优化的一个低成本改造点。

### 5.3 查询语法（searchQueryParser）

实现：手写 lexer + `typescript-parsec` 文法，失败时**降级为纯文本**而不是报错：`packages/shared/searchQueryParser.ts:446-484`。

语法元素：
- 布尔：空格=AND、`and`、`or`、括号分组；括号本身不可取反（取反只作用于限定符前缀）：`packages/shared/searchQueryParser.ts:356-399`、`:352`、`:124-127`
- 取反：`-` 或 `!` 前缀：`:124-127`
- 引号字符串：`:51`

操作符全表（含负向）：

| 操作符 | 语义 | 证据 |
| --- | --- | --- |
| `is:fav / -is:fav` | 收藏 | `searchQueryParser.ts:131-135` |
| `is:archived` | 归档 | `:136-140` |
| `is:tagged` | 有标签 | `:141-145` |
| `is:inlist` | 在清单中 | `:146-150` |
| `is:link / is:text / is:media` | 类型 | `:151-177` |
| `is:broken` | 抓取失败 | `:178-182` |
| `has:notes / has:highlights` | 有笔记/划线 | `:217-237` |
| `url:<v>` | URL 子串 | `:206-211` |
| `title:<v>` | 标题子串 | `:212-216` |
| `#tag` / `tag:<v>` | 标签 | `:238-243` |
| `list:<v>` | 清单名 | `:244-248` |
| `feed:<v>` | RSS 源 | `:249-257` |
| `source:<v>` | 来源枚举（api/web/cli/mobile/extension/singlefile/rss/import） | `:258-274` |
| `after:<date>` / `before:<date>` | 创建时间 | `:275-308` |
| `age:<1d / >2w / <6m / >3y` | 相对时间 | `:309-335` |

**缺失操作符**：`content:`（正文检索）、`summary:`、`taggedBy:ai|human`、`domain:`、`type:pdf|image`、`score:`、`chunk:`。对「灵感仓」而言，`taggedBy` 与 `content` 是刚需。

解析产物结构：`{ text, matcher?, result: "full"|"partial"|"invalid" }`，partial 用于「用户还在输入」：`searchQueryParser.ts:446-484`。

限定符如何生效：**先落库查询出全部命中 id，再作为 `id IN (...)` 过滤器传给 Meili**：`packages/trpc/routers/bookmarks.ts:1017-1029`、`packages/trpc/lib/search.ts:297-307`。书签量大时这是明显瓶颈（SQLite → 巨量 IN 列表 → Meili 过滤器上限）。

### 5.4 语义检索

- 查询侧嵌入：`generateEmbeddingFromText([parsedQuery.text])`：`packages/trpc/routers/bookmarks.ts:1131-1136`
- 过滤：把全文检索的 `FilterQuery` 映射为 `VectorFilterQuery`（`eq`/`in`）：`:1125-1129`
- 阈值：`SEMANTIC_SCORE_THRESHOLD = 0.6`（Meili 归一化分，约等于 cosine 0.2）：`:87-93`、`:1147`
- 分页：向量库「问多少给多少」，因此请求 `offset+limit+1` 再切片：`:1152-1156`
- 排序限制：语义/混合**只允许 relevance 排序**，否则 BAD_REQUEST：`:1117-1123`
- 纯向量调用：`hybrid.semanticRatio = 1.0`（`vectorstore-meilisearch/src/index.ts:80-91`）

### 5.5 混合检索 = 应用层 RRF

```ts
// packages/trpc/routers/bookmarks.ts:1157-1180
const [ftsResult, semanticResult] = await Promise.allSettled([
  fullTextSearch(HYBRID_CANDIDATES_PER_SOURCE),   // = 100
  semanticSearch(HYBRID_CANDIDATES_PER_SOURCE),   // = 100
]);
const fusedHits = reciprocalRankFusion([ftsResult.value.hits, semanticResult.value.hits]);
```

- 窗口固定为 100（`MAX_NUM_BOOKMARKS_PER_PAGE`），保证翻页稳定（注释明确说明「RRF 会因窗口增长而重排早页」）：`:86`、`:1158-1160`、`packages/shared/types/bookmarks.ts:285`
- RRF 实现：`score += 1/(60+rank)`，同分比 bestRank，再按 id 稳定排序：`packages/trpc/lib/searchRanking.ts:13-47`
- 语义腿失败 → 降级纯全文（记 `search.degraded=true`）：`bookmarks.ts:1167-1171`、`:1069-1078`
- 全文腿失败 → 直接抛出（不降级）：`:1164-1166`
- **没有权重调节**：`k=60` 硬编码，无法按用户/场景调「全文优先」或「语义优先」；Meilisearch 自带的 `semanticRatio` 混合能力**完全未使用**。

### 5.6 降级与错误矩阵

| 情况 | 行为 | 证据 |
| --- | --- | --- |
| `searchMode=fts` | 直接全文，不受语义开关影响 | `bookmarks.ts:1080-1083` |
| 语义/混合但特性关闭 | `BAD_REQUEST: Semantic search is not enabled` | `:1006-1015` |
| 纯限定符查询（无正文） | hybrid 降级全文；semantic 报错 | `:1085-1108` |
| 嵌入/向量客户端缺失 | hybrid 降级；semantic 报错 | `:1101-1115` |
| 语义腿异常 | hybrid 降级并打日志 | `:1167-1171` |
| 无命中 | 返回空页 | `:1188-1190` |

### 5.7 速率限制

语义/混合走独立限流，`fts` 直接放行：

```ts
// packages/trpc/routers/bookmarks.ts:170-190
if (opts.input.searchMode === "fts") return opts.next();
return rateLimitMiddleware(opts);
```

- 配额：`300 次 / 60 秒 / 身份`，键为 `<identity>:<path>`：`bookmarks.ts:149-153`、`packages/trpc/lib/rateLimit.ts:46`
- 身份优先用户（`user:<id>`），匿名才回退 IP（注释说明 IP 来自可伪造 header）：`packages/shared/ratelimiting.ts:42-65`
- **默认关闭**：`RATE_LIMITING_ENABLED` 默认 `false`，此时中间件直接放行：`packages/trpc/lib/rateLimit.ts:25-27`、`packages/shared/config.ts:227`

也就是说，开箱状态下语义检索**没有任何限流保护**（每次请求都会真实调用嵌入 API 产生费用）。这在接入用量计费后必须一并打开。

### 5.8 消费方

| 消费方 | 能力 | 证据 |
| --- | --- | --- |
| Web UI | fts/hybrid/semantic 三选一，受 `clientConfig.search.semanticSearchEnabled` 控制 | `apps/web/components/dashboard/search/SearchModeSelector.tsx:27-36`、`SearchInput.tsx:82`、`:235-263` |
| REST API v1 | `GET /bookmarks/search?searchMode=` 透传 | `packages/api/routes/bookmarks.ts:65-91`、`packages/api/utils/types.ts:29` |
| MCP | `search-bookmarks` 工具，含 searchMode 描述与校验 | `apps/mcp/src/bookmarks.ts:43-51`、`:93-98` |
| 内部 RAG 预备 | **不存在** | — |

### 5.9 检索侧结构性问题

1. **两库一致性**：全文索引与向量索引是两套写入、两套重试。任何一侧失败都会造成「找得到但语义搜不到」或反之。二者唯一的对齐点是 `bookmarkId`（`searchWorker.ts:126`、`embeddingsWorker.ts:480-491`）。
2. **`id IN (...)` 物化**：限定符先查 DB 全量 id，规模上不封顶（`trpc/lib/search.ts:301-306`）。
3. **`matchingStrategy: "all"`**：召回偏保守（`search-meilisearch/src/index.ts:93`）。
4. **无 rerank**：RRF 之后直接取前 N，没有交叉编码器或 LLM 重排。
5. **无高亮/摘要片段**：`attributesToRetrieve:["id"]`，搜索结果不带 `_formatted`（`search-meilisearch/src/index.ts:91`）。
6. **向量库无 `findSimilar` 的检索页用法**：仅用于打标签找近邻（`tagging.ts:585-591`），「相似书签」产品能力未开放。

---

## 6. RAG 与对话（上下文拼装、引用、流式）

### 6.1 结论：只有地基，没有建筑

| 层 | 状态 | 证据 |
| --- | --- | --- |
| 数据表 | ✅ 已建（迁移 0088） | `packages/db/schema.ts:686-704`（`chatSessions`）、`:706-725`（`chatMessages`）、`packages/db/drizzle/0088_add_chat_tables.sql:1-23` |
| 关系定义 | ✅ 已建 | `packages/db/schema.ts:1336-1352` |
| 配置 | ⚠️ 存在但无消费方 | `packages/shared/config.ts:81-82`、`:390`、`:415-417`、`:686-688` |
| tRPC 路由 | ❌ 不存在 | `packages/trpc/routers/_app.ts:22-42` 无 chat |
| Worker | ❌ 不存在 | `apps/workers/workers/` 目录无 chat 相关文件 |
| 上下文拼装 | ❌ 不存在 | grep `rag`/`context`/`citation` 无业务命中 |
| 引用（citations） | ❌ 不存在 | 同上 |
| 流式（SSE/stream） | ❌ 不存在 | `apps/web` 无 `ReadableStream/EventSource`；`packages/trpc` 无 stream 输出 |
| 前端 UI | ❌ 不存在 | `apps/web` 无 chat 页面/组件 |
| 移动端 | ❌ 不存在 | `apps/mobile` 无 chat |

表结构本身是合格的：

```ts
// packages/db/schema.ts:706-725
chatMessages: { id, chatId → chatSessions.id(cascade), role: "user"|"assistant"|"toolResult",
                content, metadata: json, createdAt }
// 索引：chatId、chatId+createdAt
```

`role` 已预留 `toolResult`，`metadata` 是 json 任意结构——说明设计者留了「工具调用 + 引用元数据」的位置，但没有实现。

### 6.2 现有可复用积木（改造成本评估）

| 需要的能力 | 已有积木 | 差距 |
| --- | --- | --- |
| 多轮消息 | ❌ `inferFromText(prompt: string)` 只收单串 | 需扩为 `messages[]`（`inference.ts:130-140`） |
| 检索上下文 | ✅ `searchBookmarks` 支持 hybrid + `includeContent` | 需要「chunk 级」上下文而非整篇（§4） |
| 会话持久化 | ✅ 两张表 | 需 router + 归属中间件 |
| 引用 | ⚠️ 表里有 `metadata` 字段 | 需定义 citation schema 并落 `metadata` |
| 流式 | ❌ | 需 `streamText` 或手写 SSE；OpenAI SDK 已具备流式能力但未启用（`inference.ts:342-361` 非流式） |
| 模型 | ⚠️ `CHAT_MODEL` 已配但无人读 | 需接进客户端构造 |
| 开关 | ✅ `CHAT_ENABLED` | 需在 `clientConfig` 暴露并接 UI |

### 6.3 待新建清单（最小可用 RAG）

1. `packages/shared/inference.ts`：新增 `inferFromMessages(messages, opts)`，保留 `inferFromText` 为薄封装。
2. `packages/trpc/routers/chat.ts`：`createSession / listSessions / getMessages / deleteSession / sendMessage(streaming)`，全部 `createScopedAuthedProcedure("chat")` + 会话归属校验（模式照抄 `prompts.ts:16-46`）。
3. `packages/trpc/lib/rag/`：`retrieve(question, userId, k)` → 复用 hybrid 检索 → 取 top-N bookmark（未来 chunk）→ 组装带编号的 context 块。
4. `packages/shared/prompts.ts`：新增 `buildChatSystemPrompt`、`buildChatContextBlock`（必须带 `[1] [2]` 编号契约）。
5. 引用回写：assistant message 的 `metadata = { citations: [{ index, bookmarkId, chunkId?, title, snippet, score }] }`。
6. 流式：REST/SSE 路由（tRPC subscription 或 `apps/web/app/api/chat/route.ts`）；或先做「非流式 + 前端骨架屏」的 MVP。
7. UI：`apps/web/app/chat/`（会话列表 + 消息流 + 引用卡片，点击跳书签）。

---

## 7. 自动标签/摘要/分类现状

### 7.1 调用点与函数名（精确到行）

| 环节 | 函数 | 位置 | 说明 |
| --- | --- | --- | --- |
| 队列消费入口 | `runOpenAI` | `apps/workers/workers/inference/inferenceWorker.ts:83-124` | 按 `type` 分派 summarize / tag |
| 打标签主流程 | `runTagging` | `apps/workers/workers/inference/tagging.ts:630-739` | 开关 → 用户偏好 → 近邻标签 → 推理 → 落库 → webhook → 重建索引 |
| 文本构建 | `buildPrompt` | `tagging.ts:93-142` | LINK 拼 URL/Title/Desc/Content；TEXT 直塞 |
| 图片打标签 | `inferTagsFromImage` | `tagging.ts:144-187` | 视觉模型 + `buildImagePrompt` |
| PDF 打标签 | `inferTagsFromPDF` | `tagging.ts:250-277` | 用 `asset.content` 走文本模型 |
| 统一推理 | `inferTags` | `tagging.ts:308-413` | 按类型分派 + JSON 解析 + 去 `#` |
| 标签落库 | `connectTags` | `tagging.ts:415-524` | 事务内匹配/新建/删旧 AI 标签/关联 |
| 近邻标签 | `getPotentiallyRelevantTags` | `tagging.ts:551-628` | 向量近邻 → 取标签 → 按长度挑到 1000 字符 |
| 摘要主流程 | `runSummarization` | `apps/workers/workers/inference/summarize.ts:48-193` | 双重开关 → 仅 LINK → prompt → 写库 → 重建索引 |
| 手动摘要 | `summarizeBookmark` | `packages/trpc/routers/bookmarks.ts:1540-1669` | 同步调用，用户主动触发 |
| 执行者 | `OpenAiWorker.build` | `inferenceWorker.ts:44-81` | 并发 `INFERENCE_NUM_WORKERS`，超时 `INFERENCE_JOB_TIMEOUT_SEC` |

### 7.2 落库表与字段

| 数据 | 表 / 字段 | 证据 |
| --- | --- | --- |
| 摘要 | `bookmarks.summary`（TEXT） | `packages/db/schema.ts:271`；写入 `summarize.ts:181-187`、`bookmarks.ts:1644-1650` |
| 标签本体 | `bookmarkTags(name, normalizedName 生成列, userId)` | `packages/db/schema.ts:494-520` |
| 标签关联 | `tagsOnBookmarks(tagId, bookmarkId, attachedBy: ai\|human)` | `packages/db/schema.ts:523-540` |
| 标签状态 | `bookmarks.taggingStatus` | `packages/db/schema.ts:262-264`；写入 `inferenceWorker.ts:21-42` |
| 摘要状态 | `bookmarks.summarizationStatus` | `packages/db/schema.ts:265-267`；写入同上 |
| 嵌入状态 | `bookmarks.embeddingStatus` | `packages/db/schema.ts:268-270`；写入 `embeddingsWorker.ts:95-98` |
| 文本正文 | `bookmarkTexts.text` | `packages/db/schema.ts:470-478` |
| 资产正文（OCR/PDF） | `bookmarkAssets.content` | `packages/db/schema.ts:480-492` |
| 自定义 prompt | `customPrompts` | `packages/db/schema.ts:668-684` |

> 注：任务书提到的 `bookmarkTexts.summary` 实际不存在——`bookmarkTexts` 只有 `text/sourceUrl`（`packages/db/schema.ts:470-478`），摘要落在 `bookmarks.summary`。

### 7.3 标签写入语义（重要）

`connectTags` 是**全量替换 AI 标签**，不是增量合并：

```ts
// tagging.ts:478-507
DELETE FROM tagsOnBookmarks WHERE attachedBy='ai' AND bookmarkId=?
INSERT ... (matched ∪ new) with attachedBy='ai'
```

- 人工标签（`attachedBy='human'`）不受影响。
- 副作用：重复触发打标签会**丢弃**上一次 AI 生成的标签（即使这次模型只给出 1 个标签）。对「灵感仓」需要改成「合并 + 置信度 + 可撤销」。
- 标签归一化：`lower().replace(/[ \-_]/g,'')`，与生成列 `normalizedName` 必须保持同步（`schema.ts:502-508` 注释明确要求）。

### 7.4 触发矩阵

| 触发源 | 打标签 | 摘要 | 向量 | 证据 |
| --- | --- | --- | --- | --- |
| LINK 入库（crawl 后） | ✅（embed 或 tag） | ✅ | ✅（若开自动索引） | `crawlerWorker.ts:1779-1804` |
| TEXT 入库 | ✅ | ❌ **不入队** | ✅ | `bookmarks.ts:514-533` |
| ASSET 入库 | ✅（预处理后） | ⚠️ 入队但被跳过 | ✅ | `assetPreprocessingWorker.ts:478-507` + `summarize.ts:122-127` |
| 手动「重新摘要」 | — | ✅ | — | `bookmarks.ts:1540-1669` |
| 管理员重打标签 | ✅ | — | — | `admin.ts:1012-1037` |
| 管理员重新摘要 | — | ✅（仅 LINK） | — | `admin.ts:1038-1070` |
| 管理员重建向量 | — | — | ✅（可全量清库） | `admin.ts:330-390` |

**TEXT 类型从不入摘要队列**是一个明显的产品缺口（`bookmarks.ts:514-533` 只入 embed/tag）。

### 7.5 分类与关键词：不存在

- 无 taxonomy 表、无 `category` 字段、无 classify prompt：grep `classify|category|categorize` 仅命中 problemReports/feed 的无关用法。
- 无独立关键词抽取：标签承担了部分关键词职能，但受 `3-5 个` 上限与「短标签」约束（`prompts.ts:74-82`），不适合做检索关键词。
- 无「实体抽取」（人物/组织/地点）。

### 7.6 标签质量的现有增强手段（值得保留）

1. 标签风格 7 档（`utils/tag.ts:12-30`，枚举见 `packages/shared/types/users.ts:12-21`）。
2. 白名单强约束（curated tags）：`utils/tag.ts:32-37`。
3. 近邻书签标签注入（跨书签一致性）：`tagging.ts:551-628`，并按「短标签优先」压到 1000 字符（`:604-627`）。
4. 用户自定义 prompt + `$tags` 占位符：`tagging.ts:189-237`。
5. 失败页/验证码过滤指令（避免给错误页打标签）：`prompts.ts:37-41`、`:76-80`。

---

## 8. 图片与 PDF 理解现状

### 8.1 图片

| 能力 | 状态 | 实现 | 证据 |
| --- | --- | --- | --- |
| 本地 OCR | ✅ | tesseract.js，语言由 `OCR_LANGS` 决定，置信度低于阈值丢弃 | `assetPreprocessingWorker.ts:120-137` |
| LLM OCR | ✅ | `OCR_USE_LLM=true` 时用视觉模型 + `buildOCRPrompt`，失败回落 Tesseract | `:139-169`、`:299-321` |
| OCR 结果落库 | ✅ | 写 `bookmarkAssets.content`，并把 `metadata` 置为 `null` | `:330-337` |
| 视觉打标签 | ✅ | 图片 base64 → 视觉模型 → 标签数组 | `tagging.ts:144-187` |
| 图片描述（caption） | ❌ | 全仓库无 caption/description 生成 | grep `caption|describeImage` 仅命中 prompt 里的「captions」字样 |
| 图片摘要 | ❌ | 摘要只走 LINK 分支 | `summarize.ts:98-127` |
| 视觉相似检索 | ❌ | 向量来自文本（OCR 文本），非图像嵌入 | `embeddingsWorker.ts:305-323` |
| GIF | ⚠️ 跳过 | 直接 return null | `tagging.ts:164-169` |

三个质量问题：

1. `detail: "low"` 硬编码，图片被降采样（`inference.ts:401`）。
2. OCR 成功后写 `metadata: null`，**丢弃了原有资产 metadata**（`assetPreprocessingWorker.ts:330-336`），后续做「图片尺寸/EXIF」类展示会缺数据。
3. 图片书签的向量=OCR 文字向量；无文字图片（照片/插画）几乎无法被语义检索到（`embeddingsWorker.ts:323` 取 `asset.content`，空则无内容可嵌 `:441-449`）。

### 8.2 PDF

| 能力 | 状态 | 实现 | 证据 |
| --- | --- | --- | --- |
| 文本抽取 | ✅ | `pdf2json` → `getRawTextContent()` + `Meta` | `assetPreprocessingWorker.ts:171-187` |
| 首页截图 | ✅ | `pdf2pic`（依赖 ghostscript + graphicsmagick），存为 `ASSET_SCREENSHOT` | `:189-279` |
| 文本落库 | ✅ | `bookmarkAssets.content` + `metadata` | `:367-374` |
| 打标签 | ✅ | 用 PDF 全文（截断后）走文本模型 | `tagging.ts:250-277` |
| 摘要 | ❌ | `runSummarization` 只处理 LINK；源码里留了明确 TODO | `summarize.ts:38-39`、`:98-127` |
| 页面级/章节结构 | ❌ | 提取的是扁平 `RawTextContent`，无页码/标题层级 | `:171-187` |
| 扫描件 OCR | ❌ | 纯图片 PDF 直接抛错「PDF text is empty」 | `:359-363` |
| PDF 视觉理解 | ❌ | 有首页截图但从不送视觉模型 | grep 无消费方 |
| PDF 问答 | ❌ | 无 | — |

结论：PDF 目前是「可被全文检索 + 可被打标签的文本资产」，不是「可被理解的文档」。

### 8.3 资产预处理链路

```
AssetPreprocessingQueue
  └ run()  assetPreprocessingWorker.ts:387-508
      ├ image → extractAndSaveImageText (:436-446)   → bookmarkAssets.content
      ├ pdf   → extractAndSavePDFText   (:447-453)   → bookmarkAssets.content
      │        extractAndSavePDFScreenshot (:454-459) → assets(ASSET_SCREENSHOT)
      ├ 失败兜底：把 pending 的三类 status 全部清回 null (:68-105)
      └ 下游入队：embed(或 tag) + summarize + searchReindex (:473-507)
```

注意 `fixMode` 语义：`fixMode=true` 时已存在内容则跳过，且「无变化」时不重跑下游（`:288-296`、`:346-354`、`:478`）。

---

## 9. 需求差距矩阵

判定口径：**已具备**=功能完整可用；**部分具备**=有可用主干但关键能力缺失；**缺失**=无实现。

| # | 需求项 | 状态 | 现状要点（含证据） | 需改文件 |
| --- | --- | --- | --- | --- |
| 1 | 统一 provider 系统 | **部分具备** | 仅 OpenAI 兼容 + 原生 Ollama 二选一，硬编码优先级；无 provider 注册表/多实例/故障转移（`packages/shared/inference.ts:210-221`） | `packages/shared/inference.ts`（拆分为 `providers/openai.ts`、`providers/ollama.ts`、`registry.ts`）、`packages/shared/config.ts`、`packages/shared/plugins.ts`（新增 `PluginType.Inference`） |
| 2 | 模型能力分类 | **部分具备** | 文本/视觉/嵌入 已分离；OCR 复用视觉模型；`CHAT_MODEL` 为死配置；无 rerank/分类模型位（`config.ts:86-91`、`:390`、`inference.ts:566-582`） | `packages/shared/config.ts`（新增 `INFERENCE_OCR_MODEL`、`INFERENCE_RERANK_MODEL`、按任务覆盖）、`packages/shared/inference.ts`、`packages/shared-server/src/inference/*` |
| 3 | AI 分类 / 标签 / 摘要 / 关键词 | **部分具备** | 标签 ✅（风格/白名单/近邻增强）；摘要 ⚠️ 仅 LINK 且默认关；分类 ❌；关键词 ❌（`tagging.ts:630-739`、`summarize.ts:98-127`、`config.ts:109`） | `packages/shared/prompts.ts`（新增 classify/keywords 模板）、`packages/db/schema.ts`（category/keywords 字段或新表）、`apps/workers/workers/inference/*`、`packages/trpc/routers/bookmarks.ts`、`apps/web/components/settings/AISettings.tsx` |
| 4 | 分块（chunking） | **缺失** | 无 chunk 表、无切分器；整篇压成 3000 字符摘要 + 8000 字符上限（`embeddingsWorker.ts:29-30`、`:247-255`、`:340-344`；`inference.ts:590-592` 自认 TODO） | 新建 `packages/shared/chunking.ts`；`packages/db/schema.ts` 新增 `bookmarkChunks`（+迁移 0097）；`apps/workers/workers/embeddingsWorker.ts` 改为 chunk 循环；`packages/shared/vectorStore.ts`（文档加 chunkId） |
| 5 | 向量化 | **已具备** | 文档级向量：独立队列 `embed/index/delete`、独立嵌入凭证、维度校验、状态机、全量重建入口（`queues.ts:137-173`、`embeddingsWorker.ts:349-499`、`admin.ts:330-390`）。限制：单条输入、无批量、无模型变更检测 | 优化点：`embeddingsWorker.ts`（批量 `inputs[]`）、`packages/shared/inference.ts`（批量上限/重试）、`packages/trpc/routers/admin.ts`（模型指纹 + 强制重建） |
| 6 | 语义 + 混合检索 | **已具备** | fts/semantic/hybrid 三模式；应用层 RRF（k=60）；阈值 0.6；降级链完整；Web/API/MCP 三端可用（`bookmarks.ts:986-1223`、`searchRanking.ts:13-47`、`api/routes/bookmarks.ts:65-91`、`apps/mcp/src/bookmarks.ts:93-98`） | 增强点：`searchRanking.ts`（可配权重/可换 rerank）、`search-meilisearch/src/index.ts`（`matchingStrategy` 可配 + `_formatted` 高亮）、`trpc/lib/search.ts`（限定符不再物化全量 id） |
| 7 | RAG 多轮对话带引用 | **缺失** | 只有表与死配置；无 router/worker/上下文拼装/引用/流式/UI（`schema.ts:686-725`、`config.ts:81-82`、`routers/_app.ts:22-42`） | 新建 `packages/trpc/routers/chat.ts`、`packages/trpc/lib/rag/*`、`packages/shared/prompts.ts`（chat/引用模板）、`packages/shared/inference.ts`（messages + streaming）、`apps/web/app/chat/*`、`apps/web/app/api/chat/route.ts` |
| 8 | 图片理解 | **部分具备** | OCR（双路径）+ 视觉打标签 ✅；无 caption/描述、无图片摘要、无视觉向量、`detail:"low"`、GIF 跳过、OCR 后 metadata 被清空（`assetPreprocessingWorker.ts:120-169`、`tagging.ts:144-187`、`inference.ts:401`） | `apps/workers/workers/assetPreprocessingWorker.ts`（新增 caption 任务 + 保留 metadata）、`packages/shared/prompts.ts`（`buildImageCaptionPrompt`）、`packages/db/schema.ts`（`bookmarkAssets.description`）、`packages/shared/inference.ts`（detail 可配） |
| 9 | PDF 智能阅读 | **部分具备** | 文本抽取 + 首页截图 + 打标签 ✅；无摘要、无页面结构、扫描件直接失败、无 PDF 问答（`assetPreprocessingWorker.ts:171-187`、`:359-363`、`summarize.ts:38-39`） | `apps/workers/workers/assetPreprocessingWorker.ts`（按页抽 + 落 page 结构）、`apps/workers/workers/inference/summarize.ts`（放开 ASSET 分支）、`packages/db/schema.ts`（page/chunk）、`packages/shared/prompts.ts` |
| 10 | 用量统计 | **缺失** | token 仅进日志/OTEL；无表、无按用户聚合、无配额、无 Prometheus 指标（`summarize.ts:172-179`、`eventLogTypes.ts:21-47`、`apps/workers/metrics.ts:16-20`） | `packages/db/schema.ts` 新增 `aiUsage`（+迁移）、`packages/shared/inference.ts`（计量钩子）、`apps/workers/workers/inference/*`、`packages/trpc/routers/users.ts`（统计查询）、`apps/web/app/settings/stats/*`（展示）、`apps/workers/metrics.ts`（token 直方图） |
| 11 | 用户隔离 | **已具备** | 检索 `userId` 过滤（`bookmarks.ts:1028`）、向量过滤（`:1125-1129`、`vectorstore-meilisearch/src/index.ts:243`）、近邻标签过滤（`tagging.ts:561-567`）、prompt 归属校验（`routers/prompts.ts:16-46`）、书签归属中间件（`bookmarks.ts:95-129`）。缺口：chat 无（功能不存在）、用量无（对象不存在）、`$tags` 占位符走内部模拟客户端（`tagging.ts:219-220`）需收敛 | `packages/trpc/routers/bookmarks.ts`（限定符改服务端拼接 filter）、`tagging.ts`（去掉 impersonating client）、新建 `chat.ts` 时强制归属校验 |

### 统计

| 判定 | 数量 | 需求项 |
| --- | --- | --- |
| 已具备 | **3** | #5 向量化、#6 语义+混合检索、#11 用户隔离 |
| 部分具备 | **5** | #1 Provider 系统、#2 能力分类、#3 分类/标签/摘要/关键词、#8 图片理解、#9 PDF 智能阅读 |
| 缺失 | **3** | #4 分块、#7 RAG 对话、#10 用量统计 |

> 任务书正文实际列举了 11 个需求项（概括时写作「10 项」），本文逐项一一对应，不合并、不拆分。

---

## 10. 用量统计与用户隔离改造方案

### 10.1 现状与缺口

**用量**：`InferenceResponse.totalTokens` 已经拿到，但只写进结构化日志与 OTEL span：

- `addLogFields({ "inference.total_tokens": ... })`：`summarize.ts:172-179`、`tagging.ts:401-404`、`bookmarks.ts:1639-1642`
- 事件类型定义：`packages/shared-server/src/eventLogTypes.ts:21-47`
- 指标只有作业计数：`apps/workers/metrics.ts:16-20`

**没有任何**：按用户/按天/按模型/按任务（tag/summarize/embed/chat）的累计，没有成本换算，没有配额拦截，没有前端展示。

**隔离**：检索与向量已按 `userId` 过滤（见 §9 #11），但存在三处需要收口：

| 位置 | 问题 | 建议 |
| --- | --- | --- |
| `packages/trpc/routers/bookmarks.ts:1017-1029` | 限定符先查出全部 id 再传给 Meili，隔离正确但规模不可控 | 把 `tagName/listName` 等条件下推到 Meili 的 filterable 字段（新增 `tagNames`、`listIds`、`feedId` 到索引），只对复杂布尔保留 id 路径 |
| `apps/workers/workers/inference/tagging.ts:219-220` | 用「伪装用户」的 tRPC 客户端读标签，等于内部越权通道 | 直接 `db.query.bookmarkTags` 按 `userId` 查（已有等价查询在 `:671-677`） |
| `vectorstore-meilisearch/src/index.ts:243` | 仅 `id/userId` 可过滤，无法做「按标签语义检索」 | 增加 `tagIds`、`type`、`createdAt` 为 filterable |

### 10.2 用量计量设计

#### 10.2.1 表结构（新增迁移 `0097_ai_usage.sql`）

> 当前最大迁移号 `0096_add_highlight_text_anchors`（`packages/db/drizzle/meta/_journal.json`），下一个为 `0097`。

```ts
// packages/db/schema.ts 追加
export const aiUsage = sqliteTable(
  "aiUsage",
  {
    id: text("id").notNull().primaryKey().$defaultFn(() => createId()),
    userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    bookmarkId: text("bookmarkId"),          // 可空（chat 无 bookmark）
    chatSessionId: text("chatSessionId"),    // 可空
    task: text("task", { enum: ["tag", "summarize", "embed", "ocr", "caption", "classify", "chat"] }).notNull(),
    provider: text("provider").notNull(),    // openai | ollama | ...
    model: text("model").notNull(),
    promptTokens: integer("promptTokens").notNull().default(0),
    completionTokens: integer("completionTokens").notNull().default(0),
    totalTokens: integer("totalTokens").notNull().default(0),
    latencyMs: integer("latencyMs"),
    ok: integer("ok", { mode: "boolean" }).notNull().default(true),
    errorKind: text("errorKind"),            // refusal|length|timeout|dimension|rate_limit
    createdAt: createdAtMsField(),
  },
  (t) => [
    index("aiUsage_userId_createdAt_idx").on(t.userId, t.createdAt),
    index("aiUsage_task_createdAt_idx").on(t.task, t.createdAt),
  ],
);
```

#### 10.2.2 写入点（唯一收口）

在 `InferenceClient` 之外包一层 `MeteredInferenceClient`，避免在 5 个调用点重复埋点：

| 位置 | 改动 |
| --- | --- |
| `packages/shared/inference.ts:210-250` | `InferenceClientFactory.build()` 返回 `withMetering(client, { task, userId })`；或新增 `build({ task, userId, bookmarkId })` 重载 |
| `apps/workers/workers/inference/inferenceWorker.ts:86` | 传入 `task`/`bookmarkId`/`userId` |
| `apps/workers/workers/embeddingsWorker.ts:429` | 传 `task: "embed"` |
| `apps/workers/workers/assetPreprocessingWorker.ts:143` | 传 `task: "ocr"` |
| `packages/trpc/routers/bookmarks.ts:1565` | 传 `task: "summarize"` + `userId` |

写入建议异步化（`void recordUsage(...)` 或队列），不要阻塞主链路；失败只记 warning。

#### 10.2.3 聚合与暴露

```ts
// packages/trpc/routers/users.ts 新增
aiUsage: usersProcedure
  .input(z.object({ from: z.date().optional(), to: z.date().optional() }))
  .output(zAiUsageResponseSchema)   // total / byTask / byModel / byDay
```

- 查询：`SELECT task, model, SUM(totalTokens), COUNT(*) FROM aiUsage WHERE userId=? AND createdAt>=? GROUP BY task, model`
- 前端：`apps/web/app/settings/stats/page.tsx`（已有页面，19KB）追加「AI 用量」区块；`clientConfig` 增加 `chat.enabled`、`inference.usageTrackingEnabled`（`packages/shared/config.ts:665-694`）。
- 指标：`apps/workers/metrics.ts` 增加 `karakeep_inference_tokens_total{task,model}` 与 `karakeep_inference_latency_seconds`，与现有 `workerStatsCounter` 并列。

#### 10.2.4 配额（与现有 quota 体系对齐）

现有配额只有书签数与存储：`packages/shared/config.ts:261-266`、`FREE_QUOTA_*`/`PAID_QUOTA_*`。建议新增：

```
FREE_QUOTA_AI_TOKENS_MONTHLY=200000
PAID_QUOTA_AI_TOKENS_MONTHLY=5000000
```

在 `QuotaService`（已被 `assetPreprocessingWorker` 使用，`assetPreprocessingWorker.ts:231-235`）旁增 `AiQuotaService.checkAndConsume(userId, task, estimatedTokens)`，超限时：

- 打标签/摘要：跳过并写 `*Status='failure'`，不重试
- 对话：直接 `TRPCError({code:"FORBIDDEN", message:"AI quota exceeded"})`

### 10.3 最关键的 3 个改造点（按优先级）

#### P0-1 分块 + chunk 级向量（解锁「语义质量」与「RAG」双重能力）

- 新增 `packages/shared/chunking.ts`：按 markdown 标题 / 段落 / 句子切分，目标 800–1200 token，overlap 100–150，中文按标点+长度双条件。
- 新增 `bookmarkChunks(id, bookmarkId, userId, ord, text, tokenCount, headingPath, page?)` + 迁移 0097；向量文档 id 改为 `chunkId`，`bookmarkId` 作为 filterable 字段。
- `embeddingsWorker.ts`：`embed` 阶段切块 → 批量 `generateEmbeddingFromText(chunkTexts)` → `index` 阶段批量写；`delete` 按 `bookmarkId` 过滤删除。
- `bookmarks.ts` 检索：语义腿命中 chunk → 按 `bookmarkId` 聚合（max score / sum of top-k）→ 再与全文腿 RRF。
- 影响面：`vectorStore.ts`（`search` 增加 `groupBy` 语义或返回 `bookmarkId`）、`vectorstore-meilisearch/src/index.ts`（filterable 加 `bookmarkId`）、`admin.ts`（重建按 chunk）。

#### P0-2 RAG 对话链路（补最大空白）

- `packages/shared/inference.ts`：`inferFromMessages(messages, { schema, stream })`；OpenAI 分支用 `chat.completions.create({ stream:true })`；Ollama 分支用 `ollama.chat`。
- 新建 `packages/trpc/routers/chat.ts` + `packages/trpc/lib/rag/{retrieve,context,compose}.ts`。
- 引用契约：`metadata.citations = [{ index, bookmarkId, chunkId, title, snippet, score }]`，prompt 中强制 `[n]` 标注，前端渲染可点击卡片。
- 流式：优先 `apps/web/app/api/chat/route.ts`（SSE，Web ReadableStream）；tRPC 侧保留非流式兜底。
- 开关：`CHAT_ENABLED` 接入 `clientConfig`（已有位，`config.ts:686-688`）+ 导航项条件渲染。

#### P1-3 Provider 注册表 + 用量计量（解锁「多模型」与「可运营」）

- `packages/shared/inference.ts` 拆为 `providers/{openai,ollama,anthropic?}.ts` + `registry.ts`；能力声明 `capabilities: { text, vision, embedding }`。
- 配置从「一组全局 env」升级为「provider 列表 + 每任务模型绑定」：`INFERENCE_TEXT_MODEL`、`INFERENCE_VISION_MODEL`、`INFERENCE_OCR_MODEL`、`INFERENCE_EMBED_MODEL`、`CHAT_MODEL`、`INFERENCE_RERANK_MODEL`。
- 同时接入 §10.2 的 `MeteredInferenceClient`，让「换 provider」与「算账」在同一层完成。

### 10.4 分阶段落地建议

| 阶段 | 内容 | 验收标准 |
| --- | --- | --- |
| 第 1 周 | 迁移 0097（`aiUsage`）；`MeteredInferenceClient`；users.aiUsage 接口；stats 页展示 | 任一打标签作业后，`aiUsage` 有行、stats 页可见 token 数 |
| 第 2 周 | `bookmarkChunks` + 切分器 + chunk 向量化 + 检索聚合 | 一篇 5 万字文章可"命中第 3 节"；长文语义召回率对比基线提升 |
| 第 3–4 周 | chat router + RAG 上下文 + 引用 + 流式 + UI | 多轮对话可用；每条回答带 ≥1 条可点击引用；`CHAT_ENABLED=false` 时入口消失 |
| 第 5 周 | provider 注册表 + 能力矩阵 + 配额拦截 + 指标 | 可在不改代码的情况下切 provider；超配额返回明确错误码；Prometheus 有 token 序列 |

### 10.5 回归风险清单

1. **向量维度变更**：`EMBEDDING_DIMENSIONS` 与 Meili embedder 必须同步，改造分块时务必保留「维度指纹 + 强制重建」开关（当前仅手动 `clearIndex`，`admin.ts:344-347`）。
2. **标签全量替换语义**：`connectTags` 先删后插（`tagging.ts:479-507`）。加入 chunk 重试后，必须保证「同一个 bookmark 的标签作业幂等」，否则会丢标签。
3. **双索引一致性**：chunk 化后，全文索引仍是「一书签一文档」，向量索引变「一 chunk 一文档」。删除书签需同时清理两处（现有删除在 `packages/trpc/models/bookmarks.ts:1033-1046`）。
4. **`matchingStrategy:"all"`**：任何检索相关改造都要做中文/英文/混合查询的召回回归（`search-meilisearch/src/index.ts:93`）。
5. **`detail:"low"`**：改视觉链路前，先量化 OCR 与 caption 质量差异（`inference.ts:401`）。

---

## 附录 A：关键文件索引

| 文件 | 职责 | 行数量级 |
| --- | --- | --- |
| `packages/shared/inference.ts` | Provider 抽象与两个实现、嵌入、结构化输出、token | 598 |
| `packages/shared/config.ts` | 全部 env 与派生配置、clientConfig | 717 |
| `packages/shared/prompts.ts` / `prompts.server.ts` | 模板与 token 截断 | 158 / 94 |
| `packages/shared/search.ts` / `vectorStore.ts` | 两个统一检索接口 | 83 / 88 |
| `packages/shared/searchQueryParser.ts` | 查询语言 | 484 |
| `packages/shared/plugins.ts` | 插件注册表（推理侧无等价物） | 110 |
| `apps/workers/workers/embeddingsWorker.ts` | 嵌入链路 | 499 |
| `apps/workers/workers/inference/{inferenceWorker,tagging,summarize}.ts` | 推理链路 | 124 / 739 / 193 |
| `apps/workers/workers/{searchWorker,assetPreprocessingWorker,crawlerWorker}.ts` | 索引/资产/抓取 | 191 / 508 / 2282 |
| `packages/plugins/{search,vectorstore}-meilisearch/src/index.ts` | Meili 实现 | 223 / 288 |
| `packages/trpc/routers/bookmarks.ts` | 检索引擎入口 + 手动摘要 | 1670 |
| `packages/trpc/lib/searchRanking.ts` / `lib/search.ts` | RRF / 限定符解析 | 47 / 307 |
| `packages/db/schema.ts` | 表结构（含未使用的 chat 表） | 1402 |

## 附录 B：本次审计的「反向确认」记录（确认不存在的能力）

| 能力 | 检索方式 | 结果 |
| --- | --- | --- |
| Chat 路由 | 读 `routers/_app.ts` 全量 | 无 chat |
| Chat 前端 | grep `chat|useChat` in `apps/web` | 仅命中 localStorage 常量 |
| 流式输出 | grep `ReadableStream|EventSource|streaming` in `apps/web` | 0 命中 |
| 引用 | grep `citation|source|rag` | 无业务命中 |
| 分类 | grep `classify|categorize` | 仅 problemReports/feed |
| 图片 caption | grep `caption|describeImage` | 仅 OCR prompt 文本 |
| 关键词抽取 | 全量读 `prompts.ts`（6 模板） | 无 |
| 用量表 | grep `totalTokens|usage` in `packages/db` | 无 |
| Token 指标 | 读 `apps/workers/metrics.ts`（39 行） | 仅作业计数 |
| 重排 | grep `rerank|reranker` | 无 |
