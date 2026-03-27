/**
 * Gateway Monitoring Service
 * ==========================
 * - Pushes heartbeats to Supabase every 30s
 * - Polls for pending commands every 10s
 * - Pushes important logs to Supabase
 */

import os from 'os';
import { config, supabaseConfig } from '../config/env.js';
import { getSupabase, isSupabaseEnabled } from './supabase.service.js';
import { log } from './observability.service.js';
import { getPollingStatus } from './worklist-polling.service.js';

let heartbeatInterval: NodeJS.Timeout | null = null;
let commandPollInterval: NodeJS.Timeout | null = null;
const startTime = Date.now();

const HEARTBEAT_INTERVAL_MS = 30_000;  // 30s
const COMMAND_POLL_INTERVAL_MS = 10_000; // 10s

function getGatewayId(): string {
  return process.env.GATEWAY_ID || 'default';
}

function getCentroId(): string {
  return config.centroId || 'unknown';
}

// =====================================================
// HEARTBEAT
// =====================================================

async function sendHeartbeat(): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

  try {
    const memUsage = process.memoryUsage();
    const wlStatus = getPollingStatus();

    const heartbeat = {
      centro_id: getCentroId(),
      gateway_id: getGatewayId(),
      version: process.env.GATEWAY_VERSION || '1.0.0',
      uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
      pacs_connected: true, // Will be updated by health check
      pacs_type: config.pacsType,
      pacs_url: config.pacsBaseUrl,
      worklist_mode: config.worklistMode,
      worklist_cache_size: wlStatus.cacheSize,
      memory_mb: Math.round(memUsage.rss / 1024 / 1024 * 10) / 10,
      tls_enabled: !!process.env.HTTPS_PORT,
      https_port: parseInt(process.env.HTTPS_PORT || '0', 10) || null,
      http_port: config.port,
      last_sync_at: wlStatus.lastFetch?.toISOString() || null,
      extra: {
        node_version: process.version,
        platform: os.platform(),
        arch: os.arch(),
        hostname: os.hostname(),
        free_mem_mb: Math.round(os.freemem() / 1024 / 1024),
        total_mem_mb: Math.round(os.totalmem() / 1024 / 1024),
        cpus: os.cpus().length,
        sync_enabled: wlStatus.syncEnabled
      }
    };

    // Quick PACS connectivity check
    {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const pacsResp = await fetch(`${config.pacsBaseUrl}/`, {
          signal: controller.signal,
          headers: config.pacsAuthType === 'basic' && config.pacsUsername
            ? { 'Authorization': 'Basic ' + Buffer.from(`${config.pacsUsername}:${config.pacsPassword}`).toString('base64') }
            : {}
        });
        heartbeat.pacs_connected = pacsResp.ok || pacsResp.status === 401; // 401 = auth works, PACS is up
      } catch {
        heartbeat.pacs_connected = false;
      } finally {
        clearTimeout(timeout);
      }
    }

    const { error } = await supabase
      .from('gateway_heartbeats')
      .insert(heartbeat);

    if (error) {
      // Don't log every failure to avoid noise
      if (Math.random() < 0.1) { // Log 10% of failures
        log('warn', 'Heartbeat push failed', { error: error.message });
      }
    }
  } catch (err) {
    // Silent fail — monitoring should never crash the gateway
  }
}

// =====================================================
// COMMAND POLLING
// =====================================================

async function pollCommands(): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

  try {
    const { data: commands, error } = await supabase
      .from('gateway_commands')
      .select('*')
      .eq('centro_id', getCentroId())
      .eq('gateway_id', getGatewayId())
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(5);

    if (error || !commands?.length) return;

    for (const cmd of commands) {
      await executeCommand(cmd);
    }
  } catch {
    // Silent fail
  }
}

async function executeCommand(cmd: any): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

  // Mark as running
  await supabase
    .from('gateway_commands')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', cmd.id);

  let result: any = {};
  let status = 'completed';

  try {
    switch (cmd.command) {
      case 'check-pacs': {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 10000);
        try {
          const resp = await fetch(`${config.pacsBaseUrl}/`, {
            signal: controller.signal,
            headers: config.pacsAuthType === 'basic' && config.pacsUsername
              ? { 'Authorization': 'Basic ' + Buffer.from(`${config.pacsUsername}:${config.pacsPassword}`).toString('base64') }
              : {}
          });
          result = {
            connected: resp.ok || resp.status === 401,
            status: resp.status,
            url: config.pacsBaseUrl,
            type: config.pacsType
          };
        } catch (e) {
          result = { connected: false, error: String(e) };
        } finally {
          clearTimeout(timeout);
        }
        break;
      }

      case 'get-config': {
        result = {
          centroId: config.centroId,
          centroNombre: config.centroNombre,
          pacsType: config.pacsType,
          pacsUrl: config.pacsBaseUrl,
          pacsAuth: config.pacsAuthType,
          worklistMode: config.worklistMode,
          port: config.port,
          httpsPort: process.env.HTTPS_PORT || 'disabled',
          nodeEnv: config.nodeEnv,
          version: process.env.GATEWAY_VERSION || '1.0.0'
        };
        break;
      }

      case 'get-status': {
        const wl = getPollingStatus();
        const mem = process.memoryUsage();
        result = {
          uptime: Math.floor((Date.now() - startTime) / 1000),
          memory_rss_mb: Math.round(mem.rss / 1024 / 1024),
          memory_heap_mb: Math.round(mem.heapUsed / 1024 / 1024),
          worklist: {
            running: wl.running,
            cacheSize: wl.cacheSize,
            lastFetch: wl.lastFetch,
            syncEnabled: wl.syncEnabled
          }
        };
        break;
      }

      case 'restart': {
        result = { message: 'Restarting gateway...' };
        // Complete the command first, then exit (Docker will restart)
        await supabase
          .from('gateway_commands')
          .update({ status: 'completed', result, completed_at: new Date().toISOString() })
          .eq('id', cmd.id);

        log('warn', 'Remote restart command received — exiting');
        setTimeout(() => process.exit(0), 1000);
        return; // Don't update again below
      }

      case 'get-logs': {
        // Return last N log entries from gateway_logs
        const limit = cmd.params?.limit || 50;
        const { data: logs } = await supabase
          .from('gateway_logs')
          .select('*')
          .eq('centro_id', getCentroId())
          .order('created_at', { ascending: false })
          .limit(limit);
        result = { logs: logs || [], count: logs?.length || 0 };
        break;
      }

      default:
        result = { error: `Unknown command: ${cmd.command}` };
        status = 'failed';
    }
  } catch (e) {
    result = { error: String(e) };
    status = 'failed';
  }

  // Update command result
  await supabase
    .from('gateway_commands')
    .update({
      status,
      result,
      completed_at: new Date().toISOString()
    })
    .eq('id', cmd.id);
}

// =====================================================
// REMOTE LOGGING
// =====================================================

export async function pushLog(level: 'info' | 'warn' | 'error', message: string, context?: any): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

  try {
    await supabase
      .from('gateway_logs')
      .insert({
        centro_id: getCentroId(),
        gateway_id: getGatewayId(),
        level,
        message,
        context: context || {}
      });
  } catch {
    // Silent fail
  }
}

// =====================================================
// START / STOP
// =====================================================

export function startMonitoring(): void {
  if (!isSupabaseEnabled()) {
    log('info', 'Monitoring disabled — Supabase not configured');
    return;
  }

  if (heartbeatInterval) {
    log('warn', 'Monitoring already running');
    return;
  }

  log('info', `Starting gateway monitoring (heartbeat: ${HEARTBEAT_INTERVAL_MS / 1000}s, commands: ${COMMAND_POLL_INTERVAL_MS / 1000}s)`);

  // Initial heartbeat
  sendHeartbeat();

  // Start intervals
  heartbeatInterval = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
  commandPollInterval = setInterval(pollCommands, COMMAND_POLL_INTERVAL_MS);

  // Push startup log
  pushLog('info', 'Gateway started', {
    version: process.env.GATEWAY_VERSION || '1.0.0',
    centroId: getCentroId(),
    pacsType: config.pacsType,
    pacsUrl: config.pacsBaseUrl
  });
}

export function stopMonitoring(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  if (commandPollInterval) {
    clearInterval(commandPollInterval);
    commandPollInterval = null;
  }
  log('info', 'Monitoring stopped');
}

export function getMonitoringStatus(): { running: boolean; heartbeatMs: number; commandPollMs: number } {
  return {
    running: heartbeatInterval !== null,
    heartbeatMs: HEARTBEAT_INTERVAL_MS,
    commandPollMs: COMMAND_POLL_INTERVAL_MS
  };
}
