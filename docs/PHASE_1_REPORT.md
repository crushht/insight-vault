# 第一阶段报告 · 完整技术审计

- 阶段：**P1 / Phase 1**
- 状态：**已完成**
- 日期：2026-11-08
- 基线：Karakeep `fc22787`

---

## 1. 已完成任务

| # | 任务 | 结果 |
|---|---|---|
| 1 | 克隆并固定基线 | `E:\fork\2\upstream-karakeep`（只读）、`E:\fork\2\insight-vault`（工作副本，git 基线提交 `872d383`） |
| 2 | 五个专项源码审计 | 数据库 / API 与认证 / 后台任务 / Web 前端 / AI 与搜索，共 **3,144 行**带行号证据的审计文档（实测 1019 / 555 / 405 / 518 / 647） |
| 3 | REA 静态调用图 | `apps/web`：377 文件 / 339 JS / 159,087 AST 节点 / 应用图 5,567 节点·7,565 边 / 0 解析失败；`apps/browser-extension`：54 文件 / 398 节点·715 边 |
| 4 | Craft Anything 视觉研究 | 3 个参考站（Karakeep / Raindrop / mymind）+ 4 个本地页面（signin / bookmarks / settings / tags），各 1440 与 390 双宽，含 design tokens 与布局测量 |
| 5 | 真实运行验证 | pnpm 安装 → 97 个迁移 → Web 启动（2.3s）→ 12 个 worker 在线 → 注册/登录 → 受保护页面 200 |
| 6 | 缺陷复现 | `GET /dashboard` **实测 404**（上游路由缺首页） |
| 7 | 九份设计文档 | 见 §2 |
| 8 | 环境适配决策 | 关闭 `re2` 原生构建（ADR-011），安装从失败转为 41.4s 成功 |

---

## 2. 新增/修改文件

### 2.1 新增文档（`docs/`）

| 文件 | 行数（约） | 内容 |
|---|---|---|
| `PRODUCT_REQUIREMENTS.md` | 300 | 定位、用户、信息架构、**60+ 条带 ID 与验收标准的需求**、商业化分层、用户旅程、DoD |
| `TECHNICAL_AUDIT.md` | 240 | 审计方法、规模基线、模块结论、14 条缺陷、运行验证、环境变量 |
| `ARCHITECTURE.md` | 300 | As-Is/To-Be 架构、5 张 mermaid 图、请求与异步链路、插件扩展点、技术债 |
| `DATABASE_DESIGN.md` | 330 | 34 表字典、ER 图、字段陷阱、索引与查询计划、**目标扩展 DDL**、迁移纪律 |
| `UI_DESIGN_SYSTEM.md` | 330 | 品牌定位、完整色彩/字体/间距/阴影/动效 token、组件规范、布局、**可落地 CSS**、迁移顺序 |
| `FEATURE_MATRIX.md` | 150 | 现状 vs 目标的逐项矩阵、R/M/N 分类、一期砍项 |
| `DEVELOPMENT_ROADMAP.md` | 260 | P1–P9 阶段任务、验收、风险、里程碑 |
| `TEST_PLAN.md` | 250 | 分层策略、40+ 用例矩阵、**数据隔离测试**、中国源样本、视觉回归、CI 门槛 |
| `DECISIONS.md` | 200 | 16 条 ADR |

### 2.2 新增审计证据（`docs/audit/`）

| 文件 | 行数 |
|---|---|
| `01-database.md` | 1,019 |
| `02-api-auth.md` | 555 |
| `03-workers-jobs.md` | 405 |
| `04-web-frontend.md` | 518 |
| `05-ai-search.md` | 647 |

### 2.3 新增证据资产（`E:\fork\2\artifacts\`）

```
visual/
├─ karakeep-home/     screenshot-1440.png / -390.png / capture.json / README.md
├─ raindrop-home/     同上 + noise-*.png
├─ mymind-home/       同上 + part1-3.jpg
├─ karakeep-signin/   登录页（真实实例）
├─ karakeep-app-bookmarks/  登录态（walkthrough + DOM）
├─ karakeep-app-settings/
└─ karakeep-app-tags/
rea-web.json          REA 应用图（apps/web）
rea-extension.json    REA 应用图（浏览器扩展）
craft-anything-evidence.json   Craft Anything 证据包（7 条）
```

### 2.4 代码改动（**仅环境适配，无业务改动**）

| 文件 | 改动 | 原因 |
|---|---|---|
| `pnpm-workspace.yaml` | `allowBuilds.re2: true → false` + 注释 | 无 MSVC 工具链，见 ADR-011 |
| （未入库）`.env`（4 处副本）、`.data/db.db` | 本地开发环境与迁移产物 | 运行验证 |

> 业务源码 **0 行改动**，符合「审计阶段不允许大规模改写」的约束。

---

## 3. 新增功能

本阶段**不新增产品功能**（按任务书约束）。新增的是**工程能力**：

1. 可复现的本地开发环境（一条 `pnpm install` + `pnpm db:migrate` + `pnpm web`）；
2. 可复用的审计方法（源码并行审计 + REA 静态图 + Craft Anything 视觉采集）；
3. 后续所有阶段的验收基线（测试计划、设计 token、数据扩展 DDL）。

---

## 4. 测试结果

| 项 | 命令/方式 | 结果 |
|---|---|---|
| 依赖安装 | `corepack pnpm install` | ✅ 3129 包 / 41.4s（关闭 re2 后） |
| 数据库迁移 | `pnpm --filter @karakeep/db run migrate` | ✅ 97 个迁移，`.data/db.db` 626,688 B |
| Web 启动 | `pnpm --filter @karakeep/web run dev` | ✅ Next 16.4.1 Turbopack，Ready 2.3s |
| Workers 启动 | `pnpm --filter @karakeep/workers run start` | ✅ 12 个 worker，监听 127.0.0.1:60460 |
| 健康检查 | `GET /api/health` | ✅ 200 |
| 版本接口 | `GET /api/version` | ✅ 200 |
| 首页 | `GET /` | ✅ 200（重定向 `/signin`） |
| 注册 | `POST /api/auth/sign-up/email` | ✅ 创建成功，首用户 `role=admin` |
| 登录 | `POST /api/auth/sign-in/email` | ✅ 200 + session cookie |
| 受保护页 | `/dashboard/bookmarks`、`/settings/ai`、`/dashboard/tags` | ✅ 200 / 200 / 200 |
| **缺陷复现** | `GET /dashboard` | ❌ **404**（已记录为 P1 缺陷，修复方案见 ADR-016） |
| 视觉采集 | Craft Anything | ✅ 7 个页面/站点双宽截图 |

**未覆盖**（诚实声明）：Meilisearch 未启动（搜索不可用）、无 Headless Chrome（browserless 模式）、未配 AI Key（标签/摘要未跑）、移动端与扩展未构建、Docker 未验证。

---

## 5. 当前问题

### 5.1 阻塞后续开发（必须最先解决）

| # | 问题 | 影响 | 计划 |
|---|---|---|---|
| 1 | SQLite 无 WAL/`busy_timeout` | 双进程写库偶发失败 | P3-1 |
| 2 | 52 个 E2E 依赖英文可访问名 + 零视觉回归 | 品牌重构无护栏 | **P2-1/P2-2 最优先** |
| 3 | 338 处硬编码色 / 63 文件硬编码英文 | 品牌化无法收敛 | P2-9/P2-11 |

### 5.2 已确认的产品缺陷

| # | 缺陷 | 证据 |
|---|---|---|
| 4 | `/dashboard` 返回 404 | 本地实测 |
| 5 | 共享列表内容搜不到 | `lib/search.ts` 只按 userId 过滤 |
| 6 | editor 可移除他人加入的条目 | `routers/lists.ts:146-157` |
| 7 | 邀请码永不过期 | `invites.ts:146-149` |
| 8 | 后置作业先于归档 → 重复推断/webhook | `crawlerWorker.ts:472` vs `:475-485` |

### 5.3 环境限制

| # | 限制 | 影响 |
|---|---|---|
| 9 | 无 MSVC / 无 Docker / 无外网直连 GitHub raw | re2 关闭；Meili 与 Chrome 未起；adblock 规则降级 |
| 10 | 无 AI Key | AI 链路只能读代码，未跑真实推理 |

---

## 6. 下一阶段计划（P2 品牌与前端重构）

**第一周（护栏）**
1. `data-testid` 覆盖 8 条关键路由（P2-1）
2. Craft Anything 视觉基线入库（P2-2）
3. `tokens.css` + 语义映射 + 标尺（P2-3）
4. 中文字体分包（P2-4）
5. 修 `apps/web` 的 watch 模式 test 脚本（P2-13）

**第二周（组件与页面）**
6. Button / Input / Card / Dialog 四件套（P2-5）
7. 侧栏 + 顶栏 + 空状态（P2-6）
8. 设置 → 收藏库 → 详情 → 首页 → 搜索 五组页面（P2-7）
9. `/dashboard` 404 修复（P2-8）

**第三周（品牌与官网）**
10. 品牌字符串集中化（P2-10）
11. i18n 收敛 en+zh + 补硬编码（P2-11）
12. 官网落地页（P2-12）
13. 视觉回归入 CI（P2-14）

**P2 出口标准**：8 页 × 3 断点视觉通过、明暗无隐形文字、52 个 E2E 仍绿、视觉 diff <0.5%、LCP <2.0s。

---

## 7. 如何复现本阶段

```powershell
# 1. 环境
cd E:\fork\2\insight-vault
corepack pnpm install          # ADR-011 已关闭 re2 构建

# 2. 数据库
$env:DATA_DIR="E:/fork/2/insight-vault/.data"
corepack pnpm --filter @karakeep/db run migrate

# 3. 启动
corepack pnpm --filter @karakeep/web run dev        # http://localhost:3000
corepack pnpm --filter @karakeep/workers run start  # 12 个 worker

# 4. 验证
Invoke-WebRequest http://localhost:3000/api/health
```

视觉证据重建：

```powershell
node E:\fork\2\artifacts\mcp-capture.mjs      # 3 个参考站
node E:\fork\2\artifacts\mcp-dashboard.mjs    # 登录态 3 个页面
```
