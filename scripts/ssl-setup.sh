#!/bin/bash
# ==============================================================
# CRM ISP DATAFAST — Obtener certificados SSL con Let's Encrypt
# Uso: bash scripts/ssl-setup.sh
# Requisito: Dominio apuntando al servidor ANTES de ejecutar
# ==============================================================

set -euo pipefail
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }

# Cargar .env si existe
[ -f .env ] && source .env || { echo "Crear .env primero (cp .env.example .env)"; exit 1; }

# Los dominios se leen de las MISMAS variables que consume nginx vía envsubst. Antes el
# portal se derivaba de FRONTEND_URL, que en .env.example apunta al MISMO host que
# APP_URL: se pedía dos veces el certificado del panel y ninguno para el portal, sin que
# el script fallara.
#
# ERP_DOMAIN con respaldo en APP_DOMAIN: renombrar sin periodo de gracia rompería toda
# instalación existente en su próxima actualización.
DOMAIN_ERP=${ERP_DOMAIN:-${APP_DOMAIN:-}}
DOMAIN_PORTAL=${PORTAL_DOMAIN:-}
DOMAIN_WEB=${WEB_DOMAIN:-}
EMAIL=${SMTP_FROM_EMAIL:-admin@tudominio.com}

# Sólo el del ERP es imprescindible para emitir algo. El portal y la web son opcionales
# por diseño: una instalación en LAN o servida por IP no tiene ninguno de los tres, y
# exigirlos dejaría fuera justo a esas.
if [ -z "$DOMAIN_ERP" ]; then
    echo "Falta ERP_DOMAIN en .env (solo el host, sin https://)."
    echo "Si esta instalación se sirve por IP, no necesitas certificados: omite este paso."
    exit 1
fi
if [ -n "$DOMAIN_PORTAL" ] && [ "$DOMAIN_ERP" = "$DOMAIN_PORTAL" ]; then
    echo "ERP_DOMAIN y PORTAL_DOMAIN no pueden ser el mismo host: el portal del cliente"
    echo "debe servirse en un subdominio propio para aislar cookies y rate-limit."; exit 1
fi
if [ -n "$DOMAIN_WEB" ] && { [ "$DOMAIN_WEB" = "$DOMAIN_ERP" ] || [ "$DOMAIN_WEB" = "$DOMAIN_PORTAL" ]; }; then
    echo "WEB_DOMAIN no puede coincidir con ERP_DOMAIN ni PORTAL_DOMAIN: la web pública es"
    echo "la superficie más expuesta y por eso vive en un host propio."; exit 1
fi

# Compatibilidad con el resto del script, que usa el nombre viejo.
DOMAIN_APP="$DOMAIN_ERP"

warn "Dominio ERP: $DOMAIN_ERP"
warn "Dominio portal: ${DOMAIN_PORTAL:-(sin portal dedicado — modo ruta)}"
warn "Dominio web: ${DOMAIN_WEB:-(sin web pública)}"
warn "Email: $EMAIL"
echo ""
read -p "¿Los datos son correctos? (s/n): " confirm
[[ $confirm != "s" ]] && exit 0

# Instalar Certbot
if ! command -v certbot &> /dev/null; then
    log "Instalando Certbot..."
    apt-get install -y certbot python3-certbot-nginx
fi

# Detener Nginx temporalmente si está corriendo
docker compose stop nginx 2>/dev/null || true

# Obtener certificados
log "Obteniendo certificado para $DOMAIN_APP..."
certbot certonly --standalone \
    --non-interactive \
    --agree-tos \
    --email "$EMAIL" \
    -d "$DOMAIN_APP"

# Portal y web son OPCIONALES: se emite sólo lo que esté configurado. Llamar a certbot
# con `-d ""` aborta el script y dejaría al ERP sin su propio certificado, que sí se
# había emitido bien.
if [ -n "$DOMAIN_PORTAL" ]; then
    log "Obteniendo certificado para $DOMAIN_PORTAL..."
    certbot certonly --standalone \
        --non-interactive \
        --agree-tos \
        --email "$EMAIL" \
        -d "$DOMAIN_PORTAL"
else
    warn "Sin PORTAL_DOMAIN: el portal se sirve en /portal del mismo host, sin certificado propio."
fi

if [ -n "$DOMAIN_WEB" ]; then
    log "Obteniendo certificado para $DOMAIN_WEB..."
    certbot certonly --standalone \
        --non-interactive \
        --agree-tos \
        --email "$EMAIL" \
        -d "$DOMAIN_WEB"
else
    warn "Sin WEB_DOMAIN: no se publica web pública."
fi

# Crear symlinks en directorio del proyecto
mkdir -p ./nginx/ssl/live
ln -sfn /etc/letsencrypt/live/$DOMAIN_APP ./nginx/ssl/live/$DOMAIN_APP
[ -n "$DOMAIN_PORTAL" ] && ln -sfn /etc/letsencrypt/live/$DOMAIN_PORTAL ./nginx/ssl/live/$DOMAIN_PORTAL
[ -n "$DOMAIN_WEB" ]    && ln -sfn /etc/letsencrypt/live/$DOMAIN_WEB    ./nginx/ssl/live/$DOMAIN_WEB

# Configurar renovación automática (cron)
(crontab -l 2>/dev/null; echo "0 3 * * * certbot renew --quiet && docker compose exec nginx nginx -s reload") | crontab -

log "SSL configurado correctamente"
log "Renovación automática: cada día a las 3 AM"

# Reiniciar Nginx
docker compose start nginx
log "Nginx reiniciado con SSL activo"

# Generar certificado auto-firmado para desarrollo
log "Generando certificado auto-firmado para desarrollo..."
mkdir -p ./nginx/ssl
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout ./nginx/ssl/selfsigned.key \
    -out ./nginx/ssl/selfsigned.crt \
    -subj "/C=PE/ST=Piura/L=Piura/O=DATAFAST/CN=localhost" 2>/dev/null
log "Certificado auto-firmado creado en ./nginx/ssl/"
