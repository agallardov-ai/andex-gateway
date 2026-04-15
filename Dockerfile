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
# Install docker CLI for self-update via dashboard button
RUN apk add --no-cache openssl docker-cli docker-cli-compose

# Install production dependencies only
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy built files from builder
COPY --from=builder /app/dist ./dist
COPY src/db/schema.sql ./dist/db/

# Create data and certs directories
RUN mkdir -p /app/data /app/certs

# Certs are generated at first startup and persisted in the data volume
# No cert generation here -- they persist across image updates

# Environment
ENV NODE_ENV=production
ENV PORT=3001
ENV HTTPS_PORT=3443
ENV DATA_DIR=/app/data

# Non-root user for security — needs docker group for self-update
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

# Add nodejs user to docker group (created when socket is mounted)
# If docker group doesn't exist yet, create it with common GID
RUN addgroup -g 999 -S docker 2>/dev/null || true && \
    addgroup nodejs docker 2>/dev/null || true
USER nodejs

EXPOSE 3001 3443

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget --spider -q http://localhost:3001/health || exit 1

CMD ["node", "dist/index.js"]
