# Andex Gateway - Documentación Completa

> **Versión:** 1.0.0  
> **Última actualización:** 15 de marzo de 2026  
> **Autor:** Andex Medical

---

## Tabla de Contenidos

1. [Introducción](#1-introducción)
2. [Arquitectura del Sistema](#2-arquitectura-del-sistema)
3. [Componentes Principales](#3-componentes-principales)
4. [Flujo de Datos](#4-flujo-de-datos)
5. [Instalación y Requisitos](#5-instalación-y-requisitos)
6. [Configuración](#6-configuración)
7. [Integración con PACS](#7-integración-con-pacs)
8. [Sincronización con Supabase](#8-sincronización-con-supabase)
9. [Sistema de Mapeo de Médicos](#9-sistema-de-mapeo-de-médicos)
10. [Sistema de Mapeo de Procedimientos](#10-sistema-de-mapeo-de-procedimientos)
11. [API REST](#11-api-rest)
12. [Dashboard de Monitoreo](#12-dashboard-de-monitoreo)
13. [Despliegue en Producción](#13-despliegue-en-producción)
14. [Troubleshooting](#14-troubleshooting)
15. [Seguridad](#15-seguridad)
16. [Apéndices](#16-apéndices)

---

## 1. Introducción

### ¿Qué es Andex Gateway?

Andex Gateway es un middleware que actúa como puente entre sistemas PACS (Picture Archiving and Communication System) hospitalarios y la PWA de Andex Reports. Su función principal es:

- **Recibir imágenes DICOM** desde equipos médicos (endoscopios, colonoscopios, etc.)
- **Consultar Modality Worklist (MWL)** para obtener la agenda de procedimientos
- **Sincronizar datos** con Supabase (agenda, pacientes, médicos)
- **Mapear información** entre formatos PACS y formatos PWA

### Casos de Uso

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Endoscopio    │────▶│  Andex Gateway  │────▶│   PWA Andex     │
│   (DICOM)       │     │   (Middleware)  │     │   Reports       │
└─────────────────┘     └─────────────────┘     └─────────────────┘
         │                       │                       │
         │                       ▼                       │
         │              ┌─────────────────┐              │
         └─────────────▶│   PACS Server   │◀─────────────┘
                        │   (Synapse 7)   │
                        └─────────────────┘
```

### Beneficios

| Beneficio | Descripción |
|-----------|-------------|
| **Automatización** | Sincroniza agenda automáticamente desde el PACS |
| **Interoperabilidad** | Compatible con Synapse 7, Orthanc, y otros PACS DICOMweb |
| **Offline-First** | Cola de reintentos para operaciones fallidas |
| **Multi-tenant** | Soporta múltiples centros médicos |

---

## 2. Arquitectura del Sistema

### Diagrama de Arquitectura

```
                                    HOSPITAL
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐                    │
│  │Endoscopio│   │Colonosc. │   │  RIS/HIS │                    │
│  └────┬─────┘   └────┬─────┘   └────┬─────┘                    │
│       │              │              │                           │
│       └──────────────┼──────────────┘                           │
│                      │                                          │
│                      ▼                                          │
│            ┌─────────────────┐                                  │
│            │   PACS Server   │                                  │
│            │   (Synapse 7)   │                                  │
│            │                 │                                  │
│            │ • DICOM Storage │                                  │
│            │ • Worklist MWL  │                                  │
│            │ • DICOMweb API  │                                  │
│            └────────┬────────┘                                  │
│                     │                                           │
└─────────────────────┼───────────────────────────────────────────┘
                      │
                      │ DICOMweb / REST
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                    ANDEX GATEWAY                                │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                     Fastify Server                       │   │
│  │                     (Port 3001)                          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │  Worklist   │  │    Sync     │  │   DICOM     │             │
│  │  Polling    │  │   Service   │  │   Receiver  │             │
│  │  Service    │  │             │  │   (DIMSE)   │             │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘             │
│         │                │                │                     │
│         └────────────────┼────────────────┘                     │
│                          │                                      │
│                          ▼                                      │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   SQLite Database                        │   │
│  │  • Jobs Queue (retry failed operations)                  │   │
│  │  • Local Cache                                           │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────┬───────────────────────────────┘
                                  │
                                  │ HTTPS REST API
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                         SUPABASE                                │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │   agenda    │  │  pacientes  │  │  usuarios   │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │pacs_physic. │  │   centros   │  │   boxes     │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
└─────────────────────────────────────────────────────────────────┘
                                  │
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                      PWA ANDEX REPORTS                          │
│                    (andexcloud.cl)                              │
└─────────────────────────────────────────────────────────────────┘
```

### Stack Tecnológico

| Componente | Tecnología |
|------------|------------|
| Runtime | Node.js 18+ |
| Lenguaje | TypeScript 5.x |
| Framework HTTP | Fastify 4.x |
| Base de datos local | better-sqlite3 |
| Cliente PACS | DICOMweb (QIDO-RS, WADO-RS, UPS-RS) |
| Cliente Supabase | @supabase/supabase-js |

---

## 3. Componentes Principales

### 3.1 Worklist Polling Service

**Archivo:** `src/services/worklist-polling.service.ts`

Consulta periódicamente el Modality Worklist del PACS para obtener la agenda de procedimientos programados.

```typescript
// Configuración
WORKLIST_SYNC_ENABLED=true
WORKLIST_SYNC_INTERVAL=30000  // 30 segundos
WORKLIST_SYNC_MODE=mock|live  // mock para testing, live para producción
```

**Funcionamiento:**

1. Cada N segundos, consulta el PACS por worklist del día actual
2. Para cada item del worklist:
   - Extrae RUT del paciente
   - Busca/crea el paciente en Supabase
   - Resuelve el médico asignado
   - Mapea el tipo de procedimiento
   - Crea/actualiza la cita en agenda

### 3.2 Sync Service

**Archivo:** `src/services/sync.service.ts`

Orquesta la sincronización entre PACS y Supabase.

```typescript
interface SyncResult {
  success: boolean;
  created: number;   // Nuevas citas creadas
  updated: number;   // Citas actualizadas
  cancelled: number; // Citas canceladas
  errors: string[];  // Errores encontrados
}
```

### 3.3 PACS Physician Service

**Archivo:** `src/services/pacs-physician.service.ts`

Gestiona el mapeo entre nombres de médicos del PACS y usuarios de la PWA.

```typescript
// Tabla: pacs_physicians
{
  id: uuid,
  centro_id: uuid,
  pacs_name: "DR. GALLARDO VILLALOBOS^ALVARO",
  usuario_id: uuid | null,  // null = pendiente de mapear
  estado: "pendiente" | "mapeado" | "ignorado",
  created_at: timestamp
}
```

### 3.4 Procedure Mapping Service

**Archivo:** `src/services/procedure-mapping.service.ts`

Mapea nombres de procedimientos del PACS a tipos estándar de la PWA.

```typescript
// Procedimientos válidos en la PWA
const VALID_PROCEDURES = [
  'Endoscopia Digestiva Alta',
  'Colonoscopia',
  'Nasofibroscopía',
  'Cistoscopia',
  'Biopsia de Próstata',
  'Gastrostomía',
  'Cistostomía',
  'ERCP',
  'EUS',
  'EBUS'
];
```

### 3.5 RUT Service

**Archivo:** `src/services/rut.service.ts`

Extrae y valida RUTs chilenos desde el campo PatientID del DICOM.

```typescript
// Ejemplos de extracción:
"10448495-6"     → "10448495-6" ✓
"10.448.495-6"   → "10448495-6" ✓
"104484956"      → "10448495-6" ✓
"689570"         → null (muy corto, no es RUT)
```

### 3.6 Jobs Queue

**Archivo:** `src/db/database.ts`

Sistema de cola para reintentar operaciones fallidas.

```sql
CREATE TABLE jobs (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL,           -- 'sync_agenda', 'send_dicom', etc.
  payload TEXT NOT NULL,        -- JSON con datos
  status TEXT DEFAULT 'pending', -- pending, processing, completed, failed
  retries INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  error TEXT,
  created_at TEXT,
  updated_at TEXT
);
```

---

## 4. Flujo de Datos

### 4.1 Flujo de Worklist a Agenda

```
┌─────────────┐
│  PACS MWL   │
│  (Worklist) │
└──────┬──────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│                    WORKLIST ITEM                             │
│  {                                                           │
│    accessionNumber: "ACC20260315001",                        │
│    patientID: "12345678-9",                                  │
│    patientName: "PEREZ^JUAN",                                │
│    scheduledDateTime: "20260315120000",                      │
│    scheduledProcedureDescription: "ENDOSCOPIA DIGESTIVA",    │
│    referringPhysicianName: "DR. GALLARDO^ALVARO",            │
│    modality: "ES"                                            │
│  }                                                           │
└──────────────────────────────────────────────────────────────┘
       │
       │ 1. Extraer RUT
       ▼
┌──────────────────────────────────────────────────────────────┐
│  extractRutFromPatientId("12345678-9") → "12345678-9"        │
└──────────────────────────────────────────────────────────────┘
       │
       │ 2. Buscar/Crear Paciente
       ▼
┌──────────────────────────────────────────────────────────────┐
│  Supabase: pacientes                                         │
│  {                                                           │
│    id: "uuid-xxx",                                           │
│    rut: "12345678-9",                                        │
│    nombre: "Juan Pérez",                                     │
│    source: "pacs"                                            │
│  }                                                           │
└──────────────────────────────────────────────────────────────┘
       │
       │ 3. Resolver Médico
       ▼
┌──────────────────────────────────────────────────────────────┐
│  pacs_physicians:                                            │
│  "DR. GALLARDO^ALVARO" → usuario_id: "uuid-medico"           │
│                                                              │
│  Filtros aplicados:                                          │
│  - "UNKNOWN^UNKNOWN" → ignorado                              │
│  - "TECNOLOGO" → ignorado                                    │
└──────────────────────────────────────────────────────────────┘
       │
       │ 4. Mapear Procedimiento
       ▼
┌──────────────────────────────────────────────────────────────┐
│  mapProcedure("ENDOSCOPIA DIGESTIVA")                        │
│  → "Endoscopia Digestiva Alta"                               │
└──────────────────────────────────────────────────────────────┘
       │
       │ 5. Crear/Actualizar Agenda
       ▼
┌──────────────────────────────────────────────────────────────┐
│  Supabase: agenda                                            │
│  {                                                           │
│    id: "uuid-cita",                                          │
│    paciente_id: "uuid-xxx",                                  │
│    medico_id: "uuid-medico",                                 │
│    fecha: "2026-03-15",                                      │
│    hora: "12:00",                                            │
│    procedimiento: "Endoscopia Digestiva Alta",               │
│    accession_number: "ACC20260315001",                       │
│    source: "pacs",                                           │
│    pacs_synced_at: "2026-03-15T10:00:00Z"                    │
│  }                                                           │
└──────────────────────────────────────────────────────────────┘
```

### 4.2 Flujo de Recepción DICOM (Futuro)

```
┌─────────────┐
│ Endoscopio  │
│   DICOM     │
└──────┬──────┘
       │ C-STORE
       ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Gateway   │────▶│    PACS     │────▶│  Supabase   │
│   (DIMSE)   │     │   Storage   │     │   Storage   │
└─────────────┘     └─────────────┘     └─────────────┘
```

---

## 5. Instalación y Requisitos

### Requisitos del Sistema

| Componente | Mínimo | Recomendado |
|------------|--------|-------------|
| Node.js | 18.x | 20.x LTS |
| RAM | 512 MB | 2 GB |
| Disco | 1 GB | 10 GB |
| Sistema Operativo | Windows 10+, Ubuntu 20.04+, macOS 12+ | Ubuntu 22.04 LTS |

### Instalación

```bash
# 1. Clonar repositorio
git clone https://github.com/agallardov-ai/andex-gateway.git
cd andex-gateway

# 2. Instalar dependencias
npm install

# 3. Crear archivo de configuración
cp .env.example .env

# 4. Editar configuración
nano .env

# 5. Compilar TypeScript
npm run build

# 6. Iniciar
npm start
```

### Verificar Instalación

```bash
# El Gateway debe mostrar:
╔═══════════════════════════════════════╗
║         ANDEX GATEWAY v1.0.0          ║
╚═══════════════════════════════════════╝

✅ Database loaded: ./data/gateway.db
✅ Storage ready
📋 Rutas Worklist registradas: /api/worklist/*
🔄 Starting retry worker (interval: 5000ms)
🧹 Starting cleanup worker (interval: 1 hour)
📋 Supabase client initialized
📋 Starting worklist polling (interval: 30s)

    🏥 Centro: Hospital Naval Talcahuano
    🌐 Server: http://localhost:3001
    🔌 PACS: http://pacs.hospital.cl:8042
    
    Ready to receive DICOM files!

# Verificar health
curl http://localhost:3001/health
```

---

## 6. Configuración

### Archivo .env Completo

```bash
# ╔═══════════════════════════════════════════════════════════════╗
# ║                    ANDEX GATEWAY CONFIG                       ║
# ╚═══════════════════════════════════════════════════════════════╝

# ===== SERVIDOR =====
PORT=3001
HOST=0.0.0.0
NODE_ENV=production

# ===== API KEY =====
# Clave para autenticar requests a la API del Gateway
API_KEY=tu-api-key-segura-aqui

# ===== CENTRO MÉDICO =====
# UUID del centro en Supabase (tabla: centros)
DEFAULT_CENTRO_ID=uuid-del-centro

# UUID del box/sala por defecto (tabla: boxes)
DEFAULT_BOX_ID=uuid-del-box

# Nombre del centro (para logs y dashboard)
CENTRO_NAME=Hospital Naval Talcahuano

# ===== PACS =====
# URL base del servidor PACS
PACS_URL=http://192.168.1.100:8042

# Tipo de autenticación: none, basic, bearer
PACS_AUTH_TYPE=basic

# Credenciales (para basic auth)
PACS_USERNAME=orthanc
PACS_PASSWORD=orthanc

# Token (para bearer auth)
# PACS_TOKEN=eyJhbGc...

# AE Title del Gateway (para DIMSE)
GATEWAY_AE_TITLE=ANDEX_GW

# ===== SUPABASE =====
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGc...tu-service-role-key

# ===== WORKLIST SYNC =====
# Habilitar sincronización automática
WORKLIST_SYNC_ENABLED=true

# Intervalo de polling en milisegundos
WORKLIST_SYNC_INTERVAL=30000

# Modo: mock (datos de prueba) o live (PACS real)
WORKLIST_SYNC_MODE=live

# Paths DICOMweb (ajustar según PACS)
WORKLIST_UPS_PATH=/workitems
WORKLIST_QIDO_MWL_PATH=/modalities/ANDEX/query

# Preferir UPS-RS sobre QIDO-RS
WORKLIST_PREFER_UPS=false

# ===== STORAGE =====
# Directorio para almacenar DICOMs temporalmente
STORAGE_PATH=./data/dicom

# Directorio para base de datos SQLite
DATA_PATH=./data

# ===== LOGGING =====
LOG_LEVEL=info
LOG_FORMAT=json

# ===== REINTENTOS =====
RETRY_INTERVAL=5000
RETRY_MAX_ATTEMPTS=3
```

### Configuración por Tipo de PACS

#### FUJIFILM Synapse 7

```bash
PACS_URL=https://synapse.hospital.cl
PACS_AUTH_TYPE=basic
PACS_USERNAME=synapse_user
PACS_PASSWORD=synapse_pass
WORKLIST_QIDO_MWL_PATH=/dicomweb/mwlitems
WORKLIST_PREFER_UPS=false
```

#### Orthanc (Testing/Desarrollo)

```bash
PACS_URL=http://localhost:8042
PACS_AUTH_TYPE=basic
PACS_USERNAME=orthanc
PACS_PASSWORD=orthanc
WORKLIST_QIDO_MWL_PATH=/modalities/ANDEX/query
WORKLIST_PREFER_UPS=false
```

#### DCM4CHEE

```bash
PACS_URL=http://dcm4chee.hospital.cl:8080
PACS_AUTH_TYPE=bearer
PACS_TOKEN=eyJhbGc...
WORKLIST_QIDO_MWL_PATH=/dcm4chee-arc/aets/DCM4CHEE/rs/mwlitems
WORKLIST_PREFER_UPS=true
```

---

## 7. Integración con PACS

### 7.1 Modality Worklist (MWL)

El Gateway consulta el Modality Worklist para obtener la agenda de procedimientos.

#### Tags DICOM Utilizados

| Tag | Nombre | Uso |
|-----|--------|-----|
| (0010,0020) | Patient ID | Extraer RUT del paciente |
| (0010,0010) | Patient Name | Nombre del paciente |
| (0010,0030) | Patient Birth Date | Fecha de nacimiento |
| (0010,0040) | Patient Sex | Sexo |
| (0008,0050) | Accession Number | ID único de la cita |
| (0040,0002) | Scheduled Procedure Step Start Date | Fecha programada |
| (0040,0003) | Scheduled Procedure Step Start Time | Hora programada |
| (0040,0007) | Scheduled Procedure Step Description | Tipo de procedimiento |
| (0032,1060) | Requested Procedure Description | Descripción alternativa |
| (0008,0090) | Referring Physician Name | Médico solicitante |
| (0040,0006) | Scheduled Performing Physician Name | Médico ejecutante |
| (0008,0060) | Modality | Modalidad (ES = Endoscopy) |
| (0008,0080) | Institution Name | Nombre del hospital |

#### Ejemplo de Respuesta MWL (DICOM JSON)

```json
[
  {
    "00080050": { "vr": "SH", "Value": ["ACC20260315001"] },
    "00100020": { "vr": "LO", "Value": ["12345678-9"] },
    "00100010": { 
      "vr": "PN", 
      "Value": [{ "Alphabetic": "PEREZ GONZALEZ^JUAN CARLOS" }]
    },
    "00400100": {
      "vr": "SQ",
      "Value": [{
        "00400002": { "vr": "DA", "Value": ["20260315"] },
        "00400003": { "vr": "TM", "Value": ["120000"] },
        "00400007": { "vr": "LO", "Value": ["ENDOSCOPIA DIGESTIVA ALTA"] },
        "00400006": {
          "vr": "PN",
          "Value": [{ "Alphabetic": "DR. GALLARDO VILLALOBOS^ALVARO" }]
        },
        "00080060": { "vr": "CS", "Value": ["ES"] }
      }]
    },
    "00080090": {
      "vr": "PN",
      "Value": [{ "Alphabetic": "DR. GALLARDO VILLALOBOS^ALVARO" }]
    }
  }
]
```

### 7.2 Configuración en Synapse 7

Para que Synapse 7 exponga el worklist via DICOMweb:

1. **Acceder a la consola de administración de Synapse**
2. **Configurar DICOMweb Gateway:**
   - Habilitar QIDO-RS
   - Configurar endpoint `/mwlitems`
3. **Crear usuario de integración:**
   - Usuario: `andex_gateway`
   - Permisos: Query, Read
4. **Configurar filtro de modalidad:**
   - Modalidades: ES, OT (Endoscopy, Other)

### 7.3 Configuración en Orthanc (Testing)

```json
// orthanc.json
{
  "Name": "Orthanc",
  "DicomAet": "ORTHANC",
  "DicomPort": 4242,
  "HttpPort": 8042,
  "RegisteredUsers": {
    "orthanc": "orthanc"
  },
  "DicomModalities": {
    "ANDEX": ["ANDEX_GW", "192.168.1.50", 4243]
  },
  "Plugins": [
    "libOrthancModality.so",
    "libOrthancDicomWeb.so"
  ],
  "DicomWeb": {
    "Enable": true,
    "Root": "/dicom-web/",
    "EnableWado": true,
    "WadoRoot": "/wado"
  }
}
```

---

## 8. Sincronización con Supabase

### 8.1 Tablas Requeridas

#### agenda

```sql
CREATE TABLE agenda (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  centro_id UUID REFERENCES centros(id),
  paciente_id UUID REFERENCES pacientes(id),
  medico_id UUID REFERENCES usuarios(id),
  box_id UUID REFERENCES boxes(id),
  fecha DATE NOT NULL,
  hora TIME,
  procedimiento TEXT,
  estado TEXT DEFAULT 'programada',
  accession_number TEXT,
  source TEXT DEFAULT 'manual',  -- 'manual' | 'pacs'
  pacs_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(accession_number, fecha)
);

CREATE INDEX idx_agenda_fecha ON agenda(fecha);
CREATE INDEX idx_agenda_centro ON agenda(centro_id);
CREATE INDEX idx_agenda_paciente ON agenda(paciente_id);
CREATE INDEX idx_agenda_accession ON agenda(accession_number);
```

#### pacientes

```sql
CREATE TABLE pacientes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  centro_id UUID REFERENCES centros(id),
  rut TEXT NOT NULL,
  nombre TEXT NOT NULL,
  fecha_nacimiento DATE,
  sexo TEXT,
  telefono TEXT,
  email TEXT,
  direccion TEXT,
  prevision TEXT,
  hl7_patient_id TEXT,  -- ID original del PACS
  source TEXT DEFAULT 'manual',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(centro_id, rut)
);

CREATE INDEX idx_pacientes_rut ON pacientes(rut);
```

#### pacs_physicians

```sql
CREATE TABLE pacs_physicians (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  centro_id UUID NOT NULL REFERENCES centros(id),
  pacs_name TEXT NOT NULL,
  usuario_id UUID REFERENCES usuarios(id),
  estado TEXT DEFAULT 'pendiente',  -- 'pendiente' | 'mapeado' | 'ignorado'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(centro_id, pacs_name)
);

CREATE INDEX idx_pacs_physicians_centro ON pacs_physicians(centro_id);
CREATE INDEX idx_pacs_physicians_estado ON pacs_physicians(estado);
```

### 8.2 Migración para Duplicados

Si hay duplicados en la agenda, ejecutar:

```sql
-- 1. Agregar columnas faltantes
ALTER TABLE agenda ADD COLUMN IF NOT EXISTS procedimiento TEXT;
ALTER TABLE agenda ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual';
ALTER TABLE agenda ADD COLUMN IF NOT EXISTS accession_number TEXT;

-- 2. Eliminar duplicados (mantener más reciente)
DELETE FROM agenda a
WHERE a.id NOT IN (
  SELECT DISTINCT ON (accession_number, fecha) id
  FROM agenda
  WHERE accession_number IS NOT NULL
  ORDER BY accession_number, fecha, updated_at DESC
)
AND a.accession_number IS NOT NULL;

-- 3. Crear índice único
CREATE UNIQUE INDEX IF NOT EXISTS idx_agenda_accession_fecha 
ON agenda(accession_number, fecha) 
WHERE accession_number IS NOT NULL;
```

---

## 9. Sistema de Mapeo de Médicos

### 9.1 Funcionamiento

El Gateway registra automáticamente los nombres de médicos que vienen del PACS y permite mapearlos a usuarios de la PWA.

```
PACS                           PWA
─────────────────────────────────────────
"DR. GALLARDO^ALVARO"    →    Dr. Álvaro Gallardo (uuid-xxx)
"ARAUJO^MAIGUALIDA"      →    Dra. Maigualida Araujo (uuid-yyy)
"UNKNOWN^UNKNOWN"        →    [IGNORADO]
"TECNOLOGO"              →    [IGNORADO]
```

### 9.2 Estados de Mapeo

| Estado | Descripción |
|--------|-------------|
| `pendiente` | Nombre nuevo, esperando que admin lo mapee |
| `mapeado` | Asociado a un usuario de la PWA |
| `ignorado` | No es médico (técnico, sistema, etc.) |

### 9.3 Filtros Automáticos

El Gateway ignora automáticamente nombres inválidos:

```typescript
const invalidNames = [
  'unknown',
  'tecnologo',
  'tecnologa',
  'enfermero',
  'enfermera',
  'admin',
  'sistema',
  'system',
  'n/a',
  'na',
  'sin asignar',
  'por asignar'
];
```

### 9.4 UI de Mapeo en PWA

En la PWA, sección **Configuración > Integración PACS**:

```
┌────────────────────────────────────────────────────────────┐
│ Médicos PACS Pendientes de Mapeo                           │
├────────────────────────────────────────────────────────────┤
│ ○ DR. GALLARDO VILLALOBOS^ALVARO                           │
│   [Seleccionar médico PWA ▼]  [Mapear] [Ignorar]           │
│                                                            │
│ ○ RODRIGUEZ^MARIA ELENA                                    │
│   [Seleccionar médico PWA ▼]  [Mapear] [Ignorar]           │
└────────────────────────────────────────────────────────────┘
```

---

## 10. Sistema de Mapeo de Procedimientos

### 10.1 Procedimientos Válidos en PWA

```typescript
const VALID_PROCEDURES = [
  'Endoscopia Digestiva Alta',
  'Colonoscopia',
  'Nasofibroscopía',
  'Cistoscopia',
  'Biopsia de Próstata',
  'Gastrostomía',
  'Cistostomía',
  'ERCP',
  'EUS',
  'EBUS'
];
```

### 10.2 Patrones de Mapeo

| Patrón PACS | → | Procedimiento PWA |
|-------------|---|-------------------|
| `endoscopia digestiva alta`, `eda`, `gastroscopia`, `panendoscopia`, `egds` | → | Endoscopia Digestiva Alta |
| `colonoscopia`, `colono`, `rectocolonoscopia`, `videocolonoscopia` | → | Colonoscopia |
| `nasofibroscopia`, `laringoscopia`, `rinoscopia` | → | Nasofibroscopía |
| `cistoscopia`, `uretrocistoscopia`, `cistouretroscopia` | → | Cistoscopia |
| `biopsia prostata`, `biopsia prostatica`, `biopsia transrectal` | → | Biopsia de Próstata |
| `gastrostomia`, `peg`, `gastrostomía endoscópica` | → | Gastrostomía |
| `cistostomia`, `talla vesical` | → | Cistostomía |
| `ercp`, `cpre`, `colangiografia`, `papilotomia` | → | ERCP |
| `eus`, `ecoendoscopia`, `endosonografia` | → | EUS |
| `ebus`, `broncoscopia`, `endobronquial` | → | EBUS |

### 10.3 Lógica de Mapeo

```typescript
function mapProcedure(pacsDescription: string | undefined): string {
  if (!pacsDescription) {
    return 'Sin especificar';
  }

  const normalized = pacsDescription.toLowerCase().trim();
  
  // Buscar coincidencia en patrones
  for (const { patterns, procedure } of PROCEDURE_PATTERNS) {
    for (const pattern of patterns) {
      if (normalized.includes(pattern)) {
        return procedure;  // Retorna procedimiento PWA estándar
      }
    }
  }
  
  // Sin coincidencia → retornar original
  return pacsDescription;
}
```

---

## 11. API REST

### 11.1 Autenticación

Todas las rutas (excepto `/health`) requieren API Key:

```bash
curl -H "X-API-Key: tu-api-key" http://localhost:3001/api/...
```

### 11.2 Endpoints

#### Health Check

```
GET /health

Response:
{
  "gateway": { "status": "ok", "uptime": 3600, "version": "1.0.0" },
  "pacs": { "status": "ok", "type": "orthanc", "url": "http://localhost:8042" },
  "queue": { "status": "ok", "jobsTotal": 10, "jobsPending": 0 },
  "database": { "status": "ok" }
}
```

#### Worklist

```
GET /api/worklist?date=20260315
X-API-Key: xxx

Response:
{
  "success": true,
  "items": [
    {
      "accessionNumber": "ACC001",
      "patientID": "12345678-9",
      "patientName": "PEREZ^JUAN",
      "scheduledDateTime": "20260315120000",
      "scheduledProcedureDescription": "ENDOSCOPIA DIGESTIVA ALTA",
      "modality": "ES"
    }
  ],
  "total": 1
}
```

#### Sync Manual

```
POST /api/worklist/sync
X-API-Key: xxx
Content-Type: application/json

{
  "date": "20260315"
}

Response:
{
  "success": true,
  "created": 5,
  "updated": 2,
  "cancelled": 0,
  "errors": []
}
```

#### Configuración PACS

```
GET /api/config/pacs
X-API-Key: xxx

Response:
{
  "url": "http://localhost:8042",
  "authType": "basic",
  "gatewayAeTitle": "ANDEX_GW",
  "status": "connected"
}
```

#### Médicos PACS Pendientes

```
GET /api/config/pacs-physicians?estado=pendiente
X-API-Key: xxx

Response:
{
  "success": true,
  "physicians": [
    {
      "id": "uuid-xxx",
      "pacs_name": "DR. GALLARDO^ALVARO",
      "estado": "pendiente",
      "usuario_id": null
    }
  ]
}
```

#### Mapear Médico

```
POST /api/config/pacs-physicians/:id/map
X-API-Key: xxx
Content-Type: application/json

{
  "usuario_id": "uuid-del-usuario"
}

Response:
{
  "success": true,
  "physician": {
    "id": "uuid-xxx",
    "pacs_name": "DR. GALLARDO^ALVARO",
    "estado": "mapeado",
    "usuario_id": "uuid-del-usuario"
  }
}
```

---

## 12. Dashboard de Monitoreo

### 12.1 Acceso

```
http://localhost:3001/
```

### 12.2 Métricas Disponibles

| Métrica | Descripción |
|---------|-------------|
| Uptime | Tiempo desde el inicio |
| Jobs Pendientes | Operaciones en cola |
| Jobs Fallidos | Operaciones con error |
| Última Sincronización | Timestamp del último sync |
| Estado PACS | Conexión al servidor PACS |
| Estado Supabase | Conexión a la base de datos |

### 12.3 Observabilidad

```
GET /observability

Response: Métricas en formato Prometheus
```

---

## 13. Despliegue en Producción

### 13.1 Requisitos de Red

```
┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│   Gateway   │◀───────▶│    PACS     │         │  Supabase   │
│  (Puerto    │  HTTP   │  (Puerto    │         │  (Internet) │
│   3001)     │  8042   │   8042)     │         │             │
└──────┬──────┘         └─────────────┘         └──────▲──────┘
       │                                               │
       │                                               │
       └───────────────────────────────────────────────┘
                         HTTPS 443
```

| Conexión | Puerto | Protocolo |
|----------|--------|-----------|
| Gateway ↔ PACS | 8042 (configurable) | HTTP/HTTPS |
| Gateway → Supabase | 443 | HTTPS |
| Admin → Gateway | 3001 | HTTP (interno) |

### 13.2 Docker

```dockerfile
# Dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY dist/ ./dist/
COPY data/ ./data/

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

CMD ["node", "dist/index.js"]
```

```yaml
# docker-compose.yml
version: '3.8'

services:
  gateway:
    build: .
    ports:
      - "3001:3001"
    volumes:
      - gateway_data:/app/data
    environment:
      - NODE_ENV=production
      - PACS_URL=http://pacs:8042
      - SUPABASE_URL=${SUPABASE_URL}
      - SUPABASE_SERVICE_KEY=${SUPABASE_SERVICE_KEY}
    restart: unless-stopped

volumes:
  gateway_data:
```

### 13.3 Systemd (Linux)

```ini
# /etc/systemd/system/andex-gateway.service
[Unit]
Description=Andex Gateway
After=network.target

[Service]
Type=simple
User=andex
WorkingDirectory=/opt/andex-gateway
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
# Comandos
sudo systemctl daemon-reload
sudo systemctl enable andex-gateway
sudo systemctl start andex-gateway
sudo systemctl status andex-gateway
sudo journalctl -u andex-gateway -f
```

### 13.4 Windows Service

```powershell
# Usando node-windows
npm install -g node-windows

# install-service.js
const Service = require('node-windows').Service;

const svc = new Service({
  name: 'Andex Gateway',
  description: 'PACS Integration Gateway',
  script: 'C:\\andex-gateway\\dist\\index.js',
  env: [{
    name: 'NODE_ENV',
    value: 'production'
  }]
});

svc.on('install', () => svc.start());
svc.install();
```

---

## 14. Troubleshooting

### 14.1 Errores Comunes

#### Error: "PACS Connection Failed"

```
Causa: No se puede conectar al servidor PACS
Solución:
1. Verificar PACS_URL en .env
2. Verificar que el PACS esté corriendo
3. Verificar credenciales (PACS_USERNAME, PACS_PASSWORD)
4. Verificar firewall

# Test de conexión
curl -u orthanc:orthanc http://localhost:8042/system
```

#### Error: "Supabase Error"

```
Causa: Problema con la conexión a Supabase
Solución:
1. Verificar SUPABASE_URL y SUPABASE_SERVICE_KEY
2. Verificar que la service key no haya expirado
3. Verificar permisos RLS en las tablas

# Test de conexión
curl "https://xxx.supabase.co/rest/v1/agenda?limit=1" \
  -H "apikey: tu-service-key"
```

#### Error: "Could not extract RUT from patientID"

```
Causa: El Patient ID del PACS no tiene formato de RUT válido
Ejemplo: "689570" (solo 6 dígitos)
Solución: Esto es normal si el hospital usa número de ficha interno
El paciente se ignora (no se sincroniza)
```

#### Error: "Duplicate key violates unique constraint"

```
Causa: Ya existe una cita con el mismo accession_number
Solución: Ejecutar migración para limpiar duplicados:

DELETE FROM agenda a
WHERE a.id NOT IN (
  SELECT DISTINCT ON (accession_number, fecha) id
  FROM agenda
  WHERE accession_number IS NOT NULL
  ORDER BY accession_number, fecha, updated_at DESC
);
```

### 14.2 Logs

```bash
# Ver logs en tiempo real
tail -f /tmp/gateway.log

# Buscar errores
grep "ERROR" /tmp/gateway.log

# Logs de sincronización
grep "Sync" /tmp/gateway.log
```

### 14.3 Debug Mode

```bash
# Habilitar debug
LOG_LEVEL=debug node dist/index.js

# O en .env
LOG_LEVEL=debug
```

---

## 15. Seguridad

### 15.1 Autenticación API

- Todas las rutas requieren `X-API-Key` header
- La API key se configura en `API_KEY` en .env
- Rotar la key periódicamente

### 15.2 Credenciales PACS

- Usar credenciales con mínimos privilegios (solo query)
- No exponer credenciales en logs
- Almacenar en variables de entorno, no en código

### 15.3 Supabase

- Usar `service_role` key solo en el gateway (backend)
- Nunca exponer `service_role` key en frontend
- Configurar RLS en las tablas

### 15.4 Red

- Gateway debe estar en red interna del hospital
- No exponer puerto 3001 a internet
- Usar VPN para acceso remoto
- Habilitar HTTPS si es necesario acceso externo

### 15.5 HIPAA/GDPR Considerations

- Los datos de pacientes solo se almacenan en Supabase (cloud seguro)
- El gateway es stateless (no almacena PHI localmente)
- SQLite local solo contiene jobs queue (sin datos de pacientes)
- Logs no contienen información sensible del paciente

---

## 16. Apéndices

### A. Tags DICOM Relevantes

| Tag | Nombre | VR |
|-----|--------|-----|
| (0008,0050) | Accession Number | SH |
| (0008,0060) | Modality | CS |
| (0008,0080) | Institution Name | LO |
| (0008,0090) | Referring Physician Name | PN |
| (0010,0010) | Patient Name | PN |
| (0010,0020) | Patient ID | LO |
| (0010,0030) | Patient Birth Date | DA |
| (0010,0040) | Patient Sex | CS |
| (0020,000D) | Study Instance UID | UI |
| (0032,1060) | Requested Procedure Description | LO |
| (0040,0002) | Scheduled Procedure Step Start Date | DA |
| (0040,0003) | Scheduled Procedure Step Start Time | TM |
| (0040,0006) | Scheduled Performing Physician Name | PN |
| (0040,0007) | Scheduled Procedure Step Description | LO |
| (0040,0009) | Scheduled Procedure Step ID | SH |
| (0040,0100) | Scheduled Procedure Step Sequence | SQ |
| (0040,1001) | Requested Procedure ID | SH |

### B. Modalidades DICOM

| Código | Descripción |
|--------|-------------|
| ES | Endoscopy |
| OT | Other |
| CR | Computed Radiography |
| CT | Computed Tomography |
| MR | Magnetic Resonance |
| US | Ultrasound |
| XA | X-Ray Angiography |
| RF | Radio Fluoroscopy |

### C. Estructura de Directorios

```
andex-gateway/
├── src/
│   ├── config/
│   │   └── env.ts              # Configuración de variables de entorno
│   ├── db/
│   │   ├── database.ts         # Conexión SQLite
│   │   └── schema.sql          # Schema de la base de datos local
│   ├── routes/
│   │   ├── config.routes.ts    # Rutas de configuración
│   │   ├── dicom.routes.ts     # Rutas DICOM
│   │   ├── health.routes.ts    # Health check
│   │   └── worklist.routes.ts  # Rutas de worklist
│   ├── services/
│   │   ├── pacs-physician.service.ts    # Mapeo de médicos
│   │   ├── procedure-mapping.service.ts # Mapeo de procedimientos
│   │   ├── rut.service.ts               # Validación de RUT
│   │   ├── supabase.service.ts          # Cliente Supabase
│   │   ├── sync.service.ts              # Sincronización
│   │   ├── worklist.service.ts          # Consulta worklist PACS
│   │   ├── worklist-mock.service.ts     # Mock para testing
│   │   └── worklist-polling.service.ts  # Polling automático
│   ├── types/
│   │   └── index.ts            # Tipos TypeScript
│   └── index.ts                # Entry point
├── dist/                       # Código compilado
├── data/                       # Base de datos SQLite y storage
├── .env                        # Configuración (no en git)
├── .env.example                # Ejemplo de configuración
├── package.json
├── tsconfig.json
└── README.md
```

### D. Contacto y Soporte

```
Andex Medical
Email: soporte@andexmedical.cl
GitHub: https://github.com/agallardov-ai/andex-gateway
Documentación: Este archivo
```

---

**Fin del documento**

*Última actualización: 15 de marzo de 2026*
