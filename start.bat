@echo off
setlocal enabledelayedexpansion

:: Data Talks - Windows Startup Script
:: Usage:
::   start.bat dev   - Backend + frontend dev server (hot reload)
::   start.bat run   - Build frontend + start production server

set "MODE=%~1"

if "%MODE%"=="" (
    echo Data Talks - Windows Startup Script
    echo.
    echo Usage:
    echo   start.bat dev   Start backend + frontend dev server ^(hot reload^)
    echo   start.bat run   Build frontend and start production server
    echo.
    echo First-time setup:
    echo   npm install
    echo   uv pip install -e ./backend
    exit /b 0
)

:: ---------------------------------------------------------------
:: Setup .env if missing
:: ---------------------------------------------------------------
if not exist "backend\.env" (
    if exist "backend\.env.example" (
        copy "backend\.env.example" "backend\.env" >nul
        echo Created backend\.env from .env.example -- edit it to add your API keys.
    )
)

:: ---------------------------------------------------------------
:: DEV mode: backend + frontend with hot reload
:: ---------------------------------------------------------------
if /i "%MODE%"=="dev" (
    echo Starting Data Talks in development mode...

    :: Clean up stale port file
    if exist "backend\.backend_port" del "backend\.backend_port"

    :: Start backend in background
    start "DataTalks-Backend" /min cmd /c "uv run data-talks run"

    :: Wait for backend to write its port file (up to 10s)
    echo Waiting for backend to start...
    set "BACKEND_PORT=8000"
    for /l %%i in (1,1,10) do (
        if exist "backend\.backend_port" (
            set /p BACKEND_PORT=<"backend\.backend_port"
            goto :backend_ready
        )
        timeout /t 1 /nobreak >nul
    )

    :backend_ready
    echo Backend running on port !BACKEND_PORT!

    :: Start frontend dev server pointing to backend
    set "VITE_API_URL=http://localhost:!BACKEND_PORT!"
    npm run dev

    exit /b 0
)

:: ---------------------------------------------------------------
:: RUN/PROD mode: build frontend then start backend
:: ---------------------------------------------------------------
if /i "%MODE%"=="run" (
    echo Building frontend...
    call npm run build
    if errorlevel 1 (
        echo Frontend build failed.
        exit /b 1
    )

    echo Starting Data Talks in production mode...
    uv run data-talks run

    exit /b 0
)

echo Unknown mode: %MODE%
echo Use "dev" or "run".
exit /b 1
