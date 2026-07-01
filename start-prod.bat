@echo off
chcp 65001 >nul 2>&1
title ClassIntra Production Server

echo ========================================
echo   ClassIntra Production Server (Foreground)
echo ========================================
echo.

cd /d "%~dp0"

echo [1/5] Stopping PM2 process if running...
call pm2 stop classintra-server >nul 2>&1
call pm2 delete classintra-server >nul 2>&1

echo [2/5] Checking port conflicts...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":9001 " ^| findstr "LISTENING"') do (
    echo Port 9001 is in use by PID %%a, stopping...
    taskkill /PID %%a /F >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":10001 " ^| findstr "LISTENING"') do (
    echo Port 10001 is in use by PID %%a, stopping...
    taskkill /PID %%a /F >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":10011 " ^| findstr "LISTENING"') do (
    echo Port 10011 is in use by PID %%a, stopping...
    taskkill /PID %%a /F >nul 2>&1
)
timeout /t 2 /nobreak >nul

echo [3/5] Checking database...
if not exist server\database mkdir server\database
if not exist server\database\classintra.db (
    echo Initializing database...
    cd server
    node src/utils/init-db.js
    if errorlevel 1 (
        echo Database init failed!
        pause
        exit /b 1
    )
    cd ..
    echo Database initialized
) else (
    echo Database OK
)

echo [4/5] Checking build...
if not exist client\dist\index.html (
    echo Frontend build not found! Please run build.bat first.
    pause
    exit /b 1
)
echo Build OK

echo [5/5] Starting production server...
echo.
echo   HTTP:       http://localhost:9001
echo   WebSocket:  ws://localhost:10001
echo   Relay:      ws://localhost:10011
echo.
echo   Close this window to stop the server
echo ========================================
echo.

cd server
node --max-old-space-size=768 src/app.js