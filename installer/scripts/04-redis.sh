#!/usr/bin/env bash
# Módulo 04 — Redis 7

install_redis() {
    step "Instalando Redis 7"

    if ! grep -q "packages.redis.io" /etc/apt/sources.list.d/redis.list 2>/dev/null; then
        info "Agregando repositorio Redis..."
        curl -fsSL https://packages.redis.io/gpg \
            | gpg --dearmor -o /usr/share/keyrings/redis-archive-keyring.gpg
        echo "deb [signed-by=/usr/share/keyrings/redis-archive-keyring.gpg] \
https://packages.redis.io/deb $(lsb_release -cs) main" \
            > /etc/apt/sources.list.d/redis.list
        apt-get update -qq >> "${LOG_FILE}" 2>&1
    fi

    apt-get install -y redis-server >> "${LOG_FILE}" 2>&1

    local ram_mb; ram_mb=$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo)
    local max_mem="256mb"
    [[ $ram_mb -ge 4096 ]] && max_mem="512mb"
    [[ $ram_mb -ge 8192 ]] && max_mem="1gb"

    info "Configurando Redis (maxmemory: ${max_mem})..."
    cat > /etc/redis/redis.conf << REDISEOF
bind 127.0.0.1
port 6379
protected-mode yes
requirepass ${REDIS_PASSWORD}
save 900 1
save 300 10
appendonly yes
appendfsync everysec
maxmemory ${max_mem}
maxmemory-policy allkeys-lru
loglevel notice
logfile /var/log/redis/redis-server.log
tcp-keepalive 300
rename-command FLUSHALL ""
rename-command FLUSHDB  ""
rename-command DEBUG    ""
REDISEOF

    mkdir -p /var/log/redis
    chown redis:adm /var/log/redis 2>/dev/null || chown redis:redis /var/log/redis 2>/dev/null || true
    chmod 750 /var/log/redis

    systemctl daemon-reload >> "${LOG_FILE}" 2>&1
    systemctl enable redis-server >> "${LOG_FILE}" 2>&1
    systemctl restart redis-server >> "${LOG_FILE}" 2>&1 \
        || { warn "Primer intento fallido, reintentando en 3s..."; sleep 3; systemctl start redis-server >> "${LOG_FILE}" 2>&1 || true; }
    sleep 2

    if redis-cli -a "${REDIS_PASSWORD}" --no-auth-warning ping 2>/dev/null | grep -q PONG; then
        ok "Redis instalado y respondiendo"
    else
        warn "Redis instalado — verificar: systemctl status redis-server"
    fi
}
