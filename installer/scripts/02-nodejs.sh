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
    info "Instalando PM2..."
    npm install -g pm2@latest >> "${LOG_FILE}" 2>&1
    ok "PM2 $(pm2 --version) instalado"

    # Configurar PM2 para arrancar con el sistema
    pm2 startup systemd -u root --hp /root >> "${LOG_FILE}" 2>&1 || true
}
