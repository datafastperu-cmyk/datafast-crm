#!/usr/bin/env bash
# Módulo 01 — Preparación del sistema operativo

install_system() {
    step "Preparando el sistema operativo"
    export DEBIAN_FRONTEND=noninteractive

    info "Actualizando lista de paquetes..."
    apt-get update -qq >> "${LOG_FILE}" 2>&1
    ok "Lista de paquetes actualizada"

    info "Instalando dependencias base..."
    apt-get install -y \
        curl wget git unzip zip \
        ca-certificates gnupg lsb-release \
        apt-transport-https software-properties-common \
        build-essential htop nano vim \
        net-tools dnsutils iputils-ping \
        openssl jq bc fail2ban logrotate cron \
        >> "${LOG_FILE}" 2>&1
    ok "Dependencias base instaladas"

    info "Configurando zona horaria (America/Lima)..."
    timedatectl set-timezone America/Lima >> "${LOG_FILE}" 2>&1
    ok "Zona horaria: America/Lima"

    info "Configurando NTP..."
    apt-get install -y chrony >> "${LOG_FILE}" 2>&1
    systemctl enable chrony >> "${LOG_FILE}" 2>&1
    systemctl start  chrony >> "${LOG_FILE}" 2>&1
    ok "NTP configurado (chrony)"

    info "Optimizando parámetros del kernel..."
    cat > /etc/sysctl.d/99-datafast.conf << 'SYSCTL'
net.core.somaxconn = 65535
net.ipv4.tcp_fin_timeout = 15
net.ipv4.tcp_keepalive_time = 300
vm.swappiness = 10
vm.overcommit_memory = 1
fs.file-max = 1048576
fs.inotify.max_user_watches = 524288
SYSCTL
    sysctl -p /etc/sysctl.d/99-datafast.conf >> "${LOG_FILE}" 2>&1

    cat > /etc/security/limits.d/99-datafast.conf << 'LIMITS'
datafast soft nofile 65536
datafast hard nofile 65536
root     soft nofile 65536
root     hard nofile 65536
LIMITS
    ok "Parámetros del kernel optimizados"

    local ram_mb
    ram_mb=$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo)
    if [[ $ram_mb -lt 4096 ]] && ! swapon --show | grep -q swap; then
        info "Configurando swap 2GB..."
        fallocate -l 2G /swapfile
        chmod 600 /swapfile
        mkswap  /swapfile >> "${LOG_FILE}" 2>&1
        swapon  /swapfile >> "${LOG_FILE}" 2>&1
        echo '/swapfile none swap sw 0 0' >> /etc/fstab
        ok "Swap 2GB configurado"
    fi

    info "Creando usuario de aplicación..."
    id datafast &>/dev/null || useradd -r -m -s /bin/bash -d /home/datafast datafast
    ok "Usuario 'datafast' listo"

    info "Creando estructura de directorios..."
    mkdir -p \
        "${INSTALL_DIR}/backend" \
        "${INSTALL_DIR}/frontend" \
        "${INSTALL_DIR}/logs" \
        "${INSTALL_DIR}/backups/db" \
        "${INSTALL_DIR}/backups/files" \
        "${INSTALL_DIR}/scripts" \
        "${INSTALL_DIR}/config" \
        "${INSTALL_DIR}/ssl" \
        "${LOG_DIR}"
    chown -R datafast:datafast "${INSTALL_DIR}"
    chmod -R 750 "${INSTALL_DIR}"
    ok "Directorios creados en ${INSTALL_DIR}"
}
