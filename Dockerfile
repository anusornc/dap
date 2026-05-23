# =============================================================================
# Stage 1: Builder - compile TypeScript
# =============================================================================
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY tsconfig.json ./
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# =============================================================================
# Stage 2: Runtime - minimal production image
# =============================================================================
FROM node:22-alpine AS runtime

# Build arguments with defaults
ARG PORT=3000
ARG TLS_PORT=3443

# Environment variables for runtime
ENV PORT=${PORT}
ENV TLS_PORT=${TLS_PORT}
ENV NODE_ENV=production

WORKDIR /app

# Install curl for healthcheck
RUN apk add --no-cache curl

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --omit=dev && \
    chown -R nodejs:nodejs /app

# Copy built application from builder stage
COPY --from=builder /app/dist/ ./dist/

# Switch to non-root user
USER nodejs

# Expose ports
EXPOSE ${PORT} ${TLS_PORT}

# Health check using curl
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -sf http://localhost:${PORT}/health || exit 1

# Start the relay server
CMD ["node", "dist/relay/server.js"]