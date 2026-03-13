import { config } from '../config/env.js';
import { checkOrthancHealth, uploadToOrthanc } from './orthanc.service.js';
import { checkDicomwebHealth, uploadViaDicomweb } from './dicomweb.service.js';

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
  return {
    type: config.pacsType === 'dicomweb' ? 'DICOMweb (FUJIFILM Synapse 7)' : 'Orthanc',
    url: config.pacsUrl,
    authType: config.pacsAuthType,
  };
}
