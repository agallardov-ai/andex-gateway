import { config } from '../config/env.js';
import { readFile } from './storage.service.js';

/**
 * DICOMweb STOW-RS Service
 * Compatible with FUJIFILM Synapse 7 and other DICOMweb-compliant PACS
 * 
 * Standards:
 * - STOW-RS (Store Over the Web using RESTful Services)
 * - WADO-RS (Web Access to DICOM Objects using RESTful Services)  
 * - QIDO-RS (Query based on ID for DICOM Objects using RESTful Services)
 */

interface STOWResponse {
  '00081190'?: { Value: string[] }; // RetrieveURL
  '00081198'?: { Value: FailedSOPSequence[] }; // FailedSOPSequence
  '00081199'?: { Value: ReferencedSOPSequence[] }; // ReferencedSOPSequence
}

interface FailedSOPSequence {
  '00081150': { Value: string[] }; // ReferencedSOPClassUID
  '00081155': { Value: string[] }; // ReferencedSOPInstanceUID
  '00081197': { Value: number[] }; // FailureReason
}

interface ReferencedSOPSequence {
  '00081150': { Value: string[] }; // ReferencedSOPClassUID
  '00081155': { Value: string[] }; // ReferencedSOPInstanceUID
  '00081190'?: { Value: string[] }; // RetrieveURL
}

// Generate random boundary for multipart
function generateBoundary(): string {
  return `----DICOMwebBoundary${Date.now()}${Math.random().toString(36).substring(2)}`;
}

// Build authorization header
function getAuthHeader(): Record<string, string> {
  const headers: Record<string, string> = {};
  
  if (config.pacsAuthType === 'basic' && config.pacsUsername && config.pacsPassword) {
    const credentials = Buffer.from(`${config.pacsUsername}:${config.pacsPassword}`).toString('base64');
    headers['Authorization'] = `Basic ${credentials}`;
  } else if (config.pacsAuthType === 'bearer' && config.pacsToken) {
    headers['Authorization'] = `Bearer ${config.pacsToken}`;
  }
  
  return headers;
}

// Check DICOMweb server health using QIDO-RS
export async function checkDicomwebHealth(): Promise<{ ok: boolean; version?: string; error?: string }> {
  try {
    const qidoUrl = `${config.pacsUrl}${config.dicomwebQidoPath}?limit=1`;
    
    const response = await fetch(qidoUrl, {
      method: 'GET',
      headers: {
        ...getAuthHeader(),
        'Accept': 'application/dicom+json',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (response.ok || response.status === 204) {
      return { ok: true, version: 'DICOMweb STOW-RS' };
    }

    if (response.status === 401 || response.status === 403) {
      return { ok: false, error: `Authentication required (${response.status})` };
    }

    return { ok: false, error: `HTTP ${response.status}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { ok: false, error: message };
  }
}

// Upload DICOM using STOW-RS (multipart/related)
export async function uploadViaDicomweb(filepath: string): Promise<{
  success: boolean;
  orthancId?: string;
  sopInstanceUid?: string;
  error?: string;
}> {
  try {
    const fileBuffer = await readFile(filepath);
    const boundary = generateBoundary();
    
    // Build multipart/related body according to STOW-RS spec
    const CRLF = '\r\n';
    const parts: Buffer[] = [];
    
    // Part header
    parts.push(Buffer.from(
      `--${boundary}${CRLF}` +
      `Content-Type: application/dicom${CRLF}` +
      `Content-Length: ${fileBuffer.length}${CRLF}` +
      CRLF
    ));
    
    // DICOM file content
    parts.push(fileBuffer);
    
    // Part footer
    parts.push(Buffer.from(`${CRLF}--${boundary}--${CRLF}`));
    
    const body = Buffer.concat(parts);
    
    // STOW-RS endpoint
    const stowUrl = `${config.pacsUrl}${config.dicomwebStowPath}`;
    
    const response = await fetch(stowUrl, {
      method: 'POST',
      headers: {
        ...getAuthHeader(),
        'Content-Type': `multipart/related; type="application/dicom"; boundary="${boundary}"`,
        'Accept': 'application/dicom+json',
      },
      body: body,
      signal: AbortSignal.timeout(120000), // 2 min timeout
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { 
        success: false, 
        error: `STOW-RS error ${response.status}: ${errorText.substring(0, 500)}` 
      };
    }

    // Parse STOW-RS response
    const contentType = response.headers.get('content-type') || '';
    
    if (contentType.includes('application/dicom+json') || contentType.includes('application/json')) {
      const data = await response.json() as STOWResponse;
      
      // Check for failures
      if (data['00081198']?.Value?.length) {
        const failure = data['00081198'].Value[0];
        const reason = failure['00081197']?.Value?.[0] || 'Unknown';
        return { 
          success: false, 
          error: `STOW-RS failure reason: ${reason}` 
        };
      }
      
      // Get successful reference
      if (data['00081199']?.Value?.length) {
        const ref = data['00081199'].Value[0];
        const sopInstanceUid = ref['00081155']?.Value?.[0] || '';
        const retrieveUrl = ref['00081190']?.Value?.[0] || '';
        
        return { 
          success: true, 
          orthancId: retrieveUrl || sopInstanceUid,
          sopInstanceUid 
        };
      }
      
      return { success: true, orthancId: 'stored' };
    }
    
    // XML response or empty - valid for some implementations
    return { success: true, orthancId: 'stored' };

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: message };
  }
}

// Search for studies using QIDO-RS
export async function searchStudies(params: {
  patientId?: string;
  patientName?: string;
  studyDate?: string;
  modality?: string;
  limit?: number;
}): Promise<unknown[] | null> {
  try {
    const queryParams = new URLSearchParams();
    
    if (params.patientId) queryParams.append('PatientID', params.patientId);
    if (params.patientName) queryParams.append('PatientName', params.patientName);
    if (params.studyDate) queryParams.append('StudyDate', params.studyDate);
    if (params.modality) queryParams.append('ModalitiesInStudy', params.modality);
    if (params.limit) queryParams.append('limit', params.limit.toString());
    
    const url = `${config.pacsUrl}${config.dicomwebQidoPath}${queryParams.toString() ? '?' + queryParams.toString() : ''}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        ...getAuthHeader(),
        'Accept': 'application/dicom+json',
      },
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      return null;
    }

    return await response.json() as unknown[];
  } catch {
    return null;
  }
}

// Retrieve study metadata using WADO-RS
export async function getStudyMetadata(studyInstanceUid: string): Promise<unknown | null> {
  try {
    const response = await fetch(`${config.pacsUrl}${config.dicomwebQidoPath}/${studyInstanceUid}/metadata`, {
      method: 'GET',
      headers: {
        ...getAuthHeader(),
        'Accept': 'application/dicom+json',
      },
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch {
    return null;
  }
}
