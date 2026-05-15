#!/usr/bin/env bash
# Módulo 09 — Seguridad: Firewall, Fail2ban

setup_security() {
    step "Configurando seguridad del servidor"
    _setup_ufw
    _setup_fail2ban
    _harden_ssh
}

_setup_ufw() {
    info "Configurando UFW..."
    apt-get install -y -q ufw >> "${LOG_FILE}" 2>&1
    ufw --force reset         >> "${LOG_FILE}" 2>&1
    ufw default deny incoming >> "${LOG_FILE}" 2>&1
    ufw default allow outgoing >> "${LOG_FILE}" 2>&1
    ufw allow ssh             >> "${LOG_FILE}" 2>&1
    ufw allow 80/tcp          >> "${LOG_FILE}" 2>&1
    ufw allow 443/tcp         >> "${LOG_FILE}" 2>&1
    echo "y" | ufw enable     >> "${LOG_FILE}" 2>&1
    ok "UFW activado: SSH, HTTP(80), HTTPS(443)"
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

[sshd]
enabled  = true
port     = ssh
logpath  = /var/log/auth.log
maxretry = 3
bantime  = 86400

[nginx-http-auth]
enabled  = true
filter   = nginx-http-auth
logpath  = /var/log/nginx/error.log
maxretry = 5
EOF
    systemctl enable fail2ban >> "${LOG_FILE}" 2>&1
    systemctl restart fail2ban >> "${LOG_FILE}" 2>&1
    ok "Fail2ban configurado"
}

_harden_ssh() {
    info "Reforzando SSH..."
    cp /etc/ssh/sshd_config /etc/ssh/sshd_config.bak
    cat >> /etc/ssh/sshd_config << 'EOF'

# DATAFAST — SSH Hardening
MaxAuthTries 3
MaxSessions 5
ClientAliveInterval 300
ClientAliveCountMax 2
LoginGraceTime 30
X11Forwarding no
EOF
    systemctl restart sshd >> "${LOG_FILE}" 2>&1
    ok "SSH reforzado"
}
