import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config/env.js';

// API Key authentication for API routes
export async function apiKeyAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const apiKey = request.headers['x-api-key'];
  
  if (!apiKey || apiKey !== config.apiKey) {
    reply.code(401).send({ 
      error: 'Unauthorized', 
      message: 'Invalid or missing API key' 
    });
    return;
  }
}

// Basic auth for dashboard
export async function dashboardAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = request.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    reply.header('WWW-Authenticate', 'Basic realm="Andex Gateway Dashboard"');
    reply.code(401).send({ error: 'Authentication required' });
    return;
  }

  const base64Credentials = authHeader.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
  const colonIdx = credentials.indexOf(':');
  const username = colonIdx > -1 ? credentials.substring(0, colonIdx) : credentials;
  const password = colonIdx > -1 ? credentials.substring(colonIdx + 1) : '';

  if (username !== config.dashboardUser || password !== config.dashboardPassword) {
    reply.header('WWW-Authenticate', 'Basic realm="Andex Gateway Dashboard"');
    reply.code(401).send({ error: 'Invalid credentials' });
    return;
  }
}

// Register auth plugin
export function registerAuthPlugin(fastify: FastifyInstance): void {
  // Decorate with auth functions
  fastify.decorate('apiKeyAuth', apiKeyAuth);
  fastify.decorate('dashboardAuth', dashboardAuth);
}
