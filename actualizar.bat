@echo off
chcp 65001 >nul 2>&1
title Andex Gateway - Actualizar
color 0B

echo.
echo  ╔═══════════════════════════════════════════════╗
echo  ║      ANDEX GATEWAY - ACTUALIZAR               ║
echo  ╚═══════════════════════════════════════════════╝
echo.

:: Simplemente llama a INSTALAR.bat que hace todo
:: (descarga, conserva .env, rebuild Docker)
call "%~dp0INSTALAR.bat"
