/**
 * Worklist Routes - Andex Gateway
 * ================================
 * Endpoints para consultar y gestionar la Modality Worklist
 * desde FUJIFILM Synapse 7
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { 
  queryWorklist, 
  getWorklistItem, 
  updateWorkitemState,
  configureWorklist,
  getWorklistConfig,
  WorklistQuery 
} from '../services/worklist.service.js';
import { config } from '../config/env.js';
import { log } from '../services/observability.service.js';

// =====================================================
// TYPES
// =====================================================

interface WorklistQueryParams {
  date?: string;
  patientId?: string;
  patientName?: string;
  modality?: string;
  accessionNumber?: string;
  stationAET?: string;
  limit?: string;
  offset?: string;
}

interface WorkitemStateBody {
  state: 'IN PROGRESS' | 'COMPLETED' | 'CANCELED';
  transactionUID?: string;
}

// =====================================================
// RUTAS
// =====================================================

export async function worklistRoutes(fastify: FastifyInstance): Promise<void> {
  
  // --------------------------------------------------
  // GET /api/worklist - Consultar Worklist
  // --------------------------------------------------
  fastify.get<{ Querystring: WorklistQueryParams }>(
    '/api/worklist',
    {
      preHandler: async (request, reply) => {
        // Verificar API Key
        const apiKey = request.headers['x-api-key'];
        if (apiKey !== config.apiKey) {
          log('warn', 'Acceso no autorizado a worklist', { 
            ip: request.ip,
            path: request.url
          });
          return reply.status(401).send({ error: 'API Key inválida' });
        }
      }
    },
    async (request, reply) => {
      const startTime = Date.now();
      
      try {
        const { date, patientId, patientName, modality, accessionNumber, stationAET, limit, offset } = request.query;
        
        const query: WorklistQuery = {};
        
        // Parsear parámetros
        if (date) query.date = date;
        if (patientId) query.patientID = patientId;
        if (patientName) query.patientName = patientName;
        if (modality) query.modality = modality;
        if (accessionNumber) query.accessionNumber = accessionNumber;
        if (stationAET) query.stationAET = stationAET;
        if (limit) { const n = parseInt(limit, 10); if (!isNaN(n) && n > 0) query.limit = n; }
        if (offset) { const n = parseInt(offset, 10); if (!isNaN(n) && n >= 0) query.offset = n; }
        
        log('info', 'Consultando Worklist', { query });
        
        const result = await queryWorklist(query);
        
        const duration = Date.now() - startTime;
        
        if (result.success) {
          log('info', `Worklist: ${result.items.length} items`, { 
            source: result.source,
            duration: `${duration}ms`
          });
          
          return reply.send({
            success: true,
            items: result.items,
            total: result.total,
            source: result.source,
            query,
            timestamp: new Date().toISOString()
          });
        } else {
          log('error', 'Error consultando Worklist', { error: result.error });
          return reply.status(500).send({
            success: false,
            error: result.error,
            items: []
          });
        }
        
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Error desconocido';
        log('error', 'Excepción en Worklist', { error: message });
        return reply.status(500).send({
          success: false,
          error: message,
          items: []
        });
      }
    }
  );

  // --------------------------------------------------
  // GET /api/worklist/today - Worklist del día
  // --------------------------------------------------
  fastify.get(
    '/api/worklist/today',
    {
      preHandler: async (request, reply) => {
        const apiKey = request.headers['x-api-key'];
        if (apiKey !== config.apiKey) {
          return reply.status(401).send({ error: 'API Key inválida' });
        }
      }
    },
    async (request, reply) => {
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      
      const result = await queryWorklist({ 
        date: today,
        modality: 'ES'  // Endoscopy por defecto
      });
      
      return reply.send({
        success: result.success,
        date: today,
        items: result.items,
        total: result.total,
        source: result.source
      });
    }
  );

  // --------------------------------------------------
  // GET /api/worklist/:accessionNumber - Item específico
  // --------------------------------------------------
  fastify.get<{ Params: { accessionNumber: string } }>(
    '/api/worklist/:accessionNumber',
    {
      preHandler: async (request, reply) => {
        const apiKey = request.headers['x-api-key'];
        if (apiKey !== config.apiKey) {
          return reply.status(401).send({ error: 'API Key inválida' });
        }
      }
    },
    async (request, reply) => {
      const { accessionNumber } = request.params;
      
      const result = await getWorklistItem(accessionNumber);
      
      if (result.success && result.item) {
        return reply.send({
          success: true,
          item: result.item
        });
      } else {
        return reply.status(404).send({
          success: false,
          error: result.error || 'Item no encontrado'
        });
      }
    }
  );

  // --------------------------------------------------
  // PUT /api/worklist/:workitemUID/state - Actualizar estado (UPS-RS)
  // --------------------------------------------------
  fastify.put<{ 
    Params: { workitemUID: string };
    Body: WorkitemStateBody;
  }>(
    '/api/worklist/:workitemUID/state',
    {
      preHandler: async (request, reply) => {
        const apiKey = request.headers['x-api-key'];
        if (apiKey !== config.apiKey) {
          return reply.status(401).send({ error: 'API Key inválida' });
        }
      }
    },
    async (request, reply) => {
      const { workitemUID } = request.params;
      const { state, transactionUID } = request.body;
      
      if (!['IN PROGRESS', 'COMPLETED', 'CANCELED'].includes(state)) {
        return reply.status(400).send({
          success: false,
          error: 'Estado inválido. Usar: IN PROGRESS, COMPLETED, CANCELED'
        });
      }
      
      log('info', `Actualizando workitem ${workitemUID} a ${state}`);
      
      const result = await updateWorkitemState(workitemUID, state, transactionUID);
      
      if (result.success) {
        return reply.send({
          success: true,
          workitemUID,
          newState: state
        });
      } else {
        return reply.status(500).send({
          success: false,
          error: result.error
        });
      }
    }
  );

  // --------------------------------------------------
  // GET /api/worklist/config - Ver configuración (sin secretos)
  // --------------------------------------------------
  fastify.get(
    '/api/worklist/config',
    {
      preHandler: async (request, reply) => {
        const apiKey = request.headers['x-api-key'];
        if (apiKey !== config.apiKey) {
          return reply.status(401).send({ error: 'API Key inválida' });
        }
      }
    },
    async (request, reply) => {
      const cfg = getWorklistConfig();
      return reply.send({
        success: true,
        config: cfg
      });
    }
  );

  // --------------------------------------------------
  // POST /api/worklist/config - Actualizar configuración
  // --------------------------------------------------
  fastify.post<{ Body: Record<string, any> }>(
    '/api/worklist/config',
    {
      preHandler: async (request, reply) => {
        const apiKey = request.headers['x-api-key'];
        if (apiKey !== config.apiKey) {
          return reply.status(401).send({ error: 'API Key inválida' });
        }
      }
    },
    async (request, reply) => {
      const newConfig = request.body;
      
      configureWorklist(newConfig);
      
      log('info', 'Configuración Worklist actualizada', { 
        baseUrl: newConfig.baseUrl,
        preferUps: newConfig.preferUps
      });
      
      return reply.send({
        success: true,
        message: 'Configuración actualizada',
        config: getWorklistConfig()
      });
    }
  );

  // --------------------------------------------------
  // GET /api/worklist/test - Probar conexión
  // --------------------------------------------------
  fastify.get(
    '/api/worklist/test',
    {
      preHandler: async (request, reply) => {
        const apiKey = request.headers['x-api-key'];
        if (apiKey !== config.apiKey) {
          return reply.status(401).send({ error: 'API Key inválida' });
        }
      }
    },
    async (request, reply) => {
      const startTime = Date.now();
      
      try {
        // Intentar consulta mínima
        const result = await queryWorklist({ limit: 1 });
        const duration = Date.now() - startTime;
        
        return reply.send({
          success: result.success,
          source: result.source,
          responseTime: `${duration}ms`,
          itemsAvailable: result.total || 0,
          config: getWorklistConfig(),
          error: result.error
        });
        
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Error desconocido';
        return reply.status(500).send({
          success: false,
          error: message,
          responseTime: `${Date.now() - startTime}ms`
        });
      }
    }
  );

  console.log('📋 Rutas Worklist registradas: /api/worklist/*');
}
