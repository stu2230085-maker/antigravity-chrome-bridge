@echo off
title Antigravity Chrome Bridge Server v2.0

echo.
echo  Starting Antigravity Chrome Bridge Server v2.0...
echo.

cd /d "%~dp0\.."

if not exist "node_modules\" (
    echo  [*] node_modules not found. Running pnpm install...
    echo.
    call pnpm install
    if errorlevel 1 (
        echo  [!] pnpm install failed.
        pause
        exit /b 1
    )
)

call pnpm build
if errorlevel 1 (
    echo  [!] Build failed.
    pause
    exit /b 1
)

call pnpm start

echo.
echo  [!] Server has stopped.
pause
