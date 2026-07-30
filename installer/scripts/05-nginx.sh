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
    # El Portal del Cliente exige subdominio propio: aísla cookies, CSP y rate-limit del
    # panel interno. Sin DOMINIO_PORTAL no se publica — no hay fallback a la IP, porque
    # servir el portal en el mismo host que el ERP anularía ese aislamiento.
    local PORTAL_HOST="${DOMINIO_PORTAL:-}"

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

    # Portal del Cliente: zonas propias. El tráfico viene de abonados en redes móviles
    # compartidas (CGNAT), así que el límite general es más holgado que el del panel
    # interno; el de login es MÁS estricto, porque ahí un usuario es un DNI adivinable.
    limit_req_zone  $binary_remote_addr zone=portal:10m      rate=120r/m;
    limit_req_zone  $binary_remote_addr zone=portal_auth:10m rate=10r/m;

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
    cat > /etc/nginx/sites-available/datafast-api << EOF
# ── Upstreams ─────────────────────────────────────────────────────────
upstream datafast_backend {
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
    ssl_certificate     /etc/nginx/ssl/datafast.crt;
    ssl_certificate_key /etc/nginx/ssl/datafast.key;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache   shared:SSL:10m;
    ssl_session_timeout 1d;
    ssl_session_tickets off;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;

    client_max_body_size 25M;

    access_log /var/log/nginx/datafast-api-access.log main;
    error_log  /var/log/nginx/datafast-api-error.log warn;

    # Health check (sin log ni rate limit)
    location = /api/v1/health {
        access_log off;
        proxy_pass http://datafast_backend;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }

    # WebSocket (monitoreo tiempo real)
    location /socket.io/ {
        proxy_pass http://datafast_backend;
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
        proxy_pass http://datafast_backend;
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

        proxy_pass http://datafast_backend;
        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # Resto de la API
    location /api/ {
        limit_req zone=api burst=30 nodelay;
        limit_req_status 429;

        proxy_pass http://datafast_backend;
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
    cat > /etc/nginx/sites-available/datafast-frontend << EOF
upstream datafast_frontend {
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

    ssl_certificate     /etc/nginx/ssl/datafast.crt;
    ssl_certificate_key /etc/nginx/ssl/datafast.key;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    ssl_session_cache   shared:SSL:10m;
    ssl_session_timeout 1d;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;

    client_max_body_size 10M;

    access_log /var/log/nginx/datafast-frontend-access.log main;
    error_log  /var/log/nginx/datafast-frontend-error.log warn;

    # Archivos estáticos Next.js (caché agresiva)
    location /_next/static/ {
        proxy_pass http://datafast_frontend;
        proxy_set_header Host \$host;
        add_header Cache-Control "public, max-age=31536000, immutable";
        expires 1y;
    }

    location /favicon.ico {
        proxy_pass http://datafast_frontend;
        access_log off;
        add_header Cache-Control "public, max-age=86400";
    }

    # Aplicación Next.js
    location / {
        limit_req zone=web burst=50 nodelay;

        proxy_pass http://datafast_frontend;
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

    # ── Site: Portal del Cliente ──────────────────────────────────────────
    # Solo si hay subdominio dedicado. El portal comparte proceso Next con el ERP
    # (puerto 3000) y se separa por Host: el middleware de Next enruta según la cabecera,
    # así que `proxy_set_header Host $host` no es cosmético — sin él, el portal no existe.
    if [[ -n "${PORTAL_HOST}" ]]; then
        info "Configurando vhost para el portal del cliente (${PORTAL_HOST})..."
        cat > /etc/nginx/sites-available/datafast-portal << EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${PORTAL_HOST};

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
    server_name ${PORTAL_HOST};

    ssl_certificate     /etc/nginx/ssl/datafast.crt;
    ssl_certificate_key /etc/nginx/ssl/datafast.key;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    ssl_session_cache   shared:SSL:10m;
    ssl_session_timeout 1d;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options        "DENY"    always;
    add_header X-Content-Type-Options "nosniff" always;
    # El portal no es indexable: es una zona privada de abonados.
    add_header X-Robots-Tag "noindex, nofollow" always;

    # El abonado no sube archivos: sin formularios de carga, el límite bajo cierra una
    # superficie que no se usa.
    client_max_body_size 2M;
    limit_conn conn 15;

    access_log /var/log/nginx/datafast-portal-access.log main;
    error_log  /var/log/nginx/datafast-portal-error.log warn;

    # ── API: SOLO /api/v1/portal/ ─────────────────────────────────────
    # Este dominio NO expone el resto de la API del ERP. El backend ya lo protege por
    # audiencia de token, pero un dominio público que enruta a /api/v1/clientes es una
    # superficie que no tiene por qué existir: se corta en el borde.
    location /api/v1/portal/auth/ {
        limit_req zone=portal_auth burst=5 nodelay;
        limit_req_status 429;

        proxy_pass http://datafast_backend;
        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location /api/v1/portal/ {
        limit_req zone=portal burst=30 nodelay;
        limit_req_status 429;

        proxy_pass http://datafast_backend;
        proxy_http_version 1.1;
        proxy_set_header Connection        "";
        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        # Conectar el router y leer el WiFi hablan con la OLT/ACS: tardan más que una
        # consulta normal, pero menos que el timeout global del backend (30 s).
        proxy_read_timeout 60s;
    }

    # Cualquier otra ruta de API en este dominio no existe.
    location /api/ {
        return 404;
    }

    # ── Frontend Next.js (mismo proceso, separado por Host) ───────────
    location /_next/static/ {
        proxy_pass http://datafast_frontend;
        proxy_set_header Host \$host;
        add_header Cache-Control "public, max-age=31536000, immutable";
        expires 1y;
    }

    location /favicon.ico {
        proxy_pass http://datafast_frontend;
        access_log off;
        add_header Cache-Control "public, max-age=86400";
    }

    location / {
        limit_req zone=portal burst=50 nodelay;

        proxy_pass http://datafast_frontend;
        proxy_http_version 1.1;
        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
    }

    # Sin WebSocket: el portal no usa socket.io. Exponerlo sería abrir un canal que
    # nadie consume y que el guard del portal ni siquiera cubre.
}
EOF
    else
        info "Sin DOMINIO_PORTAL: el portal del cliente no se publica."
    fi

    # ── SSL auto-firmado inicial (se reemplaza con Certbot) ───────────────
    info "Creando certificado SSL auto-firmado temporal..."
    mkdir -p /etc/nginx/ssl /var/www/certbot
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout /etc/nginx/ssl/datafast.key \
        -out    /etc/nginx/ssl/datafast.crt \
        -subj   "/C=PE/ST=Lima/L=Lima/O=DATAFAST/CN=${FE_HOST}" \
        >> "${LOG_FILE}" 2>&1
    ok "Certificado temporal creado"

    # ── Activar sites ─────────────────────────────────────────────────────
    ln -sf /etc/nginx/sites-available/datafast-api      /etc/nginx/sites-enabled/
    ln -sf /etc/nginx/sites-available/datafast-frontend /etc/nginx/sites-enabled/

    if [[ -n "${PORTAL_HOST}" ]]; then
        ln -sf /etc/nginx/sites-available/datafast-portal /etc/nginx/sites-enabled/
    else
        # Reinstalación que dejó de tener portal: se retira el enlace para que un vhost
        # viejo no siga sirviendo un dominio que ya nadie administra.
        rm -f /etc/nginx/sites-enabled/datafast-portal
    fi

    if nginx -t >> "${LOG_FILE}" 2>&1; then
        systemctl enable nginx >> "${LOG_FILE}" 2>&1
        systemctl reload nginx >> "${LOG_FILE}" 2>&1 || systemctl start nginx >> "${LOG_FILE}" 2>&1
        ok "Nginx configurado y activo"
    else
        warn "Nginx tiene errores de configuración — revisa: nginx -t"
        tail -20 "${LOG_FILE}" >&2
    fi
}
