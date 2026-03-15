#!/usr/bin/env bash
# ╔═══════════════════════════════════════════════════════════════╗
# ║   ANDEX GATEWAY — Supabase Provisioning para Nuevo Centro    ║
# ║                                                               ║
# ║   Crea el centro en Supabase, usuario admin, box, y          ║
# ║   configura pacs_config con los datos del Gateway.            ║
# ║                                                               ║
# ║   Prerequisitos:                                              ║
# ║     - .env configurado (ejecute setup.sh primero)             ║
# ║     - Supabase project existente con schema base              ║
# ║     - SUPABASE_URL y SUPABASE_SERVICE_KEY en .env             ║
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
NC='\033[0m'

ok()    { echo -e "${GREEN}  ✅ $1${NC}"; }
warn()  { echo -e "${YELLOW}  ⚠️  $1${NC}"; }
err()   { echo -e "${RED}  ❌ $1${NC}"; }
info()  { echo -e "${BLUE}  ℹ️  $1${NC}"; }
step()  { echo -e "\n${CYAN}${BOLD}━━━ $1 ━━━${NC}\n"; }
ask()   { echo -ne "${BOLD}  $1${NC}"; }

prompt() {
    local varname="$1" message="$2" default="${3:-}"
    if [ -n "$default" ]; then
        ask "$message [${DIM}$default${NC}${BOLD}]: "
    else
        ask "$message: "
    fi
    read -r input
    input="${input:-$default}"
    eval "$varname=\"\$input\""
}

confirm() {
    local message="$1" default="${2:-s}" hint="[S/n]"
    [ "$default" = "n" ] && hint="[s/N]"
    ask "$message $hint: "
    read -r answer
    answer="${answer:-$default}"
    [[ "$answer" =~ ^[sS]$ ]]
}

select_option() {
    local varname="$1" message="$2"
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
        warn "Opción inválida"
    done
}

# Ejecutar SQL contra Supabase REST API (postgrest)
supabase_sql() {
    local sql="$1"
    local result
    result=$(curl -s -X POST \
        "${SUPABASE_URL}/rest/v1/rpc/exec_sql" \
        -H "apikey: ${SUPABASE_SERVICE_KEY}" \
        -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" \
        -H "Content-Type: application/json" \
        -d "{\"query\": $(echo "$sql" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))')}" \
        2>/dev/null)
    echo "$result"
}

# Ejecutar query vía postgrest SELECT
supabase_get() {
    local table="$1" query="$2"
    curl -s -X GET \
        "${SUPABASE_URL}/rest/v1/${table}?${query}" \
        -H "apikey: ${SUPABASE_SERVICE_KEY}" \
        -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" \
        -H "Content-Type: application/json" \
        2>/dev/null
}

# INSERT via postgrest
supabase_insert() {
    local table="$1" data="$2"
    curl -s -X POST \
        "${SUPABASE_URL}/rest/v1/${table}" \
        -H "apikey: ${SUPABASE_SERVICE_KEY}" \
        -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" \
        -H "Content-Type: application/json" \
        -H "Prefer: return=representation" \
        -d "$data" \
        2>/dev/null
}

# UPDATE via postgrest
supabase_update() {
    local table="$1" query="$2" data="$3"
    curl -s -X PATCH \
        "${SUPABASE_URL}/rest/v1/${table}?${query}" \
        -H "apikey: ${SUPABASE_SERVICE_KEY}" \
        -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" \
        -H "Content-Type: application/json" \
        -H "Prefer: return=representation" \
        -d "$data" \
        2>/dev/null
}

# ─────────────────────────────────────────────────
# BANNER
# ─────────────────────────────────────────────────
clear
echo -e "${CYAN}${BOLD}"
cat << 'BANNER'

    ╔═══════════════════════════════════════════════╗
    ║                                               ║
    ║  🗄️  ANDEX GATEWAY — Supabase Provisioning   ║
    ║                                               ║
    ║  Crea centro + usuarios + box en Supabase     ║
    ║                                               ║
    ╚═══════════════════════════════════════════════╝

BANNER
echo -e "${NC}"

# ─────────────────────────────────────────────────
# CARGAR .env
# ─────────────────────────────────────────────────
step "Cargando configuración"

if [ ! -f .env ]; then
    err "No se encontró .env — ejecute ./setup.sh primero"
    exit 1
fi

# Cargar variables del .env
set -a
source .env
set +a

# Validar variables requeridas
MISSING=""
[ -z "${SUPABASE_URL:-}" ] && MISSING="SUPABASE_URL"
[ -z "${SUPABASE_SERVICE_KEY:-}" ] && MISSING="${MISSING:+$MISSING, }SUPABASE_SERVICE_KEY"
[ -z "${CENTRO_NOMBRE:-}" ] && MISSING="${MISSING:+$MISSING, }CENTRO_NOMBRE"
[ -z "${CENTRO_ID:-}" ] && MISSING="${MISSING:+$MISSING, }CENTRO_ID"

if [ -n "$MISSING" ]; then
    err "Variables faltantes en .env: $MISSING"
    echo -e "  ${DIM}Ejecute ./setup.sh para configurar, o edite .env manualmente${NC}"
    exit 1
fi

ok "CENTRO_NOMBRE: $CENTRO_NOMBRE"
ok "CENTRO_ID:     $CENTRO_ID"
ok "SUPABASE_URL:  $SUPABASE_URL"
ok "API_KEY:       ${API_KEY:0:16}..."

# ─────────────────────────────────────────────────
# TEST CONEXIÓN SUPABASE
# ─────────────────────────────────────────────────
step "Verificando conexión a Supabase"

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    "${SUPABASE_URL}/rest/v1/" \
    -H "apikey: ${SUPABASE_SERVICE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" \
    --connect-timeout 10 2>/dev/null || echo "000")

if [ "$HTTP_CODE" = "200" ]; then
    ok "Supabase responde correctamente (HTTP $HTTP_CODE)"
elif [ "$HTTP_CODE" = "000" ]; then
    err "No se pudo conectar a Supabase — verifique SUPABASE_URL"
    exit 1
else
    warn "Supabase respondió HTTP $HTTP_CODE — puede haber problemas"
    if ! confirm "¿Continuar de todas formas?" "n"; then
        exit 1
    fi
fi

# Verificar que la tabla centros existe
CENTROS_CHECK=$(curl -s -o /dev/null -w "%{http_code}" \
    "${SUPABASE_URL}/rest/v1/centros?select=id&limit=1" \
    -H "apikey: ${SUPABASE_SERVICE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" \
    --connect-timeout 10 2>/dev/null || echo "000")

if [ "$CENTROS_CHECK" = "200" ]; then
    ok "Tabla 'centros' accesible"
else
    err "No se pudo acceder a la tabla 'centros' (HTTP $CENTROS_CHECK)"
    echo -e "  ${DIM}Asegúrese de haber ejecutado las migraciones base del schema${NC}"
    exit 1
fi

# ─────────────────────────────────────────────────
# VERIFICAR SI EL CENTRO YA EXISTE
# ─────────────────────────────────────────────────
step "Verificando centro existente"

# Buscar por nombre (case-insensitive)
EXISTING=$(supabase_get "centros" "nombre=ilike.${CENTRO_NOMBRE// /%20}&select=id,nombre")

if echo "$EXISTING" | python3 -c "import sys,json; data=json.load(sys.stdin); exit(0 if len(data)>0 else 1)" 2>/dev/null; then
    EXISTING_ID=$(echo "$EXISTING" | python3 -c "import sys,json; data=json.load(sys.stdin); print(data[0]['id'])")
    EXISTING_NAME=$(echo "$EXISTING" | python3 -c "import sys,json; data=json.load(sys.stdin); print(data[0]['nombre'])")
    warn "Ya existe un centro con nombre similar: '$EXISTING_NAME' (ID: $EXISTING_ID)"
    
    if confirm "¿Usar el centro existente en vez de crear uno nuevo?" "s"; then
        USE_EXISTING=true
        CENTRO_UUID="$EXISTING_ID"
        ok "Usando centro existente: $EXISTING_NAME ($CENTRO_UUID)"
    else
        if ! confirm "¿Crear un centro NUEVO de todas formas?" "n"; then
            exit 0
        fi
        USE_EXISTING=false
    fi
else
    USE_EXISTING=false
    info "No se encontró centro existente — se creará uno nuevo"
fi

# ─────────────────────────────────────────────────
# DATOS DEL CENTRO
# ─────────────────────────────────────────────────
if [ "$USE_EXISTING" = false ]; then
    step "Datos del nuevo centro"
    
    prompt CENTRO_DIRECCION "Dirección del centro" ""
    prompt CENTRO_TELEFONO "Teléfono" ""
    prompt CENTRO_EMAIL "Email de contacto" ""
    prompt CENTRO_WEB "Sitio web" ""
    
    select_option PLAN_TYPE "Plan de suscripción:" \
        "trial (30 días gratis)" \
        "monthly (mensual)" \
        "annual (anual)" \
        "prepaid (prepago)"
    PLAN_TYPE=$(echo "$PLAN_TYPE" | cut -d' ' -f1)
    
    prompt MAX_BOXES "Máximo de boxes permitidos" "3"
fi

# ─────────────────────────────────────────────────
# USUARIO ADMIN
# ─────────────────────────────────────────────────
step "Usuario Administrador del Centro"

echo -e "  ${DIM}Este usuario será el administrador principal del centro en la PWA${NC}\n"

prompt ADMIN_EMAIL "Email del administrador" ""
prompt ADMIN_NOMBRE "Nombre completo" ""
prompt ADMIN_RUT "RUT (sin puntos, con guión)" ""

# ─────────────────────────────────────────────────
# BOX INICIAL
# ─────────────────────────────────────────────────
step "Box Inicial"

echo -e "  ${DIM}El box es la sala/equipo de endoscopia asignado al Gateway${NC}\n"

prompt BOX_NOMBRE "Nombre del box" "Endoscopia 1"
prompt BOX_SPECIALTY "Especialidad" "Endoscopia"
prompt BOX_LOCATION "Ubicación física" ""

# ─────────────────────────────────────────────────
# RESUMEN Y CONFIRMACIÓN
# ─────────────────────────────────────────────────
step "Resumen — Se creará lo siguiente en Supabase"

if [ "$USE_EXISTING" = false ]; then
    echo -e "  ${BOLD}🏥 Centro:${NC}"
    echo -e "      Nombre:     $CENTRO_NOMBRE"
    echo -e "      Dirección:  ${CENTRO_DIRECCION:-N/A}"
    echo -e "      Teléfono:   ${CENTRO_TELEFONO:-N/A}"
    echo -e "      Plan:       $PLAN_TYPE"
    echo -e "      Max boxes:  $MAX_BOXES"
fi

echo -e ""
echo -e "  ${BOLD}👤 Admin:${NC}"
echo -e "      Email:  $ADMIN_EMAIL"
echo -e "      Nombre: $ADMIN_NOMBRE"
echo -e "      RUT:    $ADMIN_RUT"

echo -e ""
echo -e "  ${BOLD}🖥️  Box:${NC}"
echo -e "      Nombre:       $BOX_NOMBRE"
echo -e "      Especialidad: $BOX_SPECIALTY"
echo -e "      Ubicación:    ${BOX_LOCATION:-N/A}"

echo -e ""
echo -e "  ${BOLD}⚙️  PACS Config (se guardará en centros.pacs_config):${NC}"
echo -e "      Gateway URL:  http://localhost:${PORT:-3001}"
echo -e "      API Key:      ${API_KEY:0:16}..."
echo -e "      Institution:  $CENTRO_NOMBRE"

echo ""
if ! confirm "¿Ejecutar provisioning?"; then
    echo -e "\n  Cancelado.\n"
    exit 0
fi

# ─────────────────────────────────────────────────
# EJECUTAR: CREAR CENTRO
# ─────────────────────────────────────────────────
echo ""

if [ "$USE_EXISTING" = false ]; then
    step "Creando centro en Supabase"
    
    # Construir JSON del centro
    CENTRO_JSON=$(python3 -c "
import json, sys
data = {
    'nombre': '$CENTRO_NOMBRE',
    'direccion': '${CENTRO_DIRECCION:-}',
    'telefono': '${CENTRO_TELEFONO:-}',
    'email': '${CENTRO_EMAIL:-}',
    'web': '${CENTRO_WEB:-}',
    'activo': True,
    'max_allowed_boxes': int('${MAX_BOXES:-3}'),
    'subscription_status': 'active',
    'plan_type': '$PLAN_TYPE',
    'subscription_start_date': __import__('datetime').datetime.now().isoformat(),
}
# Limpiar campos vacíos
data = {k:v for k,v in data.items() if v != '' and v is not None}
print(json.dumps(data))
")
    
    RESULT=$(supabase_insert "centros" "$CENTRO_JSON")
    
    # Extraer UUID del centro creado
    CENTRO_UUID=$(echo "$RESULT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    if isinstance(data, list):
        print(data[0]['id'])
    else:
        print(data['id'])
except Exception as e:
    print('ERROR:' + str(e), file=sys.stderr)
    sys.exit(1)
" 2>/dev/null)
    
    if [ -z "$CENTRO_UUID" ] || [[ "$CENTRO_UUID" == ERROR* ]]; then
        err "Error creando centro"
        echo -e "  ${DIM}Respuesta: $RESULT${NC}"
        exit 1
    fi
    
    ok "Centro creado: $CENTRO_UUID"
else
    info "Usando centro existente: $CENTRO_UUID"
fi

# ─────────────────────────────────────────────────
# EJECUTAR: CREAR USUARIO ADMIN
# ─────────────────────────────────────────────────
step "Creando usuario administrador"

# Verificar si el usuario ya existe
EXISTING_USER=$(supabase_get "usuarios" "email=eq.${ADMIN_EMAIL}&select=id,nombre,centro_id")

USER_EXISTS=false
if echo "$EXISTING_USER" | python3 -c "import sys,json; data=json.load(sys.stdin); exit(0 if len(data)>0 else 1)" 2>/dev/null; then
    ADMIN_UUID=$(echo "$EXISTING_USER" | python3 -c "import sys,json; data=json.load(sys.stdin); print(data[0]['id'])")
    warn "Usuario ya existe: $ADMIN_EMAIL (ID: $ADMIN_UUID)"
    USER_EXISTS=true
    
    # Actualizar centro_id si no tiene
    CURRENT_CENTRO=$(echo "$EXISTING_USER" | python3 -c "import sys,json; data=json.load(sys.stdin); print(data[0].get('centro_id') or '')")
    if [ -z "$CURRENT_CENTRO" ]; then
        supabase_update "usuarios" "id=eq.$ADMIN_UUID" "{\"centro_id\": \"$CENTRO_UUID\", \"perfil\": \"administrador\"}" > /dev/null
        ok "Actualizado centro_id del usuario existente"
    fi
fi

if [ "$USER_EXISTS" = false ]; then
    # Crear usuario en tabla usuarios (sin auth.users — eso lo hace el registro en la PWA)
    USER_JSON=$(python3 -c "
import json
data = {
    'email': '$ADMIN_EMAIL',
    'nombre': '$ADMIN_NOMBRE',
    'rut': '$ADMIN_RUT',
    'perfil': 'administrador',
    'centro_id': '$CENTRO_UUID',
    'activo': True,
    'validado': True,
    'auth_provider': 'email'
}
print(json.dumps(data))
")
    
    USER_RESULT=$(supabase_insert "usuarios" "$USER_JSON")
    
    ADMIN_UUID=$(echo "$USER_RESULT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    if isinstance(data, list):
        print(data[0]['id'])
    else:
        print(data['id'])
except:
    sys.exit(1)
" 2>/dev/null)
    
    if [ -z "$ADMIN_UUID" ]; then
        warn "No se pudo crear usuario pre-registrado (puede requerir registro vía PWA)"
        info "El usuario deberá registrarse en la PWA con email: $ADMIN_EMAIL"
        ADMIN_UUID="pending-registration"
    else
        ok "Usuario admin creado: $ADMIN_UUID"
    fi
fi

# ─────────────────────────────────────────────────
# EJECUTAR: ORGANIZATION MEMBER
# ─────────────────────────────────────────────────
if [ "$ADMIN_UUID" != "pending-registration" ]; then
    step "Vinculando usuario al centro (organization_members)"
    
    OM_JSON=$(python3 -c "
import json
data = {
    'user_id': '$ADMIN_UUID',
    'centro_id': '$CENTRO_UUID',
    'role': 'owner',
    'is_default': True
}
print(json.dumps(data))
")
    
    OM_RESULT=$(supabase_insert "organization_members" "$OM_JSON")
    
    if echo "$OM_RESULT" | python3 -c "import sys,json; data=json.load(sys.stdin); exit(0 if (isinstance(data,list) and len(data)>0) or 'id' in data else 1)" 2>/dev/null; then
        ok "Organization member creado (role: owner)"
    else
        # Puede ya existir
        if echo "$OM_RESULT" | grep -qi "duplicate\|unique\|conflict\|23505" 2>/dev/null; then
            warn "Membresía ya existe — actualizando role"
            supabase_update "organization_members" "user_id=eq.${ADMIN_UUID}&centro_id=eq.${CENTRO_UUID}" '{"role": "owner", "is_default": true}' > /dev/null
            ok "Role actualizado a owner"
        else
            warn "No se pudo crear membresía: $(echo "$OM_RESULT" | head -c 200)"
        fi
    fi
fi

# ─────────────────────────────────────────────────
# EJECUTAR: CREAR BOX
# ─────────────────────────────────────────────────
step "Creando box"

BOX_JSON=$(python3 -c "
import json
data = {
    'centro_id': '$CENTRO_UUID',
    'nombre': '$BOX_NOMBRE',
    'specialty': '${BOX_SPECIALTY:-}',
    'location': '${BOX_LOCATION:-}',
    'activo': True,
    'color': '#4F46E5',
    'orden': 1
}
data = {k:v for k,v in data.items() if v != ''}
print(json.dumps(data))
")

BOX_RESULT=$(supabase_insert "boxes" "$BOX_JSON")

BOX_UUID=$(echo "$BOX_RESULT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    if isinstance(data, list):
        print(data[0]['id'])
    else:
        print(data['id'])
except:
    sys.exit(1)
" 2>/dev/null)

if [ -z "$BOX_UUID" ]; then
    # Puede ya existir
    EXISTING_BOX=$(supabase_get "boxes" "centro_id=eq.${CENTRO_UUID}&nombre=eq.${BOX_NOMBRE// /%20}&select=id")
    BOX_UUID=$(echo "$EXISTING_BOX" | python3 -c "import sys,json; data=json.load(sys.stdin); print(data[0]['id'] if len(data)>0 else '')" 2>/dev/null)
    
    if [ -n "$BOX_UUID" ]; then
        warn "Box ya existía: $BOX_UUID"
    else
        warn "No se pudo crear box: $(echo "$BOX_RESULT" | head -c 200)"
        BOX_UUID="manual"
    fi
else
    ok "Box creado: $BOX_UUID"
fi

# ─────────────────────────────────────────────────
# EJECUTAR: CONFIGURAR pacs_config
# ─────────────────────────────────────────────────
step "Configurando pacs_config en el centro"

GATEWAY_URL="http://localhost:${PORT:-3001}"
echo -e "  ${DIM}Se guardará la configuración PACS en centros.pacs_config${NC}"
echo ""
prompt GATEWAY_URL "URL del Gateway (como la verá la PWA)" "$GATEWAY_URL"

PACS_CONFIG_JSON=$(python3 -c "
import json
config = {
    'useGateway': True,
    'gatewayUrl': '$GATEWAY_URL',
    'gatewayApiKey': '${API_KEY}',
    'institutionName': '$CENTRO_NOMBRE',
    'stationName': '${BOX_NOMBRE}',
    'department': '${BOX_SPECIALTY:-Endoscopia}',
    'exportToStorage': False,
    'exportDownload': False
}
print(json.dumps(config))
")

# Actualizar centros con pacs_config
UPDATE_RESULT=$(supabase_update "centros" "id=eq.${CENTRO_UUID}" "{\"pacs_config\": $PACS_CONFIG_JSON}")

if echo "$UPDATE_RESULT" | python3 -c "import sys,json; data=json.load(sys.stdin); exit(0 if (isinstance(data,list) and len(data)>0) else 1)" 2>/dev/null; then
    ok "pacs_config guardado en centro $CENTRO_UUID"
else
    warn "No se pudo actualizar pacs_config — puede requerir migración 20260315"
    echo -e "  ${DIM}Ejecute la migración: supabase-migrations/20260315_pacs_config_por_centro.sql${NC}"
fi

# ─────────────────────────────────────────────────
# ACTUALIZAR .env CON IDs REALES
# ─────────────────────────────────────────────────
step "Actualizando .env con IDs de Supabase"

# Actualizar WORKLIST_DEFAULT_CENTRO_ID
if grep -q "^WORKLIST_DEFAULT_CENTRO_ID=" .env; then
    sed -i.bak "s|^WORKLIST_DEFAULT_CENTRO_ID=.*|WORKLIST_DEFAULT_CENTRO_ID=$CENTRO_UUID|" .env
    ok "WORKLIST_DEFAULT_CENTRO_ID=$CENTRO_UUID"
fi

# Actualizar WORKLIST_DEFAULT_BOX_ID
if [ -n "$BOX_UUID" ] && [ "$BOX_UUID" != "manual" ]; then
    if grep -q "^WORKLIST_DEFAULT_BOX_ID=" .env; then
        sed -i.bak "s|^WORKLIST_DEFAULT_BOX_ID=.*|WORKLIST_DEFAULT_BOX_ID=$BOX_UUID|" .env
        ok "WORKLIST_DEFAULT_BOX_ID=$BOX_UUID"
    fi
fi

# Limpiar backup de sed
rm -f .env.bak

ok ".env actualizado con IDs reales"

# ─────────────────────────────────────────────────
# EJECUTAR MIGRACIONES PACS (si no están)
# ─────────────────────────────────────────────────
step "Verificando migraciones PACS"

MIGRATIONS_DIR="../PWA-ANDEX-NAVAL/supabase-migrations"
if [ ! -d "$MIGRATIONS_DIR" ]; then
    MIGRATIONS_DIR="$(dirname "$0")/../PWA-ANDEX-NAVAL/supabase-migrations"
fi

echo -e "  ${DIM}Verificando que las migraciones del Gateway estén aplicadas...${NC}\n"

# Verificar pacs_config column
PACS_COL_CHECK=$(supabase_get "centros" "id=eq.${CENTRO_UUID}&select=pacs_config")
if echo "$PACS_COL_CHECK" | grep -q "pacs_config\|useGateway" 2>/dev/null; then
    ok "Columna pacs_config existe"
else
    warn "Columna pacs_config puede no existir — ejecute migración 20260315"
    echo -e "  ${DIM}SQL: ALTER TABLE centros ADD COLUMN IF NOT EXISTS pacs_config JSONB DEFAULT NULL;${NC}"
fi

# Verificar tabla pacs_physicians
PHYSICIANS_CHECK=$(curl -s -o /dev/null -w "%{http_code}" \
    "${SUPABASE_URL}/rest/v1/pacs_physicians?select=id&limit=1" \
    -H "apikey: ${SUPABASE_SERVICE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" \
    --connect-timeout 5 2>/dev/null || echo "000")

if [ "$PHYSICIANS_CHECK" = "200" ]; then
    ok "Tabla pacs_physicians existe"
else
    warn "Tabla pacs_physicians no encontrada — ejecute migración 20260314"
fi

# Verificar columnas de sync en agenda
AGENDA_CHECK=$(supabase_get "agenda" "select=accession_number&limit=1" 2>/dev/null)
if echo "$AGENDA_CHECK" | grep -q "accession_number\|\[\]" 2>/dev/null; then
    ok "Columnas de sync en agenda existen"
else
    warn "Columnas de sync pueden faltar — ejecute migración 20260313"
fi

# ─────────────────────────────────────────────────
# GENERAR SQL DE MIGRACIONES PENDIENTES
# ─────────────────────────────────────────────────
PENDING_SQL="pending_migrations.sql"

cat > "$PENDING_SQL" << 'SQLEOF'
-- =====================================================
-- MIGRACIONES PENDIENTES PARA GATEWAY
-- Ejecute en Supabase SQL Editor si alguna verificación falló
-- =====================================================

-- 1. Columna pacs_config en centros
ALTER TABLE centros ADD COLUMN IF NOT EXISTS pacs_config JSONB DEFAULT NULL;
COMMENT ON COLUMN centros.pacs_config IS 'Configuracion del Gateway PACS';
CREATE INDEX IF NOT EXISTS idx_centros_pacs_config 
ON centros USING gin(pacs_config) WHERE pacs_config IS NOT NULL;

-- 2. Tabla pacs_physicians
CREATE TABLE IF NOT EXISTS pacs_physicians (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  centro_id UUID NOT NULL REFERENCES centros(id) ON DELETE CASCADE,
  pacs_name TEXT NOT NULL,
  usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  estado TEXT NOT NULL DEFAULT 'sin_mapear' 
    CHECK (estado IN ('sin_mapear', 'mapeado', 'conflicto')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  mapped_at TIMESTAMPTZ,
  mapped_by UUID REFERENCES usuarios(id),
  UNIQUE(centro_id, pacs_name)
);
ALTER TABLE pacs_physicians ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_pacs_physicians_centro ON pacs_physicians(centro_id);

-- 3. Columnas de sync en agenda
ALTER TABLE agenda ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'manual';
ALTER TABLE agenda ADD COLUMN IF NOT EXISTS accession_number VARCHAR(64);
ALTER TABLE agenda ADD COLUMN IF NOT EXISTS pacs_synced_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_agenda_accession_number ON agenda(accession_number) WHERE accession_number IS NOT NULL;

-- 4. Columna source en pacientes
ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'manual';
CREATE INDEX IF NOT EXISTS idx_pacientes_source ON pacientes(source);

-- 5. Subtitulo unidad en centros
ALTER TABLE centros ADD COLUMN IF NOT EXISTS subtitulo_unidad TEXT;
SQLEOF

info "SQL de migraciones guardado en: $PENDING_SQL"

# ─────────────────────────────────────────────────
# RESUMEN FINAL
# ─────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}"
cat << 'DONE'
    ╔═══════════════════════════════════════════════╗
    ║                                               ║
    ║  ✅  PROVISIONING COMPLETADO                 ║
    ║                                               ║
    ╚═══════════════════════════════════════════════╝
DONE
echo -e "${NC}"

echo -e "  ${BOLD}Recursos creados en Supabase:${NC}\n"
echo -e "    🏥 Centro:    $CENTRO_NOMBRE"
echo -e "       UUID:      ${CYAN}$CENTRO_UUID${NC}"
echo -e ""
if [ "$ADMIN_UUID" != "pending-registration" ]; then
    echo -e "    👤 Admin:     $ADMIN_NOMBRE ($ADMIN_EMAIL)"
    echo -e "       UUID:      ${CYAN}$ADMIN_UUID${NC}"
else
    echo -e "    👤 Admin:     Pendiente registro en PWA ($ADMIN_EMAIL)"
fi
echo -e ""
if [ "$BOX_UUID" != "manual" ]; then
    echo -e "    🖥️  Box:       $BOX_NOMBRE"
    echo -e "       UUID:      ${CYAN}$BOX_UUID${NC}"
else
    echo -e "    🖥️  Box:       Crear manualmente desde la PWA"
fi
echo -e ""
echo -e "    ⚙️  PACS:      Gateway configurado en pacs_config"
echo -e "       URL:       $GATEWAY_URL"

echo -e "\n  ${BOLD}IDs actualizados en .env:${NC}"
echo -e "    WORKLIST_DEFAULT_CENTRO_ID=$CENTRO_UUID"
if [ "$BOX_UUID" != "manual" ]; then
    echo -e "    WORKLIST_DEFAULT_BOX_ID=$BOX_UUID"
fi

echo -e "\n  ${BOLD}Próximos pasos:${NC}\n"
echo -e "    ${CYAN}1.${NC} Si hubo migraciones pendientes, ejecutar:"
echo -e "       ${DIM}Copie pending_migrations.sql al SQL Editor de Supabase${NC}"
echo -e ""
echo -e "    ${CYAN}2.${NC} El admin debe registrarse en la PWA con:"
echo -e "       ${DIM}Email: $ADMIN_EMAIL${NC}"
echo -e ""
echo -e "    ${CYAN}3.${NC} Iniciar el Gateway:"
echo -e "       ${DIM}npm start${NC}"
echo -e ""
echo -e "    ${CYAN}4.${NC} Abrir la PWA → Configuración → PACS/DICOM"
echo -e "       ${DIM}Los datos ya deberían cargarse automáticamente desde Supabase${NC}"
echo ""

# Guardar resumen
PROVISION_LOG="PROVISION_$(echo "$CENTRO_ID" | tr '[:lower:]' '[:upper:]')_$(date +%Y%m%d).txt"
cat > "$PROVISION_LOG" << LOGEOF
ANDEX GATEWAY — Provisioning Log
Fecha: $(date '+%Y-%m-%d %H:%M:%S')
═══════════════════════════════════════

Centro:       $CENTRO_NOMBRE
Centro UUID:  $CENTRO_UUID
Admin:        $ADMIN_NOMBRE ($ADMIN_EMAIL)
Admin UUID:   $ADMIN_UUID
Box:          $BOX_NOMBRE
Box UUID:     $BOX_UUID

Gateway URL:  $GATEWAY_URL
API Key:      $API_KEY

PACS Config (centros.pacs_config):
$PACS_CONFIG_JSON

.env updates:
  WORKLIST_DEFAULT_CENTRO_ID=$CENTRO_UUID
  WORKLIST_DEFAULT_BOX_ID=$BOX_UUID

═══════════════════════════════════════
LOGEOF

ok "Log guardado en: $PROVISION_LOG"
echo -e "  ${RED}${BOLD}⚠️  Contiene credenciales — guardar en lugar seguro${NC}\n"
