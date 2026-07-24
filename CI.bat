@echo off
chcp 65001 >nul 2>&1
title ClassIntra Manager
cd /d "%~dp0"

if "%1"=="" goto menu
if /i "%1"=="start" goto start
if /i "%1"=="stop" goto stop
if /i "%1"=="restart" goto restart
if /i "%1"=="status" goto status
if /i "%1"=="logs" goto logs
if /i "%1"=="build" goto build
if /i "%1"=="dev" goto dev
if /i "%1"=="kill" goto kill
if /i "%1"=="startup" goto startup
if /i "%1"=="reset" goto reset
if /i "%1"=="monit" goto monit
if /i "%1"=="flush" goto flush
if /i "%1"=="describe" goto describe
if /i "%1"=="direct" goto direct
goto menu

:menu
echo.
echo  ========================================
echo        ClassIntra Manager (PM2)
echo  ========================================
echo   1. Start   (PM2 background)
echo   2. Stop
echo   3. Restart
echo   4. Status
echo   5. Logs
echo   6. Build Frontend
echo   7. Dev Mode
echo   8. Force Kill and Restart
echo   9. Setup Auto-Start on Boot
echo   D. Direct Start (no PM2)
echo   M. Monitor (CPU/Memory)
echo   F. Flush Logs
echo   I. Process Info
echo   R. Full Reset (delete + recreate)
echo   0. Exit
echo  ========================================
echo.
set /p choice=Select: 

if "%choice%"=="1" goto start
if "%choice%"=="2" goto stop
if "%choice%"=="3" goto restart
if "%choice%"=="4" goto status
if "%choice%"=="5" goto logs
if "%choice%"=="6" goto build
if "%choice%"=="7" goto dev
if "%choice%"=="8" goto kill
if "%choice%"=="9" goto startup
if /i "%choice%"=="M" goto monit
if /i "%choice%"=="F" goto flush
if /i "%choice%"=="I" goto describe
if /i "%choice%"=="D" goto direct
if /i "%choice%"=="R" goto reset
if "%choice%"=="0" goto end
goto menu

:kill_ports
echo [ClassIntra] Checking ports...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":9001 " ^| findstr "LISTENING" 2^>nul') do (
    echo   Killing port 9001 PID %%a
    taskkill /PID %%a /F >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":10001 " ^| findstr "LISTENING" 2^>nul') do (
    echo   Killing port 10001 PID %%a
    taskkill /PID %%a /F >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":10011 " ^| findstr "LISTENING" 2^>nul') do (
    echo   Killing port 10011 PID %%a
    taskkill /PID %%a /F >nul 2>&1
)
goto :eof

:ensure_pm2
call pm2 ping >nul 2>&1
if errorlevel 1 (
    echo [ClassIntra] PM2 daemon not running, cleaning up...
    taskkill /f /im "PM2.exe" >nul 2>&1
    taskkill /f /im "node.exe" /fi "WINDOWTITLE eq PM2*" >nul 2>&1
    timeout /t 2 /nobreak >nul
    call pm2 ping >nul 2>&1
    if errorlevel 1 (
        echo [ClassIntra] ERROR: Cannot start PM2 daemon.
        echo [ClassIntra] Try running: npm install -g pm2@latest
        if "%1"=="" pause
        exit /b 1
    )
)
goto :eof

:start
echo [ClassIntra] Starting production...
call :kill_ports
timeout /t 2 /nobreak >nul
call :ensure_pm2
if errorlevel 1 goto end
echo [ClassIntra] Starting PM2...
call pm2 start ecosystem.config.js
call pm2 save
echo.
call pm2 status
echo.
echo [ClassIntra] Started! Running in background.
if "%1"=="start" goto end
pause
goto menu

:stop
echo [ClassIntra] Stopping production...
call :ensure_pm2
call pm2 stop classintra-server
call pm2 save
echo [ClassIntra] Stopped!
if "%1"=="stop" goto end
pause
goto menu

:restart
echo [ClassIntra] Restarting production...
call :ensure_pm2
call pm2 restart classintra-server
call pm2 save
echo [ClassIntra] Restarted!
if "%1"=="restart" goto end
pause
goto menu

:status
call :ensure_pm2
call pm2 status
if "%1"=="status" goto end
pause
goto menu

:logs
echo [ClassIntra] Logs (Ctrl+C to exit):
call :ensure_pm2
call pm2 logs classintra-server --lines 100
if "%1"=="logs" goto end
pause
goto menu

:build
echo [ClassIntra] Building frontend...
cd client
if not exist "node_modules\.bin\vite.cmd" (
    echo [ClassIntra] Dependencies not found, installing...
    call pnpm install --ignore-scripts
    if errorlevel 1 (
        echo [ClassIntra] Install FAILED!
        cd ..
        if "%1"=="build" goto end
        pause
        goto menu
    )
)
call pnpm run build
if errorlevel 1 (
    echo [ClassIntra] Build FAILED!
    cd ..
    if "%1"=="build" goto end
    pause
    goto menu
)
cd ..
echo [ClassIntra] Build complete! Run: cn restart
if "%1"=="build" goto end
pause
goto menu

:dev
echo [ClassIntra] Stopping production and entering dev mode...
call :ensure_pm2
call pm2 stop classintra-server >nul 2>&1
call pm2 save
call :kill_ports
timeout /t 1 /nobreak >nul
echo [ClassIntra] Starting dev mode...
cd server
start cmd /k "title ClassIntra Dev Server && npm run dev"
cd ..
cd client
start cmd /k "title ClassIntra Dev Client && npm run dev"
cd ..
echo [ClassIntra] Dev mode started in new windows!
if "%1"=="dev" goto end
pause
goto menu

:kill
echo [ClassIntra] Force killing and restarting...
call :ensure_pm2
call pm2 stop classintra-server >nul 2>&1
call pm2 delete classintra-server >nul 2>&1
call :kill_ports
timeout /t 3 /nobreak >nul
call :ensure_pm2
echo [ClassIntra] Restarting...
call pm2 start ecosystem.config.js
call pm2 save
echo [ClassIntra] Restarted!
if "%1"=="kill" goto end
pause
goto menu

:startup
echo [ClassIntra] Setting up PM2 auto-start on Windows boot...
call :ensure_pm2
echo [ClassIntra] Checking pm2-windows-startup...
call npm list -g pm2-windows-startup >nul 2>&1
if errorlevel 1 (
    echo [ClassIntra] Installing pm2-windows-startup...
    call npm install -g pm2-windows-startup
    if errorlevel 1 (
        echo [ClassIntra] ERROR: Failed to install pm2-windows-startup
        pause
        goto menu
    )
)
echo [ClassIntra] Configuring Windows startup task...
call pm2-startup install
echo [ClassIntra] Saving current PM2 process list...
call pm2 save
echo.
echo [ClassIntra] Auto-start configured!
echo [ClassIntra] PM2 will automatically restart classintra-server on boot.
echo.
echo   Make sure the following are set correctly:
echo   1. Run "cn restart" first to apply latest config
echo   2. Run "cn status" to verify the server is online
echo   3. Reboot to test auto-start
echo.
if "%1"=="startup" goto end
pause
goto menu

:monit
call :ensure_pm2
echo [ClassIntra] Opening PM2 monitor... (Ctrl+C to exit)
call pm2 monit
goto menu

:flush
echo [ClassIntra] Flushing PM2 logs...
call :ensure_pm2
call pm2 flush
echo [ClassIntra] Logs flushed!
if "%1"=="flush" goto end
pause
goto menu

:describe
call :ensure_pm2
call pm2 describe classintra-server
if "%1"=="describe" goto end
pause
goto menu

:direct
echo [ClassIntra] Starting production (direct mode - no PM2)...
call :kill_ports
timeout /t 2 /nobreak >nul
cd server
start "ClassIntra Server" /MIN cmd /c "node src\app.js"
cd ..
echo.
echo [ClassIntra] Server starting on ports 9001/10001/10011...
echo [ClassIntra] Check the minimized window for logs.
echo [ClassIntra] Use "cn status" or netstat -ano ^| findstr ":9001" to verify.
if "%1"=="direct" goto end
pause
goto menu

:reset
echo [ClassIntra] Full reset...
call :ensure_pm2
echo [ClassIntra] Stopping and deleting all PM2 processes...
call pm2 stop all >nul 2>&1
call pm2 delete all >nul 2>&1
call :kill_ports
timeout /t 3 /nobreak >nul
echo [ClassIntra] Flushing logs...
call pm2 flush >nul 2>&1
call :ensure_pm2
echo [ClassIntra] Starting fresh...
call pm2 start ecosystem.config.js
call pm2 save
call pm2 status
echo [ClassIntra] Full reset complete!
if "%1"=="reset" goto end
pause
goto menu

:end
