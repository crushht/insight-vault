# 交付包 DELIVERY

> 本文件是「交给别人」时看的清单：东西在哪、怎么跑起来、怎么确认没坏、哪些事没做完。
> 判定标准见 [FINAL_ACCEPTANCE](FINAL_ACCEPTANCE.md)；上手步骤见 [HANDOFF](HANDOFF.md)。

---

## 1. 交付物清单

### 1.1 代码

| 位置 | 内容 |
|---|---|
| `insight-vault/` | 完整可运行仓库（基于 Karakeep `fc22787`，191 个文件有改动） |
| `upstream-karakeep/` | 上游只读副本，用于比对差异 |
| `artifacts/` | 证据与工具（截图基线、视觉walkthrough、验证脚本、MCP 调用器） |

### 1.2 文档（16 份，`docs/`）

| 分类 | 文件 |
|---|---|
| 产品 | `PRODUCT_REQUIREMENTS.md`、`FEATURE_MATRIX.md` |
| 技术 | `TECHNICAL_AUDIT.md`、`ARCHITECTURE.md`、`DATABASE_DESIGN.md` |
| 设计 | `UI_DESIGN_SYSTEM.md` |
| 计划 | `DEVELOPMENT_ROADMAP.md`、`TEST_PLAN.md` |
| 决策 | `DECISIONS.md`（22 条 ADR） |
| 交付 | `DEPLOYMENT.md`、`USER_GUIDE.md`、`HANDOFF.md`、`FINAL_ACCEPTANCE.md`、本文件 |
| 过程 | `PHASE_1_REPORT.md`、`PHASE_2_REPORT.md`（2175 行逐轮记录） |
| 审计 | `audit/01-database.md` … `audit/05-ai-search.md`（3144 行，带行号证据） |

### 1.3 可运行产物

| 产物 | 位置 |
|---|---|
| Web（Next.js 16） | `apps/web` |
| Workers（12 队列） | `apps/workers` |
| 浏览器扩展（已品牌化） | `apps/browser-extension` |
| ~~Android 原生工程~~ | 已删除（不做原生版本） |
| 数据库（102 迁移） | `packages/db` |
| 启动脚本（仓库根） | `dev.ps1` + `启动灵感仓.cmd` |

---

## 2. 三条命令跑起来

```powershell
# 1. 一键启动（自动建 .env、装依赖、迁移、起 web + workers）
powershell -File dev.ps1        # 或双击「启动灵感仓.cmd」

# 2. 打开
#    http://localhost:3000/welcome      官网
#    http://localhost:3000/dashboard    应用（首个注册账号自动 admin）

# 3. 确认没坏
pnpm typecheck                                    # 22 / 22
cd packages/shared; pnpm exec vitest run          # 234 passed
cd packages/trpc;   pnpm exec vitest run          # 20 passed
cd apps/web;        pnpm exec vitest run          # 8 passed
```

测试账号（本地已建）：`audit@insightvault.local` / `AuditPass123!`

---

## 3. 验证步骤（按可信度排序）

| 步骤 | 命令/操作 | 期望 |
|---|---|---|
| 类型 | `pnpm typecheck` | 22/22 |
| 单测 | `packages/shared` vitest | 234 passed |
| 迁移 | `pnpm --filter @karakeep/db run migrate` | 无待应用 |
| **一键体检** | `python ..\artifacts\health-check.py` | **3/3**（文档 / 死链 / 主链路 9 项） |
| 健康 | `curl localhost:3000/api/health` | 200 |
| 页面 | **12 个路由** | 全 200 |
| 流式对话 | chat 页新建对话 → 发送 → 观察逐块出现 | 无 Key 时回「没有相关内容」 |
| 专题 | `/dashboard/topics` 输入主题 → 生成 | 素材草稿 + 引用编号 |
| 创作台 | `/dashboard/create` 选类型 → 生成 | 章节骨架 |
| 会员 | `/dashboard/membership` | 三档定价 + 额度 |
| 导入 | 设置 → 导入 → Raindrop `.csv` | 解析出收藏 |
| 图谱 | `/dashboard/graph` | SVG + 实体表格 |

---

## 4. 已知限制（交付即接受）

| 项 | 状态 | 原因 |
|---|---|---|
| 模型配置 | ✅ **界面填 Key / Base URL / 模型名，保存即生效**（AES 加密落盘，web+workers 共享，无需重启） |
| 真实 AI 生成 | 未接真模型 | **链路已用 mock provider 验证通过**（§126）：sendMessage 200 + citations=3 + 专题 mode=ai。换真模型只需改 `OPENAI_BASE_URL`/`OPENAI_API_KEY`/`INFERENCE_TEXT_MODEL` |
| 真实支付 | 未接入 | 产品决策（用户明确「支付先不管」） |
| Android / iOS | **不做** | 产品范围裁剪：交付 Web + 浏览器扩展 + PWA；原生构建产物与工具链已全部删除（释放 ~17 GB） |
| iOS 工程 | 未生成 | Expo 拒绝在 Windows 上 prebuild |
| 全量 e2e | 未跑 | 缺 Meilisearch + Headless Chrome |
| **网页抓取** | **不可用** | 本环境 worker 的 DNS 全部 `ECONNREFUSED`（连 localhost 都解析失败），日志见 PHASE_2_REPORT §97 |
| Docker compose | 未实测 | 本机无 Docker |
| 标签层级 | 决定不做 | 上游无 `parentId`；命名已能表达层级 |
| ~~标签变更不重建分块~~ | **已修复**（§110） | `updateTags` 已接 enqueue；验证：打标签后 t+4s chunk 含该标签 |
| ~~编辑笔记后不重建分块~~ | **已修复**（§104） | 补丁曾插错 procedure；修正后验证：编辑 5 秒内 chunk 从旧内容换成新内容 |
| ~~文字笔记不进 RAG~~ | **已修复**（§99） | 两层原因：入队被 `enableAutoIndexing` 挡住 + worker 在向量库检查处提前 return。修复后 5 秒内产出 1 个 chunk |
| ~~笔记编辑态预览~~ | **不需要** | 核实后：`EditableText` 只编辑标题，正文阅读态已支持 Markdown |

---

## 5. 与上游的差异（一句话版）

保留 Karakeep 的抓取 / 存储 / 队列 / 全端架构，替换品牌与设计系统，
新增：中国内容源 ×4、URL 归一化去重、语义分块、RAG 与引用回跳、AI 对话（流式）、
智能专题、创作工作台、知识图谱（含表格视图）、会员与订单状态机、Raindrop 导入，
并修掉 6 个稳定性问题（SQLite 并发、后置作业幂等、限流默认关、共享内容搜不到等）。

---

## 6. 交接检查表

- [ ] `pnpm typecheck` 22/22
- [ ] `packages/shared` 234 passed
- [ ] `migrate` 无待应用
- [ ] `/api/health` 200
- [ ] 12 个页面全 200
- [ ] 流式对话可发可收
- [ ] 已读 `HANDOFF.md` 的 15 条陷阱
- [ ] 已知限制（§4）已被接受

签字：__________　日期：__________
