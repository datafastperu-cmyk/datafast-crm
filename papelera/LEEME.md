# 🗑 Papelera — residuos de trabajo, no herramientas

**Nada de aquí se ejecuta.** Son scripts que sirvieron una vez y quedaron superados, y borradores
locales de sesiones de depuración. Se conservan por si alguno tuviera una idea aprovechable, no
porque funcionen.

> **Si buscas cómo desplegar, ver logs o comprobar el VPS, no estás en el sitio correcto.**
> Está en el `Makefile` y en `deploy.mjs`, en la raíz.

---

## `scripts-superados/` — versionados, sustituidos por otra cosa

Todos son de **junio de 2026** y se conectaban por SSH al VPS a hacer una tarea concreta. El
despliegue de agosto (`deploy.mjs`, `deploy-lib.mjs`, `deploy-quick.mjs`) y el `Makefile` hacen lo
mismo, mejor y en un solo sitio.

| Grupo | Ficheros | Qué los sustituye |
|---|---|---|
| **Migraciones** | `migrate.mjs` · `migrate-direct.mjs` · `run_migration.mjs` | `deploy.mjs`. **Tres scripts para la misma tarea era el síntoma** |
| **Build de frontend** | `rebuild-fe.mjs` · `fe-build.mjs` | `deploy_frontend.mjs` |
| **Typecheck remoto** | `typecheck.mjs` · `be-typecheck.mjs` | El CI lo hace en cada push |
| **Logs** | `logs.mjs` · `logs-fe.mjs` | `make logs` y `make logs-frontend` |
| **Comprobaciones puntuales** | `check-sidebar.mjs` · `check-route.mjs` · `check-wa.mjs` · `check-health.mjs` | Eran `grep` remotos contra un componente o una ruta concretos de junio |
| **Arreglos de una vez** | `phase10-deploy.mjs` · `fix-backend.mjs` | Desplegaban «la fase 10» y filtraban una excepción concreta |

**Ninguno estaba referenciado** desde `Makefile`, `install.sh`, `deploy.sh`, los scripts de
despliegue, el CI ni los `package.json`. Se comprobó antes de moverlos.

## `scratch-local/` — nunca estuvieron en el repositorio

`_mon` · `_monitor` · `_monitor2` · `_monitor3` · `_rstmon` · `_d10` · `_vio`

Están cubiertos por `.gitignore` (`_*.mjs`): son borradores de sesiones de depuración que **nunca se
versionaron**. Los números correlativos —`_monitor`, `_monitor2`, `_monitor3`— son la señal.

---

## Qué NO se movió, y por qué

| Se queda | Razón |
|---|---|
| `deploy.mjs` · `deploy-lib.mjs` · `deploy-quick.mjs` · `be-deploy.mjs` · `deploy_frontend.mjs` · `deploy_backend_olt.mjs` | Despliegue vigente, tocado en agosto |
| `vps.config.mjs` | **Dependencia de todos los anteriores** |
| `check-vps.mjs` | Verificar el despliegue en vez de creerle es norma, no capricho: hubo 11 horas de backend viejo mientras el script imprimía «recargado» |
| `_pe_runsql.mjs` · `_vpsrun.mjs` · `_subir-nginx.mjs` | Gitignorados, pero son **herramientas** con propósito declarado. `_pe_runsql` se usó el 16/08 para la medición de F-0.1 §5.2 |
| `deploy_red_vpn.py` | Pertenece al dominio VPN, que aún no se ha reestructurado |
| `Makefile` · `install.sh` · `deploy.sh` · `docker-compose*.yml` · `ecosystem.config.js` | Entradas oficiales |

---

## Regla

**Si algo de aquí vuelve a hacer falta, no se saca: se reescribe** donde corresponda y con su
entrada en el `Makefile`. Sacar un script de junio y ejecutarlo contra el VPS de hoy es la forma
más rápida de reintroducir un problema resuelto.
