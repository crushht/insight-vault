# 发布到 GitHub 的步骤与注意事项

> 目标：README 一打开就能看懂、CI 一跑就是绿的、Release 附件能直接用。
> 这份文档按「第一次发布」写，之后每次发版照着 §4 走一遍即可。

---

## 1. 发布前检查（10 分钟）

```bash
# 1) 不许把本地环境/数据带上去
git status --short           # 应该只看到源码、文档、配置的改动
git check-ignore -v .env iv-data .data 2>/dev/null

# 2) 三个门都要绿
pnpm typecheck
pnpm --filter @karakeep/shared exec vitest run
pnpm --filter @karakeep/web run build

# 3) 隐私扫描（把 <你的前缀> 换成真实值再跑）
git grep -nIE "(smtp|api[_-]?key|secret|password).{0,40}(=|\").{6,}" -- ':!*.md' ':!*.test.ts' | head -50
```

**绝对不能提交的**：`.env`、`iv-data/`、`.data/`、`*.db`、`secret.txt`、`smtp.json`、
`artifacts/` 里的抓包与截图原件（体积大）、`node_modules`。
`.gitignore` 已覆盖这些，新增目录前先确认。

**安装包里也不能有 `.env`**（`next build` 会把 `apps/web/.env` 复制进 standalone）。
`apps/desktop/package.json` 的 `extraResources.filter` 已经排掉 `**/.env*`，
主进程也会把继承来的 `SMTP_*` 清掉再注入自己的配置。出包后仍要人工确认一次：

```powershell
Get-ChildItem apps\desktop\release\win-unpacked\resources -Recurse -Force -Filter '.env*'
# 期望：没有任何输出
```

---

## 2. 首次发布

```bash
git init                                  # 若还没有仓库
git add -A
git commit -m "feat: 灵感仓 INSIGHT VAULT 1.0"

git branch -M main
git remote add origin git@github.com:<owner>/<repo>.git
git push -u origin main
```

推送后到仓库 **Settings**：

| 项 | 建议 |
|---|---|
| Description | 本地优先的 AI 个人知识仓：收藏 → 抓取 → 检索 → 带引用的 AI 对话 |
| Topics | `knowledge-management` `bookmarks` `rag` `nextjs` `electron` `self-hosted` `sqlite` |
| Features | 打开 Issues；Wiki 可关；Discussions 可选 |
| Actions | 打开（`ci.yml` 会在 push / PR 时跑） |

再补两张社交预览图：**Settings → Social preview** 上传 `docs/screenshots/bookmarks.png` 裁切的 1280×640。

---

## 3. 发一个版本

版本号规则：`vMAJOR.MINOR.PATCH`，与 `CHANGELOG.md` 对应。

```bash
# 1) 改版本与日志
#    - CHANGELOG.md 顶部的 [未发布] 改成 [1.1.0] — 日期
#    - apps/desktop/package.json 的 version 同步

git commit -am "chore(release): v1.1.0"
git tag v1.1.0
git push origin main --tags
```

打 tag 会触发 `.github/workflows/release.yml`：

1. 构建 Docker 镜像并推到 `ghcr.io/<owner>/<repo>:v1.1.0`；
2. 创建 GitHub Release，附件含 `docker-compose.yml`、`.env.sample`、使用与部署文档。

**Release 说明模板**（写清「这一版能干什么、怎么跑起来、已知限制」）：

```markdown
## 这一版

- 注册：邮箱 + 密码 + 邮箱验证码；注册完即登录
- 登录：邮箱 + 密码；「保持登录」默认 30 天
- 桌面版：托盘、全局快捷键、SMTP 设置、服务自恢复

## 跑起来

Docker：`docker compose up -d` → http://localhost:3000
源码：`pnpm install && pnpm --filter @karakeep/db run migrate && pnpm dev`

## 已知限制

- 未接真实支付通道（订单/权益代码保留）
- 移动端未构建（源码保留）
- 语义检索需要额外配置 `EMBEDDING_*`
```

---

## 4. Windows 桌面版安装包

桌面版不在 CI 里出包（构建产物 300MB+，且需要联网拉 Electron），本地出：

```bash
pnpm install
pnpm --filter @karakeep/web run build          # 出 .next/standalone
pnpm --filter @karakeep/workers run build      # 出 dist/index.js
cd apps/desktop
npx electron-builder --win --x64                # 产物在 apps/desktop/release/
```

产物：`InsightVault-1.1.0-win-x64.exe`（NSIS，可选安装目录）。
上传到 GitHub Release 附件即可。

出包前确认：

- `apps/desktop/package.json` 里 `extraResources` 指到的四个目录都存在
  （`web/.next/standalone`、`web/.next/static`、`web/public`、`workers/dist`）；
- `build/icon.png` 是 512×512 以上的方形图；
- 卸载/升级测试一次：装 → 启动 → 注册 → 收藏一条 → 退出 → 再启动仍是登录态。

**代码签名**：目前 `win.signAndEditExecutable=false`，首次运行会有 SmartScreen 提示。
要消掉提示需要 OV/EV 证书，在 `apps/desktop/package.json` 的 `win` 段补
`certificateFile` / `certificatePassword`（用 CI Secret 注入，别写进仓库）。

---

## 5. 发布后 15 分钟自检

1. Actions 里 `CI` 是否绿？（红的话先修，别急着宣传）
2. Release 页面附件是否齐全、镜像能否 `docker pull`？
3. 用**全新数据目录**跑一遍：注册 → 邮箱验证码 → 收藏一条 URL → 搜索 → AI 对话（无 Key 时应明确提示未配置）。
4. 桌面版：安装 → 托盘 → `Ctrl+Shift+K` → 关闭窗口再打开（应仍在托盘）→ 重启应用（应仍是登录态）。
