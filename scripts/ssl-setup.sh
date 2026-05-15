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

DOMAIN_APP=${APP_URL#https://}    # Extraer dominio de APP_URL
DOMAIN_PORTAL=${FRONTEND_URL#https://}
EMAIL=${SMTP_FROM_EMAIL:-admin@tudominio.com}

warn "Dominio admin: $DOMAIN_APP"
warn "Dominio portal: $DOMAIN_PORTAL"
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

log "Obteniendo certificado para $DOMAIN_PORTAL..."
certbot certonly --standalone \
    --non-interactive \
    --agree-tos \
    --email "$EMAIL" \
    -d "$DOMAIN_PORTAL"

# Crear symlinks en directorio del proyecto
mkdir -p ./nginx/ssl/live
ln -sfn /etc/letsencrypt/live/$DOMAIN_APP ./nginx/ssl/live/$DOMAIN_APP
ln -sfn /etc/letsencrypt/live/$DOMAIN_PORTAL ./nginx/ssl/live/$DOMAIN_PORTAL

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
