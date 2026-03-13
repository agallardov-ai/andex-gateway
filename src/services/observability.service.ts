import { config } from '../config/env.js';
import { getJobStats } from '../db/database.js';

/**
 * Observability Service
 * - Métricas estilo Prometheus
 * - Logs estructurados
 * - Health checks detallados
 * - Alertas (preparado para webhooks)
 */

// ============================================
// METRICS STORE
// ============================================

interface MetricsStore {
  // Counters
  dicom_uploads_total: number;
  dicom_uploads_success: number;
  dicom_uploads_failed: number;
  dicom_bytes_processed: number;
  
  // PACS
  pacs_requests_total: number;
  pacs_requests_success: number;
  pacs_requests_failed: number;
  pacs_latency_sum_ms: number;
  pacs_latency_count: number;
  
  // Queue
  queue_retries_total: number;
  queue_jobs_expired: number;
  
  // API
  api_requests_total: number;
  api_requests_by_endpoint: Record<string, number>;
  api_errors_total: number;
  
  // System
  startup_time: number;
}

const metrics: MetricsStore = {
  dicom_uploads_total: 0,
  dicom_uploads_success: 0,
  dicom_uploads_failed: 0,
  dicom_bytes_processed: 0,
  
  pacs_requests_total: 0,
  pacs_requests_success: 0,
  pacs_requests_failed: 0,
  pacs_latency_sum_ms: 0,
  pacs_latency_count: 0,
  
  queue_retries_total: 0,
  queue_jobs_expired: 0,
  
  api_requests_total: 0,
  api_requests_by_endpoint: {},
  api_errors_total: 0,
  
  startup_time: Date.now(),
};

// ============================================
// METRIC RECORDING
// ============================================

export function recordUpload(success: boolean, bytes: number = 0): void {
  metrics.dicom_uploads_total++;
  if (success) {
    metrics.dicom_uploads_success++;
    metrics.dicom_bytes_processed += bytes;
  } else {
    metrics.dicom_uploads_failed++;
  }
}

export function recordPacsRequest(success: boolean, latencyMs: number): void {
  metrics.pacs_requests_total++;
  if (success) {
    metrics.pacs_requests_success++;
  } else {
    metrics.pacs_requests_failed++;
  }
  metrics.pacs_latency_sum_ms += latencyMs;
  metrics.pacs_latency_count++;
}

export function recordRetry(): void {
  metrics.queue_retries_total++;
}

export function recordExpiredJob(): void {
  metrics.queue_jobs_expired++;
}

export function recordApiRequest(endpoint: string, isError: boolean = false): void {
  metrics.api_requests_total++;
  metrics.api_requests_by_endpoint[endpoint] = (metrics.api_requests_by_endpoint[endpoint] || 0) + 1;
  if (isError) {
    metrics.api_errors_total++;
  }
}

// ============================================
// METRICS EXPORT (Prometheus format)
// ============================================

export function getPrometheusMetrics(): string {
  const jobStats = getJobStats();
  const uptime = Math.floor((Date.now() - metrics.startup_time) / 1000);
  const avgLatency = metrics.pacs_latency_count > 0 
    ? Math.round(metrics.pacs_latency_sum_ms / metrics.pacs_latency_count) 
    : 0;

  const lines: string[] = [
    '# HELP andex_gateway_info Gateway information',
    '# TYPE andex_gateway_info gauge',
    `andex_gateway_info{version="1.0.0",centro="${config.centroId}",pacs_type="${config.pacsType}"} 1`,
    '',
    '# HELP andex_gateway_uptime_seconds Gateway uptime in seconds',
    '# TYPE andex_gateway_uptime_seconds counter',
    `andex_gateway_uptime_seconds ${uptime}`,
    '',
    '# HELP andex_dicom_uploads_total Total DICOM uploads',
    '# TYPE andex_dicom_uploads_total counter',
    `andex_dicom_uploads_total ${metrics.dicom_uploads_total}`,
    '',
    '# HELP andex_dicom_uploads_success Successful DICOM uploads',
    '# TYPE andex_dicom_uploads_success counter',
    `andex_dicom_uploads_success ${metrics.dicom_uploads_success}`,
    '',
    '# HELP andex_dicom_uploads_failed Failed DICOM uploads',
    '# TYPE andex_dicom_uploads_failed counter',
    `andex_dicom_uploads_failed ${metrics.dicom_uploads_failed}`,
    '',
    '# HELP andex_dicom_bytes_processed Total bytes processed',
    '# TYPE andex_dicom_bytes_processed counter',
    `andex_dicom_bytes_processed ${metrics.dicom_bytes_processed}`,
    '',
    '# HELP andex_pacs_requests_total Total PACS requests',
    '# TYPE andex_pacs_requests_total counter',
    `andex_pacs_requests_total ${metrics.pacs_requests_total}`,
    '',
    '# HELP andex_pacs_requests_success Successful PACS requests',
    '# TYPE andex_pacs_requests_success counter',
    `andex_pacs_requests_success ${metrics.pacs_requests_success}`,
    '',
    '# HELP andex_pacs_latency_avg_ms Average PACS latency in ms',
    '# TYPE andex_pacs_latency_avg_ms gauge',
    `andex_pacs_latency_avg_ms ${avgLatency}`,
    '',
    '# HELP andex_queue_jobs Current jobs by status',
    '# TYPE andex_queue_jobs gauge',
    `andex_queue_jobs{status="pending"} ${jobStats.pending}`,
    `andex_queue_jobs{status="sending"} ${jobStats.sending}`,
    `andex_queue_jobs{status="sent"} ${jobStats.sent}`,
    `andex_queue_jobs{status="failed"} ${jobStats.failed}`,
    '',
    '# HELP andex_queue_retries_total Total retry attempts',
    '# TYPE andex_queue_retries_total counter',
    `andex_queue_retries_total ${metrics.queue_retries_total}`,
    '',
    '# HELP andex_api_requests_total Total API requests',
    '# TYPE andex_api_requests_total counter',
    `andex_api_requests_total ${metrics.api_requests_total}`,
    '',
    '# HELP andex_api_errors_total Total API errors',
    '# TYPE andex_api_errors_total counter',
    `andex_api_errors_total ${metrics.api_errors_total}`,
  ];

  return lines.join('\n');
}

// ============================================
// JSON METRICS (for dashboard)
// ============================================

export function getMetricsJson(): object {
  const jobStats = getJobStats();
  const uptime = Date.now() - metrics.startup_time;
  const avgLatency = metrics.pacs_latency_count > 0 
    ? Math.round(metrics.pacs_latency_sum_ms / metrics.pacs_latency_count) 
    : 0;

  return {
    gateway: {
      version: '1.0.0',
      centro: config.centroId,
      centroNombre: config.centroNombre,
      pacsType: config.pacsType,
      uptime: uptime,
      uptimeHuman: formatUptime(uptime),
    },
    dicom: {
      uploads: {
        total: metrics.dicom_uploads_total,
        success: metrics.dicom_uploads_success,
        failed: metrics.dicom_uploads_failed,
        successRate: metrics.dicom_uploads_total > 0 
          ? ((metrics.dicom_uploads_success / metrics.dicom_uploads_total) * 100).toFixed(1) + '%'
          : 'N/A',
      },
      bytesProcessed: metrics.dicom_bytes_processed,
      bytesProcessedHuman: formatBytes(metrics.dicom_bytes_processed),
    },
    pacs: {
      requests: {
        total: metrics.pacs_requests_total,
        success: metrics.pacs_requests_success,
        failed: metrics.pacs_requests_failed,
      },
      latency: {
        avgMs: avgLatency,
        avgHuman: avgLatency + 'ms',
      },
    },
    queue: {
      ...jobStats,
      retries: metrics.queue_retries_total,
      expired: metrics.queue_jobs_expired,
    },
    api: {
      requests: metrics.api_requests_total,
      errors: metrics.api_errors_total,
      byEndpoint: metrics.api_requests_by_endpoint,
    },
  };
}

// ============================================
// STRUCTURED LOGGING
// ============================================

import fs from 'fs';
import path from 'path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  traceId?: string;
}

const logBuffer: LogEntry[] = [];
const MAX_LOG_BUFFER = 1000;

// Log file path (daily rotation)
function getLogFilePath(): string {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const logsDir = process.env.DATA_DIR ? `${process.env.DATA_DIR}/logs` : './data/logs';
  return path.join(logsDir, `gateway-${date}.log`);
}

// Write log to file
function writeLogToFile(entry: LogEntry): void {
  try {
    const logLine = JSON.stringify(entry) + '\n';
    fs.appendFileSync(getLogFilePath(), logLine);
  } catch (error) {
    // Silently fail file logging to avoid infinite loops
  }
}

export function log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    context,
  };

  // Add to buffer (circular)
  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOG_BUFFER) {
    logBuffer.shift();
  }

  // Persist to file
  writeLogToFile(entry);

  // Console output (structured)
  const emoji = {
    debug: '🔍',
    info: '📋',
    warn: '⚠️',
    error: '❌',
  }[level];

  const contextStr = context ? ` ${JSON.stringify(context)}` : '';
  console.log(`${emoji} [${entry.timestamp}] ${level.toUpperCase()}: ${message}${contextStr}`);
}

export function getRecentLogs(limit: number = 100, level?: LogLevel): LogEntry[] {
  let filtered = logBuffer;
  if (level) {
    filtered = logBuffer.filter(l => l.level === level);
  }
  return filtered.slice(-limit);
}

// ============================================
// ALERTS (preparado para webhooks)
// ============================================

interface Alert {
  id: string;
  type: 'pacs_down' | 'high_failure_rate' | 'queue_backlog' | 'disk_space';
  severity: 'warning' | 'critical';
  message: string;
  timestamp: string;
  resolved: boolean;
}

const activeAlerts: Map<string, Alert> = new Map();

export function checkAlerts(): Alert[] {
  const jobStats = getJobStats();
  const alerts: Alert[] = [];

  // High failure rate
  if (metrics.dicom_uploads_total > 10) {
    const failureRate = metrics.dicom_uploads_failed / metrics.dicom_uploads_total;
    if (failureRate > 0.2) { // > 20% failure
      const alert: Alert = {
        id: 'high_failure_rate',
        type: 'high_failure_rate',
        severity: failureRate > 0.5 ? 'critical' : 'warning',
        message: `Alta tasa de fallos: ${(failureRate * 100).toFixed(1)}%`,
        timestamp: new Date().toISOString(),
        resolved: false,
      };
      activeAlerts.set(alert.id, alert);
      alerts.push(alert);
    } else {
      activeAlerts.delete('high_failure_rate');
    }
  }

  // Queue backlog
  if (jobStats.pending > 50) {
    const alert: Alert = {
      id: 'queue_backlog',
      type: 'queue_backlog',
      severity: jobStats.pending > 100 ? 'critical' : 'warning',
      message: `Cola con ${jobStats.pending} jobs pendientes`,
      timestamp: new Date().toISOString(),
      resolved: false,
    };
    activeAlerts.set(alert.id, alert);
    alerts.push(alert);
  } else {
    activeAlerts.delete('queue_backlog');
  }

  return alerts;
}

export function getActiveAlerts(): Alert[] {
  return Array.from(activeAlerts.values());
}

// ============================================
// HELPERS
// ============================================

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
