import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config/env.js';
import { getJobStats } from '../db/database.js';
import { checkPacsHealth, getPacsInfo } from '../services/pacs.service.js';
import type { HealthStatus } from '../types/index.js';

const startTime = Date.now();

export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  
  // Simple health check (public)
  fastify.get('/health', async (_request: FastifyRequest, reply: FastifyReply) => {
    const pacsStatus = await checkPacsHealth();
    const pacsInfo = getPacsInfo();
    const stats = getJobStats();
    
    // Determine raw type for status
    const rawPacsType = pacsInfo.type || config.pacsType;
    
    const health: HealthStatus = {
      gateway: {
        status: 'ok',
        uptime: Math.floor((Date.now() - startTime) / 1000),
        version: '1.0.0',
      },
      pacs: {
        status: pacsStatus.ok ? 'ok' : 'error',
        type: rawPacsType,
        url: pacsInfo.url,
        version: pacsStatus.version,
        error: pacsStatus.error,
      },
      // Backwards compatible key for PWA
      orthanc: {
        status: pacsStatus.ok ? 'ok' : 'error',
        url: pacsInfo.url,
        version: pacsStatus.version,
        error: pacsStatus.error,
      },
      queue: {
        status: 'ok',
        jobsTotal: stats.total,
        jobsPending: stats.pending,
        jobsFailed: stats.failed,
        jobsSending: stats.sending,
        jobsSent: stats.sent,
      },
      database: {
        status: 'ok',
        jobsTotal: stats.total,
        jobsPending: stats.pending,
        jobsFailed: stats.failed,
      },
    };

    const httpStatus = 200; // Gateway siempre OK, cliente verifica gateway.status
    return reply.code(httpStatus).send(health);
  });

  // Detailed status (for monitoring)
  fastify.get('/status', async (_request: FastifyRequest, reply: FastifyReply) => {
    const pacsStatus = await checkPacsHealth();
    const pacsInfo = getPacsInfo();
    const stats = getJobStats();
    
    return reply.send({
      centro: config.centroNombre,
      centroId: config.centroId,
      gateway: {
        version: '1.0.0',
        uptime: Math.floor((Date.now() - startTime) / 1000),
        uptimeHuman: formatUptime(Date.now() - startTime),
        nodeEnv: config.nodeEnv,
      },
      pacs: {
        type: pacsInfo.type,
        url: pacsInfo.url,
        authType: pacsInfo.authType,
        connected: pacsStatus.ok,
        version: pacsStatus.version,
        error: pacsStatus.error,
      },
      orthanc: {
        url: pacsInfo.url,
        connected: pacsStatus.ok,
        version: pacsStatus.version,
        error: pacsStatus.error,
      },
      queue: {
        ...stats,
        retryIntervalMs: config.retryIntervalMs,
        maxRetryAttempts: config.maxRetryAttempts,
      },
      dicomweb: {
        stowPath: config.dicomwebStowPath,
        qidoPath: config.dicomwebQidoPath,
        wadoPath: config.dicomwebWadoPath,
      },
      worklist: {
        upsPath: config.worklistUpsPath,
        qidoMwlPath: config.worklistQidoMwlPath,
        preferUps: config.worklistPreferUps,
      },
      config: {
        allowedOrigins: config.allowedOrigins,
        cleanupAfterHours: config.cleanupAfterHours,
      },
    });
  });
}

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
