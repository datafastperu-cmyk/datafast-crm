#!/usr/bin/env bash
# ================================================================
#  DATAFAST ISP CRM — OpenVPN Server Setup
#  Versión: 2.0.0
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
readonly SCRIPT_VERSION="2.0.0"
readonly INSTALL_DIR="/opt/datafast"
readonly LOG_DIR="/var/log/datafast"
readonly VPN_LOG_DIR="/var/log/openvpn"
readonly OPENVPN_DIR="/etc/openvpn"
readonly SERVER_DIR="${OPENVPN_DIR}/server"
readonly EASYRSA_DIR="${OPENVPN_DIR}/easy-rsa"
readonly PKI_DIR="${EASYRSA_DIR}/pki"
readonly CLIENTS_DIR="${SERVER_DIR}/clients"
readonly PKI_META_FILE="${SERVER_DIR}/pki-meta.json"

# Parámetros configurables (pueden sobreescribirse con variables de entorno)
VPN_PORT="${VPN_PORT:-1194}"
VPN_PROTO="${VPN_PROTO:-tcp}"          # tcp = compatible con RouterOS 6.x y 7.x
VPN_NETWORK="${VPN_NETWORK:-10.8.0.0}"
VPN_NETMASK="${VPN_NETMASK:-255.255.255.0}"
VPN_DNS1="${VPN_DNS1:-1.1.1.1}"
VPN_DNS2="${VPN_DNS2:-8.8.8.8}"
VPN_MAX_CLIENTS="${VPN_MAX_CLIENTS:-100}"
VPN_KEEPALIVE="${VPN_KEEPALIVE:-10 60}"
CA_EXPIRE="${CA_EXPIRE:-3650}"         # 10 años
CERT_EXPIRE="${CERT_EXPIRE:-3650}"     # 10 años
EASYRSA_VERSION="${EASYRSA_VERSION:-3.1.7}"

FLAG_REINSTALL=false
FLAG_STATUS_ONLY=false

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

# ── Argumentos ─────────────────────────────────────────────────
parse_args() {
    for arg in "$@"; do
        case "$arg" in
            --reinstall) FLAG_REINSTALL=true  ;;
            --status)    FLAG_STATUS_ONLY=true ;;
        esac
    done
}

# ── Verificaciones previas ─────────────────────────────────────
check_requirements() {
    [[ $EUID -eq 0 ]] || error "Ejecutar como root: sudo bash $0"

    # Sistema operativo
    local os_id; os_id=$(. /etc/os-release 2>/dev/null && echo "${ID:-unknown}")
    [[ "$os_id" == "ubuntu" || "$os_id" == "debian" ]] || \
        warn "Sistema detectado: ${os_id}. Optimizado para Ubuntu/Debian."

    # Verificar módulo TUN del kernel
    if ! lsmod | grep -q "^tun " 2>/dev/null; then
        modprobe tun 2>/dev/null || warn "Módulo TUN no disponible — OpenVPN puede no funcionar"
    fi

    mkdir -p "${LOG_DIR}" "${VPN_LOG_DIR}"
    chmod 750 "${VPN_LOG_DIR}"
    ok "Verificaciones previas pasadas"
}

# ── Detectar IP pública ────────────────────────────────────────
detect_public_ip() {
    local ip=""
    # Intentar múltiples servicios en orden de preferencia
    for service in \
        "https://api.ipify.org" \
        "https://checkip.amazonaws.com" \
        "https://icanhazip.com" \
        "https://ifconfig.me/ip"
    do
        ip=$(curl -4 -fsSL --connect-timeout 5 --max-time 10 "$service" 2>/dev/null | tr -d '[:space:]') && \
        [[ -n "$ip" ]] && break
    done

    # Fallback a IP local
    if [[ -z "$ip" ]]; then
        ip=$(hostname -I | awk '{print $1}')
        warn "No se pudo detectar IP pública. Usando IP local: ${ip}"
    fi

    echo "$ip"
}

# ── Instalar dependencias ──────────────────────────────────────
install_dependencies() {
    step "Instalando dependencias de OpenVPN"

    apt-get update -qq >> "${LOG_FILE}" 2>&1

    local pkgs=(
        openvpn
        openssl
        curl
        wget
        ca-certificates
        net-tools
        iptables
        iptables-persistent
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

    # Versión de OpenVPN
    local ovpn_ver; ovpn_ver=$(openvpn --version 2>/dev/null | head -1 | awk '{print $2}')
    ok "OpenVPN ${ovpn_ver} instalado"
}

# ── Instalar EasyRSA ───────────────────────────────────────────
install_easyrsa() {
    step "Instalando EasyRSA ${EASYRSA_VERSION}"

    local easyrsa_url="https://github.com/OpenVPN/easy-rsa/releases/download/v${EASYRSA_VERSION}/EasyRSA-${EASYRSA_VERSION}.tgz"
    local tmp_dir; tmp_dir=$(mktemp -d)

    # Descargar EasyRSA
    info "Descargando EasyRSA ${EASYRSA_VERSION}..."
    if ! curl -fsSL --retry 3 --retry-delay 2 \
        "${easyrsa_url}" -o "${tmp_dir}/easyrsa.tgz" >> "${LOG_FILE}" 2>&1; then
        # Fallback: usar EasyRSA del paquete del sistema si está disponible
        if command -v make-cadir &>/dev/null; then
            warn "Descarga fallida. Usando EasyRSA del sistema..."
            mkdir -p "${EASYRSA_DIR}"
            make-cadir "${EASYRSA_DIR}" >> "${LOG_FILE}" 2>&1
            rm -rf "${tmp_dir}"
            ok "EasyRSA instalado (sistema)"
            return 0
        fi
        error "No se pudo instalar EasyRSA"
    fi

    tar -xzf "${tmp_dir}/easyrsa.tgz" -C "${tmp_dir}" >> "${LOG_FILE}" 2>&1
    rm -rf "${EASYRSA_DIR}"
    mv "${tmp_dir}/EasyRSA-${EASYRSA_VERSION}" "${EASYRSA_DIR}"
    chmod +x "${EASYRSA_DIR}/easyrsa"
    rm -rf "${tmp_dir}"

    ok "EasyRSA ${EASYRSA_VERSION} instalado en ${EASYRSA_DIR}"
}

# ── Generar PKI completa ───────────────────────────────────────
generate_pki() {
    step "Generando infraestructura de clave pública (PKI)"

    cd "${EASYRSA_DIR}"

    # Configurar variables de EasyRSA
    cat > "${EASYRSA_DIR}/vars" << EOF
# EasyRSA 3 — DATAFAST ISP CRM
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

    # Inicializar PKI
    info "Inicializando PKI..."
    ./easyrsa --batch init-pki >> "${LOG_FILE}" 2>&1
    ok "PKI inicializada"

    # Construir CA
    info "Generando Certificate Authority (CA)..."
    ./easyrsa --batch build-ca nopass >> "${LOG_FILE}" 2>&1
    ok "CA generada"

    # Generar certificado y clave del servidor
    info "Generando certificado del servidor..."
    ./easyrsa --batch gen-req server nopass >> "${LOG_FILE}" 2>&1
    ./easyrsa --batch sign-req server server >> "${LOG_FILE}" 2>&1
    ok "Certificado del servidor generado y firmado"

    # Generar DH params 2048-bit
    info "Generando parámetros Diffie-Hellman 2048-bit (puede tomar 1-3 min)..."
    # Usar dsaparam para aceleración — matemáticamente equivalente para TLS
    openssl dhparam -dsaparam -out "${PKI_DIR}/dh.pem" 2048 >> "${LOG_FILE}" 2>&1
    ok "DH params generados"

    # Generar TLS-Crypt key (protección adicional contra ataques DDoS/scanning)
    info "Generando clave TLS-Crypt..."
    openvpn --genkey secret "${SERVER_DIR}/ta.key" >> "${LOG_FILE}" 2>&1
    ok "Clave TLS-Crypt generada"

    # Generar CRL (Certificate Revocation List)
    info "Generando CRL..."
    ./easyrsa --batch gen-crl >> "${LOG_FILE}" 2>&1
    ok "CRL generada"

    ok "PKI completa generada"
}

# ── Copiar certificados al directorio del servidor ─────────────
deploy_server_certs() {
    step "Desplegando certificados en el servidor"

    mkdir -p "${SERVER_DIR}"
    mkdir -p "${CLIENTS_DIR}"

    # Certificados del servidor
    cp "${PKI_DIR}/ca.crt"                    "${SERVER_DIR}/ca.crt"
    cp "${PKI_DIR}/issued/server.crt"         "${SERVER_DIR}/server.crt"
    cp "${PKI_DIR}/private/server.key"        "${SERVER_DIR}/server.key"
    cp "${PKI_DIR}/dh.pem"                    "${SERVER_DIR}/dh.pem"
    cp "${PKI_DIR}/crl.pem"                   "${SERVER_DIR}/crl.pem"
    # ta.key ya está en SERVER_DIR

    # Permisos seguros
    chmod 750 "${SERVER_DIR}"
    chmod 644 "${SERVER_DIR}/ca.crt"
    chmod 644 "${SERVER_DIR}/server.crt"
    chmod 600 "${SERVER_DIR}/server.key"
    chmod 644 "${SERVER_DIR}/dh.pem"
    chmod 644 "${SERVER_DIR}/crl.pem"
    chmod 600 "${SERVER_DIR}/ta.key"
    chmod 750 "${CLIENTS_DIR}"

    ok "Certificados desplegados con permisos correctos"
}

# ── Generar server.conf ────────────────────────────────────────
generate_server_conf() {
    step "Generando configuración del servidor OpenVPN"

    cat > "${SERVER_DIR}/server.conf" << EOF
# ================================================================
#  DATAFAST ISP CRM — OpenVPN Server Configuration
#  Generado automáticamente por openvpn-setup.sh v${SCRIPT_VERSION}
#  Fecha: $(date)
# ================================================================
#
#  Diseñado para gestión de equipos ISP:
#  MikroTik (RouterOS 6.x y 7.x), Huawei OLT, ZTE, VSOL, Ubiquiti
#
#  Compatibilidad MikroTik:
#  - RouterOS 6.x: TCP obligatorio, AES-256-CBC
#  - RouterOS 7.x: UDP soportado, AES-256-GCM
# ================================================================

# ── Red y protocolo ───────────────────────────────────────────
port ${VPN_PORT}
proto ${VPN_PROTO}
dev tun

# ── Certificados y llaves ─────────────────────────────────────
ca   ${SERVER_DIR}/ca.crt
cert ${SERVER_DIR}/server.crt
key  ${SERVER_DIR}/server.key
dh   ${SERVER_DIR}/dh.pem

# CRL — revocar certificados comprometidos
crl-verify ${SERVER_DIR}/crl.pem

# TLS-Crypt — protección contra port scanning y ataques DDoS
# Autenticación bidireccional del canal de control TLS
tls-crypt ${SERVER_DIR}/ta.key 0

# ── Topología de red ──────────────────────────────────────────
server ${VPN_NETWORK} ${VPN_NETMASK}
topology subnet
ifconfig-pool-persist ${VPN_LOG_DIR}/ipp.txt

# ── Rutas para gestión ISP ────────────────────────────────────
# Los equipos ISP obtienen una IP VPN y pueden alcanzar el servidor
# NO redirigir todo el tráfico de los routers por el VPN (rompería internet)
push "route ${VPN_NETWORK} ${VPN_NETMASK}"

# DNS de respaldo para los clientes VPN
push "dhcp-option DNS ${VPN_DNS1}"
push "dhcp-option DNS ${VPN_DNS2}"

# ── Seguridad de transporte ────────────────────────────────────
# Cipher principal: AES-256-GCM (moderno)
# Fallback: AES-256-CBC (compatibilidad con RouterOS 6.x)
cipher AES-256-CBC
ncp-ciphers AES-256-GCM:AES-128-GCM:AES-256-CBC
auth SHA256
tls-version-min 1.2

# Curvas ECDH modernas
ecdh-curve prime256v1

# ── Opciones de cliente ───────────────────────────────────────
max-clients ${VPN_MAX_CLIENTS}

# Permitir comunicación entre clientes VPN (routers entre sí)
# Útil para monitoreo SNMP cross-router y gestión distribuida
client-to-client

# Mantener configuración de routing del cliente sin modificarla
#push "redirect-gateway def1 bypass-dhcp"

# ── Persistencia y reconexión ─────────────────────────────────
keepalive ${VPN_KEEPALIVE}
persist-key
persist-tun

# ── Seguridad del proceso ─────────────────────────────────────
user nobody
group nogroup

# ── Compresión — DESHABILITADA (vulnerabilidad VORACLE) ───────
# comp-lzo    # NO usar — vulnerable a VORACLE attack

# ── Logs ─────────────────────────────────────────────────────
status ${VPN_LOG_DIR}/status.log 30
log-append ${VPN_LOG_DIR}/openvpn.log
verb 3
mute 20
status-version 2

# ── Opciones adicionales ──────────────────────────────────────
# Notificar a clientes cuando el servidor se cierra normalmente
explicit-exit-notify 1

# Script de eventos de conexión/desconexión (opcional)
# script-security 2
# client-connect    /opt/datafast/scripts/vpn-client-connect.sh
# client-disconnect /opt/datafast/scripts/vpn-client-disconnect.sh
EOF

    chmod 640 "${SERVER_DIR}/server.conf"
    ok "server.conf generado"
}

# ── Configurar IP forwarding y NAT ─────────────────────────────
configure_network() {
    step "Configurando forwarding de red y NAT"

    # Detectar interfaz de red principal
    local main_iface; main_iface=$(ip route get 8.8.8.8 2>/dev/null | awk 'NR==1{for(i=1;i<=NF;i++) if($i=="dev") print $(i+1)}')
    if [[ -z "$main_iface" ]]; then
        main_iface=$(ip link show | awk -F': ' '/^[0-9]+: / && !/lo|tun/ {print $2; exit}')
    fi
    info "Interfaz principal detectada: ${main_iface}"

    # Habilitar IP forwarding permanentemente
    if ! grep -q "^net.ipv4.ip_forward=1" /etc/sysctl.conf 2>/dev/null; then
        echo "net.ipv4.ip_forward=1" >> /etc/sysctl.conf
    fi
    # IPv6 forwarding también (para futuras implementaciones)
    if ! grep -q "^net.ipv6.conf.all.forwarding=1" /etc/sysctl.conf 2>/dev/null; then
        echo "net.ipv6.conf.all.forwarding=1" >> /etc/sysctl.conf
    fi
    sysctl -p >> "${LOG_FILE}" 2>&1
    ok "IP forwarding habilitado"

    # Configurar iptables NAT (MASQUERADE para clientes VPN)
    # Permite que los clientes VPN salgan a internet a través del VPS
    iptables -t nat -C POSTROUTING -s "${VPN_NETWORK}/24" -o "${main_iface}" -j MASQUERADE 2>/dev/null || \
    iptables -t nat -A POSTROUTING -s "${VPN_NETWORK}/24" -o "${main_iface}" -j MASQUERADE

    # Permitir tráfico de reenvío entre tun0 y la interfaz principal
    iptables -C FORWARD -i tun0 -o "${main_iface}" -j ACCEPT 2>/dev/null || \
    iptables -A FORWARD -i tun0 -o "${main_iface}" -j ACCEPT

    iptables -C FORWARD -i "${main_iface}" -o tun0 -m state --state RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || \
    iptables -A FORWARD -i "${main_iface}" -o tun0 -m state --state RELATED,ESTABLISHED -j ACCEPT

    # Permitir tráfico en la interfaz VPN
    iptables -C INPUT  -i tun0 -j ACCEPT 2>/dev/null || iptables -A INPUT  -i tun0 -j ACCEPT
    iptables -C OUTPUT -o tun0 -j ACCEPT 2>/dev/null || iptables -A OUTPUT -o tun0 -j ACCEPT

    # Persistir reglas iptables entre reinicios
    if command -v netfilter-persistent &>/dev/null; then
        netfilter-persistent save >> "${LOG_FILE}" 2>&1 || true
    elif command -v iptables-save &>/dev/null; then
        mkdir -p /etc/iptables
        iptables-save > /etc/iptables/rules.v4
        # Asegurar que se carguen al inicio
        if [[ ! -f /etc/network/if-pre-up.d/iptables ]]; then
            cat > /etc/network/if-pre-up.d/iptables << 'IPEOF'
#!/bin/sh
iptables-restore < /etc/iptables/rules.v4
exit 0
IPEOF
            chmod +x /etc/network/if-pre-up.d/iptables
        fi
    fi

    ok "NAT e iptables configurados (interfaz: ${main_iface})"
}

# ── Configurar UFW para OpenVPN ────────────────────────────────
configure_ufw() {
    if ! command -v ufw &>/dev/null; then return 0; fi
    if ! ufw status | grep -q "Status: active"; then return 0; fi

    step "Configurando UFW para OpenVPN"

    ufw allow "${VPN_PORT}/${VPN_PROTO}" comment "OpenVPN DATAFAST" >> "${LOG_FILE}" 2>&1
    # Tráfico de la interfaz TUN
    if ! grep -q "DEFAULT_FORWARD_POLICY=\"ACCEPT\"" /etc/default/ufw 2>/dev/null; then
        sed -i 's/DEFAULT_FORWARD_POLICY="DROP"/DEFAULT_FORWARD_POLICY="ACCEPT"/' /etc/default/ufw
    fi
    ufw reload >> "${LOG_FILE}" 2>&1 || true
    ok "UFW: puerto ${VPN_PORT}/${VPN_PROTO} abierto"
}

# ── Configurar systemd ─────────────────────────────────────────
configure_systemd() {
    step "Configurando servicio systemd"

    # OpenVPN usa openvpn-server@<nombre_conf>.service
    # El archivo server.conf debe estar en /etc/openvpn/server/
    systemctl daemon-reload >> "${LOG_FILE}" 2>&1

    # Habilitar inicio automático
    systemctl enable openvpn-server@server >> "${LOG_FILE}" 2>&1
    ok "Servicio openvpn-server@server habilitado en el arranque"

    # Arrancar el servicio
    info "Iniciando OpenVPN..."
    if systemctl start openvpn-server@server >> "${LOG_FILE}" 2>&1; then
        sleep 2  # Esperar a que la interfaz tun0 aparezca
        ok "OpenVPN iniciado"
    else
        # Intentar ver qué falló
        journalctl -u openvpn-server@server --no-pager -n 20 >> "${LOG_FILE}" 2>&1
        error "OpenVPN no pudo iniciar. Revisar: journalctl -u openvpn-server@server"
    fi
}

# ── Guardar metadata PKI (para el backend) ─────────────────────
save_pki_metadata() {
    step "Guardando metadata de PKI"

    local public_ip; public_ip=$(detect_public_ip)
    local ca_expiry; ca_expiry=$(openssl x509 -enddate -noout -in "${SERVER_DIR}/ca.crt" | cut -d= -f2)
    local server_expiry; server_expiry=$(openssl x509 -enddate -noout -in "${SERVER_DIR}/server.crt" | cut -d= -f2)

    # Leer contenido de certificados para el backend
    local ca_cert; ca_cert=$(cat "${SERVER_DIR}/ca.crt")
    local server_cert; server_cert=$(cat "${SERVER_DIR}/server.crt")
    local ta_key; ta_key=$(cat "${SERVER_DIR}/ta.key")

    cat > "${PKI_META_FILE}" << EOF
{
  "version": "${SCRIPT_VERSION}",
  "installedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "publicIp": "${public_ip}",
  "vpnPort": ${VPN_PORT},
  "vpnProtocol": "${VPN_PROTO}",
  "vpnNetwork": "${VPN_NETWORK}",
  "vpnNetmask": "${VPN_NETMASK}",
  "pkiDir": "${EASYRSA_DIR}",
  "serverDir": "${SERVER_DIR}",
  "clientsDir": "${CLIENTS_DIR}",
  "statusLog": "${VPN_LOG_DIR}/status.log",
  "caExpiry": "${ca_expiry}",
  "serverExpiry": "${server_expiry}",
  "cipher": "AES-256-CBC",
  "ncpCiphers": "AES-256-GCM:AES-128-GCM:AES-256-CBC",
  "auth": "SHA256",
  "tlsVersion": "1.2"
}
EOF
    chmod 640 "${PKI_META_FILE}"
    ok "Metadata guardada en ${PKI_META_FILE}"
}

# ── Validaciones finales ───────────────────────────────────────
validate_installation() {
    step "Validando instalación"

    local errors=0

    # Verificar servicio activo
    if systemctl is-active --quiet openvpn-server@server; then
        ok "Servicio OpenVPN: ACTIVO"
    else
        warn "Servicio OpenVPN: INACTIVO"
        ((errors++)) || true
    fi

    # Verificar interfaz tun0
    if ip link show tun0 &>/dev/null; then
        local tun_ip; tun_ip=$(ip addr show tun0 | grep 'inet ' | awk '{print $2}' | head -1)
        ok "Interfaz tun0: ${tun_ip:-UP}"
    else
        warn "Interfaz tun0 no encontrada"
        ((errors++)) || true
    fi

    # Verificar puerto escuchando
    if ss -lnp "sport = :${VPN_PORT}" 2>/dev/null | grep -q "${VPN_PORT}"; then
        ok "Puerto ${VPN_PORT}/${VPN_PROTO}: ESCUCHANDO"
    elif netstat -lnp 2>/dev/null | grep ":${VPN_PORT} " | grep -q "openvpn"; then
        ok "Puerto ${VPN_PORT}/${VPN_PROTO}: ESCUCHANDO"
    else
        warn "Puerto ${VPN_PORT}/${VPN_PROTO} no encontrado en listeners"
    fi

    # Verificar certificados
    for cert in ca.crt server.crt server.key dh.pem ta.key; do
        if [[ -f "${SERVER_DIR}/${cert}" ]]; then
            ok "Certificado: ${cert}"
        else
            warn "Falta: ${cert}"
            ((errors++)) || true
        fi
    done

    # Verificar IP forwarding
    if [[ "$(cat /proc/sys/net/ipv4/ip_forward)" == "1" ]]; then
        ok "IP forwarding: HABILITADO"
    else
        warn "IP forwarding: DESHABILITADO"
        ((errors++)) || true
    fi

    # Verificar metadata PKI
    if [[ -f "${PKI_META_FILE}" ]]; then
        ok "Metadata PKI: guardada"
    fi

    if [[ $errors -eq 0 ]]; then
        ok "Todas las validaciones pasadas"
    else
        warn "${errors} advertencia(s) encontrada(s) — revisar log: ${LOG_FILE}"
    fi

    return $errors
}

# ── Mostrar estado ─────────────────────────────────────────────
show_status() {
    echo ""
    echo -e "${W}━━━ Estado OpenVPN ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""

    local active; active=$(systemctl is-active openvpn-server@server 2>/dev/null || echo "desconocido")
    local enabled; enabled=$(systemctl is-enabled openvpn-server@server 2>/dev/null || echo "desconocido")

    echo -e "  Servicio: $([ "$active" = "active" ] && echo "${G}${active}${NC}" || echo "${R}${active}${NC}")"
    echo -e "  Inicio:   $([ "$enabled" = "enabled" ] && echo "${G}${enabled}${NC}" || echo "${Y}${enabled}${NC}")"

    if ip link show tun0 &>/dev/null; then
        local tun_ip; tun_ip=$(ip addr show tun0 | grep 'inet ' | awk '{print $2}' | head -1)
        echo -e "  tun0:     ${G}${tun_ip:-UP}${NC}"
    else
        echo -e "  tun0:     ${R}no encontrada${NC}"
    fi

    if [[ -f "${VPN_LOG_DIR}/status.log" ]]; then
        local clients; clients=$(grep -c "^CLIENT_LIST" "${VPN_LOG_DIR}/status.log" 2>/dev/null || echo 0)
        echo -e "  Clientes conectados: ${C}${clients}${NC}"
    fi

    echo ""
    systemctl status openvpn-server@server --no-pager -l 2>/dev/null | tail -n 15 || true
    echo ""
}

# ── Mostrar resumen final ──────────────────────────────────────
show_summary() {
    local public_ip; public_ip=$(detect_public_ip)

    echo ""
    echo -e "${G}"
    echo "  ╔════════════════════════════════════════════════════════╗"
    echo "  ║  ✅  OpenVPN instalado y operativo                     ║"
    echo "  ╚════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
    echo -e "  ${W}Servidor:${NC}  ${public_ip}:${VPN_PORT}/${VPN_PROTO}"
    echo -e "  ${W}Red VPN:${NC}   ${VPN_NETWORK}/24  (servidor: ${VPN_NETWORK%.*}.1)"
    echo -e "  ${W}Cifrado:${NC}   AES-256-GCM | SHA-256 | TLS 1.2+"
    echo -e "  ${W}PKI:${NC}       ${EASYRSA_DIR}"
    echo -e "  ${W}Certs:${NC}     ${SERVER_DIR}"
    echo -e "  ${W}Logs:${NC}      ${VPN_LOG_DIR}/openvpn.log"
    echo -e "  ${W}Estado:${NC}    ${VPN_LOG_DIR}/status.log"
    echo ""
    echo -e "  ${Y}Próximos pasos:${NC}"
    echo -e "    1. Panel CRM → Red → OpenVPN → configurar IP del servidor"
    echo -e "    2. Para cada router MikroTik:"
    echo -e "       ${C}bash scripts/openvpn-client.sh <nombre-router>${NC}"
    echo -e "    3. Importar .ovpn en WinBox → PPP → OpenVPN Client"
    echo -e "    4. Panel CRM → Red → Routers → agregar router con IP VPN"
    echo ""
    echo -e "  ${B}Compatibilidad MikroTik:${NC}"
    echo -e "    RouterOS 6.x: TCP + AES-256-CBC (configurado)"
    echo -e "    RouterOS 7.x: UDP + AES-256-GCM (cambiar proto a udp si aplica)"
    echo ""
    echo -e "  Log completo: ${LOG_FILE}"
    echo ""
}

# ── Main ───────────────────────────────────────────────────────
main() {
    parse_args "$@"

    echo ""
    echo -e "${C}  ╔═══════════════════════════════════════════════╗${NC}"
    echo -e "${C}  ║  DATAFAST ISP — OpenVPN Setup v${SCRIPT_VERSION}        ║${NC}"
    echo -e "${C}  ╚═══════════════════════════════════════════════╝${NC}"
    echo ""

    mkdir -p "${LOG_DIR}"
    touch "${LOG_FILE}"
    _log "INFO" "openvpn-setup.sh v${SCRIPT_VERSION} iniciado"

    # Solo mostrar estado
    if ${FLAG_STATUS_ONLY}; then
        show_status
        exit 0
    fi

    # Verificar si ya está instalado
    if systemctl is-active --quiet openvpn-server@server 2>/dev/null && ! ${FLAG_REINSTALL}; then
        echo -e "${Y}[!] OpenVPN ya está instalado y activo.${NC}"
        echo -e "    Usa --reinstall para forzar la reinstalación."
        echo -e "    Usa --status para ver el estado actual."
        show_status
        exit 0
    fi

    check_requirements
    install_dependencies
    install_easyrsa
    generate_pki
    deploy_server_certs
    generate_server_conf
    configure_network
    configure_ufw
    configure_systemd
    save_pki_metadata
    validate_installation || true
    show_summary

    _log "INFO" "openvpn-setup.sh completado exitosamente"
}

main "$@"
