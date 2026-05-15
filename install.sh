#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  CRM ISP DATAFAST — Instalador Principal v1.0.0
#  Ubuntu 22.04 / 24.04 LTS
# ═══════════════════════════════════════════════════════════════
set -euo pipefail
IFS=$'\n\t'

# ── Configuración ─────────────────────────────────────────────
readonly DATAFAST_VERSION="1.0.0"
readonly REPO_RAW="https://raw.githubusercontent.com/datafastperu-cmyk/datafast-crm/main"
readonly INSTALL_DIR="/opt/datafast"
readonly LOG_DIR="/var/log/datafast"
readonly LOG_FILE="${LOG_DIR}/install-$(date +%Y%m%d_%H%M%S).log"
readonly MIN_RAM_MB=1500
readonly MIN_DISK_GB=5
readonly NODE_VERSION=20
readonly PG_VERSION=16

FLAG_SILENT=false
FLAG_UPGRADE=false
FLAG_CHECK=false
FLAG_UNINSTALL=false

# ── Colores ───────────────────────────────────────────────────
R='\033[0;31m'; G='\033[0;32m'; Y='\033[1;33m'
B='\033[0;34m'; C='\033[0;36m'; W='\033[1;37m'
BOLD='\033[1m'; D='\033[2m'; NC='\033[0m'

# ── Logging ───────────────────────────────────────────────────
_log()   { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [$1] ${*:2}" >> "${LOG_FILE}" 2>/dev/null || true; }
info()   { echo -e "${B}[·]${NC} $*"; _log "INFO" "$*"; }
ok()     { echo -e "${G}[✓]${NC} $*"; _log "OK  " "$*"; }
warn()   { echo -e "${Y}[!]${NC} $*"; _log "WARN" "$*"; }
error()  { echo -e "${R}[✗]${NC} $*" >&2; _log "ERR " "$*"; exit 1; }
step()   { echo -e "\n${BOLD}${C}━━━ $*${NC}"; _log "STEP" "$*"; }
detail() { echo -e "    ${D}$*${NC}"; _log "    " "$*"; }

# ── Argumentos ────────────────────────────────────────────────
parse_args() {
    for arg in "$@"; do
        case "$arg" in
            --silent)    FLAG_SILENT=true    ;;
            --upgrade)   FLAG_UPGRADE=true   ;;
            --check)     FLAG_CHECK=true     ;;
            --uninstall) FLAG_UNINSTALL=true ;;
        esac
    done
}

# ── Banner ────────────────────────────────────────────────────
show_banner() {
    clear
    echo -e "${C}"
    echo "  ╔══════════════════════════════════════════════════════╗"
    echo -e "  ║  ${W}DATAFAST ISP ERP${C} — Instalador v${DATAFAST_VERSION}              ║"
    echo -e "  ║  ${D}Sistema de Gestión para Proveedores de Internet${C}  ║"
    echo "  ╚══════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

# ── Init logs ─────────────────────────────────────────────────
init_logs() {
    mkdir -p "${LOG_DIR}"
    touch "${LOG_FILE}"
    chmod 640 "${LOG_FILE}"
    _log "INFO" "DATAFAST Installer v${DATAFAST_VERSION} iniciado"
    _log "INFO" "OS: $(lsb_release -ds 2>/dev/null || echo unknown)"
    _log "INFO" "IP: $(hostname -I | awk '{print $1}')"
}

# ── Descargar scripts desde GitHub ───────────────────────────
download_scripts() {
    step "Descargando módulos de instalación"
    mkdir -p "${INSTALL_DIR}/installer/scripts"
    mkdir -p "${INSTALL_DIR}/installer/config"

    local scripts=(
        "scripts/00-checks.sh"
        "scripts/01-system.sh"
        "scripts/02-nodejs.sh"
        "scripts/03-postgres.sh"
        "scripts/04-redis.sh"
        "scripts/05-nginx.sh"
        "scripts/06-ssl.sh"
        "scripts/07-app.sh"
        "scripts/08-pm2.sh"
        "scripts/09-firewall.sh"
        "scripts/10-monitoring.sh"
        "scripts/11-backup.sh"
        "scripts/12-finish.sh"
        "config/defaults.conf"
    )

    for script in "${scripts[@]}"; do
        local url="${REPO_RAW}/installer/${script}"
        local dest="${INSTALL_DIR}/installer/${script}"
        mkdir -p "$(dirname "$dest")"
        if curl -fsSL "$url" -o "$dest" 2>>"${LOG_FILE}"; then
            sed -i 's/\r//' "$dest" 2>/dev/null || true   # strip Windows CRLF
            chmod +x "$dest" 2>/dev/null || true
            detail "✓ $script"
        else
            warn "No se pudo descargar $script"
        fi
    done
    ok "Módulos descargados"
}

# ── Cargar módulos ────────────────────────────────────────────
load_modules() {
    local base="${INSTALL_DIR}/installer"
    local modules=(
        "${base}/scripts/00-checks.sh"
        "${base}/scripts/01-system.sh"
        "${base}/scripts/02-nodejs.sh"
        "${base}/scripts/03-postgres.sh"
        "${base}/scripts/04-redis.sh"
        "${base}/scripts/05-nginx.sh"
        "${base}/scripts/06-ssl.sh"
        "${base}/scripts/07-app.sh"
        "${base}/scripts/08-pm2.sh"
        "${base}/scripts/09-firewall.sh"
        "${base}/scripts/10-monitoring.sh"
        "${base}/scripts/11-backup.sh"
        "${base}/scripts/12-finish.sh"
    )
    for m in "${modules[@]}"; do
        [[ -f "$m" ]] && source "$m" || warn "Módulo no encontrado: $m"
    done
}

# ── Verificar root ────────────────────────────────────────────
require_root() {
    [[ $EUID -eq 0 ]] || error "Ejecuta: sudo bash install.sh"
}

# ── Main ──────────────────────────────────────────────────────
main() {
    parse_args "$@"
    require_root
    show_banner
    init_logs

    # Descargar scripts si no existen localmente
    if [[ ! -d "${INSTALL_DIR}/installer/scripts" ]]; then
        # Si el repo está clonado localmente, copiar desde ahí
        if [[ -d "./installer/scripts" ]]; then
            cp -r ./installer "${INSTALL_DIR}/"
        else
            download_scripts
        fi
    fi

    load_modules

    if   $FLAG_CHECK;     then run_checks; exit 0
    elif $FLAG_UNINSTALL; then run_uninstall; exit 0
    elif $FLAG_UPGRADE;   then run_upgrade
    else                       run_install
    fi
}

main "$@"
