#!/bin/bash
# ==============================================================
# CRM ISP DATAFAST — Script de instalación base del servidor
# Compatible: Ubuntu 22.04 / 24.04 LTS
#
# Uso:
#   sudo bash scripts/setup.sh
#
# Control de seguridad: leer NODE_ENV desde /opt/datafast/.env
#   NODE_ENV=production  → UFW + Fail2Ban activos (modo cliente final)
#   NODE_ENV=development → Sin firewall, sin Fail2Ban (modo pruebas)
# ==============================================================

set -euo pipefail
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
log()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }
info() { echo -e "${CYAN}[i]${NC} $1"; }

[[ $EUID -ne 0 ]] && err "Ejecutar como root: sudo bash setup.sh"

# ── Leer NODE_ENV desde .env ─────────────────────────────────
# Busca el .env en el directorio de instalación estándar.
# Si no existe, por seguridad asume development (no bloquea nada).
ENV_FILE="${ENV_FILE:-/opt/datafast/.env}"
NODE_ENV="development"

if [[ -f "$ENV_FILE" ]]; then
    _node_env=$(grep -E '^NODE_ENV=' "$ENV_FILE" 2>/dev/null \
        | head -1 | cut -d'=' -f2 | tr -d '"' | tr -d "'" | xargs)
    [[ -n "$_node_env" ]] && NODE_ENV="$_node_env"
    info ".env encontrado: NODE_ENV=$NODE_ENV"
else
    warn ".env no encontrado en $ENV_FILE — asumiendo NODE_ENV=development"
    warn "Copia .env.example a .env y configura NODE_ENV=production antes del deploy."
fi

echo ""
echo "╔════════════════════════════════════════════╗"
echo "║      CRM ISP DATAFAST — Setup Servidor     ║"
echo "╚════════════════════════════════════════════╝"
echo ""
if [[ "$NODE_ENV" == "production" ]]; then
    warn "Modo PRODUCCIÓN: UFW y Fail2Ban se activarán al final."
else
    info "Modo DESARROLLO: UFW desactivado, Fail2Ban apagado."
fi
echo ""

# ── 1. Actualizar sistema ─────────────────────────────────────
log "Actualizando sistema..."
apt-get update -qq && apt-get upgrade -y -qq

# ── 2. Instalar dependencias ──────────────────────────────────
log "Instalando dependencias del sistema..."
apt-get install -y -qq \
    curl wget git unzip \
    ufw fail2ban iptables-persistent \
    htop net-tools \
    ca-certificates gnupg \
    lsb-release apt-transport-https

# ── 3. Instalar Docker ────────────────────────────────────────
if ! command -v docker &>/dev/null; then
    log "Instalando Docker..."
    curl -fsSL https://get.docker.com | sh
    usermod -aG docker "${SUDO_USER:-root}"
    systemctl enable --now docker
else
    log "Docker ya instalado: $(docker --version)"
fi

# ── 4. Instalar Docker Compose v2 ────────────────────────────
if ! docker compose version &>/dev/null; then
    log "Instalando Docker Compose v2..."
    COMPOSE_VERSION=$(curl -s https://api.github.com/repos/docker/compose/releases/latest \
        | grep tag_name | cut -d '"' -f 4)
    curl -SL "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-linux-x86_64" \
        -o /usr/local/lib/docker/cli-plugins/docker-compose
    chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
else
    log "Docker Compose ya instalado: $(docker compose version)"
fi

# ── 5. ip_forward + NAT (siempre activo — requerido por VPN) ─
log "Configurando ip_forward y NAT para OpenVPN..."

sed -i '/# CRM ISP DATAFAST red/,/^net\.ipv4\.ip_forward/d' /etc/sysctl.conf
cat >> /etc/sysctl.conf <<'EOF'
# CRM ISP DATAFAST red
net.ipv4.ip_forward = 1
EOF
sysctl -w net.ipv4.ip_forward=1 -q

# Preparar UFW before.rules y forward policy (aunque UFW esté apagado)
sed -i 's/^DEFAULT_FORWARD_POLICY=.*/DEFAULT_FORWARD_POLICY="ACCEPT"/' /etc/default/ufw

BEFORE_RULES="/etc/ufw/before.rules"
if ! grep -q "DATAFAST-NAT" "$BEFORE_RULES" 2>/dev/null; then
    python3 - <<'PYEOF'
content = open('/etc/ufw/before.rules').read()
nat_block = (
    "# DATAFAST-NAT: VPN masquerade — no modificar\n"
    "*nat\n"
    ":POSTROUTING ACCEPT [0:0]\n"
    "-A POSTROUTING -s 10.8.0.0/16 -j MASQUERADE\n"
    "COMMIT\n\n"
)
open('/etc/ufw/before.rules', 'w').write(nat_block + content)
PYEOF
fi

# NAT en iptables directo (persiste aunque UFW esté inactivo)
iptables -t nat -C POSTROUTING -s 10.8.0.0/16 -j MASQUERADE 2>/dev/null || \
    iptables -t nat -A POSTROUTING -s 10.8.0.0/16 -j MASQUERADE
iptables-save  > /etc/iptables/rules.v4
ip6tables-save > /etc/iptables/rules.v6 2>/dev/null || true
log "NAT e ip_forward configurados"

# ── 6. Firewall UFW ───────────────────────────────────────────
if [ "$NODE_ENV" = "production" ]; then
    log "Activando UFW (modo producción)..."
    ufw --force reset
    ufw default deny incoming
    ufw default allow outgoing
    ufw allow 22/tcp    comment 'SSH'
    ufw allow 80/tcp    comment 'HTTP'
    ufw allow 443/tcp   comment 'HTTPS'
    ufw allow 1194/udp  comment 'OpenVPN-MikroTik'
    ufw allow 1195/udp  comment 'OpenVPN-Clientes'
    ufw deny  3000/tcp  comment 'Backend-internal-only'
    ufw deny  4000/tcp  comment 'Frontend-internal-only'
    ufw deny  5432/tcp  comment 'PostgreSQL-internal-only'
    ufw deny  6379/tcp  comment 'Redis-internal-only'
    echo "y" | ufw enable
    log "UFW activo: 22/80/443/1194-1195 abiertos; 3000/4000/5432/6379 bloqueados"
else
    ufw disable 2>/dev/null || true
    warn "UFW desactivado — NODE_ENV != production"
fi

# ── 7. Fail2Ban ───────────────────────────────────────────────
if [ "$NODE_ENV" = "production" ]; then
    log "Activando Fail2Ban (política corporativa: 3 intentos / 24h)..."

    cat > /etc/fail2ban/jail.local <<'EOF'
[DEFAULT]
bantime  = 86400
findtime = 600
maxretry = 3
backend  = auto

[sshd]
enabled  = true
port     = ssh
logpath  = /var/log/auth.log
maxretry = 3

[nginx-http-auth]
enabled  = true
port     = http,https
logpath  = /var/log/nginx/error.log

[nginx-limit-req]
enabled  = true
port     = http,https
logpath  = /var/log/nginx/error.log
maxretry = 10

[nestjs-auth]
enabled  = true
port     = http,https
logpath  = /var/log/nginx/access.log
filter   = nestjs-auth
maxretry = 3
EOF

    cat > /etc/fail2ban/filter.d/nestjs-auth.conf <<'EOF'
[Definition]
failregex = ^<HOST> .* "POST /api/v1/auth/login HTTP/\d.?\d?" (401|403) .*$
ignoreregex =
EOF

    systemctl enable --now fail2ban
    log "Fail2Ban activo: 4 jails (sshd, nginx-auth, nginx-limit, nestjs-auth)"
else
    systemctl stop    fail2ban 2>/dev/null || true
    systemctl disable fail2ban 2>/dev/null || true
    warn "Fail2Ban apagado — NODE_ENV != production"
fi

# ── 8. Crear directorio del proyecto ──────────────────────────
log "Creando directorio del proyecto..."
mkdir -p /opt/datafast
[[ -n "${SUDO_USER:-}" ]] && chown "$SUDO_USER:$SUDO_USER" /opt/datafast

# ── 9. Swap ───────────────────────────────────────────────────
if [[ ! -f /swapfile ]]; then
    warn "Creando swap de 2GB..."
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
    log "Swap configurado: 2GB"
fi

# ── 10. Optimizaciones del kernel ─────────────────────────────
log "Aplicando optimizaciones del kernel..."
sed -i '/# CRM ISP DATAFAST optimizaciones/,/^vm\.swappiness/d' /etc/sysctl.conf
cat >> /etc/sysctl.conf <<'EOF'
# CRM ISP DATAFAST optimizaciones
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 65535
net.ipv4.ip_local_port_range = 1024 65535
fs.file-max = 2097152
vm.swappiness = 10
EOF
sysctl -p -q

# ── 11. Rotación de logs Docker ───────────────────────────────
log "Configurando rotación de logs Docker..."
cat > /etc/docker/daemon.json <<'EOF'
{
    "log-driver": "json-file",
    "log-opts": { "max-size": "10m", "max-file": "3" },
    "live-restore": true
}
EOF
systemctl restart docker

# ── Resumen ───────────────────────────────────────────────────
echo ""
echo "╔════════════════════════════════════════════════╗"
echo "║         Setup completado exitosamente          ║"
echo "╚════════════════════════════════════════════════╝"
echo ""
if [ "$NODE_ENV" = "production" ]; then
    log "Seguridad PRODUCCIÓN: UFW activo + Fail2Ban activo"
else
    warn "Seguridad DESARROLLO: UFW inactivo + Fail2Ban apagado"
    warn "Para producción: configura NODE_ENV=production en /opt/datafast/.env"
fi
echo ""
echo "  Próximos pasos:"
echo "  1. cp .env.example /opt/datafast/.env  (ajustar NODE_ENV)"
echo "  2. bash scripts/openvpn-setup.sh"
echo "  3. bash scripts/ssl-setup.sh"
echo ""
warn "REINICIAR sesión para que los cambios de grupo Docker surtan efecto"
echo ""
