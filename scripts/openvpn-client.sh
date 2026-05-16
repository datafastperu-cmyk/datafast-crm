#!/usr/bin/env bash
# ================================================================
#  DATAFAST ISP CRM — OpenVPN Client Certificate Generator
#  Versión: 2.0.0
#  Genera certificado de cliente y archivo .ovpn listo para importar
#  en MikroTik (WinBox), Ubiquiti, o cualquier cliente OpenVPN.
# ================================================================
#  Uso:
#    sudo bash scripts/openvpn-client.sh <nombre>           # Generar
#    sudo bash scripts/openvpn-client.sh <nombre> --revoke  # Revocar
#    sudo bash scripts/openvpn-client.sh --list             # Listar clientes
#
#  Ejemplos:
#    sudo bash scripts/openvpn-client.sh router-castilla-norte
#    sudo bash scripts/openvpn-client.sh router-piura-sur --revoke
# ================================================================

set -euo pipefail
IFS=$'\n\t'

# ── Rutas ──────────────────────────────────────────────────────
readonly OPENVPN_DIR="/etc/openvpn"
readonly SERVER_DIR="${OPENVPN_DIR}/server"
readonly EASYRSA_DIR="${OPENVPN_DIR}/easy-rsa"
readonly PKI_DIR="${EASYRSA_DIR}/pki"
readonly CLIENTS_DIR="${SERVER_DIR}/clients"
readonly PKI_META_FILE="${SERVER_DIR}/pki-meta.json"
readonly LOG_DIR="/var/log/datafast"

# ── Colores ────────────────────────────────────────────────────
R='\033[0;31m'; G='\033[0;32m'; Y='\033[1;33m'
C='\033[0;36m'; W='\033[1;37m'; NC='\033[0m'

info()  { echo -e "  ${C}→${NC} $*" >&2; }
ok()    { echo -e "  ${G}✓${NC} $*" >&2; }
warn()  { echo -e "  ${Y}!${NC} $*" >&2; }
error() { echo -e "  ${R}✗ ERROR:${NC} $*" >&2; exit 1; }

# ── Verificaciones ─────────────────────────────────────────────
check_prerequisites() {
    [[ $EUID -eq 0 ]] || error "Ejecutar como root: sudo bash $0 <nombre>"

    [[ -d "${EASYRSA_DIR}" ]] || \
        error "EasyRSA no encontrado en ${EASYRSA_DIR}. Ejecutar openvpn-setup.sh primero."

    [[ -f "${PKI_DIR}/ca.crt" ]] || \
        error "PKI no inicializada. Ejecutar openvpn-setup.sh primero."

    [[ -f "${SERVER_DIR}/ta.key" ]] || \
        error "ta.key no encontrado en ${SERVER_DIR}."

    mkdir -p "${CLIENTS_DIR}"
    mkdir -p "${LOG_DIR}"
}

# ── Leer metadata del servidor ─────────────────────────────────
read_server_meta() {
    local public_ip="" vpn_port="1194" vpn_proto="tcp"

    if [[ -f "${PKI_META_FILE}" ]] && command -v python3 &>/dev/null; then
        public_ip=$(python3 -c "import json,sys; d=json.load(open('${PKI_META_FILE}')); print(d.get('publicIp',''))" 2>/dev/null || echo "")
        vpn_port=$(python3 -c "import json,sys; d=json.load(open('${PKI_META_FILE}')); print(d.get('vpnPort',1194))" 2>/dev/null || echo "1194")
        vpn_proto=$(python3 -c "import json,sys; d=json.load(open('${PKI_META_FILE}')); print(d.get('vpnProtocol','tcp'))" 2>/dev/null || echo "tcp")
    fi

    # Fallback a detección automática
    if [[ -z "$public_ip" ]]; then
        public_ip=$(curl -4 -fsSL --connect-timeout 5 --max-time 10 https://api.ipify.org 2>/dev/null | tr -d '[:space:]' || hostname -I | awk '{print $1}')
    fi

    echo "${public_ip}:${vpn_port}:${vpn_proto}"
}

# ── Validar nombre del cliente ──────────────────────────────────
validate_client_name() {
    local name="$1"
    # Solo letras, números, guiones y guiones bajos
    if ! [[ "$name" =~ ^[a-zA-Z0-9_-]{2,64}$ ]]; then
        error "Nombre inválido: '${name}'. Solo letras, números, - y _. Longitud: 2-64 chars."
    fi
    # Nombres reservados
    local reserved=("server" "ca" "dh" "ta" "client")
    for r in "${reserved[@]}"; do
        [[ "$name" == "$r" ]] && error "Nombre reservado: '${name}'"
    done
}

# ── Generar certificado de cliente ─────────────────────────────
generate_client_cert() {
    local client_name="$1"

    cd "${EASYRSA_DIR}"

    # Verificar si ya existe
    if [[ -f "${PKI_DIR}/issued/${client_name}.crt" ]]; then
        warn "Certificado '${client_name}' ya existe. Regenerando..."
        ./easyrsa --batch revoke "${client_name}" >> "${LOG_DIR}/openvpn-clients.log" 2>&1 || true
        ./easyrsa --batch gen-crl >> "${LOG_DIR}/openvpn-clients.log" 2>&1 || true
        cp "${PKI_DIR}/crl.pem" "${SERVER_DIR}/crl.pem"
    fi

    info "Generando certificado para: ${client_name}"
    ./easyrsa --batch gen-req "${client_name}" nopass >> "${LOG_DIR}/openvpn-clients.log" 2>&1
    ./easyrsa --batch sign-req client "${client_name}" >> "${LOG_DIR}/openvpn-clients.log" 2>&1

    ok "Certificado generado: ${client_name}"
}

# ── Construir archivo .ovpn ────────────────────────────────────
# El .ovpn incluye todos los certificados inline — un solo archivo
# que WinBox/RouterOS puede importar directamente.
build_ovpn_file() {
    local client_name="$1"

    # Leer metadata del servidor
    local meta; meta=$(read_server_meta)
    local server_ip; server_ip=$(echo "$meta" | cut -d: -f1)
    local server_port; server_port=$(echo "$meta" | cut -d: -f2)
    local server_proto; server_proto=$(echo "$meta" | cut -d: -f3)

    # Construir el .ovpn
    cat << OVPN
# ================================================================
#  DATAFAST ISP CRM — Cliente VPN: ${client_name}
#  Servidor: ${server_ip}:${server_port}/${server_proto}
#  Generado: $(date)
#
#  Compatibilidad:
#    - RouterOS 6.x: TCP + AES-256-CBC
#    - RouterOS 7.x: TCP/UDP + AES-256-GCM
#    - Ubiquiti UniFi / EdgeOS
#    - Linux / Windows / macOS OpenVPN client
# ================================================================

client
dev tun
proto ${server_proto}
remote ${server_ip} ${server_port}
resolv-retry infinite
nobind
persist-key
persist-tun

# Seguridad
cipher AES-256-CBC
ncp-ciphers AES-256-GCM:AES-128-GCM:AES-256-CBC
auth SHA256
tls-version-min 1.2
key-direction 1

# Verificación del servidor (previene ataques MITM)
remote-cert-tls server

# Logs
verb 3
mute 20

# ── Certificados inline ───────────────────────────────────────
<ca>
$(cat "${PKI_DIR}/ca.crt")
</ca>

<cert>
$(openssl x509 -in "${PKI_DIR}/issued/${client_name}.crt" 2>/dev/null)
</cert>

<key>
$(cat "${PKI_DIR}/private/${client_name}.key")
</key>

<tls-crypt>
$(cat "${SERVER_DIR}/ta.key")
</tls-crypt>
OVPN
}

# ── Revocar certificado ────────────────────────────────────────
revoke_client_cert() {
    local client_name="$1"

    [[ -f "${PKI_DIR}/issued/${client_name}.crt" ]] || \
        error "Certificado '${client_name}' no encontrado"

    cd "${EASYRSA_DIR}"

    warn "Revocando certificado: ${client_name}"
    ./easyrsa --batch revoke "${client_name}" >> "${LOG_DIR}/openvpn-clients.log" 2>&1
    ./easyrsa --batch gen-crl >> "${LOG_DIR}/openvpn-clients.log" 2>&1

    # Actualizar CRL en el servidor (OpenVPN la lee dinámicamente)
    cp "${PKI_DIR}/crl.pem" "${SERVER_DIR}/crl.pem"
    chmod 644 "${SERVER_DIR}/crl.pem"

    # Recargar OpenVPN para que tome la nueva CRL
    systemctl reload openvpn-server@server 2>/dev/null || \
        systemctl restart openvpn-server@server 2>/dev/null || true

    # Eliminar .ovpn guardado si existe
    rm -f "${CLIENTS_DIR}/${client_name}.ovpn"

    ok "Certificado '${client_name}' revocado. Conexiones existentes serán terminadas."
    echo "CRL actualizada en: ${SERVER_DIR}/crl.pem" >&2
}

# ── Listar clientes ────────────────────────────────────────────
list_clients() {
    echo -e "\n${W}Clientes VPN registrados:${NC}\n"

    if [[ ! -d "${PKI_DIR}/issued" ]]; then
        echo "  No hay certificados generados."
        return
    fi

    local count=0
    while IFS= read -r cert_file; do
        local name; name=$(basename "${cert_file}" .crt)
        [[ "$name" == "server" ]] && continue

        local expiry; expiry=$(openssl x509 -enddate -noout -in "${cert_file}" 2>/dev/null | cut -d= -f2 || echo "desconocido")
        local status="activo"

        # Verificar si está revocado en la CRL
        if [[ -f "${PKI_DIR}/crl.pem" ]]; then
            if openssl crl -noout -text -in "${PKI_DIR}/crl.pem" 2>/dev/null | grep -q "$(openssl x509 -serial -noout -in "${cert_file}" 2>/dev/null | cut -d= -f2)"; then
                status="${R}revocado${NC}"
            fi
        fi

        # Verificar si está conectado
        local connected=""
        if [[ -f "/var/log/openvpn/status.log" ]]; then
            grep -q "${name}" "/var/log/openvpn/status.log" 2>/dev/null && connected="${G} [CONECTADO]${NC}"
        fi

        echo -e "  ${C}${name}${NC}  |  vence: ${expiry}  |  ${status}${connected}"
        ((count++)) || true
    done < <(find "${PKI_DIR}/issued" -name "*.crt" 2>/dev/null | sort)

    echo -e "\n  Total: ${count} cliente(s)\n"
}

# ── Mostrar ayuda ──────────────────────────────────────────────
show_help() {
    echo ""
    echo -e "${W}Uso:${NC}"
    echo "  sudo bash scripts/openvpn-client.sh <nombre>           Generar .ovpn"
    echo "  sudo bash scripts/openvpn-client.sh <nombre> --revoke  Revocar certificado"
    echo "  sudo bash scripts/openvpn-client.sh --list             Listar clientes"
    echo ""
    echo -e "${W}Ejemplos:${NC}"
    echo "  sudo bash scripts/openvpn-client.sh router-castilla-norte"
    echo "  sudo bash scripts/openvpn-client.sh router-piura-sur --revoke"
    echo ""
    echo -e "${W}Nombres sugeridos para MikroTik:${NC}"
    echo "  router-<zona>-<ciudad>  (ej: router-norte-piura)"
    echo "  mikrotik-<site>         (ej: mikrotik-castilla)"
    echo ""
}

# ── Main ───────────────────────────────────────────────────────
main() {
    local client_name="${1:-}"
    local action="generate"

    # Parsear argumentos
    for arg in "$@"; do
        case "$arg" in
            --revoke) action="revoke"  ;;
            --list)   action="list"    ;;
            --help|-h) action="help"   ;;
        esac
    done

    case "$action" in
        help)
            show_help
            exit 0
            ;;
        list)
            check_prerequisites
            list_clients
            exit 0
            ;;
        revoke)
            [[ -z "$client_name" || "$client_name" == "--revoke" ]] && \
                { show_help; error "Especifica el nombre del cliente a revocar."; }
            check_prerequisites
            validate_client_name "$client_name"
            revoke_client_cert "$client_name"
            exit 0
            ;;
        generate)
            [[ -z "$client_name" ]] && { show_help; error "Especifica el nombre del cliente."; }
            check_prerequisites
            validate_client_name "$client_name"
            generate_client_cert "$client_name"

            # Generar el .ovpn (a stdout para que el backend pueda capturarlo)
            local ovpn_content; ovpn_content=$(build_ovpn_file "$client_name")

            # Guardar en disco
            echo "$ovpn_content" > "${CLIENTS_DIR}/${client_name}.ovpn"
            chmod 600 "${CLIENTS_DIR}/${client_name}.ovpn"

            ok "Archivo guardado: ${CLIENTS_DIR}/${client_name}.ovpn"

            # Imprimir el .ovpn a stdout (para captura por el backend)
            echo "$ovpn_content"
            ;;
    esac
}

main "$@"
