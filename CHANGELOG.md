# 变更日志 CHANGELOG

本项目遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。
日期为发布日；`未发布` 段落记录当前主干上的改动。

---

## [未发布]

### 验证与文档

- **备份 / 恢复端到端**：`pnpm test:backup` —— 造 3 条收藏 + 列表 + 标签 → 触发备份（后台任务）→
  在 `assets/<userId>/<assetId>/asset.bin` 找到产物解包对账 → 删光 → 走应用自己的导入流水线恢复 → 3/3 回来。8/8 通过。
- **AI 链路端到端（mock）**：`pnpm test:ai` 本地起 OpenAI 兼容 mock（含 SSE 流），
  web + workers 指向它后验证：分块 → 检索 → 回答带 `[1]` 引用 → 引用数组带 quote →
  专题 `mode=ai` → `/api/chat/stream` 推送 `delta`。4/4 通过。
  真实模型仍缺（没有 Key），但协议与链路已经证明，换任意 OpenAI 兼容端点只差 Base URL。
- 截图刷新：`docs/screenshots` 换成本机实拍的 1.1.0 界面（登录 / 注册 / 收藏库 / 设置·AI 预设 / 设置·系统状态），
  README 截图区重排成 5 组并给每张标了说明。

## [1.1.0] — 2026-11-13

### 账号与登录（本轮重点）

- **注册 = 邮箱 + 密码 + 邮箱验证码**：`POST /api/otp/register` 先校验 6 位验证码（证明邮箱归属），
  再建账号并直接签发 session。注册完成即登录，不再需要「先去邮箱点链接、回来再登一次」。
- **登录 = 邮箱 + 密码**：登录页把邮箱密码放在第一位，验证码登录降级为折叠的次要入口。
- **记住账号**：默认勾选「在这台设备上保持登录（30 天）」，session cookie 带 `Max-Age` 落盘；
  邮箱记在 `localStorage`，下次打开只需补密码。关闭「保持登录」则退化为会话级 cookie。
- **验证码本地模式**：没配 SMTP 时，本机回环请求（桌面版）会把验证码直接回显在页面上并自动填入，
  首次使用开箱即用；公网实例不启用该回退。
- 验证码防刷：同邮箱 60 秒冷却、每小时最多 8 次、一次性消费、注册码 15 分钟 / 登录码 5 分钟。
- 注册成功后不再重复发一封「验证邮件」（`sendOnSignUp` 钩子被显式跳过）。
- 桌面版会话延长到 **365 天**（`AUTH_SESSION_DAYS`），登录一次长期有效。
- 修：桌面版改过应用名后旧 userData 目录（`%APPDATA%\@karakeep\desktop`）里的账号会「消失」，
  现在首次启动会自动把老数据与配对的 `secret.txt` 迁到 `%APPDATA%\InsightVault`（失败不阻塞启动）。

### 桌面版（Windows）

- 启动画面：服务就绪前有进度反馈，不再「双击没反应」。
- 子进程自动恢复：web / workers 意外退出会被拉起（最多 3 次，之后弹窗提示可手动重启）。
- 托盘菜单扩充：打开 / 快速收藏剪贴板链接 / 重启本地服务 / 打开数据目录 / 打开日志目录 /
  **邮箱服务设置（SMTP）** / 关于 / 退出。
- 新增 SMTP 设置窗口：填一次服务器、端口、账号、授权码，写入 `userData/smtp.json`（0600），
  重启服务后生效；之后的验证码真的发到邮箱。
- 会话持久化：主窗口使用 `persist:insightvault` 分区，登录态跨重启保留。
- 安全收紧：拒绝所有浏览器权限请求、禁用 webview、外链一律走系统浏览器；
  `Ctrl/Cmd+= / - / 0` 缩放，无菜单栏时的最小可用集合。
- 窗口位置记忆增加「是否还在可见屏幕内」校验（拔掉外接屏后不会跑到屏外）。
- 修：开发模式下迁移目录取错（取的是 Electron 的 `resourcesPath`）。

### 工程与发布

- **界面英文清扫**：导入页 14 处 `Import/Export/HTML File`、列表与高亮的 `Load More`、
  阅读台 `Reader View / Highlights / saved`、设置里的 `Timezone`、删除账号确认文案、对话框 `Close/Add` 全部改成中文；
  新增 `lib/i18n-en-strings.test.ts` 防回潮（扫 `components/` 与 `app/` 的 `.tsx`，命中黑名单即失败）。
- **浏览器扩展真正跑起来了**：`pnpm test:ext` 会构建扩展、校验 MV3 manifest（名称/权限/背景脚本/popup），
  再用「加载已解压扩展」在 Chromium 里真加载一次并打开 popup。顺手把扩展里残留的上游痕迹清掉：
  默认服务器地址 `cloud.karakeep.com` → `localhost:3000`，登录页/服务器页文案全部中文化。
- **PWA 离线壳**：手写 `public/sw.js`（导航网络优先 4 秒 → 缓存页 → `/offline` 兜底；`_next/static` 与图片字体缓存优先；
  `/api/*` 完全不拦），新增 `/offline` 页与「装到桌面」提示（`beforeinstallprompt`，拒绝过就不再打扰）；
  退出登录时清空 SW 缓存，避免共用浏览器看到上一个账号的页面。
- **阅读台「就这篇提问」**：`/reader/<id>` 右上角新增 AI 面板，提问只在**这条收藏自己的分块**里检索，
  回答带 `[n]` 引用（点开看命中原文）；不写聊天历史、不跨收藏串味。
  后端 `chat.askAboutBookmark` 做了归属校验与引用越界校验，没配模型时返回明确错误（面板给「去配置」入口）。
  5 条单测（mock 模型：命中/未命中/未配模型/越权/伪造引用）。
- **导入 / 导出烟测**：`pnpm test:ie` —— 造 30 条收藏 → 导出 JSON / Markdown 对账 →
  在设置页真上传一份 Raindrop CSV（5 条）→ 等 workers 落库 → 再导出核对总数 35。6/6 通过。
  顺带给上传按钮的隐藏 `input[type=file]` 加了 `data-testid`，测试不用靠猜 DOM 顺序。
- **无障碍**：`jsx-a11y` 警告清零 —— 侧栏的拖放事件挂到可交互的 `<Link>` 上，
  图谱表格的空表头补 `sr-only` 文案；新增 Playwright 键盘回归（Tab 到收藏卡片 → Enter 打开）。
- **知识图谱性能**：布局从「全节点两两斥力 × 80 次」换成**空间网格近似**（只算相邻 3×3 格子），
  1000 节点 **823ms → 72ms（11.4×）**、500 节点 157ms → 23ms（6.8×）；
  边合成一条 `<path>`（1500 条边 = 1 个 DOM 节点），标签按提及数限 16/40 个；
  页面新增 200/500 显示上限选择器（实测切换 178ms，500 点 SVG 只有 517 个节点）。
  抽成 `apps/web/lib/graph-layout.ts` + 7 条单测（含「1000 节点 <300ms」的性能断言）。
- **抓取链路烟测**：`pnpm test:capture` 本地起假站点 → 创建链接收藏 → workers 抓取 →
  断言「状态 success / 标题被改写 / 按标题能搜到 / 按正文能搜到」5 项全绿，
  不依赖外网、Meilisearch、Chrome。
- **搜索降级也能搜正文**：没配 Meilisearch 时（桌面版默认），SQL LIKE 兜底现在同时匹配
  `bookmarkLinks.htmlContent`（抓下来的正文）与 `bookmarkAssets.content`（图片/PDF 提取文字），
  不再只命中标题/URL/笔记。
- **AI 供应商预设**：设置 → AI 里一排「DeepSeek / 通义千问 / Kimi / 智谱 GLM / OpenAI / 硅基流动 / 本地 Ollama」，
  点一下把 Base URL 与模型名填好，只补 Key 就行；原来的「测试连接 / 保存即生效」保留。
- **空状态三步引导**：收藏页空的时候给出 1-粘贴链接 2-导入旧收藏 3-配好 AI，后两步直接可点。
- **搜索页示例与历史**：没有输入时给 6 个可点的查询示例（图片/视频/PDF/我收藏的/有高亮的/还没看完的链接），
  并记住本机最近 8 条搜索（`lib/recent-searches.ts` + 6 条单测），可一键清空。
- **桌面「关于」可复制诊断信息**：版本 / 平台 / Electron 与 Node 版本 / 数据目录 / 日志目录，方便报障。
- 新增**内容形态分类**：侧栏「图片 / 视频 / 文章 / PDF / 文件」四个入口，
  底座是查询语言新增的 `is:image` / `is:pdf` / `is:video`（图片 = ASSET 收藏的 image，
  PDF=asset 的 pdf，视频=链接抓下来的 `linkVideo` 资产，「文章」= `is:link -is:video`）。
  查询解释器（搜索框右侧的小提示）也认识这三类了。
- 新增 `scripts/e2e-web.mjs`：Playwright 浏览器回归（6 条：登录页 / 注册即登录 / 刷新保持 / 未登录拦截 / 邮箱密码登录 / 错误密码），
  自带临时数据库与生产构建，`pnpm test:e2e:web` 一条命令跑完自动清理。
- 新增 `scripts/e2e-auth.mjs`：接口级账号链路（10 条 + 重启后 cookie 复用）。
- 新增 `packages/trpc/lib/search.assetKind.test.ts`（6 条）：把「图片/PDF/视频/文章」四类筛选压到 SQL 层验证。
- **修：桌面版「新建收藏」会 500（no such table: tasks）** —— 队列库 `queue.db` 的表以前只由 workers
  在启动时创建，workers 没起或起晚了，web 入队就失败（书签已写库但接口报错，界面看起来像没保存）。
  现在 `migrate.cjs` 在 web 启动前把 liteque 的迁移也跑一遍（`liteque-drizzle` 随包附带），
  并且 e2e harness 也会建队列库。
- **系统状态**：设置 → 个人信息页新增「系统状态」卡片（版本 / 运行时长 / 运行环境 / 数据目录 /
  数据库与队列库与附件占用 / 收藏-标签-收藏夹数量 / AI 与 SMTP 是否配置），可一键复制诊断信息。
  数据来自新接口 `GET /api/system`（登录后可见）。
- 修：dev/e2e 给 standalone 补的 `.next/static` / `public` 目录联接会让 electron-builder 直接报错，
  `apps/desktop/clean-standalone.cjs` 在三个 `pack*` 脚本里先清理一遍。
- 新增 `scripts/tasks.mjs` + `docs/queue.json`：任务队列小工具（`next / start / done / block`），
  让每次收尾都能从「下一件该做的」直接接上，不用重新回忆进度。
- README 补 AGPL 合规提示（托管服务需提供对应源码）；补齐账号体系、桌面版与发布说明。

---

## [1.0.0] — 2026-11-13

首个可运行、可交付的版本（基于 Karakeep `fc22787` 改造）。

### 阶段成果

- **P1 技术审计**：5 份带行号证据的源码审计（3144 行）+ 9 份设计文档。
- **P2 品牌与前端**：独立品牌「灵感仓 INSIGHT VAULT」、design token 层、明暗主题、
  中文默认、认证四页与 22 个页面中的 18 个完成视觉重构。
- **P3 收藏与知识管理**：URL / 图片 / PDF / 视频 / 文件 / 文字笔记；微信公众号、B 站、知乎、
  小红书四个内容源适配器（均带降级路径）；URL 归一化去重；Raindrop 导入；JSON / Markdown 导出。
- **P5 AI 知识引擎**：统一 Provider（OpenAI 兼容 / Anthropic / Ollama）、自动标签与摘要、
  语义分块、RAG 拼装与引用校验、SSE 流式对话、`[n]` 引用可点击回跳。
- **P6 高级功能**：知识图谱（力导向 + 表格视图）、智能专题、创作工作台（六类模板）、阅读台。
- **P8 跨平台**：Web + 浏览器扩展 + PWA + **Windows 桌面版（Electron）**。
- **P9 交付**：部署 / 使用 / 交接 / 交付 / 验收文档、一键启动脚本、9 项主链路自检。

### 质量

- `pnpm typecheck` 22/22 包通过。
- 单测：shared 234、trpc 搜索 16、web 8。
- 数据库迁移 101 个，可重放。
- Windows 安装包（NSIS）端到端实测：安装 → 启动 → 注册 → 收藏 → 搜索。
- **发布渠道打通**：仓库公开在 https://github.com/crushht/insight-vault，CI 在 ubuntu-latest 上 3m38s 全绿；
  安装包作为 `v1.1.0` Release 附件提供（147 MB）。修掉一个会让 CI 秒挂的问题：
  `.github/workflows/actions.lock` 被 GitHub 当作 workflow 解析 → 移到 `.github/actions.lock`。
- **PDF 扫描件 OCR**：新增兜底路径 —— 无文本层的 PDF 用 pdfjs 渲染前 5 页 + 视觉模型读字（`PDF_OCR_MAX_PAGES` / `PDF_OCR_SCALE` 可调）；
  图片 OCR 在桌面版默认走视觉模型；`pnpm test:pdf` 3/3（文本层 / 扫描件 / 图片，真模型）。
- **自动更新**：electron-updater 6.8 + `build.publish=github`，启动 20s 首查、每 6h 复查、后台下载、托盘「检查更新…」；
  `IV_UPDATE_URL` 可指向自建静态源（国内更稳）。代码签名按决定跳过。
