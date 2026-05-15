#!/bin/bash
# ==============================================================
# CRM ISP DATAFAST — Script de instalación en servidor producción
# Probado en: Ubuntu 22.04 LTS
# Uso: sudo bash scripts/setup.sh
# ==============================================================

set -euo pipefail
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }

[[ $EUID -ne 0 ]] && err "Ejecutar como root: sudo bash setup.sh"

echo ""
echo "╔════════════════════════════════════════╗"
echo "║     CRM ISP DATAFAST — Setup Servidor      ║"
echo "╚════════════════════════════════════════╝"
echo ""

# ── 1. Actualizar sistema ─────────────────────────────────────
log "Actualizando sistema..."
apt-get update -qq && apt-get upgrade -y -qq

# ── 2. Instalar dependencias ──────────────────────────────────
log "Instalando dependencias del sistema..."
apt-get install -y -qq \
    curl wget git unzip \
    ufw fail2ban \
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

# ── 5. Configurar Firewall ────────────────────────────────────
log "Configurando UFW firewall..."
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 80/tcp
ufw allow 443/tcp
# SNMP para monitoreo Mikrotik (ajustar IPs de routers)
# ufw allow from 192.168.1.0/24 to any port 161 proto udp
echo "y" | ufw enable
log "Firewall configurado"

# ── 6. Configurar Fail2ban ────────────────────────────────────
log "Configurando Fail2ban..."
cat > /etc/fail2ban/jail.local << 'EOF'
[DEFAULT]
bantime  = 3600
findtime = 600
maxretry = 5

[sshd]
enabled = true
port    = ssh
logpath = /var/log/auth.log
EOF
systemctl enable --now fail2ban

# ── 7. Crear directorio del proyecto ──────────────────────────
log "Creando directorio del proyecto..."
PROJECT_DIR="/opt/datafast"
mkdir -p $PROJECT_DIR
chown $SUDO_USER:$SUDO_USER $PROJECT_DIR

# ── 8. Configurar swap (recomendado para VPS con poca RAM) ────
if [ ! -f /swapfile ]; then
    warn "Creando swap de 2GB..."
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
    log "Swap configurado: 2GB"
fi

# ── 9. Optimizaciones del kernel ──────────────────────────────
log "Aplicando optimizaciones del kernel..."
cat >> /etc/sysctl.conf << 'EOF'
# CRM ISP DATAFAST optimizaciones
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 65535
net.ipv4.ip_local_port_range = 1024 65535
fs.file-max = 2097152
vm.swappiness = 10
EOF
sysctl -p -q

# ── 10. Configurar rotación de logs Docker ───────────────────
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
echo "║           Setup completado exitosamente        ║"
echo "╚════════════════════════════════════════════════╝"
echo ""
echo "  Próximos pasos:"
echo "  1. Clonar el repositorio en /opt/datafast"
echo "  2. Copiar .env.example a .env y configurar variables"
echo "  3. Ejecutar: bash scripts/ssl-setup.sh"
echo "  4. Ejecutar: docker compose up -d"
echo ""
warn "REINICIAR la sesión para que los cambios de grupo Docker surtan efecto"
echo ""
