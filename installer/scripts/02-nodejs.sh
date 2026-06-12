#!/usr/bin/env bash
# Módulo 02 — Node.js 20 LTS

install_nodejs() {
    step "Instalando Node.js ${NODE_VERSION:-20} LTS"
    local NODE_VER="${NODE_VERSION:-20}"

    if command -v node &>/dev/null; then
        local current
        current=$(node --version | sed 's/v//' | cut -d. -f1)
        if [[ $current -ge $NODE_VER ]]; then
            ok "Node.js ya instalado: $(node --version)"
            _install_pm2
            return
        fi
    fi

    info "Agregando repositorio Node.js ${NODE_VER}..."
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_VER}.x" | bash - >> "${LOG_FILE}" 2>&1
    apt-get install -y nodejs >> "${LOG_FILE}" 2>&1
    ok "Node.js $(node --version) instalado"

    _install_pm2
}

_install_pm2() {
    if command -v pm2 &>/dev/null; then
        ok "PM2 ya instalado: $(pm2 --version)"
        return
    fi
    info "Instalando PM2..."
    npm install -g pm2@latest >> "${LOG_FILE}" 2>&1
    ok "PM2 $(pm2 --version) instalado"

    # Startup como usuario datafast (no root)
    pm2 startup systemd -u datafast --hp /home/datafast >> "${LOG_FILE}" 2>&1 || true
    systemctl enable pm2-datafast >> "${LOG_FILE}" 2>&1 || true
}
