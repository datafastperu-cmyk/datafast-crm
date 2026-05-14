# ==============================================================
# FibraNet Backend — Dockerfile multi-stage (NestJS)
# ==============================================================

# ── Etapa 1: Dependencias ─────────────────────────────────────
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat python3 make g++
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production && cp -R node_modules /tmp/prod_modules
RUN npm ci
COPY . .

# ── Etapa 2: Build ────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ── Etapa 3: Desarrollo (hot-reload) ─────────────────────────
FROM node:20-alpine AS development
WORKDIR /app
RUN apk add --no-cache curl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["npm", "run", "start:dev"]

# ── Etapa 4: Producción ───────────────────────────────────────
FROM node:20-alpine AS production
WORKDIR /app

# Instalar curl para healthcheck
RUN apk add --no-cache curl tzdata

# Copiar solo lo necesario
COPY --from=builder /app/dist ./dist
COPY --from=deps /tmp/prod_modules ./node_modules
COPY package*.json ./

# Crear usuario no-root
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001 -G nodejs

# Crear directorios necesarios con permisos correctos
RUN mkdir -p /app/uploads /app/logs && \
    chown -R nestjs:nodejs /app

USER nestjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

CMD ["node", "dist/main.js"]
