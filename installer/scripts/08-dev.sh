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
// CRM ISP DATAFAST — PM2 Dev (dist pre-compilado)
// Generado: $(date)
module.exports = {
  apps: [
    {
      name:      'datafast-backend',
      script:    'node',
      args:      'dist/main.js',
      cwd:       '${INSTALL_DIR}/backend',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV:     'development',
        PORT:         4000,
        TZ:           'America/Lima',
        NODE_OPTIONS: '--max-old-space-size=1400',
      },
      watch:              false,
      max_memory_restart: '1500M',
      restart_delay:      5000,
      max_restarts:       5,
      kill_timeout:       5000,
      out_file:    '${INSTALL_DIR}/logs/backend-out.log',
      error_file:  '${INSTALL_DIR}/logs/backend-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
    {
      name:        'olt-automation-service',
      script:      '${INSTALL_DIR}/olt-automation-service/venv/bin/uvicorn',
      args:        'app.main:app --host 127.0.0.1 --port 8001 --reload',
      cwd:         '${INSTALL_DIR}/olt-automation-service',
      interpreter: 'none',
      exec_mode:   'fork',
      instances:   1,
      env_file: '${INSTALL_DIR}/olt-automation-service/.env',
      env: {
        PYTHONPATH: '${INSTALL_DIR}/olt-automation-service',
        TZ:         'America/Lima',
      },
      max_memory_restart: '256M',
      restart_delay:      5000,
      max_restarts:       5,
      kill_timeout:       5000,
      out_file:    '${INSTALL_DIR}/logs/olt-out.log',
      error_file:  '${INSTALL_DIR}/logs/olt-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      watch: false,
    },
    {
      name:    'datafast-frontend',
      script:  'node_modules/.bin/next',
      args:    'start',
      cwd:     '${INSTALL_DIR}/frontend',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV:  'production',
        PORT:      3000,
        TZ:        'America/Lima',
      },
      watch:              false,
      max_memory_restart: '1500M',
      restart_delay:      8000,
      max_restarts:       10,
      kill_timeout:       5000,
      listen_timeout:     30000,
      wait_ready:         false,
      out_file:    '${INSTALL_DIR}/logs/frontend-out.log',
      error_file:  '${INSTALL_DIR}/logs/frontend-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
EOF
    chown root:root "${INSTALL_DIR}/ecosystem.dev.config.js"

    info "Iniciando procesos con PM2..."
    # Matar cualquier PM2 existente del usuario datafast para evitar conflicto de daemons
    sudo -u datafast pm2 kill >> "${LOG_FILE}" 2>&1 || true
    pm2 delete datafast-backend datafast-frontend olt-automation-service >> "${LOG_FILE}" 2>&1 || true

    cd "${INSTALL_DIR}"
    pm2 start ecosystem.dev.config.js >> "${LOG_FILE}" 2>&1
    pm2 save >> "${LOG_FILE}" 2>&1

    # Startup automático al reiniciar
    pm2 startup systemd >> "${LOG_FILE}" 2>&1 || true

    sleep 10
    if pm2 list | grep -q "online"; then
        ok "Servidores iniciados"
    else
        warn "Los procesos no están online. Verifica con: pm2 logs datafast-backend"
    fi
}
