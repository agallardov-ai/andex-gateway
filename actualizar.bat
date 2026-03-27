@echo off
chcp 65001 >nul 2>&1
title Andex Gateway - Actualizar
color 0B

echo.
echo  ╔═══════════════════════════════════════════════╗
echo  ║      ANDEX GATEWAY - ACTUALIZAR               ║
echo  ╚═══════════════════════════════════════════════╝
echo.

cd /d C:\AndexGateway

echo  [1/3] Descargando ultima version...
git pull origin main

echo  [2/3] Reconstruyendo...
docker-compose down
docker-compose build --no-cache

echo  [3/3] Iniciando...
docker-compose up -d

timeout /t 10 /nobreak >nul
echo.
echo  [OK] Gateway actualizado. Abre http://localhost:3001
echo.
pause
