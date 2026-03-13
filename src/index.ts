import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';

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

// Initialize Fastify
const fastify = Fastify({
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
});

// Register plugins
async function registerPlugins() {
  // CORS
  await fastify.register(cors, {
    origin: config.allowedOrigins,
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-API-Key', 'Authorization'],
    credentials: true,
  });

  // Multipart for file uploads
  await fastify.register(multipart, {
    limits: {
      fileSize: 500 * 1024 * 1024, // 500MB max
      files: 1,
    },
  });

  // Rate limiting
  await fastify.register(rateLimit, {
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindowMs,
    keyGenerator: (request) => {
      return request.headers['x-api-key'] as string || request.ip;
    },
  });
}

// Register routes
async function registerRoutes() {
  await fastify.register(dicomRoutes);
  await fastify.register(healthRoutes);
  await fastify.register(uiRoutes);
  await fastify.register(metricsRoutes);
  await fastify.register(worklistRoutes);
}

// Graceful shutdown
async function shutdown() {
  console.log('\n⏹️ Shutting down...');
  stopWorkers();
  stopWorklistPolling();
  await fastify.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start server
async function start() {
  try {
    console.log(`
    ╔═══════════════════════════════════════╗
    ║         ANDEX GATEWAY v1.0.0          ║
    ╚═══════════════════════════════════════╝
    `);

    // Initialize components
    await initDatabase();
    initStorage();

    // Register plugins and routes
    await registerPlugins();
    await registerRoutes();

    // Start background workers
    startRetryWorker();
    startCleanupWorker();
    startWorklistPolling();

    // Start server
    await fastify.listen({ 
      port: config.port, 
      host: '0.0.0.0' 
    });

    console.log(`
    🏥 Centro: ${config.centroNombre}
    🌐 Server: http://localhost:${config.port}
    📊 Dashboard: http://localhost:${config.port}/
    � Métricas: http://localhost:${config.port}/observability
    🔌 PACS: ${config.pacsUrl} (${config.pacsType})
    🔑 API Key: ${config.apiKey.substring(0, 8)}****
    
    Ready to receive DICOM files!
    `);

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

start();
