/**
 * Config Routes - Andex Gateway
 * UI y API para configurar el PACS y Worklist
 * Configuracion persistida en data/gateway-config.json
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config/env.js';
import { dashboardAuth } from '../plugins/auth.plugin.js';
import { queryWorklist, getWorklistConfig, configureWorklist } from '../services/worklist.service.js';
import { configStore } from '../config/config-store.js';

export async function configRoutes(fastify: FastifyInstance): Promise<void> {

  // GET /config - Pagina de configuracion
  fastify.get('/config', {
    preHandler: dashboardAuth,
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const html = generateConfigHtml();
      return reply.type('text/html').send(html);
    }
  });

  // GET /api/config - Obtener configuracion actual
  fastify.get('/api/config', {
    preHandler: dashboardAuth,
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const s = configStore.getAll();
      return reply.send({
        success: true,
        config: {
          centroNombre: s.centroNombre || config.centroNombre,
          centroId: s.centroId || config.centroId,
          apiKey: s.apiKey || config.apiKey,
          dashboardUser: s.dashboardUser || config.dashboardUser,
          allowedOrigins: s.allowedOrigins || config.allowedOrigins.join(','),
          pacsType: s.pacsType || config.pacsType,
          pacsUrl: s.pacsBaseUrl || config.pacsBaseUrl,
          pacsAuthType: s.pacsAuthType || config.pacsAuthType,
          pacsUsername: s.pacsUsername || config.pacsUsername,
          dicomwebStowPath: s.pacsStowEndpoint || config.dicomwebStowPath,
          dicomwebQidoPath: s.pacsQidoEndpoint || config.dicomwebQidoPath,
          dicomwebWadoPath: s.pacsWadoEndpoint || config.dicomwebWadoPath,
          gatewayAeTitle: s.gatewayAeTitle || config.gatewayAeTitle,
          pacsDicomHost: s.pacsDicomHost || config.pacsDicomHost,
          pacsDicomPort: s.pacsDicomPort || config.pacsDicomPort,
          pacsAeTitle: s.pacsAeTitle || config.pacsAeTitle,
          gatewayDicomPort: s.gatewayDicomPort || config.gatewayDicomPort,
          worklistUpsPath: s.worklistEndpoint || config.worklistUpsPath,
          worklistQidoMwlPath: s.worklistMwlEndpoint || config.worklistQidoMwlPath,
          worklistPreferUps: s.worklistPreferUps !== undefined ? s.worklistPreferUps : config.worklistPreferUps,
        }
      });
    }
  });

  // POST /api/config - Guardar configuracion en gateway-config.json
  fastify.post<{ Body: Record<string, any> }>('/api/config', {
    preHandler: dashboardAuth,
    handler: async (request: FastifyRequest<{ Body: Record<string, any> }>, reply: FastifyReply) => {
      const body = request.body;
      
      const updates: Record<string, any> = {};
      if (body.centroNombre) updates.centroNombre = body.centroNombre;
      if (body.centroId) updates.centroId = body.centroId;
      if (body.apiKey) updates.apiKey = body.apiKey;
      if (body.dashboardUser) updates.dashboardUser = body.dashboardUser;
      if (body.dashboardPassword) updates.dashboardPassword = body.dashboardPassword;
      if (body.allowedOrigins) updates.allowedOrigins = body.allowedOrigins;
      if (body.pacsType) updates.pacsType = body.pacsType;
      if (body.pacsUrl) updates.pacsBaseUrl = body.pacsUrl;
      if (body.pacsAuthType) updates.pacsAuthType = body.pacsAuthType;
      if (body.pacsUsername !== undefined) updates.pacsUsername = body.pacsUsername;
      if (body.pacsPassword) updates.pacsPassword = body.pacsPassword;
      if (body.gatewayAeTitle) updates.gatewayAeTitle = body.gatewayAeTitle;
      if (body.pacsDicomHost !== undefined) updates.pacsDicomHost = body.pacsDicomHost;
      if (body.pacsDicomPort) updates.pacsDicomPort = body.pacsDicomPort;
      if (body.pacsAeTitle !== undefined) updates.pacsAeTitle = body.pacsAeTitle;
      if (body.gatewayDicomPort) updates.gatewayDicomPort = body.gatewayDicomPort;
      if (body.dicomwebStowPath) updates.pacsStowEndpoint = body.dicomwebStowPath;
      if (body.dicomwebQidoPath) updates.pacsQidoEndpoint = body.dicomwebQidoPath;
      if (body.dicomwebWadoPath) updates.pacsWadoEndpoint = body.dicomwebWadoPath;
      if (body.worklistUpsPath) updates.worklistEndpoint = body.worklistUpsPath;
      if (body.worklistQidoMwlPath) updates.worklistMwlEndpoint = body.worklistQidoMwlPath;
      if (body.worklistPreferUps !== undefined) updates.worklistPreferUps = !!body.worklistPreferUps;
      
      const result = configStore.save(updates);
      
      if (!result.success) {
        return reply.status(500).send({ success: false, error: result.error });
      }
      
      // Update worklist service config live
      try {
        configureWorklist({
          baseUrl: body.pacsUrl || config.pacsUrl,
          authType: (body.pacsAuthType || config.pacsAuthType) as 'none' | 'basic' | 'bearer',
          username: body.pacsUsername || config.pacsUsername,
          password: body.pacsPassword || config.pacsPassword,
          upsPath: body.worklistUpsPath || config.worklistUpsPath,
          qidoMwlPath: body.worklistQidoMwlPath || config.worklistQidoMwlPath,
          preferUps: body.worklistPreferUps !== false,
        });
      } catch (e) { /* non-critical */ }
      
      console.log('\u{1F527} Config guardada:', Object.keys(updates).join(', '));
      
      return reply.send({
        success: true,
        message: 'Configuracion guardada. Reinicie el Gateway para aplicar todos los cambios.'
      });
    }
  });

  // ========================================
  // HELPERS: labels & diagnostics for tests
  // ========================================
  function getPacsTypeLabel(type: string): string {
    switch (type) {
      case 'orthanc': return 'Orthanc REST API';
      case 'dicomweb': return 'DICOMweb (STOW/QIDO/WADO)';
      case 'dicom-native': return 'DICOM Nativo (TCP)';
      default: return type || 'No configurado';
    }
  }

  function diagnoseError(err: unknown, context: { pacsType: string; url?: string; host?: string; port?: number }): { error: string; hint: string } {
    const msg = err instanceof Error ? err.message : String(err);
    const label = getPacsTypeLabel(context.pacsType);
    let hint = '';

    // Connection refused
    if (/ECONNREFUSED/i.test(msg)) {
      if (context.url) {
        hint = `El servidor no responde en ${context.url}. Verifique que el PACS (${label}) esté encendido y que la URL y puerto sean correctos.`;
      } else {
        hint = `No se pudo conectar a ${context.host}:${context.port}. Verifique que el PACS esté encendido y el puerto abierto en el firewall.`;
      }
    }
    // DNS resolution
    else if (/ENOTFOUND|getaddrinfo/i.test(msg)) {
      const target = context.url || context.host || '';
      hint = `No se puede resolver el hostname. Verifique que la dirección "${target}" sea correcta y accesible desde este equipo.`;
    }
    // Timeout
    else if (/timeout|ETIMEDOUT|ESOCKETTIMEDOUT/i.test(msg)) {
      hint = `La conexión tardó demasiado (>10s). Posibles causas: firewall bloqueando, IP incorrecta, o el PACS está sobrecargado.`;
    }
    // SSL/TLS
    else if (/SELF_SIGNED|CERT|SSL|TLS|UNABLE_TO_VERIFY/i.test(msg)) {
      hint = `Error de certificado SSL/TLS. Si el PACS usa certificado auto-firmado, configure NODE_TLS_REJECT_UNAUTHORIZED=0 en el .env (solo desarrollo).`;
    }
    // Network unreachable
    else if (/ENETUNREACH|EHOSTUNREACH|NETWORK/i.test(msg)) {
      hint = `Red inalcanzable. Verifique que este equipo tiene acceso a la red donde está el PACS.`;
    }
    // Port in use / permission
    else if (/EACCES|EADDRINUSE/i.test(msg)) {
      hint = `Error de permisos o puerto en uso. Verifique que el puerto no esté ocupado por otro servicio.`;
    }
    // Abort
    else if (/abort/i.test(msg)) {
      hint = `La petición fue cancelada. Posible timeout de red.`;
    }
    // Generic
    else {
      hint = `Error inesperado. Verifique que la configuración de PACS tipo "${label}" sea correcta.`;
    }

    return { error: msg, hint };
  }

  // POST /api/config/test-pacs - Probar conexion PACS
  fastify.post('/api/config/test-pacs', {
    preHandler: dashboardAuth,
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const s = configStore.getAll();
      const pacsUrl = s.pacsBaseUrl || config.pacsUrl;
      const pacsType = s.pacsType || config.pacsType;
      const label = getPacsTypeLabel(pacsType);
      
      // Block test if type is dicom-native (no HTTP)
      if (pacsType === 'dicom-native') {
        const host = s.pacsDicomHost || config.pacsDicomHost;
        const port = s.pacsDicomPort || config.pacsDicomPort;
        return reply.send({
          success: false,
          error: `Este test es para PACS HTTP — su configuración actual es "${label}"`,
          hint: host
            ? `Use el botón "Test Conexión TCP" en la sección DICOM Nativo para probar ${host}:${port}.`
            : `Configure el Host/IP del PACS en la sección DICOM Nativo y use "Test Conexión TCP".`,
          pacsType,
          pacsTypeLabel: label
        });
      }
      
      // Validate URL
      if (!pacsUrl || pacsUrl === 'http://localhost:8042' && pacsType === 'dicomweb') {
        return reply.send({
          success: false,
          error: 'URL del PACS no configurada o usando valor por defecto de Orthanc',
          hint: `Tiene seleccionado "${label}" pero la URL es "${pacsUrl}". Ingrese la URL correcta de su PACS.`,
          pacsType,
          pacsTypeLabel: label,
          pacsUrl
        });
      }
      
      try {
        const startTime = Date.now();
        let testUrl = pacsUrl;
        let testDescription = '';
        
        if (pacsType === 'orthanc') {
          testUrl = `${pacsUrl}/system`;
          testDescription = `${label} → GET /system`;
        } else {
          const qidoPath = s.pacsQidoEndpoint || config.dicomwebQidoPath;
          testUrl = `${pacsUrl}${qidoPath}?limit=1`;
          testDescription = `${label} → QIDO-RS ${qidoPath}`;
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
            message: `✅ Conexión exitosa a ${label} (${latency}ms)`,
            endpoint: testDescription,
            status: response.status,
            pacsType,
            pacsTypeLabel: label,
            pacsUrl
          });
        } else {
          // Detect misconfig: Orthanc /system returns 404 → probably not Orthanc
          let hint = '';
          if (pacsType === 'orthanc' && response.status === 404) {
            hint = `El endpoint /system respondió 404. Esto indica que el servidor probablemente NO es Orthanc. Si es FUJIFILM Synapse, DCM4CHEE u otro PACS DICOMweb, cambie el tipo a "DICOMweb" en la configuración.`;
          } else if (response.status === 401 || response.status === 403) {
            hint = `Acceso denegado. Verifique las credenciales de autenticación (${s.pacsAuthType || config.pacsAuthType}). Si el PACS requiere usuario/contraseña, configúrelos en la sección de autenticación.`;
          } else if (response.status === 404) {
            hint = `Endpoint no encontrado. Verifique que la URL base "${pacsUrl}" sea correcta y que los paths DICOMweb coincidan con su PACS.`;
          } else if (response.status === 502 || response.status === 503) {
            hint = `El servidor respondió pero el servicio PACS no está disponible. Puede estar iniciando o en mantenimiento.`;
          } else {
            hint = `Respuesta inesperada del PACS. Verifique que la configuración tipo "${label}" coincida con su servidor real.`;
          }
          
          return reply.send({
            success: false,
            error: `HTTP ${response.status} - ${response.statusText}`,
            hint,
            endpoint: testDescription,
            testedUrl: testUrl,
            pacsType,
            pacsTypeLabel: label,
            pacsUrl
          });
        }
      } catch (error) {
        const diag = diagnoseError(error, { pacsType, url: pacsUrl });
        return reply.send({
          success: false,
          error: `Error conectando a ${label}: ${diag.error}`,
          hint: diag.hint,
          pacsType,
          pacsTypeLabel: label,
          pacsUrl
        });
      }
    }
  });

  // POST /api/config/test-stow - Probar endpoint STOW-RS
  fastify.post('/api/config/test-stow', {
    preHandler: dashboardAuth,
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const s = configStore.getAll();
      const pacsUrl = s.pacsBaseUrl || config.pacsUrl;
      const pacsType = s.pacsType || config.pacsType;
      const stowPath = s.pacsStowEndpoint || config.dicomwebStowPath;
      const label = getPacsTypeLabel(pacsType);
      
      // Block test if type is dicom-native
      if (pacsType === 'dicom-native') {
        return reply.send({
          success: false,
          error: `STOW-RS no aplica para "${label}"`,
          hint: 'El envío de imágenes en DICOM Nativo usa C-STORE (TCP), no STOW-RS (HTTP). Use "Test Conexión TCP" en la sección DICOM Nativo.',
          pacsType,
          pacsTypeLabel: label
        });
      }
      
      try {
        const startTime = Date.now();
        let testUrl = pacsUrl;
        let testDescription = '';
        
        if (pacsType === 'orthanc') {
          testUrl = `${pacsUrl}/instances`;
          testDescription = `${label} → POST /instances`;
        } else {
          testUrl = `${pacsUrl}${stowPath}`;
          testDescription = `${label} → STOW-RS ${stowPath}`;
        }
        
        const response = await fetch(testUrl, {
          method: 'OPTIONS',
          headers: getAuthHeaders(),
          signal: AbortSignal.timeout(10000)
        });
        
        const latency = Date.now() - startTime;
        
        if (response.ok || response.status === 405 || response.status === 204) {
          return reply.send({
            success: true,
            message: `✅ Endpoint STOW accesible en ${label} (${latency}ms)`,
            endpoint: testDescription,
            stowUrl: testUrl,
            status: response.status,
            pacsType,
            pacsTypeLabel: label
          });
        } else {
          let hint = '';
          if (response.status === 404) {
            hint = pacsType === 'orthanc'
              ? `El endpoint /instances no existe. Verifique que la URL "${pacsUrl}" apunta a un Orthanc real. Si es otro tipo de PACS, cambie el tipo en la configuración.`
              : `El path STOW "${stowPath}" no existe en ${pacsUrl}. Verifique que el path sea correcto para su PACS (${label}).`;
          } else if (response.status === 401 || response.status === 403) {
            hint = `Sin autorización para STOW. Verifique credenciales y permisos de escritura en el PACS.`;
          } else {
            hint = `Respuesta inesperada. Confirme que el tipo "${label}" y URL "${pacsUrl}" son correctos.`;
          }
          
          return reply.send({
            success: false,
            error: `HTTP ${response.status} - ${response.statusText}`,
            hint,
            endpoint: testDescription,
            stowUrl: testUrl,
            pacsType,
            pacsTypeLabel: label
          });
        }
      } catch (error) {
        const diag = diagnoseError(error, { pacsType, url: pacsUrl });
        return reply.send({
          success: false,
          error: `Error conectando a ${label} (STOW): ${diag.error}`,
          hint: diag.hint,
          stowUrl: `${pacsUrl}${stowPath}`,
          pacsType,
          pacsTypeLabel: label
        });
      }
    }
  });

  // POST /api/config/test-worklist - Probar Worklist
  fastify.post('/api/config/test-worklist', {
    preHandler: dashboardAuth,
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const s = configStore.getAll();
      const pacsType = s.pacsType || config.pacsType;
      const pacsUrl = s.pacsBaseUrl || config.pacsUrl;
      const label = getPacsTypeLabel(pacsType);
      
      try {
        const startTime = Date.now();
        const result = await queryWorklist({ limit: 5 });
        const latency = Date.now() - startTime;
        const worklistConfig = getWorklistConfig();
        
        if (result.success) {
          const itemCount = result.items.length;
          return reply.send({
            success: true,
            message: `✅ Worklist OK — ${itemCount} item${itemCount !== 1 ? 's' : ''} encontrado${itemCount !== 1 ? 's' : ''} (${latency}ms)`,
            source: result.source,
            itemCount,
            totalAvailable: result.total || itemCount,
            latency: `${latency}ms`,
            pacsType,
            pacsTypeLabel: label,
            config: worklistConfig,
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
          let hint = '';
          const errMsg = result.error || 'No se pudo consultar el Worklist';
          
          if (/404/i.test(errMsg)) {
            hint = `El endpoint de worklist no existe en el PACS. Verifique que los paths UPS-RS / MWL sean correctos para su PACS tipo "${label}".`;
          } else if (/401|403|unauthorized/i.test(errMsg)) {
            hint = `Sin autorización para consultar Worklist. Verifique credenciales.`;
          } else if (/ECONNREFUSED/i.test(errMsg)) {
            hint = `No se pudo conectar a ${pacsUrl}. Verifique que el PACS (${label}) esté corriendo.`;
          } else if (pacsType === 'dicom-native') {
            hint = `El worklist HTTP no aplica para DICOM Nativo. La MWL se consulta por C-FIND (TCP) — verifique la config de conexión TCP.`;
          } else if (result.source === 'mock') {
            hint = `El worklist está en modo MOCK (datos de prueba). Para conectar al PACS real, cambie WORKLIST_MODE a "pacs" en la configuración.`;
          } else {
            hint = `Verifique que su PACS (${label}) soporte Worklist y que los endpoints estén configurados correctamente.`;
          }
          
          return reply.send({
            success: false,
            error: errMsg,
            hint,
            source: result.source,
            pacsType,
            pacsTypeLabel: label,
            config: worklistConfig
          });
        }
      } catch (error) {
        const diag = diagnoseError(error, { pacsType, url: pacsUrl });
        return reply.send({
          success: false,
          error: `Error en Worklist (${label}): ${diag.error}`,
          hint: diag.hint,
          pacsType,
          pacsTypeLabel: label
        });
      }
    }
  });

  // POST /api/config/test-cecho - Test DICOM C-ECHO (ping nativo TCP)
  fastify.post('/api/config/test-cecho', {
    preHandler: dashboardAuth,
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const s = configStore.getAll();
      const host = s.pacsDicomHost || config.pacsDicomHost;
      const port = s.pacsDicomPort || config.pacsDicomPort;
      const calledAet = s.pacsAeTitle || config.pacsAeTitle;
      const callingAet = s.gatewayAeTitle || config.gatewayAeTitle;
      
      if (!host) {
        return reply.send({ success: false, error: 'PACS Host/IP no configurado' });
      }
      if (!calledAet) {
        return reply.send({ success: false, error: 'PACS AE Title no configurado' });
      }
      
      try {
        const startTime = Date.now();
        const net = await import('net');
        const result = await new Promise<{success: boolean; error?: string}>((resolve) => {
          const socket = new net.default.Socket();
          const timeout = setTimeout(() => {
            socket.destroy();
            resolve({ success: false, error: `Timeout conectando a ${host}:${port} (>5s)` });
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
            message: `✅ TCP OK — Puerto ${port} accesible en ${host} (${latency}ms)`,
            pacsType: 'dicom-native',
            pacsTypeLabel: getPacsTypeLabel('dicom-native'),
            details: {
              host,
              port,
              callingAet,
              calledAet,
              note: 'Conexión TCP exitosa. El PACS acepta conexiones en este puerto. Asegúrese de que el AE Title del Gateway esté registrado en el PACS.'
            }
          });
        } else {
          const diag = diagnoseError(new Error(result.error || ''), { pacsType: 'dicom-native', host, port });
          return reply.send({
            success: false,
            error: `Error TCP a ${host}:${port} — ${result.error}`,
            hint: diag.hint,
            pacsType: 'dicom-native',
            pacsTypeLabel: getPacsTypeLabel('dicom-native'),
            details: { host, port, callingAet, calledAet }
          });
        }
      } catch (error) {
        const diag = diagnoseError(error, { pacsType: 'dicom-native', host, port });
        return reply.send({
          success: false,
          error: `Error en test TCP: ${diag.error}`,
          hint: diag.hint,
          pacsType: 'dicom-native',
          pacsTypeLabel: getPacsTypeLabel('dicom-native')
        });
      }
    }
  });

  console.log('\u{1F527} Rutas de configuracion registradas: /config, /api/config/*');
}

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Accept': 'application/json' };
  const s = configStore.getAll();
  const authType = s.pacsAuthType || config.pacsAuthType;
  const username = s.pacsUsername || config.pacsUsername;
  const password = s.pacsPassword || config.pacsPassword;
  
  if (authType === 'basic' && username) {
    headers['Authorization'] = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
  } else if (authType === 'bearer') {
    const token = s.pacsToken || config.pacsToken;
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  
  return headers;
}

function generateConfigHtml(): string {
  const s = configStore.getAll();
  const currentConfig = {
    centroNombre: s.centroNombre || config.centroNombre,
    centroId: s.centroId || config.centroId,
    apiKey: s.apiKey || config.apiKey,
    dashboardUser: s.dashboardUser || config.dashboardUser,
    allowedOrigins: s.allowedOrigins || config.allowedOrigins.join(','),
    pacsType: s.pacsType || config.pacsType,
    pacsUrl: s.pacsBaseUrl || config.pacsBaseUrl,
    pacsAuthType: s.pacsAuthType || config.pacsAuthType,
    pacsUsername: s.pacsUsername || config.pacsUsername,
    dicomwebStowPath: s.pacsStowEndpoint || config.dicomwebStowPath,
    dicomwebQidoPath: s.pacsQidoEndpoint || config.dicomwebQidoPath,
    dicomwebWadoPath: s.pacsWadoEndpoint || config.dicomwebWadoPath,
    worklistUpsPath: s.worklistEndpoint || config.worklistUpsPath,
    worklistQidoMwlPath: s.worklistMwlEndpoint || config.worklistQidoMwlPath,
    worklistPreferUps: s.worklistPreferUps !== undefined ? s.worklistPreferUps : config.worklistPreferUps,
    gatewayAeTitle: s.gatewayAeTitle || config.gatewayAeTitle,
    pacsDicomHost: s.pacsDicomHost || config.pacsDicomHost,
    pacsDicomPort: s.pacsDicomPort || config.pacsDicomPort,
    pacsAeTitle: s.pacsAeTitle || config.pacsAeTitle,
    gatewayDicomPort: s.gatewayDicomPort || config.gatewayDicomPort,
  };

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Configuracion - Andex Gateway</title>
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
    code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; font-size: 13px; }
  </style>
</head>
<body>
  <div class="header">
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <div>
        <h1>\u2699\uFE0F Configuracion Gateway</h1>
        <p>Andex Gateway - \${currentConfig.centroNombre}</p>
      </div>
      <a href="/">\u2190 Volver al Dashboard</a>
    </div>
  </div>
  
  <div class="container">
    <div id="status"></div>

    <!-- Centro -->
    <div class="card">
      <div class="card-header">
        <h2>\U0001F3E5 Centro Medico</h2>
      </div>
      <div class="card-body">
        <div class="form-row">
          <div class="form-group">
            <label>Nombre del Centro</label>
            <input type="text" id="centroNombre" value="\${currentConfig.centroNombre}">
          </div>
          <div class="form-group">
            <label>ID del Centro</label>
            <input type="text" id="centroId" value="\${currentConfig.centroId}">
            <small>Identificador unico (ej: HOSPTALC)</small>
          </div>
          <div class="form-group">
            <label>AE Title del Gateway</label>
            <input type="text" id="gatewayAeTitle" value="\${currentConfig.gatewayAeTitle}" placeholder="ANDEX_1" maxlength="16" style="text-transform:uppercase;">
            <small>Nombre DICOM del Gateway en la red (aplica a DICOMweb y DICOM Nativo)</small>
          </div>
        </div>
      </div>
    </div>

    <!-- Seguridad -->
    <div class="card">
      <div class="card-header">
        <h2>\U0001F510 Seguridad & Acceso</h2>
      </div>
      <div class="card-body">
        <div class="form-row-3">
          <div class="form-group">
            <label>API Key</label>
            <input type="text" id="apiKey" value="\${currentConfig.apiKey}">
            <small>Clave para autenticar requests desde la PWA</small>
          </div>
          <div class="form-group">
            <label>Dashboard Usuario</label>
            <input type="text" id="dashboardUser" value="\${currentConfig.dashboardUser}">
          </div>
          <div class="form-group">
            <label>Dashboard Password</label>
            <input type="password" id="dashboardPassword" placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022">
            <small>Dejar vacio para mantener actual</small>
          </div>
        </div>
        <div class="form-group">
          <label>Origenes Permitidos (CORS)</label>
          <input type="text" id="allowedOrigins" value="\${currentConfig.allowedOrigins}">
          <small>URLs separadas por coma (ej: https://andexreports.app,http://localhost:3000)</small>
        </div>
      </div>
    </div>

    <!-- PACS -->
    <div class="card">
      <div class="card-header">
        <h2>\U0001F5A5\uFE0F Servidor PACS</h2>
      </div>
      <div class="card-body">
        <div class="form-row">
          <div class="form-group">
            <label>Tipo de PACS</label>
            <select id="pacsType" onchange="togglePacsFields()">
              <option value="orthanc" \${currentConfig.pacsType === 'orthanc' ? 'selected' : ''}>Orthanc REST API</option>
              <option value="dicomweb" \${currentConfig.pacsType === 'dicomweb' ? 'selected' : ''}>DICOMweb (STOW/QIDO/WADO)</option>
              <option value="dicom-native" \${currentConfig.pacsType === 'dicom-native' ? 'selected' : ''}>DICOM Nativo (TCP - C-STORE/MWL)</option>
            </select>
          </div>
          <div class="form-group" id="pacsUrlGroup">
            <label>URL del PACS</label>
            <input type="text" id="pacsUrl" value="\${currentConfig.pacsUrl}" placeholder="http://192.168.1.100:8042">
          </div>
        </div>
        
        <div id="httpAuthSection">
          <div class="form-row">
            <div class="form-group">
              <label>Autenticacion</label>
              <select id="pacsAuthType">
                <option value="none" \${currentConfig.pacsAuthType === 'none' ? 'selected' : ''}>Sin autenticacion</option>
                <option value="basic" \${currentConfig.pacsAuthType === 'basic' ? 'selected' : ''}>Basic Auth</option>
                <option value="bearer" \${currentConfig.pacsAuthType === 'bearer' ? 'selected' : ''}>Bearer Token</option>
              </select>
            </div>
            <div class="form-group">
              <label>Usuario</label>
              <input type="text" id="pacsUsername" value="\${currentConfig.pacsUsername || ''}">
            </div>
          </div>
          
          <div class="form-group">
            <label>Password / Token</label>
            <input type="password" id="pacsPassword" placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022">
            <small>Dejar vacio para mantener actual</small>
          </div>
        </div>

        <div class="btn-group" id="testPacsGroup">
          <button class="btn btn-outline" onclick="testPacs()">\U0001F50C Test Conexion</button>
        </div>
        <div id="testPacsResult"></div>
      </div>
    </div>

    <!-- DICOMweb Paths -->
    <div class="card" id="dicomwebCard">
      <div class="card-header">
        <h2>\U0001F4E1 Endpoints DICOMweb</h2>
      </div>
      <div class="card-body">
        <p class="section-title">STOW-RS (Almacenamiento)</p>
        <div class="form-group">
          <label>STOW-RS Path</label>
          <input type="text" id="dicomwebStowPath" value="\${currentConfig.dicomwebStowPath}">
          <small>Endpoint para subir estudios DICOM (ej: /studies, /dcm4chee-arc/aets/DCM4CHEE/rs/studies)</small>
        </div>
        <div class="btn-group">
          <button class="btn btn-amber" onclick="testStow()">\U0001F4E4 Test STOW</button>
        </div>
        <div id="testStowResult"></div>

        <p class="section-title" style="margin-top: 20px;">QIDO-RS / WADO-RS (Consulta)</p>
        <div class="form-row">
          <div class="form-group">
            <label>QIDO-RS Path</label>
            <input type="text" id="dicomwebQidoPath" value="\${currentConfig.dicomwebQidoPath}">
            <small>Endpoint para buscar estudios</small>
          </div>
          <div class="form-group">
            <label>WADO-RS Path</label>
            <input type="text" id="dicomwebWadoPath" value="\${currentConfig.dicomwebWadoPath}">
            <small>Endpoint para recuperar estudios</small>
          </div>
        </div>
      </div>
    </div>

    <!-- DICOM Native -->
    <div class="card" id="dicomNativeCard">
      <div class="card-header">
        <h2>\U0001F4E1 DICOM Nativo (TCP)</h2>
      </div>
      <div class="card-body">
        <div class="form-row">
          <div class="form-group">
            <label>Gateway DICOM Port</label>
            <input type="number" id="gatewayDicomPort" value="\${currentConfig.gatewayDicomPort}" placeholder="11113">
            <small>Puerto donde el Gateway escucha conexiones DICOM (C-MOVE)</small>
          </div>
        </div>


        <p class="section-title" style="margin-top: 20px;">\U0001F5A5\uFE0F PACS Remoto (Synapse / DCM4CHEE / etc)</p>
        <div class="form-row-3">
          <div class="form-group">
            <label>PACS Host / IP</label>
            <input type="text" id="pacsDicomHost" value="\${currentConfig.pacsDicomHost}" placeholder="192.168.1.100">
            <small>IP o hostname del servidor PACS</small>
          </div>
          <div class="form-group">
            <label>PACS DICOM Port</label>
            <input type="number" id="pacsDicomPort" value="\${currentConfig.pacsDicomPort}" placeholder="104">
            <small>Puerto TCP DICOM (104 o 11112)</small>
          </div>
          <div class="form-group">
            <label>PACS AE Title (Called AET)</label>
            <input type="text" id="pacsAeTitle" value="\${currentConfig.pacsAeTitle}" placeholder="SYNAPSE" maxlength="16">
            <small>AE Title del PACS destino</small>
          </div>
        </div>

        <div class="alert alert-info" style="margin-top: 12px;">
          <strong>\u26A0\uFE0F Importante:</strong> El PACS remoto debe tener configurado el AE Title del Gateway (<strong>\${currentConfig.gatewayAeTitle || 'ANDEX_1'}</strong>) como nodo permitido.
        </div>

        <div class="btn-group">
          <button class="btn btn-outline" onclick="testCEcho()">\U0001F50C Test Conexion TCP</button>
        </div>
        <div id="testCEchoResult"></div>
      </div>
    </div>

    <!-- Worklist -->
    <div class="card">
      <div class="card-header">
        <h2>\U0001F4CB Worklist (MWL)</h2>
      </div>
      <div class="card-body">
        <div class="form-row">
          <div class="form-group">
            <label>UPS-RS Path (Workitems)</label>
            <input type="text" id="worklistUpsPath" value="\${currentConfig.worklistUpsPath}">
            <small>Endpoint UPS-RS para consultar procedimientos</small>
          </div>
          <div class="form-group">
            <label>QIDO-RS MWL Path</label>
            <input type="text" id="worklistQidoMwlPath" value="\${currentConfig.worklistQidoMwlPath}">
            <small>Endpoint alternativo para MWL</small>
          </div>
        </div>
        
        <div class="form-group">
          <div class="checkbox-group">
            <input type="checkbox" id="worklistPreferUps" \${currentConfig.worklistPreferUps ? 'checked' : ''}>
            <label for="worklistPreferUps" style="margin-bottom: 0;">Preferir UPS-RS sobre QIDO-RS MWL</label>
          </div>
        </div>

        <div class="btn-group">
          <button class="btn btn-success" onclick="testWorklist()">\U0001F4CB Test Worklist</button>
        </div>
        <div id="testWorklistResult"></div>
      </div>
    </div>

    <!-- Actions -->
    <div class="btn-group">
      <button class="btn btn-primary" onclick="saveConfig()">\U0001F4BE Guardar Configuracion</button>
    </div>
    <div class="alert alert-info" style="margin-top: 12px;">
      \U0001F4A1 La configuracion se guarda en <code>data/gateway-config.json</code>. Reinicie el Gateway para aplicar cambios de seguridad.
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

    function togglePacsFields() {
      var pacsType = document.getElementById('pacsType').value;
      var isNative = pacsType === 'dicom-native';
      var isHttp = pacsType === 'orthanc' || pacsType === 'dicomweb';
      
      document.getElementById('dicomwebCard').style.display = isHttp ? 'block' : 'none';
      document.getElementById('dicomNativeCard').style.display = isNative ? 'block' : 'none';
      document.getElementById('pacsUrlGroup').style.display = isNative ? 'none' : '';
      document.getElementById('httpAuthSection').style.display = isNative ? 'none' : '';
      document.getElementById('testPacsGroup').style.display = isNative ? 'none' : '';
    }
    togglePacsFields();

    async function saveConfig() {
      var data = {
        centroNombre: document.getElementById('centroNombre').value,
        centroId: document.getElementById('centroId').value,
        apiKey: document.getElementById('apiKey').value,
        dashboardUser: document.getElementById('dashboardUser').value,
        allowedOrigins: document.getElementById('allowedOrigins').value,
        pacsType: document.getElementById('pacsType').value,
        pacsUrl: document.getElementById('pacsUrl').value,
        pacsAuthType: document.getElementById('pacsAuthType').value,
        pacsUsername: document.getElementById('pacsUsername').value,
        dicomwebStowPath: document.getElementById('dicomwebStowPath').value,
        dicomwebQidoPath: document.getElementById('dicomwebQidoPath').value,
        dicomwebWadoPath: document.getElementById('dicomwebWadoPath').value,
        gatewayAeTitle: document.getElementById('gatewayAeTitle').value,
        pacsDicomHost: document.getElementById('pacsDicomHost').value,
        pacsDicomPort: parseInt(document.getElementById('pacsDicomPort').value) || 104,
        pacsAeTitle: document.getElementById('pacsAeTitle').value,
        gatewayDicomPort: parseInt(document.getElementById('gatewayDicomPort').value) || 11113,
        worklistUpsPath: document.getElementById('worklistUpsPath').value,
        worklistQidoMwlPath: document.getElementById('worklistQidoMwlPath').value,
        worklistPreferUps: document.getElementById('worklistPreferUps').checked,
      };
      
      var password = document.getElementById('pacsPassword').value;
      if (password) data.pacsPassword = password;
      var dashPassword = document.getElementById('dashboardPassword').value;
      if (dashPassword) data.dashboardPassword = dashPassword;
      
      try {
        var resp = await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
          credentials: 'include'
        });
        var result = await resp.json();
        showStatus(result.message || 'Configuracion guardada', result.success ? 'success' : 'error');
      } catch (e) {
        showStatus('Error: ' + e.message, 'error');
      }
    }

    async function testPacs() {
      var resultDiv = document.getElementById('testPacsResult');
      resultDiv.innerHTML = '<div class="test-result">\u23F3 Probando conexion PACS...</div>';
      try {
        await saveConfig();
        var resp = await fetch('/api/config/test-pacs', { method: 'POST', credentials: 'include' });
        var result = await resp.json();
        if (result.success) {
          resultDiv.innerHTML = '<div class="test-result" style="background:#dcfce7;">'
            + result.message
            + '\nEndpoint: ' + result.endpoint
            + '\nURL: ' + result.pacsUrl
            + '\nTipo: ' + (result.pacsTypeLabel || result.pacsType)
            + '</div>';
        } else {
          var hint = result.hint ? '\n\n\uD83D\uDCA1 ' + result.hint : '';
          resultDiv.innerHTML = '<div class="test-result" style="background:#fee2e2;">\u274C ' + result.error
            + (result.endpoint ? '\nEndpoint: ' + result.endpoint : '')
            + (result.pacsUrl ? '\nURL: ' + result.pacsUrl : '')
            + '\nTipo configurado: ' + (result.pacsTypeLabel || result.pacsType || 'desconocido')
            + hint
            + '</div>';
        }
      } catch (e) {
        resultDiv.innerHTML = '<div class="test-result" style="background:#fee2e2;">\u274C Error de red: ' + e.message + '\n\n\uD83D\uDCA1 No se pudo conectar al Gateway. Verifique que est\u00e9 corriendo.</div>';
      }
    }

    async function testStow() {
      var resultDiv = document.getElementById('testStowResult');
      resultDiv.innerHTML = '<div class="test-result">\u23F3 Probando endpoint STOW...</div>';
      try {
        await saveConfig();
        var resp = await fetch('/api/config/test-stow', { method: 'POST', credentials: 'include' });
        var result = await resp.json();
        if (result.success) {
          resultDiv.innerHTML = '<div class="test-result" style="background:#dcfce7;">'
            + result.message
            + '\nEndpoint: ' + result.endpoint
            + '\nURL: ' + result.stowUrl
            + '\nTipo: ' + (result.pacsTypeLabel || result.pacsType)
            + '</div>';
        } else {
          var hint = result.hint ? '\n\n\uD83D\uDCA1 ' + result.hint : '';
          resultDiv.innerHTML = '<div class="test-result" style="background:#fee2e2;">\u274C ' + result.error
            + (result.endpoint ? '\nEndpoint: ' + result.endpoint : '')
            + (result.stowUrl ? '\nURL: ' + result.stowUrl : '')
            + '\nTipo configurado: ' + (result.pacsTypeLabel || result.pacsType || 'desconocido')
            + hint
            + '</div>';
        }
      } catch (e) {
        resultDiv.innerHTML = '<div class="test-result" style="background:#fee2e2;">\u274C Error de red: ' + e.message + '</div>';
      }
    }

    async function testWorklist() {
      var resultDiv = document.getElementById('testWorklistResult');
      resultDiv.innerHTML = '<div class="test-result">\u23F3 Probando Worklist...</div>';
      try {
        await saveConfig();
        var resp = await fetch('/api/config/test-worklist', { method: 'POST', credentials: 'include' });
        var result = await resp.json();
        if (result.success) {
          var preview = '';
          if (result.preview && result.preview.length > 0) {
            preview = '\\n\\nPrimeros items:\\n' + result.preview.map(function(item) {
              return '\u2022 ' + (item.patientName || 'Sin nombre') + ' - ' + (item.accessionNumber || 'Sin accession') + ' - ' + (item.description || '');
            }).join('\\n');
          }
          resultDiv.innerHTML = '<div class="test-result" style="background:#dcfce7;">'
            + result.message
            + '\\nFuente: ' + result.source
            + '\\nTipo PACS: ' + (result.pacsTypeLabel || result.pacsType)
            + '\\nLatencia: ' + result.latency
            + preview
            + '</div>';
        } else {
          var hint = result.hint ? '\\n\\n\uD83D\uDCA1 ' + result.hint : '';
          resultDiv.innerHTML = '<div class="test-result" style="background:#fee2e2;">\u274C ' + result.error
            + '\\nFuente: ' + (result.source || 'desconocida')
            + '\\nTipo configurado: ' + (result.pacsTypeLabel || result.pacsType || 'desconocido')
            + hint
            + '</div>';
        }
      } catch (e) {
        resultDiv.innerHTML = '<div class="test-result" style="background:#fee2e2;">\u274C Error de red: ' + e.message + '</div>';
      }
    }

    async function testCEcho() {
      var resultDiv = document.getElementById('testCEchoResult');
      resultDiv.innerHTML = '<div class="test-result">\u23F3 Probando conexion TCP al PACS...</div>';
      try {
        await saveConfig();
        var resp = await fetch('/api/config/test-cecho', { method: 'POST', credentials: 'include' });
        var result = await resp.json();
        if (result.success) {
          var details = result.details || {};
          resultDiv.innerHTML = '<div class="test-result" style="background:#dcfce7;">'
            + result.message
            + '\\n\\nDetalles:'
            + '\\n  Host: ' + (details.host || '-')
            + '\\n  Port: ' + (details.port || '-')
            + '\\n  Calling AET (Gateway): ' + (details.callingAet || '-')
            + '\\n  Called AET (PACS): ' + (details.calledAet || '-')
            + (details.note ? '\\n\\n\uD83D\uDCA1 ' + details.note : '')
            + '</div>';
        } else {
          var hint = result.hint ? '\\n\\n\uD83D\uDCA1 ' + result.hint : '';
          var details = result.details || {};
          resultDiv.innerHTML = '<div class="test-result" style="background:#fee2e2;">\u274C ' + result.error
            + (details.host ? '\\n  Host: ' + details.host + ':' + details.port : '')
            + (details.calledAet ? '\\n  PACS AE Title: ' + details.calledAet : '')
            + hint
            + '</div>';
        }
      } catch (e) {
        resultDiv.innerHTML = '<div class="test-result" style="background:#fee2e2;">\u274C Error de red: ' + e.message + '</div>';
      }
    }

    // Auto-refresh status every 30 seconds
    setInterval(function() {
      fetch('/api/config', { credentials: 'include' }).catch(function() {});
    }, 30000);
  </script>
</body>
</html>`;
}
