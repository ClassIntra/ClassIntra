@echo off
chcp 65001 >nul 2>&1
rem ==========================================================================
rem  ClassIntra autostart  (hardened 2026-09-30, poll window widened 2026-10-01)
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
rem    [3] then poll up to ~130s (60 x ~2.2s) for the HTTP port
rem    [4] if still down -> `pm2 start ecosystem.config.js`, poll ~65s more
rem
rem  Why 60 and not 20:
rem    Real cold boot on 2026-10-01 02:03 took 96s from power-on to 9001
rem    being reachable. `pm2 resurrect` alone burned ~13s before the poll
rem    loop even started, and on a busy boot (Windows Update, disk
rem    contention) that step is the one that stretches. The old 20-poll
rem    window left too little headroom -> risk of a false failure, a
rem    pointless fallback and a misleading WARN in the log.
rem    Each iteration costs ~2.2s (netstat ~0.08s + ping -n 3 ~2.07s).
rem
rem  Log: logs\autostart.log   (gitignored)
rem ==========================================================================
setlocal enabledelayedexpansion

set "CI_DIR=D:\NetWork\Integration\ClassIntra"
set "PM2_BIN=%APPDATA%\npm\pm2.cmd"
set "LOGDIR=%CI_DIR%\logs"
set "LOG=%LOGDIR%\autostart.log"

set "POLL_MAIN=60"
set "POLL_FALLBACK=30"

if not exist "%LOGDIR%" mkdir "%LOGDIR%" >nul 2>&1

rem ---- [1] already serving? -----------------------------------------------
netstat -ano | findstr /i "LISTENING" | findstr ":9001 " >nul 2>&1
if not errorlevel 1 (
    >>"%LOG%" echo [!date! !time!] skip: port 9001 already listening
    exit /b 0
)

rem ---- [2] cold start: spawn the one and only PM2 daemon ------------------
cd /d "%CI_DIR%"
>>"%LOG%" echo [!date! !time!] start: pm2 resurrect
call "%PM2_BIN%" resurrect >>"%LOG%" 2>&1
>>"%LOG%" echo [!date! !time!] resurrect returned, polling for 9001

rem ---- [3] poll up to ~130s (60 x ~2.2s) for the HTTP port ----------------
set "UP="
set /a TRIES=0
for /l %%w in (1,1,%POLL_MAIN%) do (
    if not defined UP (
        set /a TRIES+=1
        netstat -ano | findstr /i "LISTENING" | findstr ":9001 " >nul 2>&1
        if not errorlevel 1 ( set "UP=1" ) else ( ping -n 3 127.0.0.1 >nul )
    )
)

rem ---- [4] fallback: start straight from the checked-in ecosystem ---------
rem  NB: never put parentheses inside an echoed string in this section.
rem      Inside a parenthesised block cmd treats the ")" of e.g. "(poll #3)"
rem      as the end of the block -> the else branch also runs -> the fallback
rem      restarts a healthy service AND both OK and fallback lines get logged.
rem      Verified the hard way on 2026-10-01 (probe run).
rem  NB2: log timestamps use !date! !time! (delayed), never %date% %time%.
rem       %-expansion is done ONCE when the whole if/else block is parsed,
rem       so every line inside the block would carry the same stale time.
rem       Also verified by probe on 2026-10-01.
if defined UP (
    >>"%LOG%" echo [!date! !time!] OK: port 9001 is listening after !TRIES! polls
) else (
    >>"%LOG%" echo [!date! !time!] 9001 still down after !TRIES! polls / ~130s - fallback: pm2 start ecosystem.config.js
    call "%PM2_BIN%" start ecosystem.config.js >>"%LOG%" 2>&1
    set "TRIES=0"
    for /l %%w in (1,1,%POLL_FALLBACK%) do (
        if not defined UP (
            set /a TRIES+=1
            netstat -ano | findstr /i "LISTENING" | findstr ":9001 " >nul 2>&1
            if not errorlevel 1 ( set "UP=1" ) else ( ping -n 3 127.0.0.1 >nul )
        )
    )
    if defined UP (
        >>"%LOG%" echo [!date! !time!] OK after fallback: port 9001 is listening after !TRIES! polls
    ) else (
        >>"%LOG%" echo [!date! !time!] WARN: 9001 still down after ~195s - manual check needed
    )
)
exit /b 0
