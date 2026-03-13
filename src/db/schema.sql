-- Andex Gateway Database Schema
-- SQLite

CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    filepath TEXT NOT NULL,
    filesize INTEGER DEFAULT 0,
    study_uid TEXT,
    series_uid TEXT,
    sop_instance_uid TEXT,
    patient_id TEXT,
    patient_name TEXT,
    modality TEXT,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'sending', 'sent', 'failed', 'cancelled')),
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 5,
    orthanc_id TEXT,
    error_message TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    sent_at TEXT
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_study_uid ON jobs(study_uid);
CREATE INDEX IF NOT EXISTS idx_jobs_patient_id ON jobs(patient_id);

-- Trigger to update updated_at
CREATE TRIGGER IF NOT EXISTS update_jobs_timestamp 
AFTER UPDATE ON jobs
BEGIN
    UPDATE jobs SET updated_at = datetime('now') WHERE id = NEW.id;
END;
