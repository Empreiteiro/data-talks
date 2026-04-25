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

    :: Free the ports we use, but only when the listener is one of our own
    :: processes (python/uvicorn/data-talks for the backend ports, node for
    :: Vite). We resolve PIDs via netstat and verify the image name with
    :: tasklist before issuing taskkill, so a Firestore emulator or any
    :: other tool the user happens to be running on the same port is left
    :: alone.
    echo Freeing dev ports (only kills our own backend/frontend processes)...
    for %%P in (8000 8001 8002 8003 8004 8005 5173) do (
        for /f "tokens=5" %%I in ('netstat -ano ^| findstr ":%%P " ^| findstr LISTENING') do (
            for /f "tokens=1" %%N in ('tasklist /FI "PID eq %%I" /NH 2^>nul') do (
                if /i "%%N"=="python.exe"     ( taskkill /F /PID %%I >nul 2>&1 && echo   killed PID %%I on :%%P ^(python^) )
                if /i "%%N"=="uvicorn.exe"    ( taskkill /F /PID %%I >nul 2>&1 && echo   killed PID %%I on :%%P ^(uvicorn^) )
                if /i "%%N"=="data-talks.exe" ( taskkill /F /PID %%I >nul 2>&1 && echo   killed PID %%I on :%%P ^(data-talks^) )
                if /i "%%N"=="node.exe"       ( taskkill /F /PID %%I >nul 2>&1 && echo   killed PID %%I on :%%P ^(node/vite^) )
            )
        )
    )

    :: Clean up stale port file (CLI rewrites it on next start)
    if exist "backend\.backend_port" del "backend\.backend_port"

    :: Brief pause so Windows actually releases the listening sockets
    timeout /t 1 /nobreak >nul

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
