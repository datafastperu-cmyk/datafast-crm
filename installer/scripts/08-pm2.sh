#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  Módulo 08 — PM2 Process Manager
# ─────────────────────────────────────────────────────────────────────────────

setup_pm2() {
    step "Configurando PM2 Process Manager"

    local cpus; cpus=$(nproc)
    local instances=1
    [[ $cpus -ge 4 ]] && instances=3
    [[ $cpus -ge 2 ]] && [[ $cpus -lt 4 ]] && instances=2

    # ── ecosystem.config.js ───────────────────────────────────────────────
    info "Generando ecosystem.config.js..."
    cat > "${INSTALL_DIR}/ecosystem.config.js" << EOF
// CRM ISP DATAFAST — PM2 Ecosystem
// Generado: $(date)
// Instancias backend: ${instances} (CPUs disponibles: ${cpus})

module.exports = {
  apps: [

    // ── Backend NestJS ────────────────────────────────────────────────────
    {
      name:       'datafast-backend',
      script:     './dist/main.js',
      cwd:        '${INSTALL_DIR}/backend',
      instances:  ${instances},
      exec_mode:  'cluster',

      env_file: '${INSTALL_DIR}/backend/.env.production',
      env: {
        NODE_ENV:           'production',
        PORT:               4000,
        UV_THREADPOOL_SIZE: 8,
        TZ:                 'America/Lima',
      },

      // Gestión de memoria y estabilidad
      max_memory_restart:        '900M',
      restart_delay:             5000,
      exp_backoff_restart_delay: 100,
      max_restarts:              10,
      min_uptime:                '10s',

      // Zero-downtime reload
      wait_ready:      true,
      listen_timeout:  15000,
      kill_timeout:    10000,

      // Logs
      log_file:        '${INSTALL_DIR}/logs/backend-combined.log',
      out_file:        '${INSTALL_DIR}/logs/backend-out.log',
      error_file:      '${INSTALL_DIR}/logs/backend-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs:      true,
      log_type:        'json',

      // Node.js flags de rendimiento
      node_args: [
        '--max-old-space-size=768',
        '--optimize-for-size',
      ],

      // Watch (deshabilitado en producción)
      watch:          false,
      ignore_watch:   ['node_modules', 'logs', '.git'],
    },

    // ── Frontend Next.js ──────────────────────────────────────────────────
    {
      name:    'datafast-frontend',
      script:  'node_modules/.bin/next',
      args:    'start',
      cwd:     '${INSTALL_DIR}/frontend',
      instances: 1,
      exec_mode: 'fork',

      env_file: '${INSTALL_DIR}/frontend/.env.production',
      env: {
        NODE_ENV: 'production',
        PORT:     3000,
        HOSTNAME: '0.0.0.0',
        TZ:       'America/Lima',
      },

      max_memory_restart: '512M',
      restart_delay:      5000,
      max_restarts:       10,
      min_uptime:         '10s',

      log_file:        '${INSTALL_DIR}/logs/frontend-combined.log',
      out_file:        '${INSTALL_DIR}/logs/frontend-out.log',
      error_file:      '${INSTALL_DIR}/logs/frontend-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      watch: false,
    },
  ],
};
EOF
    chown datafast:datafast "${INSTALL_DIR}/ecosystem.config.js"

    # ── Iniciar procesos ──────────────────────────────────────────────────
    info "Iniciando procesos con PM2..."
    cd "${INSTALL_DIR}"
    sudo -u datafast pm2 start ecosystem.config.js >> "${LOG_FILE}" 2>&1
    sudo -u datafast pm2 save >> "${LOG_FILE}" 2>&1

    # ── Unidad systemd para PM2 ───────────────────────────────────────────
    info "Creando servicio systemd para PM2..."
    cat > /etc/systemd/system/datafast.service << 'EOF'
[Unit]
Description=CRM ISP DATAFAST (via PM2)
After=network.target network-online.target postgresql.service redis-server.service
Requires=postgresql.service redis-server.service
Wants=network-online.target

[Service]
Type=forking
User=datafast
Group=datafast
LimitNOFILE=65536
PIDFile=/home/datafast/.pm2/pm2.pid
Restart=on-failure
RestartSec=10
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Environment=PM2_HOME=/home/datafast/.pm2
ExecStart=/usr/bin/pm2 resurrect
ExecReload=/usr/bin/pm2 reload all
ExecStop=/usr/bin/pm2 kill
TimeoutStartSec=60
TimeoutStopSec=60

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload   >> "${LOG_FILE}" 2>&1
    systemctl enable datafast >> "${LOG_FILE}" 2>&1
    systemctl start  datafast >> "${LOG_FILE}" 2>&1

    # ── Verificar que los procesos están corriendo ────────────────────────
    sleep 5
    if sudo -u datafast pm2 list | grep -q "online"; then
        ok "PM2 iniciado correctamente (${instances} instancias del backend)"
    else
        warn "PM2 arrancó pero los procesos no están online. Revisa los logs."
    fi

    # ── Configurar logrotate para PM2 ─────────────────────────────────────
    info "Configurando rotación de logs..."
    cat > /etc/logrotate.d/datafast << EOF
${INSTALL_DIR}/logs/*.log {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    create 0640 datafast datafast
    sharedscripts
    postrotate
        sudo -u datafast pm2 reloadLogs 2>/dev/null || true
    endscript
}
EOF
    ok "Logrotate configurado (retención 30 días)"
}
