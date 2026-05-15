#!/bin/bash
# ==============================================================
# CRM ISP DATAFAST — Deploy con zero-downtime
# Uso: bash scripts/deploy.sh
# ==============================================================

set -euo pipefail
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()  { echo -e "${GREEN}[$(date '+%H:%M:%S')]${NC} $1"; }
warn() { echo -e "${YELLOW}[$(date '+%H:%M:%S')]${NC} $1"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

log "Iniciando deploy CRM ISP DATAFAST..."

# Pull últimos cambios
log "Pull del repositorio..."
git pull origin main

# Build nuevas imágenes
log "Construyendo imágenes Docker..."
docker compose build --no-cache backend frontend

# Ejecutar migraciones de BD
log "Ejecutando migraciones de base de datos..."
docker compose run --rm backend npm run migration:run

# Reemplazar containers uno por uno (zero-downtime básico)
log "Actualizando backend..."
docker compose up -d --no-deps backend
sleep 10

# Verificar que backend arrancó correctamente
HEALTH=$(curl -sf http://localhost:3000/health 2>/dev/null | grep -o '"status":"ok"' || echo "fail")
if [[ "$HEALTH" == *"ok"* ]]; then
    log "Backend saludable"
else
    warn "Backend con problemas, revisando logs..."
    docker compose logs --tail=50 backend
    exit 1
fi

log "Actualizando frontend..."
docker compose up -d --no-deps frontend
sleep 10

log "Recargando Nginx..."
docker compose exec nginx nginx -s reload

# Limpiar imágenes antiguas
docker image prune -f --filter "dangling=true"

log "Deploy completado exitosamente"
docker compose ps
