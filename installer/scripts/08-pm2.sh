#!/usr/bin/env bash
# Módulo 08 — PM2 Process Manager (producción)

setup_pm2() {
    step "Configurando PM2 Process Manager"

    local cpus; cpus=$(nproc)
    local instances=1
    [[ $cpus -ge 4 ]] && instances=3
    [[ $cpus -ge 2 && $cpus -lt 4 ]] && instances=2

    # ── ecosystem.config.js ────────────────────────────────────
    info "Generando ecosystem.config.js..."
    cat > "${INSTALL_DIR}/ecosystem.config.js" << EOF
// CRM ISP DATAFAST — PM2 Ecosystem (producción)
// Generado: $(date)
// Instancias backend: ${instances} (CPUs: ${cpus})

module.exports = {
  apps: [

    // ── Backend NestJS ────────────────────────────────────────
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

      max_memory_restart:        '900M',
      restart_delay:             5000,
      exp_backoff_restart_delay: 100,
      max_restarts:              10,
      min_uptime:                '10s',

      wait_ready:      true,
      listen_timeout:  20000,
      kill_timeout:    10000,

      out_file:        '${INSTALL_DIR}/logs/backend-out.log',
      error_file:      '${INSTALL_DIR}/logs/backend-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs:      true,

      node_args: ['--max-old-space-size=768', '--optimize-for-size'],
      watch:     false,
    },

    // ── OLT Automation Service (Python/FastAPI) ───────────────
    {
      name:        'olt-automation-service',
      script:      '${INSTALL_DIR}/olt-automation-service/venv/bin/uvicorn',
      args:        'app.main:app --host 127.0.0.1 --port 8001 --workers 2',
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
      max_restarts:       10,
      min_uptime:         '10s',

      out_file:        '${INSTALL_DIR}/logs/olt-out.log',
      error_file:      '${INSTALL_DIR}/logs/olt-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs:      true,
      watch:           false,
    },

    // ── Frontend Next.js ──────────────────────────────────────
    {
      name:      'datafast-frontend',
      script:    'node_modules/.bin/next',
      args:      'start',
      cwd:       '${INSTALL_DIR}/frontend',
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

      out_file:        '${INSTALL_DIR}/logs/frontend-out.log',
      error_file:      '${INSTALL_DIR}/logs/frontend-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      watch:           false,
    },
  ],
};
EOF
    chown datafast:datafast "${INSTALL_DIR}/ecosystem.config.js"

    # ── Iniciar procesos ───────────────────────────────────────
    info "Iniciando procesos con PM2..."
    sudo -u datafast pm2 delete datafast-backend datafast-frontend olt-automation-service >> "${LOG_FILE}" 2>&1 || true

    cd "${INSTALL_DIR}"
    if ! sudo -u datafast pm2 start ecosystem.config.js >> "${LOG_FILE}" 2>&1; then
        error "PM2 no pudo iniciar los procesos.
    Revisa el log: ${LOG_FILE}
    Comando manual: cd ${INSTALL_DIR} && pm2 start ecosystem.config.js"
    fi
    sudo -u datafast pm2 save >> "${LOG_FILE}" 2>&1

    # ── Systemd ────────────────────────────────────────────────
    info "Creando servicio systemd para PM2..."
    cat > /etc/systemd/system/datafast.service << 'EOF'
[Unit]
Description=CRM ISP DATAFAST (via PM2)
After=network.target network-online.target
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
TimeoutStartSec=90
TimeoutStopSec=60

[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload   >> "${LOG_FILE}" 2>&1
    systemctl enable datafast >> "${LOG_FILE}" 2>&1
    systemctl start  datafast >> "${LOG_FILE}" 2>&1 || true

    # ── Healthcheck real post-arranque ─────────────────────────
    _wait_for_backend
    _wait_for_frontend
    _wait_for_olt

    # ── Logrotate ─────────────────────────────────────────────
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
    ok "PM2 configurado (${instances} instancias backend, logrotate 30 días)"
}

_wait_for_backend() {
    info "Esperando que el backend responda en /api/v1/health..."
    local tries=30   # 90s máximo
    for i in $(seq 1 $tries); do
        local code
        code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 \
            http://localhost:4000/health/live 2>/dev/null || echo "000")
        if [[ "$code" == "200" ]]; then
            ok "Backend respondiendo (HTTP 200)"
            return
        fi
        [[ $((i % 5)) -eq 0 ]] && info "  ...esperando backend (${i}/${tries}) — HTTP ${code}"
        sleep 3
    done
    warn "Backend no respondió en 90s — puede estar compilando aún"
    warn "Verifica con: pm2 logs datafast-backend --lines 30"
}

_wait_for_olt() {
    info "Esperando que el OLT service responda en /api/v1/health..."
    local tries=20   # 60s máximo
    for i in $(seq 1 $tries); do
        local code
        code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 \
            http://127.0.0.1:8001/api/v1/health 2>/dev/null || echo "000")
        if [[ "$code" == "200" ]]; then
            ok "OLT service respondiendo (HTTP 200)"
            return
        fi
        [[ $((i % 5)) -eq 0 ]] && info "  ...esperando OLT service (${i}/${tries}) — HTTP ${code}"
        sleep 3
    done
    warn "OLT service no respondió en 60s"
    warn "Verifica con: pm2 logs olt-automation-service --lines 30"
}

_wait_for_frontend() {
    info "Esperando que el frontend responda..."
    local tries=20   # 60s máximo
    for i in $(seq 1 $tries); do
        local code
        code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 \
            http://localhost:3000 2>/dev/null || echo "000")
        if [[ "$code" =~ ^(200|307|302)$ ]]; then
            ok "Frontend respondiendo (HTTP ${code})"
            return
        fi
        [[ $((i % 5)) -eq 0 ]] && info "  ...esperando frontend (${i}/${tries}) — HTTP ${code}"
        sleep 3
    done
    warn "Frontend no respondió en 60s"
    warn "Verifica con: pm2 logs datafast-frontend --lines 30"
}
