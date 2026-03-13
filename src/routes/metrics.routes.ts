import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { 
  getPrometheusMetrics, 
  getMetricsJson, 
  getRecentLogs, 
  getActiveAlerts,
  checkAlerts,
  LogLevel 
} from '../services/observability.service.js';

export async function metricsRoutes(fastify: FastifyInstance): Promise<void> {
  
  // Prometheus metrics endpoint
  fastify.get('/metrics', async (_request: FastifyRequest, reply: FastifyReply) => {
    const metrics = getPrometheusMetrics();
    reply
      .header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
      .send(metrics);
  });

  // JSON metrics (for dashboard)
  fastify.get('/api/metrics', async (_request: FastifyRequest, reply: FastifyReply) => {
    return getMetricsJson();
  });

  // Recent logs
  fastify.get('/api/logs', async (request: FastifyRequest<{
    Querystring: { limit?: string; level?: string }
  }>, reply: FastifyReply) => {
    const limit = parseInt(request.query.limit || '100', 10);
    const level = request.query.level as LogLevel | undefined;
    
    return {
      logs: getRecentLogs(limit, level),
      count: getRecentLogs(limit, level).length,
    };
  });

  // Active alerts
  fastify.get('/api/alerts', async (_request: FastifyRequest, reply: FastifyReply) => {
    // Check for new alerts
    checkAlerts();
    
    return {
      alerts: getActiveAlerts(),
      count: getActiveAlerts().length,
    };
  });

  // Observability dashboard (HTML)
  fastify.get('/observability', async (_request: FastifyRequest, reply: FastifyReply) => {
    const metrics = getMetricsJson() as any;
    const alerts = getActiveAlerts();
    
    const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Andex Gateway - Observabilidad</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f172a; 
      color: #e2e8f0; 
      padding: 20px;
    }
    .header { 
      display: flex; 
      justify-content: space-between; 
      align-items: center;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid #334155;
    }
    h1 { font-size: 24px; color: #22d3ee; }
    .badge { 
      background: #22d3ee; 
      color: #0f172a; 
      padding: 4px 12px; 
      border-radius: 12px;
      font-size: 12px;
      font-weight: 600;
    }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; }
    .card { 
      background: #1e293b; 
      border-radius: 12px; 
      padding: 20px;
      border: 1px solid #334155;
    }
    .card h3 { 
      color: #94a3b8; 
      font-size: 12px; 
      text-transform: uppercase; 
      letter-spacing: 1px;
      margin-bottom: 12px;
    }
    .metric { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #334155; }
    .metric:last-child { border-bottom: none; }
    .metric-label { color: #94a3b8; }
    .metric-value { font-weight: 600; font-family: monospace; }
    .metric-value.success { color: #22c55e; }
    .metric-value.error { color: #ef4444; }
    .metric-value.warning { color: #f59e0b; }
    .metric-value.info { color: #22d3ee; }
    .big-number { font-size: 36px; font-weight: bold; color: #22d3ee; }
    .big-label { font-size: 14px; color: #94a3b8; margin-top: 4px; }
    .progress-bar { 
      height: 8px; 
      background: #334155; 
      border-radius: 4px; 
      overflow: hidden;
      margin-top: 8px;
    }
    .progress-fill { height: 100%; background: #22c55e; transition: width 0.3s; }
    .progress-fill.warning { background: #f59e0b; }
    .progress-fill.error { background: #ef4444; }
    .alert { 
      padding: 12px 16px; 
      border-radius: 8px; 
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .alert.warning { background: #78350f; border: 1px solid #f59e0b; }
    .alert.critical { background: #7f1d1d; border: 1px solid #ef4444; }
    .no-alerts { color: #22c55e; text-align: center; padding: 20px; }
    .logs-container { 
      max-height: 300px; 
      overflow-y: auto; 
      font-family: monospace;
      font-size: 12px;
    }
    .log-entry { padding: 4px 0; border-bottom: 1px solid #1e293b; }
    .log-debug { color: #94a3b8; }
    .log-info { color: #22d3ee; }
    .log-warn { color: #f59e0b; }
    .log-error { color: #ef4444; }
    .refresh-btn {
      background: #22d3ee;
      color: #0f172a;
      border: none;
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 600;
    }
    .refresh-btn:hover { background: #06b6d4; }
    .endpoints { font-family: monospace; font-size: 13px; }
    .endpoints a { color: #22d3ee; text-decoration: none; }
    .endpoints a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>📊 Andex Gateway - Observabilidad</h1>
      <p style="color: #94a3b8; margin-top: 4px;">${metrics.gateway.centroNombre} (${metrics.gateway.centro})</p>
    </div>
    <div>
      <span class="badge">${metrics.gateway.pacsType.toUpperCase()}</span>
      <button class="refresh-btn" onclick="location.reload()" style="margin-left: 12px;">⟳ Actualizar</button>
    </div>
  </div>

  <div class="grid">
    <!-- Uptime -->
    <div class="card">
      <h3>⏱️ Sistema</h3>
      <div class="big-number">${metrics.gateway.uptimeHuman}</div>
      <div class="big-label">Tiempo activo</div>
    </div>

    <!-- DICOM Stats -->
    <div class="card">
      <h3>📁 DICOM Uploads</h3>
      <div class="metric">
        <span class="metric-label">Total</span>
        <span class="metric-value">${metrics.dicom.uploads.total}</span>
      </div>
      <div class="metric">
        <span class="metric-label">Exitosos</span>
        <span class="metric-value success">${metrics.dicom.uploads.success}</span>
      </div>
      <div class="metric">
        <span class="metric-label">Fallidos</span>
        <span class="metric-value error">${metrics.dicom.uploads.failed}</span>
      </div>
      <div class="metric">
        <span class="metric-label">Tasa de éxito</span>
        <span class="metric-value ${parseFloat(metrics.dicom.uploads.successRate) > 80 ? 'success' : 'warning'}">${metrics.dicom.uploads.successRate}</span>
      </div>
      <div class="metric">
        <span class="metric-label">Datos procesados</span>
        <span class="metric-value info">${metrics.dicom.bytesProcessedHuman}</span>
      </div>
    </div>

    <!-- PACS Stats -->
    <div class="card">
      <h3>🏥 PACS Conexión</h3>
      <div class="metric">
        <span class="metric-label">Requests totales</span>
        <span class="metric-value">${metrics.pacs.requests.total}</span>
      </div>
      <div class="metric">
        <span class="metric-label">Exitosos</span>
        <span class="metric-value success">${metrics.pacs.requests.success}</span>
      </div>
      <div class="metric">
        <span class="metric-label">Fallidos</span>
        <span class="metric-value error">${metrics.pacs.requests.failed}</span>
      </div>
      <div class="metric">
        <span class="metric-label">Latencia promedio</span>
        <span class="metric-value info">${metrics.pacs.latency.avgHuman}</span>
      </div>
    </div>

    <!-- Queue Stats -->
    <div class="card">
      <h3>📋 Cola de Trabajos</h3>
      <div class="metric">
        <span class="metric-label">Pendientes</span>
        <span class="metric-value ${metrics.queue.pending > 10 ? 'warning' : ''}">${metrics.queue.pending}</span>
      </div>
      <div class="metric">
        <span class="metric-label">Enviando</span>
        <span class="metric-value info">${metrics.queue.sending}</span>
      </div>
      <div class="metric">
        <span class="metric-label">Enviados</span>
        <span class="metric-value success">${metrics.queue.sent}</span>
      </div>
      <div class="metric">
        <span class="metric-label">Fallidos</span>
        <span class="metric-value error">${metrics.queue.failed}</span>
      </div>
      <div class="metric">
        <span class="metric-label">Reintentos</span>
        <span class="metric-value">${metrics.queue.retries}</span>
      </div>
    </div>

    <!-- Alerts -->
    <div class="card">
      <h3>🚨 Alertas Activas</h3>
      ${alerts.length === 0 
        ? '<div class="no-alerts">✅ Sin alertas activas</div>'
        : alerts.map(a => `
          <div class="alert ${a.severity}">
            <span>${a.severity === 'critical' ? '🔴' : '🟡'}</span>
            <span>${a.message}</span>
          </div>
        `).join('')
      }
    </div>

    <!-- API Endpoints -->
    <div class="card">
      <h3>🔗 Endpoints de Métricas</h3>
      <div class="endpoints">
        <div class="metric">
          <span class="metric-label">Prometheus</span>
          <a href="/metrics" target="_blank">/metrics</a>
        </div>
        <div class="metric">
          <span class="metric-label">JSON</span>
          <a href="/api/metrics" target="_blank">/api/metrics</a>
        </div>
        <div class="metric">
          <span class="metric-label">Logs</span>
          <a href="/api/logs" target="_blank">/api/logs</a>
        </div>
        <div class="metric">
          <span class="metric-label">Alertas</span>
          <a href="/api/alerts" target="_blank">/api/alerts</a>
        </div>
      </div>
    </div>
  </div>

  <script>
    // Auto-refresh every 30 seconds
    setTimeout(() => location.reload(), 30000);
  </script>
</body>
</html>
    `;
    
    reply.type('text/html').send(html);
  });
}
