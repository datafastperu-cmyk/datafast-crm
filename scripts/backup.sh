#!/bin/bash
# ==============================================================
# CRM ISP DATAFAST — Backup automático PostgreSQL
# Cron sugerido: 0 2 * * * /opt/datafast/scripts/backup.sh
# Guarda los últimos 30 días de backups
# ==============================================================

set -euo pipefail

# Cargar variables
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."
[ -f .env ] && source .env || exit 1

# Configuración
BACKUP_DIR="/opt/datafast/backups"
RETENTION_DAYS=30
DATE=$(date +%Y%m%d_%H%M%S)
FILENAME="datafast_${DATE}.sql.gz"
LOG_FILE="/opt/datafast/logs/backup.log"

mkdir -p "$BACKUP_DIR" "$(dirname $LOG_FILE)"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"; }

log "Iniciando backup: $FILENAME"

# Dump con compresión
docker compose exec -T postgres pg_dump \
    -U "${DB_USER:-datafast}" \
    -d "${DB_NAME:-datafast}" \
    --no-owner \
    --no-acl \
    | gzip > "$BACKUP_DIR/$FILENAME"

SIZE=$(du -sh "$BACKUP_DIR/$FILENAME" | cut -f1)
log "Backup completado: $FILENAME ($SIZE)"

# Eliminar backups antiguos
DELETED=$(find "$BACKUP_DIR" -name "datafast_*.sql.gz" -mtime +$RETENTION_DAYS -delete -print | wc -l)
[ $DELETED -gt 0 ] && log "Backups eliminados (>${RETENTION_DAYS}d): $DELETED archivos"

# Verificar integridad del backup
if gunzip -t "$BACKUP_DIR/$FILENAME" 2>/dev/null; then
    log "Integridad verificada OK"
else
    log "ERROR: Backup corrupto!"
    exit 1
fi

log "Backup finalizado exitosamente"
