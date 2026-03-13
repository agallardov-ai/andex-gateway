import { config } from '../config/env.js';
import { 
  getJobsForRetry, 
  updateJobStatus, 
  incrementJobAttempts,
  deleteOldSentJobs,
  getJobs
} from '../db/database.js';
import { uploadToPacs } from './pacs.service.js';
import { recordPacsRequest, recordRetry, recordExpiredJob, log } from './observability.service.js';
import { fileExists, moveToProcessed, moveToFailed } from './storage.service.js';
import type { Job } from '../types/index.js';

let retryInterval: NodeJS.Timeout | null = null;
let cleanupInterval: NodeJS.Timeout | null = null;

// Process a single job
export async function processJob(job: Job): Promise<boolean> {
  console.log(`📤 Processing job ${job.id} (${job.filename}), attempt ${job.attempts + 1}/${job.max_attempts}`);
  
  // Check if file still exists
  if (!fileExists(job.filepath)) {
    console.warn(`⚠️ File not found for job ${job.id}: ${job.filepath}`);
    updateJobStatus(job.id, 'failed', { error_message: 'File not found' });
    return false;
  }

  // Mark as sending
  updateJobStatus(job.id, 'sending');
  incrementJobAttempts(job.id);
  recordRetry();

  // Try to upload to PACS (Orthanc or DICOMweb)
  const startTime = Date.now();
  const result = await uploadToPacs(job.filepath);
  const latency = Date.now() - startTime;
  
  // Record metrics
  recordPacsRequest(result.success, latency);

  if (result.success) {
    log('info', `Job sent successfully`, { jobId: job.id, pacsId: result.pacsId, latency });
    updateJobStatus(job.id, 'sent', { 
      orthanc_id: result.pacsId,
      sent_at: new Date().toISOString()
    });
    
    // Move file to processed folder after successful upload
    await moveToProcessed(job.filepath);
    return true;
  } else {
    log('error', `Job failed`, { jobId: job.id, error: result.error, latency });
    updateJobStatus(job.id, 'failed', { error_message: result.error });
    
    // If max attempts reached, move to failed folder
    if (job.attempts + 1 >= job.max_attempts) {
      log('warn', `Job exceeded max attempts, moving to failed`, { jobId: job.id, attempts: job.attempts + 1 });
      await moveToFailed(job.filepath);
    }
    return false;
  }
}

// Process pending/failed jobs
export async function processRetryQueue(): Promise<{ processed: number; success: number; failed: number }> {
  const jobs = getJobsForRetry();
  
  if (jobs.length === 0) {
    return { processed: 0, success: 0, failed: 0 };
  }

  console.log(`🔄 Processing ${jobs.length} job(s) in retry queue...`);
  
  let success = 0;
  let failed = 0;

  for (const job of jobs) {
    const result = await processJob(job);
    if (result) {
      success++;
    } else {
      failed++;
    }
  }

  return { processed: jobs.length, success, failed };
}

// Cleanup old sent jobs and their files
export async function runCleanup(): Promise<{ deletedJobs: number; deletedFiles: number }> {
  console.log('🧹 Running cleanup...');
  
  // Get sent jobs older than configured hours
  const deletedJobs = deleteOldSentJobs(config.cleanupAfterHours);
  
  // Record expired jobs
  for (let i = 0; i < deletedJobs; i++) {
    recordExpiredJob();
  }
  
  // Clean up orphaned files
  const allJobs = getJobs({ limit: 10000 });
  const validPaths = new Set(allJobs.map(j => j.filepath));
  
  let deletedFiles = 0;
  // Note: Actual file cleanup could be done here if needed
  
  log('info', `Cleanup complete`, { deletedJobs, deletedFiles });
  
  return { deletedJobs, deletedFiles };
}

// Start the retry worker
export function startRetryWorker(): void {
  if (retryInterval) {
    console.log('⚠️ Retry worker already running');
    return;
  }

  console.log(`🔄 Starting retry worker (interval: ${config.retryIntervalMs}ms)`);
  
  // Run immediately on start
  processRetryQueue().catch(console.error);
  
  // Then run on interval
  retryInterval = setInterval(() => {
    processRetryQueue().catch(console.error);
  }, config.retryIntervalMs);
}

// Start the cleanup worker
export function startCleanupWorker(): void {
  if (cleanupInterval) {
    console.log('⚠️ Cleanup worker already running');
    return;
  }

  const cleanupIntervalMs = 60 * 60 * 1000; // 1 hour
  console.log(`🧹 Starting cleanup worker (interval: 1 hour)`);
  
  cleanupInterval = setInterval(() => {
    runCleanup().catch(console.error);
  }, cleanupIntervalMs);
}

// Stop workers
export function stopWorkers(): void {
  if (retryInterval) {
    clearInterval(retryInterval);
    retryInterval = null;
  }
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
  console.log('⏹️ Workers stopped');
}
