# 灵感仓桌面版（Electron）

一个自包含的桌面壳：启动时自己跑数据库迁移 → 起 Next standalone 服务与 workers →
等健康检查通过 → 打开窗口。用户装完不需要另外装 Node、数据库或 Docker。

## 结构

| 文件 | 作用 |
|---|---|
| `main.js` | 主进程：单实例锁、启动画面、托盘、全局快捷键、服务自恢复、窗口记忆、SMTP 设置窗口 |
| `preload.js` | 预加载脚本（当前只暴露版本信息，保持最小面） |
| `migrate.cjs` | 不依赖 drizzle-orm 的迁移执行器（standalone 包里没有那个子路径） |
| `build/icon.png` | 应用图标（出包与托盘共用；`.gitignore` 里已单独放行） |
| `package.json` | `build` 段是 electron-builder 配置（NSIS / dmg / AppImage） |

## 路径约定

| 用途 | 开发（`electron .`） | 打包版 |
|---|---|---|
| Web 服务 | `../web/.next/standalone` | `resources/server` |
| workers | `../workers`（回退 `dist/index.js`） | `resources/workers` |
| 迁移 SQL | `../../packages/db/drizzle` | `resources/server/packages/db/drizzle` |
| 数据 | `%APPDATA%\InsightVault\data`（开发与打包一致，靠 `app.setName("InsightVault")`） | 同左 |
| 日志 | 同上 `logs/` | 同上 `logs/` |
| 启动日志 | `%USERPROFILE%\.insight-vault\boot.log` | 同左 |

## 开发

```bash
# 先让 standalone 有内容
pnpm --filter @karakeep/web run build
pnpm --filter @karakeep/workers run build

cd apps/desktop
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue   # 见下
npx electron .
```

> **坑**：某些环境（例如 DSH 会话）会带 `ELECTRON_RUN_AS_NODE=1`，这会让 `electron.exe`
> 退化成 node，`require("electron")` 去读 npm 包并报 `Electron failed to install correctly`。
> 启动前清掉这个变量即可。

dev 模式下主进程会给 `standalone/apps/web` 建 `.next/static` 与 `public` 的目录联接，
否则页面没有样式（`next build` 的 standalone 不带这两块）。

## 出包

```bash
cd apps/desktop
npx electron-builder --win --x64     # → release/InsightVault-1.0.0-win-x64.exe
```

先把上面两个 build 跑过。`release/` 已在 `.gitignore` 里。

## 行为说明

- **关窗口不退出**：缩到托盘，后台继续抓取；托盘「退出」才真正结束。
- **服务自恢复**：web / workers 意外退出会被拉起，最多 3 次，之后弹窗提示可手动「重启本地服务」。
- **登录态**：主窗口用 `persist:insightvault` 分区，30 天有效期的 session cookie 落盘。
- **SMTP**：托盘 →「邮箱服务设置（SMTP）」→ 写 `userData/smtp.json`（0600）→ 重启服务生效。
  不配就走「本地模式」：验证码直接显示在注册/登录页面上（仅本机访问有效）。
- **安全**：拒绝所有浏览器权限请求、禁用 webview、外链一律交给系统浏览器。
