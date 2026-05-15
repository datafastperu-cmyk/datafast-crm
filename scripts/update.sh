#!/usr/bin/env bash
# ==============================================================
# CRM ISP DATAFAST — Actualización del sistema
# Uso: bash scripts/update.sh  /  datafast update
# ==============================================================

set -euo pipefail

INSTALL_DIR="/opt/datafast"
LOG_DIR="${INSTALL_DIR}/logs"
LOG_FILE="${LOG_DIR}/update-$(date +%Y%m%d_%H%M%S).log"
VERSION_FILE="${INSTALL_DIR}/VERSION"

R='\033[0;31m'; G='\033[0;32m'; Y='\033[1;33m'
C='\033[0;36m'; W='\033[1;37m'; NC='\033[0m'

log()  { echo -e "${G}[$(date '+%H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"; }
warn() { echo -e "${Y}[$(date '+%H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"; }
err()  { echo -e "${R}[$(date '+%H:%M:%S')] ERROR:${NC} $1" | tee -a "$LOG_FILE"; exit 1; }
step() { echo -e "\n${W}━━━ $1${NC}" | tee -a "$LOG_FILE"; }

[[ $EUID -eq 0 ]] || err "Ejecuta como root: sudo datafast update"

mkdir -p "$LOG_DIR"

CURRENT_VERSION="$(cat "$VERSION_FILE" 2>/dev/null || echo '?')"
echo ""
echo -e "${C}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${C}║  CRM ISP DATAFAST — Actualizando sistema         ║${NC}"
echo -e "${C}║  Versión actual: ${W}v${CURRENT_VERSION}${C}                          ║${NC}"
echo -e "${C}╚══════════════════════════════════════════════════╝${NC}"
echo ""

# ── 1. Backup previo ──────────────────────────────────────────
step "Creando backup de seguridad"
if [[ -f "${INSTALL_DIR}/scripts/backup.sh" ]]; then
    bash "${INSTALL_DIR}/scripts/backup.sh" >> "$LOG_FILE" 2>&1 && log "Backup creado" || warn "Backup falló — continuando igual"
else
    warn "Script de backup no encontrado — omitiendo"
fi

# ── 2. Pull código fuente ─────────────────────────────────────
step "Descargando actualizaciones"
if [[ -d "${INSTALL_DIR}/.git" ]]; then
    git -C "${INSTALL_DIR}" fetch origin main >> "$LOG_FILE" 2>&1
    LOCAL=$(git -C "${INSTALL_DIR}" rev-parse HEAD)
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

# ── 3. Backend: dependencias + compilación ────────────────────
step "Reconstruyendo backend"
cd "${INSTALL_DIR}/backend"
npm install --production=false >> "$LOG_FILE" 2>&1
npm run build >> "$LOG_FILE" 2>&1
log "Backend compilado"

# ── 4. Frontend: dependencias + compilación ───────────────────
step "Reconstruyendo frontend"
cd "${INSTALL_DIR}/frontend"
npm install >> "$LOG_FILE" 2>&1
NODE_ENV=production npm run build >> "$LOG_FILE" 2>&1
log "Frontend compilado"

# ── 5. Migraciones de base de datos ───────────────────────────
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

# ── 6. Reload PM2 (zero-downtime) ────────────────────────────
step "Reiniciando servicios"
pm2 reload datafast-backend  >> "$LOG_FILE" 2>&1 || pm2 restart datafast-backend  >> "$LOG_FILE" 2>&1 || warn "PM2 backend no reiniciado"
pm2 restart datafast-frontend >> "$LOG_FILE" 2>&1 || warn "PM2 frontend no reiniciado"
log "Servicios reiniciados"

# ── 7. Resultado ───────────────────────────────────────────────
echo ""
echo -e "${G}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${G}║  ✅  Actualización completada exitosamente       ║${NC}"
echo -e "${G}║  v${CURRENT_VERSION}  →  v${NEW_VERSION}${G}                              ║${NC}"
echo -e "${G}╚══════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Log completo: ${LOG_FILE}"
echo ""
pm2 status
