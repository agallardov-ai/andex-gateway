import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { config } from './config/env.js';
import { initDatabase } from './db/database.js';
import { initStorage } from './services/storage.service.js';
import { startRetryWorker, startCleanupWorker, stopWorkers } from './services/queue.service.js';
import { startWorklistPolling, stopWorklistPolling } from './services/worklist-polling.service.js';
import { dicomRoutes } from './routes/dicom.routes.js';
import { healthRoutes } from './routes/health.routes.js';
import { uiRoutes } from './routes/ui.routes.js';
import { metricsRoutes } from './routes/metrics.routes.js';
import { worklistRoutes } from './routes/worklist.routes.js';
import { configRoutes } from './routes/config.routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

// ===== TLS Certificate Discovery =====
function findTlsCerts(): { key: string; cert: string } | null {
  const certsDir = path.join(PROJECT_ROOT, 'certs');

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

    // ---- HTTPS Server (port 3443 if certs exist) ----
    const tlsCerts = findTlsCerts();
    const httpsPort = parseInt(process.env.HTTPS_PORT || '3443', 10);

    if (tlsCerts) {
      httpsServer = await buildServer(tlsCerts);
      await httpsServer.listen({ port: httpsPort, host: '0.0.0.0' });
      console.log(`    \ud83d\udd12 HTTPS: https://localhost:${httpsPort} (mkcert)`);
    } else {
      console.log(`    \u26a0\ufe0f  No TLS certs found in ./certs/ \u2014 HTTPS disabled`);
      console.log(`       Run: mkdir -p certs && cd certs && mkcert localhost 127.0.0.1 ::1`);
    }

    console.log(`
    \ud83c\udfe5 Centro: ${config.centroNombre}
    \ud83c\udf10 HTTP:   http://localhost:${config.port}
    \ud83d\udcca Dashboard: http://localhost:${config.port}/
    \ud83d\udcc8 M\u00e9tricas: http://localhost:${config.port}/observability
    \ud83d\udd0c PACS: ${config.pacsUrl} (${config.pacsType})
    \ud83d\udd11 API Key: ${config.apiKey.substring(0, 8)}****
    
    Ready to receive DICOM files!
    `);

  } catch (error) {
    console.error('\u274c Failed to start server:', error);
    process.exit(1);
  }
}

start();
