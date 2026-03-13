export interface Job {
  id: string;
  filename: string;
  filepath: string;
  filesize: number;
  study_uid: string | null;
  series_uid: string | null;
  sop_instance_uid: string | null;
  patient_id: string | null;
  patient_name: string | null;
  modality: string | null;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  orthanc_id: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
}

export type JobStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'cancelled';

export interface JobCreateInput {
  filename: string;
  filepath: string;
  filesize: number;
  study_uid?: string;
  series_uid?: string;
  sop_instance_uid?: string;
  patient_id?: string;
  patient_name?: string;
  modality?: string;
}

export interface OrthancResponse {
  ID: string;
  Path: string;
  Status: string;
  ParentPatient?: string;
  ParentStudy?: string;
  ParentSeries?: string;
}

export interface HealthStatus {
  gateway: {
    status: 'ok' | 'error';
    uptime: number;
    version: string;
  };
  orthanc: {
    status: 'ok' | 'error' | 'unknown';
    url: string;
    version?: string;
    error?: string;
  };
  database: {
    status: 'ok' | 'error';
    jobsTotal: number;
    jobsPending: number;
    jobsFailed: number;
  };
}

export interface JobStats {
  total: number;
  pending: number;
  sending: number;
  sent: number;
  failed: number;
  cancelled: number;
}

export interface UploadResponse {
  success: boolean;
  jobId: string;
  message: string;
  status: JobStatus;
}
