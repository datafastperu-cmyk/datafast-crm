#!/bin/bash
# ==============================================================
# CRM ISP DATAFAST — Script de instalación en servidor
# Probado en: Ubuntu 22.04 / 24.04 LTS
# Uso:
#   sudo bash scripts/setup.sh                    # modo desarrollo (default)
#   sudo INSTALL_MODE=production bash scripts/setup.sh
# ==============================================================

set -euo pipefail
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
log()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }
info() { echo -e "${CYAN}[i]${NC} $1"; }

[[ $EUID -ne 0 ]] && err "Ejecutar como root: sudo bash setup.sh"

# ── Modo de instalación ───────────────────────────────────────
INSTALL_MODE="${INSTALL_MODE:-development}"

echo ""
echo "╔════════════════════════════════════════════╗"
echo "║      CRM ISP DATAFAST — Setup Servidor     ║"
echo "╚════════════════════════════════════════════╝"
echo ""
if [[ "$INSTALL_MODE" == "production" ]]; then
    warn "Modo: PRODUCCIÓN — UFW + Fail2Ban activos"
else
    info "Modo: DESARROLLO — UFW desactivado, Fail2Ban apagado"
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
if ! command -v docker &> /dev/null; then
    log "Instalando Docker..."
    curl -fsSL https://get.docker.com | sh
    usermod -aG docker $SUDO_USER
    systemctl enable --now docker
else
    log "Docker ya instalado: $(docker --version)"
fi

# ── 4. Instalar Docker Compose v2 ────────────────────────────
if ! docker compose version &> /dev/null; then
    log "Instalando Docker Compose v2..."
    COMPOSE_VERSION=$(curl -s https://api.github.com/repos/docker/compose/releases/latest | grep tag_name | cut -d '"' -f 4)
    curl -SL "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-linux-x86_64" \
        -o /usr/local/lib/docker/cli-plugins/docker-compose
    chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
else
    log "Docker Compose ya instalado: $(docker compose version)"
fi

# ── 5. Red: ip_forward + NAT (siempre activo — necesario para VPN) ──
log "Configurando ip_forward y NAT para OpenVPN..."
sed -i '/# CRM ISP DATAFAST red/,/^net\.ipv4\.ip_forward/d' /etc/sysctl.conf
cat >> /etc/sysctl.conf << 'EOF'
# CRM ISP DATAFAST red
net.ipv4.ip_forward = 1
EOF
sysctl -w net.ipv4.ip_forward=1 -q

# Habilitar forwarding en UFW (aunque esté desactivado, prepara la config)
sed -i 's/^DEFAULT_FORWARD_POLICY=.*/DEFAULT_FORWARD_POLICY="ACCEPT"/' /etc/default/ufw

# Bloque NAT en before.rules para cuando UFW esté activo
BEFORE_RULES="/etc/ufw/before.rules"
if ! grep -q "DATAFAST-NAT" "$BEFORE_RULES"; then
    python3 - <<'PYEOF'
content = open('/etc/ufw/before.rules').read()
nat_block = """# DATAFAST-NAT: VPN masquerade — no modificar
*nat
:POSTROUTING ACCEPT [0:0]
-A POSTROUTING -s 10.8.0.0/16 -j MASQUERADE
COMMIT

"""
open('/etc/ufw/before.rules', 'w').write(nat_block + content)
PYEOF
fi

# NAT directo en iptables (persiste independientemente de UFW)
iptables -t nat -C POSTROUTING -s 10.8.0.0/16 -j MASQUERADE 2>/dev/null || \
    iptables -t nat -A POSTROUTING -s 10.8.0.0/16 -j MASQUERADE
iptables-save > /etc/iptables/rules.v4
ip6tables-save > /etc/iptables/rules.v6 2>/dev/null || true
log "NAT y ip_forward configurados"

# ── 6. Firewall UFW ───────────────────────────────────────────
if [[ "$INSTALL_MODE" == "production" ]]; then
    log "Configurando UFW (modo producción)..."
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
    log "UFW activado"
else
    ufw disable 2>/dev/null || true
    warn "UFW desactivado (modo desarrollo)"
fi

# ── 7. Fail2Ban ───────────────────────────────────────────────
if [[ "$INSTALL_MODE" == "production" ]]; then
    log "Configurando Fail2Ban (política corporativa: 3 intentos / 24h)..."
    cat > /etc/fail2ban/jail.local << 'EOF'
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

    cat > /etc/fail2ban/filter.d/nestjs-auth.conf << 'EOF'
[Definition]
failregex = ^<HOST> .* "POST /api/v1/auth/login HTTP/\d.?\d?" (401|403) .*$
ignoreregex =
EOF

    systemctl enable --now fail2ban
    log "Fail2Ban activado"
else
    systemctl stop fail2ban 2>/dev/null || true
    systemctl disable fail2ban 2>/dev/null || true
    warn "Fail2Ban desactivado (modo desarrollo)"
fi

# ── 8. Crear directorio del proyecto ──────────────────────────
log "Creando directorio del proyecto..."
PROJECT_DIR="/opt/datafast"
mkdir -p $PROJECT_DIR
chown $SUDO_USER:$SUDO_USER $PROJECT_DIR

# ── 9. Configurar swap ────────────────────────────────────────
if [ ! -f /swapfile ]; then
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
cat >> /etc/sysctl.conf << 'EOF'
# CRM ISP DATAFAST optimizaciones
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 65535
net.ipv4.ip_local_port_range = 1024 65535
fs.file-max = 2097152
vm.swappiness = 10
EOF
sysctl -p -q

# ── 11. Configurar rotación de logs Docker ───────────────────
log "Configurando rotación de logs Docker..."
cat > /etc/docker/daemon.json << 'EOF'
{
    "log-driver": "json-file",
    "log-opts": {
        "max-size": "10m",
        "max-file": "3"
    },
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
if [[ "$INSTALL_MODE" == "production" ]]; then
    echo "  Seguridad: UFW activo + Fail2Ban activo"
else
    echo "  Seguridad: UFW desactivado + Fail2Ban apagado (desarrollo)"
    echo "  Para producción: sudo INSTALL_MODE=production bash scripts/setup.sh"
fi
echo ""
echo "  Próximos pasos:"
echo "  1. Clonar el repositorio en /opt/datafast"
echo "  2. Copiar .env.example a .env y configurar variables"
echo "  3. Ejecutar: bash scripts/openvpn-setup.sh"
echo "  4. Ejecutar: bash scripts/ssl-setup.sh"
echo ""
warn "REINICIAR la sesión para que los cambios de grupo Docker surtan efecto"
echo ""
