#!/usr/bin/env bash
# Módulo 12 — Herramientas de admin, CLI y pantalla final

# ── Flujo completo de instalación ────────────────────────────
run_install() {
    run_checks
    _prepare_config
    install_system
    install_nodejs
    install_postgres
    install_redis
    setup_nginx
    deploy_app
    setup_pm2
    setup_security
    setup_openvpn
    setup_monitoring
    setup_backup
    setup_ssl
    _create_cli
    _create_secrets_file
    _save_install_info
    _validate_install
    show_completion
}

run_upgrade() {
    upgrade_app
    _save_install_info
    show_completion
}

# ── Preparación de configuración ──────────────────────────────
# Detecta el tipo de servidor (VPS / local) y la dirección con que
# se accederá al ERP. En modo interactivo permite confirmar/corregir;
# en modo desatendido (UNATTENDED=true, sin TTY o timeout) usa la
# dirección autodetectada. Las credenciales se generan siempre solas.
_prepare_config() {
    _detect_server_address

    # Empresa — usar defaults, el ISP los configura desde el panel después de instalar
    EMPRESA_NOMBRE="${EMPRESA_NOMBRE:-DATAFAST Internet S.A.C.}"
    EMPRESA_RUC="${EMPRESA_RUC:-20000000001}"

    # Admin — credenciales fijas para la instalación inicial
    # El usuario las cambia después del primer login a través del instalador web
    ADMIN_EMAIL="admin@datafast.pe"
    ADMIN_PASSWORD="admin"

    # Sin dominio por defecto — se configura después desde el panel
    DOMINIO_FRONTEND="${DOMINIO_FRONTEND:-}"
    DOMINIO_BACKEND="${DOMINIO_BACKEND:-}"

    _generate_secrets

    export PUBLIC_IP SERVER_TYPE EMPRESA_NOMBRE EMPRESA_RUC ADMIN_EMAIL ADMIN_PASSWORD
    export DOMINIO_FRONTEND DOMINIO_BACKEND

    _log "INFO" "Configuración: tipo=${SERVER_TYPE} | direccion=${PUBLIC_IP} | empresa=${EMPRESA_NOMBRE}"
}

# ── Detección de dirección del servidor (VPS vs local) ────────
# ¿Es privada la IP? (RFC1918 + CGNAT 100.64/10 + loopback)
_is_private_ip() {
    case "$1" in
        10.*|192.168.*|127.*) return 0 ;;
        172.1[6-9].*|172.2[0-9].*|172.3[0-1].*) return 0 ;;
        100.6[4-9].*|100.[7-9][0-9].*|100.1[0-1][0-9].*|100.12[0-7].*) return 0 ;; # 100.64.0.0/10 CGNAT
        *) return 1 ;;
    esac
}

_detect_server_address() {
    # IP local primaria (la que el server tiene en su interfaz)
    local local_ip;  local_ip=$(hostname -I | awk '{print $1}')
    # IP pública real vista desde internet (vacía si no hay salida / CGNAT bloquea)
    local public_ip; public_ip=$(curl -fsSL --max-time 5 https://api.ipify.org 2>/dev/null || echo "")

    local detected="" tipo=""
    if [[ -n "$public_ip" && "$public_ip" == "$local_ip" ]]; then
        # La interfaz tiene la IP pública directa → VPS clásico
        detected="$public_ip"; tipo="VPS (IP pública directa)"
    elif [[ -n "$public_ip" && -n "$local_ip" ]] && _is_private_ip "$local_ip"; then
        # Interfaz privada pero hay IP pública distinta → VPS tras NAT o server tras router.
        # Caso ambiguo: por defecto usamos la LAN (siempre enlazable y válida para acceso
        # en la misma red); el admin de un VPS-NAT puede corregir a la pública en el prompt.
        detected="$local_ip"; tipo="servidor local / red interna (IP LAN ${local_ip}; pública detectada ${public_ip})"
    elif [[ -n "$local_ip" ]]; then
        # Sin IP pública consultable (CGNAT que bloquea salida o red aislada) → usar LAN
        detected="$local_ip"; tipo="servidor local / CGNAT (IP LAN)"
    else
        detected="127.0.0.1"; tipo="desconocido (sin interfaz detectada)"
    fi

    # Prompt interactivo — solo si hay TTY y no se forzó modo desatendido
    if [[ "${UNATTENDED:-false}" != "true" && -e /dev/tty ]]; then
        local respuesta=""
        {
            echo ""
            echo "  ┌─ Dirección de acceso al ERP ──────────────────────────────"
            echo "  │ Detectado: ${detected}"
            echo "  │ Tipo:      ${tipo}"
            [[ -n "$public_ip" && "$public_ip" != "$detected" ]] && \
            echo "  │ Pública:   ${public_ip}  (usar esta si es un VPS accesible desde internet)"
            echo "  │"
            echo "  │ Enter = usar '${detected}'  |  o escribe otra IP/dominio (30s)"
            echo "  └────────────────────────────────────────────────────────────"
            printf "  > "
        } > /dev/tty
        read -r -t 30 respuesta < /dev/tty || true
        [[ -n "$respuesta" ]] && detected="$respuesta"
    fi

    # PUBLIC_IP es la dirección de acceso (IP o hostname). Para HTTPS con dominios
    # separados (api.x.com / x.com) se pre-setean DOMINIO_BACKEND/DOMINIO_FRONTEND
    # como variables de entorno antes de instalar; el prompt cubre el caso IP/host simple.
    PUBLIC_IP="$detected"
    SERVER_TYPE="$tipo"
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
    echo "CRM ISP DATAFAST — CLI de Administración"
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
    local ip="${PUBLIC_IP:-$(hostname -I | awk '{print $1}')}"
    local web_installer_url="http://${ip}/installl"

    mkdir -p "${INSTALL_DIR}/config"
    cat > "${INSTALL_DIR}/config/install-info.txt" << INFOEOF
═══════════════════════════════════════════════════════
  DATAFAST ISP ERP — Información de Instalación
  Instalado: $(date)
  Versión:   v${DATAFAST_VERSION}
═══════════════════════════════════════════════════════

INSTALACIÓN WEB (Fase 2)
  URL: ${web_installer_url}
  Ingresa a esta URL después de reiniciar para completar la instalación.

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
    echo "${DATAFAST_VERSION}" > "${INSTALL_DIR}/.installed_console"
    ok "Información de instalación guardada"
}

# ── Pantalla final — Instalación consola concluida ───────────
show_completion() {
    local ip="${PUBLIC_IP:-$(hostname -I | awk '{print $1}')}"
    local url="http://${ip}/installl"
    [[ -n "${DOMINIO_FRONTEND:-}" ]] && url="https://${DOMINIO_FRONTEND}/installl"

    echo ""
    echo -e "\033[1;32m"
    echo "  ╔════════════════════════════════════════════════════════════════╗"
    echo "  ║                                                                ║"
    echo -e "  ║        ✅  FASE 1 DE INSTALACIÓN COMPLETADA                  ║"
    echo "  ║                                                                ║"
    echo "  ╚════════════════════════════════════════════════════════════════╝"
    echo -e "\033[0m"

    echo -e "  \033[1;33m━━━  PROCESO DE INSTALACIÓN PARA PRODUCCIÓN  ━━━\033[0m"
    echo ""
    echo -e "  La instalación se realiza en \033[1;37mdos fases\033[0m:"
    echo ""
    echo -e "  \033[1;32m[FASE 1]\033[0m  Instalación por consola  \033[1;32m← COMPLETADA\033[0m"
    echo -e "  \033[1;33m[FASE 2]\033[0m  Configuración vía navegador web  \033[1;33m← PENDIENTE\033[0m"
    echo ""
    echo -e "  \033[1;37m┌─────────────────────────────────────────────────────────────┐\033[0m"
    echo -e "  \033[1;37m│  PASO SIGUIENTE — Abre esta URL en tu navegador:            │\033[0m"
    echo ""
    echo -e "  \033[1;36m       ${url}\033[0m"
    echo ""
    echo -e "  \033[1;37m└─────────────────────────────────────────────────────────────┘\033[0m"
    echo ""
    echo -e "  \033[0;37mEn el asistente web completarás:\033[0m"
    echo -e "    \033[33m1.\033[0m Verificar conexión a la base de datos"
    echo -e "    \033[33m2.\033[0m Activar la licencia del sistema"
    echo -e "    \033[33m3.\033[0m Configurar el servidor OpenVPN para los routers MikroTik"
    echo -e "    \033[33m4.\033[0m Registrar los routers MikroTik con su IP de gestión"
    echo ""
    echo -e "  \033[2m─────────────────────────────────────────────────────────────\033[0m"
    echo -e "  \033[2mComandos útiles:\033[0m"
    echo -e "    \033[36mdatafast status\033[0m    →  Estado de todos los procesos"
    echo -e "    \033[36mpm2 logs\033[0m           →  Ver logs en tiempo real"
    echo -e "    \033[36mdatafast restart\033[0m   →  Reiniciar backend y frontend"
    echo -e "    \033[36mdatafast help\033[0m      →  Ayuda completa"
    echo ""
}

# ── Flujo de instalación en modo DESARROLLO ──────────────────
run_install_dev() {
    run_checks
    _prepare_config
    install_system
    install_nodejs
    install_postgres_dev
    install_redis_dev
    deploy_app_dev
    setup_openvpn
    start_dev_servers
    _create_cli
    _create_secrets_file
    _save_install_info_dev
    _validate_install_dev
    show_completion_dev
}

_save_install_info_dev() {
    local ip="${PUBLIC_IP:-$(hostname -I | awk '{print $1}')}"

    mkdir -p "${INSTALL_DIR}/config"
    cat > "${INSTALL_DIR}/config/install-info.txt" << INFOEOF
═══════════════════════════════════════════════════════
  DATAFAST ISP ERP — Instalación Desarrollo
  Instalado: $(date)
  Versión:   v${DATAFAST_VERSION}-dev
═══════════════════════════════════════════════════════

URLS DEL SISTEMA
  Frontend      →  http://${ip}:3000
  Backend       →  http://${ip}:4000
  pgAdmin       →  http://${ip}:5050  (admin@datafast.pe / admin123)
  Redis UI      →  http://${ip}:8081
  Evolution API →  http://${ip}:8080  (WhatsApp self-hosted)
  OpenVPN       →  ${ip}:1195/TCP

ACCESO INICIAL
  Email:    admin@datafast.pe
  Password: admin

BASE DE DATOS (Docker)
  Contenedor: datafast-postgres
  Host:       localhost:5432
  BD:         datafast_db
  Usuario:    datafast_db_user

COMANDOS
  datafast status    Ver estado de los procesos
  datafast logs      Ver logs del backend
  datafast restart   Reiniciar procesos
  pm2 logs           Ver todos los logs en tiempo real
  datafast db shell  Consola SQL directa

DOCKER
  docker ps                        Ver contenedores activos
  docker logs datafast-postgres    Logs de PostgreSQL
  docker logs datafast-redis       Logs de Redis

ARCHIVOS
  Backend .env:  ${INSTALL_DIR}/backend/.env
  Frontend .env: ${INSTALL_DIR}/frontend/.env.local
  Secretos:      ${INSTALL_DIR}/config/secrets.conf
  Logs:          ${INSTALL_DIR}/logs/
═══════════════════════════════════════════════════════
INFOEOF
    chmod 600 "${INSTALL_DIR}/config/install-info.txt"
    echo "${DATAFAST_VERSION}-dev" > "${INSTALL_DIR}/.installed_console"
    ok "Información de instalación guardada en ${INSTALL_DIR}/config/install-info.txt"
}

show_completion_dev() {
    local ip="${PUBLIC_IP:-$(hostname -I | awk '{print $1}')}"

    echo ""
    echo -e "\033[1;32m"
    echo "  ╔════════════════════════════════════════════════════════════════╗"
    echo "  ║                                                                ║"
    echo -e "  ║        ✅  FASE 1 DE INSTALACIÓN COMPLETADA                  ║"
    echo "  ║                                                                ║"
    echo "  ╚════════════════════════════════════════════════════════════════╝"
    echo -e "\033[0m"

    echo -e "  \033[1;33m━━━  PROCESO DE INSTALACIÓN PARA PRODUCCIÓN  ━━━\033[0m"
    echo ""
    echo -e "  La instalación se realiza en \033[1;37mdos fases\033[0m:"
    echo ""
    echo -e "  \033[1;32m[FASE 1]\033[0m  Instalación por consola  \033[1;32m← COMPLETADA\033[0m"
    echo -e "  \033[1;33m[FASE 2]\033[0m  Configuración vía navegador web  \033[1;33m← PENDIENTE\033[0m"
    echo ""
    echo -e "  \033[1;37m┌─────────────────────────────────────────────────────────────┐\033[0m"
    echo -e "  \033[1;37m│  PASO SIGUIENTE — Abre esta URL en tu navegador:            │\033[0m"
    echo ""
    echo -e "  \033[1;36m       http://${ip}:3000/installl\033[0m"
    echo ""
    echo -e "  \033[1;37m└─────────────────────────────────────────────────────────────┘\033[0m"
    echo ""
    echo -e "  \033[0;37mEn el asistente web completarás:\033[0m"
    echo -e "    \033[33m1.\033[0m Verificar conexión a la base de datos"
    echo -e "    \033[33m2.\033[0m Activar el sistema (registro de la instancia)"
    echo -e "    \033[33m3.\033[0m Configurar el servidor OpenVPN para los routers MikroTik"
    echo -e "    \033[33m4.\033[0m Registrar los routers MikroTik con su IP de gestión"
    echo ""
    echo -e "  \033[2m─────────────────────────────────────────────────────────────\033[0m"
    echo -e "  \033[2mServicios disponibles en este servidor:\033[0m"
    echo -e "    \033[2mFrontend      →  http://${ip}:3000\033[0m"
    echo -e "    \033[2mBackend API   →  http://${ip}:4000\033[0m"
    echo -e "    \033[2mpgAdmin       →  http://${ip}:5050  (admin@datafast.pe / admin123)\033[0m"
    echo -e "    \033[2mEvolution API →  http://${ip}:8080  (WhatsApp)\033[0m"
    echo ""
    echo -e "  \033[2mComandos útiles:\033[0m"
    echo -e "    \033[36mdatafast status\033[0m    →  Estado de todos los procesos"
    echo -e "    \033[36mpm2 logs\033[0m           →  Ver logs en tiempo real"
    echo -e "    \033[36mdatafast restart\033[0m   →  Reiniciar backend y frontend"
    echo ""
}

# ── Validación post-instalación (producción) ──────────────────
_validate_install() {
    step "Validación post-instalación"
    local errores=0

    # Servicios
    PGPASSWORD="${DB_PASSWORD}" psql -h localhost -U datafast_db_user \
        -d datafast_db -c "SELECT 1;" &>/dev/null \
        && ok "PostgreSQL — OK" || { warn "PostgreSQL — no responde"; (( errores++ )) || true; }

    redis-cli -a "${REDIS_PASSWORD}" --no-auth-warning ping 2>/dev/null | grep -q PONG \
        && ok "Redis — OK" || { warn "Redis — no responde"; (( errores++ )) || true; }

    # PM2 procesos
    sudo -u datafast pm2 list 2>/dev/null | grep -q "datafast-backend.*online" \
        && ok "PM2 backend — online" || { warn "PM2 backend — no está online"; (( errores++ )) || true; }

    sudo -u datafast pm2 list 2>/dev/null | grep -q "datafast-frontend.*online" \
        && ok "PM2 frontend — online" || { warn "PM2 frontend — no está online"; (( errores++ )) || true; }

    # Health del backend
    local be_code
    be_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 \
        http://localhost:4000/health/live 2>/dev/null || echo "000")
    [[ "$be_code" == "200" ]] \
        && ok "Backend API — HTTP 200" \
        || { warn "Backend API — HTTP ${be_code} (puede estar iniciando aún)"; (( errores++ )) || true; }

    # Nginx
    systemctl is-active nginx &>/dev/null \
        && ok "Nginx — activo" || { warn "Nginx — inactivo"; (( errores++ )) || true; }

    if [[ $errores -gt 0 ]]; then
        warn "${errores} componente(s) con advertencias — revisa con: datafast status"
        _log "WARN" "Validación post-install: ${errores} advertencias"
    else
        ok "Todos los componentes validados correctamente"
    fi
}

# ── Validación post-instalación (desarrollo) ──────────────────
_validate_install_dev() {
    step "Validación post-instalación (dev)"
    local errores=0

    # Contenedores Docker
    docker ps --format '{{.Names}}' 2>/dev/null | grep -q "datafast-postgres" \
        && ok "PostgreSQL (Docker) — corriendo" || { warn "PostgreSQL (Docker) — no encontrado"; (( errores++ )) || true; }

    docker ps --format '{{.Names}}' 2>/dev/null | grep -q "datafast-redis" \
        && ok "Redis (Docker) — corriendo" || { warn "Redis (Docker) — no encontrado"; (( errores++ )) || true; }

    docker ps --format '{{.Names}}' 2>/dev/null | grep -q "datafast-evolution" \
        && ok "Evolution API (Docker) — corriendo" || warn "Evolution API (Docker) — no encontrado (no bloqueante)"

    # PM2 (en modo dev corre como root, no como datafast)
    pm2 list 2>/dev/null | grep -q "datafast-backend.*online" \
        && ok "PM2 backend — online" || { warn "PM2 backend — iniciando (puede tardar 60-90s)"; (( errores++ )) || true; }

    pm2 list 2>/dev/null | grep -q "datafast-frontend.*online" \
        && ok "PM2 frontend — online" || warn "PM2 frontend — iniciando (puede tardar 30-60s)"

    if [[ $errores -gt 0 ]]; then
        warn "${errores} componente(s) con advertencias"
        warn "Si los procesos PM2 aún están iniciando, espera 2 minutos y ejecuta: pm2 status"
    else
        ok "Todos los componentes activos"
    fi
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
