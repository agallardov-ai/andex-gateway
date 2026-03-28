import { config } from '../config/env.js';
import { configStore } from '../config/config-store.js';
import { checkOrthancHealth, uploadToOrthanc } from './orthanc.service.js';
import { checkDicomwebHealth, uploadViaDicomweb } from './dicomweb.service.js';
import { nativeCEcho, nativeCStore } from './dicom-native.service.js';

/**
 * Unified PACS Service
 * Automatically routes to Orthanc REST API or DICOMweb STOW-RS
 * based on PACS_TYPE configuration
 */

export interface PacsUploadResult {
  success: boolean;
  pacsId?: string;
  sopInstanceUid?: string;
  error?: string;
}

export interface PacsHealthResult {
  ok: boolean;
  type: string;
  version?: string;
  error?: string;
}

// Check PACS health based on configured type
export async function checkPacsHealth(): Promise<PacsHealthResult> {
  const pacsType = config.pacsType;
  
  if (pacsType === 'dicomweb') {
    const result = await checkDicomwebHealth();
    return {
      ok: result.ok,
      type: 'DICOMweb (FUJIFILM Synapse)',
      version: result.version,
      error: result.error,
    };
  }

  if (pacsType === 'dicom-native') {
    const s = configStore.getAll();
    const host = (s.pacsDicomHost || config.pacsDicomHost) as string;
    const port = (s.pacsDicomPort || config.pacsDicomPort) as number;
    const calledAeTitle = (s.pacsAeTitle || config.pacsAeTitle) as string;
    const callingAeTitle = (s.gatewayAeTitle || config.gatewayAeTitle) as string;

    if (!host || !calledAeTitle) {
      return {
        ok: false,
        type: 'DICOM Nativo (C-ECHO)',
        error: 'PACS_DICOM_HOST o PACS_AE_TITLE no configurado',
      };
    }

    const result = await nativeCEcho({ host, port, callingAeTitle, calledAeTitle, timeout: 10000 });
    return {
      ok: result.success,
      type: `DICOM Nativo (${calledAeTitle}@${host}:${port})`,
      version: result.success ? `C-ECHO OK (${result.latencyMs}ms)` : undefined,
      error: result.error,
    };
  }
  
  // Default: Orthanc
  const result = await checkOrthancHealth();
  return {
    ok: result.ok,
    type: 'Orthanc REST API',
    version: result.version,
    error: result.error,
  };
}

// Upload DICOM file based on configured PACS type
export async function uploadToPacs(filepath: string): Promise<PacsUploadResult> {
  const pacsType = config.pacsType;
  
  if (pacsType === 'dicomweb') {
    const result = await uploadViaDicomweb(filepath);
    return {
      success: result.success,
      pacsId: result.orthancId,
      sopInstanceUid: result.sopInstanceUid,
      error: result.error,
    };
  }

  if (pacsType === 'dicom-native') {
    const s = configStore.getAll();
    const host = (s.pacsDicomHost || config.pacsDicomHost) as string;
    const port = (s.pacsDicomPort || config.pacsDicomPort) as number;
    const calledAeTitle = (s.pacsAeTitle || config.pacsAeTitle) as string;
    const callingAeTitle = (s.gatewayAeTitle || config.gatewayAeTitle) as string;

    if (!host || !calledAeTitle) {
      return {
        success: false,
        error: 'DICOM Nativo: PACS_DICOM_HOST o PACS_AE_TITLE no configurado',
      };
    }

    console.log(`[PACS] Enviando via C-STORE nativo a ${calledAeTitle}@${host}:${port}...`);
    const result = await nativeCStore(
      { host, port, callingAeTitle, calledAeTitle, timeout: 30000 },
      filepath
    );
    return {
      success: result.success,
      sopInstanceUid: result.sopInstanceUid,
      error: result.error,
    };
  }
  
  // Default: Orthanc
  const result = await uploadToOrthanc(filepath);
  return {
    success: result.success,
    pacsId: result.orthancId,
    error: result.error,
  };
}

// Get PACS connection info for display
export function getPacsInfo(): { type: string; url: string; authType: string } {
  if (config.pacsType === 'dicom-native') {
    const s = configStore.getAll();
    const host = (s.pacsDicomHost || config.pacsDicomHost) as string;
    const port = (s.pacsDicomPort || config.pacsDicomPort) as number;
    const aet = (s.pacsAeTitle || config.pacsAeTitle) as string;
    return {
      type: 'DICOM Nativo (C-STORE)',
      url: `dicom://${aet}@${host}:${port}`,
      authType: 'AE Title',
    };
  }
  return {
    type: config.pacsType === 'dicomweb' ? 'DICOMweb (FUJIFILM Synapse 7)' : 'Orthanc',
    url: config.pacsUrl,
    authType: config.pacsAuthType,
  };
}
