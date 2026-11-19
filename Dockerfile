# ==========================================
# STAGE 1: Production dependency install
# ==========================================
FROM node:20-alpine AS deps

WORKDIR /app

COPY package*.json ./
# Install only production dependencies (no jest/nodemon/supertest in the image)
RUN npm ci --omit=dev

# ==========================================
# STAGE 2: Production Runtime
# ==========================================
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY server.js ./server.js
COPY src ./src
COPY public ./public

# Writable location for STORAGE_DRIVER=local's JSON file; mount a volume here
# to persist it across container restarts.
RUN mkdir -p /app/data && chown -R node:node /app/data

# Security: run as the built-in non-privileged "node" user
USER node

EXPOSE 3000
# 127.0.0.1 (not "localhost"): on Alpine, localhost can resolve to ::1 while the server listens on IPv4 only.

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:${PORT:-3000}/health || exit 1

CMD ["node", "server.js"]
