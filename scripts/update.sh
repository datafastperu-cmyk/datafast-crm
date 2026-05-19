#!/usr/bin/env bash
# ==============================================================
# CRM ISP DATAFAST — Actualización del sistema
# Uso: bash scripts/update.sh  /  datafast update
# ==============================================================

set -euo pipefail

export PM2_HOME=/root/.pm2   # instancia única — nunca usar la de usuario datafast

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

# ── Liberar puerto: mata cualquier proceso (de cualquier usuario) que lo ocupe ──
# Usa ss para obtener PIDs directamente — funciona aunque el proceso sea de otro usuario.
kill_port() {
  local port="$1"
  local pids
  pids=$(ss -tlnp "sport = :${port}" 2>/dev/null \
         | { grep -oP 'pid=\K[0-9]+' || true; } | sort -u)
  if [[ -n "$pids" ]]; then
    warn "Puerto ${port} ocupado (PIDs: ${pids}) — matando..."
    echo "$pids" | xargs -r kill -9 2>/dev/null || true
    sleep 2
  fi
}

# ── Esperar que el puerto quede libre (con kill forzado como fallback) ───────────
wait_port_free() {
  local port="$1"
  local timeout="${2:-20}"
  local elapsed=0

  while ss -tlnp "sport = :${port}" 2>/dev/null | grep -q "LISTEN"; do
    if (( elapsed >= timeout )); then
      kill_port "${port}"
      sleep 1
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

# ── 0. Sanidad: asegurarse de que solo existe la instancia PM2 de root ───────────
step "Verificando instancia PM2"
if PM2_HOME=/home/datafast/.pm2 pm2 list 2>/dev/null | grep -q 'online'; then
  warn "Detectada instancia PM2 del usuario datafast — eliminando..."
  PM2_HOME=/home/datafast/.pm2 sudo -u datafast pm2 kill 2>/dev/null || true
  sleep 2
fi
log "Instancia PM2 única (root) verificada"

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
npm install >> "$LOG_FILE" 2>&1

# Build atómico: construir en .next.building → si tiene éxito → reemplazar .next
# Esto evita que un build interrumpido deje .next en estado corrupto
rm -rf .next.building 2>/dev/null || true
NEXT_DIST_DIR=".next.building" NODE_ENV=production npm run build >> "$LOG_FILE" 2>&1
# Build exitoso → swap atómico
rm -rf .next.old 2>/dev/null || true
[[ -d .next ]] && mv .next .next.old
mv .next.building .next
rm -rf .next.old 2>/dev/null || true
log "Frontend compilado (build atómico)"

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
pm2 reload "${ECOSYSTEM}" --only datafast-backend >> "$LOG_FILE" 2>&1 \
    || pm2 restart datafast-backend               >> "$LOG_FILE" 2>&1 \
    || warn "PM2 backend no reiniciado"
log "Backend recargado"

# ── 7. Restart frontend SIN colisión de puertos ───────────────────────────────
step "Restart seguro del frontend"

log "Deteniendo datafast-frontend..."
pm2 stop datafast-frontend >> "$LOG_FILE" 2>&1 || true

log "Liberando puerto 3000..."
wait_port_free 3000 15
# Segunda pasada: kill directo por si algo sobrevivió
kill_port 3000

# Verificar que el proceso usa server.js (no npm) — si no, recrear
if pm2 describe datafast-frontend 2>/dev/null | grep -q '"script".*"npm"'; then
    warn "Proceso frontend usaba npm start — recreando desde ecosystem..."
    pm2 delete datafast-frontend >> "$LOG_FILE" 2>&1 || true
fi

pm2 start "${ECOSYSTEM}" --only datafast-frontend >> "$LOG_FILE" 2>&1
log "Frontend arrancado con ecosystem.config.js"

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
