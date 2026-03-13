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
} {
  const result: ReturnType<typeof extractDicomInfo> = {};
  
  try {
    // Check DICOM magic bytes (DICM at offset 128)
    if (data.length < 132) return result;
    const magic = data.slice(128, 132).toString('ascii');
    if (magic !== 'DICM') return result;

    // Simple tag extraction (not a full DICOM parser)
    // This is a minimal implementation - for production, use dcmjs or similar
    const dataStr = data.toString('latin1');
    
    // Patient Name (0010,0010)
    const patientNameMatch = dataStr.match(/\x10\x00\x10\x00.{4}([^\x00]{1,64})/);
    if (patientNameMatch) {
      result.patientName = patientNameMatch[1].trim();
    }

    // Patient ID (0010,0020)
    const patientIdMatch = dataStr.match(/\x10\x00\x20\x00.{4}([^\x00]{1,64})/);
    if (patientIdMatch) {
      result.patientId = patientIdMatch[1].trim();
    }

    // Modality (0008,0060)
    const modalityMatch = dataStr.match(/\x08\x00\x60\x00.{4}([A-Z]{2,4})/);
    if (modalityMatch) {
      result.modality = modalityMatch[1].trim();
    }

    // Study Instance UID (0020,000D)
    const studyUIDMatch = dataStr.match(/\x20\x00\x0D\x00.{4}([\d.]{10,64})/);
    if (studyUIDMatch) {
      result.studyUID = studyUIDMatch[1].trim();
    }

    // Series Instance UID (0020,000E)
    const seriesUIDMatch = dataStr.match(/\x20\x00\x0E\x00.{4}([\d.]{10,64})/);
    if (seriesUIDMatch) {
      result.seriesUID = seriesUIDMatch[1].trim();
    }

    // SOP Instance UID (0008,0018)
    const sopUIDMatch = dataStr.match(/\x08\x00\x18\x00.{4}([\d.]{10,64})/);
    if (sopUIDMatch) {
      result.sopInstanceUID = sopUIDMatch[1].trim();
    }

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
