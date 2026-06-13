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

    # Detectar el puerto SSH activo para no bloquearse
    local ssh_port
    ssh_port=$(ss -tlnp 2>/dev/null | awk '/:22 /{print 22; exit}')
    ssh_port=${ssh_port:-22}

    if ufw status 2>/dev/null | grep -q "Status: active"; then
        info "UFW ya activo — verificando reglas..."
    else
        ufw --force reset          >> "${LOG_FILE}" 2>&1
        ufw default deny incoming  >> "${LOG_FILE}" 2>&1
        ufw default allow outgoing >> "${LOG_FILE}" 2>&1
    fi

    # SSH primero — nunca perder acceso
    ufw allow "${ssh_port}/tcp" comment 'SSH'    >> "${LOG_FILE}" 2>&1
    ufw allow 80/tcp  comment 'HTTP'             >> "${LOG_FILE}" 2>&1
    ufw allow 443/tcp comment 'HTTPS'            >> "${LOG_FILE}" 2>&1
    ufw allow 1195/tcp comment 'OpenVPN-MikroTik' >> "${LOG_FILE}" 2>&1

    # Verificar que SSH sigue accesible antes de activar UFW
    if ! nc -z -w3 127.0.0.1 "${ssh_port}" 2>/dev/null; then
        warn "No se pudo verificar SSH en puerto ${ssh_port} — UFW no activado"
        warn "Activa manualmente: ufw allow ${ssh_port}/tcp && ufw enable"
        return
    fi

    echo "y" | ufw enable >> "${LOG_FILE}" 2>&1

    # Bloquear puertos internos al exterior
    for port in 3000 4000 5432 6379 8080 5050 8081; do
        ufw deny ${port}/tcp >> "${LOG_FILE}" 2>&1 || true
    done

    ok "UFW activo: SSH(${ssh_port}), HTTP(80), HTTPS(443), OpenVPN(1195/TCP)"
    ok "Puertos internos bloqueados al exterior"
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

    systemctl enable fail2ban >> "${LOG_FILE}" 2>&1 || true
    systemctl restart fail2ban >> "${LOG_FILE}" 2>&1 || warn "fail2ban no iniciado — verificar manualmente"
    ok "Fail2ban configurado (bloqueo automático de IPs maliciosas)"
}

_harden_ssh() {
    info "Reforzando configuración SSH..."
    local sshd_config="/etc/ssh/sshd_config"

    # Backup idempotente
    [[ ! -f "${sshd_config}.bak" ]] && cp "${sshd_config}" "${sshd_config}.bak"

    # Solo aplicar si no está ya aplicado
    if grep -q "DATAFAST — SSH Hardening" "${sshd_config}" 2>/dev/null; then
        ok "SSH hardening ya aplicado"
        return
    fi

    cat >> "${sshd_config}" << 'EOF'

# DATAFAST — SSH Hardening
PermitRootLogin no
MaxAuthTries 3
MaxSessions 5
ClientAliveInterval 300
ClientAliveCountMax 2
LoginGraceTime 30
X11Forwarding no
AllowTcpForwarding no
EOF

    # Verificar config antes de reiniciar
    if sshd -t >> "${LOG_FILE}" 2>&1; then
        systemctl restart sshd >> "${LOG_FILE}" 2>&1 || warn "SSHD no reiniciado — se aplica al próximo reinicio"
        ok "SSH reforzado (root login deshabilitado, MaxAuthTries=3)"
    else
        warn "Config SSH inválida — revirtiendo"
        cp "${sshd_config}.bak" "${sshd_config}"
    fi
}
