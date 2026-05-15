#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  Módulo 10 — Monitoreo del servidor (Netdata + scripts de salud)
# ─────────────────────────────────────────────────────────────────────────────

setup_monitoring() {
    step "Configurando monitoreo del servidor"

    # ── Script de health check ─────────────────────────────────────────────
    info "Creando script de salud del sistema..."
    cat > "${INSTALL_DIR}/scripts/health.sh" << 'HEALTHEOF'
#!/usr/bin/env bash
# CRM ISP DATAFAST — Health Check
readonly INSTALL_DIR="/opt/datafast"
readonly RED='\033[0;31m' GREEN='\033[0;32m' YELLOW='\033[1;33m'
readonly CYAN='\033[0;36m' BOLD='\033[1m' NC='\033[0m'

ok()   { echo -e "  ${GREEN}✓${NC} $*"; }
fail() { echo -e "  ${RED}✗${NC} $*"; }
warn() { echo -e "  ${YELLOW}!${NC} $*"; }

echo ""
echo -e "${BOLD}${CYAN}══════════════════════════════════════════${NC}"
echo -e "${BOLD}  CRM ISP DATAFAST — Health Check$(date '+  %Y-%m-%d %H:%M:%S')${NC}"
echo -e "${BOLD}${CYAN}══════════════════════════════════════════${NC}"

# PM2
echo -e "\n${BOLD}── Procesos de la aplicación:${NC}"
pm2 jlist 2>/dev/null | python3 -c "
import json,sys
try:
    procs = json.load(sys.stdin)
    for p in procs:
        name = p['name']
        status = p['pm2_env']['status']
        cpu = p['monit']['cpu']
        mem = round(p['monit']['memory'] / 1024 / 1024)
        restarts = p['pm2_env']['restart_time']
        icon = '✓' if status == 'online' else '✗'
        print(f'  {icon} {name}: {status} | CPU:{cpu}% RAM:{mem}MB reinicioss:{restarts}')
except: print('  ! No se pudo leer el estado de PM2')
" 2>/dev/null

# API
echo -e "\n${BOLD}── Backend API (puerto 4000):${NC}"
code=$(curl -sf -o /dev/null -w "%{http_code}" http://localhost:4000/api/v1/health 2>/dev/null)
[ "$code" = "200" ] && ok "Respondiendo OK (HTTP 200)" || fail "No responde (código: ${code:-timeout})"

# Frontend
echo -e "\n${BOLD}── Frontend (puerto 3000):${NC}"
code=$(curl -sf -o /dev/null -w "%{http_code}" http://localhost:3000 2>/dev/null)
[ "$code" = "200" ] && ok "Respondiendo OK" || fail "No responde (código: ${code:-timeout})"

# PostgreSQL
echo -e "\n${BOLD}── PostgreSQL:${NC}"
if PGPASSWORD="${DB_PASSWORD:-}" psql -h localhost -U datafast_db_user -d datafast_db -c "SELECT 1" \
    > /dev/null 2>&1; then
    clientes=$(PGPASSWORD="${DB_PASSWORD:-}" psql -h localhost -U datafast_db_user -d datafast_db \
        -t -c "SELECT COUNT(*) FROM clientes WHERE deleted_at IS NULL" 2>/dev/null | tr -d ' ')
    contratos=$(PGPASSWORD="${DB_PASSWORD:-}" psql -h localhost -U datafast_db_user -d datafast_db \
        -t -c "SELECT COUNT(*) FROM contratos WHERE deleted_at IS NULL AND estado='activo'" \
        2>/dev/null | tr -d ' ')
    ok "Conectado | Clientes: ${clientes:-?} | Contratos activos: ${contratos:-?}"
else
    fail "No se puede conectar"
fi

# Redis
echo -e "\n${BOLD}── Redis:${NC}"
source "${INSTALL_DIR}/config/secrets.conf" 2>/dev/null
if redis-cli -a "${REDIS_PASSWORD:-}" --no-auth-warning ping 2>/dev/null | grep -q PONG; then
    mem=$(redis-cli -a "${REDIS_PASSWORD:-}" --no-auth-warning INFO memory 2>/dev/null \
        | grep used_memory_human | cut -d: -f2 | tr -d '\r')
    ok "Conectado | Memoria usada: ${mem}"
else
    fail "No se puede conectar"
fi

# Nginx
echo -e "\n${BOLD}── Nginx:${NC}"
systemctl is-active --quiet nginx && ok "Activo" || fail "No está corriendo"

# Disco
echo -e "\n${BOLD}── Disco:${NC}"
uso=$(df / --output=pcent | tail -1 | tr -d ' %')
size=$(df -h / --output=used,size | tail -1)
[[ $uso -gt 90 ]] && fail "Disco al ${uso}%! CRÍTICO — ${size}" || \
[[ $uso -gt 75 ]] && warn "Disco al ${uso}% (${size})" || \
ok "Disco al ${uso}% (${size})"

# RAM
echo -e "\n${BOLD}── Memoria RAM:${NC}"
ram=$(free -h | awk 'NR==2 {printf "%s / %s (%.0f%%)", $3, $2, $3/$2*100}')
uso_ram=$(free | awk 'NR==2 {printf "%.0f", $3/$2*100}')
[[ $uso_ram -gt 90 ]] && fail "RAM al ${uso_ram}%! — ${ram}" || \
[[ $uso_ram -gt 75 ]] && warn "RAM al ${uso_ram}% — ${ram}" || \
ok "${ram}"

# Certificado SSL
echo -e "\n${BOLD}── SSL:${NC}"
if [[ -f /etc/letsencrypt/live/*/fullchain.pem ]]; then
    vence=$(openssl x509 -enddate -noout -in /etc/letsencrypt/live/*/fullchain.pem \
        2>/dev/null | cut -d= -f2)
    dias=$(( ($(date -d "$vence" +%s) - $(date +%s)) / 86400 ))
    [[ $dias -lt 14 ]] && fail "SSL vence en ${dias} días! — ${vence}" || \
    ok "SSL válido por ${dias} días más"
else
    warn "Certificado SSL no encontrado (puede ser auto-firmado)"
fi

echo ""
echo -e "${BOLD}${CYAN}══════════════════════════════════════════${NC}"
echo ""
HEALTHEOF
    chmod +x "${INSTALL_DIR}/scripts/health.sh"

    # Cron de health check cada 5 minutos (log cada hora)
    (crontab -l 2>/dev/null; \
     echo "*/60 * * * * ${INSTALL_DIR}/scripts/health.sh >> ${INSTALL_DIR}/logs/health.log 2>&1") | \
        sort -u | crontab -

    ok "Health check creado"

    # ── Instalar Netdata (monitoreo avanzado) ─────────────────────────────
    if ! command -v netdata &>/dev/null; then
        info "Instalando Netdata (monitoreo de servidor en tiempo real)..."
        curl -fsSL https://get.netdata.cloud/kickstart.sh 2>/dev/null | \
            bash -s -- --dont-start-it --stable-channel --disable-telemetry \
            >> "${LOG_FILE}" 2>&1 || warn "Netdata no pudo instalarse (continuando)"

        if command -v netdata &>/dev/null; then
            # Solo accesible localmente por seguridad
            sed -i 's/bind to = .*/bind to = 127.0.0.1/' \
                /etc/netdata/netdata.conf 2>/dev/null || true
            systemctl enable netdata >> "${LOG_FILE}" 2>&1 || true
            systemctl start  netdata >> "${LOG_FILE}" 2>&1 || warn "netdata no iniciado"
            ok "Netdata instalado (http://localhost:19999)"
        fi
    else
        ok "Netdata ya instalado"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
#  Módulo 11 — Sistema de Backup automático
# ─────────────────────────────────────────────────────────────────────────────

setup_backup() {
    step "Configurando sistema de backups automáticos"

    # ── Script de backup principal ────────────────────────────────────────
    info "Creando script de backup..."
    cat > "${INSTALL_DIR}/scripts/backup.sh" << 'BACKUPEOF'
#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  CRM ISP DATAFAST — Sistema de Backup v1.0
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

readonly INSTALL_DIR="/opt/datafast"
readonly BACKUP_DIR="${INSTALL_DIR}/backups"
readonly FECHA=$(date +%Y%m%d_%H%M%S)
readonly LOG="${INSTALL_DIR}/logs/backup.log"
readonly MAX_DIAS_LOCAL=30    # Retención local en días
readonly MAX_DIAS_CLOUD=90    # Retención en nube (si se configura)

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }

# Cargar variables
source "${INSTALL_DIR}/config/secrets.conf" 2>/dev/null || true

log "══════════════════════════════════════"
log "Iniciando backup: ${FECHA}"

mkdir -p "${BACKUP_DIR}/db" "${BACKUP_DIR}/files"

# ── 1. Base de datos ──────────────────────────────────────────────────────────
log "Backup de PostgreSQL..."
BACKUP_DB="${BACKUP_DIR}/db/datafast_${FECHA}.sql.gz"
PGPASSWORD="${DB_PASSWORD}" pg_dump \
    -h localhost -U datafast_db_user datafast_db \
    --clean --if-exists \
    | gzip -9 > "${BACKUP_DB}"

SIZE=$(du -sh "${BACKUP_DB}" | cut -f1)
log "✓ Base de datos: ${BACKUP_DB} (${SIZE})"

# ── 2. Archivos de configuración ─────────────────────────────────────────────
log "Backup de configuración..."
BACKUP_CFG="${BACKUP_DIR}/files/config_${FECHA}.tar.gz"
tar -czf "${BACKUP_CFG}" \
    "${INSTALL_DIR}/config/" \
    "${INSTALL_DIR}/backend/.env.production" \
    "${INSTALL_DIR}/frontend/.env.production" \
    "${INSTALL_DIR}/ecosystem.config.js" \
    /etc/nginx/sites-available/ \
    2>/dev/null || true
log "✓ Configuración: ${BACKUP_CFG}"

# ── 3. Verificar integridad del backup ───────────────────────────────────────
log "Verificando integridad..."
if gzip -t "${BACKUP_DB}" 2>/dev/null; then
    log "✓ Integridad OK"
else
    log "✗ ERROR: El backup de BD está corrupto"
    exit 1
fi

# ── 4. Limpiar backups antiguos ───────────────────────────────────────────────
log "Limpiando backups anteriores a ${MAX_DIAS_LOCAL} días..."
find "${BACKUP_DIR}" -name "*.gz" -mtime +${MAX_DIAS_LOCAL} -delete
TOTAL=$(ls "${BACKUP_DIR}/db/" | wc -l)
log "✓ Backups actuales: ${TOTAL}"

# ── 5. Backup en nube (opcional — configurar en /opt/datafast/config/backup.conf)
CLOUD_CONF="${INSTALL_DIR}/config/backup.conf"
if [[ -f "$CLOUD_CONF" ]]; then
    source "$CLOUD_CONF"
    if [[ -n "${S3_BUCKET:-}" ]]; then
        log "Subiendo a S3: s3://${S3_BUCKET}/datafast/"
        aws s3 cp "${BACKUP_DB}"  "s3://${S3_BUCKET}/datafast/db/" >> "$LOG" 2>&1 && \
            log "✓ Subido a S3" || log "✗ Error al subir a S3"
    fi
    if [[ -n "${GDRIVE_FOLDER:-}" ]]; then
        log "Google Drive configurado. Ver docs."
    fi
fi

log "Backup completado: ${FECHA}"
log "══════════════════════════════════════"
BACKUPEOF
    chmod +x "${INSTALL_DIR}/scripts/backup.sh"

    # ── Script de restauración ─────────────────────────────────────────────
    info "Creando script de restauración..."
    cat > "${INSTALL_DIR}/scripts/restore.sh" << 'RESTOREEOF'
#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  CRM ISP DATAFAST — Restaurar desde backup
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

readonly INSTALL_DIR="/opt/datafast"
readonly BACKUP_DIR="${INSTALL_DIR}/backups/db"

source "${INSTALL_DIR}/config/secrets.conf" 2>/dev/null || true

echo "═══════════════════════════════════════"
echo "  DATAFAST — Restaurar Backup"
echo "═══════════════════════════════════════"
echo ""

# Listar backups disponibles
echo "Backups disponibles:"
ls -lth "${BACKUP_DIR}/"*.sql.gz 2>/dev/null | \
    awk '{print NR". "$NF" ("$5")"}'

echo ""
read -rp "Número del backup a restaurar (0 para cancelar): " num

[[ "$num" == "0" ]] && exit 0

backup_file=$(ls -t "${BACKUP_DIR}"/*.sql.gz 2>/dev/null | sed -n "${num}p")

if [[ -z "$backup_file" ]]; then
    echo "Número inválido."
    exit 1
fi

echo ""
echo "⚠  Se restaurará: $(basename $backup_file)"
echo "⚠  ESTO SOBREESCRIBIRÁ LA BASE DE DATOS ACTUAL"
echo ""
read -rp "¿Confirmar? Escribe 'RESTAURAR' para continuar: " confirmacion

if [[ "$confirmacion" != "RESTAURAR" ]]; then
    echo "Operación cancelada."
    exit 0
fi

# Parar aplicación
echo "Pausando la aplicación..."
sudo -u datafast pm2 stop datafast-backend 2>/dev/null || true

# Restaurar
echo "Restaurando base de datos..."
PGPASSWORD="${DB_PASSWORD}" psql \
    -h localhost -U datafast_db_user \
    -d datafast_db \
    < <(gunzip -c "$backup_file")

echo ""
echo "✓ Base de datos restaurada"

# Reiniciar
sudo -u datafast pm2 start datafast-backend 2>/dev/null || true
echo "✓ Aplicación reiniciada"
echo ""
echo "Restauración completada."
RESTOREEOF
    chmod +x "${INSTALL_DIR}/scripts/restore.sh"

    # ── Programar backups automáticos ─────────────────────────────────────
    info "Programando backups automáticos..."
    (crontab -l 2>/dev/null; cat << 'CRONEOF'
# DATAFAST — Backup automático
# Backup diario a las 2:00 AM
0 2 * * * /opt/datafast/scripts/backup.sh
# Limpieza de logs de la aplicación (domingo 3 AM)
0 3 * * 0 pm2 flush 2>/dev/null
# Limpiar logs de monitoreo viejos
0 4 1 * * find /opt/datafast/logs -name "*.log" -mtime +90 -delete 2>/dev/null
CRONEOF
    ) | sort -u | crontab -

    ok "Backups automáticos: diario a las 2:00 AM (retención 30 días)"
}
