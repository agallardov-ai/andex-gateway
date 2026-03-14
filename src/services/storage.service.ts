import fs from 'fs';
import path from 'path';
import { config } from '../config/env.js';

// Storage paths
const STORAGE_PATHS = {
  incoming: path.join(config.dataDir, 'incoming'),   // Archivos recién recibidos
  pending: path.join(config.dataDir, 'pending'),     // En cola de envío
  processed: path.join(config.dataDir, 'processed'), // Enviados exitosamente
  failed: path.join(config.dataDir, 'failed'),       // Fallidos (para retry manual)
  logs: path.join(config.dataDir, 'logs'),           // Logs persistentes
};

// Ensure all storage directories exist
export function initStorage(): void {
  Object.entries(STORAGE_PATHS).forEach(([name, dir]) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`📁 Storage initialized: ${name} → ${dir}`);
    }
  });
  console.log('✅ Storage ready');
}

// Get storage path by type
export function getStoragePath(type: keyof typeof STORAGE_PATHS): string {
  return STORAGE_PATHS[type];
}

// Save uploaded file to incoming directory
export async function saveFile(filename: string, data: Buffer): Promise<string> {
  const timestamp = Date.now();
  const safeFilename = `${timestamp}_${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const filepath = path.join(STORAGE_PATHS.incoming, safeFilename);
  
  await fs.promises.writeFile(filepath, data);
  return filepath;
}

// Move file between storage directories
export async function moveFile(
  filepath: string, 
  destination: 'pending' | 'processed' | 'failed'
): Promise<string> {
  const filename = path.basename(filepath);
  const newPath = path.join(STORAGE_PATHS[destination], filename);
  
  try {
    await fs.promises.rename(filepath, newPath);
    return newPath;
  } catch (error) {
    // Si rename falla (cross-device), copiar y eliminar
    await fs.promises.copyFile(filepath, newPath);
    await fs.promises.unlink(filepath);
    return newPath;
  }
}

// Move to pending (from incoming)
export async function moveToPending(filepath: string): Promise<string> {
  return moveFile(filepath, 'pending');
}

// Move to processed (upload successful)
export async function moveToProcessed(filepath: string): Promise<string> {
  return moveFile(filepath, 'processed');
}

// Move to failed (upload failed after max retries)
export async function moveToFailed(filepath: string): Promise<string> {
  return moveFile(filepath, 'failed');
}

// Delete a file from storage
export async function deleteFile(filepath: string): Promise<boolean> {
  try {
    if (fs.existsSync(filepath)) {
      await fs.promises.unlink(filepath);
      return true;
    }
    return false;
  } catch (error) {
    console.error(`Error deleting file ${filepath}:`, error);
    return false;
  }
}

// Read file from storage
export async function readFile(filepath: string): Promise<Buffer> {
  return fs.promises.readFile(filepath);
}

// Check if file exists
export function fileExists(filepath: string): boolean {
  return fs.existsSync(filepath);
}

// Get file size
export function getFileSize(filepath: string): number {
  try {
    const stats = fs.statSync(filepath);
    return stats.size;
  } catch {
    return 0;
  }
}

// Clean up old files not in database
export async function cleanupOrphanedFiles(validFilepaths: Set<string>): Promise<number> {
  let deleted = 0;
  
  try {
    const files = await fs.promises.readdir(config.pendingDir);
    
    for (const file of files) {
      const filepath = path.join(config.pendingDir, file);
      if (!validFilepaths.has(filepath)) {
        await deleteFile(filepath);
        deleted++;
      }
    }
  } catch (error) {
    console.error('Error cleaning up orphaned files:', error);
  }
  
  return deleted;
}

// Extract basic DICOM tags from file (minimal parsing)
export function extractDicomInfo(data: Buffer): {
  studyUID?: string;
  seriesUID?: string;
  sopInstanceUID?: string;
  patientId?: string;
  patientName?: string;
  modality?: string;
  accessionNumber?: string;
} {
  const result: ReturnType<typeof extractDicomInfo> = {};
  
  try {
    // Check DICOM magic bytes (DICM at offset 128)
    if (data.length < 132) return result;
    const magic = data.slice(128, 132).toString('ascii');
    if (magic !== 'DICM') return result;

    // Helper to find DICOM tag value
    // DICOM tags are little-endian: (0010,0020) is stored as 10 00 20 00
    function findTagValue(group: number, element: number, maxLen: number = 64): string | null {
      // Search for tag in little-endian format
      const groupLow = group & 0xFF;
      const groupHigh = (group >> 8) & 0xFF;
      const elemLow = element & 0xFF;
      const elemHigh = (element >> 8) & 0xFF;
      
      for (let i = 132; i < data.length - 10; i++) {
        if (data[i] === groupLow && 
            data[i+1] === groupHigh && 
            data[i+2] === elemLow && 
            data[i+3] === elemHigh) {
          // Found tag, now get VR and length
          // Could be explicit VR (2 bytes VR + 2 bytes length) or implicit
          const vr = String.fromCharCode(data[i+4], data[i+5]);
          let offset = 8; // Default for explicit VR short form
          let len = data.readUInt16LE(i + 6);
          
          // Check if explicit VR with 4-byte length (OB, OW, OF, SQ, UC, UR, UT, UN)
          if (['OB', 'OW', 'OF', 'SQ', 'UC', 'UR', 'UT', 'UN'].includes(vr)) {
            offset = 12;
            len = data.readUInt32LE(i + 8);
          }
          // Check if implicit VR (length at offset 4)
          else if (!vr.match(/^[A-Z]{2}$/)) {
            offset = 8;
            len = data.readUInt32LE(i + 4);
          }
          
          if (len > 0 && len <= maxLen && i + offset + len <= data.length) {
            let value = data.slice(i + offset, i + offset + len).toString('latin1');
            // Clean null bytes and trim
            value = value.replace(/\x00/g, '').trim();
            if (value.length > 0) return value;
          }
        }
      }
      return null;
    }

    // Patient Name (0010,0010)
    const patientName = findTagValue(0x0010, 0x0010);
    if (patientName) result.patientName = patientName;

    // Patient ID (0010,0020)
    const patientId = findTagValue(0x0010, 0x0020);
    if (patientId) result.patientId = patientId;

    // Modality (0008,0060)
    const modality = findTagValue(0x0008, 0x0060, 16);
    if (modality) result.modality = modality;

    // Accession Number (0008,0050)
    const accessionNumber = findTagValue(0x0008, 0x0050);
    if (accessionNumber) result.accessionNumber = accessionNumber;

    // Study Instance UID (0020,000D)
    const studyUID = findTagValue(0x0020, 0x000D, 128);
    if (studyUID) result.studyUID = studyUID;

    // Series Instance UID (0020,000E)
    const seriesUID = findTagValue(0x0020, 0x000E, 128);
    if (seriesUID) result.seriesUID = seriesUID;

    // SOP Instance UID (0008,0018)
    const sopInstanceUID = findTagValue(0x0008, 0x0018, 128);
    if (sopInstanceUID) result.sopInstanceUID = sopInstanceUID;

  } catch (error) {
    console.warn('Error extracting DICOM info:', error);
  }
  
  return result;
}

// Validate DICOM file (basic check)
export function isValidDicom(data: Buffer): boolean {
  if (data.length < 132) return false;
  const magic = data.slice(128, 132).toString('ascii');
  return magic === 'DICM';
}
