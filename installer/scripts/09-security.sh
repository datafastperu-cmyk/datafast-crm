#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  Módulo 09 — Seguridad: Firewall, Fail2ban y SSH
# ─────────────────────────────────────────────────────────────────────────────

setup_security() {
    step "Configurando seguridad del servidor"

    _setup_ufw
    _setup_fail2ban
    _harden_ssh
}

_setup_ufw() {
    info "Configurando UFW (Firewall)..."
    apt-get install -y -q ufw >> "${LOG_FILE}" 2>&1

    ufw --force reset         >> "${LOG_FILE}" 2>&1
    ufw default deny incoming >> "${LOG_FILE}" 2>&1
    ufw default allow outgoing >> "${LOG_FILE}" 2>&1

    # Reglas básicas
    ufw allow ssh             >> "${LOG_FILE}" 2>&1   # Puerto 22 (SSH)
    ufw allow 80/tcp          >> "${LOG_FILE}" 2>&1   # HTTP
    ufw allow 443/tcp         >> "${LOG_FILE}" 2>&1   # HTTPS

    # Puerto alternativo SSH (si se configuró)
    if [[ "${SSH_PORT:-22}" != "22" ]]; then
        ufw allow "${SSH_PORT}/tcp" >> "${LOG_FILE}" 2>&1
    fi

    echo "y" | ufw enable >> "${LOG_FILE}" 2>&1
    ok "UFW activado: SSH(22), HTTP(80), HTTPS(443)"
}

_setup_fail2ban() {
    info "Configurando Fail2ban..."
    apt-get install -y -q fail2ban >> "${LOG_FILE}" 2>&1

    cat > /etc/fail2ban/jail.local << 'EOF'
[DEFAULT]
bantime  = 3600
findtime = 600
maxretry = 5
backend  = auto
ignoreip = 127.0.0.1/8 ::1

[sshd]
enabled  = true
port     = ssh
filter   = sshd
logpath  = /var/log/auth.log
maxretry = 3
bantime  = 86400

[nginx-http-auth]
enabled  = true
filter   = nginx-http-auth
logpath  = /var/log/nginx/error.log
maxretry = 5

[nginx-limit-req]
enabled  = true
filter   = nginx-limit-req
logpath  = /var/log/nginx/*.log
maxretry = 10
bantime  = 600

[nginx-botsearch]
enabled  = true
filter   = nginx-botsearch
logpath  = /var/log/nginx/access.log
maxretry = 2
bantime  = 86400
EOF

    systemctl enable fail2ban >> "${LOG_FILE}" 2>&1
    systemctl restart fail2ban >> "${LOG_FILE}" 2>&1
    ok "Fail2ban configurado (bloqueo automático de IPs maliciosas)"
}

_harden_ssh() {
    info "Reforzando configuración SSH..."

    # Backup de la configuración original
    cp /etc/ssh/sshd_config /etc/ssh/sshd_config.bak

    # Parámetros de seguridad SSH
    cat >> /etc/ssh/sshd_config << 'EOF'

# FibraNet — SSH Hardening
PermitRootLogin no
MaxAuthTries 3
MaxSessions 5
ClientAliveInterval 300
ClientAliveCountMax 2
LoginGraceTime 30
X11Forwarding no
AllowTcpForwarding no
EOF

    systemctl restart sshd >> "${LOG_FILE}" 2>&1
    ok "SSH reforzado (root login deshabilitado)"
}
