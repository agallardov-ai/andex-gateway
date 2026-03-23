import dotenv from 'dotenv';
dotenv.config();

export type PacsType = 'orthanc' | 'dicomweb' | 'dicom-native';
export type AuthType = 'none' | 'basic' | 'bearer';

export const config = {
  // ===== IDENTIDAD DEL CENTRO =====
  centroNombre: process.env.CENTRO_NOMBRE || 'Mi Centro Médico',
  centroId: process.env.CENTRO_ID || 'CENTRO01',

  // ===== GATEWAY =====
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  // ===== SEGURIDAD =====
  apiKey: process.env.API_KEY || 'dev-api-key-cambiar',
  dashboardUser: process.env.DASHBOARD_USER || 'admin',
  dashboardPassword: process.env.DASHBOARD_PASSWORD || 'admin123',
  allowedOrigins: (process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://localhost:3000')
    .split(',')
    .map(o => o.trim()),

  // ===== PACS =====
  pacsType: (process.env.PACS_TYPE || 'orthanc') as PacsType,
  pacsBaseUrl: process.env.PACS_BASE_URL || 'http://localhost:8042',
  
  // Autenticación PACS
  pacsAuthType: (process.env.PACS_AUTH_TYPE || 'none') as AuthType,
  pacsUsername: process.env.PACS_USERNAME || '',
  pacsPassword: process.env.PACS_PASSWORD || '',
  pacsToken: process.env.PACS_TOKEN || '',

  // ===== DICOM NATIVO (TCP) =====
  gatewayAeTitle: process.env.GATEWAY_AE_TITLE || 'ANDEX_GW',
  pacsDicomHost: process.env.PACS_DICOM_HOST || '',
  pacsDicomPort: parseInt(process.env.PACS_DICOM_PORT || '104', 10),
  pacsAeTitle: process.env.PACS_AE_TITLE || '',
  gatewayDicomPort: parseInt(process.env.GATEWAY_DICOM_PORT || '11113', 10),

  // ===== DICOMweb ENDPOINTS =====
  pacsStowEndpoint: process.env.PACS_STOW_ENDPOINT || '/dicomweb/studies',
  pacsQidoEndpoint: process.env.PACS_QIDO_ENDPOINT || '/dicomweb/studies',
  pacsWadoEndpoint: process.env.PACS_WADO_ENDPOINT || '/dicomweb/studies',
  
  // ===== WORKLIST =====
  worklistMode: (process.env.WORKLIST_MODE || 'pacs') as 'mock' | 'pacs',
  worklistEndpoint: process.env.WORKLIST_ENDPOINT || '/dicomweb/workitems',
  worklistMwlEndpoint: process.env.WORKLIST_MWL_ENDPOINT || '/dicomweb/mwlitems',
  worklistPreferUps: process.env.WORKLIST_PREFER_UPS !== 'false',
  worklistDefaultModality: process.env.WORKLIST_DEFAULT_MODALITY || 'ES',
  worklistStationAET: process.env.WORKLIST_STATION_AET || '',

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
