#!/usr/bin/env bash
# Módulo 00 — Verificaciones previas

run_checks() {
    step "Verificando requisitos del sistema"
    local failed=0

    # ── Sistema operativo ──────────────────────────────────────
    info "Sistema operativo..."
    local os_id os_ver
    os_id=$(lsb_release -si 2>/dev/null || echo "unknown")
    os_ver=$(lsb_release -sr 2>/dev/null || echo "0")
    if [[ "$os_id" == "Ubuntu" ]]; then
        ok "Ubuntu ${os_ver}"
        local ver_major; ver_major=$(echo "$os_ver" | cut -d. -f1)
        [[ $ver_major -lt 22 ]] && warn "Versión Ubuntu ${os_ver} — se recomienda 22.04 o superior"
    else
        warn "SO: ${os_id} — no verificado. Continuando de todos modos."
        (( failed++ )) || true
    fi

    # ── Privilegios ────────────────────────────────────────────
    [[ $EUID -eq 0 ]] && ok "Privilegios root" || error "Ejecuta: sudo bash install.sh"

    # ── RAM ────────────────────────────────────────────────────
    info "Memoria RAM..."
    local ram_mb; ram_mb=$(awk '/MemTotal/{printf "%d", $2/1024}' /proc/meminfo)
    if   [[ $ram_mb -lt 1500 ]]; then
        warn "RAM muy limitada: ${ram_mb}MB — mínimo recomendado 2048MB"
        (( failed++ )) || true
    elif [[ $ram_mb -lt 2048 ]]; then
        warn "RAM: ${ram_mb}MB — suficiente pero limitado para producción"
    else
        ok "RAM: ${ram_mb}MB"
    fi

    # ── Disco ──────────────────────────────────────────────────
    info "Espacio en disco..."
    local disk_gb
    disk_gb=$(df / 2>/dev/null | tail -1 | awk '{printf "%d", $4/1024/1024}')
    disk_gb="${disk_gb:-1}"
    local min_disk=5
    $FLAG_DEV && min_disk=8  # Dev necesita espacio para imágenes Docker
    if   [[ $disk_gb -lt $min_disk ]]; then
        warn "Disco insuficiente: ${disk_gb}GB libre (mínimo ${min_disk}GB)"
        (( failed++ )) || true
    elif [[ $disk_gb -lt 15 ]]; then
        warn "Disco: ${disk_gb}GB libre — suficiente para instalar"
    else
        ok "Disco libre: ${disk_gb}GB"
    fi

    # ── CPU ────────────────────────────────────────────────────
    local cpus; cpus=$(nproc)
    [[ $cpus -ge 2 ]] && ok "CPUs: ${cpus}" || warn "CPUs: ${cpus} (recomendado 2+)"

    # ── Conectividad ───────────────────────────────────────────
    info "Conectividad a internet..."
    if curl -fsSL --max-time 10 --retry 2 https://github.com >/dev/null 2>&1; then
        ok "Internet disponible"
    else
        warn "Sin acceso a GitHub — la descarga de código puede fallar"
        (( failed++ )) || true
    fi

    # ── Detección de IP ────────────────────────────────────────
    info "Detectando IP pública..."
    PUBLIC_IP=$(hostname -I | awk '{print $1}')
    [[ -z "$PUBLIC_IP" ]] && PUBLIC_IP=$(curl -fsSL --max-time 5 https://api.ipify.org 2>/dev/null || echo "")
    [[ -z "$PUBLIC_IP" ]] && PUBLIC_IP=$(ip route get 1 2>/dev/null | awk '{print $7; exit}' || echo "127.0.0.1")
    ok "IP detectada: ${PUBLIC_IP}"
    export PUBLIC_IP

    # ── Puertos en uso ─────────────────────────────────────────
    info "Verificando puertos requeridos..."
    _check_ports

    # ── Herramientas base ─────────────────────────────────────
    info "Herramientas base..."
    local missing=()
    for cmd in curl wget git openssl; do
        command -v "$cmd" &>/dev/null || missing+=("$cmd")
    done
    if [[ ${#missing[@]} -gt 0 ]]; then
        warn "Herramientas faltantes: ${missing[*]} — se instalarán en el siguiente paso"
    else
        ok "Herramientas base presentes"
    fi

    # ── Resumen ────────────────────────────────────────────────
    echo ""
    if [[ $failed -gt 0 ]]; then
        warn "${failed} requisito(s) no cumplido(s) — la instalación continúa pero puede fallar"
        _log "WARN" "Instalación con ${failed} requisito(s) no cumplido(s)"
    else
        ok "Todos los requisitos verificados"
    fi
}

_check_ports() {
    # Puertos que deben estar LIBRES antes de instalar
    # Formato: "puerto:servicio:bloqueante(si/no)"
    local port_checks=()

    if $FLAG_DEV; then
        port_checks=(
            "3000:Frontend Next.js:si"
            "4000:Backend NestJS:si"
            "5432:PostgreSQL:si"
            "6379:Redis:si"
            "8080:Evolution API:no"
        )
    else
        port_checks=(
            "80:Nginx HTTP:si"
            "443:Nginx HTTPS:si"
            "3000:Frontend Next.js:si"
            "4000:Backend NestJS:si"
            "5432:PostgreSQL:si"
            "6379:Redis:si"
            "8080:Evolution API:no"
            "1195:OpenVPN-MikroTik:no"
        )
    fi

    local bloqueado=false
    for entry in "${port_checks[@]}"; do
        local port; port=$(echo "$entry" | cut -d: -f1)
        local svc;  svc=$(echo "$entry" | cut -d: -f2)
        local blk;  blk=$(echo "$entry" | cut -d: -f3)

        if ss -tuln 2>/dev/null | grep -q ":${port} "; then
            local pid_info; pid_info=$(ss -tulnp 2>/dev/null | grep ":${port} " | awk '{print $NF}' | head -1)
            if [[ "$blk" == "si" ]]; then
                warn "Puerto ${port} (${svc}) ya está en uso: ${pid_info}"
                warn "  → Detén el proceso antes de instalar: kill \$(lsof -t -i:${port})"
                bloqueado=true
            else
                warn "Puerto ${port} (${svc}) en uso — ${svc} puede no iniciar correctamente"
            fi
        else
            detail "Puerto ${port} (${svc}) — libre"
        fi
    done

    if $bloqueado; then
        error "Uno o más puertos requeridos están ocupados. Libéralos y vuelve a ejecutar el instalador."
    fi
}
