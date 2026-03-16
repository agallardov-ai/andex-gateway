import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config/env.js';
import { getJobs, getJobStats } from '../db/database.js';
import { checkOrthancHealth } from '../services/orthanc.service.js';
import { dashboardAuth } from '../plugins/auth.plugin.js';

export async function uiRoutes(fastify: FastifyInstance): Promise<void> {
  
  // Dashboard HTML
  fastify.get('/', {
    preHandler: dashboardAuth,
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const orthancStatus = await checkOrthancHealth();
      const stats = getJobStats();
      const recentJobs = getJobs({ limit: 20 });

      const html = generateDashboardHtml({
        centroNombre: config.centroNombre,
        orthancConnected: orthancStatus.ok,
        orthancUrl: config.orthancUrl,
        orthancVersion: orthancStatus.version,
        stats,
        jobs: recentJobs,
        httpPort: config.port,
        httpsPort: parseInt(process.env.HTTPS_PORT || '3443', 10),
        apiKey: config.apiKey,
      });

      return reply.type('text/html').send(html);
    }
  });

  // Dashboard API (for AJAX refresh)
  fastify.get('/dashboard/data', {
    preHandler: dashboardAuth,
    handler: async (_request: FastifyRequest, reply: FastifyReply) => {
      const orthancStatus = await checkOrthancHealth();
      const stats = getJobStats();
      const recentJobs = getJobs({ limit: 20 });

      return reply.send({
        orthancConnected: orthancStatus.ok,
        stats,
        jobs: recentJobs,
        httpPort: config.port,
        httpsPort: parseInt(process.env.HTTPS_PORT || '3443', 10),
        apiKey: config.apiKey,
      });
    }
  });
}

interface DashboardData {
  centroNombre: string;
  orthancConnected: boolean;
  orthancUrl: string;
  orthancVersion?: string;
  httpPort: number;
  httpsPort: number;
  apiKey: string;
  httpPort: number;
  httpsPort: number;
  apiKey: string;
  stats: { total: number; pending: number; sending: number; sent: number; failed: number; cancelled: number };
  jobs: Array<{
    id: string;
    filename: string;
    patient_name: string | null;
    status: string;
    attempts: number;
    max_attempts: number;
    created_at: string;
    error_message: string | null;
  }>;
}

function generateDashboardHtml(data: DashboardData): string {
  const statusIcon = (status: string) => {
    switch (status) {
      case 'sent': return '✅';
      case 'pending': return '⏳';
      case 'sending': return '📤';
      case 'failed': return '❌';
      case 'cancelled': return '🚫';
      default: return '❓';
    }
  };

  const statusColor = (status: string) => {
    switch (status) {
      case 'sent': return '#22c55e';
      case 'pending': return '#f59e0b';
      case 'sending': return '#3b82f6';
      case 'failed': return '#ef4444';
      case 'cancelled': return '#6b7280';
      default: return '#6b7280';
    }
  };

  const timeAgo = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) return `${diffDays}d`;
    if (diffHours > 0) return `${diffHours}h`;
    if (diffMins > 0) return `${diffMins}m`;
    return 'ahora';
  };

  const jobRows = data.jobs.map(job => `
    <tr>
      <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-family: monospace; font-size: 12px;">${job.id.substring(0, 8)}...</td>
      <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${job.patient_name || job.filename}</td>
      <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">
        <span style="color: ${statusColor(job.status)}; font-weight: 600;">${statusIcon(job.status)} ${job.status}</span>
      </td>
      <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${job.attempts}/${job.max_attempts}</td>
      <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${timeAgo(job.created_at)}</td>
      <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">
        ${job.status === 'failed' || job.status === 'pending' ? 
          `<button onclick="retryJob('${job.id}')" style="padding: 4px 8px; background: #3b82f6; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">Retry</button>` : 
          ''
        }
      </td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Andex Gateway - ${data.centroNombre}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f3f4f6; color: #1f2937; }
    .header { background: linear-gradient(135deg, #4f46e5, #7c3aed); color: white; padding: 20px; }
    .header h1 { font-size: 24px; margin-bottom: 4px; }
    .header p { opacity: 0.9; font-size: 14px; }
    .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
    .status-bar { display: flex; gap: 20px; margin-bottom: 20px; }
    .status-item { display: flex; align-items: center; gap: 8px; font-size: 14px; }
    .status-dot { width: 10px; height: 10px; border-radius: 50%; }
    .status-dot.ok { background: #22c55e; }
    .status-dot.error { background: #ef4444; }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .stat-card { background: white; padding: 20px; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); text-align: center; }
    .stat-value { font-size: 36px; font-weight: 700; }
    .stat-label { font-size: 12px; color: #6b7280; text-transform: uppercase; margin-top: 4px; }
    .stat-card.pending .stat-value { color: #f59e0b; }
    .stat-card.sending .stat-value { color: #3b82f6; }
    .stat-card.sent .stat-value { color: #22c55e; }
    .stat-card.failed .stat-value { color: #ef4444; }
    .card { background: white; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); overflow: hidden; }
    .card-header { padding: 16px 20px; border-bottom: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: center; }
    .card-header h2 { font-size: 16px; font-weight: 600; }
    .btn { padding: 8px 16px; border-radius: 6px; border: none; cursor: pointer; font-size: 13px; font-weight: 500; }
    .btn-primary { background: #4f46e5; color: white; }
    .btn-primary:hover { background: #4338ca; }
    .btn-config { background: rgba(255,255,255,0.2); color: white; text-decoration: none; padding: 10px 20px; }
    .btn-config:hover { background: rgba(255,255,255,0.3); }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th { text-align: left; padding: 12px 8px; background: #f9fafb; font-weight: 600; font-size: 12px; text-transform: uppercase; color: #6b7280; }
    .config-section { margin-top: 24px; padding: 20px; background: white; border-radius: 12px; }
    .config-section h3 { font-size: 14px; font-weight: 600; margin-bottom: 12px; }
    .config-row { display: flex; gap: 8px; margin-bottom: 8px; font-size: 13px; }
    .config-label { color: #6b7280; min-width: 120px; }
    .config-value { font-family: monospace; }
  </style>
</head>
<body>
  <div class="header">
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <div>
        <h1>🏥 Andex Gateway</h1>
        <p>${data.centroNombre}</p>
      </div>
      <a href="/config" class="btn btn-config">⚙️ Configuración</a>
    </div>
  </div>
  
  <div class="container">
    <div class="status-bar">
      <div class="status-item">
        <div class="status-dot ok"></div>
        <span>Gateway Online</span>
      </div>
      <div class="status-item">
        <div class="status-dot ${data.orthancConnected ? 'ok' : 'error'}"></div>
        <span>Orthanc ${data.orthancConnected ? 'Conectado' : 'Desconectado'}${data.orthancVersion ? ` (v${data.orthancVersion})` : ''}</span>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-card pending">
        <div class="stat-value">${data.stats.pending}</div>
        <div class="stat-label">Pendientes</div>
      </div>
      <div class="stat-card sending">
        <div class="stat-value">${data.stats.sending}</div>
        <div class="stat-label">Enviando</div>
      </div>
      <div class="stat-card sent">
        <div class="stat-value">${data.stats.sent}</div>
        <div class="stat-label">Enviados</div>
      </div>
      <div class="stat-card failed">
        <div class="stat-value">${data.stats.failed}</div>
        <div class="stat-label">Fallidos</div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <h2>📋 Últimos trabajos</h2>
        <button class="btn btn-primary" onclick="location.reload()">🔄 Refresh</button>
      </div>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Paciente / Archivo</th>
            <th>Estado</th>
            <th>Intentos</th>
            <th>Tiempo</th>
            <th>Acción</th>
          </tr>
        </thead>
        <tbody>
          ${jobRows || '<tr><td colspan="6" style="padding: 20px; text-align: center; color: #6b7280;">No hay trabajos</td></tr>'}
        </tbody>
      </table>
    </div>

    <div class="config-section">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <h3 style="margin: 0;">🔧 Conexión Gateway</h3>
        <a href="/config" class="btn btn-primary" style="text-decoration: none;">⚙️ Editar</a>
      </div>
      <div class="config-row" style="align-items: center;">
        <span class="config-label">🌐 HTTP:</span>
        <span class="config-value">http://localhost:${data.httpPort}</span>
        <button onclick="copyText('http://localhost:${data.httpPort}')" style="margin-left:8px;padding:2px 10px;font-size:11px;background:#e5e7eb;border:none;border-radius:4px;cursor:pointer;">📋 Copiar</button>
      </div>
      <div class="config-row" style="align-items: center;">
        <span class="config-label">🔒 HTTPS:</span>
        <span class="config-value" style="color:#22c55e;font-weight:600;">https://localhost:${data.httpsPort}</span>
        <button onclick="copyText('https://localhost:${data.httpsPort}')" style="margin-left:8px;padding:2px 10px;font-size:11px;background:#e5e7eb;border:none;border-radius:4px;cursor:pointer;">📋 Copiar</button>
        <span style="margin-left:8px;font-size:11px;color:#6b7280;background:#f0fdf4;padding:2px 8px;border-radius:4px;">← usar en PWA</span>
      </div>
      <div class="config-row" style="align-items: center;">
        <span class="config-label">🏥 PACS:</span>
        <span class="config-value">${data.orthancUrl}</span>
      </div>
      <div class="config-row" style="align-items: center;">
        <span class="config-label">🔑 API Key:</span>
        <span class="config-value" id="api-key-display">${data.apiKey.substring(0, 4)}${'*'.repeat(Math.max(0, data.apiKey.length - 4))}</span>
        <button onclick="toggleApiKey()" id="toggle-btn" style="margin-left:8px;padding:2px 10px;font-size:11px;background:#e5e7eb;border:none;border-radius:4px;cursor:pointer;">👁️ Mostrar</button>
        <button onclick="copyText(document.getElementById('api-key-full').textContent)" style="margin-left:4px;padding:2px 10px;font-size:11px;background:#e5e7eb;border:none;border-radius:4px;cursor:pointer;">📋 Copiar</button>
        <span id="api-key-full" style="display:none">${data.apiKey}</span>
      </div>
    </div>
  </div>

  <script>
    async function retryJob(id) {
      try {
        const resp = await fetch('/api/jobs/' + id + '/retry', { 
          method: 'POST',
          headers: { 'X-API-Key': prompt('Ingrese API Key para reintentar:') }
        });
        if (resp.ok) {
          location.reload();
        } else {
          alert('Error al reintentar');
        }
      } catch (e) {
        alert('Error: ' + e.message);
      }
    }

    function toggleApiKey() {
      var display = document.getElementById('api-key-display');
      var full = document.getElementById('api-key-full');
      var btn = document.getElementById('toggle-btn');
      if (display.dataset.visible === 'true') {
        display.textContent = full.textContent.substring(0, 4) + '*'.repeat(full.textContent.length - 4);
        display.dataset.visible = 'false';
        btn.textContent = '👁️ Mostrar';
      } else {
        display.textContent = full.textContent;
        display.dataset.visible = 'true';
        btn.textContent = '🙈 Ocultar';
      }
    }

    function copyText(text) {
      navigator.clipboard.writeText(text).then(function() {
        var btn = event.target;
        var orig = btn.textContent;
        btn.textContent = '✅ Copiado!';
        setTimeout(function() { btn.textContent = orig; }, 1500);
      }).catch(function() {
        var ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      });
    }

    // Auto-refresh every 30 seconds
    setTimeout(() => location.reload(), 30000);
  </script>
</body>
</html>`;
}
