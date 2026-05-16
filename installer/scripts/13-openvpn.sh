#!/usr/bin/env bash
# Módulo 13 — OpenVPN Server para gestión de equipos ISP

setup_openvpn() {
    step "Configurando servidor OpenVPN"

    local setup_script="${INSTALL_DIR}/scripts/openvpn-setup.sh"

    if [[ ! -f "$setup_script" ]]; then
        warn "Script openvpn-setup.sh no encontrado en ${setup_script}. Omitiendo VPN."
        return 0
    fi

    chmod +x "$setup_script"

    # Pasar variables de red VPN si están en defaults
    export VPN_PORT="${VPN_PORT:-1194}"
    export VPN_PROTO="${VPN_PROTO:-tcp}"
    export VPN_NETWORK="${VPN_NETWORK:-10.8.0.0}"
    export VPN_NETMASK="${VPN_NETMASK:-255.255.255.0}"

    if bash "$setup_script" >> "${LOG_FILE}" 2>&1; then
        ok "OpenVPN instalado y operativo"
    else
        warn "OpenVPN no pudo instalarse automáticamente."
        warn "Ejecutar manualmente después: sudo bash ${setup_script}"
    fi
}
