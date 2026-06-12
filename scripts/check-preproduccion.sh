#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  DATAFAST ISP ERP — Checklist Pre-Producción
#
#  Uso:       sudo bash /opt/datafast/scripts/check-preproduccion.sh
#  Retirar:   sudo bash /opt/datafast/scripts/check-preproduccion.sh --remove
#  Docs:      /opt/datafast/docs/checklist-preproduccion.md
#
#  ⚠  Solo para entornos de staging — retirar antes o después del go-live.
# ═══════════════════════════════════════════════════════════════

set -uo pipefail

INSTALL_DIR="/opt/datafast"
SECRETS="${INSTALL_DIR}/config/secrets.conf"
REPORT_FILE="${INSTALL_DIR}/logs/checklist-$(date +%Y%m%d_%H%M%S).txt"

# ── Colores ───────────────────────────────────────────────────
R='\033[0;31m'; G='\033[0;32m'; Y='\033[1;33m'
C='\033[0;36m'; W='\033[1;37m'; D='\033[2m'; NC='\033[0m'; BOLD='\033[1m'

# ── Contadores ────────────────────────────────────────────────
BLOQUEANTES=0
ADVERTENCIAS=0
EXITOSOS=0

# ── Helpers ───────────────────────────────────────────────────
_ok()    { echo -e "  ${G}[✓]${NC} $*"; echo "[OK]  $*" >> "${REPORT_FILE}"; ((EXITOSOS++)); }
_fail()  { echo -e "  ${R}[✗]${NC} ${BOLD}$*${NC}  ${R}← BLOQUEANTE${NC}"; echo "[ERR] $*" >> "${REPORT_FILE}"; ((BLOQUEANTES++)); }
_warn()  { echo -e "  ${Y}[!]${NC} $*  ${Y}← ADVERTENCIA${NC}"; echo "[!]   $*" >> "${REPORT_FILE}"; ((ADVERTENCIAS++)); }
_step()  { echo -e "\n${BOLD}${C}━━━ $*${NC}"; echo "" >> "${REPORT_FILE}"; echo "=== $*" >> "${REPORT_FILE}"; }
_info()  { echo -e "  ${D}$*${NC}"; }

# ── Cargar secretos ───────────────────────────────────────────
_load_secrets() {
    if [[ -f "${SECRETS}" ]]; then
        set -a; source "${SECRETS}"; set +a
    else
        echo -e "${R}[✗] No se encontró ${SECRETS} — ejecuta desde el servidor instalado${NC}"
        exit 1
    fi
}

# ══════════════════════════════════════════════════════════════
#  BLOQUE 1 — Servicios activos
# ══════════════════════════════════════════════════════════════
check_servicios() {
    _step "Servicios activos"

    # PostgreSQL
    if PGPASSWORD="${DB_PASSWORD}" psql -h localhost -U datafast_db_user -d datafast_db \
        -c "SELECT 1;" &>/dev/null; then
        _ok "PostgreSQL — respondiendo en localhost:5432"
    else
        _fail "PostgreSQL — no responde en localhost:5432"
    fi

    # Redis
    if redis-cli -a "${REDIS_PASSWORD}" --no-auth-warning ping 2>/dev/null | grep -q PONG; then
        _ok "Redis — PONG recibido en localhost:6379"
    else
        _fail "Redis — no responde en localhost:6379"
    fi

    # Evolution API
    local evo_code; evo_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:8080/ 2>/dev/null || echo "000")
    if [[ "${evo_code}" =~ ^(200|401|403)$ ]]; then
        _ok "Evolution API — respondiendo en localhost:8080 (HTTP ${evo_code})"
    else
        _warn "Evolution API — no responde en localhost:8080 (HTTP ${evo_code})"
    fi

    # OpenVPN
    if systemctl is-active openvpn-server@mikrotik &>/dev/null || \
       systemctl is-active openvpn &>/dev/null; then
        _ok "OpenVPN — servicio activo"
    else
        _warn "OpenVPN — servicio no encontrado o inactivo"
    fi

    # PM2 backend
    if pm2 list 2>/dev/null | grep -q "datafast-backend.*online"; then
        _ok "PM2 backend — estado online"
    else
        _fail "PM2 backend — no está online (pm2 list)"
    fi

    # PM2 frontend
    if pm2 list 2>/dev/null | grep -q "datafast-frontend.*online"; then
        _ok "PM2 frontend — estado online"
    else
        _fail "PM2 frontend — no está online (pm2 list)"
    fi
}

# ══════════════════════════════════════════════════════════════
#  BLOQUE 2 — Aplicación
# ══════════════════════════════════════════════════════════════
check_aplicacion() {
    _step "Aplicación"

    # Health backend
    local be_code be_ms
    be_ms=$( { time curl -s -o /dev/null -w "%{http_code}" --max-time 10 \
        http://localhost:4000/api/v1/health 2>/dev/null; } 2>&1 )
    be_code=$(echo "${be_ms}" | head -1)
    local ms; ms=$(echo "${be_ms}" | grep real | awk '{printf "%s", $2}')
    if [[ "${be_code}" == "200" ]]; then
        _ok "Backend — /api/v1/health HTTP 200 (${ms})"
    else
        _fail "Backend — /api/v1/health respondió HTTP ${be_code:-000}"
    fi

    # Health frontend
    local fe_code
    fe_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 \
        http://localhost:3000 2>/dev/null || echo "000")
    if [[ "${fe_code}" =~ ^(200|307|302)$ ]]; then
        _ok "Frontend — HTTP ${fe_code} en localhost:3000"
    else
        _fail "Frontend — respondió HTTP ${fe_code:-000} en localhost:3000"
    fi

    # Migraciones pendientes
    local pending
    cd "${INSTALL_DIR}/backend" 2>/dev/null || true
    if [[ -f ".env.production" ]]; then
        set -a; source .env.production; set +a
    fi
    pending=$(npm run migration:show --silent 2>/dev/null | grep -c "\[ \]" || echo "0")
    if [[ "${pending}" == "0" ]]; then
        _ok "Migraciones — todas aplicadas (0 pendientes)"
    else
        _fail "Migraciones — ${pending} migración(es) pendiente(s)"
    fi
}

# ══════════════════════════════════════════════════════════════
#  BLOQUE 3 — Nginx y red
# ══════════════════════════════════════════════════════════════
check_nginx_ssl() {
    _step "Nginx y SSL"

    # Nginx corriendo
    if systemctl is-active nginx &>/dev/null; then
        _ok "Nginx — servicio activo"
    else
        _fail "Nginx — servicio inactivo"
    fi

    # Nginx config válida
    if nginx -t &>/dev/null; then
        _ok "Nginx — configuración sintácticamente válida"
    else
        _fail "Nginx — configuración inválida (nginx -t)"
    fi

    # Puerto 80
    local http_code
    http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost 2>/dev/null || echo "000")
    if [[ "${http_code}" =~ ^(200|301|302|307)$ ]]; then
        _ok "Puerto 80 — HTTP ${http_code}"
    else
        _fail "Puerto 80 — no responde (HTTP ${http_code:-000})"
    fi

    # Puerto 443 y certificado SSL
    local ssl_check
    ssl_check=$(curl -sv --max-time 5 https://localhost 2>&1 || true)
    if echo "${ssl_check}" | grep -q "SSL connection"; then
        _ok "Puerto 443 — conexión SSL establecida"
    else
        _fail "Puerto 443 — sin conexión SSL"
    fi

    # Redirect HTTP → HTTPS
    local redirect_loc
    redirect_loc=$(curl -s -o /dev/null -w "%{redirect_url}" --max-time 5 http://localhost 2>/dev/null || echo "")
    if echo "${redirect_loc}" | grep -q "https://"; then
        _ok "Redirect HTTP→HTTPS — funcionando"
    else
        _warn "Redirect HTTP→HTTPS — no detectado"
    fi

    # Días de vigencia del certificado SSL
    local domain cert_expiry days_left
    domain=$(grep -r "server_name" /etc/nginx/conf.d/ 2>/dev/null | grep -v "#" | awk '{print $2}' | tr -d ';' | head -1)
    if [[ -n "${domain}" ]]; then
        cert_expiry=$(echo | openssl s_client -servername "${domain}" -connect "${domain}:443" 2>/dev/null \
            | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
        if [[ -n "${cert_expiry}" ]]; then
            local expiry_epoch now_epoch
            expiry_epoch=$(date -d "${cert_expiry}" +%s 2>/dev/null || echo 0)
            now_epoch=$(date +%s)
            days_left=$(( (expiry_epoch - now_epoch) / 86400 ))
            if   [[ $days_left -lt 7  ]]; then _fail "SSL — certificado expira en ${days_left} días"
            elif [[ $days_left -lt 30 ]]; then _warn "SSL — certificado expira en ${days_left} días"
            else _ok "SSL — certificado válido por ${days_left} días"
            fi
        else
            _warn "SSL — no se pudo leer la fecha de expiración del certificado"
        fi
    else
        _warn "SSL — no se pudo detectar el dominio desde nginx conf"
    fi

    # Headers de seguridad
    local headers
    headers=$(curl -sI --max-time 5 https://localhost 2>/dev/null || true)
    echo "${headers}" | grep -qi "x-frame-options"    && _ok  "Header X-Frame-Options — presente" \
                                                       || _warn "Header X-Frame-Options — ausente"
    echo "${headers}" | grep -qi "strict-transport"   && _ok  "Header HSTS — presente" \
                                                       || _warn "Header HSTS — ausente"
}

# ══════════════════════════════════════════════════════════════
#  BLOQUE 4 — Backup
# ══════════════════════════════════════════════════════════════
check_backup() {
    _step "Backup"

    local backup_script="${INSTALL_DIR}/scripts/backup.sh"

    # Script existe
    if [[ -f "${backup_script}" ]]; then
        _ok "Script backup.sh — existe"
    else
        _fail "Script backup.sh — no encontrado en ${backup_script}"
        return
    fi

    # Ejecutar backup de prueba
    info "Ejecutando backup de prueba..."
    if bash "${backup_script}" &>/dev/null; then
        _ok "Backup — ejecución exitosa"
    else
        _fail "Backup — falló al ejecutar"
        return
    fi

    # Verificar el archivo generado
    local latest_backup
    latest_backup=$(ls -t "${INSTALL_DIR}/backups/db/"*.gz 2>/dev/null | head -1)
    if [[ -n "${latest_backup}" ]]; then
        local size; size=$(du -sh "${latest_backup}" | awk '{print $1}')
        if gunzip -t "${latest_backup}" &>/dev/null; then
            _ok "Backup — archivo íntegro (${size}): $(basename ${latest_backup})"
        else
            _fail "Backup — archivo corrupto: $(basename ${latest_backup})"
        fi
    else
        _fail "Backup — no se encontró ningún archivo .gz generado"
    fi

    # Cron registrado
    if crontab -l 2>/dev/null | grep -q "backup.sh"; then
        _ok "Cron backup — registrado"
    else
        _warn "Cron backup — no encontrado en crontab"
    fi
}

# ══════════════════════════════════════════════════════════════
#  BLOQUE 5 — Firewall (puertos)
# ══════════════════════════════════════════════════════════════
check_firewall() {
    _step "Firewall"

    local public_ip; public_ip=$(hostname -I | awk '{print $1}')

    # UFW activo
    if ufw status 2>/dev/null | grep -q "Status: active"; then
        _ok "UFW — activo"
    else
        _fail "UFW — inactivo"
    fi

    # Puertos que DEBEN estar abiertos al exterior
    for port in 22 80 443 1194; do
        if nc -z -w3 "${public_ip}" "${port}" &>/dev/null; then
            _ok "Puerto ${port} — accesible desde exterior (esperado)"
        else
            _warn "Puerto ${port} — no accesible desde exterior"
        fi
    done

    # Puertos que NO deben estar expuestos al exterior
    for port in 4000 3000 5432 6379 8080 5050 8081; do
        if nc -z -w2 "${public_ip}" "${port}" &>/dev/null; then
            _fail "Puerto ${port} — EXPUESTO al exterior (debe estar cerrado)"
        else
            _ok "Puerto ${port} — cerrado al exterior"
        fi
    done
}

# ══════════════════════════════════════════════════════════════
#  BLOQUE 6 — Seguridad
# ══════════════════════════════════════════════════════════════
check_seguridad() {
    _step "Seguridad"

    # Fail2Ban activo
    if systemctl is-active fail2ban &>/dev/null; then
        _ok "Fail2Ban — activo"
    else
        _warn "Fail2Ban — inactivo"
    fi

    # Permisos del .env
    local env_file="${INSTALL_DIR}/backend/.env.production"
    if [[ -f "${env_file}" ]]; then
        local perms; perms=$(stat -c "%a" "${env_file}")
        if [[ "${perms}" == "600" ]]; then
            _ok ".env.production — permisos 600 (solo root)"
        else
            _fail ".env.production — permisos ${perms} (deben ser 600)"
        fi
    else
        _warn ".env.production — no encontrado"
    fi

    # Permisos del secrets.conf
    if [[ -f "${SECRETS}" ]]; then
        local sec_perms; sec_perms=$(stat -c "%a" "${SECRETS}")
        if [[ "${sec_perms}" == "600" ]]; then
            _ok "secrets.conf — permisos 600"
        else
            _fail "secrets.conf — permisos ${sec_perms} (deben ser 600)"
        fi
    fi

    # Login root por password deshabilitado
    if sshd -T 2>/dev/null | grep -q "permitrootlogin no"; then
        _ok "SSH root login — deshabilitado"
    else
        _warn "SSH root login — verificar /etc/ssh/sshd_config (PermitRootLogin)"
    fi

    # Secrets no son los valores por defecto
    if echo "${JWT_SECRET:-}" | grep -qi "cambiar\|example\|secret\|test"; then
        _fail "JWT_SECRET — parece ser un valor por defecto, no seguro"
    else
        _ok "JWT_SECRET — tiene valor personalizado"
    fi
}

# ══════════════════════════════════════════════════════════════
#  REPORTE FINAL
# ══════════════════════════════════════════════════════════════
show_resultado() {
    local total=$((BLOQUEANTES + ADVERTENCIAS + EXITOSOS))

    echo ""
    echo -e "${BOLD}${C}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BOLD}  Resultado: ${G}${EXITOSOS} OK${NC}  ${Y}${ADVERTENCIAS} advertencias${NC}  ${R}${BLOQUEANTES} bloqueantes${NC}  ${D}(${total} total)${NC}"
    echo -e "${BOLD}${C}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""

    if [[ $BLOQUEANTES -gt 0 ]]; then
        echo -e "  ${R}${BOLD}✗  NO listo para producción — corregir los ${BLOQUEANTES} punto(s) bloqueante(s)${NC}"
    elif [[ $ADVERTENCIAS -gt 0 ]]; then
        echo -e "  ${Y}${BOLD}!  Puede ir a producción con precaución — revisar las ${ADVERTENCIAS} advertencia(s)${NC}"
    else
        echo -e "  ${G}${BOLD}✓  LISTO para producción${NC}"
    fi

    echo ""
    echo -e "  ${D}Reporte guardado en: ${REPORT_FILE}${NC}"
    echo ""
    echo -e "  ${D}Para retirar este script cuando ya no se necesite:${NC}"
    echo -e "  ${C}  sudo bash $(realpath "$0") --remove${NC}"
    echo ""

    {
        echo ""
        echo "Resultado: ${EXITOSOS} OK / ${ADVERTENCIAS} advertencias / ${BLOQUEANTES} bloqueantes"
        echo "Fecha: $(date)"
    } >> "${REPORT_FILE}"
}

# ══════════════════════════════════════════════════════════════
#  AUTOREMOVE — Retira el script del servidor
# ══════════════════════════════════════════════════════════════
remove_self() {
    local this_script; this_script=$(realpath "$0")
    echo -e "${Y}Este script es solo para pre-producción.${NC}"
    echo -e "Se eliminará: ${this_script}"
    read -rp "¿Confirmar retiro? (s/N): " confirm
    [[ "${confirm,,}" != "s" ]] && { echo "Cancelado."; exit 0; }

    rm -f "${this_script}"
    # Eliminar reportes del checklist
    rm -f "${INSTALL_DIR}/logs/checklist-"*.txt 2>/dev/null || true

    echo -e "${G}[✓]${NC} Script eliminado. Los logs de la aplicación no fueron tocados."
    exit 0
}

# ══════════════════════════════════════════════════════════════
#  MAIN
# ══════════════════════════════════════════════════════════════
main() {
    [[ "${1:-}" == "--remove" ]] && remove_self

    [[ $EUID -ne 0 ]] && { echo -e "${R}Ejecuta: sudo bash $0${NC}"; exit 1; }

    mkdir -p "${INSTALL_DIR}/logs"
    echo "DATAFAST — Checklist Pre-Producción — $(date)" > "${REPORT_FILE}"

    clear
    echo -e "${C}"
    echo "  ╔══════════════════════════════════════════════════════╗"
    echo -e "  ║  ${W}DATAFAST ISP ERP${C} — Checklist Pre-Producción       ║"
    echo "  ╚══════════════════════════════════════════════════════╝"
    echo -e "${NC}"

    _load_secrets

    check_servicios
    check_aplicacion
    check_nginx_ssl
    check_backup
    check_firewall
    check_seguridad
    show_resultado

    [[ $BLOQUEANTES -gt 0 ]] && exit 1 || exit 0
}

main "$@"
