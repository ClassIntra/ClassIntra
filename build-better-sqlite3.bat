@echo off
call "D:\CodeTool\VisualStudio\VC\Auxiliary\Build\vcvars64.bat"
if errorlevel 1 (
    echo ERROR: Cannot setup VS environment
    exit /b 1
)
cd /d "D:\Move\Documents\AI_projects\Integration\ClassIntra\node_modules\.pnpm\better-sqlite3@12.11.1\node_modules\better-sqlite3"
echo Building better-sqlite3...
node-gyp rebuild --release
if errorlevel 1 (
    echo ERROR: Build failed
    exit /b 1
)
echo Build successful!
