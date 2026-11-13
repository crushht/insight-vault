# 部署文档 DEPLOYMENT — 灵感仓 INSIGHT VAULT

> 面向：自托管单机部署（Docker Compose）、裸机 Node 部署、以及内网/反代场景。
> 依据：Phase 1 审计（`docs/audit/`）与本地实跑验证（Windows 11 / Node 24 / pnpm 11.28.9）。

---

## 1. 部署形态

| 形态 | 适用 | 组成 |
|---|---|---|
| **单机 Docker Compose**（推荐） | 个人 / 小团队 | `web` + `workers` + `meilisearch` + `chrome` |
| **裸机 Node** | 已有 Node 环境、想直接跑 | 同上，进程由 systemd/pm2 托管 |
| **反代前置** | 公网访问 | Caddy/Nginx 终止 TLS，转发到 `web:3000` |

**不需要** Postgres、Redis、Kafka。业务库是 SQLite，队列也在 SQLite（liteque）。

---

## 2. 前置条件

| 项 | 要求 |
|---|---|
| Docker | 24+（含 compose v2） |
| 内存 | ≥2 GB（Meilisearch + Chrome 各占 300–500 MB） |
| 磁盘 | ≥10 GB（资产按收藏量增长；10 万条 ≈ 60 GB） |
| 端口 | 3000（web）、7700（Meilisearch，可仅内网）、9222（Chrome CDP，仅内网） |

---

## 3. 一键启动（Windows 开发环境）

```powershell
pwsh -File scripts/start-dev.ps1
```

脚本会依次：检查 node/pnpm → 生成 `.env` 与 `.data`（若缺失）→ 装依赖（若无 `node_modules`）
→ 应用迁移 → 各开一个窗口启动 web 与 workers。

> 脚本必须保存为 **UTF-8 with BOM**。Windows PowerShell 5.1 会把无 BOM 的 UTF-8 脚本按 ANSI 解读，
> 中文字符串会破坏语法解析（这是本项目实际踩过的坑）。

## 4. 快速开始（Docker Compose）

```bash
git clone <repo> insight-vault && cd insight-vault
cp .env.sample .env
# 至少改这两项：
#   DATA_DIR=/data
#   NEXTAUTH_SECRET=$(openssl rand -base64 36)
docker compose -f docker/docker-compose.yml up -d
docker compose logs -f web workers
```

首次启动后：

```bash
# 应用数据库迁移（新版本升级时同样执行）
docker compose exec web pnpm --filter @karakeep/db run migrate
```

访问 `http://<host>:3000`，**第一个注册的账号自动成为管理员**。

---

## 5. 环境变量

### 4.1 必填

| 变量 | 说明 |
|---|---|
| `DATA_DIR` | SQLite 与资产的根目录。Docker 内固定 `/data`，宿主目录通过 volume 映射 |
| `NEXTAUTH_SECRET` | 会话签名密钥，缺失则无法登录。用 `openssl rand -base64 36` 生成 |

### 4.2 搜索与抓取

| 变量 | 默认 | 说明 |
|---|---|---|
| `MEILI_ADDR` | 空 | Meilisearch 地址；**不设则搜索禁用** |
| `MEILI_MASTER_KEY` | 空 | 生产必设，且与 meilisearch 服务一致 |
| `MEILI_VECTOR_ADDR` | 同主实例 | 向量索引可独立实例 |
| `BROWSER_WEB_URL` | 空 | Chrome CDP 地址（`http://chrome:9222`）；不设则降级为纯 HTTP 抓取 |
| `BROWSER_COOKIE_PATH` | 空 | 注入抓取用 Cookie（微信公众号等登录态内容） |
| `MAX_ASSET_SIZE_MB` | 50 | 单资产上限 |
| `CRAWLER_FULL_PAGE_ARCHIVE` | false | 是否保存整页归档（占空间） |

### 4.3 数据库与并发

| 变量 | 默认 | 说明 |
|---|---|---|
| `DB_WAL_MODE` | **true** | WAL 模式。多人/多进程写入必须开启（本项目已改为默认 true） |
| `DATA_DIR` 下的 `db.db` / `db.db-wal` / `db.db-shm` | — | 备份时必须三者一起（或用 `VACUUM INTO`） |

### 4.4 AI

| 变量 | 说明 |
|---|---|
| `OPENAI_API_KEY` | 存在时启用 OpenAI 兼容通道；**同时会让 Ollama 通道失效**（上游硬优先级） |
| `OPENAI_BASE_URL` | 可指向自建/中转/Ollama 的 `/v1` |
| `INFERENCE_TEXT_MODEL` / `INFERENCE_IMAGE_MODEL` | 文本 / 视觉模型 |
| `EMBEDDING_TEXT_MODEL` / `EMBEDDING_DIMENSIONS` | 嵌入模型与维度；**换模型需重建索引** |
| `OLLAMA_BASE_URL` / `OLLAMA_MODEL` | 无 `OPENAI_API_KEY` 时生效 |

### 4.5 配额与限流

| 变量 | 默认 | 说明 |
|---|---|---|
| `RATE_LIMITING_ENABLED` | **true** | 本项目已改为默认开启；关闭会让语义搜索裸奔烧钱 |
| `MAX_BOOKMARKS_PER_USER` | 视套餐 | 免费/付费额度；订阅生效后会覆盖 |
| `STORAGE_QUOTA_*` | 视套餐 | 同上 |

> 完整清单见 `docs/TECHNICAL_AUDIT.md` §7 与上游 `docs/docs/03-configuration/`。

---

## 6. 数据库迁移

```bash
# 生成（改 schema 后）
pnpm db:generate --name <短描述>

# 应用（部署 / 升级）
pnpm db:migrate
```

**本项目当前的迁移状态**：101 个（上游 97 + 我们新增 4）

| 编号 | 内容 |
|---|---|
| `0097_add_bookmark_chunks.sql` | 语义分块表（RAG 前置） |
| `0098_add_knowledge_graph.sql` | 知识图谱三表 |
| `0099_add_orders.sql` | 订单 + webhook 幂等表 |
| `0100_add_user_entitlements.sql` | 用户权益表 |

迁移是**只追加**的：不要修改已发布的迁移文件。

---

## 7. 备份与恢复

### 6.1 一致性备份（推荐）

```bash
# SQLite 在线一致性快照（WAL 模式下也安全）
sqlite3 /data/db.db "VACUUM INTO '/backup/db-$(date +%F).db'"
# 资产目录
rsync -a /data/assets/ /backup/assets-$(date +%F)/
```

### 6.2 直接拷文件（需停服）

```bash
docker compose stop web workers
cp -a /data/db.db /data/db.db-wal /data/db-shm /backup/
```

**只拷 `db.db` 会丢最近的写入** —— WAL 模式下的数据可能还在 `-wal` 里。

### 6.3 恢复

1. 停服；
2. 用备份覆盖 `db.db`（及 `-wal`/`-shm`，若存在）；
3. 恢复 `assets/`；
4. 启动 → `pnpm db:migrate` → 在管理后台触发一次「重建搜索索引」。

---

## 8. 升级

```bash
git pull
docker compose build && docker compose up -d
docker compose exec web pnpm --filter @karakeep/db run migrate
docker compose exec web pnpm --filter @karakeep/workers run start   # 若 workers 是独立服务可省略
```

升级前先做一次 §6.1 的备份。**降级不支持**，需要回滚就用备份恢复。

---

## 9. 健康检查与排障

| 现象 | 排查 |
|---|---|
| 首页 500 | 迁移是否执行；`DATA_DIR` 是否可写 |
| 搜索无结果 | `MEILI_ADDR` 是否配置；`docker compose logs meilisearch` |
| 收藏一直「加载中」 | workers 是否在跑；`BROWSER_WEB_URL` 是否可达 |
| 图片 403（微信/小红书） | 需要 `BROWSER_COOKIE_PATH` 与 Referer（本项目已自动补 origin） |
| 写库偶发失败 | `DB_WAL_MODE=true`、磁盘是否满 |
| AI 一直转圈 | 是否配置 `OPENAI_API_KEY` / `OLLAMA_*`；模型名是否存在 |

端点：

```bash
curl -s localhost:3000/api/health   # 200
curl -s localhost:3000/api/version
```

---

## 10. 安全清单（上线前逐条确认）

- [ ] `NEXTAUTH_SECRET` 为随机长串，且不与其他服务复用
- [ ] `MEILI_MASTER_KEY` 已设，Meilisearch 端口不对公网暴露
- [ ] `RATE_LIMITING_ENABLED=true`
- [ ] 反代已启用 TLS，`NEXTAUTH_URL` 为 https 地址
- [ ] `DISABLE_SIGNUPS=true`（如果没有邀请机制）
- [ ] AI Key 只放在服务端环境变量，**不进客户端 bundle**（本项目只暴露「是否已配置」）
- [ ] 备份任务已配置，且验证过恢复流程

---

## 11. 裸机部署（不使用 Docker）

```bash
corepack enable
pnpm install
cp .env.sample .env && vi .env
pnpm --filter @karakeep/db run migrate

# 两个常驻进程
pnpm --filter @karakeep/web run build && pnpm --filter @karakeep/web run start
pnpm --filter @karakeep/workers run start
```

注意：

- 必须在 `PATH` 里有 `pnpm` 可执行文件（turbo 需要它）；
- 无 MSVC 的 Windows 环境下，`re2` 原生模块需要在 `pnpm-workspace.yaml` 里关闭构建（见 ADR-011）；
- Meilisearch 与 Chrome 需自行启动并配置地址。

---

## 12. 已知限制

| 限制 | 影响 | 现状 |
|---|---|---|
| 单机 SQLite | 无法多机横向扩容 | 目标用户是个人/小团队，可接受 |
| 无内置支付通道 | 下单只到 `created` 状态 | P7 待接 Stripe/支付宝；webhook 幂等表已就绪 |
| 全量 e2e 需要 Meili + Chrome | CI 里未跑 | 本地已验证核心链路 |
| 移动端/扩展未构建验证 | 未纳入本次交付 | P8 |
