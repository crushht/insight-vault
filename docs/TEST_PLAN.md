# 测试计划 TEST PLAN

> 对应需求：[PRODUCT_REQUIREMENTS](PRODUCT_REQUIREMENTS.md)｜对齐阶段：[DEVELOPMENT_ROADMAP](DEVELOPMENT_ROADMAP.md)
> 原则：**没有测试的功能不算完成**；每阶段结束必须附测试报告。

---

## 1. 现状（基线）

| 层 | 工具 | 数量 | 可用性 |
|---|---|---|---|
| 单元测试 | Vitest | 7 文件 / 56 用例（`apps/web/**/*.test.tsx`） | ⚠️ `apps/web` 的 `test` 脚本是 **watch 模式**，CI 会挂住（P2-13 修） |
| 后端单测 | Vitest | `packages/trpc/routers/*.test.ts` 19 个（最大 `sharedLists.test.ts` 88 KB） | ✅ 可跑 |
| E2E | **Vitest + Playwright 作为库**（不是 `@playwright/test` runner） | 31 文件 / 175 用例；web 11 文件 / 52 用例 | ⚠️ 全部依赖英文可访问名（`exact: true` 多处），改文案即全红 |
| 组件渲染测试 | `@testing-library/react` 已装但**零使用** | 0 | ❌ 需补 |
| 视觉回归 | 无 | 0 | ❌ 用 Craft Anything 新建 |
| 性能 | 无 | 0 | ❌ 需补 |
| 安全/越权 | 部分单测覆盖 | 少量 | 🟡 需系统化 |

**结论**：后端测试尚可，前端与视觉几乎无护栏。P2 的第一件事是补护栏而不是改 UI。

---

## 2. 测试策略

```
        ┌──────────────┐
        │  手工验收     │  每阶段末，按 PRD 用户旅程走一遍
        ├──────────────┤
        │  视觉回归     │  Craft Anything 截图 diff（8 页 × 2 宽）
        ├──────────────┤
        │  E2E（关键路径）│  Vitest + Playwright：注册/收藏/搜索/RAG/付费
        ├──────────────┤
        │  集成测试     │  tRPC procedure + 真实 SQLite（临时目录）
        ├──────────────┤
        │  单元测试     │  纯函数、解析器、分块、引用拼装、配额计算
        └──────────────┘
```

### 2.1 分层职责

| 层 | 覆盖什么 | 不覆盖什么 | 目标数量 |
|---|---|---|---|
| 单元 | 分块算法、搜索语法解析、引用编号、配额判定、URL 归一化、Markdown 渲染 | UI、网络 | ≥200 |
| 集成 | procedure 权限、DB 读写、级联删除、租户隔离 | 浏览器行为 | ≥80 |
| E2E | 5 条用户旅程 + 3 条异常旅程 | 边界分支 | ≥40 |
| 视觉 | 8 页 × 2 宽 + 3 个关键弹层 | 交互中间态 | 22 张基线 |
| 手工 | 中国源真机、移动端、扩展 | — | 每阶段 1 轮 |

---

## 3. 测试环境

| 项 | 值 |
|---|---|
| 数据目录 | 临时目录 `DATA_DIR`，每个测试套件独立（避免串数据） |
| 数据库 | 真实 SQLite（`:memory:` 或临时文件），跑全部 97 个迁移 |
| 搜索 | 单元/集成测试用内存 stub；E2E 可选真实 Meilisearch |
| AI | 默认 Mock provider（返回确定性文本 + 固定引用）；少量真实调用做冒烟 |
| 浏览器 | Playwright Chromium（本机已具备 Chrome 156） |
| 视觉 | Craft Anything `web_site_capture` + `web_pixels_compare` |

**Mock 原则**：只 mock 外部不可控（AI API、第三方站点），**不 mock 自己的数据库与队列**。任务书明确禁止「用假数据代替真实业务」。

---

## 4. 用例矩阵

### 4.1 认证与账户

| ID | 用例 | 层 | 期望 |
|---|---|---|---|
| T-AUTH-01 | 邮箱注册成功 | E2E | 进入 dashboard，`role=admin`（首用户） |
| T-AUTH-02 | 重复邮箱注册 | 集成 | 422 `USER_ALREADY_EXISTS` |
| T-AUTH-03 | 错误密码登录 | E2E | 表单错误提示，不泄露「用户是否存在」 |
| T-AUTH-04 | 无 session 访问 `/dashboard/bookmarks` | E2E | 重定向到 `/signin` |
| T-AUTH-05 | 会话过期后访问 | 集成 | 401 + 重定向 |
| T-AUTH-06 | API Key 鉴权 | 集成 | 200；scope 不足时 403 |
| T-AUTH-07 | 普通用户调用 admin procedure | 集成 | 403 |
| T-AUTH-08 | 密码重置流程 | E2E | 邮件链接可用（Mock 邮件） |
| T-AUTH-09 | 注册：密码 + 6 位邮箱验证码 | E2E（脚本） | 验证码正确 → 建号并**直接拿到 session cookie**（`Max-Age=2592000`） |
| T-AUTH-10 | 注册：弱密码 / 错码 / 已注册邮箱 | E2E（脚本） | 400 / 401 / 409，且不暴露多余信息 |
| T-AUTH-11 | 登录：邮箱 + 密码 | E2E（脚本） | 200 + session cookie；错密码 401 |
| T-AUTH-12 | 会话持久化 | E2E（脚本） | 杀掉服务再起，复用同一 cookie 直接进收藏库 |
| T-AUTH-13 | 无 SMTP 的本地模式 | E2E（脚本） | 仅回环 + 桌面/非生产回显验证码；公网返回 501 |
| T-AUTH-14 | 验证码防刷 | 集成 | 同邮箱 60 秒冷却、每小时 8 次、一次性消费 |

> T-AUTH-01/09~13 由 `scripts/e2e-auth.mjs` 覆盖（10 条断言 + 一次重启复用）：
> ```bash
> node scripts/e2e-auth.mjs http://127.0.0.1:3000 --save-cookie C:\tmp\iv.cookie
> # 重启服务后
> node scripts/e2e-auth.mjs http://127.0.0.1:3000 --use-cookie  C:\tmp\iv.cookie
> ```

### 4.1.2 抓取链路烟测

`scripts/e2e-capture.mjs`（`pnpm test:capture`）不依赖外网/Meilisearch/Chrome：
自己起一个假站点 → 创建链接收藏 → 拉起 workers 真抓 → 断言 5 项：

| # | 断言 | 说明 |
|---|---|---|
| 1 | 创建链接收藏 | tRPC `bookmarks.createBookmark` 返回 id |
| 2 | 抓取状态 success | `bookmark.content.crawlStatus === "success"` |
| 3 | 标题被改写 | 变成页面 `<title>`，不再是 URL |
| 4 | 按标题能搜到 | SQL 降级搜索（无 Meili）命中 |
| 5 | 按正文能搜到 | 正文里的独有词也能命中（验证 htmlContent 参与搜索） |

> 抓取器默认拒绝内网地址（防 SSRF），脚本里用 `CRAWLER_ALLOWED_INTERNAL_HOSTNAMES=127.0.0.1` 放行。

### 4.1.3 导入 / 导出（换机器迁移）
`scripts/e2e-import-export.mjs`（`pnpm test:ie`）自带临时库 + **workers**（导入是暂存→后台落库）：

| # | 断言 |
|---|---|
| 1 | 造 30 条收藏后，`GET /api/bookmarks/export?format=json` 条数 = 30 |
| 2 | 导出的 JSON 含全部标题 |
| 3 | `bookmarks.exportAll {format:"markdown"}` 含全部标题 |
| 4 | 在 `/settings/import` 上传 Raindrop CSV（5 条）成功 |
| 5 | 轮询导出，5 条全部落库 |
| 6 | 导入后总数 = 35 |

### 4.1.1 浏览器端自动化（Playwright）

`scripts/e2e-web.mjs` 自己拉一套干净环境（临时 DATA_DIR + 迁移 + **生产构建 standalone** + `LOCAL_AUTH_CODE=1`），
用 Playwright 驱动真实浏览器，跑完自动清理：

```bash
pnpm test:e2e:web                 # 默认端口 3010，跑完打印 PASS/FAIL
E2E_MODE=dev pnpm test:e2e:web    # 想跑 next dev（注意下面那条坑）
E2E_DEBUG=1 pnpm test:e2e:web     # 额外打印页面 console 与 /api 响应
```

覆盖 6 条：

| # | 场景 | 断言 |
|---|---|---|
| 1 | 登录页渲染 | 标题「欢迎回来」、邮箱/密码输入框、「保持登录」默认勾选、无 SMTP 时不出现验证码入口 |
| 2 | 注册 → 自动登录 | 发码后本地模式自动填 6 位码 → 提交后落在 `/dashboard/bookmarks` |
| 3 | 刷新 | 仍在 `/dashboard/bookmarks`，不被踢回登录页 |
| 4 | 清 cookie 访受保护页 | 重定向到 `/signin` |
| 5 | 邮箱 + 密码登录 | 邮箱已从 localStorage 预填，登录后回收藏库 |
| 6 | 错误密码 | 出现「邮箱或密码错误」提示，不跳转 |
| 7 | 重新登录 | 输密码后回到收藏库 |
| 8 | 新建文字笔记 | 编辑器内容被清空 + 刷新后列表里出现该笔记 |
| 9 | 搜索命中 | `/dashboard/search?q=…` 能搜到刚建的笔记 |
| 10 | 分类页 | `?q=is:image` 渲染、无错误覆盖层 |
| 11 | 设置页 | `/settings/ai` 有供应商预设、`/settings/info` 无错误 |
| 12 | 390 宽 | 收藏库无横向溢出（scrollWidth ≤ clientWidth） |
| 13 | 键盘可达 | Tab 能聚焦到收藏卡片的 `/dashboard/preview/<id>` 链接，Enter 能打开 |

> **坑**：Next 16 的 `next dev`（Turbopack）在本机跑出来的页面**不水合**（点击无反应、只有 HMR WebSocket 报错），
> 而生产构建完全正常。所以这个套件默认打生产构建；不要拿 dev 现象判断「功能坏了」。


### 4.1.4 PWA 离线（`pnpm test:pwa`）

| # | 断言 |
|---|---|
| 1 | `/sw.js` 可访问且是我们手写的那份 |
| 2 | 首访后 Service Worker 激活 |
| 3 | 刷新后页面被 SW 接管（`navigator.serviceWorker.controller` 非空） |
| 4 | **停掉服务器**后访问 `/dashboard/bookmarks` → 200 且是缓存页（不是浏览器错误页） |
| 5 | 停掉服务器后访问 `/offline` → 200 兜底页 |

> **坑**：不要用 Playwright 的 `context.setOffline(true)` 验证 SW 离线 —— 它不作用到 Service Worker 的请求，
> 测出来永远是浏览器错误页。这个脚本直接 `taskkill` 服务器进程来模拟真断网。

### 4.1.5 浏览器扩展（`pnpm test:ext`）

| # | 断言 |
|---|---|
| 1 | `dist/` 有 manifest.json（先跑扩展 build） |
| 2–6 | MV3 / 名称是「灵感仓」/ 有 background service worker / 有 popup / 权限齐全 |
| 7 | 以「加载已解压扩展」方式启动后，扩展 service worker 注册成功 |
| 8 | popup 页面能渲染（非空白） |
| 9 | popup 已中文化（含「邮箱」「登录」） |
| 10 | popup 不再出现上游域名（`karakeep.com`） |

### 4.1.6 AI 链路（`pnpm test:ai`，本地 mock，不需要真 Key）

脚本内起一个 OpenAI 兼容 mock（`/v1/chat/completions` 含 SSE 流、`/v1/embeddings`），
web + workers 通过 `OPENAI_*` / `EMBEDDING_*` 指向它，然后断言：

| # | 断言 |
|---|---|
| 1 | 造一条笔记 → workers 分块 → 提问，回答里出现 `[1]` |
| 2 | `chat.sendMessage` 返回的 `citations` 非空且带 quote |
| 3 | `topics.generate` 返回 `mode: "ai"`（而不是 draft 兜底）且 markdown 带引用 |
| 4 | `POST /api/chat/stream` 能推送 `{"delta": ...}` 帧 |

> 意义：真实模型仍然没验（没有 Key），但**协议、分块、检索、引用校验、专题、流式**这条链已经用 mock 端到端跑通，
> 换成任何 OpenAI 兼容端点只差一个 Base URL。

### 4.2 收藏

| ID | 用例 | 层 | 期望 |
|---|---|---|---|
| T-COL-01 | 收藏一个 URL | E2E | 先出现 loading 条目，抓取完成后有标题/摘要 |
| T-COL-02 | 抓取失败（404 站点） | 集成 | `crawlStatus=失败`，有重试入口，不阻塞其他条目 |
| T-COL-03 | 重复 URL | 集成 | 提示重复；强制新增可创建 |
| T-COL-04 | URL 归一化 | 单元 | `?utm_*`、`#anchor`、短链 归一后一致 |
| T-COL-05 | 上传图片 | E2E | 缩略图生成，OCR 状态流转 `pending→done` |
| T-COL-06 | 上传 PDF | E2E | 可全文搜索；首页图生成 |
| T-COL-07 | 文字笔记 | E2E | Markdown 渲染正确，进检索 |
| T-COL-08 | 批量操作 500 条 | 集成 | 成功，有进度 |
| T-COL-09 | 导入 Raindrop CSV | 集成 | 1000 条无丢失 |
| T-COL-10 | 导出后重新导入 | 集成 | 数据等价（字段级比对） |
| T-COL-11 | 微信文章（登录墙） | 手工 | 有降级路径：扩展剪藏 / 手动补录 |
| T-COL-12 | B 站视频页 | 手工 | 标题/封面/UP 主/时长正确 |
| T-COL-13 | 小红书（风控） | 手工 | 明确标注「需人工补充」，不静默失败 |

### 4.3 检索

| ID | 用例 | 层 | 期望 |
|---|---|---|---|
| T-SRCH-01 | 全文搜索命中标题 | 集成 | 返回正确结果 |
| T-SRCH-02 | 查询语法（tag:/list:/is:fav） | 单元 | 解析树正确 |
| T-SRCH-03 | 语义搜索近义命中 | 集成 | 「向量数据库」命中「embedding store」 |
| T-SRCH-04 | 混合检索融合顺序 | 单元 | RRF 结果稳定 |
| T-SRCH-05 | 空结果 | E2E | 空状态 + 建议，不是报错 |
| T-SRCH-06 | 10 万条 P95 | 性能 | <300ms（全文）/<800ms（语义） |

### 4.4 AI / RAG

| ID | 用例 | 层 | 期望 |
|---|---|---|---|
| T-AI-01 | 自动标签 | 集成 | 60s 内产出，`attachedBy=ai` |
| T-AI-02 | 标签重试幂等 | 集成 | 重跑不丢已有 AI 标签 |
| T-AI-03 | 长文分块 | 单元 | 500–800 token/块，重叠 15%，offset 连续 |
| T-AI-04 | 向量维度变更 | 集成 | 检出并阻止，提示重建 |
| T-AI-05 | RAG 回答带引用 | E2E | 每句有 `[n]`，点击跳原文 |
| T-AI-06 | 无依据问题 | E2E | 明确「资料中没有」 |
| T-AI-07 | 多轮上下文 | E2E | 第 3 轮仍记得主题 |
| T-AI-08 | 流式输出 | E2E | 首 token <1.5s，无重复渲染 |
| T-AI-09 | 用量记账 | 集成 | token 与 provider 返回值一致 |
| T-AI-10 | 额度耗尽 | E2E | 402/403 + 升级引导 |
| T-AI-11 | 图片理解 | 集成 | 生成 caption 且可检索 |

### 4.5 组织与协作

| ID | 用例 | 层 | 期望 |
|---|---|---|---|
| T-ORG-01 | 3 级收藏夹 | E2E | 可创建/移动/删除 |
| T-ORG-02 | viewer 尝试新增条目 | E2E | 403 |
| T-ORG-03 | editor 移除他人条目 | 集成 | 403（修 R1 后） |
| T-ORG-04 | 共享列表内容可被搜索 | 集成 | 命中（修 P4-3 后） |
| T-ORG-05 | 标签合并 | 集成 | 关联不丢、无重复 |
| T-ORG-06 | 大列表翻页 | 性能 | 无 `TEMP B-TREE`，第 50 页仍 <200ms |

### 4.6 商业化

| ID | 用例 | 层 | 期望 |
|---|---|---|---|
| T-BIL-01 | 下单→支付→权益生效 | 集成 | tier 变更，无需重登 |
| T-BIL-02 | Webhook 重放 | 集成 | 幂等，不重复发放 |
| T-BIL-03 | 订阅到期 | 集成 | 降级到 free，数据不删 |
| T-BIL-04 | 退款 | 集成 | 订单 `refunded`，权益回收 |
| T-BIL-05 | 额度边界 | 集成 | 第 N 次允许、第 N+1 次拒绝 |

### 4.7 视觉与响应式

| ID | 用例 | 层 | 期望 |
|---|---|---|---|
| T-UI-01 | 8 页 × 390/834/1440 | 视觉 | 无溢出/遮挡；diff <0.5% |
| T-UI-02 | 明暗切换 | 视觉 | 无隐形文字，对比度 ≥4.5:1 |
| T-UI-03 | 四态（loading/empty/error/正常） | 手工 | 每页齐全 |
| T-UI-04 | 中文长标题折行 | 视觉 | 不溢出、不截断关键信息 |
| T-UI-05 | 键盘可达性 | 手工 | Tab 顺序合理，焦点可见 |

---

## 5. 数据隔离测试（强制，每次发布必跑）

**目标**：证明 A 用户无法以任何方式读到/改动 B 用户的数据。

做法：脚本创建 A、B 两个用户，各 20 条收藏（含 1 个共享列表），然后对**每一个**带 `userId` 的 procedure 做交叉调用：

| 检查项 | 期望 |
|---|---|
| A 用 B 的 bookmarkId 调 `bookmarks.get` | 404/403 |
| A 调 `bookmarks.list` 传入 B 的 cursor | 无数据泄漏 |
| A 调 `lists.get` B 的私有列表 | 403 |
| A 通过搜索（含语义）检索 B 的独特关键词 | 0 结果 |
| A 调 `assets.get` B 的资产 | 403 |
| A 用 B 的 share token 访问受保护接口 | 403 |
| A 修改 URL 里的 userId 参数 | 无效（服务端忽略） |
| A 调 `admin.*` | 403 |
| 删除 B 的账号后，A 的搜索索引中无 B 的残留 | 通过 |
| RAG 提问 B 的独有内容 | 回答「资料中没有」，不泄内容 |

自动化实现：`packages/trpc/__tests__/isolation.test.ts`，每次 CI 必跑，失败即阻断合并。

---

## 6. 中国内容源测试样本

| 站点 | 样本量 | 判定 |
|---|---|---|
| 微信公众号 | 10 篇（含 3 篇需登录） | 自动 ≥5 篇成功；其余必须给出降级入口 |
| B 站 | 10 个视频 | 元数据 ≥8 个正确 |
| 小红书 | 10 篇 | 3 篇成功即可接受；失败必须明确说明原因 |
| 知乎 | 10 个问答 | 正文 ≥6 篇成功 |

**判定原则**：**失败不算 bug，静默失败才是 bug。** 任何失败都必须有用户可见的原因与下一步动作。

---

## 7. 视觉回归（Craft Anything）

1. 基线：`artifacts/visual/baseline/<page>-<width>.png`（8 页 × 2 宽 = 16 张 + 3 个弹层）；
2. 采集：`web_site_capture`（含 `noise_pass` 排除轮播/视频自变化区域）；
3. 对比：`web_pixels_compare`（`common_area=true`，`tolerance=8`）；
4. 阈值：布局相似度 ≥0.97、差异像素占比 ≤0.5%；超阈值即失败；
5. 每次合并前跑一次，结果附在 PR 里。

---

## 8. 性能与容量

| 指标 | 目标 | 方法 |
|---|---|---|
| 首屏 LCP | <2.0s（本地） | Lighthouse / Playwright trace |
| 搜索 P95 | 全文 <300ms，语义 <800ms | 10 万条合成数据 |
| 列表滚动 | 60fps | 500 条网格 |
| 抓取吞吐 | ≥200 条/分钟（单 worker） | 压测脚本 |
| 内存 | workers 稳态 <800MB | 长跑 2h |
| 图谱渲染 | 1000 节点 ≥30fps | 性能面板 |

---

## 9. CI 门槛（合并前必须全绿）

```
1. pnpm typecheck
2. pnpm lint
3. pnpm test（单元 + 集成，非 watch）
4. isolation.test.ts（数据隔离）
5. E2E 关键路径（注册/收藏/搜索/RAG/付费 5 条）
6. 视觉回归（阈值内）
7. 迁移可重放（空库跑全量迁移 0 错）
```

> 现状：第 3 条会因 `apps/web` 的 watch 模式挂住；第 6 条不存在。
>
> **环境前提**：turbo 需要 `pnpm` 可执行文件在 PATH 中（本机只有 corepack 时需要额外 shim），
> 否则 `pnpm typecheck` 会报 `Unable to find package manager binary`。P2 必须先补齐这两项，否则后续所有阶段的「绿」都不可信。

---

## 10. 缺陷分级与响应

| 级别 | 定义 | 响应 |
|---|---|---|
| Blocker | 数据丢失、越权、无法启动 | 立刻修，阻断发布 |
| Critical | 核心功能不可用（收藏/搜索/AI 全挂） | 24h 内修 |
| Major | 功能可用但有明显错误 | 本阶段内修 |
| Minor | 视觉/文案/边界 | 排期修 |
| Trivial | 建议项 | 记录，不承诺 |

---

## 11. 每阶段测试报告模板

```markdown
## 阶段 PN 测试报告
- 执行用例：X / Y（通过率）
- 新增用例：N（单元 n1 / 集成 n2 / E2E n3 / 视觉 n4）
- 失败用例与根因：
- 数据隔离：通过 / 失败（附证据）
- 视觉 diff：最大差异页面与数值
- 性能：LCP / 搜索 P95 / 内存
- 已知问题与风险：
- 下阶段测试重点：
```

### 4.1.7 备份 / 恢复（`pnpm test:backup`）

| # | 断言 |
|---|---|
| 1 | `backups.triggerBackup` 后轮询到 `status=success`（备份是后台任务，需 workers） |
| 2 | 产物落在 `DATA_DIR/assets/<userId>/<assetId>/asset.bin` |
| 3 | 解包后 JSON 里书签数 = 3、列表 ≥1、标签在 |
| 4 | 删光收藏后搜索为 0（模拟丢失） |
| 5 | 走 `createImportSession → stage → finalize` 恢复后，3 条全部回来 |
### 4.1.8 PDF 与 OCR（`pnpm test:pdf`，需要视觉模型）

| # | 断言 |
|---|---|
| 1 | 有文本层的 PDF → `bookmarkAssets.content` 含正文（61 字符） |
| 2 | 扫描件（只有图片的 PDF）→ 视觉 OCR 读出文字（46 字符，metadata 记 `ocr=vision`） |
| 3 | 图片 → LLM OCR 读出截图文字（38 字符） |

> 前置：`OPENAI_BASE_URL` + `OPENAI_API_KEY` + `INFERENCE_IMAGE_MODEL` 指向一个**支持视觉**的模型；
> 桌面版默认 `OCR_USE_LLM=true`。渲染页数由 `PDF_OCR_MAX_PAGES`（默认 5）控制。
