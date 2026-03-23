/**
 * Config Routes - Andex Gateway
 * UI y API para configurar el PACS y Worklist
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config/env.js';
import { dashboardAuth } from '../plugins/auth.plugin.js';
import { queryWorklist, getWorklistConfig, configureWorklist } from '../services/worklist.service.js';
import fs from 'fs';
import path from 'path';

// Runtime config (overrides .env)
let runtimeConfig: Record<string, string> = {};

export async function configRoutes(fastify: FastifyInstance): Promise<void> {

  // GET /config - Página de configuración
  fastify.get('/config', {
    preHandler: dashboardAuth,
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const html = generateConfigHtml();
      return reply.type('text/html').send(html);
    }
  });

  // GET /api/config - Obtener configuración actual
  fastify.get('/api/config', {
    preHandler: dashboardAuth,
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      return reply.send({
        success: true,
        config: {
          centroNombre: runtimeConfig.CENTRO_NOMBRE || config.centroNombre,
          centroId: runtimeConfig.CENTRO_ID || config.centroId,
          pacsType: runtimeConfig.PACS_TYPE || config.pacsType,
          pacsUrl: runtimeConfig.PACS_URL || config.pacsUrl,
          pacsAuthType: runtimeConfig.PACS_AUTH_TYPE || config.pacsAuthType,
          pacsUsername: runtimeConfig.PACS_USERNAME || config.pacsUsername,
          // DICOMweb paths
          dicomwebStowPath: runtimeConfig.DICOMWEB_STOW_PATH || config.dicomwebStowPath,
          dicomwebQidoPath: runtimeConfig.DICOMWEB_QIDO_PATH || config.dicomwebQidoPath,
          dicomwebWadoPath: runtimeConfig.DICOMWEB_WADO_PATH || config.dicomwebWadoPath,
          // DICOM Native (TCP)
          gatewayAeTitle: runtimeConfig.GATEWAY_AE_TITLE || config.gatewayAeTitle,
          pacsDicomHost: runtimeConfig.PACS_DICOM_HOST || config.pacsDicomHost,
          pacsDicomPort: parseInt(runtimeConfig.PACS_DICOM_PORT || String(config.pacsDicomPort)),
          pacsAeTitle: runtimeConfig.PACS_AE_TITLE || config.pacsAeTitle,
          gatewayDicomPort: parseInt(runtimeConfig.GATEWAY_DICOM_PORT || String(config.gatewayDicomPort)),
          // Worklist paths
          worklistUpsPath: runtimeConfig.WORKLIST_UPS_PATH || config.worklistUpsPath,
          worklistQidoMwlPath: runtimeConfig.WORKLIST_QIDO_MWL_PATH || config.worklistQidoMwlPath,
          worklistPreferUps: runtimeConfig.WORKLIST_PREFER_UPS !== 'false',
        }
      });
    }
  });

  // POST /api/config - Actualizar configuración
  fastify.post<{ Body: Record<string, any> }>('/api/config', {
    preHandler: dashboardAuth,
    handler: async (request: FastifyRequest<{ Body: Record<string, any> }>, reply: FastifyReply) => {
      const body = request.body;
      
      // Centro
      if (body.centroNombre) runtimeConfig.CENTRO_NOMBRE = body.centroNombre;
      if (body.centroId) runtimeConfig.CENTRO_ID = body.centroId;
      
      // PACS
      if (body.pacsType) runtimeConfig.PACS_TYPE = body.pacsType;
      if (body.pacsUrl) runtimeConfig.PACS_URL = body.pacsUrl;
      if (body.pacsAuthType) runtimeConfig.PACS_AUTH_TYPE = body.pacsAuthType;
      if (body.pacsUsername) runtimeConfig.PACS_USERNAME = body.pacsUsername;
      if (body.pacsPassword) runtimeConfig.PACS_PASSWORD = body.pacsPassword;
      
      // DICOM Native (TCP)
      if (body.gatewayAeTitle) runtimeConfig.GATEWAY_AE_TITLE = body.gatewayAeTitle;
      if (body.pacsDicomHost) runtimeConfig.PACS_DICOM_HOST = body.pacsDicomHost;
      if (body.pacsDicomPort) runtimeConfig.PACS_DICOM_PORT = String(body.pacsDicomPort);
      if (body.pacsAeTitle) runtimeConfig.PACS_AE_TITLE = body.pacsAeTitle;
      if (body.gatewayDicomPort) runtimeConfig.GATEWAY_DICOM_PORT = String(body.gatewayDicomPort);
      
      // DICOMweb paths
      if (body.dicomwebStowPath) runtimeConfig.DICOMWEB_STOW_PATH = body.dicomwebStowPath;
      if (body.dicomwebQidoPath) runtimeConfig.DICOMWEB_QIDO_PATH = body.dicomwebQidoPath;
      if (body.dicomwebWadoPath) runtimeConfig.DICOMWEB_WADO_PATH = body.dicomwebWadoPath;
      
      // Worklist paths
      if (body.worklistUpsPath) runtimeConfig.WORKLIST_UPS_PATH = body.worklistUpsPath;
      if (body.worklistQidoMwlPath) runtimeConfig.WORKLIST_QIDO_MWL_PATH = body.worklistQidoMwlPath;
      if (body.worklistPreferUps !== undefined) {
        runtimeConfig.WORKLIST_PREFER_UPS = body.worklistPreferUps ? 'true' : 'false';
      }
      
      // Update worklist service config
      configureWorklist({
        baseUrl: runtimeConfig.PACS_URL || config.pacsUrl,
        authType: (runtimeConfig.PACS_AUTH_TYPE || config.pacsAuthType) as 'none' | 'basic' | 'bearer',
        username: runtimeConfig.PACS_USERNAME || config.pacsUsername,
        password: runtimeConfig.PACS_PASSWORD || config.pacsPassword,
        upsPath: runtimeConfig.WORKLIST_UPS_PATH || config.worklistUpsPath,
        qidoMwlPath: runtimeConfig.WORKLIST_QIDO_MWL_PATH || config.worklistQidoMwlPath,
        preferUps: runtimeConfig.WORKLIST_PREFER_UPS !== 'false',
      });
      
      console.log('🔧 Configuración actualizada:', Object.keys(body).join(', '));
      
      return reply.send({
        success: true,
        message: 'Configuración actualizada (en memoria). Reinicie para aplicar cambios permanentes.'
      });
    }
  });

  // POST /api/config/save - Guardar a .env
  fastify.post('/api/config/save', {
    preHandler: dashboardAuth,
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const envPath = path.join(process.cwd(), '.env');
        let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';
        
        for (const [key, value] of Object.entries(runtimeConfig)) {
          const regex = new RegExp(`^${key}=.*$`, 'm');
          if (regex.test(envContent)) {
            envContent = envContent.replace(regex, `${key}=${value}`);
          } else {
            envContent += `\n${key}=${value}`;
          }
        }
        
        fs.writeFileSync(envPath, envContent.trim() + '\n');
        
        return reply.send({
          success: true,
          message: 'Configuración guardada en .env. Reinicie el Gateway para aplicar.'
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Error desconocido';
        return reply.status(500).send({ success: false, error: msg });
      }
    }
  });

  // POST /api/config/test-pacs - Probar conexión PACS (STOW endpoint)
  fastify.post('/api/config/test-pacs', {
    preHandler: dashboardAuth,
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const pacsUrl = runtimeConfig.PACS_URL || config.pacsUrl;
      const pacsType = runtimeConfig.PACS_TYPE || config.pacsType;
      
      try {
        const startTime = Date.now();
        let testUrl = pacsUrl;
        let testDescription = '';
        
        if (pacsType === 'orthanc') {
          testUrl = `${pacsUrl}/system`;
          testDescription = 'Orthanc /system';
        } else {
          // DICOMweb - test QIDO endpoint
          const qidoPath = runtimeConfig.DICOMWEB_QIDO_PATH || config.dicomwebQidoPath;
          testUrl = `${pacsUrl}${qidoPath}?limit=1`;
          testDescription = `QIDO-RS ${qidoPath}`;
        }
        
        const response = await fetch(testUrl, {
          method: 'GET',
          headers: getAuthHeaders(),
          signal: AbortSignal.timeout(10000)
        });
        
        const latency = Date.now() - startTime;
        
        if (response.ok || response.status === 204) {
          return reply.send({
            success: true,
            message: `Conexión exitosa (${latency}ms)`,
            endpoint: testDescription,
            status: response.status,
            pacsType,
            pacsUrl
          });
        } else {
          return reply.send({
            success: false,
            error: `HTTP ${response.status} - ${response.statusText}`,
            endpoint: testDescription,
            pacsType,
            pacsUrl
          });
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Error desconocido';
        return reply.send({
          success: false,
          error: msg,
          pacsUrl
        });
      }
    }
  });

  // POST /api/config/test-stow - Probar endpoint STOW-RS
  fastify.post('/api/config/test-stow', {
    preHandler: dashboardAuth,
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const pacsUrl = runtimeConfig.PACS_URL || config.pacsUrl;
      const pacsType = runtimeConfig.PACS_TYPE || config.pacsType;
      const stowPath = runtimeConfig.DICOMWEB_STOW_PATH || config.dicomwebStowPath;
      
      try {
        const startTime = Date.now();
        let testUrl = pacsUrl;
        let testDescription = '';
        
        if (pacsType === 'orthanc') {
          testUrl = `${pacsUrl}/instances`;
          testDescription = 'Orthanc /instances';
        } else {
          testUrl = `${pacsUrl}${stowPath}`;
          testDescription = `STOW-RS ${stowPath}`;
        }
        
        // OPTIONS request to check if endpoint exists
        const response = await fetch(testUrl, {
          method: 'OPTIONS',
          headers: getAuthHeaders(),
          signal: AbortSignal.timeout(10000)
        });
        
        const latency = Date.now() - startTime;
        
        // STOW endpoint typically accepts OPTIONS or returns 405 Method Not Allowed
        if (response.ok || response.status === 405 || response.status === 204) {
          return reply.send({
            success: true,
            message: `Endpoint STOW accesible (${latency}ms)`,
            endpoint: testDescription,
            stowUrl: testUrl,
            status: response.status,
            pacsType
          });
        } else {
          return reply.send({
            success: false,
            error: `HTTP ${response.status} - ${response.statusText}`,
            endpoint: testDescription,
            stowUrl: testUrl,
            pacsType
          });
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Error desconocido';
        return reply.send({
          success: false,
          error: msg,
          stowUrl: `${pacsUrl}${stowPath}`
        });
      }
    }
  });

  // POST /api/config/test-worklist - Probar Worklist
  fastify.post('/api/config/test-worklist', {
    preHandler: dashboardAuth,
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const startTime = Date.now();
        
        // Test worklist query with limit 5
        const result = await queryWorklist({ limit: 5 });
        const latency = Date.now() - startTime;
        
        const worklistConfig = getWorklistConfig();
        
        if (result.success) {
          return reply.send({
            success: true,
            message: `Worklist OK (${result.items.length} items encontrados)`,
            source: result.source,
            itemCount: result.items.length,
            totalAvailable: result.total || result.items.length,
            latency: `${latency}ms`,
            config: worklistConfig,
            // Preview of items
            preview: result.items.slice(0, 3).map(item => ({
              accessionNumber: item.accessionNumber,
              patientName: item.patientName,
              patientID: item.patientID,
              scheduledDateTime: item.scheduledDateTime,
              modality: item.modality,
              description: item.scheduledProcedureDescription
            }))
          });
        } else {
          return reply.send({
            success: false,
            error: result.error || 'No se pudo consultar el Worklist',
            source: result.source,
            config: worklistConfig
          });
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Error desconocido';
        return reply.send({
          success: false,
          error: msg
        });
      }
    }
  });


  // POST /api/config/test-cecho - Test DICOM C-ECHO (ping nativo)
  fastify.post('/api/config/test-cecho', {
    preHandler: dashboardAuth,
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const host = runtimeConfig.PACS_DICOM_HOST || config.pacsDicomHost;
      const port = parseInt(runtimeConfig.PACS_DICOM_PORT || String(config.pacsDicomPort));
      const calledAet = runtimeConfig.PACS_AE_TITLE || config.pacsAeTitle;
      const callingAet = runtimeConfig.GATEWAY_AE_TITLE || config.gatewayAeTitle;
      
      if (!host) {
        return reply.send({ success: false, error: 'PACS Host/IP no configurado' });
      }
      if (!calledAet) {
        return reply.send({ success: false, error: 'PACS AE Title no configurado' });
      }
      
      try {
        const startTime = Date.now();
        // TCP connection test (since we don't have a DICOM library, test TCP connectivity)
        const net = await import('net');
        const result = await new Promise<{success: boolean; error?: string}>((resolve) => {
          const socket = new net.default.Socket();
          const timeout = setTimeout(() => {
            socket.destroy();
            resolve({ success: false, error: `Timeout conectando a ${host}:${port}` });
          }, 5000);
          
          socket.connect(port, host, () => {
            clearTimeout(timeout);
            socket.destroy();
            resolve({ success: true });
          });
          
          socket.on('error', (err: Error) => {
            clearTimeout(timeout);
            resolve({ success: false, error: err.message });
          });
        });
        
        const latency = Date.now() - startTime;
        
        if (result.success) {
          return reply.send({
            success: true,
            message: `TCP OK - Puerto ${port} accesible (${latency}ms)`,
            details: {
              host,
              port,
              callingAet,
              calledAet,
              note: 'Conexión TCP exitosa. Para C-ECHO completo se requiere librería DICOM (dcmtk/dimse).'
            }
          });
        } else {
          return reply.send({
            success: false,
            error: result.error,
            details: { host, port, callingAet, calledAet }
          });
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Error desconocido';
        return reply.send({ success: false, error: msg });
      }
    }
  });

  console.log('🔧 Rutas de configuración registradas: /config, /api/config/*');
}

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Accept': 'application/json' };
  const authType = runtimeConfig.PACS_AUTH_TYPE || config.pacsAuthType;
  const username = runtimeConfig.PACS_USERNAME || config.pacsUsername;
  const password = runtimeConfig.PACS_PASSWORD || config.pacsPassword;
  
  if (authType === 'basic' && username) {
    headers['Authorization'] = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
  } else if (authType === 'bearer') {
    const token = runtimeConfig.PACS_TOKEN || config.pacsToken;
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  
  return headers;
}

function generateConfigHtml(): string {
  const currentConfig = {
    centroNombre: runtimeConfig.CENTRO_NOMBRE || config.centroNombre,
    centroId: runtimeConfig.CENTRO_ID || config.centroId,
    pacsType: runtimeConfig.PACS_TYPE || config.pacsType,
    pacsUrl: runtimeConfig.PACS_URL || config.pacsUrl,
    pacsAuthType: runtimeConfig.PACS_AUTH_TYPE || config.pacsAuthType,
    pacsUsername: runtimeConfig.PACS_USERNAME || config.pacsUsername,
    // DICOMweb
    dicomwebStowPath: runtimeConfig.DICOMWEB_STOW_PATH || config.dicomwebStowPath,
    dicomwebQidoPath: runtimeConfig.DICOMWEB_QIDO_PATH || config.dicomwebQidoPath,
    dicomwebWadoPath: runtimeConfig.DICOMWEB_WADO_PATH || config.dicomwebWadoPath,
    // Worklist
    worklistUpsPath: runtimeConfig.WORKLIST_UPS_PATH || config.worklistUpsPath,
    worklistQidoMwlPath: runtimeConfig.WORKLIST_QIDO_MWL_PATH || config.worklistQidoMwlPath,
    worklistPreferUps: runtimeConfig.WORKLIST_PREFER_UPS !== 'false',
    // DICOM Native
    gatewayAeTitle: runtimeConfig.GATEWAY_AE_TITLE || config.gatewayAeTitle,
    pacsDicomHost: runtimeConfig.PACS_DICOM_HOST || config.pacsDicomHost,
    pacsDicomPort: parseInt(runtimeConfig.PACS_DICOM_PORT || String(config.pacsDicomPort)),
    pacsAeTitle: runtimeConfig.PACS_AE_TITLE || config.pacsAeTitle,
    gatewayDicomPort: parseInt(runtimeConfig.GATEWAY_DICOM_PORT || String(config.gatewayDicomPort)),
  };

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Configuración - Andex Gateway</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f3f4f6; color: #1f2937; }
    .header { background: linear-gradient(135deg, #4f46e5, #7c3aed); color: white; padding: 20px; }
    .header h1 { font-size: 24px; margin-bottom: 4px; }
    .header p { opacity: 0.9; font-size: 14px; }
    .header a { color: white; text-decoration: none; opacity: 0.8; }
    .header a:hover { opacity: 1; }
    .container { max-width: 900px; margin: 0 auto; padding: 20px; }
    .card { background: white; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 20px; overflow: hidden; }
    .card-header { padding: 16px 20px; border-bottom: 1px solid #e5e7eb; background: #f9fafb; }
    .card-header h2 { font-size: 16px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
    .card-body { padding: 20px; }
    .form-group { margin-bottom: 16px; }
    .form-group label { display: block; font-size: 13px; font-weight: 500; color: #374151; margin-bottom: 6px; }
    .form-group input, .form-group select { width: 100%; padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; }
    .form-group input:focus, .form-group select:focus { outline: none; border-color: #4f46e5; box-shadow: 0 0 0 3px rgba(79,70,229,0.1); }
    .form-group small { display: block; margin-top: 4px; color: #6b7280; font-size: 12px; }
    .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .form-row-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }
    .btn { padding: 10px 20px; border-radius: 8px; border: none; cursor: pointer; font-size: 14px; font-weight: 500; display: inline-flex; align-items: center; gap: 6px; }
    .btn-primary { background: #4f46e5; color: white; }
    .btn-primary:hover { background: #4338ca; }
    .btn-success { background: #22c55e; color: white; }
    .btn-success:hover { background: #16a34a; }
    .btn-outline { background: white; color: #374151; border: 1px solid #d1d5db; }
    .btn-outline:hover { background: #f9fafb; }
    .btn-amber { background: #f59e0b; color: white; }
    .btn-amber:hover { background: #d97706; }
    .btn-group { display: flex; gap: 12px; margin-top: 20px; flex-wrap: wrap; }
    .alert { padding: 12px 16px; border-radius: 8px; margin-bottom: 16px; font-size: 14px; }
    .alert-success { background: #dcfce7; color: #166534; }
    .alert-error { background: #fee2e2; color: #991b1b; }
    .alert-info { background: #dbeafe; color: #1e40af; }
    #status { display: none; }
    .test-result { padding: 12px; background: #f9fafb; border-radius: 8px; margin-top: 12px; font-family: monospace; font-size: 13px; white-space: pre-wrap; }
    .checkbox-group { display: flex; align-items: center; gap: 8px; }
    .checkbox-group input[type="checkbox"] { width: auto; }
    .section-title { font-size: 14px; font-weight: 600; color: #4f46e5; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 2px solid #e5e7eb; }
  </style>
</head>
<body>
  <div class="header">
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <div>
        <h1>⚙️ Configuración PACS & Worklist</h1>
        <p>Andex Gateway - ${currentConfig.centroNombre}</p>
      </div>
      <a href="/">← Volver al Dashboard</a>
    </div>
  </div>
  
  <div class="container">
    <div id="status"></div>

    <!-- Centro -->
    <div class="card">
      <div class="card-header">
        <h2>🏥 Centro Médico</h2>
      </div>
      <div class="card-body">
        <div class="form-row">
          <div class="form-group">
            <label>Nombre del Centro</label>
            <input type="text" id="centroNombre" value="${currentConfig.centroNombre}">
          </div>
          <div class="form-group">
            <label>ID del Centro</label>
            <input type="text" id="centroId" value="${currentConfig.centroId}">
            <small>Identificador único (ej: HOSPTALC)</small>
          </div>
        </div>
      </div>
    </div>

    <!-- PACS -->
    <div class="card">
      <div class="card-header">
        <h2>🖥️ Servidor PACS</h2>
      </div>
      <div class="card-body">
        <div class="form-row">
          <div class="form-group">
            <label>Tipo de PACS</label>
            <select id="pacsType" onchange="toggleDicomwebFields()">
              <option value="orthanc" ${currentConfig.pacsType === 'orthanc' ? 'selected' : ''}>Orthanc REST API</option>
              <option value="dicomweb" ${currentConfig.pacsType === 'dicomweb' ? 'selected' : ''}>DICOMweb (STOW/QIDO/WADO)</option>
              <option value="dicom-native" ${currentConfig.pacsType === 'dicom-native' ? 'selected' : ''}>DICOM Nativo (TCP - C-STORE/MWL)</option>
            </select>
          </div>
          <div class="form-group">
            <label>URL del PACS</label>
            <input type="text" id="pacsUrl" value="${currentConfig.pacsUrl}" placeholder="http://192.168.1.100:8042">
          </div>
        </div>
        
        <div class="form-row">
          <div class="form-group">
            <label>Autenticación</label>
            <select id="pacsAuthType">
              <option value="none" ${currentConfig.pacsAuthType === 'none' ? 'selected' : ''}>Sin autenticación</option>
              <option value="basic" ${currentConfig.pacsAuthType === 'basic' ? 'selected' : ''}>Basic Auth</option>
              <option value="bearer" ${currentConfig.pacsAuthType === 'bearer' ? 'selected' : ''}>Bearer Token</option>
            </select>
          </div>
          <div class="form-group">
            <label>Usuario</label>
            <input type="text" id="pacsUsername" value="${currentConfig.pacsUsername || ''}">
          </div>
        </div>
        
        <div class="form-group">
          <label>Contraseña / Token</label>
          <input type="password" id="pacsPassword" placeholder="••••••••">
          <small>Dejar vacío para mantener la actual</small>
        </div>

        <div class="btn-group">
          <button class="btn btn-outline" onclick="testPacs()">🔌 Test Conexión</button>
        </div>
        <div id="testPacsResult"></div>
      </div>
    </div>

    <!-- DICOMweb Paths -->
    <div class="card" id="dicomwebCard">
      <div class="card-header">
        <h2>📡 Endpoints DICOMweb</h2>
      </div>
      <div class="card-body">
        <p class="section-title">STOW-RS (Almacenamiento)</p>
        <div class="form-group">
          <label>STOW-RS Path</label>
          <input type="text" id="dicomwebStowPath" value="${currentConfig.dicomwebStowPath}">
          <small>Endpoint para subir estudios DICOM (ej: /studies, /dcm4chee-arc/aets/DCM4CHEE/rs/studies)</small>
        </div>
        <div class="btn-group">
          <button class="btn btn-amber" onclick="testStow()">📤 Test STOW</button>
        </div>
        <div id="testStowResult"></div>

        <p class="section-title" style="margin-top: 20px;">QIDO-RS / WADO-RS (Consulta)</p>
        <div class="form-row">
          <div class="form-group">
            <label>QIDO-RS Path</label>
            <input type="text" id="dicomwebQidoPath" value="${currentConfig.dicomwebQidoPath}">
            <small>Endpoint para buscar estudios</small>
          </div>
          <div class="form-group">
            <label>WADO-RS Path</label>
            <input type="text" id="dicomwebWadoPath" value="${currentConfig.dicomwebWadoPath}">
            <small>Endpoint para recuperar estudios</small>
          </div>
        </div>
      </div>
    </div>


    <!-- DICOM Native -->
    <div class="card" id="dicomNativeCard">
      <div class="card-header">
        <h2>📡 DICOM Nativo (TCP)</h2>
      </div>
      <div class="card-body">
        <p class="section-title">🏥 Identidad del Gateway</p>
        <div class="form-row">
          <div class="form-group">
            <label>Gateway AE Title (Calling AET)</label>
            <input type="text" id="gatewayAeTitle" value="${currentConfig.gatewayAeTitle}" placeholder="ANDEX_GW" maxlength="16">
            <small>Nombre con que este Gateway se identifica ante el PACS (máx 16 caracteres, sin espacios)</small>
          </div>
          <div class="form-group">
            <label>Gateway DICOM Port</label>
            <input type="number" id="gatewayDicomPort" value="${currentConfig.gatewayDicomPort}" placeholder="11113">
            <small>Puerto local para recibir imágenes via C-MOVE (opcional)</small>
          </div>
        </div>

        <p class="section-title" style="margin-top: 20px;">🖥️ PACS Remoto (Synapse / DCM4CHEE / etc)</p>
        <div class="form-row-3">
          <div class="form-group">
            <label>PACS Host / IP</label>
            <input type="text" id="pacsDicomHost" value="${currentConfig.pacsDicomHost}" placeholder="192.168.1.100">
            <small>IP o hostname del servidor PACS</small>
          </div>
          <div class="form-group">
            <label>PACS DICOM Port</label>
            <input type="number" id="pacsDicomPort" value="${currentConfig.pacsDicomPort}" placeholder="104">
            <small>Puerto TCP DICOM (104 o 11112)</small>
          </div>
          <div class="form-group">
            <label>PACS AE Title (Called AET)</label>
            <input type="text" id="pacsAeTitle" value="${currentConfig.pacsAeTitle}" placeholder="SYNAPSE" maxlength="16">
            <small>AE Title del PACS destino</small>
          </div>
        </div>

        <div class="alert alert-info" style="margin-top: 12px;">
          <strong>⚠️ Importante:</strong> El PACS remoto debe tener configurado el AE Title del Gateway (<strong>${currentConfig.gatewayAeTitle || 'ANDEX_GW'}</strong>) como nodo permitido para enviar/recibir estudios. Solicita al administrador del PACS que agregue esta entrada.
        </div>

        <div class="btn-group">
          <button class="btn btn-outline" onclick="testCEcho()">🔌 Test Conexión TCP</button>
        </div>
        <div id="testCEchoResult"></div>
      </div>
    </div>

    <!-- Worklist -->
    <div class="card">
      <div class="card-header">
        <h2>📋 Worklist (MWL)</h2>
      </div>
      <div class="card-body">
        <div class="form-row">
          <div class="form-group">
            <label>UPS-RS Path (Workitems)</label>
            <input type="text" id="worklistUpsPath" value="${currentConfig.worklistUpsPath}">
            <small>Endpoint UPS-RS para consultar procedimientos (ej: /workitems)</small>
          </div>
          <div class="form-group">
            <label>QIDO-RS MWL Path</label>
            <input type="text" id="worklistQidoMwlPath" value="${currentConfig.worklistQidoMwlPath}">
            <small>Endpoint alternativo para MWL (ej: /mwlitems)</small>
          </div>
        </div>
        
        <div class="form-group">
          <div class="checkbox-group">
            <input type="checkbox" id="worklistPreferUps" ${currentConfig.worklistPreferUps ? 'checked' : ''}>
            <label for="worklistPreferUps" style="margin-bottom: 0;">Preferir UPS-RS sobre QIDO-RS MWL</label>
          </div>
          <small>Si está activo, se usará UPS-RS primero. Si falla, se intentará QIDO-RS MWL.</small>
        </div>

        <div class="btn-group">
          <button class="btn btn-success" onclick="testWorklist()">📋 Test Worklist</button>
        </div>
        <div id="testWorklistResult"></div>
      </div>
    </div>

    <!-- Actions -->
    <div class="btn-group">
      <button class="btn btn-primary" onclick="saveConfig()">💾 Guardar Configuración</button>
      <button class="btn btn-success" onclick="saveToEnv()">📝 Guardar en .env</button>
    </div>
  </div>

  <script>
    function showStatus(message, type) {
      type = type || 'info';
      var status = document.getElementById('status');
      status.className = 'alert alert-' + type;
      status.textContent = message;
      status.style.display = 'block';
      setTimeout(function() { status.style.display = 'none'; }, 5000);
    }

    function toggleDicomwebFields() {
      var pacsType = document.getElementById('pacsType').value;
      document.getElementById('dicomwebCard').style.display = (pacsType === 'dicomweb' || pacsType === 'orthanc') ? 'block' : 'none';
      document.getElementById('dicomNativeCard').style.display = pacsType === 'dicom-native' ? 'block' : 'none';
      // Show/hide URL field based on type
      var urlGroup = document.getElementById('pacsUrl').closest('.form-group');
      if (urlGroup) urlGroup.style.display = pacsType === 'dicom-native' ? 'none' : '';
    }
    toggleDicomwebFields();

    async function saveConfig() {
      var data = {
        centroNombre: document.getElementById('centroNombre').value,
        centroId: document.getElementById('centroId').value,
        pacsType: document.getElementById('pacsType').value,
        pacsUrl: document.getElementById('pacsUrl').value,
        pacsAuthType: document.getElementById('pacsAuthType').value,
        pacsUsername: document.getElementById('pacsUsername').value,
        dicomwebStowPath: document.getElementById('dicomwebStowPath').value,
        dicomwebQidoPath: document.getElementById('dicomwebQidoPath').value,
        dicomwebWadoPath: document.getElementById('dicomwebWadoPath').value,
        worklistUpsPath: document.getElementById('worklistUpsPath').value,
        worklistQidoMwlPath: document.getElementById('worklistQidoMwlPath').value,
        worklistPreferUps: document.getElementById('worklistPreferUps').checked,
        // DICOM Native
        gatewayAeTitle: document.getElementById('gatewayAeTitle').value,
        pacsDicomHost: document.getElementById('pacsDicomHost').value,
        pacsDicomPort: parseInt(document.getElementById('pacsDicomPort').value) || 104,
        pacsAeTitle: document.getElementById('pacsAeTitle').value,
        gatewayDicomPort: parseInt(document.getElementById('gatewayDicomPort').value) || 11113,
      };
      
      var password = document.getElementById('pacsPassword').value;
      if (password) data.pacsPassword = password;
      
      try {
        var resp = await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
          credentials: 'include'
        });
        var result = await resp.json();
        showStatus(result.message || 'Configuración guardada', result.success ? 'success' : 'error');
      } catch (e) {
        showStatus('Error: ' + e.message, 'error');
      }
    }

    async function saveToEnv() {
      if (!confirm('¿Guardar configuración en .env? Deberá reiniciar el Gateway.')) return;
      
      await saveConfig();
      
      try {
        var resp = await fetch('/api/config/save', {
          method: 'POST',
          credentials: 'include'
        });
        var result = await resp.json();
        showStatus(result.message || 'Guardado en .env', result.success ? 'success' : 'error');
      } catch (e) {
        showStatus('Error: ' + e.message, 'error');
      }
    }

    async function testPacs() {
      var resultDiv = document.getElementById('testPacsResult');
      resultDiv.innerHTML = '<div class="test-result">⏳ Probando conexión PACS...</div>';
      
      try {
        await saveConfig();
        
        var resp = await fetch('/api/config/test-pacs', {
          method: 'POST',
          credentials: 'include'
        });
        var result = await resp.json();
        
        if (result.success) {
          resultDiv.innerHTML = '<div class="test-result" style="background:#dcfce7;">✅ ' + result.message + '\\nEndpoint: ' + result.endpoint + '\\nURL: ' + result.pacsUrl + '</div>';
        } else {
          resultDiv.innerHTML = '<div class="test-result" style="background:#fee2e2;">❌ ' + result.error + '\\nURL: ' + result.pacsUrl + '</div>';
        }
      } catch (e) {
        resultDiv.innerHTML = '<div class="test-result" style="background:#fee2e2;">❌ ' + e.message + '</div>';
      }
    }

    async function testStow() {
      var resultDiv = document.getElementById('testStowResult');
      resultDiv.innerHTML = '<div class="test-result">⏳ Probando endpoint STOW...</div>';
      
      try {
        await saveConfig();
        
        var resp = await fetch('/api/config/test-stow', {
          method: 'POST',
          credentials: 'include'
        });
        var result = await resp.json();
        
        if (result.success) {
          resultDiv.innerHTML = '<div class="test-result" style="background:#dcfce7;">✅ ' + result.message + '\\nEndpoint: ' + result.endpoint + '\\nURL: ' + result.stowUrl + '</div>';
        } else {
          resultDiv.innerHTML = '<div class="test-result" style="background:#fee2e2;">❌ ' + result.error + '\\nURL: ' + result.stowUrl + '</div>';
        }
      } catch (e) {
        resultDiv.innerHTML = '<div class="test-result" style="background:#fee2e2;">❌ ' + e.message + '</div>';
      }
    }

    async function testWorklist() {
      var resultDiv = document.getElementById('testWorklistResult');
      resultDiv.innerHTML = '<div class="test-result">⏳ Probando Worklist...</div>';
      
      try {
        await saveConfig();
        
        var resp = await fetch('/api/config/test-worklist', {
          method: 'POST',
          credentials: 'include'
        });
        var result = await resp.json();
        
        if (result.success) {
          var preview = '';
          if (result.preview && result.preview.length > 0) {
            preview = '\\n\\nPrimeros items:\\n' + result.preview.map(function(item) {
              return '• ' + (item.patientName || 'Sin nombre') + ' - ' + (item.accessionNumber || 'Sin accession') + ' - ' + (item.description || '');
            }).join('\\n');
          }
          resultDiv.innerHTML = '<div class="test-result" style="background:#dcfce7;">✅ ' + result.message + '\\nFuente: ' + result.source + '\\nLatencia: ' + result.latency + preview + '</div>';
        } else {
          resultDiv.innerHTML = '<div class="test-result" style="background:#fee2e2;">❌ ' + result.error + '\\nFuente: ' + (result.source || 'desconocida') + '</div>';
        }
      } catch (e) {
        resultDiv.innerHTML = '<div class="test-result" style="background:#fee2e2;">❌ ' + e.message + '</div>';
      }
    }
  </script>
</body>
</html>`;
}
