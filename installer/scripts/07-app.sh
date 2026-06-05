#!/usr/bin/env bash
# Módulo 07 — Despliegue de la aplicación

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

_deploy_code() {
    info "Clonando repositorio..."
    local REPO="https://github.com/datafastperu-cmyk/datafast-crm.git"

    if [[ -d "${INSTALL_DIR}/backend/.git" ]]; then
        git -C "${INSTALL_DIR}" pull >> "${LOG_FILE}" 2>&1
    else
        # Clonar en temp y copiar
        rm -rf /tmp/datafast-src
        git clone --depth 1 "$REPO" /tmp/datafast-src >> "${LOG_FILE}" 2>&1
        cp -r /tmp/datafast-src/backend/.  "${INSTALL_DIR}/backend/"
        cp -r /tmp/datafast-src/frontend/. "${INSTALL_DIR}/frontend/"
        rm -rf /tmp/datafast-src
    fi
    chown -R datafast:datafast "${INSTALL_DIR}/backend" "${INSTALL_DIR}/frontend"
    ok "Código desplegado"
}

_install_backend() {
    info "Instalando dependencias del backend..."
    cd "${INSTALL_DIR}/backend"

    # Eliminar paquetes problemáticos del package.json
    if [[ -f package.json ]]; then
        sed -i '/"node-ping"/d'   package.json
        sed -i '/"snmp-native"/d' package.json
    fi

    npm install >> "${LOG_FILE}" 2>&1
    ok "Dependencias backend instaladas"

    info "Compilando backend (TypeScript)..."
    npm install -g @nestjs/cli >> "${LOG_FILE}" 2>&1
    if npm run build >> "${LOG_FILE}" 2>&1; then
        ok "Backend compilado"
    else
        warn "Compilación con errores — últimas 30 líneas del log:"
        tail -30 "${LOG_FILE}" >&2
        error "npm run build falló. Revisa el log: ${LOG_FILE}"
    fi
}

_install_frontend() {
    info "Instalando dependencias del frontend..."
    cd "${INSTALL_DIR}/frontend"
    npm install >> "${LOG_FILE}" 2>&1
    ok "Dependencias frontend instaladas"

    info "Compilando frontend (Next.js)..."
    NODE_ENV=production npm run build >> "${LOG_FILE}" 2>&1
    ok "Frontend compilado"
}

_run_migrations() {
    info "Ejecutando migraciones de base de datos..."
    cd "${INSTALL_DIR}/backend"
    set -a; source .env.production; set +a

    local retries=3
    for i in $(seq 1 $retries); do
        if npm run migration:run >> "${LOG_FILE}" 2>&1; then
            ok "Migraciones ejecutadas"
            return
        fi
        warn "Intento ${i}/${retries} falló. Reintentando en 5s..."
        sleep 5
    done
    warn "No se pudieron ejecutar las migraciones — verificar manualmente"
}

_run_seed() {
    info "Verificando datos iniciales..."
    cd "${INSTALL_DIR}/backend"
    set -a; source .env.production; set +a

    local count
    count=$(PGPASSWORD="${DB_PASSWORD}" psql -h localhost -U datafast_db_user \
        -d datafast_db -t -c "SELECT COUNT(*) FROM empresas;" 2>/dev/null | tr -d ' \n' || echo "0")

    if [[ "${count}" == "0" ]]; then
        npm run seed:run >> "${LOG_FILE}" 2>&1
        ok "Datos iniciales creados"
    else
        ok "Base de datos ya tiene datos — seed omitido"
    fi
}

_ensure_evolution_api_key() {
    if [[ -z "${EVOLUTION_API_KEY:-}" ]]; then
        EVOLUTION_API_KEY=$(openssl rand -hex 16)
        info "EVOLUTION_API_KEY generada automáticamente"
    fi
}

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
    ok "Variables de entorno del backend creadas"
}

_setup_evolution_api() {
    step "Levantando Evolution API (WhatsApp self-hosted)"

    # Instalar Docker si no está disponible
    if ! command -v docker &>/dev/null; then
        info "Instalando Docker Engine..."
        curl -fsSL https://get.docker.com | sh >> "${LOG_FILE}" 2>&1
        systemctl enable --now docker >> "${LOG_FILE}" 2>&1
        ok "Docker instalado"
    fi

    mkdir -p /opt/datafast/evolution

    # Eliminar contenedor previo si existe (upgrade safe)
    docker rm -f datafast-evolution >> "${LOG_FILE}" 2>&1 || true

    docker run -d \
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
        atendai/evolution-api:v2.2.3 >> "${LOG_FILE}" 2>&1

    # Esperar health check (máx 60 s)
    local tries=20
    for i in $(seq 1 $tries); do
        if curl -sf "http://localhost:8080/" &>/dev/null; then
            ok "Evolution API disponible en localhost:8080"
            return
        fi
        sleep 3
    done
    warn "Evolution API no respondió en 60s — el backend lo reintentará al arrancar"
}

_write_frontend_env() {
    local ip; ip=$(hostname -I | awk '{print $1}')
    local api_url="http://${ip}:4000"
    [[ -n "${DOMINIO_BACKEND:-}" ]] && api_url="https://${DOMINIO_BACKEND}"

    cat > "${INSTALL_DIR}/frontend/.env.production" << ENVEOF
NEXT_PUBLIC_API_URL=${api_url}
NEXT_PUBLIC_WS_URL=${api_url}
NEXT_PUBLIC_APP_NAME=${EMPRESA_NOMBRE:-CRM ISP DATAFAST}
NEXT_PUBLIC_VERSION=${DATAFAST_VERSION}
NEXT_TELEMETRY_DISABLED=1
ENVEOF
    chmod 640 "${INSTALL_DIR}/frontend/.env.production"
    ok "Variables de entorno del frontend creadas"
}

upgrade_app() {
    step "Actualizando DATAFAST"
    "${INSTALL_DIR}/scripts/backup.sh" >> "${LOG_FILE}" 2>&1
    _deploy_code
    _install_backend
    _install_frontend
    _run_migrations
    pm2 reload datafast-backend  >> "${LOG_FILE}" 2>&1 || true
    pm2 restart datafast-frontend >> "${LOG_FILE}" 2>&1 || true
    ok "DATAFAST actualizado"
}
