/**
 * Worklist Polling Service
 * Periodically fetches MWL items from Synapse 7 and caches them locally
 */

import { config } from '../config/env.js';
import { log } from './observability.service.js';
import { queryWorklist, WorklistItem, WorklistQuery } from './worklist.service.js';

// Cache for worklist items
let worklistCache: WorklistItem[] = [];
let lastFetchTime: Date | null = null;
let pollingInterval: NodeJS.Timeout | null = null;

// Default polling interval: 5 minutes
const DEFAULT_POLLING_INTERVAL_MS = 5 * 60 * 1000;
const POLLING_INTERVAL_MS = parseInt(process.env.WORKLIST_POLLING_INTERVAL_MS || String(DEFAULT_POLLING_INTERVAL_MS));

async function fetchTodayWorklist(): Promise<WorklistItem[]> {
  const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
  
  const params: WorklistQuery = {
    date: today,
    limit: 200
  };

  const result = await queryWorklist(params);
  if (result.success) {
    log('info', `Worklist polling: fetched ${result.items.length} items`, { date: today });
    return result.items;
  } else {
    throw new Error(result.error || 'Unknown error');
  }
}

export async function refreshWorklistCache(): Promise<{ success: boolean; itemCount: number; error?: string }> {
  try {
    worklistCache = await fetchTodayWorklist();
    lastFetchTime = new Date();
    return { success: true, itemCount: worklistCache.length };
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
  if (!config.worklistQidoMwlPath && !config.worklistUpsPath) {
    log('info', 'Worklist not configured, polling disabled');
    return;
  }
  log('info', `Starting worklist polling (interval: ${POLLING_INTERVAL_MS / 1000}s)`);
  refreshWorklistCache().catch(err => log('error', 'Initial worklist fetch failed', { error: err.message }));
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

export function getPollingStatus(): { running: boolean; intervalMs: number; lastFetch: Date | null; cacheSize: number; cacheAgeMs: number | null } {
  return {
    running: pollingInterval !== null,
    intervalMs: POLLING_INTERVAL_MS,
    lastFetch: lastFetchTime,
    cacheSize: worklistCache.length,
    cacheAgeMs: lastFetchTime ? Date.now() - lastFetchTime.getTime() : null
  };
}
