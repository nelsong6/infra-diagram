# ── Stage 1: build the Vite + TypeScript frontend ─────────────────────────
FROM node:20-alpine AS frontend-builder

WORKDIR /build/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# ── Stage 2: runtime — Node + Express serves frontend/dist + /ci/* ────────
FROM node:20-alpine

WORKDIR /app

COPY backend/package*.json backend/
RUN cd backend && npm install --omit=dev

COPY --from=frontend-builder /build/frontend/dist frontend/dist
COPY backend/ backend/

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app
USER nodejs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

CMD ["node", "backend/server.js"]
