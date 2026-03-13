import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config/env.js';
import { getJobStats } from '../db/database.js';
import { checkOrthancHealth } from '../services/orthanc.service.js';
import type { HealthStatus } from '../types/index.js';

const startTime = Date.now();

export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  
  // Simple health check (public)
  fastify.get('/health', async (_request: FastifyRequest, reply: FastifyReply) => {
    const orthancStatus = await checkOrthancHealth();
    const stats = getJobStats();
    
    const health: HealthStatus = {
      gateway: {
        status: 'ok',
        uptime: Math.floor((Date.now() - startTime) / 1000),
        version: '1.0.0',
      },
      orthanc: {
        status: orthancStatus.ok ? 'ok' : 'error',
        url: config.orthancUrl,
        version: orthancStatus.version,
        error: orthancStatus.error,
      },
      database: {
        status: 'ok',
        jobsTotal: stats.total,
        jobsPending: stats.pending,
        jobsFailed: stats.failed,
      },
    };

    const httpStatus = orthancStatus.ok ? 200 : 503;
    return reply.code(httpStatus).send(health);
  });

  // Detailed status (for monitoring)
  fastify.get('/status', async (_request: FastifyRequest, reply: FastifyReply) => {
    const orthancStatus = await checkOrthancHealth();
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
      orthanc: {
        url: config.orthancUrl,
        connected: orthancStatus.ok,
        version: orthancStatus.version,
        error: orthancStatus.error,
      },
      queue: {
        ...stats,
        retryIntervalMs: config.retryIntervalMs,
        maxRetryAttempts: config.maxRetryAttempts,
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
