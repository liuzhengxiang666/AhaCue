@echo off
setlocal
cd /d "%~dp0"

where pnpm >nul 2>nul
if %errorlevel%==0 (
  call pnpm install --frozen-lockfile --prefer-offline
  if errorlevel 1 exit /b 1
  call pnpm start:personal
  exit /b %errorlevel%
)

where corepack >nul 2>nul
if %errorlevel%==0 (
  call corepack pnpm install --frozen-lockfile --prefer-offline
  if errorlevel 1 exit /b 1
  call corepack pnpm start:personal
  exit /b %errorlevel%
)

echo 需要 Node.js 20.20 或更高版本。安装 Node.js 后重新运行 run.cmd。
exit /b 1
