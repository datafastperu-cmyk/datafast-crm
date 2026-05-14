#!/usr/bin/env bash
# Módulo 07 — Despliegue de la aplicación

deploy_app() {
    step "Desplegando FibraNet ISP ERP"
    _deploy_code
    _write_backend_env
    _write_frontend_env
    _install_backend
    _install_frontend
    _run_migrations
    _run_seed
}

_deploy_code() {
    info "Clonando repositorio..."
    local REPO="https://github.com/datafastperu-cmyk/fibranet-isp.git"

    if [[ -d "${INSTALL_DIR}/backend/.git" ]]; then
        git -C "${INSTALL_DIR}" pull >> "${LOG_FILE}" 2>&1
    else
        # Clonar en temp y copiar
        rm -rf /tmp/fibranet-src
        git clone --depth 1 "$REPO" /tmp/fibranet-src >> "${LOG_FILE}" 2>&1
        cp -r /tmp/fibranet-src/backend/.  "${INSTALL_DIR}/backend/"
        cp -r /tmp/fibranet-src/frontend/. "${INSTALL_DIR}/frontend/"
        rm -rf /tmp/fibranet-src
    fi
    chown -R fibranet:fibranet "${INSTALL_DIR}/backend" "${INSTALL_DIR}/frontend"
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
    npm run build >> "${LOG_FILE}" 2>&1
    ok "Backend compilado"
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
    count=$(PGPASSWORD="${DB_PASSWORD}" psql -h localhost -U fibranet_db_user \
        -d fibranet_db -t -c "SELECT COUNT(*) FROM empresas;" 2>/dev/null | tr -d ' ' || echo "0")

    if [[ "${count}" == "0" ]]; then
        npm run seed:run >> "${LOG_FILE}" 2>&1
        ok "Datos iniciales creados"
    else
        ok "Base de datos ya tiene datos — seed omitido"
    fi
}

_write_backend_env() {
    local ip; ip=$(hostname -I | awk '{print $1}')
    local frontend_url="http://${ip}"
    [[ -n "${DOMINIO_FRONTEND:-}" ]] && frontend_url="https://${DOMINIO_FRONTEND}"

    cat > "${INSTALL_DIR}/backend/.env.production" << ENVEOF
NODE_ENV=production
PORT=4000
API_PREFIX=api/v1
TZ=America/Lima

DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=fibranet_db
DATABASE_USER=fibranet_db_user
DATABASE_PASSWORD=${DB_PASSWORD}
DATABASE_SSL=false
DATABASE_SYNCHRONIZE=false
DATABASE_RUN_MIGRATIONS=false
DATABASE_LOGGING=false
DATABASE_MAX_CONNECTIONS=20

REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=${REDIS_PASSWORD}
REDIS_DB=0

JWT_SECRET=${JWT_SECRET}
JWT_EXPIRES_IN=15m
JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}
JWT_REFRESH_EXPIRES_IN=7d
JWT_ISSUER=fibranet-isp
JWT_AUDIENCE=fibranet-app

ENCRYPTION_KEY=${ENCRYPTION_KEY}

FRONTEND_URL=${frontend_url}
ALLOWED_ORIGINS=${frontend_url}

EMPRESA_NOMBRE=${EMPRESA_NOMBRE:-FibraNet ISP}
EMPRESA_RUC=${EMPRESA_RUC:-20000000001}
ADMIN_EMAIL=${ADMIN_EMAIL:-admin@fibranet.pe}
ADMIN_PASSWORD=${ADMIN_PASSWORD:-Admin@FibraNet2024!}

WHATSAPP_TOKEN=
WHATSAPP_PHONE_ID=
RENIEC_API_URL=
RENIEC_API_TOKEN=
SMARTOLT_URL=https://api.smartolt.com
SMARTOLT_TOKEN=
MP_ACCESS_TOKEN=
MP_WEBHOOK_SECRET=
MP_SANDBOX=true

LOG_LEVEL=warn
LOG_FILE=${INSTALL_DIR}/logs/backend.log
ENVEOF
    chmod 600 "${INSTALL_DIR}/backend/.env.production"
    ok "Variables de entorno del backend creadas"
}

_write_frontend_env() {
    local ip; ip=$(hostname -I | awk '{print $1}')
    local api_url="http://${ip}:4000"
    [[ -n "${DOMINIO_BACKEND:-}" ]] && api_url="https://${DOMINIO_BACKEND}"

    cat > "${INSTALL_DIR}/frontend/.env.production" << ENVEOF
NEXT_PUBLIC_API_URL=${api_url}
NEXT_PUBLIC_WS_URL=${api_url}
NEXT_PUBLIC_APP_NAME=${EMPRESA_NOMBRE:-FibraNet ISP}
NEXT_PUBLIC_VERSION=${FIBRANET_VERSION}
NEXT_TELEMETRY_DISABLED=1
ENVEOF
    chmod 640 "${INSTALL_DIR}/frontend/.env.production"
    ok "Variables de entorno del frontend creadas"
}

upgrade_app() {
    step "Actualizando FibraNet"
    "${INSTALL_DIR}/scripts/backup.sh" >> "${LOG_FILE}" 2>&1
    _deploy_code
    _install_backend
    _install_frontend
    _run_migrations
    pm2 reload fibranet-backend  >> "${LOG_FILE}" 2>&1 || true
    pm2 restart fibranet-frontend >> "${LOG_FILE}" 2>&1 || true
    ok "FibraNet actualizado"
}
