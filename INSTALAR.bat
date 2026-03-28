@echo off
chcp 65001 >nul 2>&1
title Andex Gateway - Instalador
color 0A

echo.
echo  ╔═══════════════════════════════════════════════╗
echo  ║      ANDEX GATEWAY - INSTALADOR v2.0          ║
echo  ║                                                ║
echo  ║      No necesita Git ni Node.js                ║
echo  ║      Solo necesita Docker Desktop              ║
echo  ║                                                ║
echo  ║      Primera vez: instala todo                 ║
echo  ║      Ya instalado: actualiza                   ║
echo  ╚═══════════════════════════════════════════════╝
echo.

:: ── Verificar Docker ──
where docker >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Docker no esta instalado.
    echo  Descargalo de: https://docs.docker.com/desktop/install/windows-install/
    echo.
    pause
    exit /b 1
)

:: ── Verificar Docker corriendo ──
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Docker no esta corriendo. Abre Docker Desktop primero.
    echo.
    pause
    exit /b 1
)

echo  [OK] Docker detectado
echo.

:: ── Variables ──
set "INSTALL_DIR=C:\AndexGateway"
set "REPO_URL=https://github.com/agallardov-ai/andex-gateway/archive/refs/heads/main.zip"
set "ZIP_FILE=%TEMP%\andex-gateway-main.zip"
set "EXTRACT_DIR=%TEMP%\andex-gateway-main"

:: ── Guardar .env si existe ──
if exist "%INSTALL_DIR%\.env" (
    echo  [INFO] Guardando configuracion .env existente...
    copy "%INSTALL_DIR%\.env" "%TEMP%\andex-env-backup.txt" >nul
)

:: ══════════════════════════════════════
:: DESCARGAR CODIGO DESDE GITHUB
:: ══════════════════════════════════════
echo  [1/4] Descargando ultima version desde GitHub...
powershell -Command "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%REPO_URL%' -OutFile '%ZIP_FILE%' -UseBasicParsing } catch { Write-Host 'ERROR: No se pudo descargar'; exit 1 }"
if %errorlevel% neq 0 (
    echo  [ERROR] No se pudo descargar. Verifica tu conexion a internet.
    pause
    exit /b 1
)
echo  [OK] Descargado

:: ── Descomprimir ──
echo  [2/4] Descomprimiendo...
if exist "%EXTRACT_DIR%" rmdir /s /q "%EXTRACT_DIR%" >nul 2>&1
powershell -Command "Expand-Archive -Path '%ZIP_FILE%' -DestinationPath '%TEMP%' -Force"
if %errorlevel% neq 0 (
    echo  [ERROR] No se pudo descomprimir.
    pause
    exit /b 1
)

:: ── Detener gateway si esta corriendo ──
docker-compose -f "%INSTALL_DIR%\docker-compose.prod.yml" down >nul 2>&1

:: ── Crear carpeta destino ──
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"

:: ── Copiar archivos (sobrescribe todo excepto .env) ──
echo  [3/4] Instalando archivos...
xcopy "%EXTRACT_DIR%\*" "%INSTALL_DIR%\" /E /Y /Q >nul 2>&1

:: ── Limpiar temporales ──
del "%ZIP_FILE%" >nul 2>&1
rmdir /s /q "%EXTRACT_DIR%" >nul 2>&1

:: ── Restaurar .env si habia backup ──
if exist "%TEMP%\andex-env-backup.txt" (
    echo  [INFO] Restaurando configuracion .env...
    copy "%TEMP%\andex-env-backup.txt" "%INSTALL_DIR%\.env" >nul
    del "%TEMP%\andex-env-backup.txt" >nul
)

:: ── Crear .env si no existe ──
if not exist "%INSTALL_DIR%\.env" (
    echo.
    echo  IMPORTANTE: Se creara .env con valores por defecto.
    echo  Debes editarlo con los datos de tu centro.
    echo.
    (
        echo # === ANDEX GATEWAY - CONFIGURACION ===
        echo.
        echo # Identidad del centro
        echo CENTRO_NOMBRE=Mi Hospital
        echo CENTRO_ID=MIHOSPITAL
        echo.
        echo # Seguridad
        echo API_KEY=cambiar-esta-api-key
        echo DASHBOARD_USER=admin
        echo DASHBOARD_PASSWORD=admin123
        echo ALLOWED_ORIGINS=*
        echo.
        echo # PACS
        echo PACS_TYPE=dicom-native
        echo PACS_HOST=192.168.1.100
        echo PACS_PORT=104
        echo PACS_AET=PACS
        echo GATEWAY_AET=ANDEX01
        echo PACS_BASE_URL=http://localhost:8042
        echo.
        echo # DICOMweb endpoints
        echo PACS_STOW_ENDPOINT=/dicomweb/studies
        echo PACS_QIDO_ENDPOINT=/dicomweb/studies
        echo PACS_WADO_ENDPOINT=/dicomweb/studies
        echo.
        echo # Worklist
        echo WORKLIST_MODE=mock
        echo WORKLIST_SYNC_ENABLED=true
        echo WORKLIST_SYNC_INTERVAL_MS=30000
        echo WORKLIST_DEFAULT_MODALITY=ES
        echo.
        echo # Supabase
        echo SUPABASE_URL=
        echo SUPABASE_SERVICE_KEY=
    ) > "%INSTALL_DIR%\.env"
    echo  [OK] .env creado con valores por defecto.
)

:: ══════════════════════════════════════
:: CONSTRUIR Y LEVANTAR
:: ══════════════════════════════════════
echo  [4/4] Construyendo imagen Docker (puede tardar 1-2 min)...
cd /d "%INSTALL_DIR%"
docker-compose -f docker-compose.prod.yml build --no-cache 2>&1
if %errorlevel% neq 0 (
    echo.
    echo  [ERROR] Fallo al construir la imagen Docker.
    pause
    exit /b 1
)

echo.
echo  Iniciando Andex Gateway...
docker-compose -f docker-compose.prod.yml up -d 2>&1

:: Esperar a que arranque
echo.
echo  Esperando que el gateway inicie...
timeout /t 15 /nobreak >nul

:: Verificar salud
docker exec andex-gateway wget -q -O- http://localhost:3001/health >nul 2>&1
if %errorlevel% equ 0 (
    echo.
    echo  ╔═══════════════════════════════════════════════╗
    echo  ║  [OK] GATEWAY FUNCIONANDO CORRECTAMENTE       ║
    echo  ║                                                ║
    echo  ║  Dashboard: https://localhost:3443              ║
    echo  ║  Usuario:   admin                              ║
    echo  ║  Password:  admin123                           ║
    echo  ╚═══════════════════════════════════════════════╝
) else (
    echo.
    echo  [WARN] Gateway iniciando... puede tardar unos segundos mas.
    echo  Abre https://localhost:3443 en tu navegador.
)

echo.
echo  Para ver logs:     docker-compose logs -f
echo  Para detener:      docker-compose -f docker-compose.prod.yml down
echo  Para actualizar:   ejecuta este script de nuevo
echo.
pause
