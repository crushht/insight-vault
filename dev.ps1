# 灵感仓 · 启动 / 停止 / 状态（Windows / PowerShell）
#
# 用法（在仓库根目录）：
#   powershell -File dev.ps1            启动前后端
#   powershell -File dev.ps1 -Stop      停止
#   powershell -File dev.ps1 -Status    看状态
#   powershell -File dev.ps1 -Restart   重启
#
# 关键点（踩过坑，别改）：
#   1) 必须先起 workers、等它打印出 Listening on 的端口，再起 web
#      —— web 通过那个端口把队列任务送进 workers，顺序反了任务会静默丢失；
#   2) 输出不要用 emoji，Windows PowerShell 5.1 的 GBK 控制台会报编码错；
#   3) 本文件必须存成 UTF-8 with BOM，否则中文会被当 ANSI 解析。

param(
  [switch]$Stop,
  [switch]$Status,
  [switch]$Restart
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot  # 本脚本就放在仓库根目录
Set-Location $root

# 数据目录必须放在项目目录之外：Next dev 的 watcher 会监视项目目录，
# SQLite 的 -wal/-shm 高频写入会不断触发重新编译，表现为页面反复刷新。
$dataDir = "E:\fork\2\iv-data"
$pidFile = Join-Path $dataDir "dev-pids.json"
# 日志必须放在项目目录之外！
# 原因：Next dev 的文件监听会监视项目目录，日志一写就触发重新编译，
# 编译完页面重载又产生日志 —— 形成死循环，表现为「界面一直闪」。
$logDir = Join-Path $env:TEMP "insight-vault-logs"
New-Item -ItemType Directory -Force -Path $dataDir, $logDir | Out-Null

function Info($m) { Write-Host "[灵感仓] $m" -ForegroundColor Cyan }
function Warn($m) { Write-Host "[提醒]   $m" -ForegroundColor Yellow }
function Fail($m) { Write-Host "[失败]   $m" -ForegroundColor Red }

# pnpm：优先 PATH，其次仓库内 shim
function Get-Pnpm {
  if (Get-Command pnpm -ErrorAction SilentlyContinue) { return "pnpm" }
  $shim = Join-Path (Split-Path -Parent $root) ".bin\pnpm.cmd"
  if (Test-Path $shim) { return $shim }
  return $null
}

function Test-Web {
  try {
    $r = Invoke-WebRequest "http://localhost:3000/api/health" -UseBasicParsing -TimeoutSec 5
    return $r.StatusCode -eq 200
  } catch { return $false }
}

function Get-ListeningPid([int]$port) {
  $c = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
       Select-Object -First 1
  if ($c) { return $c.OwningProcess }
  return $null
}

function Stop-One($name, $procId) {
  if (-not $procId) { return }
  # 用 taskkill /T 杀整棵进程树：
  # 我们的启动链是 cmd → pnpm(corepack) → node，
  # 只杀 cmd 或只杀直接子进程都会留下 node，表现为「明明重启了还是旧代码/旧环境」。
  try {
    & taskkill.exe /PID $procId /T /F 2>$null | Out-Null
    Info "已停止 $name (pid $procId，含子进程)"
  } catch {
    try { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue } catch {}
    Warn "taskkill 不可用，已退化为 Stop-Process：$name"
  }
  # 兜底：按命令行再扫一遍（防止 pid 变了）
  $pattern = if ($name -like "*worker*") { "workers" } else { "--filter @karakeep/web" }
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -match $pattern } |
    ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {} }
}

function Do-Stop {
  Info "停止服务..."
  if (Test-Path $pidFile) {
    $pids = Get-Content $pidFile -Raw | ConvertFrom-Json
    Stop-One "web" $pids.web
    Stop-One "workers" $pids.workers
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
  } else {
    Warn "没有 pid 记录文件，按端口兜底清理"
  }
  # 兜底：不管有没有记录，把监听 3000 的进程结束掉
  $webPid = Get-ListeningPid 3000
  if ($webPid) { Stop-One "web(按端口)" $webPid }
  Start-Sleep -Seconds 2
  if (Test-Web) { Warn "3000 端口仍有响应，可能还有残留进程" } else { Info "已全部停止" }
}

function Do-Status {
  Info "状态："
  $webUp = Test-Web
  Write-Host ("  web      : " + $(if ($webUp) { "运行中 (http://localhost:3000)" } else { "未运行" }))
  Write-Host ("  3000 端口: " + $(if (Get-ListeningPid 3000) { "被占用" } else { "空闲" }))
  if (Test-Path $pidFile) {
    $pids = Get-Content $pidFile -Raw | ConvertFrom-Json
    Write-Host ("  记录 pid : web=$($pids.web) workers=$($pids.workers)")
  }
  $workerLog = Join-Path $logDir "workers.log"
  if (Test-Path $workerLog) {
    $port = (Select-String -Path $workerLog -Pattern "Listening on http://127\.0\.0\.1:(\d+)" |
             Select-Object -Last 1)
    if ($port) { Write-Host ("  workers  : 端口 $($port.Matches[0].Groups[1].Value)") }
  }
  $migrations = (Get-ChildItem (Join-Path $root "packages\db\drizzle") -Filter *.sql -ErrorAction SilentlyContinue |
                 Measure-Object).Count
  Write-Host ("  迁移文件 : $migrations")
}

function Wait-Workers([int]$timeoutSec = 90) {
  $log = Join-Path $logDir "workers.log"
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  while ((Get-Date) -lt $deadline) {
    if (Test-Path $log) {
      $m = Select-String -Path $log -Pattern "Listening on http://127\.0\.0\.1:(\d+)" |
           Select-Object -Last 1
      if ($m) { return $m.Matches[0].Groups[1].Value }
    }
    Start-Sleep -Seconds 2
  }
  return $null
}

function Wait-Web([int]$timeoutSec = 120) {
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  $i = 0
  while ((Get-Date) -lt $deadline) {
    $i++
    if (Test-Web) { return $true }
    if ($i % 5 -eq 0) { Write-Host "  等待 web 就绪… $($i * 2)s" }
    Start-Sleep -Seconds 2
  }
  return $false
}

function Do-Start {
  $pnpm = Get-Pnpm
  if (-not $pnpm) { Fail "找不到 pnpm。请先运行 corepack enable。"; return 1 }

  if (Test-Web) {
    Warn "web 已在运行（http://localhost:3000）。要重启请加 -Restart。"
    Do-Status
    return 0
  }

  # .env
  if (-not (Test-Path ".env")) {
    Warn ".env 不存在，从 .env.sample 生成并写入随机密钥"
    Copy-Item ".env.sample" ".env"
    $secret = node -e "console.log(require('crypto').randomBytes(36).toString('base64'))"
    $dataDirPosix = $dataDir -replace '\\', '/'
    @"
DATA_DIR=$dataDirPosix
NEXTAUTH_SECRET=$secret
NEXTAUTH_URL=http://localhost:3000
"@ | Set-Content ".env" -Encoding utf8
    New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
    Copy-Item ".env" "packages/db/.env" -Force
  }

  if (-not (Test-Path "node_modules")) {
    Info "安装依赖（首次会比较久）..."
    & $pnpm install
    if ($LASTEXITCODE -ne 0) { Fail "依赖安装失败"; return 1 }
  }

  Info "应用数据库迁移..."
  & $pnpm --filter "@karakeep/db" run migrate | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail "迁移失败，检查 DATA_DIR 是否可写"; return 1 }

  # --- 先 workers ---
  Info "启动 workers（先起它，web 需要它的端口）..."
  $workerLog = Join-Path $logDir "workers.log"
  $workerErr = Join-Path $logDir "workers.err.log"
  Remove-Item $workerLog, $workerErr -Force -ErrorAction SilentlyContinue
  # 用 cmd /c 包一层：否则 Start-Process 重定向后，PowerShell 会一直等子进程，
  # 脚本看起来"卡住"（实际服务已起来）。
  $workerCmd = "/c `"`"$pnpm`" --filter @karakeep/workers run start > `"$workerLog`" 2>&1`""
  $workers = Start-Process -FilePath "cmd.exe" -ArgumentList $workerCmd `
    -WorkingDirectory $root -WindowStyle Hidden -PassThru

  $workerPort = Wait-Workers 90
  if (-not $workerPort) {
    Fail "workers 在 90 秒内没有就绪，看日志：$workerLog"
    Stop-One "workers" $workers.Id
    return 1
  }
  Info "workers 就绪（端口 $workerPort）"

  # --- 再 web ---
  Info "启动 web..."
  $webLog = Join-Path $logDir "web.log"
  $webErr = Join-Path $logDir "web.err.log"
  Remove-Item $webLog, $webErr -Force -ErrorAction SilentlyContinue
  $webCmd = "/c `"`"$pnpm`" --filter @karakeep/web run dev > `"$webLog`" 2>&1`""
  $web = Start-Process -FilePath "cmd.exe" -ArgumentList $webCmd `
    -WorkingDirectory $root -WindowStyle Hidden -PassThru

  @{ web = $web.Id; workers = $workers.Id; workerPort = $workerPort } |
    ConvertTo-Json | Set-Content $pidFile -Encoding utf8

  if (-not (Wait-Web 150)) {
    Fail "web 在 150 秒内没有就绪，看日志：$webLog"
    return 1
  }

  Write-Host ""
  Info "全部就绪"
  Write-Host "  应用    http://localhost:3000"
  Write-Host "  官网    http://localhost:3000/welcome"
  Write-Host "  测试号  audit@insightvault.local / AuditPass123!"
  Write-Host "  日志    $logDir"
  Write-Host "  停止    powershell -File dev.ps1 -Stop"
  return 0
}

if ($Stop) { Do-Stop; exit 0 }
if ($Status) { Do-Status; exit 0 }
if ($Restart) { Do-Stop; Start-Sleep -Seconds 2; exit (Do-Start) }
exit (Do-Start)
