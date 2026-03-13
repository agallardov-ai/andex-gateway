# Andex Gateway

Bridge service between **Andex Reports PWA** and **Orthanc/PACS**.

## 🎯 Purpose

Solves CORS and security issues when a web PWA needs to send DICOM files to a local Orthanc server in a hospital network.

## ⚡ Quick Start

```bash
# 1. Clone and configure
cp .env.example .env
# Edit .env with your settings

# 2. Start with Docker
docker-compose up -d

# 3. Access
# Dashboard: http://localhost:3001 (admin/admin123)
# Health: http://localhost:3001/health
# Orthanc: http://localhost:8042
```

## 🔌 API Endpoints

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `POST` | `/api/upload` | Upload DICOM file | API Key |
| `GET` | `/api/jobs` | List all jobs | API Key |
| `GET` | `/api/jobs/:id` | Get job details | API Key |
| `POST` | `/api/jobs/:id/retry` | Retry failed job | API Key |
| `DELETE` | `/api/jobs/:id` | Delete job | API Key |
| `GET` | `/health` | Health check | Public |
| `GET` | `/` | Dashboard UI | Basic Auth |

## 📤 Upload Example

```bash
curl -X POST http://localhost:3001/api/upload \
  -H "X-API-Key: your-api-key" \
  -F "file=@image.dcm"
```

## 🐳 Docker Compose

The default `docker-compose.yml` includes:
- **Andex Gateway** (port 3001)
- **Orthanc** (port 8042 HTTP, 4242 DICOM)

## ⚙️ Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3001 | Gateway port |
| `CENTRO_NOMBRE` | Mi Centro | Hospital name |
| `API_KEY` | - | Required for API auth |
| `ORTHANC_URL` | http://localhost:8042 | Orthanc server |
| `ALLOWED_ORIGINS` | https://andexreports.app | CORS origins |
| `RETRY_INTERVAL_MS` | 60000 | Retry queue interval |
| `MAX_RETRY_ATTEMPTS` | 5 | Max retries per job |

## 📊 Job Status Flow

```
pending → sending → sent
              ↓
           failed (retry up to 5 times)
```

## 🔒 Security

- API Key required for all `/api/*` endpoints
- Basic Auth for dashboard
- CORS restricted to configured origins
- Rate limiting (100 req/min)

## 🏥 Deployment

1. Install Docker on hospital server
2. Copy `docker-compose.yml` and `.env`
3. Configure `.env` with hospital settings
4. Run `docker-compose up -d`
5. Configure firewall to allow port 3001 from PWA origin

## 📁 Data Persistence

- SQLite database: `/app/data/gateway.db`
- Pending files: `/app/data/pending/`
- Orthanc storage: Docker volume `orthanc-data`

## 🔮 Future Features

- [ ] DICOM Worklist integration
- [ ] DICOM DIMSE (C-STORE)
- [ ] Multiple PACS routing
- [ ] Multi-site support
- [ ] Advanced audit logs
- [ ] HL7 FHIR integration
