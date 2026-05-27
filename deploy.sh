#!/usr/bin/env bash
# deploy.sh — script de deploy atómico con rollback, lint gate y healthchecks
# Uso: bash deploy.sh [--skip-frontend] [--skip-backend]
set -euo pipefail

REPO=/opt/datafast
FRONTEND=$REPO/frontend
BACKEND=$REPO/backend
NEXT_DIR=$FRONTEND/.next
NEXT_BACKUP=$FRONTEND/.next.bak
LOG_FILE=/opt/datafast/logs/deploy.log

mkdir -p /opt/datafast/logs

ts()   { date '+%Y-%m-%d %H:%M:%S'; }
log()  { echo "[$(ts)] [deploy] $*" | tee -a "$LOG_FILE"; }
fail() { echo "[$(ts)] [deploy][FAIL] $*" | tee -a "$LOG_FILE" >&2; exit 1; }

SKIP_FRONTEND=false
SKIP_BACKEND=false
for arg in "$@"; do
  [[ "$arg" == "--skip-frontend" ]] && SKIP_FRONTEND=true
  [[ "$arg" == "--skip-backend"  ]] && SKIP_BACKEND=true
done

log "=== Deploy iniciado (skip-frontend=$SKIP_FRONTEND, skip-backend=$SKIP_BACKEND) ==="

# ── 1. Pull ───────────────────────────────────────────────────────────────────
log "Pulling latest code..."
cd "$REPO"
git pull origin main

# ── 2. Backend ────────────────────────────────────────────────────────────────
if [[ "$SKIP_BACKEND" == false ]]; then
  log "Building backend..."
  cd "$BACKEND"
  npm run build

  log "Running migrations..."
  npx typeorm migration:run -d dist/config/datasource.js

  log "Restarting backend (datafast-backend)..."
  pm2 restart datafast-backend

  # Healthcheck: /v1/health/live con reintentos
  log "Healthcheck backend..."
  HEALTH_OK=false
  for i in 1 2 3 4 5; do
    sleep 3
    if curl -sf http://localhost:4000/v1/health/live > /dev/null 2>&1; then
      HEALTH_OK=true
      log "Backend saludable (intento $i)."
      break
    fi
    log "Backend no responde aún ($i/5)..."
  done
  [[ "$HEALTH_OK" == true ]] || fail "Backend healthcheck fallido tras 15s — revisar: pm2 logs datafast-backend"
fi

# ── 3. Frontend — build atómico con rollback ──────────────────────────────────
if [[ "$SKIP_FRONTEND" == false ]]; then
  cd "$FRONTEND"

  # Gate 1: ESLint (bloquea deploy si hay errores)
  log "Ejecutando ESLint..."
  if ! npm run lint 2>&1 | tee -a "$LOG_FILE"; then
    fail "ESLint falló — corrige los errores antes de desplegar."
  fi

  # Gate 2: TypeScript type-check (advertencia — ~60 errores legacy pendientes)
  log "Ejecutando TypeScript type-check (informativo)..."
  TS_ERRORS=$(npm run type-check 2>&1 | grep -c " error TS" || true)
  if [[ "$TS_ERRORS" -gt 0 ]]; then
    log "WARNING: $TS_ERRORS error(es) TypeScript detectados. Ejecuta 'npm run type-check' para verlos."
  else
    log "TypeScript: sin errores."
  fi

  # Respaldar build anterior
  if [[ -f "$NEXT_DIR/BUILD_ID" ]]; then
    rm -rf "$NEXT_BACKUP"
    cp -r "$NEXT_DIR" "$NEXT_BACKUP"
    log "Build anterior respaldado."
  fi

  # Build — si falla, restaurar y abortar
  log "Building frontend..."
  if ! npm run build 2>&1 | tee -a "$LOG_FILE"; then
    if [[ -d "$NEXT_BACKUP" ]]; then
      log "Build fallido — restaurando build anterior..."
      rm -rf "$NEXT_DIR"
      cp -r "$NEXT_BACKUP" "$NEXT_DIR"
      pm2 restart datafast-frontend
      log "Build anterior restaurado. Servidor mantenido activo."
    fi
    fail "Frontend build fallido — servidor restaurado, revisar errores arriba."
  fi

  # Verificar BUILD_ID
  if [[ ! -f "$NEXT_DIR/BUILD_ID" ]]; then
    fail "Build completado pero BUILD_ID ausente. Error inesperado en el build."
  fi

  rm -rf "$NEXT_BACKUP"
  log "Restarting frontend (datafast-frontend)..."
  pm2 restart datafast-frontend

  # Healthcheck frontend
  log "Healthcheck frontend..."
  HEALTH_OK=false
  for i in 1 2 3 4 5; do
    sleep 4
    HTTP_CODE=$(curl -so /dev/null -w "%{http_code}" http://localhost:3000 2>/dev/null || echo "000")
    if [[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "307" || "$HTTP_CODE" == "302" ]]; then
      HEALTH_OK=true
      log "Frontend saludable — HTTP $HTTP_CODE (intento $i)."
      break
    fi
    log "Frontend no responde aún — HTTP $HTTP_CODE ($i/5)..."
  done
  [[ "$HEALTH_OK" == true ]] || fail "Frontend healthcheck fallido tras 20s — revisar: pm2 logs datafast-frontend"
fi

log "=== Deploy completado exitosamente ==="
