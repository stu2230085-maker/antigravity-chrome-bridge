@echo off
title Antigravity Chrome Bridge Server

echo.
echo  Starting Antigravity Chrome Bridge Server...
echo.

:: Navigate to the script's own directory
cd /d "%~dp0"

:: Install dependencies if node_modules doesn't exist
if not exist "node_modules\" (
    echo  [*] node_modules not found. Running npm install...
    echo.
    npm install
    echo.
    if errorlevel 1 (
        echo  [!] npm install failed. Please check your Node.js installation.
        pause
        exit /b 1
    )
)

:: Start the bridge server
echo  [*] Launching bridge server...
echo.
node bridge-server.js

:: Keep the window open if the server exits unexpectedly
echo.
echo  [!] Server has stopped.
pause
