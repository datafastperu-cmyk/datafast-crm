#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  CRM ISP DATAFAST — Instalador Principal v1.0.0
#  Ubuntu 22.04 / 24.04 LTS
#
#  Uso:
#    sudo bash install.sh              # Producción
#    sudo bash install.sh --dev        # Desarrollo (hot-reload)
#    sudo bash install.sh --check      # Solo verificar requisitos
#    sudo bash install.sh --upgrade    # Actualizar versión
#    sudo bash install.sh --uninstall  # Desinstalar
# ═══════════════════════════════════════════════════════════════

_REPO_RAW="https://raw.githubusercontent.com/datafastperu-cmyk/datafast-crm/main"

set -uo pipefail
IFS=$'\n\t'

# ── Configuración ─────────────────────────────────────────────
readonly DATAFAST_VERSION="1.0.0"
readonly REPO_RAW="${_REPO_RAW}"
readonly INSTALL_DIR="/opt/datafast"
readonly LOG_DIR="/var/log/datafast"
readonly LOG_FILE="${LOG_DIR}/install-$(date +%Y%m%d_%H%M%S).log"
readonly MIN_RAM_MB=1500
readonly MIN_DISK_GB=5
readonly NODE_VERSION=20
readonly PG_VERSION=16
readonly _INSTALL_START=$(date +%s)

FLAG_SILENT=false
FLAG_UPGRADE=false
FLAG_CHECK=false
FLAG_UNINSTALL=false
FLAG_DEV=false

# ── Colores ───────────────────────────────────────────────────
R='\033[0;31m'; G='\033[0;32m'; Y='\033[1;33m'
B='\033[0;34m'; C='\033[0;36m'; W='\033[1;37m'
BOLD='\033[1m'; D='\033[2m'; NC='\033[0m'

# ── Contadores de progreso ─────────────────────────────────────
_STEP_TOTAL=15
_STEP_CURRENT=0

# ── Logging ───────────────────────────────────────────────────
_log()   { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [$1] ${*:2}" >> "${LOG_FILE}" 2>/dev/null || true; }
info()   { echo -e "${B}[·]${NC} $*"; _log "INFO" "$*"; }
ok()     { echo -e "${G}[✓]${NC} $*"; _log "OK  " "$*"; }
warn()   { echo -e "${Y}[!]${NC} $*"; _log "WARN" "$*"; }
detail() { echo -e "    ${D}$*${NC}"; _log "    " "$*"; }

error() {
    echo -e "\n${R}${BOLD}[✗] ERROR: $*${NC}" >&2
    echo -e "${R}    Revisa el log completo:${NC} ${LOG_FILE}" >&2
    echo -e "${R}    Últimas 20 líneas:${NC}" >&2
    tail -20 "${LOG_FILE}" 2>/dev/null | sed 's/^/    /' >&2
    _log "ERR " "$*"
    exit 1
}

step() {
    (( _STEP_CURRENT++ )) || true
    local elapsed=$(( $(date +%s) - _INSTALL_START ))
    local mins=$(( elapsed / 60 ))
    local secs=$(( elapsed % 60 ))
    echo -e "\n${BOLD}${C}━━━ [${_STEP_CURRENT}/${_STEP_TOTAL}] $*  ${D}(${mins}m${secs}s)${NC}"
    _log "STEP" "[${_STEP_CURRENT}/${_STEP_TOTAL}] $*"
}

# ── Trap global de errores ─────────────────────────────────────
_error_trap() {
    local exit_code=$?
    local line_no=${BASH_LINENO[0]}
    local cmd="${BASH_COMMAND}"
    echo -e "\n${R}${BOLD}[✗] INSTALACIÓN INTERRUMPIDA${NC}" >&2
    echo -e "${R}    Línea ${line_no}: ${cmd}${NC}" >&2
    echo -e "${R}    Código de salida: ${exit_code}${NC}" >&2
    echo -e "${R}    Log completo: ${LOG_FILE}${NC}" >&2
    echo -e "${Y}    Para continuar desde donde se interrumpió:${NC}" >&2
    echo -e "    sudo bash install.sh${FLAG_DEV:+ --dev}  # reinicia la instalación" >&2
    _log "TRAP" "Error en línea ${line_no}: ${cmd} (exit ${exit_code})"
}
trap '_error_trap' ERR

# ── Argumentos ────────────────────────────────────────────────
parse_args() {
    for arg in "$@"; do
        case "$arg" in
            --silent)    FLAG_SILENT=true    ;;
            --upgrade)   FLAG_UPGRADE=true   ;;
            --check)     FLAG_CHECK=true     ;;
            --uninstall) FLAG_UNINSTALL=true ;;
            --dev)       FLAG_DEV=true       ;;
        esac
    done
    export FLAG_DEV FLAG_SILENT FLAG_UPGRADE
}

# ── Banner ────────────────────────────────────────────────────
show_banner() {
    clear
    local mode_label="PRODUCCIÓN"
    $FLAG_DEV && mode_label="DESARROLLO"
    echo -e "${C}"
    echo "  ╔══════════════════════════════════════════════════════╗"
    echo -e "  ║  ${W}DATAFAST ISP ERP${C} — Instalador v${DATAFAST_VERSION}              ║"
    echo -e "  ║  ${D}Modo: ${mode_label}${C}$(printf '%*s' $((34 - ${#mode_label})) '')║"
    echo "  ╚══════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

# ── Init logs ─────────────────────────────────────────────────
init_logs() {
    mkdir -p "${LOG_DIR}"
    touch "${LOG_FILE}"
    chmod 640 "${LOG_FILE}"
    _log "INFO" "DATAFAST Installer v${DATAFAST_VERSION} iniciado — modo: $( $FLAG_DEV && echo 'dev' || echo 'prod' )"
    _log "INFO" "OS: $(lsb_release -ds 2>/dev/null || echo unknown)"
    _log "INFO" "IP: $(hostname -I | awk '{print $1}')"
    _log "INFO" "RAM: $(awk '/MemTotal/{printf "%d MB", $2/1024}' /proc/meminfo)"
    _log "INFO" "Disco: $(df -h / | tail -1 | awk '{print $4}') libre"
}

# ── Descargar scripts desde GitHub ───────────────────────────
download_scripts() {
    step "Descargando módulos de instalación"
    mkdir -p "${INSTALL_DIR}/installer/scripts"
    mkdir -p "${INSTALL_DIR}/installer/config"

    local scripts=(
        "scripts/00-checks.sh"
        "scripts/01-system.sh"
        "scripts/02-04-deps.sh"
        "scripts/03-postgres-dev.sh"
        "scripts/04-redis-dev.sh"
        "scripts/05-nginx.sh"
        "scripts/06-ssl.sh"
        "scripts/07-app.sh"
        "scripts/07-app-dev.sh"
        "scripts/08-pm2.sh"
        "scripts/08-dev.sh"
        "scripts/09-security.sh"
        "scripts/10-11-monitoring-backup.sh"
        "scripts/12-finish.sh"
        "scripts/13-openvpn.sh"
        "config/defaults.conf"
    )

    local failed=0
    for script in "${scripts[@]}"; do
        local url="${REPO_RAW}/installer/${script}"
        local dest="${INSTALL_DIR}/installer/${script}"
        mkdir -p "$(dirname "$dest")"
        if curl -fsSL --max-time 30 --retry 3 --retry-delay 5 "$url" -o "$dest" 2>>"${LOG_FILE}"; then
            sed -i 's/\r//' "$dest" 2>/dev/null || true
            sed -i $'1s/^\xef\xbb\xbf//' "$dest" 2>/dev/null || true
            chmod +x "$dest" 2>/dev/null || true
            detail "✓ $script"
        else
            warn "No se pudo descargar: $script"
            (( failed++ )) || true
        fi
    done

    [[ $failed -gt 3 ]] && error "Demasiados módulos fallaron (${failed}). Verifica conectividad a GitHub."
    ok "Módulos descargados ($((${#scripts[@]} - failed))/${#scripts[@]})"
}

# ── Cargar módulos ────────────────────────────────────────────
load_modules() {
    local base="${INSTALL_DIR}/installer"
    local modules=(
        "${base}/scripts/00-checks.sh"
        "${base}/scripts/01-system.sh"
        "${base}/scripts/02-04-deps.sh"
        "${base}/scripts/03-postgres-dev.sh"
        "${base}/scripts/04-redis-dev.sh"
        "${base}/scripts/05-nginx.sh"
        "${base}/scripts/06-ssl.sh"
        "${base}/scripts/07-app.sh"
        "${base}/scripts/07-app-dev.sh"
        "${base}/scripts/08-pm2.sh"
        "${base}/scripts/08-dev.sh"
        "${base}/scripts/09-security.sh"
        "${base}/scripts/10-11-monitoring-backup.sh"
        "${base}/scripts/12-finish.sh"
        "${base}/scripts/13-openvpn.sh"
    )
    for m in "${modules[@]}"; do
        if [[ -f "$m" ]]; then
            source "$m" || warn "Error al cargar módulo: $m"
        else
            warn "Módulo no encontrado: $m"
        fi
    done
}

# ── Verificar root ────────────────────────────────────────────
require_root() {
    [[ $EUID -eq 0 ]] || error "Este instalador requiere privilegios de administrador.
    Ejecuta: sudo bash install.sh${FLAG_DEV:+ --dev}"
}

# ── Verificar Ubuntu ──────────────────────────────────────────
require_ubuntu() {
    local os_id; os_id=$(lsb_release -si 2>/dev/null || echo "unknown")
    if [[ "$os_id" != "Ubuntu" ]]; then
        warn "Sistema operativo: ${os_id}. Este instalador está optimizado para Ubuntu 22.04/24.04."
        warn "Puede funcionar en derivados de Debian, pero sin garantía."
    fi
}

# ── Main ──────────────────────────────────────────────────────
main() {
    parse_args "$@"
    require_root
    require_ubuntu
    show_banner
    init_logs

    # Copiar o descargar módulos
    if [[ -d "./installer/scripts" ]]; then
        cp -r ./installer "${INSTALL_DIR}/"
        find "${INSTALL_DIR}/installer" -name "*.sh"   -exec sed -i 's/\r//' {} +
        find "${INSTALL_DIR}/installer" -name "*.conf" -exec sed -i 's/\r//' {} +
        find "${INSTALL_DIR}/installer" -name "*.sh"   -exec chmod +x {} +
    else
        download_scripts
    fi

    load_modules

    if   $FLAG_CHECK;     then run_checks; exit 0
    elif $FLAG_UNINSTALL; then run_uninstall; exit 0
    elif $FLAG_UPGRADE;   then run_upgrade
    elif $FLAG_DEV;       then run_install_dev
    else                       run_install
    fi
}

main "$@"
