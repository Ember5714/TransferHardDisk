@echo off
setlocal enabledelayedexpansion
set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
set "SRV=%ROOT%\server"
set "CLI=%ROOT%\client"
set "RUNTIME=%ROOT%\runtime"
set "NODE_DIR=%RUNTIME%\node"
set "GITHUB_REPO=https://github.com/Ember5714/TransferHardDisk"
set "REPO_ZIP_URL=%GITHUB_REPO%/archive/refs/heads/main.zip"

title Transfer Hard Disk - Setup

echo ========================================
echo   Transfer Hard Disk - Setup
echo ========================================
echo.

rem Step 0: Detect Windows version and pick compatible Node.js
set "NODE_VERSION=20.18.1"
for /f "tokens=2 delims=[]" %%a in ('ver') do set "WIN_VER_RAW=%%a"
for /f "tokens=2 delims=. " %%a in ("!WIN_VER_RAW!") do set "WIN_MAJOR=%%a"
for /f "tokens=3 delims=. " %%a in ("!WIN_VER_RAW!") do set "WIN_MINOR=%%a"
if "!WIN_MAJOR!"=="6" if "!WIN_MINOR!"=="3" set "NODE_VERSION=18.20.5"
if "!WIN_MAJOR!"=="6" if "!WIN_MINOR!"=="1" set "NODE_VERSION=16.20.2"
if "!WIN_MAJOR!"=="6" if "!WIN_MINOR!"=="0" set "NODE_VERSION=16.20.2"
rem Detect 32-bit vs 64-bit architecture
set "NODE_ARCH=x64"
set "IS_64BIT=1"
if /i not "%PROCESSOR_ARCHITECTURE%"=="AMD64" (
    if "%PROCESSOR_ARCHITEW6432%"=="" set "IS_64BIT=0"
)
if "!IS_64BIT!"=="0" set "NODE_ARCH=x86"
set "NODE_ZIP=node-v!NODE_VERSION!-win-!NODE_ARCH!.zip"
set "NODE_URL=https://nodejs.org/dist/v!NODE_VERSION!/!NODE_ZIP!"
echo [Detect] Windows !WIN_VER_RAW! - !NODE_ARCH! - using Node.js v!NODE_VERSION!

rem Determine minimum required major version (18 for Vite 5, 16 for legacy)
set "REQ_MAJOR=18"
if "!NODE_VERSION!"=="16.20.2" set "REQ_MAJOR=16"

rem If Node 16, patch Vite to v4 (Vite 5 requires Node 18+)
if "!NODE_VERSION!"=="16.20.2" (
    if exist "!CLI!\package.json" (
        echo $pkg = Get-Content '!CLI!\package.json' -Raw > "%TEMP%\_thd_vite.ps1"
        echo $pkg = $pkg -replace '"vite": "\d+\.\d+\.\d+"', '"vite": "4.5.5"' >> "%TEMP%\_thd_vite.ps1"
        echo Set-Content '!CLI!\package.json' -Value $pkg -NoNewline >> "%TEMP%\_thd_vite.ps1"
        powershell -ExecutionPolicy Bypass -File "%TEMP%\_thd_vite.ps1"
        del /f /q "%TEMP%\_thd_vite.ps1" 2>nul
    )
)
echo.

rem Step 1: Locate or install Node.js
set "NEED_NODE=0"
call :detect_node
if %errorlevel% equ 0 call :check_ver
if "!NODE_OK!"=="1" goto :check_files
if "!NODE_OK!"=="2" (
    echo [WARN] Node.js found but version too old, will install compatible version.
    set "NEED_NODE=1"
    goto :do_download_node
)

echo [Setup] Node.js not found in PATH, searching common locations...
call :search_node
if %errorlevel% equ 0 (
    set "PATH=!NODE_PATH!;%PATH%"
    call :check_ver
)
if "!NODE_OK!"=="1" goto :check_files
if "!NODE_OK!"=="2" (
    echo [WARN] Node.js found but version too old, will install compatible version.
    set "NEED_NODE=1"
    goto :do_download_node
)

:do_download_node
echo [Setup] Downloading portable Node.js v%NODE_VERSION%...
call :download_node
if %errorlevel% NEQ 0 (
    if "!NEED_NODE!"=="1" (
        echo [WARN] Could not download compatible Node.js. Trying with existing version...
        goto :check_files
    )
    echo.
    echo ========================================
    echo   ERROR: Could not install Node.js
    echo   Please install manually from:
    echo   https://nodejs.org
    echo ========================================
    pause
    exit /b 1
)

:check_files
rem Step 2: Verify critical project files exist
call :verify_files
if %errorlevel% equ 0 (
    echo [OK] All project files present.
    goto :check_deps
)

echo.
echo [Setup] Project files incomplete. Downloading from GitHub...
echo         %GITHUB_REPO%
echo.
call :download_project
if %errorlevel% equ 0 (
    echo [OK] Download complete, continuing...
    goto :check_deps
)
echo [WARN] Download failed. Trying to continue with existing files...
call :verify_files
if %errorlevel% NEQ 0 (
    echo [ERROR] Critical files missing. Please clone manually:
    echo        git clone %GITHUB_REPO%.git
    pause
    exit /b 1
)
echo [OK] Existing files are sufficient, continuing...

:check_deps
cd /d "%ROOT%"

rem Step 3: Install server dependencies
if not exist "%SRV%\node_modules" (
    echo.
    echo [Setup] Installing server dependencies...
    cd /d "%SRV%"
    call npm install --prefer-offline
    if %errorlevel% NEQ 0 (
        echo [WARN] npm install failed, retrying...
        call npm cache clean --force
        call npm install
    )
    cd /d "%ROOT%"
)

rem Step 4: Install client dependencies
if not exist "%CLI%\node_modules" (
    echo.
    echo [Setup] Installing client dependencies...
    cd /d "%CLI%"
    call npm install --prefer-offline
    if %errorlevel% NEQ 0 (
        echo [WARN] npm install failed, retrying...
        call npm cache clean --force
        call npm install
    )
    cd /d "%ROOT%"
)

rem Step 5: Build frontend
if not exist "%CLI%\dist\index.html" (
    echo.
    echo [Setup] Building frontend...
    cd /d "%CLI%"
    call npm run build
    if %errorlevel% NEQ 0 (
        echo [ERROR] Frontend build failed.
        pause
        exit /b 1
    )
    cd /d "%ROOT%"
)

rem Step 6: Generate runtime data directories
if not exist "%ROOT%\data" mkdir "%ROOT%\data"
if not exist "%ROOT%\data\avatars" mkdir "%ROOT%\data\avatars"
if not exist "%ROOT%\data\backgrounds" mkdir "%ROOT%\data\backgrounds"
if not exist "%ROOT%\data\profiles" mkdir "%ROOT%\data\profiles"
if not exist "%ROOT%\file\private" mkdir "%ROOT%\file\private"
if not exist "%ROOT%\file\public" mkdir "%ROOT%\file\public"

rem Step 7: Start server
cd /d "%SRV%"

rem Kill any existing process on port 3000
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000 " ^| findstr "LISTENING"') do (
    echo [Setup] Port 3000 is in use - PID %%a - closing...
    taskkill /PID %%a /F >nul 2>nul
    ping -n 2 127.0.0.1 >nul
)

echo.
echo ========================================
echo   Transfer Hard Disk
echo   Server  : http://localhost:3000
echo   Storage : %ROOT%\file
echo ========================================
echo.
echo   LAN IPs:
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4"') do echo     http:%%a:3000
echo ========================================
echo.
echo   Press Ctrl+C to stop
echo ========================================
echo.

node "%SRV%\src\index.js"
pause
exit /b 0

rem ============ Subroutine: detect_node ============
:detect_node
where node >nul 2>nul
if %errorlevel% NEQ 0 exit /b 1
for /f "delims=" %%i in ('where node 2^>nul') do set "NODE_EXE=%%i"
exit /b 0

rem ============ Subroutine: check_ver ============
rem Sets NODE_OK: 1=compatible, 2=too old, 0=error
:check_ver
set "NODE_OK=0"
for /f "tokens=1 delims=v." %%v in ('node -v 2^>nul') do set "NODE_MAJOR=%%v"
if "!NODE_MAJOR!"=="" exit /b 0
if !NODE_MAJOR! LSS !REQ_MAJOR! (
    echo [Detect] Node.js v!NODE_MAJOR! found - requires v!REQ_MAJOR!+
    set "NODE_OK=2"
    exit /b 0
)
echo [OK] Node.js v!NODE_MAJOR! found: !NODE_EXE!
set "NODE_OK=1"
exit /b 0

rem ============ Subroutine: search_node ============
:search_node
set "NODE_PATH="

if exist "%APPDATA%\TRAE SOLO CN\ModularData\ai-agent\vm\tools\node\node.exe" (
    set "NODE_PATH=%APPDATA%\TRAE SOLO CN\ModularData\ai-agent\vm\tools\node"
    set "NODE_EXE=!NODE_PATH!\node.exe"
    exit /b 0
)
if exist "%LOCALAPPDATA%\TRAE SOLO CN\ModularData\ai-agent\vm\tools\node\node.exe" (
    set "NODE_PATH=%LOCALAPPDATA%\TRAE SOLO CN\ModularData\ai-agent\vm\tools\node"
    set "NODE_EXE=!NODE_PATH!\node.exe"
    exit /b 0
)
if exist "%APPDATA%\nvm\node.exe" (
    set "NODE_PATH=%APPDATA%\nvm"
    set "NODE_EXE=!NODE_PATH!\node.exe"
    exit /b 0
)
for /d %%d in ("%APPDATA%\nvm\v*") do (
    if exist "%%d\node.exe" (
        set "NODE_PATH=%%d"
        set "NODE_EXE=%%d\node.exe"
        exit /b 0
    )
)
if exist "%NODE_DIR%\node.exe" (
    set "NODE_PATH=%NODE_DIR%"
    set "NODE_EXE=%NODE_DIR%\node.exe"
    exit /b 0
)
if exist "C:\Program Files\nodejs\node.exe" (
    set "NODE_PATH=C:\Program Files\nodejs"
    set "NODE_EXE=C:\Program Files\nodejs\node.exe"
    exit /b 0
)
if exist "C:\Program Files (x86)\nodejs\node.exe" (
    set "NODE_PATH=C:\Program Files (x86)\nodejs"
    set "NODE_EXE=C:\Program Files (x86)\nodejs\node.exe"
    exit /b 0
)
if exist "%USERPROFILE%\scoop\apps\nodejs\current\node.exe" (
    set "NODE_PATH=%USERPROFILE%\scoop\apps\nodejs\current"
    set "NODE_EXE=!NODE_PATH!\node.exe"
    exit /b 0
)
exit /b 1

rem ============ Subroutine: download_node ============
:download_node
echo.
echo   Downloading Node.js v%NODE_VERSION% ...
echo   %NODE_URL%
echo.

if not exist "%RUNTIME%" mkdir "%RUNTIME%"
if exist "%RUNTIME%\node-temp" rmdir /s /q "%RUNTIME%\node-temp" 2>nul
if exist "%TEMP%\%NODE_ZIP%" del /f /q "%TEMP%\%NODE_ZIP%" 2>nul

echo $ProgressPreference='SilentlyContinue' > "%TEMP%\_thd_dl_node.ps1"
echo try { >> "%TEMP%\_thd_dl_node.ps1"
echo   Invoke-WebRequest -Uri '%NODE_URL%' -OutFile '%TEMP%\%NODE_ZIP%' -UseBasicParsing -ErrorAction Stop >> "%TEMP%\_thd_dl_node.ps1"
echo   Write-Host '  Download complete.' >> "%TEMP%\_thd_dl_node.ps1"
echo } catch { >> "%TEMP%\_thd_dl_node.ps1"
echo   Write-Host '  Download failed: ' $_.Exception.Message >> "%TEMP%\_thd_dl_node.ps1"
echo   exit 1 >> "%TEMP%\_thd_dl_node.ps1"
echo } >> "%TEMP%\_thd_dl_node.ps1"
powershell -ExecutionPolicy Bypass -File "%TEMP%\_thd_dl_node.ps1"
if %errorlevel% NEQ 0 exit /b 1

echo   Extracting...
echo $ProgressPreference='SilentlyContinue' > "%TEMP%\_thd_ex_node.ps1"
echo try { >> "%TEMP%\_thd_ex_node.ps1"
echo   Expand-Archive -Path '%TEMP%\%NODE_ZIP%' -DestinationPath '%RUNTIME%\node-temp' -Force >> "%TEMP%\_thd_ex_node.ps1"
echo   $items = Get-ChildItem '%RUNTIME%\node-temp' -Directory >> "%TEMP%\_thd_ex_node.ps1"
echo   $inner = $items[0] >> "%TEMP%\_thd_ex_node.ps1"
echo   if ($inner) { >> "%TEMP%\_thd_ex_node.ps1"
echo     if (Test-Path '%NODE_DIR%') { Remove-Item '%NODE_DIR%' -Recurse -Force } >> "%TEMP%\_thd_ex_node.ps1"
echo     Move-Item $inner.FullName '%NODE_DIR%' >> "%TEMP%\_thd_ex_node.ps1"
echo     Remove-Item '%RUNTIME%\node-temp' -Recurse -Force >> "%TEMP%\_thd_ex_node.ps1"
echo   } >> "%TEMP%\_thd_ex_node.ps1"
echo   Write-Host '  Extraction complete.' >> "%TEMP%\_thd_ex_node.ps1"
echo } catch { >> "%TEMP%\_thd_ex_node.ps1"
echo   Write-Host '  Extraction failed: ' $_.Exception.Message >> "%TEMP%\_thd_ex_node.ps1"
echo   exit 1 >> "%TEMP%\_thd_ex_node.ps1"
echo } >> "%TEMP%\_thd_ex_node.ps1"
powershell -ExecutionPolicy Bypass -File "%TEMP%\_thd_ex_node.ps1"
if %errorlevel% NEQ 0 exit /b 1

del /f /q "%TEMP%\%NODE_ZIP%" 2>nul
del /f /q "%TEMP%\_thd_dl_node.ps1" 2>nul
del /f /q "%TEMP%\_thd_ex_node.ps1" 2>nul

if not exist "%NODE_DIR%\node.exe" (
    echo   ERROR: node.exe not found after extraction
    exit /b 1
)

set "PATH=%NODE_DIR%;%PATH%"
set "NODE_EXE=%NODE_DIR%\node.exe"
echo   [OK] Node.js v%NODE_VERSION% installed to runtime\node\
exit /b 0

rem ============ Subroutine: verify_files ============
:verify_files
set "MISSING=0"

if not exist "%SRV%\package.json"   set "MISSING=1"
if not exist "%SRV%\src\index.js"   set "MISSING=1"
if not exist "%SRV%\src\config.js"  set "MISSING=1"
if not exist "%SRV%\src\auth.js"    set "MISSING=1"
if not exist "%SRV%\src\users.js"   set "MISSING=1"
if not exist "%SRV%\src\fileServer.js" set "MISSING=1"
if not exist "%SRV%\src\wsServer.js" set "MISSING=1"

if not exist "%CLI%\package.json"   set "MISSING=1"
if not exist "%CLI%\index.html"     set "MISSING=1"
if not exist "%CLI%\vite.config.js" set "MISSING=1"
if not exist "%CLI%\src\App.jsx"    set "MISSING=1"
if not exist "%CLI%\src\App.css"    set "MISSING=1"

if not exist "%ROOT%\README.md"     set "MISSING=1"
if not exist "%ROOT%\LICENSE"       set "MISSING=1"

if %MISSING% equ 1 (
    echo [WARN] Some project files are missing.
    exit /b 1
)
exit /b 0

rem ============ Subroutine: download_project ============
:download_project
echo.
echo   Downloading project files from GitHub...
echo   %REPO_ZIP_URL%
echo.

set "TEMP_ZIP=%TEMP%\transfer-hard-disk-main.zip"
set "TEMP_DIR=%TEMP%\transfer-hard-disk-extract"

if exist "%TEMP_ZIP%" del /f /q "%TEMP_ZIP%" 2>nul
if exist "%TEMP_DIR%" rmdir /s /q "%TEMP_DIR%" 2>nul

echo $ProgressPreference='SilentlyContinue' > "%TEMP%\_thd_dl_proj.ps1"
echo try { >> "%TEMP%\_thd_dl_proj.ps1"
echo   Invoke-WebRequest -Uri '%REPO_ZIP_URL%' -OutFile '%TEMP_ZIP%' -UseBasicParsing -ErrorAction Stop >> "%TEMP%\_thd_dl_proj.ps1"
echo   Write-Host '  Download complete.' >> "%TEMP%\_thd_dl_proj.ps1"
echo } catch { >> "%TEMP%\_thd_dl_proj.ps1"
echo   Write-Host '  Download failed: ' $_.Exception.Message >> "%TEMP%\_thd_dl_proj.ps1"
echo   exit 1 >> "%TEMP%\_thd_dl_proj.ps1"
echo } >> "%TEMP%\_thd_dl_proj.ps1"
powershell -ExecutionPolicy Bypass -File "%TEMP%\_thd_dl_proj.ps1"
if %errorlevel% NEQ 0 exit /b 1

echo   Extracting...
echo $ProgressPreference='SilentlyContinue' > "%TEMP%\_thd_ex_proj.ps1"
echo try { >> "%TEMP%\_thd_ex_proj.ps1"
echo   Expand-Archive -Path '%TEMP_ZIP%' -DestinationPath '%TEMP_DIR%' -Force >> "%TEMP%\_thd_ex_proj.ps1"
echo   Write-Host '  Extraction complete.' >> "%TEMP%\_thd_ex_proj.ps1"
echo } catch { >> "%TEMP%\_thd_ex_proj.ps1"
echo   Write-Host '  Extraction failed: ' $_.Exception.Message >> "%TEMP%\_thd_ex_proj.ps1"
echo   exit 1 >> "%TEMP%\_thd_ex_proj.ps1"
echo } >> "%TEMP%\_thd_ex_proj.ps1"
powershell -ExecutionPolicy Bypass -File "%TEMP%\_thd_ex_proj.ps1"
if %errorlevel% NEQ 0 exit /b 1

for /d %%d in ("%TEMP_DIR%\*") do set "SRC_DIR=%%d"
if not defined SRC_DIR (
    echo   ERROR: Could not find extracted project directory
    exit /b 1
)

echo   Merging project files...
robocopy "%SRC_DIR%" "%ROOT%" /E /XO /NP /NFL /NDL /NJH /NJS >nul

rmdir /s /q "%TEMP_DIR%" 2>nul
del /f /q "%TEMP_ZIP%" 2>nul
del /f /q "%TEMP%\_thd_dl_proj.ps1" 2>nul
del /f /q "%TEMP%\_thd_ex_proj.ps1" 2>nul

if exist "%SRV%\src\index.js" (
    echo   [OK] Project files downloaded and merged.
    exit /b 0
) else (
    echo   ERROR: Project files still missing after download.
    exit /b 1
)