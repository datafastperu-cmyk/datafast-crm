#!/usr/bin/env bash
# Módulo 08 — PM2 Process Manager (producción)

setup_pm2() {
    step "Configurando PM2 Process Manager"

    local eco="${INSTALL_DIR}/ecosystem.config.js"

    # ── El ecosystem NO se genera: viene del repositorio ───────────────────────
    #
    # INCIDENTE B-14 (detectado 2026-08-08, corregido aquí). Esta función GENERABA su
    # propio ecosystem.config.js y lo escribía encima del que acababa de traer
    # `deploy_app` desde el repositorio. Los dos declaraban procesos distintos, y ganaba
    # el generado aquí:
    #
    #     repositorio → datafast-api-core (RUN_CRONS=false) + datafast-worker-auxiliary
    #                   (RUN_CRONS=true) + whatsapp + olt + frontend, todos en fork
    #     generado    → un único 'datafast-backend' en cluster, SIN RUN_CRONS
    #
    # Consecuencia: **toda instalación nueva nacía sin worker**. Ningún cron llegaba a
    # ejecutarse —todos empiezan con `if (process.env.RUN_CRONS !== 'true') return;`—, así
    # que no se emitían facturas, no se cortaba a ningún moroso, no se reactivaba a nadie
    # al pagar y no se drenaba el outbox hacia la OLT ni MikroTik. Sin un solo error: el
    # ERP respondía con normalidad y no hacía nada por su cuenta.
    #
    # Y como el fichero está VERSIONADO, sobrescribirlo dejaba el árbol sucio y el primer
    # `git pull` de una actualización fallaba por cambios locales.
    #
    # ADR-011 ya decía que el ecosystem es la fuente de verdad única del arranque. Había
    # dos autores para el mismo fichero y no se conocían entre sí.
    #
    # Sus rutas se derivan de `__dirname`, así que sirve con cualquier INSTALL_DIR y no
    # hay nada que interpolar. Lo que cambia por servidor va en los `.env`.

    [[ -f "$eco" ]] || error "No existe ${eco}.
    Debe venir del repositorio (paso deploy_app). Sin él no se puede arrancar nada."

    # Se VERIFICA que declara los procesos esperados en vez de darlo por hecho: si alguien
    # deja aquí un ecosystem antiguo o a medias, es mejor fallar la instalación que
    # entregar un ERP que arranca y no trabaja.
    local declarados
    declarados=$(node -e "
      const apps = require('$eco').apps || [];
      console.log(apps.map(a => a.name).join(' '));
    " 2>/dev/null) || error "No se pudo leer ${eco} — ¿es un JS válido?"

    info "Procesos declarados: ${declarados:-(ninguno)}"

    local faltan=""
    for req in datafast-api-core datafast-worker-auxiliary datafast-frontend; do
        [[ " $declarados " == *" $req "* ]] || faltan="$faltan $req"
    done
    [[ -z "$faltan" ]] || error "El ecosystem no declara:${faltan}.
    Sin 'datafast-worker-auxiliary' el ERP no ejecuta NINGUNA tarea automática:
    ni facturación, ni cortes por mora, ni reactivaciones, ni drenado hacia OLT/MikroTik.
    Revisa ${eco} contra el del repositorio."

    # El worker es quien ejecuta los crons, y eso lo decide RUN_CRONS. Comprobarlo aquí
    # es barato; descubrirlo en producción cuesta días de facturación sin emitir.
    local crons_worker
    crons_worker=$(node -e "
      const apps = require('$eco').apps || [];
      const w = apps.find(a => a.name === 'datafast-worker-auxiliary');
      console.log(String(w && w.env && w.env.RUN_CRONS));
    " 2>/dev/null)
    [[ "$crons_worker" == "true" ]] || error "datafast-worker-auxiliary no tiene RUN_CRONS='true' (vale: ${crons_worker}).
    Arrancaría sin ejecutar una sola tarea automática."

    ok "Ecosystem del repositorio verificado (worker con RUN_CRONS=true)"
    chown datafast:datafast "$eco"

    # ── Iniciar procesos ───────────────────────────────────────
    info "Iniciando procesos con PM2..."
    # Se borran por los nombres que el ecosystem declara AHORA, leidos de el. Antes
    # decia `datafast-backend`, un proceso que ya no existe: el delete no encontraba nada,
    # PM2 no falla por eso, y quedaban procesos viejos conviviendo con los nuevos.
    sudo -u datafast pm2 delete ${declarados} >> "${LOG_FILE}" 2>&1 || true

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
    warn "Verifica con: pm2 logs datafast-api-core --lines 30"
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
