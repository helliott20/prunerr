# ============================================
# Prunerr - Multi-stage Docker Build
# ============================================

# Stage 1: Build the client application
FROM node:20-alpine AS client-builder

WORKDIR /app/client

# Copy client package files
COPY client/package*.json ./

# Install client dependencies
RUN npm install

# Copy client source code
COPY client/ ./

# Build the client
RUN npm run build

# ============================================
# Stage 2: Build the server application
FROM node:20-alpine AS server-builder

WORKDIR /app/server

# Install build dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

# Copy server package files
COPY server/package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm install

# Copy server source code
COPY server/ ./

# Build the server
RUN npm run build

# ============================================
# Stage 3: Production image
FROM node:20-alpine AS production

# Build argument for version (passed from CI/CD)
ARG APP_VERSION=1.0.0

# Labels for container metadata
LABEL org.opencontainers.image.title="Prunerr"
LABEL org.opencontainers.image.description="Media library cleanup tool for Plex/Sonarr/Radarr"
LABEL org.opencontainers.image.version="${APP_VERSION}"
LABEL org.opencontainers.image.vendor="Prunerr"
LABEL org.opencontainers.image.source="https://github.com/helliott20/prunerr"
LABEL org.opencontainers.image.licenses="MIT"

# Install runtime dependencies for better-sqlite3 and su-exec for entrypoint
RUN apk add --no-cache python3 make g++ su-exec

WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 -S prunerr && \
    adduser -S prunerr -u 1001 -G prunerr

# Copy server package files
COPY server/package*.json ./

# Install production dependencies only
RUN npm install --omit=dev && \
    npm cache clean --force

# Remove build dependencies after npm install
RUN apk del python3 make g++

# Copy built server from server-builder stage
COPY --from=server-builder /app/server/dist ./dist

# Copy built client from client-builder stage to server's public directory
COPY --from=client-builder /app/client/dist ./public

# Create data directory for SQLite database
RUN mkdir -p /app/data && chown -R prunerr:prunerr /app/data

# Set ownership of the app directory
RUN chown -R prunerr:prunerr /app

# Copy entrypoint script
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Note: USER directive removed - entrypoint handles dynamic user switching with PUID/PGID

# Expose the application port
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/app/data
ENV APP_VERSION=${APP_VERSION}

# Health check (10s start-period allows for Node.js startup)
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

# Start via entrypoint (handles PUID/PGID user switching)
ENTRYPOINT ["/docker-entrypoint.sh"]
