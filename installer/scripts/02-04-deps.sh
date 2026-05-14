#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  Módulo 02 — Node.js 20 LTS
# ─────────────────────────────────────────────────────────────────────────────

install_nodejs() {
    step "Instalando Node.js 20 LTS"
    local NODE_VER="${NODE_VERSION:-20}"

    # Verificar si ya está instalado
    if command -v node &>/dev/null; then
        local current
        current=$(node --version | sed 's/v//' | cut -d. -f1)
        if [[ $current -ge $NODE_VER ]]; then
            ok "Node.js ya instalado: $(node --version)"
            _ensure_npm_globals
            return
        fi
    fi

    info "Agregando repositorio Node.js ${NODE_VER}..."
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_VER}.x" | bash - >> "${LOG_FILE}" 2>&1
    apt-get install -y -q nodejs >> "${LOG_FILE}" 2>&1
    ok "Node.js $(node --version) instalado"

    _ensure_npm_globals
}

_ensure_npm_globals() {
    info "Instalando herramientas globales de npm..."
    npm install -g --quiet \
        pm2@latest \
        npm@latest \
        >> "${LOG_FILE}" 2>&1
    ok "PM2 $(pm2 --version) instalado"

    # Configurar PM2 para arrancar con el sistema
    local startup_cmd
    startup_cmd=$(pm2 startup systemd -u fibranet --hp /home/fibranet 2>&1 | grep "sudo env" || true)
    if [[ -n "$startup_cmd" ]]; then
        eval "$startup_cmd" >> "${LOG_FILE}" 2>&1
        ok "PM2 configurado para arrancar automáticamente"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
#  Módulo 03 — PostgreSQL 16
# ─────────────────────────────────────────────────────────────────────────────

install_postgres() {
    step "Instalando PostgreSQL 16"
    local PG_VER="${PG_VERSION:-16}"

    # Repositorio oficial
    if ! grep -q "pgdg" /etc/apt/sources.list.d/pgdg.list 2>/dev/null; then
        info "Agregando repositorio de PostgreSQL..."
        curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
            | gpg --dearmor -o /etc/apt/trusted.gpg.d/postgresql.gpg
        echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
            > /etc/apt/sources.list.d/pgdg.list
        apt-get update -qq >> "${LOG_FILE}" 2>&1
    fi

    info "Instalando PostgreSQL ${PG_VER}..."
    apt-get install -y -q "postgresql-${PG_VER}" "postgresql-client-${PG_VER}" \
        >> "${LOG_FILE}" 2>&1
    systemctl enable postgresql >> "${LOG_FILE}" 2>&1
    systemctl start  postgresql >> "${LOG_FILE}" 2>&1

    # Crear base de datos y usuario (idempotente)
    info "Configurando base de datos..."
    sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='fibranet_db_user'" \
        | grep -q 1 || \
        sudo -u postgres psql -c \
            "CREATE USER fibranet_db_user WITH PASSWORD '${DB_PASSWORD}';" \
            >> "${LOG_FILE}" 2>&1

    sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='fibranet_db'" \
        | grep -q 1 || \
        sudo -u postgres psql -c \
            "CREATE DATABASE fibranet_db OWNER fibranet_db_user ENCODING 'UTF8';" \
            >> "${LOG_FILE}" 2>&1

    sudo -u postgres psql -c \
        "GRANT ALL PRIVILEGES ON DATABASE fibranet_db TO fibranet_db_user;" \
        >> "${LOG_FILE}" 2>&1

    # Tuning básico según RAM disponible
    info "Optimizando PostgreSQL..."
    local ram_mb
    ram_mb=$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo)
    local shared_buffers work_mem effective_cache

    if [[ $ram_mb -ge 8192 ]]; then
        shared_buffers="2GB"; work_mem="16MB"; effective_cache="6GB"
    elif [[ $ram_mb -ge 4096 ]]; then
        shared_buffers="1GB"; work_mem="8MB";  effective_cache="3GB"
    else
        shared_buffers="256MB"; work_mem="4MB"; effective_cache="768MB"
    fi

    local pg_conf="/etc/postgresql/${PG_VER}/main/postgresql.conf"
    _pg_set "$pg_conf" "shared_buffers"          "$shared_buffers"
    _pg_set "$pg_conf" "effective_cache_size"    "$effective_cache"
    _pg_set "$pg_conf" "work_mem"                "$work_mem"
    _pg_set "$pg_conf" "maintenance_work_mem"    "256MB"
    _pg_set "$pg_conf" "max_connections"         "100"
    _pg_set "$pg_conf" "checkpoint_completion_target" "0.9"
    _pg_set "$pg_conf" "wal_buffers"             "16MB"
    _pg_set "$pg_conf" "timezone"                "'America/Lima'"
    _pg_set "$pg_conf" "log_timezone"            "'America/Lima'"
    _pg_set "$pg_conf" "log_min_duration_statement" "2000"

    systemctl restart postgresql >> "${LOG_FILE}" 2>&1
    ok "PostgreSQL ${PG_VER} instalado y optimizado (RAM: ${ram_mb}MB)"
}

_pg_set() {
    local conf="$1" key="$2" val="$3"
    if grep -q "^${key}" "$conf"; then
        sed -i "s|^${key}.*|${key} = ${val}|" "$conf"
    else
        echo "${key} = ${val}" >> "$conf"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
#  Módulo 04 — Redis 7
# ─────────────────────────────────────────────────────────────────────────────

install_redis() {
    step "Instalando Redis 7"

    # Repositorio oficial de Redis
    if ! grep -q "packages.redis.io" /etc/apt/sources.list.d/redis.list 2>/dev/null; then
        info "Agregando repositorio de Redis..."
        curl -fsSL https://packages.redis.io/gpg \
            | gpg --dearmor -o /usr/share/keyrings/redis-archive-keyring.gpg
        echo "deb [signed-by=/usr/share/keyrings/redis-archive-keyring.gpg] \
            https://packages.redis.io/deb $(lsb_release -cs) main" \
            > /etc/apt/sources.list.d/redis.list
        apt-get update -qq >> "${LOG_FILE}" 2>&1
    fi

    info "Instalando Redis..."
    apt-get install -y -q redis-server >> "${LOG_FILE}" 2>&1

    # Calcular maxmemory según RAM disponible
    local ram_mb
    ram_mb=$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo)
    local max_mem="512mb"
    [[ $ram_mb -ge 8192 ]] && max_mem="1gb"
    [[ $ram_mb -ge 16384 ]] && max_mem="2gb"

    info "Configurando Redis (maxmemory: ${max_mem})..."
    cat > /etc/redis/redis.conf << EOF
# FibraNet — Redis Configuration
bind 127.0.0.1 ::1
port 6379
protected-mode yes
requirepass ${REDIS_PASSWORD}

# Persistencia
save 900 1
save 300 10
save 60 10000
appendonly yes
appendfsync everysec

# Memoria
maxmemory ${max_mem}
maxmemory-policy allkeys-lru

# Logs
loglevel notice
logfile /var/log/redis/redis-server.log

# Seguridad
rename-command FLUSHALL ""
rename-command FLUSHDB  ""
rename-command CONFIG   "FIBRANET-CONFIG-CMD"
rename-command DEBUG    ""
rename-command KEYS     "FIBRANET-KEYS-CMD"

# Rendimiento
hz 15
latency-monitor-threshold 100
slowlog-log-slower-than 10000
tcp-keepalive 300
timeout 0
EOF

    systemctl enable redis-server >> "${LOG_FILE}" 2>&1
    systemctl restart redis-server >> "${LOG_FILE}" 2>&1

    # Verificar
    sleep 1
    if redis-cli -a "${REDIS_PASSWORD}" --no-auth-warning ping | grep -q PONG; then
        ok "Redis instalado y respondiendo"
    else
        warn "Redis instalado pero no responde correctamente"
    fi
}
