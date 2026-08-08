#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Recargar procesos de backend por PM2 — DEFINICIÓN ÚNICA
#
# Este fichero existe porque la misma operación estaba escrita de cinco maneras distintas,
# y las cuatro que no eran `update.sh` no verificaban nada:
#
#   scripts/update.sh          pm2 restart $ECOSYSTEM --only <app> --update-env  + verificación
#   be-deploy.mjs              pm2 restart datafast-api-core --update-env        (B-12)
#   deploy.mjs                 pm2 restart datafast-api-core datafast-worker...
#   deploy-quick.mjs           pm2 restart datafast-api-core datafast-worker...
#   deploy_backend_olt.mjs     pm2 restart datafast-api-core
#
# `pm2 restart <nombre> --update-env` relee el entorno DEL SHELL, no del fichero de
# configuración. El 2026-08-06 el worker perdió así su `PORT: 4001`, arrancó en el 4000
# —el de la API— y entró en bucle con EADDRINUSE. Con `--only` sobre el ecosystem las
# variables salen de donde están declaradas.
#
# Y el 2026-08-05 un despliegue recargó `datafast-backend`, un nombre de proceso que ya no
# existe: PM2 no falla al no encontrarlo, así que el script reportó OK durante 11 horas
# mientras corría el binario anterior. De ahí que los nombres salgan del propio ecosystem
# y que se COMPRUEBE que el proceso reinició, en vez de darlo por hecho.
#
# Uso:
#   source scripts/lib/pm2-recargar.sh
#   pm2_recargar_backend /opt/datafast/ecosystem.config.js
# ─────────────────────────────────────────────────────────────────────────────

# Un reinicio limpio incrementa el contador de PM2 exactamente una vez.
PM2_ASENTADO_SEG="${PM2_ASENTADO_SEG:-15}"
PM2_UPTIME_MAX_MS="${PM2_UPTIME_MAX_MS:-120000}"

# "uptimeMs restarts status" del proceso indicado; "-1 -1 missing" si no existe.
pm2_estado() {
    pm2 jlist 2>/dev/null | node -e "
      let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
        let p=null; try { p=(JSON.parse(d)||[]).find(x=>x.name===process.argv[1]); } catch {}
        if (!p) { console.log('-1 -1 missing'); return; }
        console.log([Date.now()-p.pm2_env.pm_uptime, p.pm2_env.restart_time, p.pm2_env.status].join(' '));
      });" "$1"
}

# Nombres de los procesos de backend, leídos del ecosystem y no de una constante que se
# queda atrás cuando alguien renombra un proceso.
pm2_apps_backend() {
    node -e "
      const apps = require('$1').apps || [];
      console.log(apps.map(a => a.name).filter(n => /api-core|worker/.test(n)).join(' '));
    " 2>/dev/null
}

# Recarga y VERIFICA. Devuelve != 0 si algo no cuadra; quien llama decide si aborta.
pm2_recargar_backend() {
    local ecosystem="$1"
    local apps fallos=0

    apps=$(pm2_apps_backend "$ecosystem")
    if [[ -z "$apps" ]]; then
        echo "ERROR: no se encontraron procesos de backend en ${ecosystem}" >&2
        return 1
    fi
    echo "Procesos de backend: ${apps}"

    for app in $apps; do
        local antes despues uptime estado reinicios_antes reinicios_despues
        read -r _ reinicios_antes _ <<< "$(pm2_estado "$app")"
        antes="$reinicios_antes"

        if ! pm2 restart "$ecosystem" --only "$app" --update-env; then
            echo "ERROR: no se pudo reiniciar ${app}" >&2
            fallos=$((fallos + 1))
            continue
        fi

        # Se deja asentar ANTES de comprobar. Un proceso que arranca y muere también tiene
        # uptime bajo: mirar solo el uptime da por bueno un bucle de reinicio, que es
        # exactamente lo que pasó la primera vez que se escribió esta verificación.
        sleep "$PM2_ASENTADO_SEG"
        read -r uptime reinicios_despues estado <<< "$(pm2_estado "$app")"
        despues="$reinicios_despues"

        if [[ "$estado" != "online" ]]; then
            echo "ERROR: ${app} no está online (estado: ${estado}). Revisa: pm2 logs ${app} --err" >&2
            fallos=$((fallos + 1)); continue
        fi
        if [[ "$uptime" -lt 0 ]] || [[ "$uptime" -gt "$PM2_UPTIME_MAX_MS" ]]; then
            echo "ERROR: ${app} NO reinició (uptime ${uptime}ms). El código nuevo no está en ejecución." >&2
            fallos=$((fallos + 1)); continue
        fi
        if [[ $((despues - antes)) -gt 1 ]]; then
            echo "ERROR: ${app} está en BUCLE de reinicio (${antes}→${despues}). Revisa: pm2 logs ${app} --err" >&2
            fallos=$((fallos + 1)); continue
        fi

        echo "OK: ${app} reiniciado y verificado (uptime ${uptime}ms, reinicios ${antes}→${despues})"
    done

    return "$fallos"
}
