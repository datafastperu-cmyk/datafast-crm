#!/usr/bin/env bash
# Módulo 04-dev — Redis 7 vía Docker (modo desarrollo)

install_redis_dev() {
    step "Levantando Redis 7 (Docker)"

    docker rm -f datafast-redis >> "${LOG_FILE}" 2>&1 || true

    docker run -d \
        --name datafast-redis \
        --restart unless-stopped \
        -p 127.0.0.1:6379:6379 \
        -v datafast_redis_data:/data \
        redis:7-alpine \
        redis-server \
            --requirepass "${REDIS_PASSWORD}" \
            --appendonly yes \
            --maxmemory 256mb \
            --maxmemory-policy allkeys-lru >> "${LOG_FILE}" 2>&1

    info "Esperando que Redis esté listo..."
    local tries=10
    for i in $(seq 1 $tries); do
        if docker exec datafast-redis redis-cli -a "${REDIS_PASSWORD}" --no-auth-warning ping 2>/dev/null | grep -q PONG; then
            ok "Redis listo en 127.0.0.1:6379"
            _start_redis_commander
            return
        fi
        sleep 2
    done
    warn "Redis no respondió en 20s — revisa: docker logs datafast-redis"
}

_start_redis_commander() {
    info "Levantando Redis Commander (UI de Redis)..."
    docker rm -f datafast-redis-ui >> "${LOG_FILE}" 2>&1 || true

    docker run -d \
        --name datafast-redis-ui \
        --restart unless-stopped \
        -p 127.0.0.1:8081:8081 \
        --link datafast-redis:redis \
        -e REDIS_HOSTS="redis:redis:6379:0:${REDIS_PASSWORD}" \
        rediscommander/redis-commander:latest >> "${LOG_FILE}" 2>&1

    ok "Redis Commander disponible en http://IP:8081"
}
