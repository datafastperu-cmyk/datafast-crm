#!/usr/bin/env bash
# Módulo 07-dev — Despliegue de la aplicación (modo desarrollo, sin build)

deploy_app_dev() {
    step "Desplegando CRM ISP DATAFAST (modo desarrollo)"
    _ensure_evolution_api_key_dev
    _deploy_code_dev
    _write_backend_env_dev
    _write_frontend_env_dev
    _install_backend_dev
    _install_frontend_dev
    _run_migrations_dev
    _run_seed_dev
    _setup_evolution_api_dev
}

_deploy_code_dev() {
    info "Clonando repositorio..."
    local REPO="https://github.com/datafastperu-cmyk/datafast-crm.git"

    if [[ -d "${INSTALL_DIR}/backend/src" ]]; then
        info "Código ya presente — actualizando..."
        git -C "${INSTALL_DIR}/backend" pull >> "${LOG_FILE}" 2>&1 || true
    else
        rm -rf /tmp/datafast-src
        git clone --depth 1 "$REPO" /tmp/datafast-src >> "${LOG_FILE}" 2>&1
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
    fi
    chown -R datafast:datafast "${INSTALL_DIR}/backend" "${INSTALL_DIR}/frontend"
    ok "Código desplegado"
}

_write_backend_env_dev() {
    local ip; ip=$(hostname -I | awk '{print $1}')
    local evo_key="${EVOLUTION_API_KEY:-$(openssl rand -hex 16)}"

    cat > "${INSTALL_DIR}/backend/.env" << ENVEOF
NODE_ENV=development
PORT=4000
TZ=America/Lima

APP_URL=http://${ip}:4000
FRONTEND_URL=http://${ip}:3000
ALLOWED_ORIGINS=http://${ip}:3000,http://localhost:3000,http://localhost:4000

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
EVOLUTION_API_KEY=${evo_key}

LOG_LEVEL=debug
ENVEOF
    chmod 600 "${INSTALL_DIR}/backend/.env"
    ok "Backend .env creado (modo desarrollo)"
}

_write_frontend_env_dev() {
    local ip; ip=$(hostname -I | awk '{print $1}')

    cat > "${INSTALL_DIR}/frontend/.env.local" << ENVEOF
NEXT_PUBLIC_API_URL=http://${ip}:4000
NEXT_PUBLIC_WS_URL=ws://${ip}:4000
NEXT_PUBLIC_APP_NAME=${EMPRESA_NOMBRE:-CRM ISP DATAFAST}
NEXT_PUBLIC_VERSION=${DATAFAST_VERSION}
NEXT_TELEMETRY_DISABLED=1
ENVEOF
    chmod 640 "${INSTALL_DIR}/frontend/.env.local"
    ok "Frontend .env.local creado"
}

_install_backend_dev() {
    info "Instalando dependencias del backend..."
    cd "${INSTALL_DIR}/backend"

    if [[ -f package.json ]]; then
        sed -i '/"node-ping"/d'   package.json
        sed -i '/"snmp-native"/d' package.json
    fi

    sudo -u datafast npm install >> "${LOG_FILE}" 2>&1
    ok "Dependencias backend instaladas (hot-reload activo, sin build)"
}

_install_frontend_dev() {
    info "Instalando dependencias del frontend..."
    cd "${INSTALL_DIR}/frontend"
    sudo -u datafast npm install >> "${LOG_FILE}" 2>&1
    ok "Dependencias frontend instaladas (hot-reload activo, sin build)"
}

_run_migrations_dev() {
    info "Ejecutando migraciones de base de datos..."
    cd "${INSTALL_DIR}/backend"
    set -a; source .env; set +a

    local retries=3
    for i in $(seq 1 $retries); do
        if sudo -u datafast npm run migration:run >> "${LOG_FILE}" 2>&1; then
            ok "Migraciones ejecutadas"
            return
        fi
        warn "Intento ${i}/${retries} falló. Reintentando en 5s..."
        sleep 5
    done
    warn "No se pudieron ejecutar las migraciones — ejecutar manualmente: cd /opt/datafast/backend && npm run migration:run"
}

_run_seed_dev() {
    info "Verificando datos iniciales..."
    cd "${INSTALL_DIR}/backend"
    set -a; source .env; set +a

    local count
    count=$(docker exec datafast-postgres \
        psql -U datafast_db_user -d datafast_db -t \
        -c "SELECT COUNT(*) FROM empresas;" 2>/dev/null | tr -d ' \n' || echo "0")

    if [[ "${count}" == "0" ]]; then
        sudo -u datafast npm run seed:run >> "${LOG_FILE}" 2>&1
        ok "Datos iniciales creados"
    else
        ok "Base de datos ya tiene datos — seed omitido"
    fi
}

_ensure_evolution_api_key_dev() {
    if [[ -z "${EVOLUTION_API_KEY:-}" ]]; then
        EVOLUTION_API_KEY=$(openssl rand -hex 16)
        export EVOLUTION_API_KEY
        info "EVOLUTION_API_KEY generada automáticamente"
    fi
}

_setup_evolution_api_dev() {
    step "Levantando Evolution API (WhatsApp self-hosted)"

    docker rm -f datafast-evolution >> "${LOG_FILE}" 2>&1 || true

    docker run -d \
        --name datafast-evolution \
        --restart unless-stopped \
        -p 127.0.0.1:8080:8080 \
        -v datafast_evolution_data:/evolution/instances \
        -e SERVER_URL="http://localhost:8080" \
        -e AUTHENTICATION_API_KEY="${EVOLUTION_API_KEY}" \
        -e AUTHENTICATION_TYPE=apikey \
        -e STORE_MESSAGES=false \
        -e STORE_MESSAGE_UP=false \
        -e STORE_CONTACTS=false \
        -e DEL_INSTANCE=false \
        -e LOG_LEVEL=INFO \
        -e TZ=America/Lima \
        atendai/evolution-api:v2.2.3 >> "${LOG_FILE}" 2>&1

    info "Esperando Evolution API (máx 60s)..."
    local tries=20
    for i in $(seq 1 $tries); do
        if curl -sf "http://localhost:8080/" &>/dev/null; then
            ok "Evolution API disponible en localhost:8080"
            return
        fi
        sleep 3
    done
    warn "Evolution API no respondió — el backend la reintentará al arrancar. Revisa: docker logs datafast-evolution"
}
