# PRO-001 — Procedimientos Operativos

---

## 2. Control documental

| Campo | Valor |
|---|---|
| **Código** | PRO-001 · **Versión** 1.0 · **Estado** Vigente |
| **Autor** | Arquitectura + Operaciones · **Revisores** Pendientes de asignar |
| **Fecha** | 2026-08-06 · **Documento superior** CON-001, POL-001, ARS-001 |
| **Audiencia** | Operador de plataforma con acceso root al VPS |

## 3. Historial de cambios

| Versión | Fecha | Cambio | Motivo |
|---|---|---|---|
| 1.0 | 2026-08-06 | Emisión inicial | Los procedimientos existían como scripts sin documentación; un incidente de despliegue costó 11 horas de código viejo en producción |

## 4. Índice

1. Despliegue · 2. Actualización · 3. Rollback · 4. Backup · 5. Restore · 6. Monitoreo ·
7. Recuperación ante desastres

## 5. Objetivo

Documentar los procedimientos de operación de la plataforma, con sus verificaciones obligatorias.

## 6. Alcance

VPS de producción con PM2 + Docker. **No cubre** la operación funcional del ERP (MAN-001,
MAN-002) ni el desarrollo (GUI-001).

## 7. Definiciones y glosario

| Término | Definición |
|---|---|
| **Verificación** | Comprobación que sabe distinguir el caso bueno del malo |
| **Ventana de mantenimiento** | Periodo acordado para operaciones con impacto |
| **RTO** | Tiempo objetivo de recuperación |
| **RPO** | Pérdida de datos máxima tolerable |

---

# 8. Contenido

## 8.0 Regla que gobierna todos los procedimientos

> **Una verificación que solo sabe confirmar el caso bueno no es una verificación.**

**Origen (2026-08-06, tres veces el mismo día):** `scripts/update.sh` recargaba
`--only datafast-backend`, un nombre de proceso que **ya no existe** (hoy: `datafast-api-core` y
`datafast-worker-auxiliary`). PM2 no encontraba nada, no fallaba de forma detectable, y el script
imprimía «Backend recargado» igual.

**Las migraciones sí corrían** —son un paso aparte—, así que **la base de datos avanzaba y el
código no**: el esquema decía una cosa y el proceso vivo entendía otra. Durante **11 horas**.

Y escondía un segundo defecto: una columna sin `type:` explícito tumbaba el arranque. Como el
backend nunca reiniciaba, el bug vivía en el código desplegado sin que nadie pudiera verlo — y
salió en el primer reinicio real, con todo el ERP en 500.

La primera corrección **miró solo el uptime**, y un proceso en bucle de reinicio también tiene
uptime bajo. De hecho el bucle lo provocó esa misma corrección, al usar `--update-env` sobre el
nombre suelto en vez del ecosystem: el worker perdió su `PORT: 4001` y chocó con la API.

**Consecuencias normativas:**

| # | Regla |
|---|---|
| 1 | Toda verificación comprueba **el efecto**, no la ausencia de error |
| 2 | Un proceso "arriba" **no es** un proceso sano: hay que descartar el bucle de reinicio |
| 3 | Se recarga **por ecosystem**, nunca por nombre suelto |
| 4 | Si el esquema avanza, el código **debe** haber avanzado; se verifica que ambos coinciden |

## 8.1 Despliegue

### 8.1.1 Topología objetivo

| Proceso | Puerto | Rol |
|---|---|---|
| `datafast-api-core` | 4000 | Atiende al frontend · **único que migra** |
| `datafast-worker-auxiliary` | 4001 | Crons, colas, outbox, watchers |
| `datafast-whatsapp` | 4002 | Chromium (CRM) |
| `olt-automation-service` | 8001 | FastAPI, 1 worker |
| `datafast-frontend` | 3000 | Next.js |

**Contenedores:** PostgreSQL · Redis · Nginx · Certbot · Evolution API.

### 8.1.2 Procedimiento

| # | Paso | Verificación |
|---|---|---|
| 1 | Traer el código a `/opt/datafast` | El commit desplegado coincide con el esperado |
| 2 | Instalar dependencias | Sin errores de instalación |
| 3 | **Build del backend** | `NODE_OPTIONS='--max-old-space-size=2048' npm run build` — el heap por defecto (~987 MB) **es insuficiente** |
| 4 | Build del frontend | Sin errores de ESLint (usar `// eslint-disable-line` **sin regla específica**) |
| 5 | Ejecutar migraciones | `npm run migration:show` confirma el estado |
| 6 | **Recargar por ecosystem** | `pm2 reload ecosystem.config.js` — **nunca `--only <nombre>`** |
| 7 | Guardar el estado de PM2 | `pm2 save` |
| 8 | **Verificar** | §8.1.3 |

### 8.1.3 Verificación obligatoria de despliegue

| # | Comprobación | Qué descarta |
|---|---|---|
| 1 | Los **5** procesos existen con el nombre correcto | Recargar un proceso inexistente |
| 2 | Ninguno está en bucle de reinicio (contador de reinicios estable) | Un proceso "arriba" pero muriendo |
| 3 | Cada proceso escucha en **su** puerto (4000, 4001, 4002, 8001, 3000) | Pérdida de `PORT` por `--update-env` |
| 4 | `GET /health` responde | Backend vivo |
| 5 | `GET /health/modules` sin degradados inesperados | Dependencia caída |
| 6 | `GET /status` reporta la **versión esperada** | **Código viejo con esquema nuevo** |
| 7 | `GET /admin/sistema/watchers` muestra latidos recientes | Worker muerto en silencio |
| 8 | `GET /outbox-red/status` sin acumulación anómala | Outbox parado |
| 9 | Una ruta nueva del despliegue responde | El proceso no se recargó |

> **La comprobación 9 es la que faltaba** en el incidente: una pantalla nueva devolvía
> `400 uuid expected` porque sus rutas no existían en el proceso vivo y caían en `GET /pagos/:id`.

### 8.1.4 Instalación nueva

| # | Paso |
|---|---|
| 1 | Preparar el VPS y clonar el repositorio |
| 2 | Crear `.env.production` **a partir de `.env.example`** — es el contrato de instalación |
| 3 | Levantar PostgreSQL, Redis y Evolution |
| 4 | `npm run migration:run:all` (**instalación nueva**, no el juego incremental) |
| 5 | `npm run seed:run` |
| 6 | `pm2 start ecosystem.config.js && pm2 save` |
| 7 | Configurar dominios y SSL (`ssl-setup.sh` o desde `/config/provisionar-ssl`) |
| 8 | Activar licencia desde `/install` o `/admin/licencia` |
| 9 | Verificar según §8.1.3 |

**Recordatorio:** ningún dominio es obligatorio. El ERP puede servirse por IP.

## 8.2 Actualización

### 8.2.1 Vías

| Vía | Cuándo |
|---|---|
| `scripts/update.sh` (root) | Actualización estándar |
| `POST /admin/sistema/update` | Desde el Centro de Operaciones, con `pg_dump` previo |
| Scripts `deploy*.mjs` | Despliegue por componente |

### 8.2.2 Procedimiento

| # | Paso | Nota |
|---|---|---|
| 1 | **Respaldo previo** | El update transaccional hace `pg_dump` automáticamente |
| 2 | Registrar la versión de partida | `VERSION` + `GET /status` |
| 3 | Traer el código | — |
| 4 | Build (backend y frontend) | Heap ampliado |
| 5 | Migraciones | Solo las ejecuta `api-core` |
| 6 | Recarga por ecosystem | — |
| 7 | **Verificación completa** | §8.1.3, los 9 puntos |
| 8 | Registrar el evento | `eventos_sistema` + `GET /admin/sistema/update-log` |
| 9 | **Observación post-update 48 h** | Vigilar watchers, outbox y colas |

### 8.2.3 Red de seguridad existente

`scripts/update.sh` incluye `_ensure_frontend()`: un *trap* que garantiza que el frontend queda
corriendo **pase lo que pase** con el script (éxito, error o `kill`).

**Nota operativa:** el script usa `PM2_HOME=/root/.pm2` — **instancia única**. Nunca operar con la
instancia PM2 del usuario `datafast`: se verían procesos distintos.

## 8.3 Rollback

### 8.3.1 Decisión

| Situación | Acción |
|---|---|
| El código falla, el esquema no cambió | **Rollback de código** (§8.3.2) |
| El código falla y hubo migraciones | **Rollback de código + revert de migración** (§8.3.3) |
| Los datos se corrompieron | **Restore** (§8.5) |
| Un módulo degradado por un tercero caído | **No hay rollback**: es comportamiento esperado |

### 8.3.2 Rollback de código

| # | Paso | Verificación |
|---|---|---|
| 1 | Volver al commit anterior conocido bueno | El commit coincide |
| 2 | Rebuild | Sin errores |
| 3 | Recarga por ecosystem | — |
| 4 | Verificación completa | §8.1.3 |
| 5 | Registrar el evento y **la causa** | `eventos_sistema` |

### 8.3.3 Revert de migración

| # | Paso |
|---|---|
| 1 | **Respaldo previo obligatorio** |
| 2 | `npm run migration:revert` (una a una, en orden inverso) |
| 3 | `npm run migration:show` para confirmar |
| 4 | Rollback del código a la versión compatible |
| 5 | Verificación completa |

> ⚠️ **Un revert solo es seguro si la migración implementa `down` correctamente.** Si la migración
> destruyó datos, el revert **no** los recupera: hay que restaurar (§8.5).

## 8.4 Backup

### 8.4.1 Qué se respalda

| Elemento | Mecanismo | Criticidad |
|---|---|---|
| **Base de datos** | `pg_dump` vía docker (módulo `backup`) | **Máxima** |
| `.env.production` | Manual | **Máxima** — sin él la base es ilegible (`ENCRYPTION_KEY`) |
| **Certificados y CCD de OpenVPN** | Filesystem | **Máxima** — sin ellos se pierde el acceso a la planta |
| Uploads (logo, fotos, comprobantes, media CRM) | Volumen | Alta |
| Sesión de WhatsApp | Volumen `evolution-data` | Media |
| Certificados TLS | Volumen `certbot-conf` | Baja (regenerables) |
| Logs | Volumen `app-logs` | Baja |

> **El respaldo de la base de datos sin `ENCRYPTION_KEY` es inútil**: las credenciales de routers,
> OLTs y proveedores están cifradas con ella.

### 8.4.2 Procedimiento

| Vía | Uso |
|---|---|
| `POST /admin/backup` | Bajo demanda desde el ERP |
| `scripts/backup.sh` | Desde el VPS |
| Cola `google-drive-backup` | Copia a Google Drive |
| `GET /admin/backup` | Listado e historial |

### 8.4.3 Verificación

| # | Comprobación |
|---|---|
| 1 | El archivo existe y su tamaño es coherente con el histórico |
| 2 | El registro aparece en la tabla `backups` |
| 3 | **Periódicamente: restaurar en un entorno de prueba.** Un respaldo no verificado no es un respaldo |

## 8.5 Restore

### 8.5.1 Procedimiento

| # | Paso |
|---|---|
| 1 | **Detener `api-core`, `worker-auxiliary` y `whatsapp`** — imprescindible: el worker escribiría sobre la base restaurada |
| 2 | Conservar el frontend arriba (página de mantenimiento) |
| 3 | Restaurar el dump en PostgreSQL |
| 4 | Verificar que `.env.production` es **el correspondiente a ese dump** (misma `ENCRYPTION_KEY`) |
| 5 | Comprobar el estado de migraciones (`migration:show`) |
| 6 | Levantar `api-core` y verificar `/health` y `/health/modules` |
| 7 | Levantar el resto de procesos |
| 8 | Verificación completa (§8.1.3) |
| 9 | **Reconciliación con la planta** (§8.5.2) |

### 8.5.2 Reconciliación obligatoria tras un restore

> **Un restore devuelve la base a un momento pasado. La red física NO vuelve atrás.**

Esta es la operación más delicada del sistema: tras restaurar, el plano lógico y el físico están
desincronizados por definición.

| # | Comprobación | Herramienta |
|---|---|---|
| 1 | ONUs en la OLT sin registro en el ERP | `adoptarOnusHuerfanas` · `GET /:oltId/discover-onus` |
| 2 | Registros en el ERP sin ONU en la OLT | `GET /:oltId/ftth/reconciliar` |
| 3 | Estado de suspensión BD ↔ address-lists del router | `GET /mikrotik/drift` · `/address-lists/sobrantes` |
| 4 | Velocidades BD ↔ colas del router | `GET /mikrotik/routers/:id/velocidad/discrepancias` |
| 5 | Pools de recursos vs ocupación real | `POST /:oltId/*-pool/reconciliar` |
| 6 | Comandos del outbox perdidos entre el dump y el fallo | `GET /outbox-red/status` |
| 7 | Pagos registrados y no aplicados | Cron de reconciliación (10 min) |

> ⚠️ **Antes de levantar el worker tras un restore**, ejecutar el pre-flight de PP-10
> (`GET /olt-nativo/ztp/preflight-migracion`). Un restore puede dejar `contrato_onu_config` en un
> estado que los barridos interpreten como drift masivo — y el watcher de re-inyección corre
> **cada 2 minutos**, no a las 03:30: no hay margen para revisarlo después.

## 8.6 Monitoreo

### 8.6.1 Qué vigilar y con qué

| Qué | Dónde | Frecuencia |
|---|---|---|
| Salud del backend | `GET /health`, `/health/live`, `/health/ready` | Automática (Docker/PM2) |
| **Módulos degradados** | `GET /health/modules` | Diaria |
| **Latido de watchers** | `GET /admin/sistema/watchers` | **Diaria — es la única señal de que el worker vive** |
| Colas | `GET /admin/workers/status`, `/jobs` | Diaria |
| **Outbox** | `GET /outbox-red/status` | **Diaria** |
| Eventos del sistema | `GET /admin/sistema/eventos` | Ante incidente |
| Logs de notificación | `GET /admin/sistema/notif-logs` | Ante queja de cliente |
| Memoria y reinicios de PM2 | `pm2 list`, `pm2 monit` | Diaria |
| Espacio en disco | Sistema | Semanal |
| Alertas de red | `GET /monitoreo/alertas` | Continua (WebSocket) |
| Alertas de VPN | `GET /openvpn/mikrotik-clients/alertas` | Diaria |

### 8.6.2 El punto ciego declarado

> **El fallo más peligroso del sistema es que `datafast-worker-auxiliary` muera.**

El ERP **sigue respondiendo con total normalidad** mientras nadie se corta, nadie se reactiva,
ningún comando de red se aplica y ningún watcher repara nada — **sin ninguna señal en la
interfaz**.

Los endpoints de salud son **consultables, no vigilantes**: hay que ir a mirarlos, y nadie mira lo
que parece que funciona.

**Mitigación operativa mientras no exista la alarma automática (RDM-001 R2):** revisión diaria de
`GET /admin/sistema/watchers` y `GET /outbox-red/status`.

### 8.6.3 Señales de alarma

| Señal | Significado probable |
|---|---|
| Sin latido de watchers | **Worker caído** |
| `comandos_red_pendientes` creciendo | Outbox parado o hardware inalcanzable |
| Evento `OUTBOX_RED_AGOTADO` | Un comando agotó sus reintentos: requiere intervención |
| Módulo degradado inesperado | Dependencia externa caída |
| Reinicios de PM2 subiendo | Fuga de memoria o crash en bucle |
| `EMISOR_CAIDO` | Canal de mensajería caído: los avisos de corte no salen |
| `ROUTER_CAIDO` | Nodo o enlace caído |
| Alertas de señal óptica | Fibra degradada (`≤ -27 dBm`) o corte inminente (`≤ -30 dBm`) |

## 8.7 Recuperación ante desastres

### 8.7.1 Escenarios

| # | Escenario | Impacto | Procedimiento |
|---|---|---|---|
| 1 | Un proceso PM2 cae | Según el proceso (§8.7.2) | PM2 reinicia solo; verificar bucle |
| 2 | PostgreSQL cae | **ERP inoperante** | Levantar contenedor; verificar integridad; §8.5 si hay corrupción |
| 3 | Redis cae | Sin colas ni cache; sesiones perdidas | Levantar; los jobs en curso se reintentan |
| 4 | **OpenVPN cae** | **Sin acceso a ningún MikroTik** | Levantar; verificar túneles; **no tocar estados de ONU** |
| 5 | El servicio Python cae | Sin operaciones OLT | Levantar; **las OLTs se marcan OFFLINE y los estados se congelan** |
| 6 | GenieACS cae | Sin gestión de CPE | Módulo degradado; el resto opera |
| 7 | **Servidor de licencias inalcanzable** | **ERP bloqueado completo** | Verificar conectividad; revalidar |
| 8 | Disco lleno | Escrituras fallan | Purgar logs y respaldos antiguos |
| 9 | **Pérdida total del VPS** | Servicio caído | §8.7.3 |

### 8.7.2 Impacto por proceso

| Proceso caído | Qué deja de funcionar | Qué sigue funcionando |
|---|---|---|
| `api-core` | El ERP no responde | **Cobranza, outbox y watchers siguen** |
| **`worker-auxiliary`** | **Cortes, reactivaciones, outbox, watchers, notificaciones** | **El ERP responde con normalidad** ⚠️ |
| `whatsapp` | Bandeja de WhatsApp | Todo lo demás |
| `olt-automation-service` | Toda operación FTTH | El resto del ERP |
| `frontend` | Nadie entra | Las APIs y el plano automático |

### 8.7.3 Reconstrucción total

| # | Paso |
|---|---|
| 1 | Provisionar VPS y dependencias base |
| 2 | Clonar el repositorio en `/opt/datafast` |
| 3 | **Restaurar `.env.production`** (el correspondiente al dump) |
| 4 | **Restaurar certificados y CCD de OpenVPN** |
| 5 | Levantar PostgreSQL y Redis; restaurar el dump |
| 6 | Build y `pm2 start ecosystem.config.js` |
| 7 | Restaurar/regenerar certificados TLS |
| 8 | Reactivar la licencia (el `machine-id` **cambia**: puede requerir reactivación) |
| 9 | Verificación completa (§8.1.3) |
| 10 | **Reconciliación con la planta** (§8.5.2) |

### 8.7.4 RTO y RPO

| Métrica | Valor | Nota |
|---|---|---|
| **RPO** | Depende de la frecuencia de respaldo | **No hay política de frecuencia declarada** — pendiente |
| **RTO — proceso caído** | Minutos | PM2 reinicia automáticamente |
| **RTO — restore de base** | Horas | Incluye la reconciliación con la planta |
| **RTO — reconstrucción total** | Horas a un día | Depende de recuperar `.env` y los certificados VPN |

> **Punto crítico declarado:** si se pierden `.env.production` (por la `ENCRYPTION_KEY`) o los
> certificados de OpenVPN, el respaldo de la base **no basta** para recuperar la operación.

---

# 9. Referencias

CON-001 · POL-001 §8.6 · ARS-001 · DAT-001 §8.6 · SEC-001 · MAN-002 · ADR-010 · ADR-011 ·
`scripts/update.sh` · `scripts/backup.sh` · `ecosystem.config.js` · `PENDIENTES.md`

---

# 10. Anexos

## Anexo A — Endpoints de operación

| Endpoint | Uso |
|---|---|
| `GET /health`, `/health/live`, `/health/ready`, `/status` | Salud y versión |
| `GET /health/modules` | Módulos degradados con su razón |
| `GET /admin/sistema/watchers` | **Latido de los procesos de fondo** |
| `GET /admin/sistema/eventos` | Eventos de plataforma |
| `GET /admin/sistema/info` | Información del sistema |
| `POST /admin/sistema/update` · `GET /update-log` | Actualización y su log |
| `POST /admin/sistema/restart` | Reinicio |
| `GET/PATCH /admin/sistema/crontab` | Crontab del VPS |
| `GET /admin/workers/status`, `/jobs` | Colas |
| `POST /admin/workers/clean`, `/retry-failed` | Mantenimiento de colas |
| `GET /outbox-red/status` | **Estado del outbox de red** |
| `GET/POST/DELETE /admin/backup` | Respaldos |
| `GET /admin/licencia/info` · `POST /revalidar` | Licencia |

## Anexo B — Scripts del VPS

| Script | Función |
|---|---|
| `scripts/update.sh` | Actualización (root, `PM2_HOME=/root/.pm2`) |
| `scripts/backup.sh` | Respaldo |
| `scripts/deploy.sh` · `install.sh` | Despliegue e instalación |
| `scripts/ssl-setup.sh` | Certificados TLS |
| `scripts/openvpn-setup.sh` · `openvpn-client.sh` | Servidor y clientes VPN |
| `scripts/vpn-auth.sh` · `vpn-client-connect.sh` · `vpn-client-disconnect.sh` | Callbacks de OpenVPN |
| `scripts/check-preproduccion.sh` · `check-rutas-api.mjs` | Verificaciones |
| `check-health.mjs` · `check-vps.mjs` · `check-route.mjs` · `check-wa.mjs` (raíz) | Diagnóstico |

## Anexo C — Ventana de crons de madrugada

```
03:00  licencia.validacionDiaria + auditoria.purgar
03:30  ZTP reconciliarDiario        ← reescribe config de ONUs en drift
03:40  tr069.desendurecerAuthResidual
04:20  tr069.barrerTtl
04:40  mikrotik.address-list-reconciliador
```

**No programar mantenimiento entre las 02:30 y las 05:00.** Cinco barridos pesados en 100 minutos.

## Anexo D — Trampas operativas conocidas

| Trampa | Síntoma | Solución |
|---|---|---|
| Recargar por nombre suelto | «Backend recargado» sin efecto | Recargar **por ecosystem** |
| `--update-env` sobre un nombre suelto | El worker pierde `PORT: 4001` y choca con la API | Nunca; usar el ecosystem |
| Verificar solo el uptime | Un proceso en bucle también tiene uptime bajo | Comprobar el contador de reinicios |
| Instancia PM2 equivocada | Se ven procesos distintos | `PM2_HOME=/root/.pm2` |
| Build sin ampliar el heap | El build falla en el VPS | `NODE_OPTIONS='--max-old-space-size=2048'` |
| `eslint-disable-line` con regla específica | El build del frontend falla solo en el VPS | Usar la forma sin regla |
| Restaurar sin parar el worker | El worker escribe sobre la base restaurada | Parar los tres procesos Node |
| Restaurar con otra `ENCRYPTION_KEY` | Las credenciales de equipos no descifran | Restaurar el `.env` correspondiente |
| Reactivar el ZTP tras un restore sin comprobar drift | **Reescritura masiva de WiFi de clientes** | Ejecutar la consulta de PP-10 |
