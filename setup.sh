#!/usr/bin/env bash
# ╔═══════════════════════════════════════════════════════════════╗
# ║           ANDEX GATEWAY - Setup Interactivo v1.0              ║
# ║                                                               ║
# ║  Configura una nueva instancia del Gateway para un centro     ║
# ║  de salud. Genera .env, crea carpetas, y prueba conexiones.   ║
# ╚═══════════════════════════════════════════════════════════════╝

set -euo pipefail

# ─────────────────────────────────────────────────
# COLORES Y HELPERS
# ─────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m' # No Color

ok()    { echo -e "${GREEN}  ✅ $1${NC}"; }
warn()  { echo -e "${YELLOW}  ⚠️  $1${NC}"; }
err()   { echo -e "${RED}  ❌ $1${NC}"; }
info()  { echo -e "${BLUE}  ℹ️  $1${NC}"; }
step()  { echo -e "\n${CYAN}${BOLD}━━━ $1 ━━━${NC}\n"; }
ask()   { echo -ne "${BOLD}  $1${NC}"; }

# Prompt con valor por defecto
prompt() {
    local varname="$1"
    local message="$2"
    local default="${3:-}"
    
    if [ -n "$default" ]; then
        ask "$message [${DIM}$default${NC}${BOLD}]: "
    else
        ask "$message: "
    fi
    
    read -r input
    input="${input:-$default}"
    eval "$varname=\"\$input\""
}

# Prompt de selección numérica
select_option() {
    local varname="$1"
    local message="$2"
    shift 2
    local options=("$@")
    
    echo -e "  ${BOLD}$message${NC}"
    for i in "${!options[@]}"; do
        echo -e "    ${CYAN}$((i+1)))${NC} ${options[$i]}"
    done
    
    while true; do
        ask "  Seleccione (1-${#options[@]}): "
        read -r choice
        if [[ "$choice" =~ ^[0-9]+$ ]] && [ "$choice" -ge 1 ] && [ "$choice" -le "${#options[@]}" ]; then
            eval "$varname=\"\${options[$((choice-1))]}\""
            return 0
        fi
        warn "Opción inválida, intente de nuevo"
    done
}

# Prompt sí/no
confirm() {
    local message="$1"
    local default="${2:-s}"
    local hint="[S/n]"
    [ "$default" = "n" ] && hint="[s/N]"
    
    ask "$message $hint: "
    read -r answer
    answer="${answer:-$default}"
    [[ "$answer" =~ ^[sS]$ ]]
}

# Generar API key segura
generate_api_key() {
    if command -v openssl &> /dev/null; then
        openssl rand -hex 32
    elif command -v python3 &> /dev/null; then
        python3 -c "import secrets; print(secrets.token_hex(32))"
    else
        # Fallback: /dev/urandom
        cat /dev/urandom | LC_ALL=C tr -dc 'a-f0-9' | head -c 64
    fi
}

# Generar contraseña legible
generate_password() {
    if command -v openssl &> /dev/null; then
        openssl rand -base64 12 | tr -d '/+=' | head -c 16
    else
        cat /dev/urandom | LC_ALL=C tr -dc 'A-Za-z0-9' | head -c 16
    fi
}

# ─────────────────────────────────────────────────
# BANNER
# ─────────────────────────────────────────────────
clear
echo -e "${CYAN}${BOLD}"
cat << 'BANNER'

    ╔═══════════════════════════════════════════════╗
    ║                                               ║
    ║     🏥  ANDEX GATEWAY  -  Setup v1.0         ║
    ║                                               ║
    ║     Configuración para nuevo centro           ║
    ║                                               ║
    ╚═══════════════════════════════════════════════╝

BANNER
echo -e "${NC}"
echo -e "  Este asistente configurará el Andex Gateway para"
echo -e "  conectar su centro de salud con el sistema PACS.\n"
echo -e "  ${DIM}Presione Enter para aceptar valores por defecto [entre corchetes]${NC}\n"

if ! confirm "¿Continuar con la instalación?"; then
    echo -e "\n  Instalación cancelada.\n"
    exit 0
fi

# ─────────────────────────────────────────────────
# PASO 1: IDENTIDAD DEL CENTRO
# ─────────────────────────────────────────────────
step "PASO 1/7 — Identidad del Centro"

prompt CENTRO_NOMBRE "Nombre del centro" "Hospital Ejemplo"
prompt CENTRO_ID "ID del centro (UUID o código corto)" ""

if [ -z "$CENTRO_ID" ]; then
    # Generar un ID basado en el nombre
    CENTRO_ID=$(echo "$CENTRO_NOMBRE" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd 'a-z0-9-' | head -c 20)
    info "ID generado automáticamente: $CENTRO_ID"
fi

ok "Centro: $CENTRO_NOMBRE ($CENTRO_ID)"

# ─────────────────────────────────────────────────
# PASO 2: TIPO DE PACS
# ─────────────────────────────────────────────────
step "PASO 2/7 — Servidor PACS"

echo -e "  ${DIM}Seleccione el tipo de PACS al que se conectará el Gateway:${NC}\n"

select_option PACS_PRESET "Tipo de PACS:" \
    "Orthanc (testing/desarrollo)" \
    "FUJIFILM Synapse 7" \
    "DCM4CHEE" \
    "DICOMweb genérico" \
    "Otro / Configurar manualmente"

# Aplicar presets
case "$PACS_PRESET" in
    "Orthanc (testing/desarrollo)")
        PACS_TYPE="orthanc"
        PACS_URL_DEFAULT="http://localhost:8042"
        PACS_AUTH_DEFAULT="none"
        STOW_DEFAULT="/instances"
        QIDO_DEFAULT="/studies"
        WADO_DEFAULT="/studies"
        WORKLIST_ENDPOINT_DEFAULT="/modalities"
        WORKLIST_MWL_DEFAULT="/modalities"
        WORKLIST_PREFER_UPS="false"
        ;;
    "FUJIFILM Synapse 7")
        PACS_TYPE="dicomweb"
        PACS_URL_DEFAULT="https://synapse.hospital.cl"
        PACS_AUTH_DEFAULT="basic"
        STOW_DEFAULT="/dicomweb/studies"
        QIDO_DEFAULT="/dicomweb/studies"
        WADO_DEFAULT="/dicomweb/studies"
        WORKLIST_ENDPOINT_DEFAULT="/dicomweb/workitems"
        WORKLIST_MWL_DEFAULT="/dicomweb/mwlitems"
        WORKLIST_PREFER_UPS="false"
        ;;
    "DCM4CHEE")
        PACS_TYPE="dicomweb"
        PACS_URL_DEFAULT="http://dcm4chee.hospital.cl:8080"
        PACS_AUTH_DEFAULT="bearer"
        STOW_DEFAULT="/dcm4chee-arc/aets/DCM4CHEE/rs/studies"
        QIDO_DEFAULT="/dcm4chee-arc/aets/DCM4CHEE/rs/studies"
        WADO_DEFAULT="/dcm4chee-arc/aets/DCM4CHEE/rs/studies"
        WORKLIST_ENDPOINT_DEFAULT="/dcm4chee-arc/aets/DCM4CHEE/rs/workitems"
        WORKLIST_MWL_DEFAULT="/dcm4chee-arc/aets/DCM4CHEE/rs/mwlitems"
        WORKLIST_PREFER_UPS="true"
        ;;
    "DICOMweb genérico")
        PACS_TYPE="dicomweb"
        PACS_URL_DEFAULT="http://pacs.hospital.cl:8080"
        PACS_AUTH_DEFAULT="none"
        STOW_DEFAULT="/dicomweb/studies"
        QIDO_DEFAULT="/dicomweb/studies"
        WADO_DEFAULT="/dicomweb/studies"
        WORKLIST_ENDPOINT_DEFAULT="/dicomweb/workitems"
        WORKLIST_MWL_DEFAULT="/dicomweb/mwlitems"
        WORKLIST_PREFER_UPS="false"
        ;;
    *)
        PACS_TYPE="dicomweb"
        PACS_URL_DEFAULT=""
        PACS_AUTH_DEFAULT="none"
        STOW_DEFAULT="/dicomweb/studies"
        QIDO_DEFAULT="/dicomweb/studies"
        WADO_DEFAULT="/dicomweb/studies"
        WORKLIST_ENDPOINT_DEFAULT="/dicomweb/workitems"
        WORKLIST_MWL_DEFAULT="/dicomweb/mwlitems"
        WORKLIST_PREFER_UPS="false"
        ;;
esac

echo ""
prompt PACS_BASE_URL "URL del servidor PACS" "$PACS_URL_DEFAULT"

ok "PACS: $PACS_PRESET → $PACS_BASE_URL"

# ─────────────────────────────────────────────────
# PASO 3: AUTENTICACIÓN PACS
# ─────────────────────────────────────────────────
step "PASO 3/7 — Autenticación PACS"

select_option PACS_AUTH_TYPE "Tipo de autenticación del PACS:" \
    "none (sin autenticación)" \
    "basic (usuario y contraseña)" \
    "bearer (token JWT)"

# Extraer solo el tipo
PACS_AUTH_TYPE=$(echo "$PACS_AUTH_TYPE" | cut -d' ' -f1)

PACS_USERNAME=""
PACS_PASSWORD=""
PACS_TOKEN=""

case "$PACS_AUTH_TYPE" in
    "basic")
        prompt PACS_USERNAME "Usuario PACS" ""
        ask "  Contraseña PACS: "
        read -rs PACS_PASSWORD
        echo ""
        ok "Auth: basic ($PACS_USERNAME)"
        ;;
    "bearer")
        prompt PACS_TOKEN "Token JWT" ""
        ok "Auth: bearer token configurado"
        ;;
    *)
        ok "Auth: sin autenticación"
        ;;
esac

# ─────────────────────────────────────────────────
# PASO 4: SEGURIDAD DEL GATEWAY
# ─────────────────────────────────────────────────
step "PASO 4/7 — Seguridad del Gateway"

# API Key
echo -e "  ${DIM}La API Key autentica los requests desde la PWA al Gateway${NC}"
GENERATED_KEY=$(generate_api_key)
if confirm "¿Generar API Key automáticamente?" "s"; then
    API_KEY="$GENERATED_KEY"
    ok "API Key generada: ${API_KEY:0:16}..."
else
    prompt API_KEY "API Key personalizada" ""
fi

# Dashboard credentials
echo ""
echo -e "  ${DIM}Credenciales para acceder al Dashboard web del Gateway${NC}"
prompt DASHBOARD_USER "Usuario dashboard" "admin"

GENERATED_PASS=$(generate_password)
if confirm "¿Generar contraseña del dashboard automáticamente?" "s"; then
    DASHBOARD_PASSWORD="$GENERATED_PASS"
    ok "Contraseña generada: $DASHBOARD_PASSWORD"
else
    ask "  Contraseña dashboard: "
    read -rs DASHBOARD_PASSWORD
    echo ""
fi

# CORS
echo ""
prompt ALLOWED_ORIGINS "Orígenes permitidos (CORS)" "https://andexreports.app,http://localhost:5173,http://localhost:3000"

ok "Seguridad configurada"

# ─────────────────────────────────────────────────
# PASO 5: SERVIDOR Y STORAGE
# ─────────────────────────────────────────────────
step "PASO 5/7 — Servidor y Almacenamiento"

prompt PORT "Puerto del Gateway" "3001"
prompt STORAGE_PATH "Ruta de almacenamiento" "./data"

select_option NODE_ENV "Entorno:" \
    "production" \
    "development"

ok "Puerto: $PORT | Storage: $STORAGE_PATH | Entorno: $NODE_ENV"

# ─────────────────────────────────────────────────
# PASO 6: WORKLIST Y SYNC
# ─────────────────────────────────────────────────
step "PASO 6/7 — Worklist y Sincronización"

select_option WORKLIST_MODE "Modo de Worklist:" \
    "pacs (conectar al PACS real)" \
    "mock (datos de prueba para testing)"

WORKLIST_MODE=$(echo "$WORKLIST_MODE" | cut -d' ' -f1)

if [ "$WORKLIST_MODE" = "pacs" ]; then
    info "Los endpoints se preconfiguran según el tipo de PACS seleccionado"
    echo -e "    STOW:     $STOW_DEFAULT"
    echo -e "    QIDO:     $QIDO_DEFAULT"
    echo -e "    WADO:     $WADO_DEFAULT"
    echo -e "    Worklist: $WORKLIST_ENDPOINT_DEFAULT"
    echo ""
    
    if confirm "¿Personalizar endpoints DICOMweb?" "n"; then
        prompt STOW_DEFAULT "STOW-RS path" "$STOW_DEFAULT"
        prompt QIDO_DEFAULT "QIDO-RS path" "$QIDO_DEFAULT"
        prompt WADO_DEFAULT "WADO-RS path" "$WADO_DEFAULT"
        prompt WORKLIST_ENDPOINT_DEFAULT "Worklist UPS path" "$WORKLIST_ENDPOINT_DEFAULT"
        prompt WORKLIST_MWL_DEFAULT "Worklist MWL path" "$WORKLIST_MWL_DEFAULT"
    fi
fi

# Sync config
prompt SYNC_INTERVAL "Intervalo de polling worklist (ms)" "30000"
prompt QUEUE_RETRY_INTERVAL "Intervalo de reintentos cola (ms)" "5000"
prompt QUEUE_MAX_RETRIES "Máximo de reintentos" "5"

# Supabase (opcional)
echo ""
SUPABASE_URL=""
SUPABASE_SERVICE_KEY=""
if confirm "¿Configurar conexión a Supabase (sincronización cloud)?" "n"; then
    prompt SUPABASE_URL "Supabase URL" "https://xxx.supabase.co"
    ask "  Supabase Service Key: "
    read -rs SUPABASE_SERVICE_KEY
    echo ""
    ok "Supabase configurado"
else
    info "Sin Supabase — el Gateway funcionará en modo local"
fi

ok "Worklist: modo $WORKLIST_MODE | Sync cada ${SYNC_INTERVAL}ms"

# ─────────────────────────────────────────────────
# PASO 7: CONFIRMAR Y GENERAR
# ─────────────────────────────────────────────────
step "PASO 7/7 — Resumen de Configuración"

echo -e "  ${BOLD}Centro:${NC}           $CENTRO_NOMBRE"
echo -e "  ${BOLD}Centro ID:${NC}        $CENTRO_ID"
echo -e "  ${BOLD}PACS:${NC}             $PACS_TYPE → $PACS_BASE_URL"
echo -e "  ${BOLD}Auth PACS:${NC}        $PACS_AUTH_TYPE"
echo -e "  ${BOLD}Puerto Gateway:${NC}   $PORT"
echo -e "  ${BOLD}Entorno:${NC}          $NODE_ENV"
echo -e "  ${BOLD}Storage:${NC}          $STORAGE_PATH"
echo -e "  ${BOLD}Worklist:${NC}         $WORKLIST_MODE"
echo -e "  ${BOLD}API Key:${NC}          ${API_KEY:0:16}..."
echo -e "  ${BOLD}Dashboard:${NC}        $DASHBOARD_USER / $DASHBOARD_PASSWORD"
if [ -n "$SUPABASE_URL" ]; then
    echo -e "  ${BOLD}Supabase:${NC}         $SUPABASE_URL"
fi
echo ""

if ! confirm "¿Generar archivos de configuración?"; then
    echo -e "\n  Instalación cancelada.\n"
    exit 0
fi

# ─────────────────────────────────────────────────
# GENERAR .env
# ─────────────────────────────────────────────────
echo ""
info "Generando .env..."

# Backup si existe
if [ -f .env ]; then
    BACKUP_NAME=".env.backup.$(date +%Y%m%d_%H%M%S)"
    cp .env "$BACKUP_NAME"
    warn "Backup del .env anterior → $BACKUP_NAME"
fi

cat > .env << ENVFILE
# ╔═══════════════════════════════════════════════════════════════╗
# ║  ANDEX GATEWAY — Configuración del Centro                    ║
# ║  Generado: $(date '+%Y-%m-%d %H:%M:%S')
# ║  Centro: $CENTRO_NOMBRE
# ╚═══════════════════════════════════════════════════════════════╝

# ===== IDENTIDAD DEL CENTRO =====
CENTRO_NOMBRE=$CENTRO_NOMBRE
CENTRO_ID=$CENTRO_ID

# ===== GATEWAY =====
PORT=$PORT
NODE_ENV=$NODE_ENV

# ===== SEGURIDAD =====
API_KEY=$API_KEY
DASHBOARD_USER=$DASHBOARD_USER
DASHBOARD_PASSWORD=$DASHBOARD_PASSWORD
ALLOWED_ORIGINS=$ALLOWED_ORIGINS

# ===== PACS =====
PACS_TYPE=$PACS_TYPE
PACS_BASE_URL=$PACS_BASE_URL

# Autenticación PACS
PACS_AUTH_TYPE=$PACS_AUTH_TYPE
PACS_USERNAME=$PACS_USERNAME
PACS_PASSWORD=$PACS_PASSWORD
PACS_TOKEN=$PACS_TOKEN

# ===== DICOMweb ENDPOINTS =====
PACS_STOW_ENDPOINT=$STOW_DEFAULT
PACS_QIDO_ENDPOINT=$QIDO_DEFAULT
PACS_WADO_ENDPOINT=$WADO_DEFAULT

# ===== WORKLIST =====
WORKLIST_MODE=$WORKLIST_MODE
WORKLIST_ENDPOINT=$WORKLIST_ENDPOINT_DEFAULT
WORKLIST_MWL_ENDPOINT=$WORKLIST_MWL_DEFAULT
WORKLIST_PREFER_UPS=$WORKLIST_PREFER_UPS
WORKLIST_DEFAULT_MODALITY=ES

# ===== WORKLIST SYNC =====
WORKLIST_SYNC_ENABLED=true
WORKLIST_SYNC_INTERVAL_MS=$SYNC_INTERVAL
WORKLIST_DEFAULT_CENTRO_ID=$CENTRO_ID

# ===== STORAGE =====
STORAGE_PATH=$STORAGE_PATH

# ===== COLA DE REINTENTOS =====
QUEUE_RETRY_INTERVAL=$QUEUE_RETRY_INTERVAL
QUEUE_MAX_RETRIES=$QUEUE_MAX_RETRIES
CLEANUP_AFTER_HOURS=48

# ===== RATE LIMITING =====
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW_MS=60000

# ===== SUPABASE (opcional) =====
SUPABASE_URL=$SUPABASE_URL
SUPABASE_SERVICE_KEY=$SUPABASE_SERVICE_KEY
ENVFILE

ok ".env generado"

# ─────────────────────────────────────────────────
# CREAR CARPETAS
# ─────────────────────────────────────────────────
info "Creando carpetas de almacenamiento..."

mkdir -p "$STORAGE_PATH/pending"
mkdir -p "$STORAGE_PATH/processed"
mkdir -p "$STORAGE_PATH/failed"

ok "Carpetas creadas: $STORAGE_PATH/{pending,processed,failed}"

# ─────────────────────────────────────────────────
# COMPILAR SI ES NECESARIO
# ─────────────────────────────────────────────────
if [ ! -d "dist" ] || [ ! -f "dist/index.js" ]; then
    info "Compilando TypeScript..."
    if command -v npx &> /dev/null; then
        npx tsc 2>/dev/null && ok "Compilación exitosa" || warn "Error compilando — ejecute 'npm run build' manualmente"
    else
        warn "npx no disponible — ejecute 'npm run build' manualmente"
    fi
else
    ok "dist/ ya existe (compilación previa)"
fi

# ─────────────────────────────────────────────────
# TEST DE CONEXIÓN
# ─────────────────────────────────────────────────
echo ""
if confirm "¿Probar conexión al PACS ahora?" "s"; then
    info "Probando conexión a $PACS_BASE_URL..."
    
    CURL_OPTS="-s -o /dev/null -w %{http_code} --connect-timeout 5 --max-time 10"
    
    # Construir header de auth
    AUTH_HEADER=""
    if [ "$PACS_AUTH_TYPE" = "basic" ] && [ -n "$PACS_USERNAME" ]; then
        AUTH_HEADER="-u $PACS_USERNAME:$PACS_PASSWORD"
    elif [ "$PACS_AUTH_TYPE" = "bearer" ] && [ -n "$PACS_TOKEN" ]; then
        AUTH_HEADER="-H 'Authorization: Bearer $PACS_TOKEN'"
    fi
    
    # Test según tipo
    if [ "$PACS_TYPE" = "orthanc" ]; then
        TEST_URL="$PACS_BASE_URL/system"
    else
        TEST_URL="$PACS_BASE_URL$QIDO_DEFAULT?limit=1"
    fi
    
    HTTP_CODE=$(eval curl $CURL_OPTS $AUTH_HEADER "$TEST_URL" 2>/dev/null || echo "000")
    
    if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "204" ]; then
        ok "PACS responde correctamente (HTTP $HTTP_CODE)"
    elif [ "$HTTP_CODE" = "401" ] || [ "$HTTP_CODE" = "403" ]; then
        warn "PACS alcanzable pero error de autenticación (HTTP $HTTP_CODE) — verifique credenciales"
    elif [ "$HTTP_CODE" = "000" ]; then
        warn "No se pudo conectar al PACS — verifique que esté corriendo y la URL sea correcta"
    else
        warn "PACS respondió HTTP $HTTP_CODE — verifique la configuración"
    fi
fi

# Test Gateway (si ya está compilado)
if [ -f "dist/index.js" ]; then
    echo ""
    if confirm "¿Iniciar el Gateway para verificar que arranca correctamente?" "s"; then
        info "Iniciando Gateway (se detendrá en 5 segundos)..."
        
        # Iniciar en background y capturar output
        timeout 5 node dist/index.js > /tmp/gateway_test.log 2>&1 || true
        
        if grep -q "Ready to receive" /tmp/gateway_test.log 2>/dev/null || grep -q "Server:" /tmp/gateway_test.log 2>/dev/null; then
            ok "Gateway arranca correctamente"
        else
            warn "El Gateway no mostró mensaje de inicio — revise los logs:"
            echo -e "${DIM}"
            cat /tmp/gateway_test.log 2>/dev/null | tail -20
            echo -e "${NC}"
        fi
        
        rm -f /tmp/gateway_test.log
    fi
fi

# ─────────────────────────────────────────────────
# RESUMEN FINAL
# ─────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}"
cat << 'DONE'
    ╔═══════════════════════════════════════════════╗
    ║                                               ║
    ║     ✅  SETUP COMPLETADO                     ║
    ║                                               ║
    ╚═══════════════════════════════════════════════╝
DONE
echo -e "${NC}"

echo -e "  ${BOLD}Archivos generados:${NC}"
echo -e "    📄 .env                       Configuración del centro"
echo -e "    📁 $STORAGE_PATH/pending      Cola de archivos DICOM"
echo -e "    📁 $STORAGE_PATH/processed    Archivos procesados"
echo -e "    📁 $STORAGE_PATH/failed       Archivos con error"
echo ""

echo -e "  ${BOLD}Próximos pasos:${NC}"
echo ""
echo -e "    ${CYAN}1.${NC} Iniciar el Gateway:"
if [ "$NODE_ENV" = "production" ]; then
    echo -e "       ${DIM}npm start${NC}"
else
    echo -e "       ${DIM}npm run dev${NC}"
fi
echo ""
echo -e "    ${CYAN}2.${NC} Abrir el Dashboard:"
echo -e "       ${DIM}http://localhost:$PORT${NC}"
echo -e "       ${DIM}Login: $DASHBOARD_USER / $DASHBOARD_PASSWORD${NC}"
echo ""
echo -e "    ${CYAN}3.${NC} Configurar la PWA (Configuración → PACS/DICOM):"
echo -e "       ${DIM}Gateway URL:  http://<ip-servidor>:$PORT${NC}"
echo -e "       ${DIM}API Key:      ${API_KEY:0:24}...${NC}"
echo ""
echo -e "    ${CYAN}4.${NC} Probar envío DICOM:"
echo -e "       ${DIM}curl -X POST http://localhost:$PORT/api/upload \\${NC}"
echo -e "       ${DIM}  -H \"X-API-Key: $API_KEY\" \\${NC}"
echo -e "       ${DIM}  -F \"file=@test.dcm\"${NC}"
echo ""

if [ "$NODE_ENV" = "production" ]; then
    echo -e "  ${BOLD}Para Docker:${NC}"
    echo -e "    ${DIM}docker-compose up -d${NC}"
    echo ""
fi

echo -e "  ${BOLD}Para servicio en Linux:${NC}"
echo -e "    ${DIM}sudo cp andex-gateway.service /etc/systemd/system/${NC}"
echo -e "    ${DIM}sudo systemctl enable andex-gateway && sudo systemctl start andex-gateway${NC}"
echo ""

# Guardar resumen en archivo
SUMMARY_FILE="SETUP_$(echo "$CENTRO_ID" | tr '[:lower:]' '[:upper:]')_$(date +%Y%m%d).txt"
cat > "$SUMMARY_FILE" << SUMMARY
═══════════════════════════════════════════════
  ANDEX GATEWAY — Resumen de Instalación
  Fecha: $(date '+%Y-%m-%d %H:%M:%S')
═══════════════════════════════════════════════

Centro:           $CENTRO_NOMBRE
Centro ID:        $CENTRO_ID
PACS:             $PACS_TYPE → $PACS_BASE_URL
Auth:             $PACS_AUTH_TYPE
Puerto:           $PORT
Entorno:          $NODE_ENV
Worklist:         $WORKLIST_MODE

Dashboard:        http://localhost:$PORT
  Usuario:        $DASHBOARD_USER
  Contraseña:     $DASHBOARD_PASSWORD

API Key (completa):
  $API_KEY

Configurar en la PWA:
  Gateway URL:    http://<ip-servidor>:$PORT
  API Key:        $API_KEY

SUMMARY

if [ -n "$SUPABASE_URL" ]; then
    cat >> "$SUMMARY_FILE" << SUPA
Supabase:         $SUPABASE_URL
SUPA
fi

cat >> "$SUMMARY_FILE" << FOOTER

───────────────────────────────────────────────
⚠️  IMPORTANTE: Este archivo contiene credenciales.
    Guárdelo en un lugar seguro y no lo comparta
    por canales inseguros.
───────────────────────────────────────────────
FOOTER

ok "Resumen guardado en: $SUMMARY_FILE"
echo -e "  ${RED}${BOLD}⚠️  Guarde este archivo en un lugar seguro — contiene credenciales${NC}"
echo ""

# ─────────────────────────────────────────────────
# ENCADENAR CON PROVISIONING DE SUPABASE
# ─────────────────────────────────────────────────
if [ -n "$SUPABASE_URL" ] && [ -f "provision-supabase.sh" ]; then
    echo ""
    if confirm "¿Ejecutar provisioning de Supabase ahora? (crear centro + admin + box en la nube)" "s"; then
        echo ""
        exec ./provision-supabase.sh
    fi
fi
