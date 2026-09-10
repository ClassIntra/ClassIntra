@echo off
rem ClassIntra autostart: skip if 9001 already listening
cd /d "D:\NetWork\Integration\ClassIntra"
netstat -ano | findstr ":9001.*LISTENING" >nul 2>&1
if %errorlevel%==0 exit /b 0
call "%APPDATA%\npm\pm2.cmd" start ecosystem.config.js
