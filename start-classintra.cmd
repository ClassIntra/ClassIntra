@echo off
chcp 65001 >nul 2>&1
rem ==========================================================================
rem  ClassIntra autostart  (hardened 2026-09-30)
rem
rem  This script is the SINGLE OWNER of the PM2 daemon on this machine.
rem
rem  Why it was rewritten:
rem    The legacy HKCU Run entry "PM2" (pm2-windows-startup) ran a second
rem    `pm2 resurrect` at logon, in parallel with this script. Both started
rem    within the same 2 seconds, both saw "no daemon", so BOTH spawned a
rem    Daemon.js. The two daemons collided on the same ~/.pm2 IPC socket,
rem    the handshake never completed, and NO application ever launched --
rem    9001 / 9002 / 10721 / 10011 were all dead after every boot.
rem    That Run entry has been removed (backup: HKCU-Run-backup.reg).
rem
rem  Behaviour:
rem    [1] 9001 already listening  -> exit  (safe to run twice)
rem    [2] otherwise `pm2 resurrect` (spawns the one daemon; restores the
rem        apps recorded in dump.pm2 plus the pm2-logrotate module)
rem    [3] then poll up to ~40s for the HTTP port before declaring failure
rem    [4] if still down -> `pm2 start ecosystem.config.js`, poll again
rem
rem  Log: logs\autostart.log   (gitignored)
rem ==========================================================================
setlocal

set "CI_DIR=D:\NetWork\Integration\ClassIntra"
set "PM2_BIN=%APPDATA%\npm\pm2.cmd"
set "LOGDIR=%CI_DIR%\logs"
set "LOG=%LOGDIR%\autostart.log"

if not exist "%LOGDIR%" mkdir "%LOGDIR%" >nul 2>&1

rem ---- [1] already serving? -----------------------------------------------
netstat -ano | findstr /i "LISTENING" | findstr ":9001 " >nul 2>&1
if not errorlevel 1 (
    >>"%LOG%" echo [%date% %time%] skip: port 9001 already listening
    exit /b 0
)

rem ---- [2] cold start: spawn the one and only PM2 daemon ------------------
cd /d "%CI_DIR%"
>>"%LOG%" echo [%date% %time%] start: pm2 resurrect
call "%PM2_BIN%" resurrect >>"%LOG%" 2>&1

rem ---- [3] poll up to ~40s (20 x 2s) for the HTTP port --------------------
set "UP="
for /l %%w in (1,1,20) do (
    if not defined UP (
        netstat -ano | findstr /i "LISTENING" | findstr ":9001 " >nul 2>&1
        if not errorlevel 1 ( set "UP=1" ) else ( ping -n 3 127.0.0.1 >nul )
    )
)

rem ---- [4] fallback: start straight from the checked-in ecosystem ---------
if not defined UP (
    >>"%LOG%" echo [%date% %time%] 9001 down after 40s - fallback: pm2 start ecosystem.config.js
    call "%PM2_BIN%" start ecosystem.config.js >>"%LOG%" 2>&1
    for /l %%w in (1,1,20) do (
        if not defined UP (
            netstat -ano | findstr /i "LISTENING" | findstr ":9001 " >nul 2>&1
            if not errorlevel 1 ( set "UP=1" ) else ( ping -n 3 127.0.0.1 >nul )
        )
    )
)

if defined UP (
    >>"%LOG%" echo [%date% %time%] OK: port 9001 is listening
) else (
    >>"%LOG%" echo [%date% %time%] WARN: 9001 still down after ~80s - manual check needed
)
exit /b 0
