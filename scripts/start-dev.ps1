# 灵感仓 · 一键启动（Windows / PowerShell）
#
# 用法（在仓库根目录）：
#   pwsh -File scripts/start-dev.ps1
# 或双击 start-dev.cmd（若存在）。
#
# 做四件事：检查环境 → 装依赖 → 迁移数据库 → 启动 web 与 workers。
# 已存在的东西不会重复做。

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Info($m) { Write-Host "[灵感仓] $m" -ForegroundColor Cyan }
function Warn($m) { Write-Host "[提醒]   $m" -ForegroundColor Yellow }
function Fail($m) { Write-Host "[失败]   $m" -ForegroundColor Red; exit 1 }

# ---------- 1. 环境 ----------
Info "检查环境…"

$nodeVersion = (node --version 2>$null)
if (-not $nodeVersion) { Fail "没有找到 node。请安装 Node.js 24+（https://nodejs.org）。" }
Info "node $nodeVersion"

# pnpm 可能只以 corepack 形式存在；优先用 PATH，其次用仓库内的 shim
$pnpmCmd = $null
if (Get-Command pnpm -ErrorAction SilentlyContinue) {
  $pnpmCmd = "pnpm"
} elseif (Test-Path (Join-Path $root "..\.bin\pnpm.cmd")) {
  $pnpmCmd = (Join-Path $root "..\.bin\pnpm.cmd")
  Warn "PATH 里没有 pnpm，改用 $pnpmCmd"
} else {
  Warn "没有找到 pnpm，尝试启用 corepack…"
  corepack enable 2>$null
  if (Get-Command pnpm -ErrorAction SilentlyContinue) { $pnpmCmd = "pnpm" }
  else { Fail "无法启用 pnpm。请运行 `corepack enable` 后重试。" }
}
Info "pnpm 就绪（$pnpmCmd）"

# ---------- 2. .env ----------
if (-not (Test-Path ".env")) {
  Warn ".env 不存在，从 .env.sample 复制一份（需要你补 DATA_DIR 与 NEXTAUTH_SECRET）"
  Copy-Item ".env.sample" ".env"
  $secret = node -e "console.log(require('crypto').randomBytes(36).toString('base64'))"
  $dataDir = (Join-Path $root ".data") -replace '\\', '/'
  @"
# 由 start-dev.ps1 生成
DATA_DIR=$dataDir
NEXTAUTH_SECRET=$secret
NEXTAUTH_URL=http://localhost:3000
"@ | Set-Content ".env" -Encoding utf8
  New-Item -ItemType Directory -Force -Path ".data" | Out-Null
  # db 包也要能读到同样的环境
  Copy-Item ".env" "packages/db/.env" -Force
  Info "已生成 .env 与 .data 目录"
} else {
  Info ".env 已存在"
}

# ---------- 3. 依赖 ----------
if (-not (Test-Path "node_modules")) {
  Info "安装依赖（首次可能需要几分钟）…"
  & $pnpmCmd install
  if ($LASTEXITCODE -ne 0) { Fail "依赖安装失败。若卡在 re2 编译，见 docs/DEPLOYMENT.md §11。" }
} else {
  Info "依赖已安装"
}

# ---------- 4. 迁移 ----------
Info "应用数据库迁移…"
& $pnpmCmd --filter "@karakeep/db" run migrate
if ($LASTEXITCODE -ne 0) { Fail "迁移失败，请检查 DATA_DIR 是否可写。" }

# ---------- 5. 启动 ----------
Info "启动 web 与 workers（各开一个窗口）…"
$webArgs = @("-NoExit", "-Command", "Set-Location '$root'; & '$pnpmCmd' --filter '@karakeep/web' run dev")
$workerArgs = @("-NoExit", "-Command", "Set-Location '$root'; & '$pnpmCmd' --filter '@karakeep/workers' run start")

Start-Process powershell -ArgumentList $webArgs
Start-Sleep -Seconds 2
Start-Process powershell -ArgumentList $workerArgs

Write-Host ""
Info "已启动。等待约 10 秒后访问 http://localhost:3000"
Info "首个注册的账号会自动成为管理员。"
Warn "搜索需要 Meilisearch、抓取 SPA 需要 Headless Chrome —— 都不装也能用，只是能力受限（见 docs/DEPLOYMENT.md）。"
