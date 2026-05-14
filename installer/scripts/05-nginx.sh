#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  Módulo 05 — Nginx Reverse Proxy
# ─────────────────────────────────────────────────────────────────────────────

setup_nginx() {
    step "Configurando Nginx"

    apt-get install -y -q nginx >> "${LOG_FILE}" 2>&1
    rm -f /etc/nginx/sites-enabled/default

    local ip; ip=$(hostname -I | awk '{print $1}')
    local BE_HOST="${DOMINIO_BACKEND:-${ip}}"
    local FE_HOST="${DOMINIO_FRONTEND:-${ip}}"

    # ── nginx.conf global optimizado ──────────────────────────────────────
    info "Escribiendo nginx.conf global..."
    cat > /etc/nginx/nginx.conf << 'EOF'
user www-data;
worker_processes auto;
worker_rlimit_nofile 65536;
pid /run/nginx.pid;
include /etc/nginx/modules-enabled/*.conf;

events {
    worker_connections 4096;
    multi_accept on;
    use epoll;
}

http {
    # Basics
    sendfile           on;
    tcp_nopush         on;
    tcp_nodelay        on;
    server_tokens      off;
    types_hash_max_size 2048;

    include      /etc/nginx/mime.types;
    default_type application/octet-stream;

    # Logging
    log_format main '$remote_addr - $remote_user [$time_local] '
                    '"$request" $status $body_bytes_sent '
                    '"$http_referer" "$http_user_agent" '
                    'rt=$request_time';
    access_log /var/log/nginx/access.log main;
    error_log  /var/log/nginx/error.log warn;

    # Buffers
    client_body_buffer_size    16k;
    client_header_buffer_size  1k;
    client_max_body_size       25M;
    large_client_header_buffers 4 16k;

    # Timeouts
    client_body_timeout    30s;
    client_header_timeout  30s;
    keepalive_timeout      65s;
    send_timeout           30s;

    # Proxy buffers
    proxy_buffer_size          128k;
    proxy_buffers              4 256k;
    proxy_busy_buffers_size    256k;
    proxy_connect_timeout      60s;
    proxy_send_timeout         120s;
    proxy_read_timeout         120s;

    # Gzip
    gzip              on;
    gzip_vary         on;
    gzip_proxied      any;
    gzip_comp_level   5;
    gzip_types text/plain text/css application/json
               application/javascript text/xml application/xml
               image/svg+xml application/x-font-ttf;
    gzip_min_length   1024;

    # Headers de seguridad globales
    add_header X-Frame-Options        "DENY"                    always;
    add_header X-Content-Type-Options "nosniff"                 always;
    add_header X-XSS-Protection       "1; mode=block"           always;
    add_header Referrer-Policy        "strict-origin-when-cross-origin" always;

    # Zonas de rate limiting
    limit_req_zone  $binary_remote_addr zone=api:10m   rate=60r/m;
    limit_req_zone  $binary_remote_addr zone=auth:10m  rate=10r/m;
    limit_req_zone  $binary_remote_addr zone=web:10m   rate=100r/m;
    limit_conn_zone $binary_remote_addr zone=conn:10m;

    # Open file cache
    open_file_cache          max=10000 inactive=30s;
    open_file_cache_valid    60s;
    open_file_cache_min_uses 2;
    open_file_cache_errors   on;

    include /etc/nginx/conf.d/*.conf;
    include /etc/nginx/sites-enabled/*;
}
EOF

    # ── Site: Backend API ─────────────────────────────────────────────────
    info "Configurando vhost para la API..."
    cat > /etc/nginx/sites-available/fibranet-api << EOF
# ── Upstreams ─────────────────────────────────────────────────────────
upstream fibranet_backend {
    server 127.0.0.1:4000;
    keepalive 32;
    keepalive_requests 1000;
    keepalive_time 1h;
}

# ── HTTP → HTTPS redirect ─────────────────────────────────────────────
server {
    listen 80;
    listen [::]:80;
    server_name ${BE_HOST};

    # Certbot challenge
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

# ── HTTPS ─────────────────────────────────────────────────────────────
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${BE_HOST};

    # SSL (se activa con Certbot)
    ssl_certificate     /etc/nginx/ssl/fibranet.crt;
    ssl_certificate_key /etc/nginx/ssl/fibranet.key;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache   shared:SSL:10m;
    ssl_session_timeout 1d;
    ssl_session_tickets off;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;

    client_max_body_size 25M;

    access_log /var/log/nginx/fibranet-api-access.log main;
    error_log  /var/log/nginx/fibranet-api-error.log warn;

    # Health check (sin log ni rate limit)
    location = /api/v1/health {
        access_log off;
        proxy_pass http://fibranet_backend;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }

    # WebSocket (monitoreo tiempo real)
    location /socket.io/ {
        proxy_pass http://fibranet_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade    \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    # Webhooks (MercadoPago, sin rate limit)
    location /api/v1/pagos/webhooks/ {
        proxy_pass http://fibranet_backend;
        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # Auth endpoints (rate limit estricto)
    location /api/v1/auth/ {
        limit_req zone=auth burst=5 nodelay;
        limit_req_status 429;
        limit_conn conn 10;

        proxy_pass http://fibranet_backend;
        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # Resto de la API
    location /api/ {
        limit_req zone=api burst=30 nodelay;
        limit_req_status 429;

        proxy_pass http://fibranet_backend;
        proxy_http_version 1.1;
        proxy_set_header Connection        "";
        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

    # ── Site: Frontend ────────────────────────────────────────────────────
    info "Configurando vhost para el frontend..."
    cat > /etc/nginx/sites-available/fibranet-frontend << EOF
upstream fibranet_frontend {
    server 127.0.0.1:3000;
    keepalive 16;
}

server {
    listen 80;
    listen [::]:80;
    server_name ${FE_HOST};

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${FE_HOST};

    ssl_certificate     /etc/nginx/ssl/fibranet.crt;
    ssl_certificate_key /etc/nginx/ssl/fibranet.key;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    ssl_session_cache   shared:SSL:10m;
    ssl_session_timeout 1d;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;

    client_max_body_size 10M;

    access_log /var/log/nginx/fibranet-frontend-access.log main;
    error_log  /var/log/nginx/fibranet-frontend-error.log warn;

    # Archivos estáticos Next.js (caché agresiva)
    location /_next/static/ {
        proxy_pass http://fibranet_frontend;
        proxy_set_header Host \$host;
        add_header Cache-Control "public, max-age=31536000, immutable";
        expires 1y;
    }

    location /favicon.ico {
        proxy_pass http://fibranet_frontend;
        access_log off;
        add_header Cache-Control "public, max-age=86400";
    }

    # Aplicación Next.js
    location / {
        limit_req zone=web burst=50 nodelay;

        proxy_pass http://fibranet_frontend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade           \$http_upgrade;
        proxy_set_header Connection        "upgrade";
        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 60s;
    }
}
EOF

    # ── SSL auto-firmado inicial (se reemplaza con Certbot) ───────────────
    info "Creando certificado SSL auto-firmado temporal..."
    mkdir -p /etc/nginx/ssl /var/www/certbot
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout /etc/nginx/ssl/fibranet.key \
        -out    /etc/nginx/ssl/fibranet.crt \
        -subj   "/C=PE/ST=Lima/L=Lima/O=FibraNet/CN=${FE_HOST}" \
        >> "${LOG_FILE}" 2>&1
    ok "Certificado temporal creado"

    # ── Activar sites ─────────────────────────────────────────────────────
    ln -sf /etc/nginx/sites-available/fibranet-api      /etc/nginx/sites-enabled/
    ln -sf /etc/nginx/sites-available/fibranet-frontend /etc/nginx/sites-enabled/

    nginx -t >> "${LOG_FILE}" 2>&1
    systemctl enable nginx >> "${LOG_FILE}" 2>&1
    systemctl reload nginx >> "${LOG_FILE}" 2>&1

    ok "Nginx configurado y recargado"
}

# ── Módulo 06 — SSL con Let's Encrypt ─────────────────────────────────────────

setup_ssl() {
    step "Configurando SSL / HTTPS"

    if [[ -z "${DOMINIO_FRONTEND:-}" ]]; then
        warn "Sin dominio configurado. SSL omitido."
        warn "Para activar SSL después: fibranet-ssl tu-dominio.pe"
        return
    fi

    info "Instalando Certbot..."
    apt-get install -y -q certbot python3-certbot-nginx >> "${LOG_FILE}" 2>&1

    info "Solicitando certificado para ${DOMINIO_FRONTEND} y ${DOMINIO_BACKEND}..."
    local domains="-d ${DOMINIO_FRONTEND}"
    [[ "${DOMINIO_BACKEND}" != "${DOMINIO_FRONTEND}" ]] && domains+=" -d ${DOMINIO_BACKEND}"

    if certbot --nginx ${domains} \
        --email "${ADMIN_EMAIL}" \
        --agree-tos \
        --non-interactive \
        --redirect \
        >> "${LOG_FILE}" 2>&1; then
        ok "SSL activado: HTTPS en ${DOMINIO_FRONTEND}"
    else
        warn "No se pudo obtener el certificado SSL."
        warn "Asegúrate de que el DNS apunta a esta IP: $(hostname -I | awk '{print $1}')"
        warn "Luego ejecuta: fibranet-ssl ${DOMINIO_FRONTEND}"
    fi

    # Cron para renovación automática
    (crontab -l 2>/dev/null; echo "0 3 * * * certbot renew --quiet && systemctl reload nginx") | \
        sort -u | crontab -
    ok "Renovación automática de SSL programada (3 AM diario)"
}
