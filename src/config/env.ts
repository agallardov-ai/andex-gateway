import dotenv from 'dotenv';
dotenv.config();

export type PacsType = 'orthanc' | 'dicomweb';
export type AuthType = 'none' | 'basic' | 'bearer';

export const config = {
  // Server
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  
  // Centro
  centroNombre: process.env.CENTRO_NOMBRE || 'Mi Centro Medico',
  centroId: process.env.CENTRO_ID || 'centro-001',
  
  // Security
  apiKey: process.env.API_KEY || 'default-dev-key',
  dashboardUser: process.env.DASHBOARD_USER || 'admin',
  dashboardPassword: process.env.DASHBOARD_PASSWORD || 'admin123',
  
  // CORS
  allowedOrigins: (process.env.ALLOWED_ORIGINS || 'http://localhost:5173')
    .split(',')
    .map(o => o.trim()),
  
  // PACS Configuration (unified for Orthanc and DICOMweb)
  pacsType: (process.env.PACS_TYPE || 'orthanc') as PacsType,
  pacsUrl: process.env.PACS_URL || process.env.ORTHANC_URL || 'http://localhost:8042',
  pacsAuthType: (process.env.PACS_AUTH_TYPE || 'basic') as AuthType,
  pacsUsername: process.env.PACS_USERNAME || process.env.ORTHANC_USERNAME || '',
  pacsPassword: process.env.PACS_PASSWORD || process.env.ORTHANC_PASSWORD || '',
  pacsToken: process.env.PACS_TOKEN || '',
  
  // DICOMweb specific paths (FUJIFILM Synapse 7)
  dicomwebStowPath: process.env.DICOMWEB_STOW_PATH || '/studies',
  dicomwebQidoPath: process.env.DICOMWEB_QIDO_PATH || '/studies',
  dicomwebWadoPath: process.env.DICOMWEB_WADO_PATH || '/studies',
  
  // Worklist (MWL) - FUJIFILM Synapse 7 como fuente
  worklistPreferUps: process.env.WORKLIST_PREFER_UPS !== 'false',  // Default: true (usar UPS-RS)
  worklistUpsPath: process.env.WORKLIST_UPS_PATH || '/workitems',
  worklistQidoMwlPath: process.env.WORKLIST_QIDO_MWL_PATH || '/mwlitems',
  worklistDefaultModality: process.env.WORKLIST_DEFAULT_MODALITY || 'ES',  // Endoscopy
  
  // Legacy Orthanc support (deprecated, use pacs* instead)
  orthancUrl: process.env.ORTHANC_URL || 'http://localhost:8042',
  orthancUsername: process.env.ORTHANC_USERNAME || '',
  orthancPassword: process.env.ORTHANC_PASSWORD || '',
  
  // Queue
  retryIntervalMs: parseInt(process.env.RETRY_INTERVAL_MS || '60000', 10),
  maxRetryAttempts: parseInt(process.env.MAX_RETRY_ATTEMPTS || '5', 10),
  cleanupAfterHours: parseInt(process.env.CLEANUP_AFTER_HOURS || '24', 10),
  
  // Rate Limiting
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
  
  // Paths
  dataDir: process.env.DATA_DIR || './data',
  get pendingDir() {
    return process.env.DATA_DIR ? `${process.env.DATA_DIR}/pending` : './data/pending';
  },
  get dbPath() {
    return process.env.DATA_DIR ? `${process.env.DATA_DIR}/gateway.db` : './data/gateway.db';
  },
};
