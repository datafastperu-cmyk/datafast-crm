#!/usr/bin/env bash
# Módulo 00 — Verificaciones previas (modo automático, sin interacción)

run_checks() {
    step "Verificando requisitos del sistema"
    local failed=0

    info "Sistema operativo..."
    local os_id os_ver
    os_id=$(lsb_release -si 2>/dev/null || echo "unknown")
    os_ver=$(lsb_release -sr 2>/dev/null || echo "0")
    [[ "$os_id" == "Ubuntu" ]] && ok "Ubuntu ${os_ver} LTS" || { warn "SO no verificado: ${os_id}"; ((failed++)) || true; }

    info "Privilegios de administrador..."
    [[ $EUID -eq 0 ]] && ok "Root OK" || { error "Ejecuta: sudo bash install.sh"; }

    info "Memoria RAM..."
    local ram_mb
    ram_mb=$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo)
    if   [[ $ram_mb -lt 1500 ]]; then warn "RAM muy limitada: ${ram_mb}MB — se procede de todos modos"; ((failed++)) || true
    elif [[ $ram_mb -lt 2048 ]]; then warn "RAM limitada: ${ram_mb}MB — continuando"
    else ok "RAM: ${ram_mb}MB"
    fi

    info "Espacio en disco..."
    local disk_gb
    disk_gb=$(df / 2>/dev/null | tail -1 | awk '{printf "%d", $4/1024/1024}')
    [[ -z "$disk_gb" || "$disk_gb" -eq 0 ]] && disk_gb=$(df -BG / 2>/dev/null | tail -1 | awk '{gsub("G","",$4); printf "%d", $4+0}')
    disk_gb="${disk_gb:-1}"
    if   [[ $disk_gb -lt 5  ]]; then warn "Disco muy limitado: ${disk_gb}GB — se procede de todos modos"
    elif [[ $disk_gb -lt 15 ]]; then warn "Disco limitado: ${disk_gb}GB — suficiente para instalar"
    else ok "Disco libre: ${disk_gb}GB"
    fi

    info "CPU..."
    local cpus; cpus=$(nproc)
    [[ $cpus -ge 2 ]] && ok "CPUs: ${cpus}" || warn "CPUs: ${cpus} (recomendado 2+)"

    info "Conectividad a internet..."
    if curl -fsSL --max-time 5 https://github.com >/dev/null 2>&1; then
        ok "Internet disponible"
    else
        warn "Sin conectividad verificada — continuando de todos modos"
        ((failed++)) || true
    fi

    info "Puertos disponibles..."
    for port in 80 443; do
        ss -tuln 2>/dev/null | grep -q ":${port} " \
            && warn "Puerto ${port} en uso — nginx puede fallar si el puerto está ocupado" \
            || detail "Puerto ${port} disponible"
    done

    info "Detectando IP pública..."
    PUBLIC_IP=$(hostname -I | awk '{print $1}')
    [[ -z "$PUBLIC_IP" ]] && PUBLIC_IP=$(curl -fsSL --max-time 5 https://api.ipify.org 2>/dev/null || echo "")
    if [[ -n "$PUBLIC_IP" ]]; then
        ok "IP detectada: ${PUBLIC_IP}"
    else
        warn "No se pudo detectar la IP pública — se usará la de la interfaz de red"
        PUBLIC_IP=$(ip route get 1 2>/dev/null | awk '{print $7; exit}' || echo "127.0.0.1")
    fi
    export PUBLIC_IP

    info "Detectando arquitectura..."
    local arch; arch=$(uname -m)
    ok "Arquitectura: ${arch}"

    info "Detectando interfaces de red..."
    local iface; iface=$(ip route | awk '/default/{print $5; exit}')
    [[ -n "$iface" ]] && ok "Interfaz principal: ${iface}" || warn "No se detectó interfaz de red principal"

    echo ""
    if [[ $failed -gt 0 ]]; then
        warn "${failed} requisito(s) no cumplido(s) — continuando automáticamente"
        _log "WARN" "Instalación con ${failed} requisito(s) no cumplido(s)"
    else
        ok "Todos los requisitos verificados correctamente"
    fi
}
