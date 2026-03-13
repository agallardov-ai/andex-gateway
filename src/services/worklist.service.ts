/**
 * Worklist Service - Andex Gateway
 * =================================
 * Consume Modality Worklist (MWL) desde FUJIFILM Synapse 7
 * via DICOMweb (UPS-RS / QIDO-RS)
 * 
 * Synapse 7 soporta:
 * - UPS-RS (Unified Procedure Step) - Preferido para worklist
 * - QIDO-RS con parámetros de Scheduled Procedure Step
 */

import { config } from '../config/env.js';

// =====================================================
// TIPOS
// =====================================================

export interface WorklistItem {
  // Identificadores
  accessionNumber: string;           // (0008,0050) Accession Number
  studyInstanceUID?: string;         // (0020,000D) Study Instance UID (si ya existe)
  scheduledProcedureStepID: string;  // (0040,0009) Scheduled Procedure Step ID
  requestedProcedureID: string;      // (0040,1001) Requested Procedure ID
  
  // Paciente
  patientID: string;                 // (0010,0020) Patient ID (RUT)
  patientName: string;               // (0010,0010) Patient's Name
  patientBirthDate?: string;         // (0010,0030) Patient's Birth Date
  patientSex?: string;               // (0010,0040) Patient's Sex
  
  // Procedimiento
  scheduledDateTime: string;         // (0040,0002) + (0040,0003) Scheduled Date/Time
  modality: string;                  // (0008,0060) Modality (ES = Endoscopy)
  scheduledStationAET?: string;      // (0040,0001) Scheduled Station AE Title
  scheduledStationName?: string;     // (0040,0010) Scheduled Station Name
  
  // Descripción
  scheduledProcedureDescription: string;  // (0040,0007) Scheduled Procedure Step Description
  requestedProcedureDescription?: string; // (0032,1060) Requested Procedure Description
  
  // Médico
  referringPhysicianName?: string;   // (0008,0090) Referring Physician's Name
  scheduledPerformingPhysician?: string; // (0040,0006) Scheduled Performing Physician's Name
  
  // Institución
  institutionName?: string;          // (0008,0080) Institution Name
  departmentName?: string;           // (0008,1040) Institutional Department Name
  
  // Estado (para UPS-RS)
  procedureStepState?: 'SCHEDULED' | 'IN PROGRESS' | 'COMPLETED' | 'CANCELED';
  
  // Metadata
  rawData?: any;  // Datos originales de la respuesta
}

export interface WorklistQuery {
  date?: string;           // Fecha (YYYYMMDD o rango YYYYMMDD-YYYYMMDD)
  patientID?: string;      // Filtrar por RUT/ID paciente
  patientName?: string;    // Filtrar por nombre (wildcards: *)
  modality?: string;       // Filtrar por modalidad (ES, OT, etc.)
  accessionNumber?: string; // Filtrar por número de acceso
  stationAET?: string;     // Filtrar por AE Title de estación
  limit?: number;          // Límite de resultados
  offset?: number;         // Offset para paginación
}

// =====================================================
// CONFIGURACIÓN
// =====================================================

interface WorklistConfig {
  baseUrl: string;
  authType: 'none' | 'basic' | 'bearer';
  username?: string;
  password?: string;
  token?: string;
  // Paths DICOMweb
  upsPath: string;      // Path para UPS-RS (ej: /workitems)
  qidoMwlPath: string;  // Path para QIDO-RS MWL (ej: /mwlitems)
  // Preferencia
  preferUps: boolean;   // true = usar UPS-RS, false = usar QIDO-RS MWL
}

let worklistConfig: WorklistConfig = {
  baseUrl: config.pacsUrl || 'http://localhost:8042',
  authType: (config.pacsAuthType as 'none' | 'basic' | 'bearer') || 'none',
  username: config.pacsUsername,
  password: config.pacsPassword,
  token: config.pacsToken,
  upsPath: process.env.WORKLIST_UPS_PATH || '/workitems',
  qidoMwlPath: process.env.WORKLIST_QIDO_MWL_PATH || '/mwlitems',
  preferUps: process.env.WORKLIST_PREFER_UPS !== 'false'  // Default: true
};

/**
 * Configura el servicio de Worklist
 */
export function configureWorklist(cfg: Partial<WorklistConfig>): void {
  worklistConfig = { ...worklistConfig, ...cfg };
  console.log(`📋 Worklist configurado: ${worklistConfig.baseUrl} (${worklistConfig.preferUps ? 'UPS-RS' : 'QIDO-RS MWL'})`);
}

/**
 * Obtiene headers de autenticación
 */
function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Accept': 'application/dicom+json'
  };
  
  if (worklistConfig.authType === 'basic' && worklistConfig.username) {
    const credentials = Buffer.from(`${worklistConfig.username}:${worklistConfig.password || ''}`).toString('base64');
    headers['Authorization'] = `Basic ${credentials}`;
  } else if (worklistConfig.authType === 'bearer' && worklistConfig.token) {
    headers['Authorization'] = `Bearer ${worklistConfig.token}`;
  }
  
  return headers;
}

// =====================================================
// PARSERS DICOM JSON
// =====================================================

/**
 * Extrae valor de un atributo DICOM JSON
 */
function getDicomValue(item: any, tag: string, defaultValue: string = ''): string {
  try {
    const attr = item[tag];
    if (!attr) return defaultValue;
    
    // Value puede ser array de strings, PersonName, etc.
    if (attr.Value && Array.isArray(attr.Value)) {
      const val = attr.Value[0];
      // PersonName tiene formato especial
      if (typeof val === 'object' && val.Alphabetic) {
        return val.Alphabetic;
      }
      return String(val);
    }
    return defaultValue;
  } catch {
    return defaultValue;
  }
}

/**
 * Extrae valor anidado de un atributo DICOM JSON (para secuencias)
 */
function getNestedDicomValue(item: any, seqTag: string, valueTag: string, defaultValue: string = ''): string {
  try {
    const seq = item[seqTag];
    if (!seq?.Value?.[0]) return defaultValue;
    return getDicomValue(seq.Value[0], valueTag, defaultValue);
  } catch {
    return defaultValue;
  }
}

/**
 * Parsea un item de Worklist desde DICOM JSON
 */
function parseWorklistItem(item: any): WorklistItem {
  // Scheduled Procedure Step Sequence (0040,0100)
  const spsSequence = item['00400100']?.Value?.[0] || {};
  
  // Fecha y hora programada
  const scheduledDate = getDicomValue(spsSequence, '00400002'); // (0040,0002)
  const scheduledTime = getDicomValue(spsSequence, '00400003'); // (0040,0003)
  const scheduledDateTime = formatDateTime(scheduledDate, scheduledTime);
  
  return {
    // Identificadores
    accessionNumber: getDicomValue(item, '00080050'),
    studyInstanceUID: getDicomValue(item, '0020000D'),
    scheduledProcedureStepID: getDicomValue(spsSequence, '00400009'),
    requestedProcedureID: getDicomValue(item, '00401001'),
    
    // Paciente
    patientID: getDicomValue(item, '00100020'),
    patientName: getDicomValue(item, '00100010'),
    patientBirthDate: formatDate(getDicomValue(item, '00100030')),
    patientSex: getDicomValue(item, '00100040'),
    
    // Procedimiento
    scheduledDateTime,
    modality: getDicomValue(spsSequence, '00080060') || 'ES',
    scheduledStationAET: getDicomValue(spsSequence, '00400001'),
    scheduledStationName: getDicomValue(spsSequence, '00400010'),
    
    // Descripción
    scheduledProcedureDescription: getDicomValue(spsSequence, '00400007'),
    requestedProcedureDescription: getDicomValue(item, '00321060'),
    
    // Médico
    referringPhysicianName: getDicomValue(item, '00080090'),
    scheduledPerformingPhysician: getDicomValue(spsSequence, '00400006'),
    
    // Institución
    institutionName: getDicomValue(item, '00080080'),
    departmentName: getDicomValue(item, '00081040'),
    
    // Estado
    procedureStepState: 'SCHEDULED',
    
    // Raw data para debug
    rawData: item
  };
}

/**
 * Parsea un UPS Workitem desde DICOM JSON
 */
function parseUpsWorkitem(item: any): WorklistItem {
  // UPS tiene estructura ligeramente diferente
  // Scheduled Workitem Code Sequence, Scheduled Station Name Code Sequence, etc.
  
  // Input Information Sequence (0040,4021) contiene info del paciente
  const inputInfoSeq = item['00404021']?.Value?.[0] || {};
  
  // Scheduled Procedure Step Start DateTime (0040,4005)
  const scheduledDateTime = getDicomValue(item, '00404005');
  
  // Procedure Step State (0074,1000)
  const stateMap: Record<string, WorklistItem['procedureStepState']> = {
    'SCHEDULED': 'SCHEDULED',
    'IN PROGRESS': 'IN PROGRESS',
    'COMPLETED': 'COMPLETED',
    'CANCELED': 'CANCELED'
  };
  const state = getDicomValue(item, '00741000');
  
  return {
    // Identificadores
    accessionNumber: getDicomValue(inputInfoSeq, '00080050') || getDicomValue(item, '00080050'),
    studyInstanceUID: getDicomValue(inputInfoSeq, '0020000D'),
    scheduledProcedureStepID: getDicomValue(item, '00741000'), // SOP Instance UID como ID
    requestedProcedureID: getDicomValue(item, '00401001'),
    
    // Paciente (puede venir de Input Information Sequence)
    patientID: getDicomValue(inputInfoSeq, '00100020') || getDicomValue(item, '00100020'),
    patientName: getDicomValue(inputInfoSeq, '00100010') || getDicomValue(item, '00100010'),
    patientBirthDate: formatDate(getDicomValue(inputInfoSeq, '00100030')),
    patientSex: getDicomValue(inputInfoSeq, '00100040'),
    
    // Procedimiento
    scheduledDateTime: formatDateTimeDT(scheduledDateTime),
    modality: getDicomValue(item, '00080060') || 'ES',
    scheduledStationAET: getNestedDicomValue(item, '00404025', '00080054'),
    scheduledStationName: getNestedDicomValue(item, '00404027', '00080100'),
    
    // Descripción
    scheduledProcedureDescription: getDicomValue(item, '00741204'), // Procedure Step Label
    requestedProcedureDescription: getDicomValue(item, '00321060'),
    
    // Médico
    referringPhysicianName: getDicomValue(item, '00080090'),
    scheduledPerformingPhysician: '', // No estándar en UPS
    
    // Institución
    institutionName: getDicomValue(item, '00080080'),
    departmentName: getDicomValue(item, '00081040'),
    
    // Estado
    procedureStepState: stateMap[state] || 'SCHEDULED',
    
    // Raw
    rawData: item
  };
}

// =====================================================
// UTILIDADES DE FORMATO
// =====================================================

/**
 * Formatea fecha DICOM (YYYYMMDD) a ISO
 */
function formatDate(dicomDate: string): string {
  if (!dicomDate || dicomDate.length !== 8) return '';
  return `${dicomDate.slice(0, 4)}-${dicomDate.slice(4, 6)}-${dicomDate.slice(6, 8)}`;
}

/**
 * Formatea fecha y hora DICOM a ISO
 */
function formatDateTime(date: string, time: string): string {
  const formattedDate = formatDate(date);
  if (!formattedDate) return '';
  
  if (time && time.length >= 4) {
    const hours = time.slice(0, 2);
    const minutes = time.slice(2, 4);
    const seconds = time.length >= 6 ? time.slice(4, 6) : '00';
    return `${formattedDate}T${hours}:${minutes}:${seconds}`;
  }
  
  return formattedDate;
}

/**
 * Formatea DateTime DICOM (YYYYMMDDHHMMSS) a ISO
 */
function formatDateTimeDT(dt: string): string {
  if (!dt || dt.length < 8) return '';
  const date = dt.slice(0, 8);
  const time = dt.length >= 14 ? dt.slice(8, 14) : '';
  return formatDateTime(date, time);
}

/**
 * Convierte fecha ISO a DICOM (YYYYMMDD)
 */
function toDigomDate(isoDate: string): string {
  return isoDate.replace(/-/g, '').slice(0, 8);
}

// =====================================================
// QUERIES
// =====================================================

/**
 * Construye query params para QIDO-RS MWL
 */
function buildQidoMwlParams(query: WorklistQuery): URLSearchParams {
  const params = new URLSearchParams();
  
  // Fecha programada
  if (query.date) {
    params.append('00400002', query.date); // ScheduledProcedureStepStartDate
  } else {
    // Por defecto: hoy
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    params.append('00400002', today);
  }
  
  // Filtros
  if (query.patientID) {
    params.append('00100020', query.patientID);
  }
  if (query.patientName) {
    params.append('00100010', query.patientName);
  }
  if (query.modality) {
    params.append('00080060', query.modality);
  }
  if (query.accessionNumber) {
    params.append('00080050', query.accessionNumber);
  }
  if (query.stationAET) {
    params.append('00400001', query.stationAET);
  }
  
  // Paginación
  if (query.limit) {
    params.append('limit', String(query.limit));
  }
  if (query.offset) {
    params.append('offset', String(query.offset));
  }
  
  // Incluir campos comunes
  params.append('includefield', '00100010'); // Patient Name
  params.append('includefield', '00100020'); // Patient ID
  params.append('includefield', '00100030'); // Birth Date
  params.append('includefield', '00100040'); // Sex
  params.append('includefield', '00080050'); // Accession Number
  params.append('includefield', '00080090'); // Referring Physician
  params.append('includefield', '00321060'); // Requested Procedure Description
  params.append('includefield', '00400100'); // Scheduled Procedure Step Sequence
  
  return params;
}

/**
 * Construye query params para UPS-RS
 */
function buildUpsParams(query: WorklistQuery): URLSearchParams {
  const params = new URLSearchParams();
  
  // Solo workitems SCHEDULED
  params.append('00741000', 'SCHEDULED'); // Procedure Step State
  
  // Fecha programada (UPS usa DateTime combinado)
  if (query.date) {
    // Rango de fecha completo
    const dateStart = query.date.includes('-') ? query.date.split('-')[0] : query.date;
    params.append('00404005', `${dateStart}000000-${dateStart}235959`);
  }
  
  // Filtros
  if (query.patientID) {
    params.append('00100020', query.patientID);
  }
  if (query.patientName) {
    params.append('00100010', query.patientName);
  }
  if (query.modality) {
    params.append('00080060', query.modality);
  }
  if (query.accessionNumber) {
    params.append('00080050', query.accessionNumber);
  }
  
  // Paginación
  if (query.limit) {
    params.append('limit', String(query.limit));
  }
  if (query.offset) {
    params.append('offset', String(query.offset));
  }
  
  return params;
}

// =====================================================
// API PRINCIPAL
// =====================================================

/**
 * Consulta la Worklist desde Synapse
 */
export async function queryWorklist(query: WorklistQuery = {}): Promise<{
  success: boolean;
  items: WorklistItem[];
  total?: number;
  error?: string;
  source?: 'ups-rs' | 'qido-mwl';
}> {
  try {
    // Intentar UPS-RS primero si está configurado
    if (worklistConfig.preferUps) {
      const upsResult = await queryUpsWorklist(query);
      if (upsResult.success) {
        return { ...upsResult, source: 'ups-rs' };
      }
      console.log('⚠️ UPS-RS falló, intentando QIDO-RS MWL...');
    }
    
    // Fallback o preferencia: QIDO-RS MWL
    const qidoResult = await queryQidoMwl(query);
    return { ...qidoResult, source: 'qido-mwl' };
    
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    console.error('❌ Error consultando Worklist:', message);
    return { success: false, items: [], error: message };
  }
}

/**
 * Consulta Worklist via UPS-RS
 */
async function queryUpsWorklist(query: WorklistQuery): Promise<{
  success: boolean;
  items: WorklistItem[];
  total?: number;
  error?: string;
}> {
  const params = buildUpsParams(query);
  const url = `${worklistConfig.baseUrl}${worklistConfig.upsPath}?${params.toString()}`;
  
  console.log(`📋 UPS-RS Query: ${url}`);
  
  const response = await fetch(url, {
    method: 'GET',
    headers: getAuthHeaders()
  });
  
  if (!response.ok) {
    throw new Error(`UPS-RS HTTP ${response.status}: ${response.statusText}`);
  }
  
  const data = await response.json();
  const items = Array.isArray(data) ? data.map(parseUpsWorkitem) : [];
  
  console.log(`✅ UPS-RS: ${items.length} workitems encontrados`);
  
  return {
    success: true,
    items,
    total: items.length
  };
}

/**
 * Consulta Worklist via QIDO-RS (MWL)
 */
async function queryQidoMwl(query: WorklistQuery): Promise<{
  success: boolean;
  items: WorklistItem[];
  total?: number;
  error?: string;
}> {
  const params = buildQidoMwlParams(query);
  const url = `${worklistConfig.baseUrl}${worklistConfig.qidoMwlPath}?${params.toString()}`;
  
  console.log(`📋 QIDO-RS MWL Query: ${url}`);
  
  const response = await fetch(url, {
    method: 'GET',
    headers: getAuthHeaders()
  });
  
  if (!response.ok) {
    throw new Error(`QIDO-RS MWL HTTP ${response.status}: ${response.statusText}`);
  }
  
  const data = await response.json();
  const items = Array.isArray(data) ? data.map(parseWorklistItem) : [];
  
  console.log(`✅ QIDO-RS MWL: ${items.length} items encontrados`);
  
  return {
    success: true,
    items,
    total: items.length
  };
}

/**
 * Obtiene un item específico de la Worklist por Accession Number
 */
export async function getWorklistItem(accessionNumber: string): Promise<{
  success: boolean;
  item?: WorklistItem;
  error?: string;
}> {
  const result = await queryWorklist({ accessionNumber });
  
  if (!result.success) {
    return { success: false, error: result.error };
  }
  
  const item = result.items.find(i => i.accessionNumber === accessionNumber);
  
  if (!item) {
    return { success: false, error: 'Item no encontrado' };
  }
  
  return { success: true, item };
}

/**
 * Actualiza el estado de un UPS Workitem (solo si usa UPS-RS)
 */
export async function updateWorkitemState(
  workitemUID: string, 
  newState: 'IN PROGRESS' | 'COMPLETED' | 'CANCELED',
  transactionUID?: string
): Promise<{ success: boolean; error?: string }> {
  if (!worklistConfig.preferUps) {
    return { success: false, error: 'Actualización de estado solo disponible con UPS-RS' };
  }
  
  const url = `${worklistConfig.baseUrl}${worklistConfig.upsPath}/${workitemUID}/state`;
  
  // El body depende del estado
  const statePayload: any = {
    '00741000': { vr: 'CS', Value: [newState] }
  };
  
  if (transactionUID) {
    statePayload['00081195'] = { vr: 'UI', Value: [transactionUID] };
  }
  
  try {
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        ...getAuthHeaders(),
        'Content-Type': 'application/dicom+json'
      },
      body: JSON.stringify(statePayload)
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    console.log(`✅ Workitem ${workitemUID} actualizado a ${newState}`);
    return { success: true };
    
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    console.error(`❌ Error actualizando workitem: ${message}`);
    return { success: false, error: message };
  }
}

/**
 * Obtiene configuración actual del servicio
 */
export function getWorklistConfig(): Omit<WorklistConfig, 'password' | 'token'> {
  return {
    baseUrl: worklistConfig.baseUrl,
    authType: worklistConfig.authType,
    username: worklistConfig.username,
    upsPath: worklistConfig.upsPath,
    qidoMwlPath: worklistConfig.qidoMwlPath,
    preferUps: worklistConfig.preferUps
  };
}
