/**
 * Config Routes - Andex Gateway
 * UI y API para configurar el PACS y Worklist
 * Configuracion persistida en data/gateway-config.json
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fs from 'fs';
import path from 'path';
import net from 'net';
import os from 'os';
import { execFile } from 'child_process';
import { config, supabaseConfig } from '../config/env.js';
import { dashboardAuth } from '../plugins/auth.plugin.js';
import { queryWorklist, getWorklistConfig, configureWorklist } from '../services/worklist.service.js';
import { configStore } from '../config/config-store.js';
import { getSupabase, isSupabaseEnabled } from '../services/supabase.service.js';

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
          worklistDefaultModality: s.worklistDefaultModality || config.worklistDefaultModality,
          worklistStationAET: s.worklistStationAET || config.worklistStationAET,
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
      if (body.worklistDefaultModality) updates.worklistDefaultModality = body.worklistDefaultModality;
      if (body.worklistStationAET !== undefined) updates.worklistStationAET = body.worklistStationAET;
      
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
      
      // Auto-generate .env file in sync
      const envResult = writeEnvFile();
      
      return reply.send({
        success: true,
        message: 'Configuracion guardada en gateway-config.json' + (envResult.success ? ' y .env actualizado.' : '.') + ' Reinicie el Gateway para aplicar todos los cambios.',
        envSynced: envResult.success,
      });
    }
  });

  // ========================================
  // .ENV FILE GENERATION
  // ========================================

  /** Generate .env file content from current config (JSON + env + defaults merged) */
  function generateEnvContent(): string {
    const s = configStore.getAll();
    const lines: string[] = [
      '# ============================================',
      '# ANDEX GATEWAY - Configuracion generada automaticamente',
      `# Generado: ${new Date().toISOString()}`,
      '# Desde: Dashboard de Configuracion Gateway',
      '# ============================================',
      '',
      '# Identidad del centro',
      `CENTRO_NOMBRE=${s.centroNombre || config.centroNombre}`,
      `CENTRO_ID=${s.centroId || config.centroId}`,
      '',
      '# Gateway',
      `PORT=${s.port || config.port}`,
      `NODE_ENV=${config.nodeEnv}`,
      '',
      '# Seguridad',
      `API_KEY=${s.apiKey || config.apiKey}`,
      `DASHBOARD_USER=${s.dashboardUser || config.dashboardUser}`,
      `DASHBOARD_PASSWORD=${s.dashboardPassword || config.dashboardPassword}`,
      `ALLOWED_ORIGINS=${s.allowedOrigins || config.allowedOrigins.join(',')}`,
      '',
      '# PACS',
      `PACS_TYPE=${s.pacsType || config.pacsType}`,
      `PACS_BASE_URL=${s.pacsBaseUrl || config.pacsBaseUrl}`,
      '',
      '# Autenticacion PACS',
      `PACS_AUTH_TYPE=${s.pacsAuthType || config.pacsAuthType}`,
      `PACS_USERNAME=${s.pacsUsername || config.pacsUsername}`,
      `PACS_PASSWORD=${s.pacsPassword || config.pacsPassword}`,
      '',
      '# DICOMweb Endpoints',
      `PACS_STOW_ENDPOINT=${s.pacsStowEndpoint || config.pacsStowEndpoint}`,
      `PACS_QIDO_ENDPOINT=${s.pacsQidoEndpoint || config.pacsQidoEndpoint}`,
      `PACS_WADO_ENDPOINT=${s.pacsWadoEndpoint || config.pacsWadoEndpoint}`,
      '',
      '# DICOM Nativo (TCP)',
      `GATEWAY_AE_TITLE=${s.gatewayAeTitle || config.gatewayAeTitle}`,
      `PACS_DICOM_HOST=${s.pacsDicomHost || config.pacsDicomHost}`,
      `PACS_DICOM_PORT=${s.pacsDicomPort || config.pacsDicomPort}`,
      `PACS_AE_TITLE=${s.pacsAeTitle || config.pacsAeTitle}`,
      `GATEWAY_DICOM_PORT=${s.gatewayDicomPort || config.gatewayDicomPort}`,
      '',
      '# Worklist',
      `WORKLIST_ENDPOINT=${s.worklistEndpoint || config.worklistEndpoint}`,
      `WORKLIST_MWL_ENDPOINT=${s.worklistMwlEndpoint || config.worklistMwlEndpoint}`,
      `WORKLIST_PREFER_UPS=${s.worklistPreferUps !== undefined ? s.worklistPreferUps : config.worklistPreferUps}`,
      `WORKLIST_DEFAULT_MODALITY=${s.worklistDefaultModality || config.worklistDefaultModality}`,
      `WORKLIST_STATION_AET=${s.worklistStationAET || config.worklistStationAET}`,
      '',
      '# Storage',
      `STORAGE_PATH=${config.storagePath}`,
      '',
      '# Queue',
      `QUEUE_RETRY_INTERVAL=${config.queueRetryInterval}`,
      `QUEUE_MAX_RETRIES=${config.queueMaxRetries}`,
      `CLEANUP_AFTER_HOURS=${config.cleanupAfterHours}`,
      '',
    ];
    return lines.join('\n') + '\n';
  }

  /** Write .env file to gateway root */
  function writeEnvFile(): { success: boolean; path: string; error?: string } {
    try {
      const envPath = path.join(process.cwd(), '.env');
      const content = generateEnvContent();
      fs.writeFileSync(envPath, content, 'utf-8');
      console.log('\u{1F4DD} .env generado/actualizado:', envPath);
      return { success: true, path: envPath };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('\u274C Error escribiendo .env:', msg);
      return { success: false, path: '', error: msg };
    }
  }

  // POST /api/config/generate-env - Generar y guardar .env
  fastify.post('/api/config/generate-env', {
    preHandler: dashboardAuth,
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const result = writeEnvFile();
      if (result.success) {
        return reply.send({
          success: true,
          message: `Archivo .env generado exitosamente en ${result.path}`,
          path: result.path,
        });
      }
      return reply.status(500).send({ success: false, error: result.error });
    }
  });

  // GET /api/config/download-env - Descargar .env como archivo
  fastify.get('/api/config/download-env', {
    preHandler: dashboardAuth,
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const content = generateEnvContent();
      return reply
        .header('Content-Type', 'text/plain')
        .header('Content-Disposition', 'attachment; filename=".env"')
        .send(content);
    }
  });

  // ========================================
  // LOOKUP CENTRO — Buscar centro por UUID
  // ========================================
  fastify.post('/api/config/lookup-centro', {
    preHandler: dashboardAuth,
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as any;
      const centroId = (body?.centroId || '').trim();

      // Validate UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!centroId) {
        return reply.send({ success: false, error: 'Debe ingresar un ID de Centro (UUID)' });
      }
      if (!uuidRegex.test(centroId)) {
        return reply.send({
          success: false,
          error: 'El ID del Centro debe ser un UUID válido',
          hint: 'Formato: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx (ej: a0000001-de00-4000-a000-000000000001)',
          received: centroId,
        });
      }

      // Try Supabase lookup
      if (!isSupabaseEnabled()) {
        return reply.send({
          success: false,
          error: 'Supabase no está configurado en este Gateway',
          hint: 'Sin conexión a Supabase, no se puede verificar el Centro. Puede ingresar los datos manualmente.',
          supabaseConfigured: false,
          centroId,
        });
      }

      try {
        const supabase = getSupabase();
        if (!supabase) {
          return reply.send({ success: false, error: 'Cliente Supabase no disponible' });
        }

        const { data, error } = await supabase
          .from('centros')
          .select('id, nombre, direccion, telefono, email, web, subtitulo_unidad, activo, plan_type, subscription_status')
          .eq('id', centroId)
          .maybeSingle();

        if (error) {
          return reply.send({
            success: false,
            error: `Error consultando Supabase: ${error.message}`,
            hint: error.code === 'PGRST116' ? 'La tabla centros puede no existir o no tener acceso.' : 'Verifique la conexión y permisos de Supabase.',
            supabaseConfigured: true,
            centroId,
          });
        }

        if (!data) {
          return reply.send({
            success: false,
            error: `No se encontró un Centro con ID "${centroId}"`,
            hint: 'Verifique que el UUID sea correcto. Puede obtenerlo desde el panel de administración de AndexReports.',
            supabaseConfigured: true,
            centroId,
          });
        }

        return reply.send({
          success: true,
          centro: {
            id: data.id,
            nombre: data.nombre,
            direccion: data.direccion || '',
            telefono: data.telefono || '',
            email: data.email || '',
            web: data.web || '',
            subtituloUnidad: data.subtitulo_unidad || '',
            activo: data.activo,
            plan: data.plan_type || '',
            subscriptionStatus: data.subscription_status || '',
          },
          message: `Centro encontrado: ${data.nombre}`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.send({
          success: false,
          error: `Error inesperado: ${msg}`,
          centroId,
        });
      }
    }
  });

  // ========================================
  // NETWORK DIAGNOSTIC — Full connectivity check
  // ========================================

  /** TCP port check with timeout */
  function tcpCheck(host: string, port: number, timeoutMs = 3000): Promise<{ open: boolean; latency: number; error?: string }> {
    return new Promise((resolve) => {
      const start = Date.now();
      const socket = new net.Socket();
      socket.setTimeout(timeoutMs);
      socket.once('connect', () => {
        const latency = Date.now() - start;
        socket.destroy();
        resolve({ open: true, latency });
      });
      socket.once('timeout', () => {
        socket.destroy();
        resolve({ open: false, latency: Date.now() - start, error: 'Timeout — el puerto no responde' });
      });
      socket.once('error', (err) => {
        resolve({ open: false, latency: Date.now() - start, error: err.message });
      });
      socket.connect(port, host);
    });
  }

  /** Get local network interfaces (non-internal IPv4) */
  function getLocalNetworkInfo(): Array<{ name: string; ip: string; mac: string; netmask: string; cidr: string }> {
    const ifaces = os.networkInterfaces();
    const results: Array<{ name: string; ip: string; mac: string; netmask: string; cidr: string }> = [];
    for (const [name, addrs] of Object.entries(ifaces)) {
      if (!addrs) continue;
      for (const addr of addrs) {
        if (addr.family === 'IPv4' && !addr.internal) {
          results.push({
            name,
            ip: addr.address,
            mac: addr.mac,
            netmask: addr.netmask,
            cidr: addr.cidr || `${addr.address}/${addr.netmask}`,
          });
        }
      }
    }
    return results;
  }

  /** Check if two IPs are on the same subnet */
  function sameSubnet(ip1: string, ip2: string, mask: string): boolean {
    try {
      const ip1Parts = ip1.split('.').map(Number);
      const ip2Parts = ip2.split('.').map(Number);
      const maskParts = mask.split('.').map(Number);
      for (let i = 0; i < 4; i++) {
        if ((ip1Parts[i] & maskParts[i]) !== (ip2Parts[i] & maskParts[i])) return false;
      }
      return true;
    } catch { return false; }
  }

  // GET /api/config/ip-info - Quick IP info for IT handoff
  fastify.get('/api/config/ip-info', {
    preHandler: dashboardAuth,
    handler: async (_request: FastifyRequest, reply: FastifyReply) => {
      const interfaces = getLocalNetworkInfo();
      return reply.send({
        hostname: os.hostname(),
        interfaces,
      });
    }
  });

  // POST /api/config/network-diagnostic - Full network diagnostic
  fastify.post('/api/config/network-diagnostic', {
    preHandler: dashboardAuth,
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const s = configStore.getAll();
      const pacsType = s.pacsType || config.pacsType;
      const pacsUrl = s.pacsBaseUrl || config.pacsUrl;
      const pacsHost = s.pacsDicomHost || config.pacsDicomHost;
      const pacsPort = Number(s.pacsDicomPort || config.pacsDicomPort) || 4242;
      const label = getPacsTypeLabel(pacsType);

      const results: any = {
        timestamp: new Date().toISOString(),
        hostname: os.hostname(),
        platform: `${os.type()} ${os.release()} (${os.arch()})`,
        pacsType,
        pacsTypeLabel: label,
        interfaces: getLocalNetworkInfo(),
        checks: [] as Array<{ name: string; target: string; status: 'pass' | 'fail' | 'skip'; latency?: number; detail: string; icon: string }>,
      };

      // ----- Check 1: HTTP(s) PACS connectivity -----
      if (pacsType !== 'dicom-native' && pacsUrl) {
        try {
          const urlObj = new URL(pacsUrl);
          const httpHost = urlObj.hostname;
          const httpPort = Number(urlObj.port) || (urlObj.protocol === 'https:' ? 443 : 80);

          const tcp = await tcpCheck(httpHost, httpPort);
          results.checks.push({
            name: 'PACS HTTP/DICOMweb',
            target: `${httpHost}:${httpPort}`,
            status: tcp.open ? 'pass' : 'fail',
            latency: tcp.latency,
            detail: tcp.open
              ? `Puerto abierto — ${label} accesible (${tcp.latency}ms)`
              : `Puerto cerrado — ${tcp.error}`,
            icon: tcp.open ? '✅' : '❌',
          });

          // If port is open, try an actual HTTP request
          if (tcp.open) {
            try {
              const startHttp = Date.now();
              const resp = await fetch(pacsUrl, {
                method: 'GET',
                signal: AbortSignal.timeout(5000),
                headers: s.pacsAuthType === 'basic'
                  ? { 'Authorization': 'Basic ' + Buffer.from(`${s.pacsUsername || config.pacsUsername}:${s.pacsPassword || config.pacsPassword}`).toString('base64') }
                  : {},
              });
              const httpLatency = Date.now() - startHttp;
              results.checks.push({
                name: 'PACS HTTP Response',
                target: pacsUrl,
                status: resp.ok || resp.status === 401 || resp.status === 404 ? 'pass' : 'fail',
                latency: httpLatency,
                detail: `HTTP ${resp.status} ${resp.statusText} (${httpLatency}ms)`,
                icon: resp.ok ? '✅' : resp.status === 401 ? '🔐' : '⚠️',
              });
            } catch (httpErr) {
              results.checks.push({
                name: 'PACS HTTP Response',
                target: pacsUrl,
                status: 'fail',
                detail: `Error HTTP: ${(httpErr as Error).message}`,
                icon: '❌',
              });
            }
          }
        } catch {
          results.checks.push({
            name: 'PACS HTTP/DICOMweb',
            target: pacsUrl,
            status: 'fail',
            detail: 'URL del PACS inválida',
            icon: '❌',
          });
        }
      }

      // ----- Check 2: DICOM Native TCP -----
      if (pacsHost && pacsHost !== '' && pacsHost !== 'localhost' || pacsType === 'dicom-native') {
        const dicomHost = pacsHost || 'localhost';
        const tcp = await tcpCheck(dicomHost, pacsPort);
        results.checks.push({
          name: 'PACS DICOM TCP',
          target: `${dicomHost}:${pacsPort}`,
          status: tcp.open ? 'pass' : 'fail',
          latency: tcp.latency,
          detail: tcp.open
            ? `Puerto DICOM abierto (${tcp.latency}ms)`
            : `Puerto DICOM cerrado — ${tcp.error}`,
          icon: tcp.open ? '✅' : '❌',
        });

        // Check subnet match
        const localIfaces = results.interfaces;
        if (localIfaces.length > 0 && dicomHost !== 'localhost' && dicomHost !== '127.0.0.1') {
          const onSameSubnet = localIfaces.some((iface: any) => sameSubnet(iface.ip, dicomHost, iface.netmask));
          results.checks.push({
            name: 'Misma Subred que PACS',
            target: `${dicomHost} vs ${localIfaces.map((i: any) => i.ip).join(', ')}`,
            status: onSameSubnet ? 'pass' : 'fail',
            detail: onSameSubnet
              ? `El Gateway y el PACS están en la misma red`
              : `El Gateway NO está en la misma subred que ${dicomHost}. Verifique la VLAN o configuración de red.`,
            icon: onSameSubnet ? '✅' : '⚠️',
          });
        }
      }

      // ----- Check 3: Worklist HTTP endpoint -----
      if (pacsType !== 'dicom-native' && pacsUrl) {
        const wlEndpoint = s.worklistMwlEndpoint || config.worklistQidoMwlPath || s.worklistEndpoint || config.worklistUpsPath;
        if (wlEndpoint) {
          try {
            const wlUrl = `${pacsUrl}${wlEndpoint}`;
            const startWl = Date.now();
            const wlResp = await fetch(wlUrl, {
              method: 'GET',
              signal: AbortSignal.timeout(5000),
              headers: s.pacsAuthType === 'basic'
                ? { 'Authorization': 'Basic ' + Buffer.from(`${s.pacsUsername || config.pacsUsername}:${s.pacsPassword || config.pacsPassword}`).toString('base64') }
                : {},
            });
            const wlLatency = Date.now() - startWl;
            results.checks.push({
              name: 'Worklist Endpoint',
              target: wlUrl,
              status: wlResp.ok || wlResp.status === 204 ? 'pass' : 'fail',
              latency: wlLatency,
              detail: `HTTP ${wlResp.status} (${wlLatency}ms)`,
              icon: wlResp.ok || wlResp.status === 204 ? '✅' : '⚠️',
            });
          } catch (wlErr) {
            results.checks.push({
              name: 'Worklist Endpoint',
              target: `${pacsUrl}${wlEndpoint}`,
              status: 'fail',
              detail: `Error: ${(wlErr as Error).message}`,
              icon: '❌',
            });
          }
        }
      }

      // ----- Check 4: Supabase Cloud -----
      if (isSupabaseEnabled()) {
        try {
          const supaUrl = new URL(supabaseConfig.url);
          const supaTcp = await tcpCheck(supaUrl.hostname, 443);
          results.checks.push({
            name: 'Supabase Cloud',
            target: supaUrl.hostname,
            status: supaTcp.open ? 'pass' : 'fail',
            latency: supaTcp.latency,
            detail: supaTcp.open
              ? `Conexión a Supabase OK (${supaTcp.latency}ms)`
              : `Sin conexión a Supabase — ${supaTcp.error}`,
            icon: supaTcp.open ? '✅' : '❌',
          });
        } catch {
          results.checks.push({
            name: 'Supabase Cloud',
            target: supabaseConfig.url,
            status: 'skip',
            detail: 'URL de Supabase inválida',
            icon: '⚠️',
          });
        }
      }

      // ----- Check 5: Internet (google DNS) -----
      const internetTcp = await tcpCheck('8.8.8.8', 53, 2000);
      results.checks.push({
        name: 'Internet (DNS)',
        target: '8.8.8.8:53',
        status: internetTcp.open ? 'pass' : 'fail',
        latency: internetTcp.latency,
        detail: internetTcp.open
          ? `Acceso a Internet OK (${internetTcp.latency}ms)`
          : `Sin acceso a Internet — ${internetTcp.error}`,
        icon: internetTcp.open ? '✅' : '⚠️',
      });

      // Summary
      const passed = results.checks.filter((c: any) => c.status === 'pass').length;
      const failed = results.checks.filter((c: any) => c.status === 'fail').length;
      const total = results.checks.length;

      results.summary = {
        passed, failed, total,
        allGood: failed === 0,
        message: failed === 0
          ? `✅ ${passed}/${total} pruebas pasaron — Red OK`
          : `⚠️ ${failed}/${total} pruebas fallaron — Revise la configuración de red`,
      };

      return reply.send(results);
    }
  });

  // POST /api/config/update-gateway - Pull latest image & recreate
  fastify.post('/api/config/update-gateway', {
    preHandler: dashboardAuth,
    handler: async (_request: FastifyRequest, reply: FastifyReply) => {
      const cwd = process.env.COMPOSE_DIR || process.cwd();

      // Check if docker CLI is available
      const dockerOk = await new Promise<boolean>((resolve) => {
        execFile('docker', ['--version'], (err) => resolve(!err));
      });
      if (!dockerOk) {
        return reply.code(500).send({
          ok: false,
          error: 'Docker CLI no disponible en este entorno',
          manual: 'Ejecute manualmente: docker compose pull gateway && docker compose up -d gateway',
        });
      }

      // Check compose file exists
      const composeFile = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']
        .map(f => path.join(cwd, f))
        .find(f => fs.existsSync(f));
      if (!composeFile) {
        return reply.code(500).send({
          ok: false,
          error: `No se encontró docker-compose.yml en ${cwd}`,
          manual: 'Ejecute manualmente: docker compose pull gateway && docker compose up -d gateway',
        });
      }

      // Run docker compose pull
      const runCmd = (cmd: string, args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> =>
        new Promise((resolve) => {
          execFile(cmd, args, { cwd, timeout: 120_000 }, (err, stdout, stderr) => {
            resolve({ ok: !err, stdout: stdout?.toString() || '', stderr: stderr?.toString() || '' });
          });
        });

      const pull = await runCmd('docker', ['compose', 'pull', 'gateway']);
      if (!pull.ok) {
        return reply.code(500).send({
          ok: false,
          step: 'pull',
          error: 'Error al descargar imagen',
          detail: pull.stderr || pull.stdout,
          manual: 'docker compose pull gateway',
        });
      }

      // Run docker compose up -d gateway (this will restart ourselves)
      const up = await runCmd('docker', ['compose', 'up', '-d', '--force-recreate', 'gateway']);

      // If we get here, the container hasn't been replaced yet (or we're running outside Docker)
      return reply.send({
        ok: true,
        pull: { stdout: pull.stdout.trim(), stderr: pull.stderr.trim() },
        up: { ok: up.ok, stdout: up.stdout.trim(), stderr: up.stderr.trim() },
        message: up.ok
          ? '✅ Gateway actualizado — el contenedor se está recreando'
          : '⚠️ Imagen descargada pero el contenedor no se pudo recrear. Ejecute: docker compose up -d gateway',
      });
    }
  });

  // ========================================
  // ERROR CODE SYSTEM — Rich diagnostics
  // ========================================
  interface DiagnosticResult {
    code: string;
    severity: 'critical' | 'error' | 'warning' | 'info';
    title: string;
    detail: string;
    causes: string[];
    fixes: string[];
    technical: Record<string, string>;
  }

  function getPacsTypeLabel(type: string): string {
    switch (type) {
      case 'orthanc': return 'Orthanc REST API';
      case 'dicomweb': return 'DICOMweb (STOW/QIDO/WADO)';
      case 'dicom-native': return 'DICOM Nativo (TCP)';
      default: return type || 'No configurado';
    }
  }

  function diagnoseError(err: unknown, context: { pacsType: string; url?: string; host?: string; port?: number }): DiagnosticResult {
    const msg = err instanceof Error ? err.message : String(err);
    const errCode = (err as any)?.code || '';
    const label = getPacsTypeLabel(context.pacsType);
    const target = context.url || `${context.host || '?'}:${context.port || '?'}`;

    // ECONNREFUSED
    if (/ECONNREFUSED/i.test(msg) || errCode === 'ECONNREFUSED') {
      const portInfo = context.port || (context.url ? (() => { try { return new URL(context.url).port || (context.url.startsWith('https') ? '443' : '80'); } catch { return '?'; } })() : '?');
      return {
        code: 'GW-NET-001',
        severity: 'critical',
        title: 'Conexión Rechazada (ECONNREFUSED)',
        detail: `El servidor en ${target} rechazó activamente la conexión TCP en el puerto ${portInfo}. El host existe y responde, pero nada escucha en ese puerto.`,
        causes: [
          `El servicio PACS (${label}) no está corriendo o no ha terminado de iniciar`,
          'El puerto configurado no coincide con el puerto real del PACS',
          'Un firewall local rechaza (REJECT) la conexión saliente',
          'El PACS escucha solo en localhost/127.0.0.1 y el Gateway conecta por IP externa',
          'Si es Docker: el contenedor no tiene port-mapping (-p) hacia el host',
        ],
        fixes: [
          `Verifique que el servicio PACS (${label}) esté iniciado: revise el panel de servicios o el Docker container`,
          `Confirme que el puerto ${portInfo} es el correcto (ejecute: netstat -tlnp | grep ${portInfo})`,
          `Pruebe conectividad directa: curl -v ${context.url || `telnet ${context.host} ${context.port}`}`,
          'Revise reglas de firewall: iptables -L / Windows Firewall / macOS pf',
          'Si el PACS es Docker: docker ps | grep pacs && docker port CONTAINER',
        ],
        technical: {
          errorCode: 'ECONNREFUSED',
          rawMessage: msg,
          target,
          port: String(portInfo),
          pacsType: context.pacsType,
          pacsLabel: label,
          timestamp: new Date().toISOString(),
        },
      };
    }

    // DNS
    if (/ENOTFOUND|getaddrinfo/i.test(msg) || errCode === 'ENOTFOUND') {
      const hostname = context.url ? (() => { try { return new URL(context.url).hostname; } catch { return context.url; } })() : context.host || '?';
      return {
        code: 'GW-NET-002',
        severity: 'critical',
        title: 'Error de Resolución DNS (ENOTFOUND)',
        detail: `No se puede resolver el hostname "${hostname}". El sistema DNS no reconoce esta dirección — el PACS no es localizable.`,
        causes: [
          `El hostname "${hostname}" está mal escrito o no existe en el DNS`,
          'El servidor DNS configurado en este equipo no resuelve nombres internos',
          'Si es un nombre de red interna (.local, .corp), el DNS interno no es accesible',
          'Hay caracteres extra, espacios o errores tipográficos en la URL',
        ],
        fixes: [
          `Verifique la ortografía exacta de "${hostname}"`,
          `Pruebe resolución DNS: nslookup ${hostname} o dig ${hostname}`,
          `Pruebe con ping: ping ${hostname}`,
          'Si el PACS usa IP estática, use la IP directamente en lugar del hostname',
          'Consulte con el equipo de TI del centro médico sobre el hostname correcto del PACS',
        ],
        technical: {
          errorCode: 'ENOTFOUND',
          hostname,
          rawMessage: msg,
          target,
          pacsType: context.pacsType,
          pacsLabel: label,
          timestamp: new Date().toISOString(),
        },
      };
    }

    // Timeout
    if (/timeout|ETIMEDOUT|ESOCKETTIMEDOUT/i.test(msg) || errCode === 'ETIMEDOUT') {
      return {
        code: 'GW-NET-003',
        severity: 'error',
        title: 'Timeout de Conexión (ETIMEDOUT)',
        detail: `La conexión a ${target} no respondió dentro del tiempo límite (10s). El servidor no rechaza ni acepta — los paquetes se pierden.`,
        causes: [
          'Un firewall intermedio descarta los paquetes silenciosamente (regla DROP)',
          'La IP existe pero no hay servicio PACS escuchando (sin rechazo activo)',
          `El PACS (${label}) está sobrecargado y no acepta nuevas conexiones`,
          'Problemas de enrutamiento: VPN desconectada, subnets sin ruta, etc.',
          'El PACS está en proceso de arranque y aún no abre el puerto',
        ],
        fixes: [
          `Verifique que el PACS esté completamente iniciado y operativo`,
          `Pruebe conectividad básica: ping ${context.host || 'HOST'} (¿responde?)`,
          `Pruebe puerto específico: nc -zv ${context.host || 'HOST'} ${context.port || 'PORT'} -w 5`,
          'Revise firewalls intermedios entre el Gateway y el PACS',
          'Si usa VPN, confirme que está conectada y tiene ruta al PACS',
          'Ejecute traceroute para identificar dónde se pierden los paquetes',
        ],
        technical: {
          errorCode: 'ETIMEDOUT',
          timeout: '10000ms',
          rawMessage: msg,
          target,
          pacsType: context.pacsType,
          pacsLabel: label,
          timestamp: new Date().toISOString(),
        },
      };
    }

    // SSL/TLS
    if (/SELF_SIGNED|CERT|SSL|TLS|UNABLE_TO_VERIFY|ERR_TLS|DEPTH_ZERO/i.test(msg)) {
      let specific = 'Error general de certificado SSL/TLS';
      let certCode = 'GW-TLS-001';
      if (/SELF_SIGNED|DEPTH_ZERO/i.test(msg)) {
        specific = 'El servidor presenta un certificado auto-firmado que no está en la cadena de confianza';
        certCode = 'GW-TLS-001';
      } else if (/EXPIRED|NOT_YET_VALID/i.test(msg)) {
        specific = 'El certificado SSL del servidor ha expirado o aún no es válido';
        certCode = 'GW-TLS-002';
      } else if (/HOSTNAME|ALT_NAME|CN_MISMATCH/i.test(msg)) {
        specific = 'El certificado no coincide con el hostname de la URL';
        certCode = 'GW-TLS-003';
      }
      return {
        code: certCode,
        severity: 'error',
        title: `Error de Certificado SSL/TLS (${certCode})`,
        detail: `${specific}. La conexión HTTPS a ${target} fue rechazada por seguridad.`,
        causes: [
          'El PACS usa certificado auto-firmado (común en redes hospitalarias internas)',
          'El certificado SSL del PACS ha expirado y necesita renovación',
          'El hostname en la URL no coincide con el CN/SAN del certificado',
          'Cadena de certificación incompleta — falta un CA intermedio',
        ],
        fixes: [
          'Para desarrollo: NODE_TLS_REJECT_UNAUTHORIZED=0 en .env (⚠️ NUNCA en producción)',
          'Instale el CA raíz del PACS como certificado confiable en el OS del Gateway',
          'Si el cert expiró: contacte al administrador del PACS para renovarlo',
          'Use HTTP en lugar de HTTPS si está en red interna segura (cambie la URL)',
          'Verifique que la URL usa el mismo hostname que aparece en el certificado',
        ],
        technical: {
          errorCode: certCode,
          sslDetail: specific,
          rawMessage: msg,
          target,
          pacsType: context.pacsType,
          pacsLabel: label,
          timestamp: new Date().toISOString(),
        },
      };
    }

    // Network unreachable
    if (/ENETUNREACH|EHOSTUNREACH/i.test(msg)) {
      return {
        code: 'GW-NET-004',
        severity: 'critical',
        title: 'Red Inalcanzable (ENETUNREACH)',
        detail: `No existe ruta de red hacia ${target}. El sistema operativo no sabe cómo llegar a ese destino.`,
        causes: [
          'El PACS está en una subred/VLAN diferente sin enrutamiento configurado',
          'La interfaz de red del Gateway está desconectada',
          'La VPN necesaria para alcanzar el PACS no está conectada',
          'Error de configuración de red: gateway, máscara, tablas de ruta',
        ],
        fixes: [
          'Verifique conectividad básica del Gateway: ping 8.8.8.8 (¿tiene internet?)',
          `Verifique enrutamiento: traceroute ${context.host || 'HOST'}`,
          'Si requiere VPN: conéctela y verifique que tiene ruta al segmento del PACS',
          'Si son VLANs diferentes: confirme enrutamiento inter-VLAN con TI',
          'Ejecute: ip route (Linux) / route print (Windows) para ver tabla de rutas',
        ],
        technical: {
          errorCode: 'ENETUNREACH',
          rawMessage: msg,
          target,
          pacsType: context.pacsType,
          pacsLabel: label,
          timestamp: new Date().toISOString(),
        },
      };
    }

    // ECONNRESET / EPIPE
    if (/ECONNRESET|EPIPE|BROKEN/i.test(msg)) {
      return {
        code: 'GW-NET-005',
        severity: 'error',
        title: 'Conexión Reiniciada por el Servidor (ECONNRESET)',
        detail: `El servidor ${target} aceptó la conexión pero la cerró abruptamente durante la comunicación.`,
        causes: [
          'Incompatibilidad de protocolo: el Gateway conecta por HTTPS pero el PACS espera HTTP (o viceversa)',
          'Un proxy/load-balancer intermedio cortó la conexión',
          'El PACS rechazó la petición después de leer los headers (auth, content-type, etc.)',
          'El servicio PACS se reinició durante la petición',
        ],
        fixes: [
          'Verifique si la URL usa el protocolo correcto (http:// vs https://)',
          'Pruebe cambiar entre HTTP y HTTPS en la URL del PACS',
          'Revise los logs del PACS para ver si registró un error en su lado',
          'Si hay proxy/WAF intermedio, verifique su configuración',
          'Intente nuevamente — si es intermitente, puede ser un problema transitorio',
        ],
        technical: {
          errorCode: 'ECONNRESET',
          rawMessage: msg,
          target,
          pacsType: context.pacsType,
          pacsLabel: label,
          timestamp: new Date().toISOString(),
        },
      };
    }

    // Permission / port in use
    if (/EACCES|EADDRINUSE/i.test(msg)) {
      const isPortInUse = /EADDRINUSE/i.test(msg);
      return {
        code: isPortInUse ? 'GW-NET-007' : 'GW-NET-006',
        severity: 'error',
        title: isPortInUse ? 'Puerto en Uso (EADDRINUSE)' : 'Permiso Denegado (EACCES)',
        detail: isPortInUse
          ? `El puerto ${context.port || ''} ya está siendo usado por otro proceso en este equipo.`
          : `Sin permisos para usar el puerto ${context.port || ''}. Los puertos < 1024 requieren privilegios de root/admin.`,
        causes: isPortInUse
          ? ['Otra instancia del Gateway ya está corriendo', 'Otro servicio ocupa el mismo puerto (ej: otro DICOM listener)', 'El proceso anterior no se cerró correctamente (socket en TIME_WAIT)']
          : ['El puerto requiere privilegios de administrador (root/sudo)', 'Restricciones de SELinux o AppArmor', 'Política de seguridad del OS bloquea puertos de red'],
        fixes: isPortInUse
          ? [`Identifique el proceso: lsof -i :${context.port || 'PORT'} (macOS/Linux) o netstat -ano | findstr ${context.port || 'PORT'} (Windows)`, 'Detenga la otra instancia o cambie el puerto en la configuración', 'Si acaba de reiniciar, espere 30-60s (TIME_WAIT TCP)']
          : [`Use un puerto > 1024 (ej: 11113 para DICOM, 3001 para HTTP)`, 'Ejecute el Gateway con sudo/admin (no recomendado para producción)', 'Configure capabilities: sudo setcap cap_net_bind_service=+ep $(which node)'],
        technical: {
          errorCode: isPortInUse ? 'EADDRINUSE' : 'EACCES',
          rawMessage: msg,
          target,
          port: String(context.port || ''),
          pacsType: context.pacsType,
          pacsLabel: label,
          timestamp: new Date().toISOString(),
        },
      };
    }

    // Abort
    if (/abort/i.test(msg)) {
      return {
        code: 'GW-NET-008',
        severity: 'warning',
        title: 'Petición Cancelada (Abort)',
        detail: `La petición a ${target} fue cancelada antes de completarse, probablemente por timeout interno.`,
        causes: [
          'El timeout interno del test (10s) se alcanzó y la petición fue abortada',
          'El servidor cerró la conexión inesperadamente',
          'Problemas intermitentes de conectividad de red',
        ],
        fixes: [
          'Intente nuevamente — puede ser un problema temporal',
          'Verifique estabilidad de la red: ping -c 10 al host del PACS (¿hay pérdida?)',
          'Si persiste, revise los logs del PACS y del Gateway para más contexto',
        ],
        technical: {
          errorCode: 'ABORT',
          rawMessage: msg,
          target,
          pacsType: context.pacsType,
          pacsLabel: label,
          timestamp: new Date().toISOString(),
        },
      };
    }

    // Generic fallback
    return {
      code: 'GW-ERR-999',
      severity: 'error',
      title: 'Error No Clasificado',
      detail: `Error inesperado conectando a ${label} en ${target}.`,
      causes: [
        `La configuración de PACS tipo "${label}" puede no coincidir con el servidor real`,
        'Error interno del Gateway o del PACS',
        'Problema de red no categorizado',
      ],
      fixes: [
        `Verifique que el tipo "${label}" sea correcto para su PACS`,
        'Revise la URL/Host y puerto configurados',
        'Consulte los logs del Gateway (terminal) para stack trace completo',
        'Copie el diagnóstico técnico y contacte soporte si persiste',
      ],
      technical: {
        errorCode: errCode || 'UNKNOWN',
        rawMessage: msg,
        target,
        pacsType: context.pacsType,
        pacsLabel: label,
        timestamp: new Date().toISOString(),
      },
    };
  }

  /** Diagnose HTTP status codes from PACS responses */
  function diagnoseHttpStatus(status: number, statusText: string, ctx: { pacsType: string; url: string; endpoint?: string; label: string; latency?: number }): DiagnosticResult {
    const { pacsType, url, endpoint, label } = ctx;
    const ep = endpoint || url;

    switch (status) {
      case 400:
        return {
          code: 'GW-HTTP-400', severity: 'error',
          title: 'Solicitud Malformada (HTTP 400)',
          detail: `El PACS (${label}) rechazó la petición al endpoint ${ep} porque el formato es inválido.`,
          causes: [
            'Los parámetros de consulta (query string) tienen formato incorrecto',
            'Headers HTTP incompatibles con lo que espera el PACS',
            `El endpoint ${ep} requiere parámetros obligatorios que no se enviaron`,
            'Content-Type incorrecto para este endpoint',
          ],
          fixes: [
            'Verifique que los endpoints DICOMweb estén correctamente escritos',
            'Compare los paths con la documentación oficial de su PACS',
            `Consulte la API docs de ${label} para los parámetros requeridos`,
          ],
          technical: { httpStatus: String(status), statusText, endpoint: ep, url, pacsType, latency: ctx.latency ? `${ctx.latency}ms` : '-', timestamp: new Date().toISOString() },
        };
      case 401:
        return {
          code: 'GW-AUTH-001', severity: 'critical',
          title: 'No Autorizado — Credenciales Inválidas (HTTP 401)',
          detail: `El PACS requiere autenticación. Las credenciales enviadas fueron rechazadas o no se enviaron credenciales.`,
          causes: [
            'Usuario o contraseña incorrectos para el PACS',
            'El tipo de autenticación no coincide: el Gateway envía Basic pero el PACS espera Bearer (o viceversa)',
            'Las credenciales no están configuradas en el Gateway (campos vacíos)',
            'Si es Bearer: el token ha expirado o es inválido',
          ],
          fixes: [
            '🔑 Verifique usuario y contraseña en la sección "Autenticación PACS" de esta página',
            'Confirme el tipo de auth requerido con el administrador del PACS',
            `Pruebe las credenciales directamente: curl -u USER:PASS ${url}`,
            'Si usa Bearer token: regenere el token desde la consola del PACS',
          ],
          technical: { httpStatus: '401', statusText, endpoint: ep, url, pacsType, authNote: 'Verificar credenciales', timestamp: new Date().toISOString() },
        };
      case 403:
        return {
          code: 'GW-AUTH-002', severity: 'critical',
          title: 'Acceso Prohibido — Sin Permisos (HTTP 403)',
          detail: `La autenticación fue aceptada pero el usuario no tiene permisos para esta operación en el PACS.`,
          causes: [
            'El usuario PACS no tiene rol o permiso para operaciones DICOMweb',
            'El PACS tiene whitelist de IPs y la IP del Gateway no está incluida',
            'CORS o políticas de seguridad del PACS bloquean peticiones externas',
            'El recurso requiere privilegios de administrador del PACS',
          ],
          fixes: [
            'En el PACS: asigne permisos de lectura y escritura DICOM al usuario del Gateway',
            'Agregue la IP de este Gateway a la whitelist del PACS (si aplica)',
            'Consulte con el administrador del PACS sobre los roles necesarios',
            'Revise la configuración CORS del PACS para permitir peticiones del Gateway',
          ],
          technical: { httpStatus: '403', statusText, endpoint: ep, url, pacsType, timestamp: new Date().toISOString() },
        };
      case 404: {
        if (pacsType === 'orthanc') {
          return {
            code: 'GW-CFG-001', severity: 'error',
            title: 'Endpoint No Encontrado (404) — ¿Tipo PACS Incorrecto?',
            detail: `El endpoint Orthanc /system no existe en ${url}. Esto sugiere que el servidor NO es Orthanc REST API.`,
            causes: [
              `El servidor en ${url} NO es Orthanc — es otro tipo de PACS`,
              'Posiblemente es DICOMweb (FUJIFILM Synapse, DCM4CHEE, Google Health API, Horos, etc.)',
              'La URL base es incorrecta o tiene un path extra que no debería',
              'Orthanc está instalado pero responde en un puerto o path diferente',
            ],
            fixes: [
              '🔄 RECOMENDADO: Cambie el tipo de PACS a "DICOMweb" si su servidor soporta STOW/QIDO/WADO',
              `Verifique accediendo desde el navegador: ${url}/system (debe devolver JSON con Orthanc version)`,
              'Si es Orthanc: la URL estándar es http://HOST:8042 (sin path adicional)',
              'Consulte con TI sobre el tipo exacto de PACS instalado en el centro',
            ],
            technical: { httpStatus: '404', statusText, testedEndpoint: ep, url, pacsType, suggestedType: 'dicomweb', timestamp: new Date().toISOString() },
          };
        }
        return {
          code: 'GW-HTTP-404', severity: 'error',
          title: 'Endpoint No Encontrado (HTTP 404)',
          detail: `El path ${ep} no existe en el servidor PACS (${label}).`,
          causes: [
            `Los endpoints DICOMweb configurados no coinciden con los de su PACS (${label})`,
            'La URL base tiene un path de más o le falta un prefijo',
            'El servidor PACS no expone los endpoints en los paths estándar DICOMweb',
          ],
          fixes: [
            `Verifique los paths DICOMweb en la documentación de su PACS (${label})`,
            'Paths comunes: /dicom-web, /wado-rs, /rs, /dcm4chee-arc/aets/DCM4CHEE/rs',
            `Pruebe el endpoint completo en el navegador: ${ep}`,
            'Consulte con el administrador del PACS sobre los paths correctos',
          ],
          technical: { httpStatus: '404', statusText, testedEndpoint: ep, url, pacsType, timestamp: new Date().toISOString() },
        };
      }
      case 405:
        return {
          code: 'GW-HTTP-405', severity: 'info',
          title: 'Método No Permitido (405) — Endpoint Válido',
          detail: `El endpoint ${ep} existe pero no acepta el método HTTP del test. Esto generalmente indica que la configuración es CORRECTA.`,
          causes: [
            'El test usó OPTIONS pero el PACS solo acepta POST en STOW (comportamiento normal)',
            'El PACS no implementa preflight CORS (OPTIONS)',
          ],
          fixes: [
            '✅ Este resultado es generalmente positivo — confirma que el endpoint existe',
            'Para verificación completa: envíe un estudio real a través del Gateway',
          ],
          technical: { httpStatus: '405', statusText, endpoint: ep, url, pacsType, note: 'Método de test no soportado, endpoint probablemente válido', timestamp: new Date().toISOString() },
        };
      case 500:
        return {
          code: 'GW-HTTP-500', severity: 'error',
          title: 'Error Interno del PACS (HTTP 500)',
          detail: `El PACS (${label}) respondió con un error interno. El problema está en el PACS, no en el Gateway.`,
          causes: [
            'Error interno en el software PACS (bug, excepción no manejada)',
            'La base de datos del PACS tiene problemas (corrupción, llenura)',
            'El PACS se quedó sin espacio en disco',
            'Conflicto de configuración interna del PACS',
          ],
          fixes: [
            'Revise los logs internos del PACS para identificar la causa del error 500',
            'Reinicie el servicio PACS si es seguro hacerlo',
            'Verifique espacio en disco y estado de la DB del PACS',
            'Contacte al soporte técnico del fabricante del PACS',
          ],
          technical: { httpStatus: '500', statusText, endpoint: ep, url, pacsType, timestamp: new Date().toISOString() },
        };
      case 502:
        return {
          code: 'GW-HTTP-502', severity: 'error',
          title: 'Bad Gateway — Proxy No Alcanza al PACS (HTTP 502)',
          detail: `Un reverse proxy (Nginx, Apache, HAProxy) frente al PACS no pudo comunicarse con el servicio PACS real.`,
          causes: [
            'Hay un reverse proxy frente al PACS y el backend PACS está caído',
            'El proxy tiene configuración incorrecta de upstream (dirección/puerto del PACS)',
            'El servicio PACS se reinició y el proxy aún intenta conectar al proceso antiguo',
          ],
          fixes: [
            'Verifique que el servicio PACS esté corriendo detrás del proxy',
            'Revise la configuración upstream del reverse proxy',
            'Si no debería haber proxy: verifique que la URL apunte directamente al PACS',
            'Pruebe conectar directamente al PACS (sin proxy) para aislar el problema',
          ],
          technical: { httpStatus: '502', statusText, endpoint: ep, url, pacsType, timestamp: new Date().toISOString() },
        };
      case 503:
        return {
          code: 'GW-HTTP-503', severity: 'warning',
          title: 'Servicio No Disponible — Temporalmente (HTTP 503)',
          detail: `El PACS respondió pero el servicio está temporalmente no disponible. Puede estar en mantenimiento o arrancando.`,
          causes: [
            'El PACS está en proceso de inicio (aún no está listo)',
            'El PACS está en modo de mantenimiento programado',
            'El PACS está sobrecargado y rechaza nuevas conexiones',
            'Actualización de software del PACS en progreso',
          ],
          fixes: [
            '⏳ Espere 2-5 minutos y vuelva a intentar el test',
            'Verifique si hay mantenimiento programado en el PACS',
            'Consulte el estado del PACS con el administrador del sistema',
            'Revise los logs del PACS para mensajes de "ready" o "started"',
          ],
          technical: { httpStatus: '503', statusText, endpoint: ep, url, pacsType, timestamp: new Date().toISOString() },
        };
      case 504:
        return {
          code: 'GW-HTTP-504', severity: 'error',
          title: 'Gateway Timeout — Proxy Sin Respuesta (HTTP 504)',
          detail: `Un proxy/load-balancer intermedio no recibió respuesta del PACS dentro de su timeout configurado.`,
          causes: [
            'El PACS tardó demasiado en responder y el proxy cortó la espera',
            'El timeout del proxy/LB es demasiado corto para operaciones PACS',
            'Problemas de red entre el proxy y el backend PACS',
          ],
          fixes: [
            'Aumente el proxy_read_timeout (Nginx) o ProxyTimeout (Apache)',
            'Verifique la conectividad entre el proxy y el PACS directamente',
            'Pruebe conectar al PACS sin pasar por el proxy para descartar',
          ],
          technical: { httpStatus: '504', statusText, endpoint: ep, url, pacsType, timestamp: new Date().toISOString() },
        };
      default: {
        const severity = status >= 500 ? 'error' : status >= 400 ? 'warning' : 'info';
        return {
          code: `GW-HTTP-${status}`, severity,
          title: `Respuesta HTTP ${status} — ${statusText}`,
          detail: `El PACS respondió con código ${status}. Este no es un código esperado para esta operación.`,
          causes: [
            `Comportamiento no estándar del PACS (${label})`,
            'Proxy, WAF o CDN interceptando la petición',
            'Configuración incorrecta de endpoints',
          ],
          fixes: [
            `Consulte la documentación de su PACS (${label}) para este endpoint`,
            `Pruebe accediendo directamente: ${ep}`,
            `Revise los logs del PACS para entender el código ${status}`,
          ],
          technical: { httpStatus: String(status), statusText, endpoint: ep, url, pacsType, timestamp: new Date().toISOString() },
        };
      }
    }
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
        const diag: DiagnosticResult = {
          code: 'GW-CFG-002',
          severity: 'warning',
          title: 'Test HTTP No Aplica — Tipo DICOM Nativo',
          detail: `Este test valida conectividad HTTP, pero su configuración actual es "${label}" que usa protocolo TCP/DICOM, no HTTP.`,
          causes: [
            `El tipo de PACS está configurado como "${label}" que no usa endpoints HTTP`,
            'Los tests HTTP (GET /system, QIDO-RS) solo aplican para Orthanc REST API o DICOMweb',
          ],
          fixes: host
            ? [`Use el botón "🔌 Test Conexión TCP" para probar ${host}:${port}`, 'Si su PACS también soporta DICOMweb: cambie el tipo a "DICOMweb" y configure la URL HTTP']
            : ['Configure el Host/IP del PACS en la sección DICOM Nativo', 'Use el botón "🔌 Test Conexión TCP" después de configurar'],
          technical: { pacsType, pacsLabel: label, host: host || 'no-configurado', port: String(port || ''), timestamp: new Date().toISOString() },
        };
        return reply.send({ success: false, diagnostic: diag, pacsType, pacsTypeLabel: label });
      }
      
      // Validate URL
      if (!pacsUrl || (pacsUrl === 'http://localhost:8042' && pacsType === 'dicomweb')) {
        const diag: DiagnosticResult = {
          code: 'GW-CFG-003',
          severity: 'warning',
          title: 'URL del PACS No Configurada',
          detail: `La URL del PACS ${pacsUrl ? `es "${pacsUrl}" (valor por defecto de Orthanc)` : 'está vacía'} pero el tipo seleccionado es "${label}".`,
          causes: [
            'La URL del PACS no ha sido configurada (aún tiene el valor por defecto)',
            `El tipo "${label}" requiere una URL HTTP válida para su PACS`,
          ],
          fixes: [
            `Ingrese la URL real de su PACS en el campo "URL del PACS" (ej: http://192.168.1.50:8042)`,
            'Consulte con TI la URL/IP y puerto del servidor PACS del centro',
            pacsType === 'dicomweb' ? 'Para DICOMweb típico: http://HOST:PORT/dicom-web' : 'Para Orthanc típico: http://HOST:8042',
          ],
          technical: { pacsType, pacsLabel: label, currentUrl: pacsUrl || 'vacío', timestamp: new Date().toISOString() },
        };
        return reply.send({ success: false, diagnostic: diag, pacsType, pacsTypeLabel: label, pacsUrl });
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
          // Try to extract useful info from response body
          let serverInfo = '';
          try {
            const body = await response.text();
            if (pacsType === 'orthanc') {
              const json = JSON.parse(body);
              if (json.Version) serverInfo = `Orthanc v${json.Version}`;
              if (json.DicomAet) serverInfo += ` | AET: ${json.DicomAet}`;
            } else if (body) {
              serverInfo = `Respuesta: ${body.length} bytes`;
            }
          } catch { /* ignore body parse errors */ }
          
          const diag: DiagnosticResult = {
            code: 'GW-OK-200',
            severity: 'info',
            title: 'Conexión Exitosa',
            detail: `El PACS (${label}) respondió correctamente en ${latency}ms.${serverInfo ? ' ' + serverInfo : ''}`,
            causes: [],
            fixes: [],
            technical: { httpStatus: String(response.status), latency: `${latency}ms`, endpoint: testDescription, url: testUrl, pacsType, serverInfo: serverInfo || '-', timestamp: new Date().toISOString() },
          };
          return reply.send({
            success: true,
            message: `✅ Conexión exitosa a ${label} (${latency}ms)`,
            diagnostic: diag,
            endpoint: testDescription,
            status: response.status,
            latency,
            pacsType,
            pacsTypeLabel: label,
            pacsUrl,
            serverInfo: serverInfo || undefined,
          });
        } else {
          const diag = diagnoseHttpStatus(response.status, response.statusText, { pacsType, url: pacsUrl, endpoint: testUrl, label, latency: Date.now() - startTime });
          return reply.send({
            success: false,
            diagnostic: diag,
            endpoint: testDescription,
            testedUrl: testUrl,
            pacsType,
            pacsTypeLabel: label,
            pacsUrl,
            latency: Date.now() - startTime,
          });
        }
      } catch (error) {
        const diag = diagnoseError(error, { pacsType, url: pacsUrl });
        return reply.send({
          success: false,
          diagnostic: diag,
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
        const diag: DiagnosticResult = {
          code: 'GW-CFG-004',
          severity: 'warning',
          title: 'STOW-RS No Aplica — Tipo DICOM Nativo',
          detail: `STOW-RS es un protocolo HTTP para envío de imágenes. Su configuración actual es "${label}" que usa C-STORE (protocolo TCP/DICOM), no HTTP.`,
          causes: [
            'El tipo DICOM Nativo envía imágenes via C-STORE sobre TCP, no STOW-RS sobre HTTP',
            'Este test solo aplica para tipos "Orthanc REST API" o "DICOMweb"',
          ],
          fixes: [
            'Use "🔌 Test Conexión TCP" para validar la conexión DICOM Nativa',
            'Si su PACS también soporta DICOMweb: cambie el tipo y configure STOW endpoint',
          ],
          technical: { pacsType, pacsLabel: label, protocol: 'C-STORE (TCP) vs STOW-RS (HTTP)', timestamp: new Date().toISOString() },
        };
        return reply.send({ success: false, diagnostic: diag, pacsType, pacsTypeLabel: label });
      }
      
      try {
        const startTime = Date.now();
        let testUrl = pacsUrl;
        let testDescription = '';
        
        if (pacsType === 'orthanc') {
          testUrl = `${pacsUrl}/instances`;
          testDescription = `${label} → POST /instances (via OPTIONS)`;
        } else {
          testUrl = `${pacsUrl}${stowPath}`;
          testDescription = `${label} → STOW-RS ${stowPath} (via OPTIONS)`;
        }
        
        const response = await fetch(testUrl, {
          method: 'OPTIONS',
          headers: getAuthHeaders(),
          signal: AbortSignal.timeout(10000)
        });
        
        const latency = Date.now() - startTime;
        
        if (response.ok || response.status === 405 || response.status === 204) {
          const isMethodNotAllowed = response.status === 405;
          const diag: DiagnosticResult = {
            code: isMethodNotAllowed ? 'GW-HTTP-405' : 'GW-OK-200',
            severity: 'info',
            title: isMethodNotAllowed ? 'Endpoint STOW Existe (405 — normal)' : 'Endpoint STOW Accesible',
            detail: isMethodNotAllowed
              ? `El endpoint STOW respondió 405 (Method Not Allowed) al test OPTIONS. Esto confirma que el endpoint EXISTE y funciona — solo rechaza el método de prueba.`
              : `El endpoint STOW respondió ${response.status} correctamente en ${latency}ms.`,
            causes: [],
            fixes: isMethodNotAllowed
              ? ['✅ El endpoint existe y está listo para recibir imágenes DICOM via POST', 'Para verificación completa: envíe un estudio real a través del Gateway']
              : [],
            technical: { httpStatus: String(response.status), latency: `${latency}ms`, endpoint: testDescription, stowUrl: testUrl, pacsType, timestamp: new Date().toISOString() },
          };
          return reply.send({
            success: true,
            message: `✅ Endpoint STOW accesible en ${label} (${latency}ms)${isMethodNotAllowed ? ' [405=endpoint válido]' : ''}`,
            diagnostic: diag,
            endpoint: testDescription,
            stowUrl: testUrl,
            status: response.status,
            latency,
            pacsType,
            pacsTypeLabel: label
          });
        } else {
          const diag = diagnoseHttpStatus(response.status, response.statusText, { pacsType, url: pacsUrl, endpoint: testUrl, label, latency: Date.now() - startTime });
          // Enrich for STOW-specific context
          if (response.status === 404) {
            diag.detail = pacsType === 'orthanc'
              ? `El endpoint /instances no existe en ${pacsUrl}. Esto puede indicar que el servidor NO es Orthanc.`
              : `El path STOW "${stowPath}" no existe en ${pacsUrl}. Verifique el path correcto para su PACS (${label}).`;
            diag.fixes.push(`Path STOW estándar para DCM4CHEE: /dcm4chee-arc/aets/DCM4CHEE/rs/studies`);
            diag.fixes.push(`Path STOW estándar para Orthanc con DICOMweb plugin: /dicom-web/studies`);
          }
          return reply.send({
            success: false,
            diagnostic: diag,
            endpoint: testDescription,
            stowUrl: testUrl,
            pacsType,
            pacsTypeLabel: label,
            latency: Date.now() - startTime,
          });
        }
      } catch (error) {
        const diag = diagnoseError(error, { pacsType, url: pacsUrl });
        return reply.send({
          success: false,
          diagnostic: diag,
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
          const diag: DiagnosticResult = {
            code: 'GW-OK-200',
            severity: 'info',
            title: 'Worklist Operativo',
            detail: `Se encontraron ${itemCount} item${itemCount !== 1 ? 's' : ''} en ${latency}ms desde ${result.source}.`,
            causes: [],
            fixes: itemCount === 0 ? ['El worklist está vacío — esto puede ser normal si no hay procedimientos agendados para hoy'] : [],
            technical: {
              source: result.source || '-',
              itemCount: String(itemCount),
              totalAvailable: String(result.total || itemCount),
              latency: `${latency}ms`,
              pacsType,
              timestamp: new Date().toISOString(),
            },
          };
          return reply.send({
            success: true,
            message: `✅ Worklist OK — ${itemCount} item${itemCount !== 1 ? 's' : ''} encontrado${itemCount !== 1 ? 's' : ''} (${latency}ms)`,
            diagnostic: diag,
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
          const errMsg = result.error || 'No se pudo consultar el Worklist';
          let diag: DiagnosticResult;
          
          if (/404/i.test(errMsg)) {
            diag = {
              code: 'GW-WL-001',
              severity: 'error',
              title: 'Endpoint de Worklist No Encontrado (404)',
              detail: `El endpoint de worklist no existe en el PACS. Los paths UPS-RS / MWL configurados no son válidos para su PACS.`,
              causes: [
                'Los paths de Worklist no coinciden con la configuración del PACS',
                `Su PACS (${label}) puede usar paths diferentes a los estándar`,
                'El PACS no tiene habilitado el módulo de Worklist',
              ],
              fixes: [
                'Verifique los paths de UPS-RS y MWL en la documentación de su PACS',
                'Paths UPS-RS comunes: /workitems, /ups-rs/workitems',
                'Paths MWL comunes: /mwl, /modalities/WORKLIST/query',
                'Consulte con el administrador del PACS si el Worklist está habilitado',
              ],
              technical: { errorMsg: errMsg, source: result.source || '-', pacsType, pacsLabel: label, timestamp: new Date().toISOString() },
            };
          } else if (/401|403|unauthorized/i.test(errMsg)) {
            diag = {
              code: 'GW-AUTH-003',
              severity: 'critical',
              title: 'Sin Autorización para Worklist',
              detail: `Las credenciales del Gateway no tienen permiso para consultar el Worklist en el PACS.`,
              causes: [
                'El usuario PACS no tiene permisos para consultar el Worklist',
                'Las credenciales están incorrectas o vacías',
                'El tipo de autenticación no coincide con lo que requiere el PACS',
              ],
              fixes: [
                'Verifique las credenciales en la sección "Autenticación PACS"',
                'Confirme que el usuario tiene permisos de lectura de Worklist en el PACS',
                'Pruebe las credenciales directamente en el PACS o navegador',
              ],
              technical: { errorMsg: errMsg, source: result.source || '-', pacsType, pacsLabel: label, timestamp: new Date().toISOString() },
            };
          } else if (/ECONNREFUSED/i.test(errMsg)) {
            diag = diagnoseError(new Error(errMsg), { pacsType, url: pacsUrl });
          } else if (pacsType === 'dicom-native') {
            diag = {
              code: 'GW-WL-002',
              severity: 'info',
              title: 'Worklist DICOM Nativo (C-FIND MWL)',
              detail: `El worklist para DICOM Nativo usa C-FIND MWL sobre TCP (no HTTP). Asegúrese de que el PACS esté configurado para responder consultas MWL.`,
              causes: [
                'El tipo DICOM Nativo usa C-FIND para consultar la Modality Worklist sobre TCP',
                'El test de worklist HTTP no aplica para este modo',
              ],
              fixes: [
                'Use el botón "Test C-ECHO" para verificar la conectividad DICOM',
                'La worklist se consultará automáticamente via C-FIND MWL al usar la API /api/worklist',
                'Verifique que el AE Title del Gateway esté registrado en el PACS para consultas MWL',
              ],
              technical: { pacsType, pacsLabel: label, protocol: 'C-FIND MWL (TCP/DIMSE via dcmjs-dimse)', timestamp: new Date().toISOString() },
            };
          } else if (result.source === 'mock') {
            diag = {
              code: 'GW-WL-003',
              severity: 'warning',
              title: 'Worklist en Modo MOCK (Datos de Prueba)',
              detail: `El worklist devolvió datos de prueba (mock). No está conectado al PACS real.`,
              causes: [
                'WORKLIST_MODE está en "mock" (datos ficticios para desarrollo)',
                'Los endpoints de worklist no están configurados correctamente',
              ],
              fixes: [
                'Cambie WORKLIST_MODE a "pacs" en la configuración para conectar al PACS real',
                'Configure los paths correctos de UPS-RS / MWL para su PACS',
              ],
              technical: { source: 'mock', pacsType, pacsLabel: label, timestamp: new Date().toISOString() },
            };
          } else {
            diag = {
              code: 'GW-WL-004',
              severity: 'error',
              title: 'Error en Consulta de Worklist',
              detail: `No se pudo obtener el worklist desde ${label}: ${errMsg}`,
              causes: [
                `El PACS (${label}) no soporta Worklist o no está habilitado`,
                'Los endpoints de worklist están mal configurados',
                'Error de comunicación con el PACS',
              ],
              fixes: [
                'Verifique que su PACS soporte Worklist (UPS-RS o MWL)',
                'Confirme los endpoints correctos con la documentación de su PACS',
                'Pruebe la conexión PACS básica primero (Test HTTP o Test TCP)',
              ],
              technical: { errorMsg: errMsg, source: result.source || '-', pacsType, pacsLabel: label, timestamp: new Date().toISOString() },
            };
          }
          
          return reply.send({
            success: false,
            diagnostic: diag,
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
          diagnostic: diag,
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
        const diag: DiagnosticResult = {
          code: 'GW-CFG-005',
          severity: 'warning',
          title: 'Host/IP del PACS No Configurado',
          detail: `El campo "Host/IP del PACS" está vacío. Se requiere una dirección para probar la conexión TCP.`,
          causes: ['El host/IP del PACS DICOM no ha sido configurado en la sección DICOM Nativo'],
          fixes: [
            'Ingrese la IP o hostname del PACS en el campo "Host / IP del PACS"',
            'Ejemplo: 192.168.1.100 o pacs.hospital.local',
            'Consulte con TI la IP del servidor PACS del centro',
          ],
          technical: { field: 'pacsDicomHost', value: 'vacío', pacsType: 'dicom-native', timestamp: new Date().toISOString() },
        };
        return reply.send({ success: false, diagnostic: diag });
      }
      if (!calledAet) {
        const diag: DiagnosticResult = {
          code: 'GW-CFG-006',
          severity: 'warning',
          title: 'AE Title del PACS No Configurado',
          detail: `El campo "AE Title del PACS" está vacío. Se requiere para la asociación DICOM.`,
          causes: ['El AE Title del PACS no ha sido configurado en la sección DICOM Nativo'],
          fixes: [
            'Ingrese el AE Title del PACS (ej: SYNAPSE, DCM4CHEE, ORTHANC, CONQUEST)',
            'El AE Title es un identificador único del PACS — consulte con el administrador del PACS',
            'Normalmente se configura en el PACS al registrar nodos DICOM',
          ],
          technical: { field: 'pacsAeTitle', value: 'vacío', pacsType: 'dicom-native', timestamp: new Date().toISOString() },
        };
        return reply.send({ success: false, diagnostic: diag });
      }
      
      try {
        const { nativeCEcho } = await import('../services/dicom-native.service.js');
        const result = await nativeCEcho({
          host,
          port,
          callingAeTitle: callingAet || 'ANDEX01',
          calledAeTitle: calledAet,
          timeout: 10000,
        });
        
        const latency = result.latencyMs;
        
        if (result.success) {
          const diag: DiagnosticResult = {
            code: 'GW-OK-CECHO',
            severity: 'info',
            title: 'C-ECHO DICOM Exitoso',
            detail: `C-ECHO DICOM exitoso contra ${host}:${port}. Asociación DICOM establecida y verificada. Latencia: ${latency}ms.`,
            causes: [],
            fixes: [
              '✅ C-ECHO exitoso. La asociación DICOM está funcionando correctamente.',
              `AE Title local: "${callingAet}" → AE Title PACS: "${calledAet}"`,
              'El PACS acepta y responde a operaciones DICOM desde este Gateway.',
              'Ya puede usar C-FIND MWL (Worklist) y C-STORE desde el Gateway.',
            ],
            technical: {
              host, port: String(port),
              callingAet: callingAet || '-', calledAet: calledAet || '-',
              latency: `${latency}ms`, protocol: 'DICOM DIMSE (A-ASSOCIATE + C-ECHO)',
              pacsType: 'dicom-native', pacsLabel: 'DICOM Nativo (TCP)',
              note: 'C-ECHO real exitoso via dcmjs-dimse. Asociación DICOM verificada.',
              timestamp: new Date().toISOString(),
            },
          };
          return reply.send({
            success: true,
            message: `✅ C-ECHO OK — Asociación DICOM verificada con ${calledAet}@${host}:${port} (${latency}ms)`,
            diagnostic: diag,
            pacsType: 'dicom-native',
            pacsTypeLabel: getPacsTypeLabel('dicom-native'),
            latency,
            details: { host, port, callingAet, calledAet },
          });
        } else {
          const diag = diagnoseError(new Error(result.error || ''), { pacsType: 'dicom-native', host, port });
          return reply.send({
            success: false,
            diagnostic: diag,
            pacsType: 'dicom-native',
            pacsTypeLabel: getPacsTypeLabel('dicom-native'),
            details: { host, port, callingAet, calledAet }
          });
        }
      } catch (error) {
        const diag = diagnoseError(error, { pacsType: 'dicom-native', host, port });
        return reply.send({
          success: false,
          diagnostic: diag,
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
    worklistDefaultModality: s.worklistDefaultModality || config.worklistDefaultModality,
    worklistStationAET: s.worklistStationAET || config.worklistStationAET,
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
    /* --- Diagnostic Rich Error Display --- */
    .diag-box { border-radius: 10px; margin-top: 12px; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; border: 1px solid #e5e7eb; }
    .diag-header { padding: 12px 16px; display: flex; align-items: center; gap: 10px; }
    .diag-header.critical { background: #fef2f2; border-bottom: 2px solid #ef4444; }
    .diag-header.error { background: #fff7ed; border-bottom: 2px solid #f97316; }
    .diag-header.warning { background: #fefce8; border-bottom: 2px solid #eab308; }
    .diag-header.info { background: #f0fdf4; border-bottom: 2px solid #22c55e; }
    .diag-code { font-family: monospace; font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 4px; white-space: nowrap; }
    .diag-header.critical .diag-code { background: #fee2e2; color: #991b1b; }
    .diag-header.error .diag-code { background: #ffedd5; color: #9a3412; }
    .diag-header.warning .diag-code { background: #fef9c3; color: #854d0e; }
    .diag-header.info .diag-code { background: #dcfce7; color: #166534; }
    .diag-title { font-size: 14px; font-weight: 600; color: #1f2937; }
    .diag-body { padding: 14px 16px; background: white; font-size: 13px; line-height: 1.6; }
    .diag-detail { margin-bottom: 12px; color: #374151; }
    .diag-section { margin-bottom: 10px; }
    .diag-section-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; margin-bottom: 6px; }
    .diag-section ul, .diag-section ol { margin: 0; padding-left: 20px; }
    .diag-section li { margin-bottom: 4px; color: #374151; font-size: 13px; }
    .diag-section.causes li::marker { color: #f97316; }
    .diag-section.fixes li::marker { color: #22c55e; }
    .diag-tech { background: #f3f4f6; border-radius: 6px; padding: 10px 14px; font-family: monospace; font-size: 11px; color: #4b5563; cursor: pointer; }
    .diag-tech-toggle { font-size: 12px; color: #6b7280; cursor: pointer; user-select: none; display: flex; align-items: center; gap: 6px; margin-top: 8px; }
    .diag-tech-toggle:hover { color: #374151; }
    .diag-tech-content { display: none; margin-top: 6px; }
    .diag-tech-content.open { display: block; }
    .diag-copy { font-size: 11px; color: #6b7280; background: #e5e7eb; border: none; padding: 3px 10px; border-radius: 4px; cursor: pointer; margin-top: 6px; float: right; }
    .diag-copy:hover { background: #d1d5db; }
    .checkbox-group { display: flex; align-items: center; gap: 8px; }
    .checkbox-group input[type="checkbox"] { width: auto; }
    .section-title { font-size: 14px; font-weight: 600; color: #4f46e5; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 2px solid #e5e7eb; }
    code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; font-size: 13px; }
    /* --- First config banner --- */
    .first-config-banner { background: linear-gradient(135deg, #fef3c7, #fde68a); border: 1px solid #f59e0b; border-radius: 12px; padding: 16px 20px; margin-bottom: 20px; display: flex; align-items: flex-start; gap: 12px; }
    .first-config-banner .banner-icon { font-size: 28px; flex-shrink: 0; }
    .first-config-banner .banner-text h3 { font-size: 15px; font-weight: 700; color: #92400e; margin-bottom: 4px; }
    .first-config-banner .banner-text p { font-size: 13px; color: #78350f; line-height: 1.5; margin: 0; }
    .first-config-banner .banner-text ul { font-size: 13px; color: #78350f; margin: 6px 0 0 18px; line-height: 1.8; }
    /* --- Unconfigured field highlight --- */
    .needs-config { border-color: #f59e0b !important; background: #fffbeb !important; box-shadow: 0 0 0 2px rgba(245,158,11,0.2) !important; }
    .needs-config-label { color: #b45309 !important; font-weight: 600 !important; }
    .needs-config-label::after { content: ' ⚠ pendiente'; font-size: 11px; color: #d97706; font-weight: 500; margin-left: 6px; }
    .config-ok { border-color: #22c55e !important; }
    .config-legend { display: flex; gap: 16px; align-items: center; margin-bottom: 16px; font-size: 12px; color: #6b7280; flex-wrap: wrap; }
    .config-legend span { display: inline-flex; align-items: center; gap: 4px; }
    .config-legend .dot { width: 12px; height: 12px; border-radius: 3px; border: 2px solid; display: inline-block; }
    .config-legend .dot-pending { border-color: #f59e0b; background: #fffbeb; }
    .config-legend .dot-ok { border-color: #22c55e; background: #dcfce7; }
  </style>
</head>
<body>
  <div class="header">
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <div>
        <h1>\u2699\uFE0F Configuracion Gateway</h1>
        <p>Andex Gateway - ${currentConfig.centroNombre}</p>
      </div>
      <a href="/">\u2190 Volver al Dashboard</a>
    </div>
  </div>
  
  <div class="container">
    <div id="status"></div>

    <!-- First config detection banner -->
    <div id="firstConfigBanner" class="first-config-banner" style="display:none;">
      <div class="banner-icon">⚠️</div>
      <div class="banner-text">
        <h3>Primera Configuración Detectada</h3>
        <p>El Gateway está usando valores por defecto. Para que funcione correctamente, debe completar <strong>todos</strong> los campos resaltados en amarillo:</p>
        <ul>
          <li><strong>Centro Médico</strong> — Nombre, ID y AE Title del Gateway</li>
          <li><strong>Seguridad</strong> — Cambie la contraseña del Dashboard y la API Key</li>
          <li><strong>Servidor PACS</strong> — Seleccione el tipo y configure la conexión</li>
          <li><strong>Worklist</strong> — Configure los endpoints si su PACS tiene worklist</li>
        </ul>
      </div>
    </div>

    <!-- Legend -->
    <div class="config-legend" id="configLegend" style="display:none;">
      <span><span class="dot dot-pending"></span> Pendiente de configurar</span>
      <span><span class="dot dot-ok"></span> Configurado</span>
      <span style="color:#9ca3af;">|</span>
      <span id="configProgress">0 de 0 campos configurados</span>
    </div>

    <!-- Centro -->
    <div class="card">
      <div class="card-header">
        <h2>🏥 Centro Medico</h2>
      </div>
      <div class="card-body">
        <div class="alert alert-info" style="margin-bottom:16px;">
          📋 El <strong>ID del Centro (UUID)</strong> se obtiene al crear el centro en el panel de administración de <strong>AndexReports</strong>. Ingrese el UUID y presione "Verificar" para cargar los datos automáticamente.
        </div>
        <div class="form-group">
          <label>ID del Centro (UUID)</label>
          <div style="display:flex;gap:8px;">
            <input type="text" id="centroId" value="${currentConfig.centroId}" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" style="flex:1;font-family:monospace;font-size:13px;letter-spacing:0.5px;">
            <button class="btn btn-primary" onclick="lookupCentro()" style="white-space:nowrap;">🔍 Verificar</button>
          </div>
          <small>UUID asignado al crear el centro en AndexReports (ej: a0000001-de00-4000-a000-000000000001)</small>
        </div>
        <div id="centroLookupResult"></div>
        <div class="form-row" style="margin-top:12px;">
          <div class="form-group">
            <label>Nombre del Centro</label>
            <input type="text" id="centroNombre" value="${currentConfig.centroNombre}">
            <small>Se autocompleta al verificar el UUID. También puede ingresarlo manualmente.</small>
          </div>
          <div class="form-group">
            <label>AE Title del Gateway</label>
            <input type="text" id="gatewayAeTitle" value="${currentConfig.gatewayAeTitle}" placeholder="ANDEX_1" maxlength="16">
            <small>Nombre DICOM del Gateway en la red (aplica a DICOMweb y DICOM Nativo)</small>
          </div>
        </div>
        <div id="centroDetails" style="display:none;margin-top:12px;padding:12px 16px;background:#f0fdf4;border-radius:8px;border:1px solid #bbf7d0;">
          <div style="font-size:13px;font-weight:600;color:#166534;margin-bottom:8px;">✅ Centro Verificado</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px;color:#374151;">
            <div><strong>Dirección:</strong> <span id="centroDir">-</span></div>
            <div><strong>Teléfono:</strong> <span id="centroTel">-</span></div>
            <div><strong>Email:</strong> <span id="centroEmail">-</span></div>
            <div><strong>Plan:</strong> <span id="centroPlan">-</span></div>
            <div><strong>Estado:</strong> <span id="centroEstado">-</span></div>
            <div><strong>Unidad:</strong> <span id="centroUnidad">-</span></div>
          </div>
        </div>
      </div>
    </div>

    <!-- Seguridad -->
    <div class="card">
      <div class="card-header">
        <h2>🔐 Seguridad & Acceso</h2>
      </div>
      <div class="card-body">
        <div class="form-row-3">
          <div class="form-group">
            <label>API Key</label>
            <input type="text" id="apiKey" value="${currentConfig.apiKey}">
            <small>Clave para autenticar requests desde la PWA</small>
          </div>
          <div class="form-group">
            <label>Dashboard Usuario</label>
            <input type="text" id="dashboardUser" value="${currentConfig.dashboardUser}">
          </div>
          <div class="form-group">
            <label>Dashboard Password</label>
            <input type="password" id="dashboardPassword" placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022">
            <small>Dejar vacio para mantener actual</small>
          </div>
        </div>
        <div class="form-group">
          <label>Origenes Permitidos (CORS)</label>
          <input type="text" id="allowedOrigins" value="${currentConfig.allowedOrigins}">
          <small>URLs separadas por coma (ej: https://andexreports.app,http://localhost:3000)</small>
        </div>
      </div>
    </div>

    <!-- PACS - Card unificada -->
    <div class="card">
      <div class="card-header">
        <h2>🖥️ Servidor PACS</h2>
      </div>
      <div class="card-body">
        <!-- Selector de tipo -->
        <div class="form-group" style="margin-bottom: 20px;">
          <label>Tipo de Conexion PACS</label>
          <select id="pacsType" onchange="togglePacsFields()" style="font-size: 15px; font-weight: 500; padding: 12px;">
            <option value="orthanc" ${currentConfig.pacsType === 'orthanc' ? 'selected' : ''}>🟢 Orthanc REST API</option>
            <option value="dicomweb" ${currentConfig.pacsType === 'dicomweb' ? 'selected' : ''}>🔵 DICOMweb (STOW/QIDO/WADO)</option>
            <option value="dicom-native" ${currentConfig.pacsType === 'dicom-native' ? 'selected' : ''}>🟠 DICOM Nativo (TCP - C-STORE/MWL)</option>
          </select>
          <small id="pacsTypeHint"></small>
        </div>

        <!-- Descripcion del tipo seleccionado -->
        <div id="pacsTypeDesc" class="alert alert-info" style="margin-bottom: 20px;"></div>

        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">

        <!-- ========== SECCION HTTP (Orthanc + DICOMweb) ========== -->
        <div id="httpSection">
          <div class="form-row">
            <div class="form-group">
              <label>URL del PACS</label>
              <input type="text" id="pacsUrl" value="${currentConfig.pacsUrl}" placeholder="http://192.168.1.100:8042">
              <small id="pacsUrlHint">URL base del servidor PACS</small>
            </div>
            <div class="form-group">
              <label>Autenticacion</label>
              <select id="pacsAuthType">
                <option value="none" ${currentConfig.pacsAuthType === 'none' ? 'selected' : ''}>Sin autenticacion</option>
                <option value="basic" ${currentConfig.pacsAuthType === 'basic' ? 'selected' : ''}>Basic Auth</option>
                <option value="bearer" ${currentConfig.pacsAuthType === 'bearer' ? 'selected' : ''}>Bearer Token</option>
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Usuario</label>
              <input type="text" id="pacsUsername" value="${currentConfig.pacsUsername || ''}">
            </div>
            <div class="form-group">
              <label>Password / Token</label>
              <input type="password" id="pacsPassword" placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022">
              <small>Dejar vacio para mantener actual</small>
            </div>
          </div>

          <!-- Sub-seccion: Endpoints DICOMweb (solo para dicomweb) -->
          <div id="dicomwebEndpoints" style="margin-top: 16px;">
            <p class="section-title">📡 Endpoints DICOMweb</p>
            <div class="form-group">
              <label>STOW-RS Path (Almacenamiento)</label>
              <input type="text" id="dicomwebStowPath" value="${currentConfig.dicomwebStowPath}">
              <small>Endpoint para subir estudios (ej: /studies, /dcm4chee-arc/aets/DCM4CHEE/rs/studies)</small>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>QIDO-RS Path (Consulta)</label>
                <input type="text" id="dicomwebQidoPath" value="${currentConfig.dicomwebQidoPath}">
                <small>Endpoint para buscar estudios</small>
              </div>
              <div class="form-group">
                <label>WADO-RS Path (Recuperar)</label>
                <input type="text" id="dicomwebWadoPath" value="${currentConfig.dicomwebWadoPath}">
                <small>Endpoint para recuperar estudios</small>
              </div>
            </div>
          </div>

          <div class="btn-group">
            <button class="btn btn-outline" onclick="testPacs()">🔌 Test Conexion HTTP</button>
            <button class="btn btn-amber" onclick="testStow()" id="btnTestStow">📤 Test STOW</button>
          </div>
          <div id="testPacsResult"></div>
          <div id="testStowResult"></div>
        </div>

        <!-- ========== SECCION DICOM NATIVO (TCP) ========== -->
        <div id="nativeSection">
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
          <div class="form-group">
            <label>Gateway DICOM Port (Receptor)</label>
            <input type="number" id="gatewayDicomPort" value="${currentConfig.gatewayDicomPort}" placeholder="11113" style="max-width: 200px;">
            <small>Puerto donde el Gateway escucha conexiones DICOM entrantes (C-MOVE)</small>
          </div>

          <div class="alert alert-info" style="margin-top: 12px;">
            <strong>\u26A0\uFE0F Importante:</strong> El PACS remoto debe tener configurado el AE Title del Gateway (<strong>${currentConfig.gatewayAeTitle || 'ANDEX_1'}</strong>) como nodo permitido.
          </div>

          <div class="btn-group">
            <button class="btn btn-outline" onclick="testCEcho()">🔌 Test C-ECHO (Ping TCP)</button>
          </div>
          <div id="testCEchoResult"></div>
        </div>
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
            <small>Endpoint UPS-RS para consultar procedimientos</small>
          </div>
          <div class="form-group">
            <label>QIDO-RS MWL Path</label>
            <input type="text" id="worklistQidoMwlPath" value="${currentConfig.worklistQidoMwlPath}">
            <small>Endpoint alternativo para MWL</small>
          </div>
        </div>
        
        <div class="form-row">
          <div class="form-group">
            <label>Modalidad por Defecto</label>
            <input type="text" id="worklistDefaultModality" value="${currentConfig.worklistDefaultModality}" placeholder="ES">
            <small>Modalidad DICOM para filtrar Worklist (ES=Endoscopia, US=Ultrasonido, CT, MR...)</small>
          </div>
          <div class="form-group">
            <label>Worklist Station AE Title</label>
            <input type="text" id="worklistStationAET" value="${currentConfig.worklistStationAET}" placeholder="(vacio = sin filtro)">
            <small>AE Title de la estacion para filtrar la Worklist. Vacio = recibir todo.</small>
          </div>
        </div>

        <div class="form-group">
          <div class="checkbox-group">
            <input type="checkbox" id="worklistPreferUps" ${currentConfig.worklistPreferUps ? 'checked' : ''}>
            <label for="worklistPreferUps" style="margin-bottom: 0;">Preferir UPS-RS sobre QIDO-RS MWL</label>
          </div>
        </div>

        <div class="btn-group">
          <button class="btn btn-success" onclick="testWorklist()">📋 Test Worklist</button>
        </div>
        <div id="testWorklistResult"></div>
      </div>
    </div>

    <!-- Network Diagnostic -->
    <div class="card" style="border-left: 4px solid #3b82f6;">
      <div class="card-body">
        <h2>🔍 Diagnóstico de Red</h2>
        <p style="color:#6b7280; font-size:13px; margin-bottom:12px;">
          Verifica que este equipo está conectado a la red correcta y puede alcanzar el PACS, Worklist y servicios cloud.
        </p>

        <!-- IP Info Banner -->
        <div id="ipInfoBanner" style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:14px 16px;margin-bottom:16px;">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
            <span style="font-size:15px;">🌐</span>
            <span style="font-weight:600;font-size:14px;color:#0369a1;">IP de este Gateway</span>
            <span id="ipHostname" style="font-size:12px;color:#64748b;margin-left:auto;"></span>
          </div>
          <div id="ipList" style="display:flex;flex-direction:column;gap:6px;">
            <div style="color:#94a3b8;font-size:13px;">Cargando...</div>
          </div>
        </div>

        <div class="btn-group">
          <button class="btn btn-primary" onclick="runNetworkDiagnostic()" id="btnNetDiag">🔍 Ejecutar Diagnóstico</button>
        </div>
        <div id="netDiagResult" style="margin-top:12px;"></div>
      </div>
    </div>

    <!-- Update Gateway -->
    <div class="card">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
        <div>
          <h2>🔄 Actualizar Gateway</h2>
          <p style="font-size:0.85rem; color:#94a3b8; margin:0;">Descargar la última imagen Docker y recrear el contenedor</p>
        </div>
        <div style="display:flex; gap:8px; align-items:center;">
          <button class="btn btn-primary" onclick="updateGateway()" id="btnUpdate">🔄 Actualizar</button>
        </div>
      </div>
      <div id="updateResult" style="margin-top:12px;"></div>
    </div>

    <!-- Actions -->
    <div class="btn-group">
      <button class="btn btn-primary" onclick="saveConfig()">💾 Guardar Configuracion</button>
      <button class="btn btn-outline" onclick="downloadEnv()">📥 Descargar .env</button>
    </div>
    <div id="envStatus" class="alert alert-success" style="display:none; margin-top: 12px;"></div>
    <div class="alert alert-info" style="margin-top: 12px;">
      💡 Al guardar, se actualiza <code>data/gateway-config.json</code> y el archivo <code>.env</code> automaticamente. Reinicie el Gateway para aplicar cambios de seguridad.
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

    var _diagIdCounter = 0;
    function renderDiagnostic(diag, extraHtml) {
      if (!diag) return '<div class="test-result" style="background:#fee2e2;">\\u274C Error desconocido — sin datos de diagnóstico</div>';
      var id = 'diag_' + (++_diagIdCounter);
      var sev = diag.severity || 'error';
      var icon = sev === 'critical' ? '\\u{1F6A8}' : sev === 'error' ? '\\u274C' : sev === 'warning' ? '\\u26A0\\uFE0F' : '\\u2705';
      var html = '<div class="diag-box">';
      html += '<div class="diag-header ' + sev + '">';
      html += '<span class="diag-code">' + (diag.code || 'GW-ERR') + '</span>';
      html += '<span class="diag-title">' + icon + ' ' + (diag.title || 'Error') + '</span>';
      html += '</div>';
      html += '<div class="diag-body">';
      html += '<div class="diag-detail">' + (diag.detail || '') + '</div>';
      if (extraHtml) html += extraHtml;
      if (diag.causes && diag.causes.length > 0) {
        html += '<div class="diag-section causes"><div class="diag-section-title">\\uD83D\\uDD0D Posibles Causas</div><ul>';
        for (var i = 0; i < diag.causes.length; i++) html += '<li>' + diag.causes[i] + '</li>';
        html += '</ul></div>';
      }
      if (diag.fixes && diag.fixes.length > 0) {
        html += '<div class="diag-section fixes"><div class="diag-section-title">\\uD83D\\uDEE0\\uFE0F Soluciones Recomendadas</div><ol>';
        for (var i = 0; i < diag.fixes.length; i++) html += '<li>' + diag.fixes[i] + '</li>';
        html += '</ol></div>';
      }
      if (diag.technical) {
        var techId = id + '_tech';
        html += '<div class="diag-tech-toggle" onclick="toggleTechDetails(\\'' + techId + '\\')">';
        html += '\\u25B6 Detalles T\\u00E9cnicos (click para expandir)';
        html += '</div>';
        html += '<div id="' + techId + '" class="diag-tech-content">';
        html += '<div class="diag-tech">';
        var keys = Object.keys(diag.technical);
        for (var i = 0; i < keys.length; i++) {
          html += keys[i] + ': ' + diag.technical[keys[i]] + '\\n';
        }
        html += '</div>';
        html += '<button class="diag-copy" onclick="copyDiagnostic(\\'' + id + '\\')">\\uD83D\\uDCCB Copiar Diagn\\u00F3stico</button>';
        html += '</div>';
      }
      html += '</div></div>';
      html += '<input type="hidden" id="' + id + '_data" value="' + btoa(unescape(encodeURIComponent(JSON.stringify(diag)))) + '">';
      return html;
    }

    function toggleTechDetails(id) {
      var el = document.getElementById(id);
      if (el) {
        el.classList.toggle('open');
        var toggle = el.previousElementSibling;
        if (toggle) toggle.innerHTML = el.classList.contains('open') ? '\\u25BC Detalles T\\u00E9cnicos (click para colapsar)' : '\\u25B6 Detalles T\\u00E9cnicos (click para expandir)';
      }
    }

    function copyDiagnostic(id) {
      var dataEl = document.getElementById(id + '_data');
      if (!dataEl) return;
      try {
        var diag = JSON.parse(decodeURIComponent(escape(atob(dataEl.value))));
        var text = '=== ANDEX Gateway - Diagn\\u00F3stico ===\\n';
        text += 'C\\u00F3digo: ' + diag.code + '\\n';
        text += 'Severidad: ' + diag.severity + '\\n';
        text += 'T\\u00EDtulo: ' + diag.title + '\\n';
        text += 'Detalle: ' + diag.detail + '\\n';
        if (diag.causes) text += 'Causas: ' + diag.causes.join('; ') + '\\n';
        if (diag.fixes) text += 'Soluciones: ' + diag.fixes.join('; ') + '\\n';
        if (diag.technical) {
          text += '--- T\\u00E9cnico ---\\n';
          Object.keys(diag.technical).forEach(function(k) { text += k + ': ' + diag.technical[k] + '\\n'; });
        }
        navigator.clipboard.writeText(text).then(function() {
          showStatus('Diagn\\u00F3stico copiado al portapapeles', 'success');
        });
      } catch(e) { showStatus('Error al copiar: ' + e.message, 'error'); }
    }

    async function lookupCentro() {
      var centroId = document.getElementById('centroId').value.trim();
      var resultDiv = document.getElementById('centroLookupResult');
      var detailsDiv = document.getElementById('centroDetails');
      if (!centroId) {
        resultDiv.innerHTML = '<div class="alert alert-error" style="margin-top:8px;">Ingrese un ID de Centro (UUID) para verificar.</div>';
        detailsDiv.style.display = 'none';
        return;
      }
      var uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(centroId)) {
        resultDiv.innerHTML = '<div class="alert alert-error" style="margin-top:8px;">\\u274C El ID debe ser un UUID v\\u00E1lido: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx</div>';
        detailsDiv.style.display = 'none';
        return;
      }
      resultDiv.innerHTML = '<div class="alert alert-info" style="margin-top:8px;">\\u23F3 Buscando centro en Supabase...</div>';
      try {
        var resp = await fetch('/api/config/lookup-centro', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ centroId: centroId }),
          credentials: 'include'
        });
        var result = await resp.json();
        if (result.success && result.centro) {
          var c = result.centro;
          document.getElementById('centroNombre').value = c.nombre;
          document.getElementById('centroNombre').classList.remove('needs-config');
          document.getElementById('centroNombre').classList.add('config-ok');
          document.getElementById('centroId').classList.remove('needs-config');
          document.getElementById('centroId').classList.add('config-ok');
          resultDiv.innerHTML = '<div class="alert alert-success" style="margin-top:8px;">\\u2705 Centro encontrado: <strong>' + c.nombre + '</strong>' + (c.activo ? '' : ' \\u26A0\\uFE0F (INACTIVO)') + '</div>';
          detailsDiv.style.display = 'block';
          document.getElementById('centroDir').textContent = c.direccion || '-';
          document.getElementById('centroTel').textContent = c.telefono || '-';
          document.getElementById('centroEmail').textContent = c.email || '-';
          document.getElementById('centroPlan').textContent = c.plan || '-';
          document.getElementById('centroEstado').textContent = c.subscriptionStatus || '-';
          document.getElementById('centroUnidad').textContent = c.subtituloUnidad || '-';
        } else {
          detailsDiv.style.display = 'none';
          var hint = result.hint ? '<br><small style="color:#6b7280;">' + result.hint + '</small>' : '';
          if (result.supabaseConfigured === false) {
            resultDiv.innerHTML = '<div class="alert alert-info" style="margin-top:8px;">\\u26A0\\uFE0F ' + result.error + hint + '<br><small>Puede ingresar el nombre del centro manualmente.</small></div>';
          } else {
            resultDiv.innerHTML = '<div class="alert alert-error" style="margin-top:8px;">\\u274C ' + result.error + hint + '</div>';
          }
        }
      } catch(e) {
        detailsDiv.style.display = 'none';
        resultDiv.innerHTML = '<div class="alert alert-error" style="margin-top:8px;">\\u274C Error de red: ' + e.message + '</div>';
      }
    }

    function togglePacsFields() {
      var pacsType = document.getElementById('pacsType').value;
      var isNative = pacsType === 'dicom-native';
      var isHttp = pacsType === 'orthanc' || pacsType === 'dicomweb';
      var isDicomweb = pacsType === 'dicomweb';
      
      // Show/hide main sections
      document.getElementById('httpSection').style.display = isHttp ? 'block' : 'none';
      document.getElementById('nativeSection').style.display = isNative ? 'block' : 'none';
      
      // DICOMweb endpoints only for dicomweb type
      document.getElementById('dicomwebEndpoints').style.display = isDicomweb ? 'block' : 'none';
      document.getElementById('btnTestStow').style.display = isDicomweb ? '' : 'none';
      
      // Update type description
      var desc = document.getElementById('pacsTypeDesc');
      var hint = document.getElementById('pacsTypeHint');
      if (pacsType === 'orthanc') {
        desc.innerHTML = '<strong>Orthanc REST API</strong> — Conexion HTTP directa al API REST de Orthanc. Los estudios se envian via <code>/instances</code> y se consultan via <code>/studies</code>.';
        hint.textContent = 'Ideal para Orthanc local o en red. Usa los endpoints REST nativos de Orthanc.';
      } else if (pacsType === 'dicomweb') {
        desc.innerHTML = '<strong>DICOMweb</strong> — Protocolo estandar (STOW-RS, QIDO-RS, WADO-RS). Compatible con DCM4CHEE, Google Cloud Healthcare, Azure DICOM, Horos, y otros.';
        hint.textContent = 'Compatible con cualquier PACS que soporte DICOMweb (IHE standard).';
      } else {
        desc.innerHTML = '<strong>DICOM Nativo TCP</strong> — Conexion directa TCP usando C-STORE, C-ECHO y C-FIND. Compatible con Synapse, DCM4CHEE, Conquest, Horos, y PACS legacy.';
        hint.textContent = 'Para PACS que no tienen interfaz HTTP/DICOMweb o cuando se requiere protocolo DICOM puro.';
      }
      
      // URL hint changes per type
      var urlHint = document.getElementById('pacsUrlHint');
      if (urlHint) {
        urlHint.textContent = pacsType === 'orthanc' 
          ? 'URL de Orthanc (ej: http://localhost:8042)' 
          : 'URL base del servidor DICOMweb (ej: https://pacs.hospital.cl/dicomweb)';
      }
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
        worklistDefaultModality: document.getElementById('worklistDefaultModality').value,
        worklistStationAET: document.getElementById('worklistStationAET').value,
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
      resultDiv.innerHTML = '<div class="test-result">\\u23F3 Probando conexion PACS...</div>';
      try {
        await saveConfig();
        var resp = await fetch('/api/config/test-pacs', { method: 'POST', credentials: 'include' });
        var result = await resp.json();
        if (result.diagnostic) {
          var extra = '';
          if (result.success && result.serverInfo) extra = '<div style="margin:6px 0;color:#166534;font-weight:600;">\\uD83C\\uDFE5 ' + result.serverInfo + '</div>';
          if (result.success && result.endpoint) extra += '<div style="margin:4px 0;color:#6b7280;font-size:12px;">Endpoint: ' + result.endpoint + ' | Latencia: ' + (result.latency || '-') + 'ms</div>';
          resultDiv.innerHTML = renderDiagnostic(result.diagnostic, extra);
        } else if (result.success) {
          resultDiv.innerHTML = '<div class="test-result" style="background:#dcfce7;">' + result.message + '</div>';
        } else {
          resultDiv.innerHTML = '<div class="test-result" style="background:#fee2e2;">\\u274C ' + (result.error || 'Error desconocido') + '</div>';
        }
      } catch (e) {
        var errDiag = { code: 'GW-LOCAL-001', severity: 'critical', title: 'Error de Red Local', detail: 'No se pudo conectar al Gateway desde el navegador: ' + e.message, causes: ['El Gateway no est\\u00E1 corriendo', 'El navegador no puede alcanzar el servidor local', 'Problema de red entre navegador y Gateway'], fixes: ['Verifique que el Gateway est\\u00E9 ejecut\\u00E1ndose (terminal)', 'Recargue la p\\u00E1gina e intente nuevamente'], technical: { browserError: e.message, timestamp: new Date().toISOString() } };
        resultDiv.innerHTML = renderDiagnostic(errDiag);
      }
    }

    async function testStow() {
      var resultDiv = document.getElementById('testStowResult');
      resultDiv.innerHTML = '<div class="test-result">\\u23F3 Probando endpoint STOW...</div>';
      try {
        await saveConfig();
        var resp = await fetch('/api/config/test-stow', { method: 'POST', credentials: 'include' });
        var result = await resp.json();
        if (result.diagnostic) {
          var extra = '';
          if (result.success && result.endpoint) extra = '<div style="margin:4px 0;color:#6b7280;font-size:12px;">Endpoint: ' + result.endpoint + ' | STOW URL: ' + (result.stowUrl || '-') + ' | Latencia: ' + (result.latency || '-') + 'ms</div>';
          resultDiv.innerHTML = renderDiagnostic(result.diagnostic, extra);
        } else if (result.success) {
          resultDiv.innerHTML = '<div class="test-result" style="background:#dcfce7;">' + result.message + '</div>';
        } else {
          resultDiv.innerHTML = '<div class="test-result" style="background:#fee2e2;">\\u274C ' + (result.error || 'Error desconocido') + '</div>';
        }
      } catch (e) {
        var errDiag = { code: 'GW-LOCAL-001', severity: 'critical', title: 'Error de Red Local', detail: 'No se pudo conectar al Gateway: ' + e.message, causes: ['El Gateway no est\\u00E1 corriendo'], fixes: ['Verifique que el Gateway est\\u00E9 ejecut\\u00E1ndose'], technical: { browserError: e.message, timestamp: new Date().toISOString() } };
        resultDiv.innerHTML = renderDiagnostic(errDiag);
      }
    }

    async function testWorklist() {
      var resultDiv = document.getElementById('testWorklistResult');
      resultDiv.innerHTML = '<div class="test-result">\\u23F3 Probando Worklist...</div>';
      try {
        await saveConfig();
        var resp = await fetch('/api/config/test-worklist', { method: 'POST', credentials: 'include' });
        var result = await resp.json();
        if (result.diagnostic) {
          var extra = '';
          if (result.success && result.preview && result.preview.length > 0) {
            extra = '<div class="diag-section" style="margin-top:8px;"><div class="diag-section-title">\\uD83D\\uDCCB Primeros Items del Worklist</div><ul style="list-style:none;padding:0;">';
            for (var i = 0; i < result.preview.length; i++) {
              var item = result.preview[i];
              extra += '<li style="margin-bottom:4px;padding:4px 8px;background:#f0fdf4;border-radius:4px;font-size:12px;">\\u2022 ' + (item.patientName || 'Sin nombre') + ' — ' + (item.accessionNumber || 'Sin accession') + ' — ' + (item.modality || '') + ' — ' + (item.description || '') + '</li>';
            }
            extra += '</ul></div>';
          }
          if (result.success) extra += '<div style="margin:4px 0;color:#6b7280;font-size:12px;">Fuente: ' + (result.source || '-') + ' | Latencia: ' + (result.latency || '-') + '</div>';
          resultDiv.innerHTML = renderDiagnostic(result.diagnostic, extra);
        } else if (result.success) {
          resultDiv.innerHTML = '<div class="test-result" style="background:#dcfce7;">' + result.message + '</div>';
        } else {
          resultDiv.innerHTML = '<div class="test-result" style="background:#fee2e2;">\\u274C ' + (result.error || 'Error desconocido') + '</div>';
        }
      } catch (e) {
        var errDiag = { code: 'GW-LOCAL-001', severity: 'critical', title: 'Error de Red Local', detail: 'No se pudo conectar al Gateway: ' + e.message, causes: ['El Gateway no est\\u00E1 corriendo'], fixes: ['Verifique que el Gateway est\\u00E9 ejecut\\u00E1ndose'], technical: { browserError: e.message, timestamp: new Date().toISOString() } };
        resultDiv.innerHTML = renderDiagnostic(errDiag);
      }
    }

    async function testCEcho() {
      var resultDiv = document.getElementById('testCEchoResult');
      resultDiv.innerHTML = '<div class="test-result">\\u23F3 Probando conexion TCP al PACS...</div>';
      try {
        await saveConfig();
        var resp = await fetch('/api/config/test-cecho', { method: 'POST', credentials: 'include' });
        var result = await resp.json();
        if (result.diagnostic) {
          var extra = '';
          if (result.success && result.details) {
            var d = result.details;
            extra = '<div style="margin:6px 0;font-size:12px;color:#374151;"><strong>Conexi\\u00F3n:</strong> ' + (d.host || '-') + ':' + (d.port || '-') + ' | <strong>Gateway AET:</strong> ' + (d.callingAet || '-') + ' | <strong>PACS AET:</strong> ' + (d.calledAet || '-') + ' | <strong>Latencia:</strong> ' + (result.latency || '-') + 'ms</div>';
          }
          resultDiv.innerHTML = renderDiagnostic(result.diagnostic, extra);
        } else if (result.success) {
          resultDiv.innerHTML = '<div class="test-result" style="background:#dcfce7;">' + result.message + '</div>';
        } else {
          resultDiv.innerHTML = '<div class="test-result" style="background:#fee2e2;">\\u274C ' + (result.error || 'Error desconocido') + '</div>';
        }
      } catch (e) {
        var errDiag = { code: 'GW-LOCAL-001', severity: 'critical', title: 'Error de Red Local', detail: 'No se pudo conectar al Gateway: ' + e.message, causes: ['El Gateway no est\\u00E1 corriendo'], fixes: ['Verifique que el Gateway est\\u00E9 ejecut\\u00E1ndose'], technical: { browserError: e.message, timestamp: new Date().toISOString() } };
        resultDiv.innerHTML = renderDiagnostic(errDiag);
      }
    }

    async function downloadEnv() {
      try {
        var resp = await fetch('/api/config/download-env', { credentials: 'include' });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        var blob = await resp.blob();
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = '.env';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (e) {
        showStatus('Error descargando .env: ' + e.message, 'error');
      }
    }

    // ============================================
    // NETWORK DIAGNOSTIC
    // ============================================
    // Load IP info on page load
    (function loadIpInfo() {
      fetch('/api/config/ip-info', { credentials: 'include' })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          var hostname = document.getElementById('ipHostname');
          var list = document.getElementById('ipList');
          if (hostname) hostname.textContent = data.hostname || '';
          if (!list) return;
          if (!data.interfaces || data.interfaces.length === 0) {
            list.innerHTML = '<div style="color:#ef4444;font-size:13px;">⚠️ No se detectaron interfaces de red</div>';
            return;
          }
          var html = '';
          data.interfaces.forEach(function(iface, idx) {
            html += '<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:#fff;border:1px solid #e0f2fe;border-radius:6px;">';
            html += '<span style="font-weight:600;font-size:13px;min-width:70px;color:#475569;">' + iface.name + '</span>';
            html += '<code style="font-size:16px;font-weight:700;color:#0c4a6e;letter-spacing:0.5px;">' + iface.ip + '</code>';
            html += '<span style="font-size:11px;color:#94a3b8;">/' + iface.netmask + '</span>';
            html += '<button data-ip="' + iface.ip + '" onclick="copyIp(this.dataset.ip, this)" style="margin-left:auto;background:#0ea5e9;color:#fff;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;" title="Copiar IP">📋 Copiar</button>';
            html += '</div>';
          });
          list.innerHTML = html;
        })
        .catch(function() {
          var list = document.getElementById('ipList');
          if (list) list.innerHTML = '<div style="color:#94a3b8;font-size:13px;">No se pudo obtener la IP</div>';
        });
    })();

    function copyIp(ip, btn) {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(ip).then(function() {
          var orig = btn.innerHTML;
          btn.innerHTML = '✅ Copiado';
          btn.style.background = '#22c55e';
          setTimeout(function() { btn.innerHTML = orig; btn.style.background = '#0ea5e9'; }, 2000);
        });
      } else {
        var ta = document.createElement('textarea');
        ta.value = ip;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        var orig = btn.innerHTML;
        btn.innerHTML = '✅ Copiado';
        btn.style.background = '#22c55e';
        setTimeout(function() { btn.innerHTML = orig; btn.style.background = '#0ea5e9'; }, 2000);
      }
    }

    async function runNetworkDiagnostic() {
      var btn = document.getElementById('btnNetDiag');
      var resultDiv = document.getElementById('netDiagResult');
      btn.disabled = true;
      btn.textContent = '⏳ Diagnosticando...';
      resultDiv.innerHTML = '<div class="test-result" style="background:#eff6ff;border:1px solid #93c5fd;padding:12px;border-radius:8px;">⏳ Ejecutando diagnóstico de red completo...</div>';

      try {
        var resp = await fetch('/api/config/network-diagnostic', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' }
        });
        var data = await resp.json();

        var html = '';

        // Host info
        html += '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin-bottom:12px;">';
        html += '<div style="font-weight:600;font-size:14px;margin-bottom:8px;">🖥️ Equipo: ' + (data.hostname || '-') + '</div>';
        html += '<div style="font-size:12px;color:#64748b;">' + (data.platform || '') + '</div>';

        // Network interfaces
        if (data.interfaces && data.interfaces.length > 0) {
          html += '<div style="margin-top:8px;">';
          data.interfaces.forEach(function(iface) {
            html += '<div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:13px;">';
            html += '<span style="font-weight:500;min-width:60px;">' + iface.name + '</span>';
            html += '<code style="background:#e0f2fe;padding:2px 6px;border-radius:4px;font-size:12px;">' + iface.ip + '</code>';
            html += '<span style="color:#94a3b8;font-size:11px;">' + iface.netmask + '</span>';
            html += '</div>';
          });
          html += '</div>';
        } else {
          html += '<div style="color:#ef4444;font-size:12px;margin-top:4px;">⚠️ No se detectaron interfaces de red activas</div>';
        }
        html += '</div>';

        // Checks
        html += '<div style="display:flex;flex-direction:column;gap:6px;">';
        (data.checks || []).forEach(function(check) {
          var bg = check.status === 'pass' ? '#f0fdf4' : check.status === 'fail' ? '#fef2f2' : '#fffbeb';
          var border = check.status === 'pass' ? '#86efac' : check.status === 'fail' ? '#fca5a5' : '#fcd34d';
          html += '<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:' + bg + ';border:1px solid ' + border + ';border-radius:6px;">';
          html += '<span style="font-size:18px;">' + check.icon + '</span>';
          html += '<div style="flex:1;">';
          html += '<div style="font-weight:600;font-size:13px;">' + check.name + '</div>';
          html += '<div style="font-size:12px;color:#4b5563;">' + check.detail + '</div>';
          html += '<div style="font-size:11px;color:#9ca3af;">' + check.target + (check.latency ? ' — ' + check.latency + 'ms' : '') + '</div>';
          html += '</div>';
          html += '</div>';
        });
        html += '</div>';

        // Summary
        if (data.summary) {
          var sumBg = data.summary.allGood ? '#f0fdf4' : '#fef2f2';
          var sumBorder = data.summary.allGood ? '#22c55e' : '#ef4444';
          html += '<div style="margin-top:12px;padding:12px;background:' + sumBg + ';border:2px solid ' + sumBorder + ';border-radius:8px;text-align:center;font-weight:600;font-size:14px;">';
          html += data.summary.message;
          html += '</div>';
        }

        resultDiv.innerHTML = html;
      } catch (err) {
        resultDiv.innerHTML = '<div class="test-result" style="background:#fef2f2;border:1px solid #fca5a5;padding:12px;border-radius:8px;">❌ Error ejecutando diagnóstico: ' + err.message + '</div>';
      } finally {
        btn.disabled = false;
        btn.textContent = '🔍 Ejecutar Diagnóstico';
      }
    }

    async function updateGateway() {
      var btn = document.getElementById('btnUpdate');
      var resultDiv = document.getElementById('updateResult');
      btn.disabled = true;
      btn.textContent = '⏳ Descargando imagen...';
      resultDiv.innerHTML = '<div style="padding:8px;color:#94a3b8;">Ejecutando docker compose pull + up... esto puede tardar hasta 2 minutos.</div>';
      try {
        var resp = await fetch('/api/config/update-gateway', {
          method: 'POST',
          credentials: 'include'
        });
        var data = await resp.json();
        if (data.ok) {
          resultDiv.innerHTML = '<div class="test-result" style="background:#f0fdf4;border:1px solid #86efac;padding:12px;border-radius:8px;">'
            + '<div style="font-weight:700;margin-bottom:6px;">✅ ' + (data.message || 'Actualizado') + '</div>'
            + (data.pull && data.pull.stderr ? '<pre style="font-size:0.75rem;white-space:pre-wrap;color:#64748b;margin:6px 0;">' + data.pull.stderr + '</pre>' : '')
            + (data.up && data.up.stderr ? '<pre style="font-size:0.75rem;white-space:pre-wrap;color:#64748b;margin:6px 0;">' + data.up.stderr + '</pre>' : '')
            + '<div style="font-size:0.8rem;color:#64748b;margin-top:8px;">💡 Si el Gateway se recreó, esta página se desconectará brevemente. Recargue en unos segundos.</div>'
            + '</div>';
          setTimeout(function() { location.reload(); }, 8000);
        } else {
          resultDiv.innerHTML = '<div class="test-result" style="background:#fef2f2;border:1px solid #fca5a5;padding:12px;border-radius:8px;">'
            + '<div style="font-weight:700;margin-bottom:6px;">❌ ' + (data.error || 'Error') + '</div>'
            + (data.detail ? '<pre style="font-size:0.75rem;white-space:pre-wrap;color:#94a3b8;margin:6px 0;">' + data.detail + '</pre>' : '')
            + (data.manual ? '<div style="margin-top:8px;font-size:0.85rem;">📋 Comando manual: <code>' + data.manual + '</code></div>' : '')
            + '</div>';
        }
      } catch (err) {
        resultDiv.innerHTML = '<div class="test-result" style="background:#fffbeb;border:1px solid #fcd34d;padding:12px;border-radius:8px;">'
          + '<div style="font-weight:700;margin-bottom:6px;">🔄 Gateway se está reiniciando...</div>'
          + '<div style="font-size:0.85rem;color:#64748b;">La conexión se perdió, probablemente porque el contenedor se está recreando. Espere unos segundos y recargue la página.</div>'
          + '</div>';
        setTimeout(function() { location.reload(); }, 10000);
      } finally {
        btn.disabled = false;
        btn.textContent = '🔄 Actualizar';
      }
    }

    // Auto-refresh status every 30 seconds
    setInterval(function() {
      fetch('/api/config', { credentials: 'include' }).catch(function() {});
    }, 30000);

    // ============================================
    // DETECT UNCONFIGURED FIELDS (defaults → amber)
    // ============================================
    var DEFAULT_VALUES = {
      'centroNombre': ['Mi Centro Medico', ''],
      'centroId': ['CENTRO01', '', 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'],
      'apiKey': ['dev-api-key-cambiar', ''],
      'dashboardUser': ['admin'],
      'pacsUrl': ['http://localhost:8042', ''],
      'pacsDicomHost': ['', '192.168.1.100'],
      'pacsAeTitle': ['', 'SYNAPSE'],
    };

    function checkFieldConfig() {
      var total = 0;
      var configured = 0;
      
      Object.keys(DEFAULT_VALUES).forEach(function(fieldId) {
        var el = document.getElementById(fieldId);
        if (!el || el.offsetParent === null) return; // skip hidden fields
        
        total++;
        var val = el.value.trim();
        var defaults = DEFAULT_VALUES[fieldId];
        var isDefault = !val || defaults.indexOf(val) >= 0;
        
        var label = el.closest('.form-group')?.querySelector('label');
        
        if (isDefault) {
          el.classList.add('needs-config');
          el.classList.remove('config-ok');
          if (label) label.classList.add('needs-config-label');
          if (label) label.classList.remove('config-ok-label');
        } else {
          el.classList.remove('needs-config');
          el.classList.add('config-ok');
          if (label) label.classList.remove('needs-config-label');
          configured++;
        }
      });
      
      // Also check password field (special: placeholder-only)
      var dashPass = document.getElementById('dashboardPassword');
      if (dashPass) {
        total++; // count it
        // We can't read the actual stored password, so if it hasn't been changed in this session, mark it
      }
      
      // Show/hide banner
      var banner = document.getElementById('firstConfigBanner');
      var legend = document.getElementById('configLegend');
      var progress = document.getElementById('configProgress');
      var isFirstConfig = configured < (total * 0.5); // less than half configured = first time
      
      if (banner) banner.style.display = isFirstConfig ? 'flex' : 'none';
      if (legend) legend.style.display = total > 0 ? 'flex' : 'none';
      if (progress) progress.textContent = configured + ' de ' + total + ' campos configurados';
    }
    
    // Run on page load and after type changes
    checkFieldConfig();
    document.getElementById('pacsType')?.addEventListener('change', function() {
      setTimeout(checkFieldConfig, 100);
    });
    
    // Re-check after save
    var origSaveConfig = saveConfig;
    saveConfig = async function() {
      await origSaveConfig();
      setTimeout(checkFieldConfig, 500);
    };

  </script>
</body>
</html>`;
}
