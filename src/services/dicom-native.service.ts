/**
 * DICOM Native Service - Andex Gateway
 * ======================================
 * Implementa C-ECHO y C-FIND MWL (Modality Worklist)
 * via protocolo DICOM nativo (TCP/DIMSE) usando dcmjs-dimse.
 *
 * Esto permite conectar con PACS que solo exponen DICOM nativo
 * (sin DICOMweb/REST), como Synapse, DCM4CHEE, Conquest, etc.
 */

// dcmjs-dimse es CommonJS, usamos import dinamico
// En produccion (node dist/), el modulo CJS queda en .default
let _dcmjsDimse: any = null;

async function getDcmjsDimse() {
  if (!_dcmjsDimse) {
    const mod = await import('dcmjs-dimse');
    _dcmjsDimse = mod.default || mod;
  }
  return _dcmjsDimse;
}

// =====================================================
// TIPOS
// =====================================================

export interface DicomNativeConfig {
  host: string;
  port: number;
  callingAeTitle: string;   // AE Title del Gateway (local)
  calledAeTitle: string;    // AE Title del PACS (remoto)
  timeout?: number;         // Timeout en ms (default 10000)
}

export interface CEchoResult {
  success: boolean;
  latencyMs: number;
  error?: string;
  details?: {
    host: string;
    port: number;
    callingAeTitle: string;
    calledAeTitle: string;
  };
}

export interface MwlItem {
  accessionNumber: string;
  studyInstanceUID: string;
  scheduledProcedureStepID: string;
  requestedProcedureID: string;
  patientID: string;
  patientName: string;
  patientBirthDate: string;
  patientSex: string;
  scheduledDateTime: string;
  modality: string;
  scheduledStationAET: string;
  scheduledStationName: string;
  scheduledProcedureDescription: string;
  requestedProcedureDescription: string;
  referringPhysicianName: string;
  scheduledPerformingPhysician: string;
  institutionName: string;
  departmentName: string;
  procedureStepState: 'SCHEDULED' | 'IN PROGRESS' | 'COMPLETED' | 'CANCELED';
}

export interface MwlQueryFilters {
  date?: string;
  patientID?: string;
  patientName?: string;
  modality?: string;
  accessionNumber?: string;
  scheduledStationAET?: string;
}

export interface MwlQueryResult {
  success: boolean;
  items: MwlItem[];
  total: number;
  latencyMs: number;
  error?: string;
}

// =====================================================
// C-ECHO (Verificacion de conectividad DICOM)
// =====================================================

/**
 * Ejecuta un C-ECHO (DICOM ping) real contra el PACS.
 * Establece una asociacion DICOM completa y envia un C-ECHO SCU.
 */
export async function nativeCEcho(cfg: DicomNativeConfig): Promise<CEchoResult> {
  const timeout = cfg.timeout || 10000;
  const startTime = Date.now();

  try {
    const dcmjsDimse = await getDcmjsDimse();
    const { Client } = dcmjsDimse;
    const { CEchoRequest } = dcmjsDimse.requests;
    const { Status } = dcmjsDimse.constants;

    return await new Promise<CEchoResult>((resolve) => {
      const timer = setTimeout(() => {
        resolve({
          success: false,
          latencyMs: Date.now() - startTime,
          error: `Timeout (${timeout}ms) - el PACS no respondio al C-ECHO`,
          details: { host: cfg.host, port: cfg.port, callingAeTitle: cfg.callingAeTitle, calledAeTitle: cfg.calledAeTitle },
        });
      }, timeout);

      const client = new Client();
      const request = new CEchoRequest();

      request.on('response', (response: any) => {
        clearTimeout(timer);
        if (response.getStatus() === Status.Success) {
          resolve({
            success: true,
            latencyMs: Date.now() - startTime,
            details: { host: cfg.host, port: cfg.port, callingAeTitle: cfg.callingAeTitle, calledAeTitle: cfg.calledAeTitle },
          });
        } else {
          resolve({
            success: false,
            latencyMs: Date.now() - startTime,
            error: `C-ECHO respondio con status: 0x${response.getStatus().toString(16)}`,
            details: { host: cfg.host, port: cfg.port, callingAeTitle: cfg.callingAeTitle, calledAeTitle: cfg.calledAeTitle },
          });
        }
      });

      client.on('networkError', (e: Error) => {
        clearTimeout(timer);
        resolve({
          success: false,
          latencyMs: Date.now() - startTime,
          error: `Error de red: ${e.message}`,
          details: { host: cfg.host, port: cfg.port, callingAeTitle: cfg.callingAeTitle, calledAeTitle: cfg.calledAeTitle },
        });
      });

      client.on('closed', () => {
        clearTimeout(timer);
      });

      client.addRequest(request);
      client.send(cfg.host, cfg.port, cfg.callingAeTitle, cfg.calledAeTitle);
    });
  } catch (error) {
    return {
      success: false,
      latencyMs: Date.now() - startTime,
      error: `Error inicializando C-ECHO: ${error instanceof Error ? error.message : String(error)}`,
      details: { host: cfg.host, port: cfg.port, callingAeTitle: cfg.callingAeTitle, calledAeTitle: cfg.calledAeTitle },
    };
  }
}

// =====================================================
// C-FIND MWL (Modality Worklist Query)
// =====================================================

/**
 * Ejecuta una consulta C-FIND MWL (Modality Worklist) contra el PACS.
 * Retorna los procedimientos agendados para la fecha/filtros indicados.
 */
export async function nativeCFindMWL(
  cfg: DicomNativeConfig,
  filters: MwlQueryFilters = {}
): Promise<MwlQueryResult> {
  const timeout = cfg.timeout || 15000;
  const startTime = Date.now();

  try {
    const dcmjsDimse = await getDcmjsDimse();
    const { Client } = dcmjsDimse;
    const { CFindRequest } = dcmjsDimse.requests;
    const { Status } = dcmjsDimse.constants;

    // Construir elementos de consulta MWL
    const queryElements: Record<string, any> = {};

    if (filters.patientID) {
      queryElements.PatientID = filters.patientID;
    }
    if (filters.patientName) {
      queryElements.PatientName = filters.patientName;
    }
    if (filters.accessionNumber) {
      queryElements.AccessionNumber = filters.accessionNumber;
    }
    if (filters.modality) {
      queryElements.Modality = filters.modality;
    }
    if (filters.date) {
      queryElements.ScheduledProcedureStepStartDate = filters.date;
    }
    if (filters.scheduledStationAET) {
      queryElements.ScheduledStationAETitle = filters.scheduledStationAET;
    }

    // Crear la request MWL (usa SopClass.ModalityWorklistInformationModelFind)
    const request = CFindRequest.createWorklistFindRequest(queryElements);

    return await new Promise<MwlQueryResult>((resolve) => {
      const items: MwlItem[] = [];
      let resolved = false;

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve({
            success: false,
            items: [],
            total: 0,
            latencyMs: Date.now() - startTime,
            error: `Timeout (${timeout}ms) - C-FIND MWL sin respuesta`,
          });
        }
      }, timeout);

      request.on('response', (response: any) => {
        if (response.getStatus() === Status.Pending && response.hasDataset()) {
          try {
            const dataset = response.getDataset();
            const item = parseMwlDataset(dataset);
            items.push(item);
          } catch (parseErr) {
            console.warn('Warning: Error parseando MWL item:', parseErr);
          }
        } else if (response.getStatus() === Status.Success) {
          clearTimeout(timer);
          if (!resolved) {
            resolved = true;
            console.log(`C-FIND MWL: ${items.length} items recibidos en ${Date.now() - startTime}ms`);
            resolve({
              success: true,
              items,
              total: items.length,
              latencyMs: Date.now() - startTime,
            });
          }
        } else if (response.getStatus() === Status.Cancel) {
          clearTimeout(timer);
          if (!resolved) {
            resolved = true;
            resolve({
              success: true,
              items,
              total: items.length,
              latencyMs: Date.now() - startTime,
            });
          }
        } else {
          clearTimeout(timer);
          if (!resolved) {
            resolved = true;
            resolve({
              success: false,
              items: [],
              total: 0,
              latencyMs: Date.now() - startTime,
              error: `C-FIND MWL status: 0x${response.getStatus().toString(16)}`,
            });
          }
        }
      });

      const client = new Client();

      client.on('networkError', (e: Error) => {
        clearTimeout(timer);
        if (!resolved) {
          resolved = true;
          resolve({
            success: false,
            items: [],
            total: 0,
            latencyMs: Date.now() - startTime,
            error: `Error de red: ${e.message}`,
          });
        }
      });

      client.on('closed', () => {
        clearTimeout(timer);
        if (!resolved) {
          resolved = true;
          resolve({
            success: items.length > 0,
            items,
            total: items.length,
            latencyMs: Date.now() - startTime,
          });
        }
      });

      client.addRequest(request);
      client.send(cfg.host, cfg.port, cfg.callingAeTitle, cfg.calledAeTitle);
    });
  } catch (error) {
    return {
      success: false,
      items: [],
      total: 0,
      latencyMs: Date.now() - startTime,
      error: `Error inicializando C-FIND MWL: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// =====================================================
// PARSER: Dataset dcmjs -> MwlItem
// =====================================================

function parseMwlDataset(dataset: any): MwlItem {
  const safeGet = (tag: string, fallback: string = ''): string => {
    try {
      const val = dataset.getElement(tag);
      if (val === undefined || val === null) return fallback;
      if (typeof val === 'object' && val.Alphabetic) return val.Alphabetic;
      return String(val);
    } catch {
      return fallback;
    }
  };

  // Scheduled Procedure Step Sequence - extraer primer item
  let spsDataset: any = null;
  try {
    const spsSeq = dataset.getElement('ScheduledProcedureStepSequence');
    if (Array.isArray(spsSeq) && spsSeq.length > 0) {
      spsDataset = spsSeq[0];
    }
  } catch { /* ignore */ }

  const spsGet = (tag: string, fallback: string = ''): string => {
    if (!spsDataset) return fallback;
    try {
      const val = spsDataset.getElement ? spsDataset.getElement(tag) : spsDataset[tag];
      if (val === undefined || val === null) return fallback;
      if (typeof val === 'object' && val.Alphabetic) return val.Alphabetic;
      return String(val);
    } catch {
      return fallback;
    }
  };

  const spsDate = spsGet('ScheduledProcedureStepStartDate');
  const spsTime = spsGet('ScheduledProcedureStepStartTime');
  const scheduledDateTime = formatDicomDateTime(spsDate, spsTime);

  return {
    accessionNumber: safeGet('AccessionNumber'),
    studyInstanceUID: safeGet('StudyInstanceUID'),
    scheduledProcedureStepID: spsGet('ScheduledProcedureStepID'),
    requestedProcedureID: safeGet('RequestedProcedureID'),
    patientID: safeGet('PatientID'),
    patientName: safeGet('PatientName'),
    patientBirthDate: formatDicomDate(safeGet('PatientBirthDate')),
    patientSex: safeGet('PatientSex'),
    scheduledDateTime,
    modality: spsGet('Modality', 'ES'),
    scheduledStationAET: spsGet('ScheduledStationAETitle'),
    scheduledStationName: spsGet('ScheduledStationName'),
    scheduledProcedureDescription: spsGet('ScheduledProcedureStepDescription'),
    requestedProcedureDescription: safeGet('RequestedProcedureDescription'),
    referringPhysicianName: safeGet('ReferringPhysicianName'),
    scheduledPerformingPhysician: spsGet('ScheduledPerformingPhysicianName'),
    institutionName: safeGet('InstitutionName'),
    departmentName: safeGet('InstitutionalDepartmentName'),
    procedureStepState: 'SCHEDULED',
  };
}

// =====================================================
// UTILIDADES DE FORMATO
// =====================================================

function formatDicomDate(dicomDate: string): string {
  if (!dicomDate || dicomDate.length !== 8) return '';
  return `${dicomDate.slice(0, 4)}-${dicomDate.slice(4, 6)}-${dicomDate.slice(6, 8)}`;
}

function formatDicomDateTime(date: string, time: string): string {
  const formattedDate = formatDicomDate(date);
  if (!formattedDate) return '';
  if (time && time.length >= 4) {
    const h = time.slice(0, 2);
    const m = time.slice(2, 4);
    const s = time.length >= 6 ? time.slice(4, 6) : '00';
    return `${formattedDate}T${h}:${m}:${s}`;
  }
  return formattedDate;
}

/**
 * Convierte fecha ISO (YYYY-MM-DD) a DICOM (YYYYMMDD)
 */
export function toDicomDate(isoDate: string): string {
  return isoDate.replace(/-/g, '').slice(0, 8);
}
