# 兼容入口：真正的启动脚本已移到仓库根目录的 dev.ps1
$root = Split-Path -Parent $PSScriptRoot
& (Join-Path $root "dev.ps1") @args
exit $LASTEXITCODE
