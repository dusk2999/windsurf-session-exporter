@echo off
cd /d "%~dp0"
title Windsurf Session Exporter Dashboard
color 0E
echo =================================================================
echo     Windsurf Session Exporter Dashboard Launcher
echo =================================================================
echo.
echo [1/2] Checking environment...
where node >nul 2>nul
if %errorlevel% neq 0 (
    color 0C
    echo [ERROR] Node.js is not installed or not in your system PATH.
    echo Please install Node.js from https://nodejs.org to run the Dashboard UI.
    echo.
    pause
    exit /b
)
echo [OK] Node.js is available.
echo.
echo [2/2] Starting dashboard server...
echo.
echo -----------------------------------------------------------------
echo * Dashboard URL: http://localhost:3000
echo * Auto-opening default browser window...
echo * Press Ctrl+C in this terminal window to stop the server.
echo -----------------------------------------------------------------
echo.
node server.js
if %errorlevel% neq 0 (
    color 0C
    echo.
    echo [ERROR] Server exited with code %errorlevel%
    pause
) else (
    echo.
    echo [INFO] Server stopped.
    pause
)
