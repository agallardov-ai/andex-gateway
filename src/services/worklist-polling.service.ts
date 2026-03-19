/**
 * Worklist Polling Service
 * Periodically fetches MWL items from Synapse 7 and caches them locally
 * Also syncs to Supabase agenda (if configured)
 */

import { config, syncConfig } from '../config/env.js';
import { log } from './observability.service.js';
import { queryWorklist, WorklistItem, WorklistQuery } from './worklist.service.js';
import { syncWorklistToSupabase, setLastSyncResult, getLastSyncStatus, SyncResult } from './sync.service.js';
import { initSupabase, isSupabaseEnabled } from './supabase.service.js';

// Cache for worklist items
let worklistCache: WorklistItem[] = [];
let lastFetchTime: Date | null = null;
let pollingInterval: NodeJS.Timeout | null = null;

// Use sync config interval (30s default) instead of 5 minutes
const POLLING_INTERVAL_MS = syncConfig.pollingIntervalMs;

async function fetchTodayWorklist(): Promise<WorklistItem[]> {
  const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
  
  const params: WorklistQuery = {
    date: today,
    limit: 200
  };

  // Aplicar filtros opcionales desde .env
  if (config.worklistStationAET) {
    params.stationAET = config.worklistStationAET;
  }
  if (config.worklistDefaultModality) {
    params.modality = config.worklistDefaultModality;
  }


  const result = await queryWorklist(params);
  if (result.success) {
    log('info', `Worklist polling: fetched ${result.items.length} items`, { date: today });
    return result.items;
  } else {
    throw new Error(result.error || 'Unknown error');
  }
}

export async function refreshWorklistCache(): Promise<{ success: boolean; itemCount: number; error?: string; syncResult?: SyncResult }> {
  try {
    worklistCache = await fetchTodayWorklist();
    lastFetchTime = new Date();

    // Sincronizar con Supabase si esta habilitado
    // IMPORTANTE: NO sincronizar datos mock a Supabase — los mock generan
    // accession numbers nuevos cada día (ACC{YYYYMMDD}001) lo que crea
    // filas duplicadas acumulativas en la tabla agenda.
    let syncResult: SyncResult | undefined;
    if (syncConfig.enabled && isSupabaseEnabled() && config.worklistMode !== 'mock') {
      syncResult = await syncWorklistToSupabase(worklistCache);
      setLastSyncResult(syncResult);
    } else if (config.worklistMode === 'mock') {
      log('debug', 'Mock mode: skipping Supabase sync to avoid phantom agenda entries');
    }

    return { success: true, itemCount: worklistCache.length, syncResult };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, itemCount: worklistCache.length, error: errorMsg };
  }
}

export function getCachedWorklist(): { items: WorklistItem[]; lastFetch: Date | null; cacheAge: number | null } {
  const cacheAge = lastFetchTime ? Date.now() - lastFetchTime.getTime() : null;
  return { items: worklistCache, lastFetch: lastFetchTime, cacheAge };
}

export function getCachedWorklistItem(accessionNumber: string): WorklistItem | undefined {
  return worklistCache.find(item => item.accessionNumber === accessionNumber);
}

export function searchCachedWorklist(query: string): WorklistItem[] {
  const lowerQuery = query.toLowerCase();
  return worklistCache.filter(item => 
    item.patientName?.toLowerCase().includes(lowerQuery) ||
    item.patientID?.toLowerCase().includes(lowerQuery) ||
    item.accessionNumber?.toLowerCase().includes(lowerQuery) ||
    item.modality?.toLowerCase().includes(lowerQuery) ||
    item.scheduledProcedureDescription?.toLowerCase().includes(lowerQuery)
  );
}

export function startWorklistPolling(): void {
  if (pollingInterval) {
    log('warn', 'Worklist polling already running');
    return;
  }
  
  // Initialize Supabase if configured
  if (syncConfig.enabled) {
    initSupabase();
  }
  
  // Allow polling in mock mode too
  if (config.worklistMode === 'mock') {
    log('info', `Starting worklist polling in MOCK mode (interval: ${POLLING_INTERVAL_MS / 1000}s)`);
  } else if (!config.worklistQidoMwlPath && !config.worklistUpsPath) {
    log('info', 'Worklist not configured, polling disabled');
    return;
  } else {
    log('info', `Starting worklist polling (interval: ${POLLING_INTERVAL_MS / 1000}s)`);
  }
  
  // Initial fetch
  refreshWorklistCache().catch(err => log('error', 'Initial worklist fetch failed', { error: err.message }));
  
  // Start polling
  pollingInterval = setInterval(() => {
    refreshWorklistCache().catch(err => log('error', 'Worklist polling cycle failed', { error: err.message }));
  }, POLLING_INTERVAL_MS);
}

export function stopWorklistPolling(): void {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
    log('info', 'Worklist polling stopped');
  }
}

export function getPollingStatus(): { 
  running: boolean; 
  intervalMs: number; 
  lastFetch: Date | null; 
  cacheSize: number; 
  cacheAgeMs: number | null;
  syncEnabled: boolean;
  lastSync: { result: SyncResult | null; time: Date | null };
} {
  return {
    running: pollingInterval !== null,
    intervalMs: POLLING_INTERVAL_MS,
    lastFetch: lastFetchTime,
    cacheSize: worklistCache.length,
    cacheAgeMs: lastFetchTime ? Date.now() - lastFetchTime.getTime() : null,
    syncEnabled: syncConfig.enabled && isSupabaseEnabled(),
    lastSync: getLastSyncStatus()
  };
}
