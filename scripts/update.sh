#!/usr/bin/env bash
# ==============================================================
# CRM ISP DATAFAST — Actualización del sistema
# Uso: bash scripts/update.sh  /  datafast update
# ==============================================================

set -euo pipefail

INSTALL_DIR="/opt/datafast"
ECOSYSTEM="${INSTALL_DIR}/ecosystem.config.js"
LOG_DIR="${INSTALL_DIR}/logs"
LOG_FILE="${LOG_DIR}/update-$(date +%Y%m%d_%H%M%S).log"
VERSION_FILE="${INSTALL_DIR}/VERSION"

R='\033[0;31m'; G='\033[0;32m'; Y='\033[1;33m'
C='\033[0;36m'; W='\033[1;37m'; NC='\033[0m'

log()  { echo -e "${G}[$(date '+%H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"; }
warn() { echo -e "${Y}[$(date '+%H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"; }
err()  { echo -e "${R}[$(date '+%H:%M:%S')] ERROR:${NC} $1" | tee -a "$LOG_FILE"; exit 1; }
step() { echo -e "\n${W}━━━ $1${NC}" | tee -a "$LOG_FILE"; }

[[ $EUID -eq 0 ]] || err "Ejecuta como root: sudo bash scripts/update.sh"

mkdir -p "$LOG_DIR"

# ── Función: esperar que un puerto quede libre ────────────────────────────────
# Uso: wait_port_free <puerto> [timeout_segundos=20]
# Espera hasta que `fuser` no detecte nada en <puerto>/tcp.
# Si el timeout se cumple, fuerza kill con fuser -k y espera 2 s más.
wait_port_free() {
  local port="$1"
  local timeout="${2:-20}"
  local elapsed=0

  while fuser "${port}/tcp" >/dev/null 2>&1; do
    if (( elapsed >= timeout )); then
      warn "Puerto ${port} ocupado tras ${timeout}s — forzando liberación..."
      fuser -k "${port}/tcp" 2>/dev/null || true
      sleep 2
      return
    fi
    sleep 1
    (( elapsed++ ))
  done

  log "Puerto ${port} liberado (${elapsed}s)"
}

CURRENT_VERSION="$(cat "$VERSION_FILE" 2>/dev/null || echo '?')"
echo ""
echo -e "${C}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${C}║  CRM ISP DATAFAST — Actualizando sistema         ║${NC}"
echo -e "${C}║  Versión actual: ${W}v${CURRENT_VERSION}${C}                          ║${NC}"
echo -e "${C}╚══════════════════════════════════════════════════╝${NC}"
echo ""

# ── 1. Backup previo ──────────────────────────────────────────────────────────
step "Creando backup de seguridad"
if [[ -f "${INSTALL_DIR}/scripts/backup.sh" ]]; then
    bash "${INSTALL_DIR}/scripts/backup.sh" >> "$LOG_FILE" 2>&1 \
        && log "Backup creado" \
        || warn "Backup falló — continuando igual"
else
    warn "Script de backup no encontrado — omitiendo"
fi

# ── 2. Pull código fuente ──────────────────────────────────────────────────────
step "Descargando actualizaciones"
if [[ -d "${INSTALL_DIR}/.git" ]]; then
    git -C "${INSTALL_DIR}" fetch origin main >> "$LOG_FILE" 2>&1
    LOCAL=$(git  -C "${INSTALL_DIR}" rev-parse HEAD)
    REMOTE=$(git -C "${INSTALL_DIR}" rev-parse origin/main)
    if [[ "$LOCAL" == "$REMOTE" ]]; then
        log "Ya estás en la versión más reciente."
        exit 0
    fi
    git -C "${INSTALL_DIR}" pull origin main >> "$LOG_FILE" 2>&1
    log "Código actualizado"
else
    err "El directorio ${INSTALL_DIR} no es un repositorio git. Reinstala el sistema."
fi

NEW_VERSION="$(cat "$VERSION_FILE" 2>/dev/null || echo '?')"

# ── 3. Backend: dependencias + compilación ────────────────────────────────────
step "Reconstruyendo backend"
cd "${INSTALL_DIR}/backend"
npm install --production=false >> "$LOG_FILE" 2>&1
npm run build                  >> "$LOG_FILE" 2>&1
log "Backend compilado"

# ── 4. Frontend: dependencias + compilación ───────────────────────────────────
step "Reconstruyendo frontend"
cd "${INSTALL_DIR}/frontend"
npm install                           >> "$LOG_FILE" 2>&1
NODE_ENV=production npm run build     >> "$LOG_FILE" 2>&1
log "Frontend compilado"

# ── 5. Migraciones de base de datos ───────────────────────────────────────────
step "Ejecutando migraciones"
cd "${INSTALL_DIR}/backend"
set -a; source .env.production; set +a
for i in 1 2 3; do
    if npm run migration:run >> "$LOG_FILE" 2>&1; then
        log "Migraciones ejecutadas"; break
    fi
    warn "Intento ${i}/3 falló. Reintentando en 5s..."
    sleep 5
    [[ $i -eq 3 ]] && warn "Migraciones fallaron — verificar manualmente"
done

# ── 6. Reload backend (zero-downtime cluster) ─────────────────────────────────
step "Reload backend"
pm2 reload ecosystem.config.js --only datafast-backend >> "$LOG_FILE" 2>&1 \
    || pm2 restart datafast-backend                     >> "$LOG_FILE" 2>&1 \
    || warn "PM2 backend no reiniciado"
log "Backend recargado"

# ── 7. Reload frontend SIN colisión de puertos ────────────────────────────────
#
# Secuencia segura:
#   a) Detener proceso PM2 del frontend (señal SIGTERM → server.js cierra HTTP)
#   b) Esperar a que el puerto 3000 quede realmente libre (poll + fuser -k fallback)
#   c) Iniciar el proceso PM2 desde el ecosystem file
#   d) PM2 espera 'ready' (wait_ready:true) antes de declararlo online
#
step "Restart seguro del frontend"

log "Deteniendo datafast-frontend..."
pm2 stop datafast-frontend >> "$LOG_FILE" 2>&1 || true

log "Esperando que el puerto 3000 quede libre..."
wait_port_free 3000 20

# Verificar que el proceso está realmente en el ecosystem (puede que se haya creado
# manualmente con 'npm start' en lugar del ecosystem → lo eliminamos y recreamos)
if pm2 describe datafast-frontend 2>/dev/null | grep -q 'script.*npm'; then
    warn "El proceso frontend usaba 'npm start' en lugar de server.js — recreando..."
    pm2 delete datafast-frontend >> "$LOG_FILE" 2>&1 || true
fi

# Arrancar desde el ecosystem file (aplica kill_timeout, wait_ready, etc.)
pm2 start "${ECOSYSTEM}" --only datafast-frontend >> "$LOG_FILE" 2>&1
log "Frontend arrancado con ecosystem.config.js"

# Guardar estado PM2 para que sobreviva reboots
pm2 save >> "$LOG_FILE" 2>&1
log "Estado PM2 guardado"

# ── 8. Resultado ──────────────────────────────────────────────────────────────
echo ""
echo -e "${G}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${G}║  ✅  Actualización completada exitosamente       ║${NC}"
echo -e "${G}║  v${CURRENT_VERSION}  →  v${NEW_VERSION}                              ║${NC}"
echo -e "${G}╚══════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Log completo: ${LOG_FILE}"
echo ""
pm2 status
