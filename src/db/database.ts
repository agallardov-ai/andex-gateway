import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/env.js';
import type { Job, JobCreateInput, JobStatus, JobStats } from '../types/index.js';
import { v4 as uuidv4 } from 'uuid';

let db: SqlJsDatabase;

export async function initDatabase(): Promise<SqlJsDatabase> {
  // Ensure data directory exists
  const dataDir = path.dirname(config.dbPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Initialize SQL.js
  const SQL = await initSqlJs();

  // Load existing database or create new one
  if (fs.existsSync(config.dbPath)) {
    const fileBuffer = fs.readFileSync(config.dbPath);
    db = new SQL.Database(fileBuffer);
    console.log(`✅ Database loaded: ${config.dbPath}`);
  } else {
    db = new SQL.Database();
    console.log(`✅ New database created: ${config.dbPath}`);
  }

  // Run schema
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  db.run(schema);

  // Save to persist
  saveDatabase();

  return db;
}

// Save database to file
function saveDatabase(): void {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(config.dbPath, buffer);
}

export function getDatabase(): SqlJsDatabase {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

// ============================================
// JOB CRUD OPERATIONS
// ============================================

export function createJob(input: JobCreateInput): Job {
  const id = uuidv4();
  const now = new Date().toISOString();
  
  db.run(`
    INSERT INTO jobs (id, filename, filepath, filesize, study_uid, series_uid, sop_instance_uid, patient_id, patient_name, modality, max_attempts, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id,
    input.filename,
    input.filepath,
    input.filesize,
    input.study_uid || null,
    input.series_uid || null,
    input.sop_instance_uid || null,
    input.patient_id || null,
    input.patient_name || null,
    input.modality || null,
    config.maxRetryAttempts,
    now,
    now
  ]);

  saveDatabase();
  return getJobById(id)!;
}

export function getJobById(id: string): Job | null {
  const stmt = db.prepare('SELECT * FROM jobs WHERE id = ?');
  stmt.bind([id]);
  
  if (stmt.step()) {
    const row = stmt.getAsObject() as unknown as Job;
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

export function getJobs(options: {
  status?: JobStatus | JobStatus[];
  limit?: number;
  offset?: number;
  orderBy?: 'created_at' | 'updated_at';
  order?: 'ASC' | 'DESC';
} = {}): Job[] {
  const { status, limit = 100, offset = 0, orderBy = 'created_at', order = 'DESC' } = options;
  
  let query = 'SELECT * FROM jobs';
  const params: unknown[] = [];

  if (status) {
    if (Array.isArray(status)) {
      query += ` WHERE status IN (${status.map(() => '?').join(', ')})`;
      params.push(...status);
    } else {
      query += ' WHERE status = ?';
      params.push(status);
    }
  }

  query += ` ORDER BY ${orderBy} ${order} LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const results: Job[] = [];
  const stmt = db.prepare(query);
  stmt.bind(params as (string | number | null)[]);
  
  while (stmt.step()) {
    results.push(stmt.getAsObject() as unknown as Job);
  }
  stmt.free();
  
  return results;
}

export function updateJobStatus(
  id: string, 
  status: JobStatus, 
  extra?: { orthanc_id?: string; error_message?: string | undefined; sent_at?: string }
): void {
  const now = new Date().toISOString();
  let query = 'UPDATE jobs SET status = ?, updated_at = ?';
  const params: (string | null)[] = [status, now];

  if (extra?.orthanc_id !== undefined) {
    query += ', orthanc_id = ?';
    params.push(extra.orthanc_id);
  }
  if (extra?.error_message !== undefined) {
    query += ', error_message = ?';
    params.push(extra.error_message ?? null);
  }
  if (extra?.sent_at !== undefined) {
    query += ', sent_at = ?';
    params.push(extra.sent_at);
  }

  query += ' WHERE id = ?';
  params.push(id);

  db.run(query, params);
  saveDatabase();
}

export function incrementJobAttempts(id: string): void {
  const now = new Date().toISOString();
  db.run('UPDATE jobs SET attempts = attempts + 1, updated_at = ? WHERE id = ?', [now, id]);
  saveDatabase();
}

export function getJobsForRetry(): Job[] {
  const results: Job[] = [];
  const stmt = db.prepare(`
    SELECT * FROM jobs 
    WHERE status IN ('pending', 'failed') 
    AND attempts < max_attempts
    ORDER BY created_at ASC
    LIMIT 50
  `);
  
  while (stmt.step()) {
    results.push(stmt.getAsObject() as unknown as Job);
  }
  stmt.free();
  
  return results;
}

export function getJobStats(): JobStats {
  const stmt = db.prepare(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'sending' THEN 1 ELSE 0 END) as sending,
      SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
      SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled
    FROM jobs
  `);
  
  stmt.step();
  const row = stmt.getAsObject() as Record<string, number>;
  stmt.free();
  
  return {
    total: row.total || 0,
    pending: row.pending || 0,
    sending: row.sending || 0,
    sent: row.sent || 0,
    failed: row.failed || 0,
    cancelled: row.cancelled || 0,
  };
}

export function deleteOldSentJobs(hoursOld: number): number {
  const cutoff = new Date(Date.now() - hoursOld * 60 * 60 * 1000).toISOString();
  db.run(`
    DELETE FROM jobs 
    WHERE status = 'sent' 
    AND sent_at < ?
  `, [cutoff]);
  
  const changes = db.getRowsModified();
  saveDatabase();
  return changes;
}

export function deleteJob(id: string): boolean {
  db.run('DELETE FROM jobs WHERE id = ?', [id]);
  const changes = db.getRowsModified();
  saveDatabase();
  return changes > 0;
}
