import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fs from 'fs';
import path from 'path';
import net from 'net';
import os from 'os';
import { execSync } from 'child_process';
import { generateSelfSignedCertNative } from './utils/generate-cert.js';
import { fileURLToPath } from 'url';

import { config } from './config/env.js';
import { initDatabase } from './db/database.js';
import { initStorage } from './services/storage.service.js';
import { startRetryWorker, startCleanupWorker, stopWorkers } from './services/queue.service.js';
import { startWorklistPolling, stopWorklistPolling } from './services/worklist-polling.service.js';
import { startMonitoring, stopMonitoring } from './services/monitoring.service.js';
import { startCloudQueuePoller, stopCloudQueuePoller } from './services/cloud-queue.service.js';
import { dicomRoutes } from './routes/dicom.routes.js';
import { healthRoutes } from './routes/health.routes.js';
import { uiRoutes } from './routes/ui.routes.js';
import { metricsRoutes } from './routes/metrics.routes.js';
import { worklistRoutes } from './routes/worklist.routes.js';
import { configRoutes } from './routes/config.routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

// ===== TLS Certificate Discovery + Auto-generation =====
function generateSelfSignedCerts(certsDir: string): void {
  console.log('    \ud83d\udd10 Generando certificados self-signed...');
  try {
    fs.mkdirSync(certsDir, { recursive: true });
    const keyPath = path.join(certsDir, 'localhost+2-key.pem');
    const certPath = path.join(certsDir, 'localhost+2.pem');

    // Try openssl first (macOS/Linux), fallback to pure Node.js (Windows)
    let generated = false;
    try {
      execSync(
        `openssl req -x509 -newkey rsa:2048 -nodes ` +
        `-keyout "${keyPath}" -out "${certPath}" ` +
        `-days 825 -subj "/CN=localhost/O=Andex Gateway" ` +
        `-addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1"`,
        { stdio: 'pipe' }
      );
      generated = true;
      console.log('    \u2705 Certificados generados con openssl en', certsDir);
    } catch {
      console.log('    \u26a0\ufe0f openssl no disponible, usando generador Node.js nativo...');
    }

    if (!generated) {
      const result = generateSelfSignedCertNative();
      fs.writeFileSync(keyPath, result.key, { mode: 0o600 });
      fs.writeFileSync(certPath, result.cert);
      console.log('    \u2705 Certificados generados con Node.js nativo en', certsDir);
    }
  } catch (err) {
    console.warn('    \u26a0\ufe0f No se pudo generar certificados:', (err as Error).message);
  }
}

function findTlsCerts(): { key: string; cert: string } | null {
  // Priority: persistent volume (survives image updates) > image-baked certs
  const dataCertsDir = path.join(config.storagePath || process.env.STORAGE_PATH || './data', 'certs');
  const imageCertsDir = path.join(PROJECT_ROOT, 'certs');

  // 1. Check persistent volume first (data/certs/)
  let certsDir = dataCertsDir;
  let hasCerts = false;

  if (fs.existsSync(dataCertsDir)) {
    const files = fs.readdirSync(dataCertsDir);
    const hasKey = files.some(f => f.endsWith('-key.pem'));
    const hasCert = files.some(f => f.endsWith('.pem') && !f.endsWith('-key.pem'));
    if (hasKey && hasCert) {
      hasCerts = true;
      console.log('    \ud83d\udd12 Usando certificados persistentes de', dataCertsDir);
    }
  }

  // 2. If no persistent certs, check image-baked certs and copy to persistent
  if (!hasCerts && fs.existsSync(imageCertsDir)) {
    const files = fs.readdirSync(imageCertsDir);
    const hasKey = files.some(f => f.endsWith('-key.pem'));
    const hasCert = files.some(f => f.endsWith('.pem') && !f.endsWith('-key.pem'));
    if (hasKey && hasCert) {
      // Copy image certs to persistent location so they survive image updates
      try {
        fs.mkdirSync(dataCertsDir, { recursive: true });
        for (const file of files) {
          fs.copyFileSync(path.join(imageCertsDir, file), path.join(dataCertsDir, file));
        }
        console.log('    \ud83d\udccb Certificados copiados a almacenamiento persistente:', dataCertsDir);
        hasCerts = true;
      } catch (copyErr) {
        // Use image certs directly if copy fails
        certsDir = imageCertsDir;
        hasCerts = true;
      }
    }
  }

  // 3. If still no certs anywhere, generate new ones in persistent location
  if (!hasCerts) {
    generateSelfSignedCerts(dataCertsDir);
    certsDir = dataCertsDir;
  }

  // Read certs from chosen directory
  if (!fs.existsSync(certsDir)) return null;
  const files = fs.readdirSync(certsDir);
  const keyFile = files.find(f => f.endsWith('-key.pem'));
  const certFile = files.find(f => f.endsWith('.pem') && !f.endsWith('-key.pem'));

  if (!keyFile || !certFile) return null;

  try {
    return {
      key: fs.readFileSync(path.join(certsDir, keyFile), 'utf-8'),
      cert: fs.readFileSync(path.join(certsDir, certFile), 'utf-8'),
    };
  } catch (err) {
    console.warn('\u26a0\ufe0f Could not read TLS certificates:', (err as Error).message);
    return null;
  }
}

// ===== Factory: create & configure a Fastify instance =====
async function buildServer(tlsOpts?: { key: string; cert: string }) {
  const serverOpts: any = {
    logger: {
      level: config.nodeEnv === 'development' ? 'debug' : 'info',
      transport: config.nodeEnv === 'development' ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname',
        }
      } : undefined,
    },
  };

  if (tlsOpts) {
    serverOpts.https = tlsOpts;
  }

  const server = Fastify(serverOpts);

  // CORS
  await server.register(cors, {
    origin: config.allowedOrigins,
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-API-Key', 'Authorization'],
    credentials: true,
  });

  // Multipart for file uploads
  await server.register(multipart, {
    limits: {
      fileSize: 500 * 1024 * 1024,
      files: 1,
    },
  });

  // Rate limiting
  await server.register(rateLimit, {
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindowMs,
    keyGenerator: (request) => {
      return request.headers['x-api-key'] as string || request.ip;
    },
  });

  // Routes
  await server.register(dicomRoutes);
  await server.register(healthRoutes);
  await server.register(uiRoutes);
  await server.register(metricsRoutes);
  await server.register(worklistRoutes);
  await server.register(configRoutes);

  return server;
}

// ===== Servers =====
let httpServer: Awaited<ReturnType<typeof buildServer>> | null = null;
let httpsServer: Awaited<ReturnType<typeof buildServer>> | null = null;

// Graceful shutdown
async function shutdown() {
  console.log('\n\u23f9\ufe0f Shutting down...');
  stopWorkers();
  stopWorklistPolling();
  stopMonitoring();
  stopCloudQueuePoller();
  if (httpServer) await httpServer.close();
  if (httpsServer) await httpsServer.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start
async function start() {
  try {
    console.log(`
    \u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557
    \u2551         ANDEX GATEWAY v1.0.0          \u2551
    \u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d
    `);

    // Initialize shared components
    await initDatabase();
    initStorage();

    // ---- HTTP Server (port from config, default 3001) ----
    httpServer = await buildServer();
    await httpServer.listen({ port: config.port, host: '0.0.0.0' });

    // Start background workers (once)
    startRetryWorker();
    startCleanupWorker();
    startWorklistPolling();
    startMonitoring();
    startCloudQueuePoller();

    // ---- HTTPS Server (port 3443 if certs exist) ----
    const tlsCerts = findTlsCerts();
    const httpsPort = parseInt(process.env.HTTPS_PORT || '3443', 10);

    if (tlsCerts) {
      httpsServer = await buildServer(tlsCerts);
      await httpsServer.listen({ port: httpsPort, host: '0.0.0.0' });
      console.log(`    \ud83d\udd12 HTTPS: https://localhost:${httpsPort}`);
    } else {
      console.log(`    \u26a0\ufe0f  HTTPS deshabilitado (no se pudieron generar certificados)`);
    }

    console.log(`
    \ud83c\udfe5 Centro: ${config.centroNombre}
    \ud83c\udf10 HTTP:   http://localhost:${config.port}
    \ud83d\udcca Dashboard: http://localhost:${config.port}/
    \ud83d\udcc8 M\u00e9tricas: http://localhost:${config.port}/observability
    \ud83d\udd0c PACS: ${config.pacsUrl} (${config.pacsType})
    \ud83d\udd11 API Key: ${config.apiKey.substring(0, 8)}****
    \ud83d\udc64 Auth:   ${config.dashboardUser} / ${config.dashboardPassword[0]}${'*'.repeat(config.dashboardPassword.length - 2)}${config.dashboardPassword.slice(-1)}
    
    Ready to receive DICOM files!
    `);

    // ===== Startup Network Check =====
    await startupNetworkCheck();

  } catch (error) {
    console.error('\u274c Failed to start server:', error);
    process.exit(1);
  }
}

// Quick TCP check
function tcpProbe(host: string, port: number, timeoutMs = 3000): Promise<{ ok: boolean; ms: number; err?: string }> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const sock = new net.Socket();
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => { sock.destroy(); resolve({ ok: true, ms: Date.now() - t0 }); });
    sock.once('timeout', () => { sock.destroy(); resolve({ ok: false, ms: Date.now() - t0, err: 'timeout' }); });
    sock.once('error', (e) => { resolve({ ok: false, ms: Date.now() - t0, err: e.message }); });
    sock.connect(port, host);
  });
}

async function startupNetworkCheck() {
  console.log('    \u{1F50D} Network check...');

  // Detect local IPs
  const ifaces = os.networkInterfaces();
  const localIps: string[] = [];
  for (const [, addrs] of Object.entries(ifaces)) {
    if (!addrs) continue;
    for (const a of addrs) {
      if (a.family === 'IPv4' && !a.internal) localIps.push(a.address);
    }
  }
  console.log(`    \u{1F4E1} IPs locales: ${localIps.length > 0 ? localIps.join(', ') : 'ninguna detectada'}`);

  const pacsType = config.pacsType;
  const checks: string[] = [];

  // Check HTTP PACS
  if (pacsType !== 'dicom-native' && config.pacsUrl) {
    try {
      const u = new URL(config.pacsUrl);
      const port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80);
      const r = await tcpProbe(u.hostname, port);
      checks.push(r.ok
        ? `    \u2705 PACS HTTP (${u.hostname}:${port}) — ${r.ms}ms`
        : `    \u274C PACS HTTP (${u.hostname}:${port}) — ${r.err}`);
    } catch { checks.push('    \u26A0\uFE0F PACS URL inv\u00E1lida'); }
  }

  // Check DICOM TCP
  if (config.pacsDicomHost && config.pacsDicomHost !== '') {
    const port = Number(config.pacsDicomPort) || 4242;
    const r = await tcpProbe(config.pacsDicomHost, port);
    checks.push(r.ok
      ? `    \u2705 PACS DICOM (${config.pacsDicomHost}:${port}) — ${r.ms}ms`
      : `    \u274C PACS DICOM (${config.pacsDicomHost}:${port}) — ${r.err}`);
  }

  // Check Internet
  const inet = await tcpProbe('8.8.8.8', 53, 2000);
  checks.push(inet.ok
    ? `    \u2705 Internet — ${inet.ms}ms`
    : `    \u26A0\uFE0F Sin Internet`);

  checks.forEach(c => console.log(c));
  console.log('');
}

start();
