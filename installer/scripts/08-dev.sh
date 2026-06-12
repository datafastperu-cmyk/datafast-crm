#!/usr/bin/env bash
# Módulo 08-dev — Servidores en modo desarrollo con hot-reload (PM2 watch)

start_dev_servers() {
    step "Iniciando servidores en modo desarrollo (hot-reload)"

    # PM2 global
    if ! command -v pm2 &>/dev/null; then
        info "Instalando PM2..."
        npm install -g pm2 >> "${LOG_FILE}" 2>&1
        ok "PM2 instalado"
    fi

    # NestJS CLI local (requerido por nest start --watch)
    if [[ ! -f "${INSTALL_DIR}/backend/node_modules/.bin/nest" ]]; then
        info "Instalando @nestjs/cli local..."
        cd "${INSTALL_DIR}/backend"
        sudo -u datafast npm install --save-dev @nestjs/cli >> "${LOG_FILE}" 2>&1
    fi

    info "Generando ecosystem.dev.config.js..."
    cat > "${INSTALL_DIR}/ecosystem.dev.config.js" << EOF
// CRM ISP DATAFAST — PM2 Desarrollo (hot-reload)
// Generado: $(date)
module.exports = {
  apps: [
    {
      name:      'datafast-backend',
      script:    'node_modules/.bin/nest',
      args:      'start --watch',
      cwd:       '${INSTALL_DIR}/backend',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'development',
        PORT:     4000,
        TZ:       'America/Lima',
      },
      watch:              false,
      max_memory_restart: '1G',
      restart_delay:      3000,
      max_restarts:       15,
      out_file:    '${INSTALL_DIR}/logs/backend-out.log',
      error_file:  '${INSTALL_DIR}/logs/backend-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
    {
      name:    'datafast-frontend',
      script:  'node_modules/.bin/next',
      args:    'dev --port 3000',
      cwd:     '${INSTALL_DIR}/frontend',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'development',
        PORT:     3000,
        HOSTNAME: '0.0.0.0',
        TZ:       'America/Lima',
      },
      max_memory_restart: '1G',
      restart_delay:      3000,
      max_restarts:       15,
      out_file:    '${INSTALL_DIR}/logs/frontend-out.log',
      error_file:  '${INSTALL_DIR}/logs/frontend-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
EOF
    chown datafast:datafast "${INSTALL_DIR}/ecosystem.dev.config.js"

    info "Iniciando procesos (primera compilación puede tardar 60-90s)..."
    pm2 delete datafast-backend datafast-frontend >> "${LOG_FILE}" 2>&1 || true

    cd "${INSTALL_DIR}"
    sudo -u datafast pm2 start ecosystem.dev.config.js >> "${LOG_FILE}" 2>&1
    sudo -u datafast pm2 save >> "${LOG_FILE}" 2>&1

    # Startup automático al reiniciar
    pm2 startup systemd -u datafast --hp /home/datafast >> "${LOG_FILE}" 2>&1 || true

    sleep 8
    if sudo -u datafast pm2 list | grep -q "online"; then
        ok "Servidores de desarrollo iniciados"
    else
        warn "Los procesos aún están compilando. Verifica con: pm2 logs datafast-backend"
    fi
}
