@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo   Insight Vault - dev launcher
echo ============================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0dev.ps1" %*
echo.
pause
