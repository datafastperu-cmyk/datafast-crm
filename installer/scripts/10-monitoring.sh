#!/usr/bin/env bash
# Módulo 10 — Monitoreo
setup_monitoring() {
    step "Configurando monitoreo del servidor"
    info "Creando script de health check..."
    cat > "${INSTALL_DIR}/scripts/health.sh" << 'HEALTHEOF'
#!/usr/bin/env bash
readonly INSTALL_DIR="/opt/fibranet"
G='\033[0;32m' R='\033[0;31m' Y='\033[1;33m' C='\033[0;36m' BOLD='\033[1m' NC='\033[0m'
ok()   { echo -e "  ${G}✓${NC} $*"; }
fail() { echo -e "  ${R}✗${NC} $*"; }
warn() { echo -e "  ${Y}!${NC} $*"; }
echo -e "\n${BOLD}${C}══════════════════════════════════════${NC}"
echo -e "${BOLD}  FibraNet — Health Check $(date '+%Y-%m-%d %H:%M:%S')${NC}"
echo -e "${BOLD}${C}══════════════════════════════════════${NC}"
echo -e "\n${BOLD}── Procesos PM2:${NC}"
pm2 jlist 2>/dev/null | python3 -c "
import json,sys
try:
  p=json.load(sys.stdin)
  for x in p:
    n=x['name']; s=x['pm2_env']['status']
    c=x['monit']['cpu']; m=round(x['monit']['memory']/1024/1024)
    r=x['pm2_env']['restart_time']
    i='✓' if s=='online' else '✗'
    print(f'  {i} {n}: {s} | CPU:{c}% RAM:{m}MB reinicios:{r}')
except: print('  ! No se pudo leer PM2')
" 2>/dev/null
echo -e "\n${BOLD}── Backend API:${NC}"
code=$(curl -sf -o /dev/null -w "%{http_code}" http://localhost:4000/api/v1/health 2>/dev/null)
[ "$code" = "200" ] && ok "OK (HTTP 200)" || fail "No responde (código: ${code:-timeout})"
echo -e "\n${BOLD}── Frontend:${NC}"
code=$(curl -sf -o /dev/null -w "%{http_code}" http://localhost:3000 2>/dev/null)
[ "$code" = "200" ] && ok "OK" || fail "No responde (código: ${code:-timeout})"
echo -e "\n${BOLD}── Servicios:${NC}"
systemctl is-active --quiet nginx       && ok "Nginx activo"      || fail "Nginx inactivo"
systemctl is-active --quiet postgresql  && ok "PostgreSQL activo" || fail "PostgreSQL inactivo"
systemctl is-active --quiet redis-server && ok "Redis activo"     || fail "Redis inactivo"
echo -e "\n${BOLD}── Disco:${NC}"
uso=$(df / --output=pcent | tail -1 | tr -d ' %')
sz=$(df -h / --output=used,size | tail -1)
[ "$uso" -gt 90 ] && fail "Disco al ${uso}%! — ${sz}" || \
[ "$uso" -gt 75 ] && warn "Disco al ${uso}% — ${sz}"  || ok "Disco: ${sz} (${uso}%)"
echo -e "\n${BOLD}── RAM:${NC}"
ram=$(free -h | awk 'NR==2 {printf "%s/%s", $3, $2}')
ok "RAM: ${ram}"
echo ""
HEALTHEOF
    chmod +x "${INSTALL_DIR}/scripts/health.sh"
    (crontab -l 2>/dev/null; echo "0 * * * * ${INSTALL_DIR}/scripts/health.sh >> ${INSTALL_DIR}/logs/health.log 2>&1") | sort -u | crontab -
    ok "Health check creado y programado"
}
