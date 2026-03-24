@echo off
title SummitPoint Print Agent
cd /d "%~dp0"
echo ==========================================
echo   SummitPoint Print Agent - Starting...
echo ==========================================
echo.

:: Check if Node.js is installed
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ERROR: Node.js is not installed!
    echo Please install Node.js from https://nodejs.org
    pause
    exit /b 1
)

:: Install dependencies if needed
if not exist "node_modules" (
    echo Installing dependencies...
    npm install
    echo.
)

:: Build if dist doesn't exist
if not exist "dist" (
    echo Building...
    npm run build
    echo.
)

:: Start the agent
echo Starting Print Agent on http://localhost:3001
echo Admin Dashboard: http://localhost:3001/admin
echo.
echo Press Ctrl+C to stop
echo.
node dist/index.js
pause
