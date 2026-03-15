#!/usr/bin/env bash
# ╔═══════════════════════════════════════════════════════════════╗
# ║  ANDEX GATEWAY — Instalador                                  ║
# ║                                                               ║
# ║  Punto de entrada unico. Ejecute:                             ║
# ║    curl -sSL <url>/install.sh | bash                          ║
# ║  o simplemente:                                               ║
# ║    ./install.sh                                               ║
# ╚═══════════════════════════════════════════════════════════════╝

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

ok()   { echo -e "${GREEN}  ✅ $1${NC}"; }
err()  { echo -e "${RED}  ❌ $1${NC}"; }
warn() { echo -e "${YELLOW}  ⚠️  $1${NC}"; }
info() { echo -e "${CYAN}  ℹ️  $1${NC}"; }

echo -e "${CYAN}${BOLD}"
cat << 'BANNER'

    ╔═══════════════════════════════════════════════╗
    ║                                               ║
    ║     🏥  ANDEX GATEWAY  —  Instalador         ║
    ║                                               ║
    ╚═══════════════════════════════════════════════╝

BANNER
echo -e "${NC}"

# ─────────────────────────────────────────────────
# 1. VERIFICAR DEPENDENCIAS
# ─────────────────────────────────────────────────
echo -e "  ${BOLD}Verificando dependencias...${NC}\n"

MISSING=0

# Node.js
if command -v node &> /dev/null; then
    NODE_V=$(node -v)
    NODE_MAJOR=$(echo "$NODE_V" | sed 's/v//' | cut -d. -f1)
    if [ "$NODE_MAJOR" -ge 18 ]; then
        ok "Node.js $NODE_V"
    else
        err "Node.js $NODE_V — se requiere v18+"
        MISSING=1
    fi
else
    err "Node.js no instalado — se requiere v18+"
    echo -e "     ${DIM}Instalar: https://nodejs.org${NC}"
    MISSING=1
fi

# npm
if command -v npm &> /dev/null; then
    ok "npm $(npm -v)"
else
    err "npm no instalado"
    MISSING=1
fi

# Docker (opcional)
if command -v docker &> /dev/null; then
    ok "Docker $(docker --version | cut -d' ' -f3 | tr -d ',')"
    HAS_DOCKER=true
else
    warn "Docker no instalado (opcional — necesario solo para deploy con containers)"
    HAS_DOCKER=false
fi

# curl
if command -v curl &> /dev/null; then
    ok "curl disponible"
else
    err "curl no instalado — necesario para tests de conexion"
    MISSING=1
fi

# python3 (para scripts de provisioning)
if command -v python3 &> /dev/null; then
    ok "Python3 $(python3 --version | cut -d' ' -f2)"
else
    warn "Python3 no instalado (necesario para provision-supabase.sh)"
fi

echo ""

if [ "$MISSING" -eq 1 ]; then
    err "Faltan dependencias obligatorias. Instale lo necesario y vuelva a ejecutar."
    exit 1
fi

ok "Todas las dependencias OK"

# ─────────────────────────────────────────────────
# 2. INSTALAR PAQUETES NODE
# ─────────────────────────────────────────────────
echo ""
echo -e "  ${BOLD}Instalando dependencias Node.js...${NC}\n"

if [ -d "node_modules" ] && [ -f "node_modules/.package-lock.json" ]; then
    ok "node_modules ya existe"
else
    npm install --production=false 2>&1 | tail -3
    ok "Dependencias instaladas"
fi

# ─────────────────────────────────────────────────
# 3. COMPILAR TYPESCRIPT
# ─────────────────────────────────────────────────
echo ""
echo -e "  ${BOLD}Compilando TypeScript...${NC}\n"

if npm run build 2>&1 | tail -3; then
    ok "Compilacion exitosa"
else
    err "Error compilando — revise los errores arriba"
    exit 1
fi

# ─────────────────────────────────────────────────
# 4. EJECUTAR SETUP INTERACTIVO
# ─────────────────────────────────────────────────
echo ""
echo -e "${CYAN}${BOLD}━━━ CONFIGURACION ━━━${NC}\n"

if [ -f ".env" ]; then
    warn "Ya existe un .env configurado"
    echo -ne "  ${BOLD}¿Reconfigurar? [s/N]: ${NC}"
    read -r answer
    if [[ "$answer" =~ ^[sS]$ ]]; then
        exec ./setup.sh
    else
        ok "Usando configuracion existente"
        echo ""
        
        # Mostrar opciones
        echo -e "  ${BOLD}¿Que desea hacer?${NC}"
        echo -e "    ${CYAN}1)${NC} Iniciar Gateway (npm start)"
        echo -e "    ${CYAN}2)${NC} Iniciar con Docker"
        echo -e "    ${CYAN}3)${NC} Ejecutar provisioning Supabase"
        echo -e "    ${CYAN}4)${NC} Salir"
        echo ""
        echo -ne "  ${BOLD}Seleccione (1-4): ${NC}"
        read -r choice
        
        case "$choice" in
            1)
                echo ""
                info "Iniciando Gateway..."
                exec npm start
                ;;
            2)
                if [ "$HAS_DOCKER" = true ]; then
                    echo ""
                    echo -e "    ${CYAN}a)${NC} Con Orthanc incluido (dev/testing)"
                    echo -e "    ${CYAN}b)${NC} Solo Gateway (produccion — PACS externo)"
                    echo -ne "  ${BOLD}Seleccione (a/b): ${NC}"
                    read -r dc
                    echo ""
                    if [[ "$dc" =~ ^[bB]$ ]]; then
                        exec docker compose -f docker-compose.prod.yml up -d
                    else
                        exec docker compose up -d
                    fi
                else
                    err "Docker no instalado"
                    exit 1
                fi
                ;;
            3)
                exec ./provision-supabase.sh
                ;;
            *)
                echo -e "\n  Listo. Para iniciar: ${DIM}npm start${NC}\n"
                ;;
        esac
    fi
else
    # No hay .env — lanzar setup
    exec ./setup.sh
fi
