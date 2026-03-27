@echo off
chcp 65001 >nul 2>&1
title Andex Gateway - Instalador
color 0A

echo.
echo  ╔═══════════════════════════════════════════════╗
echo  ║      ANDEX GATEWAY - INSTALADOR v1.0          ║
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

:: ── Definir carpeta de instalación ──
set "INSTALL_DIR=C:\AndexGateway"

:: ── Verificar si ya existe instalación ──
if exist "%INSTALL_DIR%\src\index.ts" (
    echo  [INFO] Instalacion existente detectada en %INSTALL_DIR%
    echo  Actualizando...
    echo.
    goto :ACTUALIZAR
)

:: ══════════════════════════════════════
:: PRIMERA INSTALACIÓN
:: ══════════════════════════════════════
echo  ── PRIMERA INSTALACION ──
echo.

:: Verificar git
where git >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Git no esta instalado.
    echo  Descargalo de: https://git-scm.com/download/win
    echo.
    pause
    exit /b 1
)

:: Crear carpeta si no existe
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"

:: Guardar .env si existe
if exist "%INSTALL_DIR%\.env" (
    echo  [INFO] Guardando .env existente...
    copy "%INSTALL_DIR%\.env" "%INSTALL_DIR%\.env.backup" >nul
)

:: Clonar repositorio
echo  [1/4] Clonando repositorio...
cd /d "%INSTALL_DIR%"

:: Si ya hay archivos, inicializar git y hacer pull
if exist "%INSTALL_DIR%\docker-compose.yml" (
    echo  [INFO] Carpeta tiene archivos previos, inicializando git...
    git init >nul 2>&1
    git remote add origin https://github.com/agallardov-ai/andex-gateway.git >nul 2>&1
    git fetch origin >nul 2>&1
    git checkout -f main >nul 2>&1
    git reset --hard origin/main >nul 2>&1
) else (
    git clone https://github.com/agallardov-ai/andex-gateway.git . 2>&1
    if %errorlevel% neq 0 (
        echo  [ERROR] No se pudo clonar. Verifica tu conexion a internet.
        pause
        exit /b 1
    )
)

:: Restaurar .env si habia backup
if exist "%INSTALL_DIR%\.env.backup" (
    echo  [INFO] Restaurando .env...
    copy "%INSTALL_DIR%\.env.backup" "%INSTALL_DIR%\.env" >nul
    del "%INSTALL_DIR%\.env.backup"
)

:: Crear .env si no existe
if not exist "%INSTALL_DIR%\.env" (
    echo  [2/4] Creando archivo de configuracion .env ...
    echo.
    echo  IMPORTANTE: Debes editar .env con los datos de tu centro.
    echo.
    (
        echo # ═══ ANDEX GATEWAY - CONFIGURACION ═══
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
        echo # Supabase ^(opcional^)
        echo SUPABASE_URL=
        echo SUPABASE_SERVICE_KEY=
    ) > "%INSTALL_DIR%\.env"
    echo  [OK] .env creado. Editalo antes de iniciar.
) else (
    echo  [2/4] .env existente conservado
)

echo  [3/4] Construyendo imagen Docker...
goto :BUILD

:: ══════════════════════════════════════
:: ACTUALIZACIÓN
:: ══════════════════════════════════════
:ACTUALIZAR
cd /d "%INSTALL_DIR%"

echo  [1/3] Descargando actualizacion...
git pull origin main 2>&1
if %errorlevel% neq 0 (
    echo  [WARN] git pull fallo, forzando actualizacion...
    git fetch origin >nul 2>&1
    git reset --hard origin/main 2>&1
)

echo  [2/3] Deteniendo gateway actual...
docker-compose down >nul 2>&1

echo  [3/3] Reconstruyendo imagen Docker...

:BUILD
cd /d "%INSTALL_DIR%"
docker-compose build --no-cache 2>&1
if %errorlevel% neq 0 (
    echo.
    echo  [ERROR] Fallo al construir la imagen Docker.
    pause
    exit /b 1
)

echo.
echo  Iniciando Andex Gateway...
docker-compose up -d 2>&1

:: Esperar a que arranque
echo.
echo  Esperando que el gateway inicie...
timeout /t 10 /nobreak >nul

:: Verificar salud
docker exec andex-gateway wget -q -O- http://localhost:3001/health >nul 2>&1
if %errorlevel% equ 0 (
    echo.
    echo  ╔═══════════════════════════════════════════════╗
    echo  ║  [OK] GATEWAY FUNCIONANDO CORRECTAMENTE       ║
    echo  ║                                                ║
    echo  ║  Dashboard: http://localhost:3001              ║
    echo  ║  Usuario:   admin                              ║
    echo  ║  Password:  admin123                           ║
    echo  ╚═══════════════════════════════════════════════╝
) else (
    echo.
    echo  [WARN] Gateway iniciando... puede tardar unos segundos mas.
    echo  Abre http://localhost:3001 en tu navegador.
)

echo.
echo  Para ver logs:  docker-compose logs -f
echo  Para detener:   docker-compose down
echo  Para actualizar: ejecuta este script de nuevo
echo.
pause
