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

# ── Safety net: el frontend siempre queda corriendo al salir el script ───────────
# Esto se ejecuta sin importar si el script termina bien, mal, o con kill.
_ensure_frontend() {
  local status
  status=$(pm2 jlist 2>/dev/null | python3 -c "
import sys,json
procs=json.load(sys.stdin)
fe=[p for p in procs if p.get('name')=='datafast-frontend']
print(fe[0]['pm2_env']['status'] if fe else 'missing')
" 2>/dev/null || echo 'unknown')

  if [[ "$status" != "online" ]]; then
    warn "EXIT-TRAP: frontend no estaba online (estado: ${status}) — levantando..."
    pm2 start "${ECOSYSTEM}" --only datafast-frontend >> "$LOG_FILE" 2>&1 || true
    pm2 save >> "$LOG_FILE" 2>&1 || true
  fi
}
trap '_ensure_frontend' EXIT

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
NODE_OPTIONS='--max-old-space-size=1800' npm run build >> "$LOG_FILE" 2>&1
log "Backend compilado"

# ── 4. Frontend: dependencias + compilación ───────────────────────────────────
step "Reconstruyendo frontend"
cd "${INSTALL_DIR}/frontend"
npm install >> "$LOG_FILE" 2>&1

# Build atómico: build en .next.building → swap atómico → sin .next corrupto
rm -rf .next.building 2>/dev/null || true
NEXT_DIST_DIR=".next.building" NODE_ENV=production npm run build >> "$LOG_FILE" 2>&1
rm -rf .next.old 2>/dev/null || true
[[ -d .next ]] && mv .next .next.old
mv .next.building .next
rm -rf .next.old 2>/dev/null || true
log "Frontend compilado (build atómico)"

# ── 5. Migraciones de base de datos ───────────────────────────────────────────
step "Migraciones CORE (bloqueantes — abortan el deploy si fallan)"
cd "${INSTALL_DIR}/backend"

# Cargar variables de entorno (producción tiene .env.production, dev tiene .env)
if [[ -f .env.production ]]; then
    set -a; source .env.production; set +a
elif [[ -f .env ]]; then
    set -a; source .env; set +a
else
    warn "No se encontró archivo .env — las migraciones pueden fallar por falta de credenciales"
fi

# ─── 5a. Migraciones CORE — abortan el deploy si fallan ──────────────────────
# Corre desde dist/ compilado (evita ts-node + OOM); path: migrations/core/*.js
tmp_core="${INSTALL_DIR}/backend/_run_core_migrations.js"
cat > "$tmp_core" << 'MIGJS'
const path = require('path');
const envFile = require('fs').existsSync(path.join(process.cwd(), '.env.production'))
  ? '.env.production' : '.env';
require('dotenv').config({ path: path.join(process.cwd(), envFile) });
const { DataSource } = require('typeorm');
const ds = new DataSource({
  type:                'postgres',
  host:                process.env.DB_HOST     || 'localhost',
  port:                parseInt(process.env.DB_PORT || '5432', 10),
  database:            process.env.DB_NAME     || 'datafast_db',
  username:            process.env.DB_USER     || 'datafast_db_user',
  password:            process.env.DB_PASSWORD,
  ssl:                 process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  entities:            [],
  migrations:          [path.join(process.cwd(), 'dist', 'database', 'migrations', 'core', '*.js')],
  migrationsTableName: 'typeorm_migrations',
  synchronize:         false,
  logging:             true,
});
ds.initialize()
  .then(() => ds.runMigrations({ transaction: 'each' }))
  .then(ran => { console.log('Core: ' + ran.length + ' migración(es) aplicada(s)'); return ds.destroy(); })
  .then(() => process.exit(0))
  .catch(e => { console.error('ERROR core: ' + e.message); process.exit(1); });
MIGJS

CORE_OK=false
for i in 1 2 3; do
    if node "$tmp_core" >> "$LOG_FILE" 2>&1; then
        log "Migraciones core ejecutadas"; CORE_OK=true; break
    fi
    warn "Intento ${i}/3 falló. Reintentando en 5s..."
    sleep 5
done
rm -f "$tmp_core"
[[ "$CORE_OK" == true ]] || err "Migraciones CORE fallaron tras 3 intentos — deploy abortado para proteger la BD"

# ─── 5b. Migraciones AUXILIARES — no bloquean el deploy ──────────────────────
step "Migraciones AUXILIARES (no bloqueantes — módulos degradados si fallan)"
tmp_aux="${INSTALL_DIR}/backend/_run_aux_migrations.js"
cat > "$tmp_aux" << 'MIGJS'
const path = require('path');
const envFile = require('fs').existsSync(path.join(process.cwd(), '.env.production'))
  ? '.env.production' : '.env';
require('dotenv').config({ path: path.join(process.cwd(), envFile) });
const { DataSource } = require('typeorm');
const ds = new DataSource({
  type:                'postgres',
  host:                process.env.DB_HOST     || 'localhost',
  port:                parseInt(process.env.DB_PORT || '5432', 10),
  database:            process.env.DB_NAME     || 'datafast_db',
  username:            process.env.DB_USER     || 'datafast_db_user',
  password:            process.env.DB_PASSWORD,
  ssl:                 process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  entities:            [],
  migrations:          [path.join(process.cwd(), 'dist', 'database', 'migrations', 'auxiliary', '*.js')],
  migrationsTableName: 'typeorm_migrations',
  synchronize:         false,
  logging:             true,
});
ds.initialize()
  .then(() => ds.runMigrations({ transaction: 'each' }))
  .then(ran => { console.log('Auxiliary: ' + ran.length + ' migración(es) aplicada(s)'); return ds.destroy(); })
  .then(() => process.exit(0))
  .catch(e => { console.error('ERROR auxiliary: ' + e.message); process.exit(1); });
MIGJS

if node "$tmp_aux" >> "$LOG_FILE" 2>&1; then
    log "Migraciones auxiliares ejecutadas"
else
    warn "Migraciones AUXILIARES fallaron — deploy continúa; módulos afectados entrarán en modo degradado (ver GET /api/v1/health/modules)"
fi
rm -f "$tmp_aux"

# ── 6. OLT Automation Service: dependencias + restart ────────────────────────
step "Actualizando OLT Automation Service"
OLT_DIR="${INSTALL_DIR}/olt-automation-service"
if [[ -d "${OLT_DIR}" && -d "${OLT_DIR}/venv" ]]; then
    "${OLT_DIR}/venv/bin/pip" install -r "${OLT_DIR}/requirements.txt" --quiet >> "$LOG_FILE" 2>&1 \
        && log "OLT service: dependencias actualizadas" \
        || warn "OLT service: pip install falló — revisa el log"
    pm2 restart olt-automation-service >> "$LOG_FILE" 2>&1 \
        && log "OLT service reiniciado" \
        || warn "OLT service: pm2 restart falló"
else
    warn "OLT service no instalado en ${OLT_DIR} — omitiendo"
fi

# ── 7. Reload backend (zero-downtime cluster) ─────────────────────────────────
step "Reload backend"
pm2 reload "${ECOSYSTEM}" --only datafast-backend >> "$LOG_FILE" 2>&1 \
    || pm2 restart datafast-backend               >> "$LOG_FILE" 2>&1 \
    || warn "PM2 backend no reiniciado"
log "Backend recargado"

# ── 7. Restart frontend ───────────────────────────────────────────────────────
# set -e desactivado en esta sección: ningún error aquí puede dejar el frontend caído.
# El trap EXIT es el safety net definitivo.
step "Restart seguro del frontend"
set +e

log "Deteniendo datafast-frontend..."
pm2 stop datafast-frontend >> "$LOG_FILE" 2>&1

log "Liberando puerto 3000 (fuser)..."
sleep 2
fuser -k 3000/tcp >> "$LOG_FILE" 2>&1
sleep 2

log "Iniciando datafast-frontend..."
pm2 start "${ECOSYSTEM}" --only datafast-frontend >> "$LOG_FILE" 2>&1
FRONTEND_EXIT=$?

set -e

if [[ $FRONTEND_EXIT -eq 0 ]]; then
    log "Frontend arrancado correctamente"
else
    warn "pm2 start retornó ${FRONTEND_EXIT} — el trap EXIT se encargará"
fi

pm2 save >> "$LOG_FILE" 2>&1 || true
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
