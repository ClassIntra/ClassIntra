@echo off
echo ========================================
echo   Building ClassIntra for production...
echo ========================================
echo.

echo [1/3] Installing dependencies...
cd /d "%~dp0server"
call pnpm install --prod 2>nul || call npm install --prod
cd /d "%~dp0client"
call pnpm install 2>nul || call npm install
echo.

echo [2/3] Updating version info...
for /f "tokens=*" %%i in ('powershell -command "Get-Date -Format yyyy-MM-ddTHH:mm:ssZ"') do set BUILD_TIME=%%i
for /f "tokens=*" %%i in ('powershell -command "[guid]::NewGuid().ToString('N').Substring(0,16)"') do set BUILD_HASH=%%i
if exist "%~dp0server\version.json" (
  powershell -command "(Get-Content '%~dp0server\version.json' -Raw | ConvertFrom-Json) | Add-Member -NotePropertyName 'buildHash' -NotePropertyValue '%BUILD_HASH%' -Force | Add-Member -NotePropertyName 'buildTime' -NotePropertyValue '%BUILD_TIME%' -Force | ConvertTo-Json | Set-Content '%~dp0server\version.json'"
)
echo.

echo [3/3] Building frontend...
cd /d "%~dp0client"
call npx vite build
echo.

echo ========================================
echo   Build complete!
echo   Frontend artifacts: client\dist\
echo   (app.js serves from client\dist\, no copy needed)
echo.
echo   To start the server:
echo     cd server
echo     node src/app.js
echo   Then visit http://localhost:9001
echo ========================================
