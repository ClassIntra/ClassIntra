@echo off
chcp 65001 >nul
echo Starting ClassIntra...
echo.
echo [1/3] Initializing database...
cd /d "%~dp0server"
if not exist database mkdir database
node src/utils/init-db.js
echo.
echo [2/3] Starting backend server...
start "ClassIntra Server" cmd /k "node src/app.js"
echo.
echo [3/3] Starting frontend dev server...
cd /d "%~dp0client"
start "ClassIntra Client" cmd /k "npx vite --host"
echo.
echo ClassIntra is running!
echo Access: http://localhost:9001
echo Admin: See ADMIN_USER_IDS in server/.env
echo.
pause >nul
taskkill /FI "WINDOWTITLE eq ClassIntra Server*" /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq ClassIntra Client*" /T /F >nul 2>&1
