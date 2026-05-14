#!/usr/bin/env bash
# Módulo 00 — Verificaciones previas

run_checks() {
    step "Verificando requisitos del sistema"
    local failed=0

    info "Sistema operativo..."
    local os_id os_ver
    os_id=$(lsb_release -si 2>/dev/null || echo "unknown")
    os_ver=$(lsb_release -sr 2>/dev/null || echo "0")
    [[ "$os_id" == "Ubuntu" ]] && ok "Ubuntu ${os_ver} LTS" || { warn "SO no verificado: ${os_id}"; ((failed++)) || true; }

    info "Privilegios de administrador..."
    [[ $EUID -eq 0 ]] && ok "Root OK" || { warn "No es root"; ((failed++)) || true; }

    info "Memoria RAM..."
    local ram_mb
    ram_mb=$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo)
    if   [[ $ram_mb -lt 1500 ]]; then warn "RAM muy limitada: ${ram_mb}MB"; ((failed++)) || true
    elif [[ $ram_mb -lt 2048 ]]; then warn "RAM limitada: ${ram_mb}MB — continuando"; ok "RAM aceptable: ${ram_mb}MB"
    else ok "RAM: ${ram_mb}MB"
    fi

    info "Espacio en disco..."
    local disk_gb
    disk_gb=$(df / 2>/dev/null | tail -1 | awk '{printf "%d", $4/1024/1024}')
    [[ -z "$disk_gb" || "$disk_gb" -eq 0 ]] && disk_gb=$(df -BG / 2>/dev/null | tail -1 | awk '{gsub("G","",$4); printf "%d", $4+0}')
    disk_gb="${disk_gb:-1}"
    if   [[ $disk_gb -lt 5  ]]; then warn "Disco muy limitado: ${disk_gb}GB"; ((failed++)) || true
    elif [[ $disk_gb -lt 15 ]]; then warn "Disco limitado: ${disk_gb}GB — suficiente para instalar"; ok "Disco: ${disk_gb}GB"
    else ok "Disco libre: ${disk_gb}GB"
    fi

    info "CPU..."
    local cpus; cpus=$(nproc)
    [[ $cpus -ge 2 ]] && ok "CPUs: ${cpus}" || warn "CPUs: ${cpus} (recomendado 2+)"

    info "Conectividad a internet..."
    if curl -fsSL --max-time 5 https://github.com >/dev/null 2>&1; then
        ok "Internet disponible"
    else
        warn "Sin conectividad verificada"; ((failed++)) || true
    fi

    info "Puertos disponibles..."
    for port in 80 443; do
        ss -tuln 2>/dev/null | grep -q ":${port} " && warn "Puerto ${port} en uso" || detail "Puerto ${port} disponible"
    done
    ok "Verificación de puertos OK"

    echo ""
    if [[ $failed -gt 0 ]]; then
        warn "${failed} requisito(s) no cumplido(s). La instalación puede fallar."
        if ! ${FLAG_SILENT:-false}; then
            read -rp "¿Continuar de todos modos? [s/N] " resp
            [[ "$resp" =~ ^[sS]$ ]] || exit 1
        fi
    else
        ok "Todos los requisitos verificados correctamente"
    fi
}
