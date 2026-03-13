import { config } from '../config/env.js';
import { readFile } from './storage.service.js';
import type { OrthancResponse } from '../types/index.js';

interface OrthancSystemInfo {
  ApiVersion: number;
  DicomAet: string;
  DicomPort: number;
  HttpPort: number;
  Name: string;
  Version: string;
}

// Build authorization header if credentials are configured
function getAuthHeader(): Record<string, string> {
  if (config.orthancUsername && config.orthancPassword) {
    const credentials = Buffer.from(`${config.orthancUsername}:${config.orthancPassword}`).toString('base64');
    return { 'Authorization': `Basic ${credentials}` };
  }
  return {};
}

// Check if Orthanc is reachable
export async function checkOrthancHealth(): Promise<{ ok: boolean; version?: string; error?: string }> {
  try {
    const response = await fetch(`${config.orthancUrl}/system`, {
      method: 'GET',
      headers: {
        ...getAuthHeader(),
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` };
    }

    const data = await response.json() as OrthancSystemInfo;
    return { ok: true, version: data.Version };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { ok: false, error: message };
  }
}

// Upload a single DICOM file to Orthanc
export async function uploadToOrthanc(filepath: string): Promise<{
  success: boolean;
  orthancId?: string;
  error?: string;
}> {
  try {
    const fileBuffer = await readFile(filepath);
    
    const response = await fetch(`${config.orthancUrl}/instances`, {
      method: 'POST',
      headers: {
        ...getAuthHeader(),
        'Content-Type': 'application/dicom',
      },
      body: fileBuffer,
      signal: AbortSignal.timeout(60000), // 60s timeout for large files
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { 
        success: false, 
        error: `Orthanc error ${response.status}: ${errorText}` 
      };
    }

    const data = await response.json() as OrthancResponse;
    
    // Orthanc returns different statuses
    if (data.Status === 'Success' || data.Status === 'AlreadyStored') {
      return { 
        success: true, 
        orthancId: data.ID 
      };
    }

    return { 
      success: false, 
      error: `Unexpected Orthanc status: ${data.Status}` 
    };

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: message };
  }
}

// Upload multiple DICOM files as a batch
export async function uploadBatchToOrthanc(filepaths: string[]): Promise<{
  success: number;
  failed: number;
  results: Array<{ filepath: string; success: boolean; orthancId?: string; error?: string }>;
}> {
  const results: Array<{ filepath: string; success: boolean; orthancId?: string; error?: string }> = [];
  let success = 0;
  let failed = 0;

  for (const filepath of filepaths) {
    const result = await uploadToOrthanc(filepath);
    results.push({
      filepath,
      ...result,
    });

    if (result.success) {
      success++;
    } else {
      failed++;
    }
  }

  return { success, failed, results };
}

// Get instance details from Orthanc
export async function getOrthancInstance(orthancId: string): Promise<unknown | null> {
  try {
    const response = await fetch(`${config.orthancUrl}/instances/${orthancId}`, {
      method: 'GET',
      headers: {
        ...getAuthHeader(),
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch {
    return null;
  }
}

// Get Orthanc statistics
export async function getOrthancStats(): Promise<{
  totalInstances: number;
  totalStudies: number;
  totalPatients: number;
} | null> {
  try {
    const response = await fetch(`${config.orthancUrl}/statistics`, {
      method: 'GET',
      headers: {
        ...getAuthHeader(),
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as {
      CountInstances: number;
      CountStudies: number;
      CountPatients: number;
    };

    return {
      totalInstances: data.CountInstances,
      totalStudies: data.CountStudies,
      totalPatients: data.CountPatients,
    };
  } catch {
    return null;
  }
}
