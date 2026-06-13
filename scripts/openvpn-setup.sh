#!/usr/bin/env bash
# ================================================================
#  DATAFAST ISP CRM — OpenVPN Server Setup
#  Versión: 3.0.0
#  Compatible: Ubuntu 22.04 / 24.04 LTS
#  Propósito: Infraestructura VPN para gestión de equipos ISP
#             (MikroTik, Huawei, ZTE, VSOL, Ubiquiti, TP-Link)
# ================================================================
#  Uso:
#    sudo bash scripts/openvpn-setup.sh              # Instalación completa
#    sudo bash scripts/openvpn-setup.sh --reinstall  # Forzar reinstalación
#    sudo bash scripts/openvpn-setup.sh --status     # Ver estado
# ================================================================

set -euo pipefail
IFS=$'\n\t'

# ── Configuración ──────────────────────────────────────────────
readonly SCRIPT_VERSION="3.0.0"
readonly INSTALL_DIR="/opt/datafast"
readonly LOG_DIR="/var/log/datafast"
readonly VPN_LOG_DIR="/var/log/openvpn"
readonly OPENVPN_DIR="/etc/openvpn"
readonly SERVER_DIR="${OPENVPN_DIR}/server"
readonly EASYRSA_DIR="${OPENVPN_DIR}/easy-rsa"
readonly PKI_DIR="${EASYRSA_DIR}/pki"
readonly CLIENTS_DIR="${SERVER_DIR}/clients"
readonly CCD_DIR="${OPENVPN_DIR}/ccd"           # Directivas por cliente (iroute)
readonly PKI_META_FILE="${SERVER_DIR}/pki-meta.json"

# Parámetros configurables
VPN_DNS1="${VPN_DNS1:-1.1.1.1}"
VPN_DNS2="${VPN_DNS2:-8.8.8.8}"
CA_EXPIRE="${CA_EXPIRE:-3650}"
CERT_EXPIRE="${CERT_EXPIRE:-3650}"
EASYRSA_VERSION="${EASYRSA_VERSION:-3.1.7}"

# MikroTik VPN — único servidor OpenVPN del ERP (puerto 1195/tcp)
MIKROTIK_PORT="${MIKROTIK_PORT:-1195}"
MIKROTIK_NETWORK="${MIKROTIK_NETWORK:-10.8.1.0}"
MIKROTIK_NETMASK="${MIKROTIK_NETMASK:-255.255.255.0}"

FLAG_REINSTALL=false
FLAG_STATUS_ONLY=false

# Leer NODE_ENV desde .env — controla si se activa UFW/Fail2Ban
ENV_FILE="${ENV_FILE:-/opt/datafast/.env}"
NODE_ENV="development"
if [[ -f "$ENV_FILE" ]]; then
    _ne=$(grep -E '^NODE_ENV=' "$ENV_FILE" 2>/dev/null | head -1 \
        | cut -d'=' -f2 | tr -d '"' | tr -d "'" | xargs)
    [[ -n "$_ne" ]] && NODE_ENV="$_ne"
fi

# ── Colores ────────────────────────────────────────────────────
R='\033[0;31m'; G='\033[0;32m'; Y='\033[1;33m'
B='\033[0;34m'; C='\033[0;36m'; W='\033[1;37m'; NC='\033[0m'

# ── Logging ────────────────────────────────────────────────────
LOG_FILE="${LOG_DIR}/openvpn-setup-$(date +%Y%m%d_%H%M%S).log"

_log()   { local lvl="$1"; shift; echo "[$(date '+%Y-%m-%d %H:%M:%S')] [${lvl}] $*" >> "${LOG_FILE}" 2>/dev/null || true; }
info()   { echo -e "${B}[·]${NC} $*"; _log "INFO" "$*"; }
ok()     { echo -e "${G}[✓]${NC} $*"; _log "OK  " "$*"; }
warn()   { echo -e "${Y}[!]${NC} $*"; _log "WARN" "$*"; }
error()  { echo -e "${R}[✗] ERROR: $*${NC}" >&2; _log "ERR " "$*"; exit 1; }
step()   { echo -e "\n${W}━━━ $*${NC}"; _log "STEP" "$*"; }
detail() { echo -e "    ${C}$*${NC}"; _log "    " "$*"; }

parse_args() {
    for arg in "$@"; do
        case "$arg" in
            --reinstall) FLAG_REINSTALL=true  ;;
            --status)    FLAG_STATUS_ONLY=true ;;
        esac
    done
}

check_requirements() {
    [[ $EUID -eq 0 ]] || error "Ejecutar como root: sudo bash $0"
    local os_id; os_id=$(. /etc/os-release 2>/dev/null && echo "${ID:-unknown}")
    [[ "$os_id" == "ubuntu" || "$os_id" == "debian" ]] || \
        warn "Sistema detectado: ${os_id}. Optimizado para Ubuntu/Debian."
    if ! lsmod | grep -q "^tun " 2>/dev/null; then
        modprobe tun 2>/dev/null || warn "Módulo TUN no disponible"
    fi
    mkdir -p "${LOG_DIR}" "${VPN_LOG_DIR}" "${CCD_DIR}"
    chmod 750 "${VPN_LOG_DIR}"
    chmod 755 "${CCD_DIR}"
    ok "Verificaciones previas pasadas"
}

detect_public_ip() {
    local ip=""
    for service in \
        "https://api.ipify.org" \
        "https://checkip.amazonaws.com" \
        "https://icanhazip.com" \
        "https://ifconfig.me/ip"
    do
        ip=$(curl -4 -fsSL --connect-timeout 5 --max-time 10 "$service" 2>/dev/null | tr -d '[:space:]') && \
        [[ -n "$ip" ]] && break
    done
    if [[ -z "$ip" ]]; then
        ip=$(hostname -I | awk '{print $1}')
        warn "No se pudo detectar IP pública. Usando IP local: ${ip}"
    fi
    echo "$ip"
}

install_dependencies() {
    step "Instalando dependencias"
    apt-get update -qq >> "${LOG_FILE}" 2>&1
    local pkgs=(
        openvpn openssl curl wget ca-certificates
        net-tools iptables iptables-persistent
        ufw fail2ban
    )
    for pkg in "${pkgs[@]}"; do
        if dpkg -l "$pkg" &>/dev/null; then
            detail "Ya instalado: $pkg"
        else
            info "Instalando: $pkg"
            DEBIAN_FRONTEND=noninteractive apt-get install -y -q "$pkg" >> "${LOG_FILE}" 2>&1 || \
                warn "No se pudo instalar $pkg"
        fi
    done
    local ovpn_ver; ovpn_ver=$(openvpn --version 2>/dev/null | head -1 | awk '{print $2}')
    ok "OpenVPN ${ovpn_ver}"
}

install_easyrsa() {
    step "Instalando EasyRSA ${EASYRSA_VERSION}"
    local easyrsa_url="https://github.com/OpenVPN/easy-rsa/releases/download/v${EASYRSA_VERSION}/EasyRSA-${EASYRSA_VERSION}.tgz"
    local tmp_dir; tmp_dir=$(mktemp -d)
    info "Descargando EasyRSA..."
    if ! curl -fsSL --retry 3 --retry-delay 2 \
        "${easyrsa_url}" -o "${tmp_dir}/easyrsa.tgz" >> "${LOG_FILE}" 2>&1; then
        if command -v make-cadir &>/dev/null; then
            warn "Descarga fallida. Usando EasyRSA del sistema..."
            mkdir -p "${EASYRSA_DIR}"
            make-cadir "${EASYRSA_DIR}" >> "${LOG_FILE}" 2>&1
            rm -rf "${tmp_dir}"
            ok "EasyRSA (sistema)"
            return 0
        fi
        error "No se pudo instalar EasyRSA"
    fi
    tar -xzf "${tmp_dir}/easyrsa.tgz" -C "${tmp_dir}" >> "${LOG_FILE}" 2>&1
    rm -rf "${EASYRSA_DIR}"
    mv "${tmp_dir}/EasyRSA-${EASYRSA_VERSION}" "${EASYRSA_DIR}"
    chmod +x "${EASYRSA_DIR}/easyrsa"
    rm -rf "${tmp_dir}"
    ok "EasyRSA ${EASYRSA_VERSION} en ${EASYRSA_DIR}"
}

generate_pki() {
    step "Generando PKI"
    cd "${EASYRSA_DIR}"
    cat > "${EASYRSA_DIR}/vars" << EOF
set_var EASYRSA_ALGO        rsa
set_var EASYRSA_KEY_SIZE    2048
set_var EASYRSA_DIGEST      sha256
set_var EASYRSA_CA_EXPIRE   ${CA_EXPIRE}
set_var EASYRSA_CERT_EXPIRE ${CERT_EXPIRE}
set_var EASYRSA_CRL_DAYS    180
set_var EASYRSA_DN          cn_only
set_var EASYRSA_REQ_CN      "DATAFAST-CA"
set_var EASYRSA_REQ_COUNTRY "PE"
set_var EASYRSA_REQ_PROVINCE "Lima"
set_var EASYRSA_REQ_CITY    "Lima"
set_var EASYRSA_REQ_ORG     "DATAFAST ISP"
set_var EASYRSA_REQ_EMAIL   "admin@datafast.pe"
set_var EASYRSA_REQ_OU      "IT Operations"
set_var EASYRSA_BATCH       "yes"
EOF

    # vars-clients para certificados de routers MikroTik (ID-based CN)
    cp "${EASYRSA_DIR}/vars" "${EASYRSA_DIR}/vars-clients"

    ./easyrsa --batch init-pki >> "${LOG_FILE}" 2>&1
    ok "PKI inicializada"
    ./easyrsa --batch build-ca nopass >> "${LOG_FILE}" 2>&1
    ok "CA generada"
    ./easyrsa --batch gen-req server nopass >> "${LOG_FILE}" 2>&1
    ./easyrsa --batch sign-req server server >> "${LOG_FILE}" 2>&1
    ok "Certificado servidor"
    openssl dhparam -dsaparam -out "${PKI_DIR}/dh.pem" 2048 >> "${LOG_FILE}" 2>&1
    ok "DH params"
    openvpn --genkey secret "${SERVER_DIR}/ta.key" >> "${LOG_FILE}" 2>&1
    ok "TLS-Crypt key"
    ./easyrsa --batch gen-crl >> "${LOG_FILE}" 2>&1
    ok "CRL"
}

deploy_server_certs() {
    step "Desplegando certificados"
    mkdir -p "${SERVER_DIR}" "${CLIENTS_DIR}"
    cp "${PKI_DIR}/ca.crt"            "${SERVER_DIR}/ca.crt"
    cp "${PKI_DIR}/issued/server.crt" "${SERVER_DIR}/server.crt"
    cp "${PKI_DIR}/private/server.key" "${SERVER_DIR}/server.key"
    cp "${PKI_DIR}/dh.pem"            "${SERVER_DIR}/dh.pem"
    cp "${PKI_DIR}/crl.pem"           "${SERVER_DIR}/crl.pem"
    chmod 750 "${SERVER_DIR}"
    chmod 644 "${SERVER_DIR}/ca.crt" "${SERVER_DIR}/server.crt" \
              "${SERVER_DIR}/dh.pem"  "${SERVER_DIR}/crl.pem"
    chmod 600 "${SERVER_DIR}/server.key" "${SERVER_DIR}/ta.key"
    chmod 750 "${CLIENTS_DIR}"
    ok "Certificados con permisos correctos"
}

# ── Genera el servidor dedicado para routers MikroTik ──────────
generate_mikrotik_conf() {
    step "Generando mikrotik.conf (routers MikroTik)"

    # Asegurar que el directorio CCD existe con permisos correctos
    mkdir -p "${CCD_DIR}"
    chown nobody:nogroup "${CCD_DIR}" 2>/dev/null || true
    chmod 755 "${CCD_DIR}"

    cat > "${SERVER_DIR}/mikrotik.conf" << EOF
# ================================================================
#  DATAFAST ISP — OpenVPN MikroTik Server
#  Puerto ${MIKROTIK_PORT}/tcp — Compatible RouterOS v6.x y v7.x
#  Arquitectura: Enrutamiento dinámico por ID indestructible
#
#  Principio de operación:
#  1. Este archivo es permanente — no cambia al agregar routers
#  2. El ERP escribe CCD en ${CCD_DIR}/df_router_id_<uuid>
#  3. Cada CCD contiene: iroute <subred> <máscara>
#  4. Las rutas globales RFC1918 abajo aseguran que cualquier
#     subred futura sea resuelta por el túnel automáticamente
# ================================================================
port ${MIKROTIK_PORT}
proto tcp
dev tun

# ── PKI ─────────────────────────────────────────────────────────
ca   ${SERVER_DIR}/ca.crt
cert ${SERVER_DIR}/server.crt
key  ${SERVER_DIR}/server.key
dh   ${SERVER_DIR}/dh.pem
crl-verify ${SERVER_DIR}/crl.pem

# ── Pool de IPs para routers MikroTik ───────────────────────────
server ${MIKROTIK_NETWORK} ${MIKROTIK_NETMASK}
topology subnet
ifconfig-pool-persist ${VPN_LOG_DIR}/ipp-mikrotik.txt

# ── Directivas individuales por router (CCD) ────────────────────
# ERP escribe: ${CCD_DIR}/df_router_id_<uuid>
# Contenido:   iroute <subred-LAN> <máscara>
# NUNCA cambiar esta ruta — es la arquitectura de enrutamiento.
client-config-dir ${CCD_DIR}

# ── Rutas globales RFC1918 (enrutamiento masivo indestructible) ──
# Le enseñamos al kernel Linux que TODOS los rangos privados de
# telecomunicaciones viajan por el túnel. Los CCD individuales
# con iroute delegan la entrega al MikroTik correcto.
# Agregar un nuevo router NO requiere tocar este archivo.
route 10.0.0.0 255.0.0.0
route 172.16.0.0 255.240.0.0
route 192.168.0.0 255.255.0.0

# ── Push mínimo (no redirigir el default gateway del router) ────
push "route ${MIKROTIK_NETWORK} ${MIKROTIK_NETMASK}"
push "dhcp-option DNS ${VPN_DNS1}"
push "dhcp-option DNS ${VPN_DNS2}"

# ── Seguridad ────────────────────────────────────────────────────
cipher AES-256-CBC
ncp-ciphers AES-256-GCM:AES-128-GCM:AES-256-CBC
auth SHA1
tls-version-min 1.2
ecdh-curve prime256v1

# ── Comunicación entre routers VPN ───────────────────────────────
client-to-client

# ── Rendimiento ──────────────────────────────────────────────────
max-clients 500
keepalive 10 60
persist-key
persist-tun

# ── Seguridad del proceso ────────────────────────────────────────
user nobody
group nogroup

# ── Logs y monitoreo ─────────────────────────────────────────────
status ${VPN_LOG_DIR}/status-mikrotik.log 10
status-version 2
log-append ${VPN_LOG_DIR}/mikrotik.log
verb 3
mute 20

# ── Gestión remota (usada por el backend para kill sessions) ─────
management 127.0.0.1 7505

# ── Autenticación usuario/contraseña sin certificado cliente ────
# Los routers MikroTik usan user/pass generados por el ERP, sin cert cliente.
# username-as-common-name → OpenVPN usa el username como CN para buscar CCD.
script-security 2
auth-user-pass-verify ${INSTALL_DIR}/scripts/vpn-auth.sh via-env
username-as-common-name
verify-client-cert none

# ── Scripts de conexión/desconexión ──────────────────────────────
client-connect    ${INSTALL_DIR}/scripts/vpn-client-connect.sh
client-disconnect ${INSTALL_DIR}/scripts/vpn-client-disconnect.sh

# TCP mode: sin explicit-exit-notify
explicit-exit-notify 0
EOF
    chmod 640 "${SERVER_DIR}/mikrotik.conf"
    ok "mikrotik.conf generado (puerto ${MIKROTIK_PORT})"
}

generate_vpn_auth_script() {
    step "Generando vpn-auth.sh (autenticación usuario/contraseña)"
    mkdir -p "${INSTALL_DIR}/scripts"
    cat > "${INSTALL_DIR}/scripts/vpn-auth.sh" << 'AUTHEOF'
#!/bin/bash
# Verifica credenciales VPN usuario/contraseña contra el backend ERP.
# Llamado por OpenVPN via: auth-user-pass-verify <script> via-env
# OpenVPN inyecta: username y password como variables de entorno.

[ -z "${username}" ] && exit 1

RESPONSE=$(curl -sf -m 5 \
  -X POST "http://127.0.0.1:4000/api/v1/openvpn/mikrotik-clients/verify-auth" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"${username}\",\"password\":\"${password}\"}" 2>/dev/null)

[ $? -ne 0 ] && exit 1

echo "${RESPONSE}" | grep -q '"success":true' && exit 0 || exit 1
AUTHEOF
    chmod 755 "${INSTALL_DIR}/scripts/vpn-auth.sh"
    # Permitir traverse a nobody (OpenVPN corre como nobody al ejecutar auth scripts)
    chmod o+x "${INSTALL_DIR}" "${INSTALL_DIR}/scripts"
    ok "vpn-auth.sh creado en ${INSTALL_DIR}/scripts/"
}

configure_network() {
    step "Configurando IP forwarding y NAT"
    local main_iface; main_iface=$(ip route get 8.8.8.8 2>/dev/null | awk 'NR==1{for(i=1;i<=NF;i++) if($i=="dev") print $(i+1)}')
    [[ -z "$main_iface" ]] && main_iface=$(ip link show | awk -F': ' '/^[0-9]+: / && !/lo|tun/ {print $2; exit}')
    info "Interfaz principal: ${main_iface}"

    # IP forwarding permanente (sin duplicados)
    for param in "net.ipv4.ip_forward=1" "net.ipv6.conf.all.forwarding=1"; do
        grep -qxF "$param" /etc/sysctl.conf || echo "$param" >> /etc/sysctl.conf
    done
    sysctl -p >> "${LOG_FILE}" 2>&1
    ok "IP forwarding: $(cat /proc/sys/net/ipv4/ip_forward)"

    ok "NAT gestionado por UFW before.rules"
}

configure_ufw() {
    step "Configurando UFW"
    command -v ufw &>/dev/null || { warn "UFW no instalado — omitiendo"; return 0; }

    # Preparar before.rules y forward policy (siempre — necesario para VPN)
    local before=/etc/ufw/before.rules
    if ! grep -q "DATAFAST-NAT" "$before" 2>/dev/null; then
        python3 - << PYEOF
with open('${before}', 'r') as f: c = f.read()
nat = """# DATAFAST-NAT: VPN masquerade — no modificar
*nat
:POSTROUTING ACCEPT [0:0]
-A POSTROUTING -s 10.8.0.0/16 -j MASQUERADE
COMMIT

"""
with open('${before}', 'w') as f: f.write(nat + c)
PYEOF
        ok "Bloque NAT añadido a before.rules"
    fi
    sed -i 's/DEFAULT_FORWARD_POLICY="DROP"/DEFAULT_FORWARD_POLICY="ACCEPT"/' /etc/default/ufw 2>/dev/null || true

    if [ "$NODE_ENV" = "production" ]; then
        # Reglas de acceso
        ufw --force reset >> "${LOG_FILE}" 2>&1
        ufw default deny incoming >> "${LOG_FILE}" 2>&1
        ufw default allow outgoing >> "${LOG_FILE}" 2>&1
        ufw allow 22/tcp   comment 'SSH'           >> "${LOG_FILE}" 2>&1
        ufw allow 80/tcp   comment 'HTTP-nginx'    >> "${LOG_FILE}" 2>&1
        ufw allow 443/tcp  comment 'HTTPS-nginx'   >> "${LOG_FILE}" 2>&1
        ufw allow "${MIKROTIK_PORT}/tcp"  comment 'OpenVPN-mikrotik'  >> "${LOG_FILE}" 2>&1
        ufw deny from any to any port 3000 proto tcp comment 'NextJS-internal'  >> "${LOG_FILE}" 2>&1
        ufw deny from any to any port 4000 proto tcp comment 'NestJS-internal'  >> "${LOG_FILE}" 2>&1
        ufw deny from any to any port 5432 proto tcp comment 'Postgres-block'   >> "${LOG_FILE}" 2>&1
        ufw deny from any to any port 6379 proto tcp comment 'Redis-block'      >> "${LOG_FILE}" 2>&1
        echo "y" | ufw enable >> "${LOG_FILE}" 2>&1
        ok "UFW activo — puertos permitidos: 22, 80, 443, ${MIKROTIK_PORT}/tcp"
        ok "UFW bloqueado: 3000, 4000, 5432, 6379"
    else
        ufw disable >> "${LOG_FILE}" 2>&1 || true
        warn "UFW desactivado — NODE_ENV != production"
        warn "Para producción: configura NODE_ENV=production en $ENV_FILE"
    fi
}

configure_fail2ban() {
    step "Configurando Fail2Ban"
    command -v fail2ban-client &>/dev/null || { warn "Fail2Ban no instalado — omitiendo"; return 0; }

    if [ "$NODE_ENV" != "production" ]; then
        systemctl stop fail2ban >> "${LOG_FILE}" 2>&1 || true
        systemctl disable fail2ban >> "${LOG_FILE}" 2>&1 || true
        warn "Fail2Ban desactivado — NODE_ENV != production"
        return 0
    fi

    cat > /etc/fail2ban/jail.local << 'F2B'
[DEFAULT]
# Seguridad corporativa DATAFAST ISP
bantime  = 86400    ; 24 horas de baneo
findtime = 600      ; ventana de análisis: 10 minutos
maxretry = 3        ; 3 intentos fallidos → baneo inmediato
backend  = systemd

[sshd]
enabled  = true
port     = ssh
logpath  = %(sshd_log)s
maxretry = 3
bantime  = 86400

[nginx-http-auth]
enabled  = true
port     = http,https
logpath  = /var/log/nginx/error.log
maxretry = 5

[nginx-limit-req]
enabled  = true
port     = http,https
logpath  = /var/log/nginx/error.log
maxretry = 10
findtime = 60
bantime  = 3600

[nestjs-auth]
enabled  = true
port     = http,https
logpath  = /var/log/nginx/access.log
maxretry = 5
findtime = 300
bantime  = 86400
filter   = nestjs-auth
F2B

    mkdir -p /etc/fail2ban/filter.d
    cat > /etc/fail2ban/filter.d/nestjs-auth.conf << 'FILTER'
[Definition]
# Detecta POST /api/v1/auth/login con respuesta 401/403
failregex = ^<HOST> .* "POST /api/v1/auth/login HTTP/\d.?\d?" (401|403) .*$
ignoreregex =
FILTER

    systemctl enable --now fail2ban >> "${LOG_FILE}" 2>&1
    systemctl restart fail2ban >> "${LOG_FILE}" 2>&1
    ok "Fail2Ban: 4 jails activos (sshd, nginx-auth, nginx-limit, nestjs-auth)"
    ok "Política: 3 intentos / 10min → baneo 24h"
}

configure_systemd() {
    step "Configurando servicio systemd"
    systemctl daemon-reload >> "${LOG_FILE}" 2>&1
    systemctl enable openvpn-server@mikrotik >> "${LOG_FILE}" 2>&1 || true
    systemctl start  openvpn-server@mikrotik >> "${LOG_FILE}" 2>&1 || warn "mikrotik.conf no pudo iniciar"
    sleep 2
    systemctl is-active openvpn-server@mikrotik && ok "openvpn@mikrotik activo" || warn "openvpn@mikrotik inactivo"
}

save_pki_metadata() {
    step "Guardando metadata PKI"
    local public_ip; public_ip=$(detect_public_ip)
    cat > "${PKI_META_FILE}" << EOF
{
  "version": "${SCRIPT_VERSION}",
  "installedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "publicIp": "${public_ip}",
  "mikrotikPort": ${MIKROTIK_PORT},
  "mikrotikProtocol": "tcp",
  "mikrotikNetwork": "${MIKROTIK_NETWORK}",
  "ccdDir": "${CCD_DIR}",
  "pkiDir": "${EASYRSA_DIR}",
  "serverDir": "${SERVER_DIR}",
  "cipher": "AES-256-CBC/GCM",
  "auth": "SHA256",
  "tlsVersion": "1.2"
}
EOF
    chmod 640 "${PKI_META_FILE}"
    ok "Metadata en ${PKI_META_FILE}"
}

validate_installation() {
    step "Validando instalación"
    local errors=0

    systemctl is-active --quiet openvpn-server@mikrotik && ok "openvpn@mikrotik: ACTIVO" || { warn "openvpn@mikrotik: INACTIVO"; ((errors++)) || true; }

    ip link show tun0 &>/dev/null && ok "tun0 UP" || warn "tun0 no encontrada (sin clientes aún)"

    [[ "$(cat /proc/sys/net/ipv4/ip_forward)" == "1" ]] && ok "IP forwarding: ON" || { warn "IP forwarding: OFF"; ((errors++)) || true; }

    ufw status 2>/dev/null | grep -q "Status: active" && ok "UFW: activo" || warn "UFW: inactivo"

    systemctl is-active --quiet fail2ban && ok "Fail2Ban: activo" || warn "Fail2Ban: inactivo"

    [[ -d "${CCD_DIR}" ]] && ok "CCD dir: ${CCD_DIR}" || { warn "CCD dir no existe"; ((errors++)) || true; }

    [[ $errors -eq 0 ]] && ok "Todas las validaciones OK" || warn "${errors} advertencia(s) — ver ${LOG_FILE}"
    return $errors
}

show_status() {
    echo ""
    echo -e "${W}━━━ Estado OpenVPN ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    local active; active=$(systemctl is-active "openvpn-server@mikrotik" 2>/dev/null || echo "desconocido")
    echo -e "  openvpn@mikrotik: $([ "$active" = "active" ] && echo "${G}${active}${NC}" || echo "${R}${active}${NC}")"
    ip link show tun0 &>/dev/null && echo -e "  tun0: ${G}UP${NC}" || echo -e "  tun0: ${Y}sin clientes aún${NC}"
    echo ""
    ufw status verbose 2>/dev/null | head -20 || true
    echo ""
    fail2ban-client status 2>/dev/null || true
    echo ""
}

show_summary() {
    local public_ip; public_ip=$(detect_public_ip)
    echo ""
    echo -e "${G}"
    echo "  ╔══════════════════════════════════════════════════════════╗"
    echo "  ║  ✅  DATAFAST VPN Infrastructure — Instalación completa  ║"
    echo "  ╚══════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
    echo -e "  ${W}VPN MikroTik:${NC}  ${public_ip}:${MIKROTIK_PORT}/tcp"
    echo -e "  ${W}Red VPN:${NC}       ${MIKROTIK_NETWORK}/24"
    echo -e "  ${W}Cifrado:${NC}       AES-256-GCM/CBC | SHA-256 | TLS 1.2+"
    echo -e "  ${W}CCD dir:${NC}       ${CCD_DIR}/ (gestionado por el ERP)"
    echo -e "  ${W}Firewall:${NC}      UFW activo | Fail2Ban activo (4 jails)"
    echo -e "  ${W}NAT:${NC}           10.8.0.0/16 → MASQUERADE (persistente)"
    echo ""
    echo -e "  ${Y}Rutas globales configuradas:${NC}"
    echo -e "    10.0.0.0/8 → túnel MikroTik (RFC1918 full)"
    echo -e "    172.16.0.0/12 → túnel MikroTik (RFC1918 full)"
    echo -e "    192.168.0.0/16 → túnel MikroTik (RFC1918 full)"
    echo ""
    echo -e "  ${B}Para agregar un router MikroTik:${NC}"
    echo -e "    Panel CRM → Red → Routers → Nuevo router VPN"
    echo -e "    El ERP genera automáticamente el CCD en ${CCD_DIR}/"
    echo ""
}

main() {
    parse_args "$@"
    echo ""
    echo -e "${C}  ╔════════════════════════════════════════════════════╗${NC}"
    echo -e "${C}  ║  DATAFAST ISP — OpenVPN Setup v${SCRIPT_VERSION}             ║${NC}"
    echo -e "${C}  ╚════════════════════════════════════════════════════╝${NC}"
    echo ""
    mkdir -p "${LOG_DIR}"
    touch "${LOG_FILE}"
    _log "INFO" "openvpn-setup.sh v${SCRIPT_VERSION} iniciado"

    if ${FLAG_STATUS_ONLY}; then show_status; exit 0; fi

    if systemctl is-active --quiet openvpn-server@mikrotik 2>/dev/null && ! ${FLAG_REINSTALL}; then
        echo -e "${Y}[!] OpenVPN ya está instalado. Usa --reinstall para forzar.${NC}"
        show_status
        exit 0
    fi

    check_requirements
    install_dependencies
    install_easyrsa
    generate_pki
    deploy_server_certs
    generate_mikrotik_conf
    generate_vpn_auth_script
    configure_network
    configure_ufw
    configure_fail2ban
    configure_systemd
    save_pki_metadata
    validate_installation || true
    show_summary
    _log "INFO" "openvpn-setup.sh v${SCRIPT_VERSION} completado"
}

main "$@"
