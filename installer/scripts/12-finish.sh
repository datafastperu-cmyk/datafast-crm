#!/usr/bin/env bash
# Módulo 12 — Herramientas de admin, CLI y pantalla final

# ── Flujo completo de instalación ────────────────────────────
run_install() {
    run_checks
    _ask_config
    install_system
    install_nodejs
    install_postgres
    install_redis
    setup_nginx
    deploy_app
    setup_pm2
    setup_security
    setup_monitoring
    setup_backup
    setup_ssl
    _create_cli
    _create_secrets_file
    _save_install_info
    show_completion
}

run_upgrade() {
    upgrade_app
    _save_install_info
    show_completion
}

# ── Configuración interactiva ─────────────────────────────────
_ask_config() {
    if ${FLAG_SILENT:-false}; then
        _generate_secrets
        return
    fi

    # Cuando se ejecuta via "curl | bash", stdin es la tubería.
    # Redirigir al terminal para que los read funcionen.
    exec </dev/tty

    echo -e "\n${BOLD}${C}── CONFIGURACIÓN DEL SISTEMA ──────────────────────────${NC}\n"

    read -rp "  Nombre de tu empresa ISP [DATAFAST S.A.C.]: " EMPRESA_NOMBRE
    EMPRESA_NOMBRE="${EMPRESA_NOMBRE:-DATAFAST S.A.C.}"

    read -rp "  RUC (11 dígitos) [20000000001]: " EMPRESA_RUC
    EMPRESA_RUC="${EMPRESA_RUC:-20000000001}"

    echo ""
    read -rp "  Email del administrador [admin@datafast.pe]: " ADMIN_EMAIL
    ADMIN_EMAIL="${ADMIN_EMAIL:-admin@datafast.pe}"

    while true; do
        read -rsp "  Contraseña del administrador (mínimo 8 chars): " ADMIN_PASSWORD
        echo ""
        [[ ${#ADMIN_PASSWORD} -ge 8 ]] && break
        echo "  Mínimo 8 caracteres."
    done

    echo ""
    echo -e "  ${D}Dominio opcional — presiona Enter para usar IP directa${NC}"
    read -rp "  Dominio del panel ERP (ej: erp.tuisp.pe): " DOMINIO_FRONTEND
    read -rp "  Dominio de la API     (ej: api.tuisp.pe): " DOMINIO_BACKEND
    [[ -n "${DOMINIO_FRONTEND:-}" && -z "${DOMINIO_BACKEND:-}" ]] && DOMINIO_BACKEND="$DOMINIO_FRONTEND"

    _generate_secrets

    echo ""
    echo -e "  ${BOLD}Resumen:${NC}"
    echo "    Empresa: ${EMPRESA_NOMBRE}"
    echo "    Admin:   ${ADMIN_EMAIL}"
    [[ -n "${DOMINIO_FRONTEND:-}" ]] && echo "    Panel:   https://${DOMINIO_FRONTEND}"
    echo ""
    read -rp "  ¿Continuar con la instalación? [S/n]: " confirmar
    [[ "${confirmar:-s}" =~ ^[nN]$ ]] && exit 0

    export EMPRESA_NOMBRE EMPRESA_RUC ADMIN_EMAIL ADMIN_PASSWORD
    export DOMINIO_FRONTEND DOMINIO_BACKEND
}

_generate_secrets() {
    DB_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)
    REDIS_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)
    JWT_SECRET=$(openssl rand -hex 64)
    JWT_REFRESH_SECRET=$(openssl rand -hex 64)
    ENCRYPTION_KEY=$(openssl rand -hex 32)
    export DB_PASSWORD REDIS_PASSWORD JWT_SECRET JWT_REFRESH_SECRET ENCRYPTION_KEY
}

# ── CLI principal ─────────────────────────────────────────────
_create_cli() {
    info "Creando CLI de administración..."
    cat > /usr/local/bin/datafast << 'CLIEOF'
#!/usr/bin/env bash
INSTALL_DIR="/opt/datafast"
cmd="${1:-help}"
case "$cmd" in
  status)   bash "${INSTALL_DIR}/scripts/health.sh" ;;
  start)    pm2 start "${INSTALL_DIR}/ecosystem.config.js" 2>/dev/null || pm2 restart all; pm2 status ;;
  stop)     pm2 stop all ;;
  restart)  pm2 restart all; pm2 status ;;
  reload)   pm2 reload datafast-backend; pm2 restart datafast-frontend; pm2 status ;;
  logs)     pm2 logs "datafast-${2:-backend}" --lines "${3:-50}" ;;
  backup)   bash "${INSTALL_DIR}/scripts/backup.sh" ;;
  restore)  bash "${INSTALL_DIR}/scripts/restore.sh" ;;
  update)   bash "${INSTALL_DIR}/scripts/update.sh" ;;
  ssl)      [[ -z "${2:-}" ]] && echo "Uso: datafast ssl dominio.pe" || certbot --nginx -d "$2" --agree-tos --non-interactive ;;
  db)
    case "${2:-}" in
      shell) source "${INSTALL_DIR}/config/secrets.conf"; PGPASSWORD="${DB_PASSWORD}" psql -h localhost -U datafast_db_user -d datafast_db ;;
      stats) source "${INSTALL_DIR}/config/secrets.conf"; PGPASSWORD="${DB_PASSWORD}" psql -h localhost -U datafast_db_user -d datafast_db -c "SELECT 'clientes' AS tabla, COUNT(*)::TEXT AS total FROM clientes WHERE deleted_at IS NULL UNION ALL SELECT 'contratos activos', COUNT(*)::TEXT FROM contratos WHERE estado='activo' AND deleted_at IS NULL;" ;;
      size)  source "${INSTALL_DIR}/config/secrets.conf"; PGPASSWORD="${DB_PASSWORD}" psql -h localhost -U datafast_db_user -d datafast_db -c "SELECT pg_size_pretty(pg_database_size('datafast_db')) AS tamaño;" ;;
      *) echo "Uso: datafast db [shell|stats|size]" ;;
    esac ;;
  info)
    echo "CRM ISP DATAFAST"
    echo "Servidor: $(hostname) ($(hostname -I | awk '{print $1}'))"
    echo "Node.js:  $(node --version 2>/dev/null)"
    echo "PM2:      $(pm2 --version 2>/dev/null)"
    ;;
  help|*)
    echo ""
    echo "CRM ISP DATAFAST — CLI"
    echo ""
    echo "  datafast status          Ver estado del sistema"
    echo "  datafast start           Iniciar aplicación"
    echo "  datafast stop            Detener aplicación"
    echo "  datafast restart         Reiniciar"
    echo "  datafast reload          Zero-downtime reload"
    echo "  datafast logs            Ver logs backend"
    echo "  datafast logs frontend   Ver logs frontend"
    echo "  datafast backup          Crear backup"
    echo "  datafast restore         Restaurar backup"
    echo "  datafast update          Actualizar sistema"
    echo "  datafast ssl dominio.pe  Configurar HTTPS"
    echo "  datafast db shell        Consola SQL"
    echo "  datafast db stats        Estadísticas BD"
    echo "  datafast info            Info del servidor"
    echo ""
    ;;
esac
CLIEOF
    chmod +x /usr/local/bin/datafast
    ok "CLI 'datafast' creado"
}

# ── Guardar secretos ──────────────────────────────────────────
_create_secrets_file() {
    mkdir -p "${INSTALL_DIR}/config"
    cat > "${INSTALL_DIR}/config/secrets.conf" << SECEOF
DB_PASSWORD="${DB_PASSWORD}"
REDIS_PASSWORD="${REDIS_PASSWORD}"
JWT_SECRET="${JWT_SECRET}"
ENCRYPTION_KEY="${ENCRYPTION_KEY}"
SECEOF
    chmod 600 "${INSTALL_DIR}/config/secrets.conf"
    ok "Secretos guardados"
}

# ── Guardar info de instalación ───────────────────────────────
_save_install_info() {
    local ip; ip=$(hostname -I | awk '{print $1}')
    local url="http://${ip}/dashboard"
    [[ -n "${DOMINIO_FRONTEND:-}" ]] && url="https://${DOMINIO_FRONTEND}/dashboard"

    mkdir -p "${INSTALL_DIR}/config"
    cat > "${INSTALL_DIR}/config/install-info.txt" << INFOEOF
═══════════════════════════════════════════════════════
  DATAFAST ISP ERP — Información de Instalación
  Instalado: $(date)
  Versión:   v${DATAFAST_VERSION}
═══════════════════════════════════════════════════════

ACCESO AL PANEL
  URL:         ${url}
  Usuario:     ${ADMIN_EMAIL}
  Contraseña:  ${ADMIN_PASSWORD}

BASE DE DATOS
  Host:    localhost:5432
  BD:      datafast_db
  Usuario: datafast_db_user

COMANDOS
  datafast status    Ver estado
  datafast logs      Ver logs
  datafast backup    Crear backup
  datafast restart   Reiniciar
  datafast update    Actualizar
  datafast help      Ayuda

ARCHIVOS
  Backend .env:  ${INSTALL_DIR}/backend/.env.production
  Secretos:      ${INSTALL_DIR}/config/secrets.conf
  Logs:          ${INSTALL_DIR}/logs/
  Backups:       ${INSTALL_DIR}/backups/
═══════════════════════════════════════════════════════
INFOEOF
    chmod 600 "${INSTALL_DIR}/config/install-info.txt"
    echo "${DATAFAST_VERSION}" > "${INSTALL_DIR}/.installed"
    ok "Información de instalación guardada"
}

# ── Pantalla final ────────────────────────────────────────────
show_completion() {
    local ip; ip=$(hostname -I | awk '{print $1}')
    local url="http://${ip}/dashboard"
    [[ -n "${DOMINIO_FRONTEND:-}" ]] && url="https://${DOMINIO_FRONTEND}/dashboard"

    echo ""
    echo -e "\033[1;32m"
    echo "  ╔══════════════════════════════════════════════════════════╗"
    echo "  ║                                                          ║"
    echo "  ║   ✅  DATAFAST ISP ERP INSTALADO EXITOSAMENTE           ║"
    echo "  ║                                                          ║"
    echo "  ╚══════════════════════════════════════════════════════════╝"
    echo -e "\033[0m"
    echo ""
    echo -e "  \033[1mAbre en tu navegador:\033[0m"
    echo -e "  \033[1;36m  ➜  ${url}\033[0m"
    echo ""
    echo -e "  \033[1mCredenciales:\033[0m"
    echo -e "    Usuario:    \033[1;33m${ADMIN_EMAIL}\033[0m"
    echo -e "    Contraseña: \033[1;33m${ADMIN_PASSWORD}\033[0m"
    echo ""
    echo -e "  \033[1mComandos:\033[0m"
    echo -e "    \033[36mdatafast status\033[0m   — Estado del sistema"
    echo -e "    \033[36mdatafast logs\033[0m     — Ver logs"
    echo -e "    \033[36mdatafast backup\033[0m   — Crear backup"
    echo -e "    \033[36mdatafast restart\033[0m  — Reiniciar"
    echo -e "    \033[36mdatafast update\033[0m   — Actualizar"
    echo ""
    echo -e "  \033[2mInfo: ${INSTALL_DIR}/config/install-info.txt\033[0m"
    echo ""
}

# ── Desinstalar ───────────────────────────────────────────────
run_uninstall() {
    echo -e "\033[1;31m⚠  DESINSTALAR DATAFAST\033[0m"
    read -rp "Escribe 'DESINSTALAR' para confirmar: " conf
    [[ "$conf" != "DESINSTALAR" ]] && { echo "Cancelado."; exit 0; }

    "${INSTALL_DIR}/scripts/backup.sh" 2>/dev/null || true
    pm2 stop all 2>/dev/null || true
    pm2 delete all 2>/dev/null || true
    systemctl stop  datafast 2>/dev/null || true
    systemctl disable datafast 2>/dev/null || true
    rm -f /etc/nginx/sites-enabled/datafast-*
    rm -f /etc/nginx/sites-available/datafast-*
    systemctl reload nginx 2>/dev/null || true
    rm -f /usr/local/bin/datafast
    rm -f /etc/systemd/system/datafast.service
    echo "DATAFAST desinstalado. Backups en: ${INSTALL_DIR}/backups/"
}
