/**
 * Cloud Queue Service
 * Polls Supabase dicom_queue for pending jobs uploaded by the PWA
 * when no local gateway was available, downloads DICOM from Storage,
 * and sends it to the local PACS.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config, supabaseConfig } from '../config/env.js';
import { uploadToPacs } from './pacs.service.js';
import { log } from './observability.service.js';

const POLL_INTERVAL_MS = parseInt(process.env.CLOUD_QUEUE_POLL_MS || '30000', 10);
const GATEWAY_ID = `gateway-${os.hostname()}`;

let pollTimer: NodeJS.Timeout | null = null;
let isProcessing = false;
let cloudSupabase: SupabaseClient | null = null;

function getCloudSupabase(): SupabaseClient | null {
  if (cloudSupabase) return cloudSupabase;
  const url = supabaseConfig.url;
  const key = supabaseConfig.anonKey || supabaseConfig.serviceKey;
  if (!url || !key) return null;
  cloudSupabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cloudSupabase;
}

// ========== Lifecycle ==========

export function startCloudQueuePoller(): void {
  if (process.env.ENABLE_CLOUD_QUEUE !== 'true') {
    log('info', 'Cloud DICOM queue disabled (ENABLE_CLOUD_QUEUE != true)');
    return;
  }

  if (!getCloudSupabase()) {
    log('warn', 'Cloud queue skipped — SUPABASE_URL + SUPABASE_ANON_KEY not set');
    return;
  }

  log('info', `Starting cloud queue poller (every ${POLL_INTERVAL_MS / 1000}s, gateway: ${GATEWAY_ID})`);

  // First run immediate
  pollQueue().catch(err => log('error', 'Cloud queue poll error', { error: String(err) }));

  pollTimer = setInterval(() => {
    pollQueue().catch(err => log('error', 'Cloud queue poll error', { error: String(err) }));
  }, POLL_INTERVAL_MS);
}

export function stopCloudQueuePoller(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    log('info', 'Cloud queue poller stopped');
  }
}

// ========== Queue processing ==========

async function pollQueue(): Promise<void> {
  if (isProcessing) return;
  isProcessing = true;

  try {
    const supabase = getCloudSupabase();
    if (!supabase) return;

    const centroId = config.centroId;
    if (!centroId) {
      log('warn', 'CENTRO_ID not set — cannot poll cloud queue');
      return;
    }

    const { data: jobs, error } = await supabase
      .rpc('gateway_poll_queue', { p_centro_id: centroId });

    if (error) {
      log('error', 'Error querying dicom_queue', { error: error.message });
      return;
    }

    if (!jobs || jobs.length === 0) return;

    log('info', `Cloud queue: ${jobs.length} pending job(s)`);

    for (const job of jobs) {
      await processCloudJob(supabase, job);
    }
  } finally {
    isProcessing = false;
  }
}

interface CloudJob {
  id: string;
  centro_id: string;
  evento_id: string;
  patient_rut?: string;
  patient_name?: string;
  study_instance_uid?: string;
  procedure_type?: string;
  storage_path: string;
  file_count: number;
  attempts: number;
  max_attempts: number;
}

async function processCloudJob(supabase: SupabaseClient, job: CloudJob): Promise<void> {
  const shortId = job.id.substring(0, 8);
  log('info', `Processing cloud job ${shortId}`, {
    patient: job.patient_name || job.patient_rut || 'unknown',
    procedure: job.procedure_type || 'unknown',
  });

  // Mark as processing
  await supabase
    .rpc('gateway_update_job', {
      p_job_id: job.id,
      p_status: 'processing',
      p_gateway_id: GATEWAY_ID,
      p_attempts: job.attempts + 1,
    });

  // Temp dir for downloaded files
  const tmpDir = path.join(os.tmpdir(), `andex-cloud-${job.id}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    // List DICOM files in Storage
    const { data: files, error: listError } = await supabase.storage
      .from('dicom')
      .list(job.storage_path);

    if (listError) throw new Error(`Storage list error: ${listError.message}`);

    const dicomFiles = (files || []).filter((f: { name: string }) => f.name.endsWith('.dcm'));
    if (dicomFiles.length === 0) throw new Error(`No .dcm files in ${job.storage_path}`);

    log('info', `  ${dicomFiles.length} DICOM file(s) found in Storage`);

    let sent = 0;
    let failed = 0;

    for (const file of dicomFiles) {
      const storagePath = `${job.storage_path}/${file.name}`;
      const localPath = path.join(tmpDir, file.name);

      try {
        // Download from Storage
        const { data: blob, error: dlError } = await supabase.storage
          .from('dicom')
          .download(storagePath);

        if (dlError || !blob) throw new Error(dlError?.message || 'Empty download');

        // Write to temp file (uploadToPacs expects a file path)
        const buffer = Buffer.from(await blob.arrayBuffer());
        fs.writeFileSync(localPath, buffer);

        // Send to local PACS
        const result = await uploadToPacs(localPath);

        if (result.success) {
          sent++;
          log('info', `  ✅ ${file.name} → PACS (${result.pacsId || 'ok'})`);
        } else {
          failed++;
          log('warn', `  ⚠️ ${file.name} PACS error: ${result.error}`);
        }
      } catch (fileErr) {
        failed++;
        log('error', `  ❌ ${file.name}: ${(fileErr as Error).message}`);
      }
    }

    // Update job status
    if (sent > 0 && failed === 0) {
      await supabase
        .rpc('gateway_update_job', {
          p_job_id: job.id,
          p_status: 'sent',
          p_gateway_id: GATEWAY_ID,
          p_attempts: job.attempts + 1,
        });
      log('info', `  Job ${shortId} complete: ${sent} files sent to PACS`);
    } else if (sent > 0) {
      // Partial — leave as pending for retry
      await supabase
        .rpc('gateway_update_job', {
          p_job_id: job.id,
          p_status: 'pending',
          p_gateway_id: GATEWAY_ID,
          p_attempts: job.attempts + 1,
          p_error: `Partial: ${sent}/${sent + failed} sent`,
        });
      log('warn', `  Job ${shortId} partial: ${sent}/${sent + failed}`);
    } else {
      throw new Error(`All files failed (${failed} errors)`);
    }
  } catch (err) {
    const msg = (err as Error).message;
    log('error', `  Job ${shortId} failed: ${msg}`);

    const newStatus = (job.attempts + 1) >= job.max_attempts ? 'failed' : 'pending';
    await supabase
      .rpc('gateway_update_job', {
        p_job_id: job.id,
        p_status: newStatus,
        p_gateway_id: GATEWAY_ID,
        p_attempts: job.attempts + 1,
        p_error: msg,
      });

    if (newStatus === 'failed') {
      log('error', `  Job ${shortId} exhausted retries (${job.max_attempts})`);
    }
  } finally {
    // Cleanup temp files
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* ignore cleanup errors */ }
  }
}
