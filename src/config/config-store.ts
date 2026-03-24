/**
 * ConfigStore - Persistencia de configuracion en JSON
 * Reemplaza la necesidad de editar .env manualmente.
 * El dashboard web guarda aqui y el gateway lee al arrancar.
 * Prioridad: gateway-config.json > .env > defaults
 */

import fs from 'fs';
import path from 'path';

const CONFIG_FILE = path.join(process.cwd(), 'data', 'gateway-config.json');

export interface GatewayConfig {
  // Centro
  centroNombre?: string;
  centroId?: string;
  // Gateway
  port?: number;
  apiKey?: string;
  dashboardUser?: string;
  dashboardPassword?: string;
  allowedOrigins?: string;
  // PACS
  pacsType?: string;
  pacsBaseUrl?: string;
  pacsAuthType?: string;
  pacsUsername?: string;
  pacsPassword?: string;
  pacsToken?: string;
  // DICOM Native (TCP)
  gatewayAeTitle?: string;
  pacsDicomHost?: string;
  pacsDicomPort?: number;
  pacsAeTitle?: string;
  gatewayDicomPort?: number;
  // DICOMweb endpoints
  pacsStowEndpoint?: string;
  pacsQidoEndpoint?: string;
  pacsWadoEndpoint?: string;
  // Worklist
  worklistMode?: string;
  worklistEndpoint?: string;
  worklistMwlEndpoint?: string;
  worklistPreferUps?: boolean;
  worklistDefaultModality?: string;
  worklistStationAET?: string;
  // Sync
  worklistSyncEnabled?: boolean;
  worklistSyncIntervalMs?: number;
  worklistDefaultBoxId?: string;
  worklistDefaultCentroId?: string;
  // Metadata
  _lastSaved?: string;
  _savedFrom?: string;
}

class ConfigStoreClass {
  private data: GatewayConfig = {};
  private loaded = false;

  /** Load config from JSON file */
  load(): GatewayConfig {
    if (this.loaded) return this.data;
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
        this.data = JSON.parse(raw);
        console.log('\u{1F4C1} Configuracion cargada desde gateway-config.json');
      } else {
        console.log('\u{1F4C1} No existe gateway-config.json, usando defaults + .env');
      }
    } catch (err) {
      console.error('\u26A0\uFE0F Error leyendo gateway-config.json:', err);
      this.data = {};
    }
    this.loaded = true;
    return this.data;
  }

  /** Save full config to JSON file */
  save(updates: Partial<GatewayConfig>): { success: boolean; error?: string } {
    try {
      // Merge with existing
      this.data = {
        ...this.data,
        ...updates,
        _lastSaved: new Date().toISOString(),
        _savedFrom: 'dashboard',
      };
      // Remove undefined/null values
      const clean: Record<string, any> = {};
      for (const [key, value] of Object.entries(this.data)) {
        if (value !== undefined && value !== null && value !== '') {
          clean[key] = value;
        }
      }
      // Ensure data/ directory exists
      const dir = path.dirname(CONFIG_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(clean, null, 2) + '\n');
      console.log('\u{1F4BE} Configuracion guardada en gateway-config.json');
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error desconocido';
      console.error('\u274C Error guardando gateway-config.json:', msg);
      return { success: false, error: msg };
    }
  }

  /** Get a single value */
  get<K extends keyof GatewayConfig>(key: K): GatewayConfig[K] | undefined {
    if (!this.loaded) this.load();
    return this.data[key];
  }

  /** Get all stored config */
  getAll(): GatewayConfig {
    if (!this.loaded) this.load();
    return { ...this.data };
  }

  /** Get string value: ENV > JSON > default (para credenciales de seguridad) */
  getEnvOrJson(jsonKey: keyof GatewayConfig, envKey: string, defaultValue: string = ''): string {
    if (!this.loaded) this.load();
    // ENV tiene prioridad sobre JSON — importante para Docker/produccion
    const envVal = process.env[envKey];
    if (envVal !== undefined && envVal !== '') {
      return envVal;
    }
    const jsonVal = this.data[jsonKey];
    if (jsonVal !== undefined && jsonVal !== null && jsonVal !== '') {
      return String(jsonVal);
    }
    return defaultValue;
  }

  /** Get string value: JSON > env > default */
  getOrEnv(jsonKey: keyof GatewayConfig, envKey: string, defaultValue: string = ''): string {
    if (!this.loaded) this.load();
    const jsonVal = this.data[jsonKey];
    if (jsonVal !== undefined && jsonVal !== null && jsonVal !== '') {
      return String(jsonVal);
    }
    return process.env[envKey] || defaultValue;
  }

  /** Get numeric value: JSON > env > default */
  getNumOrEnv(jsonKey: keyof GatewayConfig, envKey: string, defaultValue: number): number {
    if (!this.loaded) this.load();
    const jsonVal = this.data[jsonKey];
    if (jsonVal !== undefined && jsonVal !== null) {
      const num = Number(jsonVal);
      if (!isNaN(num)) return num;
    }
    return parseInt(process.env[envKey] || String(defaultValue), 10);
  }

  /** Get boolean value: JSON > env > default */
  getBoolOrEnv(jsonKey: keyof GatewayConfig, envKey: string, defaultValue: boolean): boolean {
    if (!this.loaded) this.load();
    const jsonVal = this.data[jsonKey];
    if (jsonVal !== undefined && jsonVal !== null) {
      return Boolean(jsonVal);
    }
    const envVal = process.env[envKey];
    if (envVal !== undefined) {
      return envVal !== 'false' && envVal !== '0';
    }
    return defaultValue;
  }

  /** Path to the config file */
  get filePath(): string {
    return CONFIG_FILE;
  }
}

// Singleton
export const configStore = new ConfigStoreClass();
