import dotenv from 'dotenv';
dotenv.config();

import { configStore } from './config-store.js';

// Pre-load JSON config
const store = configStore;
store.load();

export type PacsType = 'orthanc' | 'dicomweb' | 'dicom-native';
export type AuthType = 'none' | 'basic' | 'bearer';

export const config = {
  // ===== IDENTIDAD DEL CENTRO =====
  centroNombre: store.getOrEnv('centroNombre', 'CENTRO_NOMBRE', 'Mi Centro Medico'),
  centroId: store.getOrEnv('centroId', 'CENTRO_ID', 'CENTRO01'),

  // ===== GATEWAY =====
  port: store.getNumOrEnv('port', 'PORT', 3001),
  nodeEnv: process.env.NODE_ENV || 'development',

  // ===== SEGURIDAD =====
  apiKey: store.getEnvOrJson('apiKey', 'API_KEY', 'dev-api-key-cambiar'),
  dashboardUser: store.getEnvOrJson('dashboardUser', 'DASHBOARD_USER', 'admin'),
  dashboardPassword: store.getEnvOrJson('dashboardPassword', 'DASHBOARD_PASSWORD', 'admin123'),
  allowedOrigins: store.getOrEnv('allowedOrigins', 'ALLOWED_ORIGINS', 'http://localhost:5173,http://localhost:3000')
    .split(',')
    .map(o => o.trim()),

  // ===== PACS =====
  pacsType: store.getOrEnv('pacsType', 'PACS_TYPE', 'orthanc') as PacsType,
  pacsBaseUrl: store.getOrEnv('pacsBaseUrl', 'PACS_BASE_URL', 'http://localhost:8042'),
  
  // Autenticacion PACS
  pacsAuthType: store.getOrEnv('pacsAuthType', 'PACS_AUTH_TYPE', 'none') as AuthType,
  pacsUsername: store.getOrEnv('pacsUsername', 'PACS_USERNAME', ''),
  pacsPassword: store.getOrEnv('pacsPassword', 'PACS_PASSWORD', ''),
  pacsToken: store.getOrEnv('pacsToken', 'PACS_TOKEN', ''),

  // ===== DICOM NATIVO (TCP) =====
  gatewayAeTitle: store.getOrEnv('gatewayAeTitle', 'GATEWAY_AE_TITLE', 'ANDEX_1'),
  pacsDicomHost: store.getOrEnv('pacsDicomHost', 'PACS_DICOM_HOST', ''),
  pacsDicomPort: store.getNumOrEnv('pacsDicomPort', 'PACS_DICOM_PORT', 104),
  pacsAeTitle: store.getOrEnv('pacsAeTitle', 'PACS_AE_TITLE', ''),
  gatewayDicomPort: store.getNumOrEnv('gatewayDicomPort', 'GATEWAY_DICOM_PORT', 11113),

  // ===== DICOMweb ENDPOINTS =====
  pacsStowEndpoint: store.getOrEnv('pacsStowEndpoint', 'PACS_STOW_ENDPOINT', '/dicomweb/studies'),
  pacsQidoEndpoint: store.getOrEnv('pacsQidoEndpoint', 'PACS_QIDO_ENDPOINT', '/dicomweb/studies'),
  pacsWadoEndpoint: store.getOrEnv('pacsWadoEndpoint', 'PACS_WADO_ENDPOINT', '/dicomweb/studies'),
  
  // ===== WORKLIST =====
  worklistMode: store.getOrEnv('worklistMode', 'WORKLIST_MODE', 'pacs') as 'mock' | 'pacs',
  worklistEndpoint: store.getOrEnv('worklistEndpoint', 'WORKLIST_ENDPOINT', '/dicomweb/workitems'),
  worklistMwlEndpoint: store.getOrEnv('worklistMwlEndpoint', 'WORKLIST_MWL_ENDPOINT', '/dicomweb/mwlitems'),
  worklistPreferUps: store.getBoolOrEnv('worklistPreferUps', 'WORKLIST_PREFER_UPS', true),
  worklistDefaultModality: store.getOrEnv('worklistDefaultModality', 'WORKLIST_DEFAULT_MODALITY', 'ES'),
  worklistStationAET: store.getOrEnv('worklistStationAET', 'WORKLIST_STATION_AET', ''),

  // ===== STORAGE =====
  storagePath: process.env.STORAGE_PATH || './data',
  get pendingDir() {
    return `${this.storagePath}/pending`;
  },
  get processedDir() {
    return `${this.storagePath}/processed`;
  },
  get failedDir() {
    return `${this.storagePath}/failed`;
  },
  get dbPath() {
    return `${this.storagePath}/gateway.db`;
  },

  // ===== QUEUE =====
  queueRetryInterval: parseInt(process.env.QUEUE_RETRY_INTERVAL || '5000', 10),
  queueMaxRetries: parseInt(process.env.QUEUE_MAX_RETRIES || '5', 10),
  cleanupAfterHours: parseInt(process.env.CLEANUP_AFTER_HOURS || '48', 10),

  // ===== RATE LIMITING =====
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),

  // ===== LEGACY (compatibilidad hacia atrás) =====
  // Estos mapean a los nuevos nombres
  get pacsUrl() { return this.pacsBaseUrl; },
  get retryIntervalMs() { return this.queueRetryInterval; },
  get maxRetryAttempts() { return this.queueMaxRetries; },
  get dataDir() { return this.storagePath; },
  get dicomwebStowPath() { return this.pacsStowEndpoint; },
  get dicomwebQidoPath() { return this.pacsQidoEndpoint; },
  get dicomwebWadoPath() { return this.pacsWadoEndpoint; },
  get worklistUpsPath() { return this.worklistEndpoint; },
  get worklistQidoMwlPath() { return this.worklistMwlEndpoint; },
  get orthancUrl() { return this.pacsBaseUrl; },
  get orthancUsername() { return this.pacsUsername; },
  get orthancPassword() { return this.pacsPassword; },
};

// ===== SUPABASE (PWA Backend) =====
export const supabaseConfig = {
  url: process.env.SUPABASE_URL || '',
  serviceKey: process.env.SUPABASE_SERVICE_KEY || '',      // legacy (bypasses RLS)
  anonKey: process.env.SUPABASE_ANON_KEY || '',             // public key (RLS enforced)
  centroToken: process.env.SUPABASE_CENTRO_TOKEN || '',     // per-centro JWT (RLS scoped)
  enabled: !!process.env.SUPABASE_URL && (
    !!process.env.SUPABASE_SERVICE_KEY ||
    (!!process.env.SUPABASE_ANON_KEY && !!process.env.SUPABASE_CENTRO_TOKEN)
  ),
};

// ===== WORKLIST SYNC =====
export const syncConfig = {
  enabled: process.env.WORKLIST_SYNC_ENABLED !== 'false',
  pollingIntervalMs: parseInt(process.env.WORKLIST_SYNC_INTERVAL_MS || '30000', 10),
  defaultBoxId: process.env.WORKLIST_DEFAULT_BOX_ID || '1',
  defaultCentroId: process.env.WORKLIST_DEFAULT_CENTRO_ID || '',
};
