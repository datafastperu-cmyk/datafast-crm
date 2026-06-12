#!/usr/bin/env bash
# Módulo 07 — Despliegue de la aplicación (producción)

deploy_app() {
    step "Desplegando CRM ISP DATAFAST"
    _ensure_evolution_api_key
    _deploy_code
    _write_backend_env
    _write_frontend_env
    _install_backend
    _install_frontend
    _run_migrations
    _run_seed
    _setup_evolution_api
}

# ── Código fuente ──────────────────────────────────────────────
_deploy_code() {
    info "Clonando repositorio..."
    local REPO="https://github.com/datafastperu-cmyk/datafast-crm.git"
    local retries=3

    if [[ -d "${INSTALL_DIR}/backend/src" ]]; then
        info "Código ya presente — actualizando..."
        git -C "${INSTALL_DIR}/backend" pull >> "${LOG_FILE}" 2>&1 || \
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
    if [[ -d /tmp/datafast-src/scripts ]]; then
        cp -r /tmp/datafast-src/scripts/. "${INSTALL_DIR}/scripts/"
        find "${INSTALL_DIR}/scripts" -name "*.sh" -exec chmod +x {} +
    fi
    if [[ -d /tmp/datafast-src/docs ]]; then
        mkdir -p "${INSTALL_DIR}/docs"
        cp -r /tmp/datafast-src/docs/. "${INSTALL_DIR}/docs/"
    fi
    rm -rf /tmp/datafast-src

    chown -R datafast:datafast "${INSTALL_DIR}/backend" "${INSTALL_DIR}/frontend"
    ok "Código desplegado"
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
        if sudo -u datafast bash -c "cd '${INSTALL_DIR}/backend' && NODE_OPTIONS='--max-old-space-size=1200' node_modules/.bin/nest build" >> "${LOG_FILE}" 2>&1; then
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
_run_migrations() {
    info "Ejecutando migraciones de base de datos..."
    cd "${INSTALL_DIR}/backend"
    [[ -f .env.production ]] && { set -a; source .env.production; set +a; }

    # Esperar a que la BD esté disponible (hasta 60s)
    info "Esperando disponibilidad de la base de datos..."
    local tries=20
    for i in $(seq 1 $tries); do
        if PGPASSWORD="${DB_PASSWORD}" psql -h localhost -U datafast_db_user \
            -d datafast_db -c "SELECT 1;" &>/dev/null; then
            break
        fi
        [[ $i -eq $tries ]] && error "PostgreSQL no respondió en 60s.
    Verifica con: systemctl status postgresql
    O con: docker logs datafast-postgres"
        sleep 3
    done

    local migrate_cmd="set -a; source '${INSTALL_DIR}/backend/.env.production'; set +a; cd '${INSTALL_DIR}/backend' && npm run migration:run"
    local retries=3
    for i in $(seq 1 $retries); do
        sync && echo 3 > /proc/sys/vm/drop_caches 2>/dev/null || true
        if sudo -u datafast bash -c "$migrate_cmd" >> "${LOG_FILE}" 2>&1; then
            ok "Migraciones ejecutadas"
            return
        fi
        warn "Migraciones fallaron (intento ${i}/${retries}) — reintentando en 15s..."
        sleep 15
    done
    warn "No se pudieron ejecutar las migraciones automáticamente.
    Comando manual: cd ${INSTALL_DIR}/backend && npm run migration:run"
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
    local ip; ip=$(hostname -I | awk '{print $1}')
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

LOG_LEVEL=warn
ENVEOF
    chmod 600 "${INSTALL_DIR}/backend/.env.production"
    ok "Backend .env.production creado"
}

_write_frontend_env() {
    local ip; ip=$(hostname -I | awk '{print $1}')
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
    _run_migrations
    sudo -u datafast pm2 reload datafast-backend  >> "${LOG_FILE}" 2>&1 || true
    sudo -u datafast pm2 restart datafast-frontend >> "${LOG_FILE}" 2>&1 || true
    ok "DATAFAST actualizado"
}
