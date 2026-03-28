# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Install openssl for self-signed cert generation
RUN apk add --no-cache openssl

# Install production dependencies only
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy built files from builder
COPY --from=builder /app/dist ./dist
COPY src/db/schema.sql ./dist/db/

# Create data and certs directories
RUN mkdir -p /app/data /app/certs

# Generate self-signed certificates
RUN openssl req -x509 -newkey rsa:2048 -nodes \
      -keyout /app/certs/localhost+2-key.pem \
      -out /app/certs/localhost+2.pem \
      -days 825 -subj "/CN=localhost/O=Andex Gateway" \
      -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1"

# Environment
ENV NODE_ENV=production
ENV PORT=3001
ENV HTTPS_PORT=3443
ENV DATA_DIR=/app/data

# Non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app
USER nodejs

EXPOSE 3001 3443

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget --spider -q http://localhost:3001/health || exit 1

CMD ["node", "dist/index.js"]
