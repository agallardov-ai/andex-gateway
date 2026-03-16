@echo off
:: Andex Gateway - Instalar como servicio Windows
:: Ejecutar como Administrador

echo.
echo  ========================================
echo   Andex Gateway - Instalador de Servicio
echo  ========================================
echo.

net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERROR] Requiere permisos de Administrador.
    pause
    exit /b 1
)

set "GD=%~dp0"
set "GD=%GD:~0,-1%"

where node >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERROR] Node.js no instalado. https://nodejs.org
    pause
    exit /b 1
)

if not exist "%GD%\certs\localhost+2.pem" (
    echo [INFO] Generando certificados HTTPS...
    where mkcert >nul 2>&1
    if %errorLevel% neq 0 winget install FiloSottile.mkcert 2>nul
    where mkcert >nul 2>&1
    if %errorLevel% equ 0 (
        mkcert -install
        if not exist "%GD%\certs" mkdir "%GD%\certs"
        pushd "%GD%\certs"
        mkcert localhost 127.0.0.1 ::1
        popd
        echo [OK] Certificados HTTPS generados
    )
)

echo [INFO] Instalando dependencias...
pushd "%GD%"
call npm install
popd

> "%GD%\start-gateway.bat" (
    echo @echo off
    echo cd /d "%GD%"
    echo npx tsx src/index.ts
)

schtasks /create /tn "AndexGateway" /tr "\"%GD%\start-gateway.bat\"" /sc onlogon /rl highest /f
echo [OK] Tarea programada creada

set "SD=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
> "%TEMP%\cs.vbs" (
    echo Set o=WScript.CreateObject^("WScript.Shell"^)
    echo Set l=o.CreateShortcut^("%SD%\AndexGateway.lnk"^)
    echo l.TargetPath="%GD%\start-gateway.bat"
    echo l.WorkingDirectory="%GD%"
    echo l.WindowStyle=7
    echo l.Save
)
cscript //nologo "%TEMP%\cs.vbs"
del "%TEMP%\cs.vbs"

echo.
echo  Instalacion completada!
echo  El Gateway iniciara automaticamente al encender.
echo  Iniciar ahora: start-gateway.bat
echo  Desinstalar:   schtasks /delete /tn "AndexGateway" /f
pause
