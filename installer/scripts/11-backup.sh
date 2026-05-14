#!/usr/bin/env bash
# Módulo 11 — Backups automáticos
setup_backup() {
    step "Configurando backups automáticos"
    info "Creando script de backup..."
    cat > "${INSTALL_DIR}/scripts/backup.sh" << 'BACKUPEOF'
#!/usr/bin/env bash
set -euo pipefail
readonly INSTALL_DIR="/opt/fibranet"
readonly BACKUP_DIR="${INSTALL_DIR}/backups"
readonly FECHA=$(date +%Y%m%d_%H%M%S)
readonly LOG="${INSTALL_DIR}/logs/backup.log"
source "${INSTALL_DIR}/config/secrets.conf" 2>/dev/null || true
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }
mkdir -p "${BACKUP_DIR}/db" "${BACKUP_DIR}/files"
log "Iniciando backup: ${FECHA}"
BACKUP_DB="${BACKUP_DIR}/db/fibranet_${FECHA}.sql.gz"
PGPASSWORD="${DB_PASSWORD}" pg_dump -h localhost -U fibranet_db_user fibranet_db \
    --clean --if-exists | gzip -9 > "${BACKUP_DB}"
gzip -t "${BACKUP_DB}" 2>/dev/null && log "✓ BD: ${BACKUP_DB} ($(du -sh ${BACKUP_DB} | cut -f1))" || { log "✗ Backup corrupto"; exit 1; }
find "${BACKUP_DIR}" -name "*.gz" -mtime +30 -delete
log "Backup completado. Total: $(ls ${BACKUP_DIR}/db/ | wc -l) archivos"
BACKUPEOF
    chmod +x "${INSTALL_DIR}/scripts/backup.sh"

    cat > "${INSTALL_DIR}/scripts/restore.sh" << 'RESTOREEOF'
#!/usr/bin/env bash
set -euo pipefail
readonly INSTALL_DIR="/opt/fibranet"
readonly BACKUP_DIR="${INSTALL_DIR}/backups/db"
source "${INSTALL_DIR}/config/secrets.conf" 2>/dev/null || true
echo "═══ FibraNet — Restaurar Backup ═══"
echo "Backups disponibles:"
ls -lth "${BACKUP_DIR}"/*.sql.gz 2>/dev/null | awk '{print NR". "$NF" ("$5")"}' || { echo "No hay backups."; exit 1; }
echo ""
read -rp "Número del backup (0 para cancelar): " num
[ "$num" = "0" ] && exit 0
backup_file=$(ls -t "${BACKUP_DIR}"/*.sql.gz 2>/dev/null | sed -n "${num}p")
[ -z "$backup_file" ] && { echo "Número inválido."; exit 1; }
echo "⚠  Restaurar: $(basename $backup_file)"
read -rp "Escribe 'RESTAURAR' para confirmar: " conf
[ "$conf" != "RESTAURAR" ] && { echo "Cancelado."; exit 0; }
sudo -u fibranet pm2 stop fibranet-backend 2>/dev/null || true
PGPASSWORD="${DB_PASSWORD}" psql -h localhost -U fibranet_db_user -d fibranet_db \
    < <(gunzip -c "$backup_file")
sudo -u fibranet pm2 start fibranet-backend 2>/dev/null || true
echo "✓ Restauración completada"
RESTOREEOF
    chmod +x "${INSTALL_DIR}/scripts/restore.sh"

    (crontab -l 2>/dev/null; cat << 'CRONEOF'
0 2 * * * /opt/fibranet/scripts/backup.sh
0 3 * * 0 pm2 flush 2>/dev/null
CRONEOF
    ) | sort -u | crontab -

    ok "Backups automáticos: diario 2:00 AM (retención 30 días)"
}
