#!/usr/bin/env bash
# Módulo 03-dev — PostgreSQL 16 vía Docker (modo desarrollo)

install_postgres_dev() {
    step "Levantando PostgreSQL ${PG_VERSION:-16} (Docker)"

    _ensure_docker

    # Eliminar contenedor previo si existe
    docker rm -f datafast-postgres >> "${LOG_FILE}" 2>&1 || true

    docker run -d \
        --name datafast-postgres \
        --restart unless-stopped \
        -p 127.0.0.1:5432:5432 \
        -e POSTGRES_USER=datafast_db_user \
        -e POSTGRES_PASSWORD="${DB_PASSWORD}" \
        -e POSTGRES_DB=datafast_db \
        -e TZ=America/Lima \
        -v datafast_postgres_data:/var/lib/postgresql/data \
        postgres:16-alpine >> "${LOG_FILE}" 2>&1

    info "Esperando que PostgreSQL esté listo..."
    local tries=20
    for i in $(seq 1 $tries); do
        if docker exec datafast-postgres pg_isready -U datafast_db_user -d datafast_db &>/dev/null; then
            ok "PostgreSQL listo en 127.0.0.1:5432"
            _start_pgadmin
            return
        fi
        sleep 3
    done
    error "PostgreSQL no respondió en 60s — revisa: docker logs datafast-postgres"
}

_start_pgadmin() {
    # pgAdmin 4 consume ~400MB — solo instalar si hay RAM suficiente
    local available_mb
    available_mb=$(awk '/MemAvailable/{printf "%d", $2/1024}' /proc/meminfo)
    if [[ ${available_mb} -lt 600 ]]; then
        warn "pgAdmin omitido — RAM disponible insuficiente (${available_mb}MB < 600MB requeridos)"
        warn "Iniciar manualmente después con: docker start datafast-pgadmin"
        # Crear contenedor pero no iniciarlo
        docker rm -f datafast-pgadmin >> "${LOG_FILE}" 2>&1 || true
        docker create \
            --name datafast-pgadmin \
            --restart no \
            -p 127.0.0.1:5050:80 \
            -e PGADMIN_DEFAULT_EMAIL=admin@datafast.pe \
            -e PGADMIN_DEFAULT_PASSWORD=admin123 \
            -e PGADMIN_DISABLE_POSTFIX=true \
            dpage/pgadmin4:latest >> "${LOG_FILE}" 2>&1 || true
        return
    fi

    info "Levantando pgAdmin (UI de base de datos)..."
    docker rm -f datafast-pgadmin >> "${LOG_FILE}" 2>&1 || true

    docker run -d \
        --name datafast-pgadmin \
        --restart unless-stopped \
        -p 127.0.0.1:5050:80 \
        -e PGADMIN_DEFAULT_EMAIL=admin@datafast.pe \
        -e PGADMIN_DEFAULT_PASSWORD=admin123 \
        -e PGADMIN_DISABLE_POSTFIX=true \
        dpage/pgadmin4:latest >> "${LOG_FILE}" 2>&1

    ok "pgAdmin disponible en http://IP:5050  (admin@datafast.pe / admin123)"
}

_ensure_docker() {
    if command -v docker &>/dev/null; then
        ok "Docker ya instalado: $(docker --version | awk '{print $3}' | tr -d ',')"
        return
    fi
    info "Instalando Docker Engine..."
    curl -fsSL https://get.docker.com | sh >> "${LOG_FILE}" 2>&1
    systemctl enable --now docker >> "${LOG_FILE}" 2>&1
    usermod -aG docker datafast 2>/dev/null || true
    ok "Docker instalado"
}
