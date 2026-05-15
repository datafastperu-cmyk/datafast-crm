#!/usr/bin/env bash
# Módulo 06 — SSL / Let's Encrypt

setup_ssl() {
    step "Configurando SSL / HTTPS"

    if [[ -z "${DOMINIO_FRONTEND:-}" ]]; then
        warn "Sin dominio configurado. SSL omitido."
        warn "Para activar SSL después ejecuta: datafast ssl tu-dominio.pe"
        return
    fi

    info "Instalando Certbot..."
    apt-get install -y -q certbot python3-certbot-nginx >> "${LOG_FILE}" 2>&1

    local domains="-d ${DOMINIO_FRONTEND}"
    [[ -n "${DOMINIO_BACKEND:-}" && "${DOMINIO_BACKEND}" != "${DOMINIO_FRONTEND}" ]] && \
        domains+=" -d ${DOMINIO_BACKEND}"

    info "Solicitando certificado SSL para ${DOMINIO_FRONTEND}..."
    if certbot --nginx ${domains} \
        --email "${ADMIN_EMAIL}" \
        --agree-tos \
        --non-interactive \
        --redirect \
        >> "${LOG_FILE}" 2>&1; then
        ok "SSL activado en ${DOMINIO_FRONTEND}"
    else
        warn "No se pudo obtener el certificado SSL."
        warn "Asegúrate de que el DNS apunta a: $(hostname -I | awk '{print $1}')"
        warn "Luego ejecuta: datafast ssl ${DOMINIO_FRONTEND}"
    fi

    # Cron para renovación automática
    (crontab -l 2>/dev/null; \
     echo "0 3 * * * certbot renew --quiet && systemctl reload nginx") | \
        sort -u | crontab -

    ok "Renovación automática de SSL programada"
}
