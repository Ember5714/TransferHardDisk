@echo off
set "ROOT=%~dp0"
set "SRV=%ROOT%server"
set "CLI=%ROOT%client"

if not exist "%SRV%" (
    echo ERROR: server folder not found
    pause
    exit /b 1
)

:: Auto-detect Node.js
if exist "%APPDATA%\TRAE SOLO CN\ModularData\ai-agent\vm\tools\node\node.exe" set "PATH=%APPDATA%\TRAE SOLO CN\ModularData\ai-agent\vm\tools\node;%PATH%"
where node >nul 2>nul
if errorlevel 1 (
    echo ERROR: Node.js not found
    echo Install: https://nodejs.org
    pause
    exit /b 1
)

cd /d "%ROOT%"

if not exist "%SRV%\node_modules" (
    echo [Setup] Installing server dependencies...
    cd /d "%SRV%"
    call npm install
    cd /d "%ROOT%"
)

if not exist "%CLI%\node_modules" (
    echo [Setup] Installing client dependencies...
    cd /d "%CLI%"
    call npm install
    cd /d "%ROOT%"
)

if not exist "%CLI%\dist\index.html" (
    echo [Setup] Building frontend...
    cd /d "%CLI%"
    call npm run build
    cd /d "%ROOT%"
)

cd /d "%SRV%"
echo ========================================
echo.
echo   Transfer Hard Disk
echo   Server  : http://localhost:3000
echo   Storage : %ROOT%file
echo.
echo   LAN IPs:
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4"') do echo     http:%%a:3000
echo ========================================
echo.

node "%SRV%\src\index.js"
pause
