#!/usr/bin/env bash
# Módulo 07 — Despliegue de la aplicación (producción)

deploy_app() {
    step "Desplegando CRM ISP DATAFAST"
    _ensure_evolution_api_key
    _deploy_code
    _write_backend_env
    _write_frontend_env
    _write_olt_env
    _install_backend
    _install_frontend
    _install_olt_service
    _run_migrations
    _run_seed
    _setup_whatsapp_web
    _setup_evolution_api
}

# ── Código fuente ──────────────────────────────────────────────
_deploy_code() {
    info "Clonando repositorio..."
    local REPO="https://github.com/datafastperu-cmyk/datafast-crm.git"
    local retries=3

    if [[ -d "${INSTALL_DIR}/.git" ]]; then
        info "Código ya presente — actualizando..."
        git -C "${INSTALL_DIR}" pull >> "${LOG_FILE}" 2>&1 || \
            warn "git pull falló — usando versión actual"
        return
    fi

    rm -rf /tmp/datafast-src
    for i in $(seq 1 $retries); do
        if git clone --depth 1 "$REPO" /tmp/datafast-src >> "${LOG_FILE}" 2>&1; then
            break
        fi
        warn "git clone falló (intento ${i}/${retries}) — reintentando en 10s..."
        sleep 10
        [[ $i -eq $retries ]] && error "No se pudo clonar el repositorio después de ${retries} intentos.
    Verifica conectividad a GitHub y que el repo sea accesible."
    done

    cp -r /tmp/datafast-src/backend/.  "${INSTALL_DIR}/backend/"
    cp -r /tmp/datafast-src/frontend/. "${INSTALL_DIR}/frontend/"
    if [[ -d /tmp/datafast-src/olt-automation-service ]]; then
        mkdir -p "${INSTALL_DIR}/olt-automation-service"
        cp -r /tmp/datafast-src/olt-automation-service/. "${INSTALL_DIR}/olt-automation-service/"
        chown -R datafast:datafast "${INSTALL_DIR}/olt-automation-service"
    fi
    if [[ -d /tmp/datafast-src/scripts ]]; then
        cp -r /tmp/datafast-src/scripts/. "${INSTALL_DIR}/scripts/"
        find "${INSTALL_DIR}/scripts" -name "*.sh" -exec chmod +x {} +
    fi
    if [[ -d /tmp/datafast-src/docs ]]; then
        mkdir -p "${INSTALL_DIR}/docs"
        cp -r /tmp/datafast-src/docs/. "${INSTALL_DIR}/docs/"
    fi
    # Mover .git a INSTALL_DIR para habilitar git pull desde ahí
    mv /tmp/datafast-src/.git "${INSTALL_DIR}/.git"
    rm -rf /tmp/datafast-src
    # Permitir que root y datafast accedan al repo (evita "dubious ownership")
    git config --global --add safe.directory "${INSTALL_DIR}" 2>/dev/null || true
    sudo -u datafast git config --global --add safe.directory "${INSTALL_DIR}" 2>/dev/null || true

    chown -R datafast:datafast "${INSTALL_DIR}/backend" "${INSTALL_DIR}/frontend"
    ok "Código desplegado"
}

# ── OLT Automation Service ─────────────────────────────────────────────────────

_write_olt_env() {
    cat > "${INSTALL_DIR}/olt-automation-service/.env" << ENVEOF
APP_NAME=olt-automation-service
APP_VERSION=1.0.0
DEBUG=false
INTERNAL_API_KEY=$(openssl rand -hex 16)
ALLOWED_ORIGINS=http://127.0.0.1:4000,http://localhost:4000
ENVEOF
    chown datafast:datafast "${INSTALL_DIR}/olt-automation-service/.env"
    chmod 600 "${INSTALL_DIR}/olt-automation-service/.env"
    ok "OLT service .env creado"
}

_install_olt_service() {
    step "Instalando OLT Automation Service (Python)"

    info "Instalando dependencias de sistema para OLT service..."
    apt-get install -y -qq python3 python3-pip python3-venv python3-dev \
        libsnmp-dev snmp >> "${LOG_FILE}" 2>&1

    local svc_dir="${INSTALL_DIR}/olt-automation-service"
    cd "$svc_dir"

    info "Creando virtualenv Python..."
    if [[ ! -d venv ]]; then
        sudo -u datafast python3 -m venv venv >> "${LOG_FILE}" 2>&1
    fi

    info "Instalando dependencias Python (pip)..."
    if ! sudo -u datafast bash -c "
        cd '${svc_dir}' &&
        venv/bin/pip install --upgrade pip --quiet &&
        venv/bin/pip install -r requirements.txt --quiet
    " >> "${LOG_FILE}" 2>&1; then
        error "pip install del OLT service falló.
    Revisa el log: ${LOG_FILE}
    Comando manual: cd ${svc_dir} && venv/bin/pip install -r requirements.txt"
    fi

    # cap_net_raw permite a icmplib enviar ICMP sin root
    local py_bin; py_bin=$(readlink -f venv/bin/python3 2>/dev/null || echo "")
    if [[ -n "$py_bin" ]]; then
        setcap cap_net_raw+ep "$py_bin" >> "${LOG_FILE}" 2>&1 && \
            info "cap_net_raw asignado a $py_bin" || \
            warn "setcap falló — ping ICMP requiere root o cap_net_raw manual"
    fi

    ok "OLT Automation Service instalado"
}

# ── Dependencias backend ───────────────────────────────────────
_install_backend() {
    info "Instalando dependencias del backend..."
    cd "${INSTALL_DIR}/backend"

    # Eliminar paquetes con dependencias nativas problemáticas
    if [[ -f package.json ]]; then
        sed -i '/"node-ping"/d'   package.json
        sed -i '/"snmp-native"/d' package.json
    fi

    local retries=3
    for i in $(seq 1 $retries); do
        if sudo -u datafast bash -c "cd '${INSTALL_DIR}/backend' && PUPPETEER_SKIP_DOWNLOAD=true PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true npm install --prefer-offline" >> "${LOG_FILE}" 2>&1; then
            ok "Dependencias backend instaladas"
            break
        fi
        warn "npm install falló (intento ${i}/${retries})..."
        if [[ $i -lt $retries ]]; then
            info "Limpiando caché npm y reintentando..."
            sudo -u datafast npm cache clean --force >> "${LOG_FILE}" 2>&1 || true
            sleep 5
        else
            error "npm install del backend falló después de ${retries} intentos.
    Revisa el log: ${LOG_FILE}
    Comando manual: cd ${INSTALL_DIR}/backend && PUPPETEER_SKIP_DOWNLOAD=true npm install"
        fi
    done

    # Eliminar archivos .js en src/ — evita que SWC Stage-3 (__esDecorate) sobreescriba el output LEGACY correcto
    find "${INSTALL_DIR}/backend/src" -name '*.js' -delete 2>/dev/null || true

    info "Compilando backend con SWC (evita __esDecorate en TypeORM)..."
    sync && echo 3 > /proc/sys/vm/drop_caches 2>/dev/null || true
    local build_retries=2
    for i in $(seq 1 $build_retries); do
        if sudo -u datafast bash -c "cd '${INSTALL_DIR}/backend' && NODE_OPTIONS='--max-old-space-size=1200' node_modules/.bin/nest build --builder swc" >> "${LOG_FILE}" 2>&1; then
            ok "Backend compilado — dist/ listo"
            return
        fi
        warn "Build falló (intento ${i}/${build_retries})..."
        sync && echo 3 > /proc/sys/vm/drop_caches 2>/dev/null || true
        sleep 10
    done

    echo -e "\n${R}[✗] Error de compilación — últimas 50 líneas:${NC}" >&2
    tail -50 "${LOG_FILE}" >&2
    error "nest build del backend falló.
    Revisa errores TypeScript arriba.
    Comando manual: cd ${INSTALL_DIR}/backend && NODE_OPTIONS='--max-old-space-size=1200' node_modules/.bin/nest build"
}

# ── Dependencias frontend ──────────────────────────────────────
_install_frontend() {
    info "Instalando dependencias del frontend..."
    cd "${INSTALL_DIR}/frontend"

    local retries=3
    for i in $(seq 1 $retries); do
        if sudo -u datafast npm install --prefer-offline >> "${LOG_FILE}" 2>&1; then
            ok "Dependencias frontend instaladas"
            break
        fi
        warn "npm install frontend falló (intento ${i}/${retries})..."
        [[ $i -lt $retries ]] && { sudo -u datafast npm cache clean --force >> "${LOG_FILE}" 2>&1 || true; sleep 5; } \
            || error "npm install del frontend falló después de ${retries} intentos."
    done

    info "Compilando frontend (Next.js build, puede tardar 3-8 min)..."
    sync && echo 3 > /proc/sys/vm/drop_caches 2>/dev/null || true
    if ! sudo -u datafast bash -c "cd '${INSTALL_DIR}/frontend' && NODE_ENV=production NODE_OPTIONS='--max-old-space-size=1200' node_modules/.bin/next build" >> "${LOG_FILE}" 2>&1; then
        echo -e "\n${R}[✗] Error de compilación Next.js — últimas 30 líneas:${NC}" >&2
        tail -30 "${LOG_FILE}" >&2
        error "next build del frontend falló.
    Comando manual: cd ${INSTALL_DIR}/frontend && NODE_OPTIONS='--max-old-space-size=1200' node_modules/.bin/next build"
    fi
    ok "Frontend compilado — .next/ listo"
}

# ── Migraciones ────────────────────────────────────────────────
# Usa node con dist/ ya compilado — sin ts-node, sin cargar entidades → evita OOM en VPS ≤2GB
_run_migrations() {
    info "Ejecutando migraciones de base de datos..."
    cd "${INSTALL_DIR}/backend"
    [[ -f .env.production ]] && { set -a; source .env.production; set +a; }

    # Esperar a que la BD esté disponible (hasta 60s)
    info "Esperando disponibilidad de la base de datos..."
    local tries=20
    for i in $(seq 1 $tries); do
        if PGPASSWORD="${DB_PASSWORD:-}" psql -h "${DB_HOST:-localhost}" \
            -U "${DB_USER:-datafast_db_user}" \
            -d "${DB_NAME:-datafast_db}" -c "SELECT 1;" &>/dev/null; then
            break
        fi
        [[ $i -eq $tries ]] && error "PostgreSQL no respondió en 60s.
    Verifica con: systemctl status postgresql"
        sleep 3
    done

    # Script Node.js — carga migraciones compiladas desde dist/ (no ts-node, no entidades)
    local tmp_script="${INSTALL_DIR}/backend/_run_migrations.js"
    cat > "$tmp_script" << 'MIGJS'
const path = require('path');
require('dotenv').config({ path: path.join(process.cwd(), '.env.production') });
const { DataSource } = require('typeorm');
const ds = new DataSource({
  type:                'postgres',
  host:                process.env.DB_HOST     || 'localhost',
  port:                parseInt(process.env.DB_PORT || '5432', 10),
  database:            process.env.DB_NAME     || 'datafast_db',
  username:            process.env.DB_USER     || 'datafast_db_user',
  password:            process.env.DB_PASSWORD,
  ssl:                 process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  entities:            [],
  migrations:          [path.join(process.cwd(), 'dist', 'database', 'migrations', '*.js')],
  migrationsTableName: 'typeorm_migrations',
  synchronize:         false,
  logging:             true,
});
ds.initialize()
  .then(() => ds.runMigrations({ transaction: 'each' }))
  .then(ran => { console.log('Migraciones aplicadas: ' + ran.length); return ds.destroy(); })
  .then(() => process.exit(0))
  .catch(err => { console.error('Error en migraciones: ' + err.message); process.exit(1); });
MIGJS
    chown datafast:datafast "$tmp_script"

    local retries=3
    for i in $(seq 1 $retries); do
        sync && echo 3 > /proc/sys/vm/drop_caches 2>/dev/null || true
        if sudo -u datafast bash -c "cd '${INSTALL_DIR}/backend' && node _run_migrations.js" >> "${LOG_FILE}" 2>&1; then
            ok "Migraciones ejecutadas"
            rm -f "$tmp_script"
            return
        fi
        warn "Migraciones fallaron (intento ${i}/${retries}) — reintentando en 15s..."
        sleep 15
    done
    rm -f "$tmp_script"
    warn "No se pudieron ejecutar las migraciones automáticamente.
    Comando manual: cd ${INSTALL_DIR}/backend && node _run_migrations.js"
}

# ── Seed ───────────────────────────────────────────────────────
_run_seed() {
    info "Verificando datos iniciales..."
    cd "${INSTALL_DIR}/backend"
    [[ -f .env.production ]] && { set -a; source .env.production; set +a; }

    local count
    count=$(PGPASSWORD="${DB_PASSWORD}" psql -h localhost -U datafast_db_user \
        -d datafast_db -t -c "SELECT COUNT(*) FROM empresas;" 2>/dev/null \
        | tr -d ' \n' || echo "0")

    if [[ "${count}" == "0" ]]; then
        if sudo -u datafast npm run seed:run >> "${LOG_FILE}" 2>&1; then
            ok "Datos iniciales creados"
        else
            warn "Seed falló — el sistema puede iniciar sin datos de prueba"
        fi
    else
        ok "Base de datos ya tiene datos (${count} empresa(s)) — seed omitido"
    fi
}

# ── WhatsApp Web: Chrome + directorios ────────────────────────
_setup_whatsapp_web() {
    step "Configurando WhatsApp Web (Chrome + directorios)"

    # Dependencias de sistema requeridas por Chrome headless
    info "Instalando dependencias de sistema para Chrome headless..."
    apt-get install -y -qq \
        fonts-liberation libatk-bridge2.0-0 libatk1.0-0 libcairo2 \
        libcups2 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0 \
        libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 libx11-6 \
        libxcb1 libxcomposite1 libxdamage1 libxext6 libxfixes3 \
        libxkbcommon0 libxrandr2 xdg-utils \
        >> "${LOG_FILE}" 2>&1

    # Instalar Google Chrome Stable si no hay ningún Chrome/Chromium disponible
    if ! command -v google-chrome-stable &>/dev/null && \
       ! command -v google-chrome &>/dev/null && \
       ! command -v chromium &>/dev/null && \
       ! command -v chromium-browser &>/dev/null; then

        info "Instalando Google Chrome Stable..."
        local deb="/tmp/google-chrome-stable.deb"
        if wget -qO "$deb" \
            "https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb" \
            >> "${LOG_FILE}" 2>&1; then
            apt-get install -y -qq "$deb" >> "${LOG_FILE}" 2>&1 || \
                apt-get install -y -f -qq  >> "${LOG_FILE}" 2>&1
            rm -f "$deb"
        else
            warn "No se pudo descargar Chrome — instalando Chromium como alternativa..."
            apt-get install -y -qq chromium-browser >> "${LOG_FILE}" 2>&1 || \
                apt-get install -y -qq chromium       >> "${LOG_FILE}" 2>&1 || \
                warn "Chromium tampoco disponible — WhatsApp Web no funcionará hasta instalar Chrome manualmente"
        fi

        if command -v google-chrome-stable &>/dev/null; then
            ok "Google Chrome instalado: $(google-chrome-stable --version 2>/dev/null || echo 'versión desconocida')"
        elif command -v chromium-browser &>/dev/null || command -v chromium &>/dev/null; then
            ok "Chromium instalado como alternativa a Chrome"
        fi
    else
        ok "Chrome/Chromium ya presente — se omite instalación"
    fi

    # Crear directorios de sesión y caché de WhatsApp Web
    info "Creando directorios para sesión y media de WhatsApp Web..."
    mkdir -p \
        /opt/datafast/.wwebjs_auth \
        /opt/datafast/.wwebjs_cache \
        /opt/datafast/backend/public/crm_whatsapp
    chown -R datafast:datafast \
        /opt/datafast/.wwebjs_auth \
        /opt/datafast/.wwebjs_cache \
        /opt/datafast/backend/public
    chmod 750 /opt/datafast/.wwebjs_auth /opt/datafast/.wwebjs_cache
    chmod 755 /opt/datafast/backend/public/crm_whatsapp
    ok "Directorios WhatsApp Web creados"

    info "IMPORTANTE: al iniciar el backend por primera vez, ve a"
    info "  /mensajeria/whatsapp y escanea el QR con tu celular para"
    info "  vincular el número de WhatsApp. La sesión queda guardada"
    info "  en /opt/datafast/.wwebjs_auth y no se repite salvo reset."
}

# ── Evolution API ──────────────────────────────────────────────
_ensure_evolution_api_key() {
    if [[ -z "${EVOLUTION_API_KEY:-}" ]]; then
        EVOLUTION_API_KEY=$(openssl rand -hex 16)
        export EVOLUTION_API_KEY
        info "EVOLUTION_API_KEY generada automáticamente"
    fi
}

_setup_evolution_api() {
    step "Levantando Evolution API (WhatsApp self-hosted)"

    if ! command -v docker &>/dev/null; then
        info "Instalando Docker Engine..."
        curl -fsSL https://get.docker.com | sh >> "${LOG_FILE}" 2>&1
        systemctl enable --now docker >> "${LOG_FILE}" 2>&1
        ok "Docker instalado"
    fi

    mkdir -p /opt/datafast/evolution
    docker rm -f datafast-evolution >> "${LOG_FILE}" 2>&1 || true

    local retries=2
    for i in $(seq 1 $retries); do
        if docker run -d \
            --name datafast-evolution \
            --restart unless-stopped \
            -p 127.0.0.1:8080:8080 \
            -v /opt/datafast/evolution:/evolution/instances \
            -e SERVER_URL="http://localhost:8080" \
            -e AUTHENTICATION_API_KEY="${EVOLUTION_API_KEY}" \
            -e AUTHENTICATION_TYPE=apikey \
            -e STORE_MESSAGES=false \
            -e STORE_MESSAGE_UP=false \
            -e STORE_CONTACTS=false \
            -e DEL_INSTANCE=false \
            -e LOG_LEVEL=WARN \
            -e TZ=America/Lima \
            atendai/evolution-api:v2.2.3 >> "${LOG_FILE}" 2>&1; then
            break
        fi
        warn "docker run Evolution API falló (intento ${i}/${retries})..."
        sleep 5
        [[ $i -eq $retries ]] && { warn "Evolution API no pudo iniciarse — WhatsApp no disponible hasta revisar Docker"; return; }
    done

    # Health check con timeout
    local tries=20
    for i in $(seq 1 $tries); do
        if curl -sf --max-time 3 "http://localhost:8080/" &>/dev/null; then
            ok "Evolution API disponible en localhost:8080"
            return
        fi
        sleep 3
    done
    warn "Evolution API no respondió en 60s — revisa: docker logs datafast-evolution"
}

# ── Variables de entorno ───────────────────────────────────────
_write_backend_env() {
    # Dirección elegida en _prepare_config (VPS pública, LAN local o dominio)
    local ip; ip="${PUBLIC_IP:-$(hostname -I | awk '{print $1}')}"
    local frontend_url="http://${ip}"
    [[ -n "${DOMINIO_FRONTEND:-}" ]] && frontend_url="https://${DOMINIO_FRONTEND}"
    local api_url="http://${ip}:4000"
    [[ -n "${DOMINIO_BACKEND:-}" ]] && api_url="https://${DOMINIO_BACKEND}"

    cat > "${INSTALL_DIR}/backend/.env.production" << ENVEOF
NODE_ENV=production
PORT=4000
TZ=America/Lima

APP_URL=${api_url}
FRONTEND_URL=${frontend_url}
ALLOWED_ORIGINS=${frontend_url}

DB_HOST=localhost
DB_PORT=5432
DB_NAME=datafast_db
DB_USER=datafast_db_user
DB_PASSWORD=${DB_PASSWORD}
DB_SSL=false

REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=${REDIS_PASSWORD}

JWT_SECRET=${JWT_SECRET}
JWT_EXPIRES_IN=15m
JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}
JWT_REFRESH_EXPIRES_IN=7d

ENCRYPTION_KEY=${ENCRYPTION_KEY}

EVOLUTION_API_URL=http://localhost:8080
EVOLUTION_API_KEY=${EVOLUTION_API_KEY}

OLT_SERVICE_URL=http://127.0.0.1:8001

LOG_LEVEL=warn

# ── WhatsApp Web (whatsapp-web.js) ─────────────────────────────
WA_SESSION_PATH=/opt/datafast/.wwebjs_auth
WA_CACHE_PATH=/opt/datafast/.wwebjs_cache
MEDIA_DIR=/opt/datafast/backend/public/crm_whatsapp
ENVEOF
    chmod 600 "${INSTALL_DIR}/backend/.env.production"
    ok "Backend .env.production creado"
}

_write_frontend_env() {
    # Dirección elegida en _prepare_config (VPS pública, LAN local o dominio)
    local ip; ip="${PUBLIC_IP:-$(hostname -I | awk '{print $1}')}"
    local api_url="http://${ip}:4000"
    [[ -n "${DOMINIO_BACKEND:-}" ]] && api_url="https://${DOMINIO_BACKEND}"

    cat > "${INSTALL_DIR}/frontend/.env.production" << ENVEOF
NEXT_PUBLIC_API_URL=${api_url}
NEXT_PUBLIC_WS_URL=${api_url/http/ws}
NEXT_PUBLIC_APP_NAME=${EMPRESA_NOMBRE:-CRM ISP DATAFAST}
NEXT_PUBLIC_VERSION=${DATAFAST_VERSION}
NEXT_TELEMETRY_DISABLED=1
ENVEOF
    chown datafast:datafast "${INSTALL_DIR}/frontend/.env.production"
    chmod 640 "${INSTALL_DIR}/frontend/.env.production"
    ok "Frontend .env.production creado"
}

upgrade_app() {
    step "Actualizando DATAFAST"
    "${INSTALL_DIR}/scripts/backup.sh" >> "${LOG_FILE}" 2>&1 || warn "Backup previo falló — continuando actualización"
    _deploy_code
    _install_backend
    _install_frontend
    _install_olt_service
    _run_migrations

    # Recargar/iniciar procesos (startOrRestart tolera procesos caídos o inexistentes)
    local eco="${INSTALL_DIR}/ecosystem.config.js"
    if [[ -f "$eco" ]]; then
        sudo -u datafast pm2 startOrReload  "$eco" --only datafast-backend        >> "${LOG_FILE}" 2>&1 || \
            sudo -u datafast pm2 start      "$eco" --only datafast-backend        >> "${LOG_FILE}" 2>&1 || true
        sudo -u datafast pm2 startOrRestart "$eco" --only datafast-frontend       >> "${LOG_FILE}" 2>&1 || \
            sudo -u datafast pm2 start      "$eco" --only datafast-frontend       >> "${LOG_FILE}" 2>&1 || true
        pm2 startOrRestart                  "$eco" --only olt-automation-service  >> "${LOG_FILE}" 2>&1 || true
    else
        sudo -u datafast pm2 reload  datafast-backend      >> "${LOG_FILE}" 2>&1 || true
        sudo -u datafast pm2 restart datafast-frontend     >> "${LOG_FILE}" 2>&1 || true
        pm2 restart olt-automation-service                 >> "${LOG_FILE}" 2>&1 || true
    fi
    sudo -u datafast pm2 save >> "${LOG_FILE}" 2>&1 || true
    ok "DATAFAST actualizado"
}
