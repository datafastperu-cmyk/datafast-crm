# Capítulo 20 — Problemas Detectados

> **Este capítulo NO propone soluciones.** Documenta observaciones del estado actual, cada una
> con la evidencia que la sostiene. Marcar algo aquí no implica que sea un defecto: varias
> observaciones corresponden a decisiones deliberadas y justificadas por escrito, y se señalan
> como tales para que el arquitecto que rediseñe no las revierta por desconocimiento.

## Leyenda de evidencia

| Marca | Significado |
|---|---|
| **[MEDIDO]** | Extraído mecánicamente del código |
| **[DOCUMENTADO]** | Registrado en `CLAUDE.md`, `PENDIENTES.md`, `docs/` o comentarios del código |
| **[DELIBERADO]** | Decisión de diseño consciente, con justificación escrita |

---

## A. Concentración de responsabilidades

### A1. `olt-nativo` concentra 8 dominios distintos en un módulo **[MEDIDO]**
25.659 LOC, 41 servicios, 24 entidades, 1 controlador de 1.845 líneas con ~150 endpoints, 5
archivos de cron con 11 tareas. Contiene simultáneamente: inventario de hardware, configuración
declarativa de OLT (baselines/perfiles/VLANs), tres pools de recursos, provisión FTTH, gestión
TR-069/ZTP, saga de wizard, locking e idempotencia, salud y firmware, y enrutamiento
multi-proveedor.

### A2. Un único controlador expone ~150 endpoints **[MEDIDO]**
`olt-nativo.controller.ts` — 1.845 líneas. Ningún otro controlador supera los 32 endpoints.

### A3. `provisioning.py` concentra 4.792 LOC **[MEDIDO]**
El archivo más grande del repositorio. Contiene toda la lógica de provisión, verificación VIO,
rollback, suspensión, rehabilitación y bootstrap TR-069 para todos los modelos de OLT.

### A4. `contratos` es el nodo de mayor acoplamiento saliente **[MEDIDO]**
Depende de 8 módulos (`auth`, `mikrotik`, `outbox-red`, `planes`, `promesas-pago`, `sagas`,
`smartolt`, `xui`). Modificar su contrato impacta aguas abajo en cadena.

### A5. `usuarios.controller.ts` declara 4 `@Controller` distintos en un archivo **[MEDIDO]**
`/usuarios`, `/roles`, `/permisos`, `/personal/logs`.

---

## B. Duplicación de lógica y de fuentes de verdad

### B1. La deuda de un contrato se calcula en 4 lugares **[MEDIDO]**
`fn_calcular_deuda_contrato` (PostgreSQL), `deuda-por-contrato.service.ts` (TypeScript),
`GET /pagos/cliente-deuda/:clienteId` (SQL propio) y `cobranza.worker.ts` (`detectar-morosos`).
No hay test que verifique que los cuatro coinciden.

### B2. El predicado "contrato activo" se reconstruye en ~6 sitios **[MEDIDO]**
`contratos.service`, `cobranza.worker`, `reportes.service`, `dashboard`, `v_contratos_completos`,
`portal-cliente.service`. Existe `estados-sql-validos.spec.ts`, lo que sugiere que la divergencia
ya causó un fallo.

### B3. Tres superficies calculan resúmenes agregados solapados **[MEDIDO]**
`GET /dashboard/stats` (6 queries), `GET /reportes/resumen`, `GET /clientes/resumen` +
`GET /contratos/resumen`, más las vistas `v_resumen_clientes` y `v_resumen_financiero`.

### B4. El estado de una ONU tiene dos caminos con criterios distintos **[DELIBERADO]**
`clasificarOnus` (SSH en vivo, distingue `online/apagada/ruptura_fibra/desactivada/offline`) y
la lectura de `olt_onu_inventario` en BD. La duplicación está **justificada por escrito** — una
consulta masiva no puede usar el camino de una lectura en vivo contra hardware. Lo que no existe
es un test que verifique que ambos criterios no divergen.

### B5. `MikroTik` se accede por tres caminos independientes **[MEDIDO]**
`node-routeros` desde NestJS, `ssh2` desde `firewall.service.ts`, y `mikrotik_pool.py` desde
Python. Tres pools de conexión distintos contra el mismo hardware.

### B6. Cinco procesos periódicos reconcilian estados solapados del mismo parque **[MEDIDO]**
`reconciliador` (15/30 min), `ztp-reconcile` (03:30 y cada 2 min), `ftth-wan-watcher` (10 min),
`address-list-reconciliador` (04:40), `olt-sync` (6 h). Además de cada `GET /:oltId/onus` del
operador. No hay coordinación entre ellos.

### B7. Los tipos se duplican entre backend y frontend **[MEDIDO]**
`backend/src/**/dto` y `frontend/src/types` no comparten paquete. No hay monorepo ni código
compartido.

---

## C. Acceso a datos

### C1. 445 llamadas a SQL crudo, concentradas en los módulos críticos **[MEDIDO]**
`olt-nativo` 43, `facturacion` 37, `workers` 31, `pagos` 28, `contratos` 25, `sistema` 24.

### C2. ~25 tablas no tienen entidad TypeORM **[MEDIDO]**
Incluyen piezas críticas: `comandos_red_pendientes` (outbox), `ftth_operacion_lock`,
`operacion_wizard`, `operacion_wizard_paso` (saga), `pago_extorno`, `cierre_caja`,
`cuentas_bancarias`, `consumo_snapshot`, `contratos_historial`, `ips_asignadas`. Un cambio de
esquema en ellas **no rompe la compilación**.

### C3. Tres reglas de negocio viven en triggers de PostgreSQL **[MEDIDO]**
`trg_factura_saldo` (saldo de factura), `trg_update_ips_usadas` (contador de IPs de un
segmento), `trg_pe_contadores_nap` (ocupación de NAP). Fuera del código de aplicación y fuera
del alcance de cualquier test de NestJS.

### C4. Asignación de IP y numeración de contratos/tickets se resuelven en la base **[MEDIDO]**
`fn_next_available_ip`, `fn_generar_numero_contrato`, `fn_generar_numero_ticket`,
`recalc_tipo_servicio_cliente`, `sn_onu_normalizado`.

### C5. No existe capa de repositorio **[MEDIDO]**
Los servicios inyectan `Repository<T>` y `DataSource` y ejecutan SQL directamente. No hay
abstracción de persistencia.

### C6. El logging SQL está desactivado **[MEDIDO]**
`logging: false` en la configuración de TypeORM. No hay traza de las consultas ejecutadas.

### C7. El aislamiento multi-tenant se aplica consulta por consulta **[MEDIDO]**
`empresa_id` está en los índices únicos, pero el filtrado depende de que cada servicio lo
incluya. No hay guard, interceptor ni `@Filter` global que lo garantice.

---

## D. Procesos síncronos que podrían no serlo (observación, sin propuesta)

### D1. Lectura de OLT en vivo en la ruta de request del operador **[MEDIDO]**
`GET /olt-nativo/:oltId/onus` abre SSH contra el MA5800 dentro de un request HTTP con timeout
global de 30 s.

### D2. Lecturas de MikroTik en vivo desde el frontend **[MEDIDO]**
`/routers/:id/trafico`, `/sesiones`, `/interfaces`, `/dhcp`, `/queues`, `/morosos` — todas
síncronas contra el hardware.

### D3. El portal del abonado dispara lecturas y escrituras TR-069 en vivo **[MEDIDO]**
`GET /portal/onu/:contratoId/estado`, `PUT /portal/onu/:contratoId/wifi/:banda`. Superficie
pública que alcanza el hardware. Mitigado con cache de 5 min y sesión con heartbeat.

### D4. Exportaciones XLSX se materializan en memoria **[MEDIDO]**
`GET /reportes/clientes/exportar`, `/cobranza/exportar`, `GET /clientes/exportar` — sin
streaming ni paginación.

### D5. `GET /clientes/mapa` devuelve todo el parque sin paginación **[MEDIDO]**
CTE `PUNTOS_SERVICIO` completo en cada carga del mapa.

---

## E. Procesos programados

### E1. 29 crons corren en el mismo proceso Node **[MEDIDO]**
Todos con `@nestjs/schedule` dentro de `datafast-worker-auxiliary`. Si ese proceso muere, se
detienen simultáneamente el outbox de red, la cobranza, todos los watchers FTTH, la
reconciliación y el monitoreo.

### E2. Cinco barridos pesados concentrados en 100 minutos de madrugada **[MEDIDO]**
03:00 (licencia + purga de auditoría), 03:30 (ZTP reconcile), 03:40 (des-endurecimiento auth),
04:20 (barrido TTL), 04:40 (address-lists).

### E3. `reconciliar()` itera sin cap ni lock **[DOCUMENTADO]**
`reconciliador.service.ts`, cada 15 minutos. Registrado como pendiente; el carril automático
multiplicó su carga potencial.

### E4. Cron de monitoreo cada minuto sobre todos los dispositivos **[MEDIDO]**
`monitoreo-worker.service.ts` — ping + escritura en `metricas_monitoreo`, la tabla de mayor tasa
de escritura del sistema. Sin política de retención visible más allá de `fn_cleanup_old_data`.

### E5. Cron XUI cada 30 segundos contra un servicio externo **[MEDIDO]**
El más frecuente del sistema.

### E6. La latencia mínima del outbox es de 5 minutos **[MEDIDO]**
`barridoProgramado` corre cada 5 min. Sin drenado inmediato, una suspensión o reactivación
espera hasta ese intervalo. Fue una de las dos causas de los 287 s de REACTIVAR.

### E7. `ScheduleModule.forRoot()` se registra en los tres procesos **[DELIBERADO]**
Necesario porque varios servicios que inyectan `SchedulerRegistry` se cargan también en
`api-core`. La protección real es `RUN_CRONS` comprobado dentro de cada servicio — es decir, la
seguridad depende de que **cada servicio nuevo se acuerde de comprobarla**.

---

## F. Dependencias y acoplamiento

### F1. Cuatro dependencias circulares de dominio **[MEDIDO]**
`mikrotik ↔ openvpn`, `facturacion ↔ pagos`, `contratos ↔ mikrotik`,
`notificaciones ↔ workers`. Más los ciclos indirectos `contratos → outbox-red → mikrotik →
contratos` y `contratos → mikrotik → openvpn → mikrotik`.

### F2. `workers` es dependencia de 5 módulos que no ejecutan workers **[MEDIDO]**
`notificaciones`, `google-integration`, `mantenimiento`, `mensajeria`, `pagos` importan
`workers.constants.ts` únicamente para leer nombres de colas y tipos de payload.

### F3. `mikrotik` tiene 8 consumidores **[MEDIDO]**
`contratos`, `monitoreo`, `openvpn`, `outbox-red`, `portal`, `promesas-pago`, `reconciliador`,
`sites`, `smartolt`, `workers`. Cualquier cambio de firma impacta a todos.

### F4. `LicenciaGuard` es el primer guard global **[DELIBERADO]**
Un fallo del servidor de licencias bloquea el ERP completo, incluido `auth`. Es el
comportamiento buscado, y también un punto único de fallo.

---

## G. Configuración y despliegue

### G1. Dos descripciones de despliegue coexisten **[MEDIDO]**
`docker-compose.yml` (stack completo) y `ecosystem.config.js` (PM2 sobre `/opt/datafast`).
Producción usa PM2; Docker cubre Postgres, Redis y Evolution. Un lector externo no puede
determinar cuál es la autoridad sin leer los comentarios.

### G2. Los límites de memoria de PM2 suman 3,17 GB sobre ~1,9 GB de RAM **[MEDIDO]**
`api-core` 1 G + `worker` 800 M + `whatsapp` 600 M + `frontend` 512 M + `olt-service` 256 M.
Son límites de reinicio, no reservas, pero no hay margen si varios se acercan a la vez.

### G3. Los tres procesos Node cargan el `AppModule` completo **[DELIBERADO]**
La diferenciación de rol es por variable de entorno, no por composición de módulos. Cada proceso
instancia todos los servicios de los 44 módulos aunque no vaya a usarlos.

### G4. 25 scripts `.mjs` en la raíz del repositorio **[MEDIDO]**
Varios con prefijo `_` (ad-hoc de sesión: `_mon.mjs`, `_monitor2.mjs`, `_monitor3.mjs`,
`_rstmon.mjs`, `_vio.mjs`, `_pe_runsql.mjs`, `_subir-nginx.mjs`). Existe un directorio
`scripts/` que no los contiene.

### G5. `helmet` activa CSP solo en producción **[MEDIDO]**
`contentSecurityPolicy: env === 'production'`.

### G6. `forbidNonWhitelisted: false` **[MEDIDO]**
Los campos extra en el payload se descartan silenciosamente en lugar de rechazar la petición.

### G7. `@RequirePermission` aplicado en 4 de 44 módulos **[MEDIDO]**
`contratos`, `planes`, `zonas`, `promesas-pago`. El resto depende solo de `RolesGuard`.

### G8. Las credenciales de GenieACS están duplicadas fuera del repositorio **[DOCUMENTADO]**
La provision `erp-connreq-creds` tiene credenciales hardcodeadas en GenieACS que deben coincidir
con el `.env` de cada VPS. Un acoplamiento que no vive en el código.

---

## H. Observabilidad y verificación

### H1. No existe APM, trazas ni métricas **[MEDIDO]**
Sin Prometheus, OpenTelemetry ni Grafana. La única observabilidad son los logs winston, los
endpoints de health/watchers/colas y los scripts `check-*.mjs` / `_monitor*.mjs`.

### H2. La frecuencia real de uso de los endpoints es desconocida **[MEDIDO]**
No hay instrumentación de request. Toda estimación de frecuencia en esta auditoría es inferencia
desde el consumidor frontend.

### H3. ~30 tests para ~96.000 LOC de backend **[MEDIDO]**
Los tests existentes son de alto valor (protegen invariantes de dinero, concurrencia e
idempotencia, y nombran el incidente que los motivó), pero la cobertura es muy baja en volumen.

### H4. La suite de facturación no compila **[DOCUMENTADO]**
Registrado como deuda en `PENDIENTES.md`.

### H5. El barrido SQL no está en CI **[DOCUMENTADO]**
`npm run sql:check` existe pero se ejecuta manualmente.

### H6. Solo 2 tests en todo el frontend **[MEDIDO]**
`como-llegar.test.ts`, `coordenadas.test.ts`.

---

## I. Riesgos de datos identificados

### I1. El reconcile de las 03:30 puede reescribir SSID y clave WiFi de ONUs en producción **[DOCUMENTADO]**
Una ONU con `contrato_onu_config.provisioning_enabled = true` y `last_applied_revision IS NULL`
queda marcada como drift y `ZtpReconcileCron.reconciliarDiario` le reescribe SSID, clave WiFi y
credenciales de acceso web con el preset de la OLT.

Hoy el sistema está a salvo **por construcción, no por precaución**: solo las ONUs que el ERP
aprovisionó tienen `contrato_onu_config`, y `adoptarOnusHuerfanas` no crea config. **Cualquier
migración masiva de ONUs rompería esa garantía** y el efecto sería sobre todo el parque a la vez,
de madrugada, sin que nadie lo pida.

### I2. `migracion/` está vacío **[MEDIDO]**
El plan de migración desde MikroWISP existe como documento; no hay código. Cuando se escriba,
I1 es la advertencia que lo condiciona.

### I3. `mock-data/` está presente en el árbol del frontend de producción **[MEDIDO]**

---

## J. Módulos incompletos o en pausa

| Módulo / trabajo | Estado **[DOCUMENTADO]** |
|---|---|
| Cobranza Etapa II (pasarelas adicionales) | **Pendiente a propósito.** Etapa I cerrada 06/08/2026. Las pasarelas esperan una puerta de 30 días cuyos criterios no dependen de código. |
| Planta Externa Fases 2 y 3 | En pausa — hay propuestas del usuario sobre diseño y ubicación del módulo. |
| Facturación electrónica / SUNAT | **No implementada.** Existe la página en el frontend; no hay cliente, ni OSE, ni firma XML, ni CDR. |
| Proveedor de SMS | **No existe** en el gateway de mensajería. |
| Campos de configuración del cliente sin cablear | `mora`, `reconexión`, `esquemaImpuesto`, `impuesto1`, `avisoPantalla` se guardan pero no producen ningún efecto. |
| ACS URL por OMCI | Objetivo abierto. Hoy solo converge Option 43, lo que ata el diseño a Huawei + un DHCP por VLAN. |
| Señal FTTH en el listado de ONUs | Pendiente: `rx_power_dbm` del inventario y `metricas_onu_optical` están vacías. Ya funciona en el modal. |
| Tab ONU/Router del cliente | Pendiente de eliminar tras validar el modal rediseñado. |
| Secciones del modal de ONU | Aún maquetadas, sin datos. |
| Telegram (`telegraf`) | Dependencia instalada, sin integración. |
| Twilio | Dependencia instalada, sin proveedor registrado. |
| `net-snmp` en Node | Dependencia declarada; el SNMP real está en Python. |
| Cola `mikrotik-jobs` | Declarada en `QUEUES`; el trabajo real va por el outbox. |
| `watchtower` | Comentado en `docker-compose.yml`. |

---

## K. Decisiones deliberadas que NO deben confundirse con defectos

Se listan explícitamente porque un rediseño que las revierta reintroduciría incidentes ya
resueltos.

| Decisión | Razón **[DELIBERADO]** |
|---|---|
| `olt-automation-service` con **1 worker uvicorn** | El MA5800 tiene un límite bajo de sesiones VTY concurrentes. Cada worker abriría sus propias sesiones SSH. |
| `--reload` prohibido en uvicorn de producción | WatchFiles reiniciaba el servicio al tocar cualquier archivo; un `git reset --hard` de deploy lo disparó en medio de una Fase 2 WAN → ONT huérfano (2026-07-21). |
| Chromium aislado en `datafast-whatsapp` | Alojado antes en el worker, dejó el VPS con 87 MB libres y el outbox en riesgo de ser matado por memoria. |
| Solo `api-core` ejecuta migraciones | Ambos procesos migraban a la vez y competían (`duplicate key ... pg_type_typname_nsp_index`, 2026-07-21). |
| Frontend con entorno PM2 mínimo | Hasta 2026-07-22 arrastraba todos los secretos del backend por haberse lanzado desde una shell con su `.env`. |
| El clic de "Finalizar" NO es la frontera transaccional | Es inalcanzable en crash/corte de sesión —los casos que motivan la regla— y convertiría la regla en fábrica de cortes de servicio. |
| El lock FTTH se toma **por paso**, no por sesión de wizard | Tomarlo por toda la sesión bloquearía el contrato a los watchers. |
| El heartbeat **suprime** el barrido, nunca lo autoriza, y tiene techo absoluto | Sin techo, una pestaña olvidada bloquearía el recurso para siempre. |
| Lista de rechazos definitivos = solo 400 y 404 | `status < 500` es incorrecto: 409/408/429 significan "vuelve luego". Un 409 de lock leído como veredicto descartó trabajo. |
| `indeterminado` obligatorio ante timeout de hardware | Un timeout no significa "no pasó nada": la operación pudo aplicarse y tardar más que el límite del cliente. |
| Timeouts largos en OLT (WAN 90 s, rollback 150 s) | Los valores de 30 s causaron el ONT huérfano del 21/07 16:55. |
| Las IPs VPN son permanentes | Reutilizar una IP asignada a un cert activo rompe la atribución de clientes. |
| El `iroute` declara propiedad, no alcanzabilidad | Ampliarlo para "llegar" a la red de otro router hace que dos routers reclamen la misma red — y eso no falla ruidosamente, responde mal con naturalidad. |
| Un script VPN por wizard, nunca regenerable | La edición solo permite visualizar el original. |
| Cola `campanas` separada de `notificaciones` | Para que un envío masivo no bloquee las alertas críticas (prioridad 1). |
| El Core Indestructible NO usa el patrón degradado | Si `auth`, `pagos` o `facturacion` fallan en init, el backend **debe** crashear para proteger el servidor anterior en PM2. |
| Vhost del portal con API acotada por regex | Desde `PORTAL_DOMAIN` no es alcanzable el resto de la API. |
| `WEB_DOMAIN` cae en `web.invalid` si no se define | nginx no admite plantillas condicionales; un vhost que nadie resuelve es inofensivo. |
| `ERP_DOMAIN` cae en `APP_DOMAIN` | Renombrar la variable sin periodo de gracia rompería toda instalación existente en su próxima actualización. |

---

## Verificación final de la Etapa I

Comprobación de que este documento permite responder, sin abrir el código fuente:

| Pregunta | Dónde se responde |
|---|---|
| ¿Cómo está construido el ERP? | Cap. 1 (stack, procesos, diagrama), Cap. 3 (estructura), Cap. 16 (infraestructura) |
| ¿Cómo se comunican todos los módulos? | Cap. 4 (grafo + ciclos), Cap. 11 (eventos), Cap. 18.7 (diagrama de comunicación con medio y sincronía por arista) |
| ¿Qué componente es responsable de cada dominio? | Cap. 2 (ficha por módulo), Cap. 6.3 (tabla → módulo propietario) |
| ¿Qué módulos acceden directamente a la base de datos? | Cap. 7.1 (densidad de SQL crudo por módulo), Cap. 6.5 (tablas sin entidad) |
| ¿Qué módulos consultan equipos físicos? | Cap. 8 (por equipo y transporte), Cap. 15.1 (restricción física dominante) |
| ¿Qué información se consulta repetidamente? | Cap. 7.2 (duplicaciones), Cap. 14.4 (lo no cacheado), Cap. 15.5 (trabajo repetido), Cap. 20.B |
| ¿Qué servicios son compartidos? | Cap. 9 (globales, transversales, de dominio) |
| ¿Qué procesos son síncronos y cuáles asíncronos? | Cap. 10 (crons, colas, outbox), Cap. 11.5 (los tres mecanismos asíncronos reales), Cap. 18.7 (tabla por arista), Cap. 20.D |
| ¿Cuál es el flujo completo de los datos? | Cap. 17 (5 flujos completos de extremo a extremo) |
| ¿Qué impacto tendría modificar un módulo específico? | Cap. 4.4 (grados de entrada/salida por módulo) + Cap. 20.F |

### Preguntas que este documento NO puede responder

Se declaran explícitamente para que no se asuma cobertura donde no la hay:

1. **Frecuencia real de invocación de cada endpoint** — el sistema no está instrumentado. Todas las frecuencias son inferencias.
2. **Latencia real p50/p95/p99 de cualquier operación** — no hay APM. Los números del Cap. 15 son mediciones puntuales de incidentes, no distribuciones.
3. **Volumen real de filas por tabla** — requiere acceso a la base de producción.
4. **Índices efectivamente usados vs. índices creados** — requiere `pg_stat_user_indexes` en producción. Se sabe que hay 376 sentencias `CREATE INDEX`; no cuáles se usan.
5. **Comportamiento bajo carga concurrente** — no hay pruebas de carga en el repositorio.
