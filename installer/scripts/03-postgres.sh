#!/usr/bin/env bash
# Módulo 03 — PostgreSQL 16

install_postgres() {
    step "Instalando PostgreSQL ${PG_VERSION:-16}"
    local PG_VER="${PG_VERSION:-16}"

    # Matar procesos que bloqueen apt
    killall unattended-upgrades 2>/dev/null || true
    rm -f /var/lib/dpkg/lock-frontend /var/lib/dpkg/lock /var/cache/apt/archives/lock 2>/dev/null || true
    dpkg --configure -a >> "${LOG_FILE}" 2>&1 || true

    # Repositorio oficial
    if ! grep -q "pgdg" /etc/apt/sources.list.d/pgdg.list 2>/dev/null; then
        info "Agregando repositorio PostgreSQL..."
        curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
            | gpg --dearmor -o /etc/apt/trusted.gpg.d/postgresql.gpg
        echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
            > /etc/apt/sources.list.d/pgdg.list
        apt-get update -qq >> "${LOG_FILE}" 2>&1
    fi

    info "Instalando PostgreSQL ${PG_VER}..."
    apt-get install -y "postgresql-${PG_VER}" "postgresql-client-${PG_VER}" \
        >> "${LOG_FILE}" 2>&1
    systemctl enable postgresql >> "${LOG_FILE}" 2>&1
    systemctl start  postgresql >> "${LOG_FILE}" 2>&1

    info "Creando base de datos..."
    sudo -u postgres psql -tc \
        "SELECT 1 FROM pg_roles WHERE rolname='datafast_db_user'" 2>/dev/null \
        | grep -q 1 || \
        sudo -u postgres psql -c \
            "CREATE USER datafast_db_user WITH PASSWORD '${DB_PASSWORD}';" \
            >> "${LOG_FILE}" 2>&1

    sudo -u postgres psql -tc \
        "SELECT 1 FROM pg_database WHERE datname='datafast_db'" 2>/dev/null \
        | grep -q 1 || \
        sudo -u postgres psql -c \
            "CREATE DATABASE datafast_db OWNER datafast_db_user ENCODING 'UTF8';" \
            >> "${LOG_FILE}" 2>&1

    sudo -u postgres psql -c \
        "GRANT ALL PRIVILEGES ON DATABASE datafast_db TO datafast_db_user;" \
        >> "${LOG_FILE}" 2>&1

    # Tuning según RAM
    local ram_mb; ram_mb=$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo)
    local shared work cache
    if   [[ $ram_mb -ge 8192 ]]; then shared="2GB";  work="16MB"; cache="6GB"
    elif [[ $ram_mb -ge 4096 ]]; then shared="1GB";  work="8MB";  cache="3GB"
    else                               shared="128MB"; work="4MB";  cache="512MB"
    fi

    local pg_conf="/etc/postgresql/${PG_VER}/main/postgresql.conf"
    if [[ -f "$pg_conf" ]]; then
        _pg_set "$pg_conf" "shared_buffers"       "$shared"
        _pg_set "$pg_conf" "effective_cache_size" "$cache"
        _pg_set "$pg_conf" "work_mem"             "$work"
        _pg_set "$pg_conf" "max_connections"      "50"
        _pg_set "$pg_conf" "timezone"             "'America/Lima'"
        systemctl restart postgresql >> "${LOG_FILE}" 2>&1
    fi

    ok "PostgreSQL ${PG_VER} instalado y configurado"
}

_pg_set() {
    local conf="$1" key="$2" val="$3"
    if grep -q "^${key}" "$conf" 2>/dev/null; then
        sed -i "s|^${key}.*|${key} = ${val}|" "$conf"
    else
        echo "${key} = ${val}" >> "$conf"
    fi
}
