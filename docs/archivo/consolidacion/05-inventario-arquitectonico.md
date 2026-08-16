# Capítulo 12 — Inventario Arquitectónico

> Inventario de activos arquitectónicos del ERP Datafast en el commit `f8d52b00`.
> Todos los conteos son extracción mecánica sobre el árbol de código.

---

## 12.1 Resumen cuantitativo

| Activo | Cantidad |
|---|---|
| Módulos NestJS | 44 (+1 vacío: `migracion`) |
| Controladores | 46 |
| Endpoints HTTP | ~560 |
| Servicios (`*.service.ts`) | ~160 |
| **Repositorios** | **6** (1.614 LOC) |
| **Puertos (interfaces de adaptador)** | **4** |
| **Adaptadores** | **5** en TS + 3 drivers Python |
| **Máquinas de estados declarativas** | **2** |
| Entidades TypeORM | 81 |
| Tablas en base de datos | ~120 (**39 sin entidad**) |
| Migraciones | 215 |
| Índices | 376 |
| Triggers / Funciones / Vistas | 27 / 13 / 4 |
| Cron jobs | 29 |
| Colas Bull | 6 |
| Processors | 6 |
| Listeners de eventos | 25 |
| Eventos de dominio catalogados | 23 |
| WebSocket gateways | 3 |
| Guards globales | 4 |
| Interceptors globales | 5 |
| Integraciones externas activas | 15 |
| Páginas frontend | 92 |
| LOC backend (`modules/`) | ~96.000 |
| LOC frontend (`components/`+`app/`) | 57.435 |
| LOC Python (`services/`) | 5.520 |
| Tests backend | ~30 |
| Tests frontend | 2 |

---

## 12.2 Módulos por dominio y criticidad

| Dominio | Módulos | LOC | Criticidad |
|---|---|---|---|
| **RED / OSS** | olt-nativo, mikrotik, openvpn, outbox-red, monitoreo, planta-externa, smartolt, tr069, reconciliador, sites | 47.199 | Máxima |
| **FINANCIERO** | facturacion, pagos, promesas-pago, finanzas-opex, proyectos-inversion | 13.425 | Máxima |
| **COMERCIAL** | clientes, contratos, planes, zonas | 7.005 | Máxima |
| **CLIENTE FINAL** | portal, tickets, xui | 6.687 | Alta |
| **COMUNICACIÓN** | notificaciones, mensajeria, crm-nativo, plantillas, webhooks | 5.714 | Alta |
| **PLATAFORMA** | auth, usuarios, licencia, auditoria, sistema, backup, health, install, workers, sagas, mantenimiento, schema-guard, config, dashboard, reportes, aprovisionamiento, google-integration | 13.746 | Máxima/Alta |

---

## 12.3 Inventario de servicios por función arquitectónica

### 12.3.1 Servicios de dominio (deciden reglas de negocio)

| Servicio | Módulo | Regla que encapsula |
|---|---|---|
| `politica-facturacion.service.ts` | facturacion | Fórmula única del ciclo de cobro |
| `deuda-por-contrato.service.ts` | facturacion | Cálculo de deuda (uno de 4 caminos) |
| `aplicador-factura.service.ts` | facturacion | Único escritor del saldo |
| `ftth-maquina-estados.ts` | olt-nativo/domain | Transiciones legales FTTH |
| `planta-externa-maquina-estados.ts` | planta-externa/domain | Transiciones de planta |
| `presupuesto-optico.ts` | planta-externa/domain | Cálculo de presupuesto óptico |
| `resultado-operacion.ts` | common/domain | Clasificación de resultados |
| `olt-compliance-rules.ts` | olt-nativo/compliance | Reglas de cumplimiento de OLT |
| `capability.engine.ts` | olt-nativo/capability | Filtrado de config por capacidad de dispositivo |

### 12.3.2 Servicios de orquestación

`provision-ftth.service.ts` · `operacion-wizard.service.ts` · `compensador-wizard.service.ts` ·
`olt-operation-router.service.ts` · `velocidad-orquestador.service.ts` ·
`outbox-red.service.ts` · `gateway-mensajeria.service.ts` · `ztp.service.ts` ·
`olt-baseline-plan.service.ts` · `arqueo-caja.service.ts`

### 12.3.3 Servicios de infraestructura / acceso

`connection-pool.service.ts` (MikroTik) · `olt-conn.service.ts` · `olt-automation.client.ts` ·
`genieacs.driver.ts` · `mercadopago.service.ts` · `reniec.service.ts` · `smtp.strategy.ts` ·
`whatsapp.service.ts` · `pdf.service.ts` · `backup.service.ts`

### 12.3.4 Servicios de coordinación y resiliencia

| Servicio | Función |
|---|---|
| `ftth-operacion-lock.service.ts` | Lock por contrato/operación, TTL corto, 409 |
| `olt-atomic-lock.service.ts` | Lock atómico de OLT |
| `olt-idempotency.service.ts` | Idempotencia de operaciones |
| `circuit-breaker.service.ts` + `circuit-breaker.registry.ts` | Breakers por equipo/proveedor |
| `redis-lock.service.ts` | Lock distribuido |
| `module-health.service.ts` | Estado degradado por módulo |
| `watcher-heartbeat.service.ts` | Latido de procesos de fondo |
| `queue-pause.service.ts` | Pausa coordinada de colas |
| `operacion-wizard-paso.service.ts` | Bitácora write-ahead de compensación |

### 12.3.5 Servicios de pools de recursos

`olt-service-port-pool.service.ts` · `olt-mgmt-ip-pool.service.ts` ·
`olt-onu-id-pool.service.ts` · (mgmt-port-pool vía controlador) · pools IPv4 en
`contratos/repositories` · puertos NAP en `planta-externa`

---

## 12.4 Inventario de puertos y adaptadores

| Puerto | Ubicación | Adaptadores | Estado |
|---|---|---|---|
| `IOltProvider` | `olt-nativo/interfaces/olt-provider.interface.ts` | `nativo-ssh` · `smartolt` · `adminolt` | **Activo, 3 implementaciones** |
| Adaptador de cobro | `pagos/adaptadores/adaptador-cobro.interface.ts` | **Ninguno — deliberado** | Contrato fijado, implementación bloqueada por puerta de estabilidad |
| Provisionamiento | `aprovisionamiento/interfaces/provisionamiento-provider.interface.ts` | `mock-provisionamiento` | Esqueleto |
| Driver ACS | `olt-nativo/ztp/` | `genieacs.driver.ts` + registry + resolver | Activo, driver único |
| Drivers OLT (Python) | `olt-automation-service/app/drivers/` | `huawei` · `vsol` (sobre `base`) | Activo |
| Estrategias de mensajería | `notificaciones/services/*.strategy.ts` | `datafast-native` · `datafast-mensajeria-masiva` · `smtp` | Activo |
| Estrategias de queue | `mikrotik/services/velocidad/` | simple_queue · queue_tree · pcq · sin_limite | Activo |

---

## 12.5 Inventario de entidades por dominio

| Dominio | Entidades |
|---|---|
| **Comercial** | `cliente` · `cliente-historial-estado` · `contrato` · `red (segmentos_ipv4)` · `plan` · `zona` · `site` |
| **Financiero** | `factura` · `cargo-pendiente` · `comprobante-config` · `configuracion-facturacion` · `pago` · `pago-aplicacion` · `canal-pago` · `promesa-pago` · `egreso-ingreso` · `proyecto-inversion` |
| **Red — OLT/FTTH** (24) | `olt-dispositivo` · `olt-board` · `olt-vlan` · `olt-line-profile` · `olt-service-profile` · `olt-traffic-table` · `olt-baseline` · `olt-alerta` · `olt-health-snapshot` · `olt-sync-job` · `olt-operacion-log` · `olt-proveedor-config` · `olt-onu-inventario` · `olt-onu-preset` · `olt-service-port-pool` · `olt-mgmt-ip-pool` · `olt-onu-id-pool` · `ftth-onu-registro` · `ftth-rollback-log` · `contrato-onu-config` · `cpe-provisioning-attempt` · `cpe-web-credential` · `metricas-onu-optical` · `historial-firmware` |
| **Red — MikroTik/VPN** | `router` · `openvpn-config` · `vpn-cliente` · `vpn-alerta` |
| **Red — Planta externa** (9) | `pe-mufa` · `pe-fusion` · `pe-splitter` · `pe-splitter-salida` · `pe-nap` · `pe-nap-puerto` · `pe-fibra-segmento` · `pe-fibra-hilo` · `pe-acometida` |
| **Monitoreo** | `dispositivo-monitoreo` · `metricas-monitoreo` · `alerta-sistema` · `umbral-alerta` |
| **Comunicación** | `notificacion-log` · `plantilla-mensaje` · `plantilla-abonado` · `crm-chat` · `crm-mensaje` |
| **Cliente final** | `portal-config` · `portal-banner` · `ticket` · `xui-servidor` · `xui-line` |
| **Plataforma** | `usuario` · `rol` · `permiso` · `auditoria-log` · `entity-version` · `empresa` · `licencia-estado` · `backup` · `saga-log` · `google-account` · `google-sync-log` · `tr069-device` |
| **SmartOLT (legado)** | `onu` (→ tabla `olts`) |

### Tablas críticas SIN entidad (39 en total; las de mayor riesgo)

`comandos_red_pendientes` · `ftth_operacion_lock` · `operacion_wizard` ·
`operacion_wizard_paso` · `pago_extorno` · `cierre_caja` · `cuentas_bancarias` ·
`bancos_isp` · `formas_pago_isp` · `consumo_datos` · `consumo_snapshot` ·
`contratos_historial` · `ips_asignadas` · `drift_detectado` · `reconciliation_log` ·
`nodos` · `nodos_mediciones` · `ordenes_trabajo` · `tickets_comentarios` ·
`portal_solicitud_plan` · `google_client_contacts` · `eventos_sistema` ·
`notificaciones` · `usuarios_roles`

---

## 12.6 Inventario de APIs

| Superficie | Controladores | Endpoints | Autenticación |
|---|---|---|---|
| **API del ERP** (`/api/v1/*`) | 43 | ~520 | JWT operador + licencia + rol |
| **API del Portal** (`/api/v1/portal/*`) | 2 | 28 | JWT propio del portal (cookies) |
| **Webhooks entrantes** | 3 | 4 | Firma / token del proveedor |
| **Callbacks de OpenVPN** | 1 | 5 | Token / CN |
| **Health** | 1 | 5 | Público |
| **API interna Python** (`:8001`) | — | ~40 | API key, solo `127.0.0.1` |

### Top de superficie por controlador

| Controlador | Endpoints |
|---|---|
| `olt-nativo.controller.ts` | ~150 |
| `pagos.controller.ts` | 32 |
| `openvpn` (2 controladores) | 30 |
| `facturacion` + `comprobantes-config` | 30 |
| `mikrotik.controller.ts` | 28 |
| `contratos.controller.ts` | 25 |
| `portal.controller.ts` | 20 |

---

## 12.7 Inventario de eventos

### Eventos de notificación (15)

`FACTURA_EMITIDA` · `PAGO_RECIBIDO` · `SERVICIO_SUSPENDIDO` · `SERVICIO_REACTIVADO` ·
`BIENVENIDA` · `PAGO_VENCE_HOY` · `PAGO_VENCIDO` · `PRORROGA_CONCEDIDA` · `ALERTA_EGRESO` ·
`EMISOR_CAIDO` · `EMISOR_CONECTADO` · `ROUTER_CAIDO` · `ROUTER_CONECTADO` · `FTTH_ACTIVADO` ·
`IPTV_LINE_CREADA` · `OUTBOX_RED_AGOTADO`

### Eventos de dominio (5)

`cliente.created` · `instalacion.completed` · `pago.registered` · `visita.scheduled` ·
`contrato.suspended` · `ftth.inventario.reobservar` · `GATEWAY_EVENTS.PROVIDER_ACTIVATED`

### Eventos de WebSocket (3)

`OLT_SYNC_PROGRESS` · `OLT_SYNC_COMPLETED` · `OLT_SYNC_ERROR`

**Nota arquitectónica:** el bus es **in-process**; los listeners encolan en Bull para cruzar
procesos. No hay catálogo versionado ni contrato de payload.

---

## 12.8 Inventario de procesos automáticos

### Cron jobs (29) por frecuencia

| Frecuencia | Tareas |
|---|---|
| **30 s** | `xui-monitor.tick` |
| **1 min** | `promesas.procesarVencidas` · `monitoreo.runCycle` |
| **2–5 min** | `ztp.watchPendingReinjection` · `ftth.procesarAnulaciones` · `ftth.liberarBloqueados` · `outbox.barridoProgramado` · `outbox.barrerClaimsExpirados` · `promesas.reintentarPendientes` |
| **10–15 min** | `ftth.reintentarRollbacks` · `ftth.verificarWan` · `notif-orphan-cleanup` · `pagos.reconciliarPagosNoAplicados` · `portal.recolectar` · `notif-reconciler` · `reconciliador.reconciliar` |
| **20–30 min** | `tr069.verificarDrift` · `tr069.verificarStaleness` · `ftth.limpiarIdsHuerfanos` · `reconciliador.reconciliarFtthOnu` · `ftth.adoptarHuerfanas` · `openvpn.limpiarWizardsAbandonados` |
| **6 h** | `licencia.recargaPeriodica` · `olt.syncPeriodico` |
| **Diaria (madrugada)** | 03:00 `licencia.validacionDiaria` + `auditoria.purgar` · 03:30 `ztp.reconciliarDiario` · 03:40 `tr069.desendurecerAuthResidual` · 04:20 `tr069.barrerTtl` · 04:40 `mikrotik.reconciliarDiario` |

### Colas Bull (6) y sus jobs

| Cola | Jobs | Concurrencia |
|---|---|---|
| `cobranza` | detectar-morosos · suspender-contrato · reactivar-contrato · evaluar-prorroga · vencer-prorroga · procesar-pago | por defecto |
| `facturacion` | marcar-vencidas · generar-mensual · generar-facturas-empresa · generar-factura-contrato | por defecto |
| `notificaciones` | notif-envio (+ tipos de aviso) | **5** |
| `campanas` | campana-masiva | **1** (goteo 12 s + jitter) |
| `google-sync` | sync-contact · contacts-bulk · calendar-event · drive-backup · geocode-address | por defecto |
| `mikrotik-velocidad` | sincronizar-router · cambiar-velocidad | por defecto |
| `mikrotik-jobs` | mk-suspender · mk-reactivar · mk-sync-velocidades | **declarada, no usada** (el trabajo va por outbox) |

### Watchers de invariante (los que reparan el sistema)

| Watcher | Invariante que sostiene |
|---|---|
| `reintentarRollbacksFallidos` | Nunca borrar `ftth_onu_registro` con la OLT sucia |
| `adoptarOnusHuerfanas` | Nunca un `ont` en la OLT sin registro en el ERP |
| `procesarAnulaciones` | Un wizard no confirmado se anula por completo |
| `liberarBloqueados` | Ningún lock FTTH queda colgado |
| `barrerClaimsExpirados` | Ningún comando de red queda en `EN_PROCESO` huérfano |
| `limpiarWizardsAbandonados` | Ningún cert VPN queda reservando IP |
| `limpiarIdsHuerfanos` | El pool de ONU-ID refleja la OLT |
| `reconciliarPagosNoAplicados` | Ningún pago queda sin aplicar |
| `limpiarHuerfanosEnProceso` | Ninguna notificación queda en `EN_PROCESO` |

---

## 12.9 Inventario de integraciones

| Integración | Acoplamiento | Degradable | Puerto/abstracción |
|---|---|---|---|
| GenieACS | Medio | Sí | `ztp/genieacs.driver.ts` |
| MikroTik RouterOS | **Alto** (3 caminos) | Parcial | **Ninguna común** |
| OLT Huawei/V-SOL | Bajo | Sí | `IOltProvider` + drivers Python |
| SmartOLT / AdminOLT | Bajo | Sí | `IOltProvider` |
| OpenVPN | **Alto** | **No** | Ninguna |
| Mercado Pago | **Alto** | Sí | **Existe puerto, no lo usa** |
| RENIEC | Bajo | Sí | Servicio dedicado + cache |
| Google Workspace ×4 | Bajo | Sí | Cola `google-sync` |
| Evolution API | Medio | Sí | Strategy |
| WhatsApp Web | Alto | Sí | Proceso PM2 aislado |
| SMTP | Bajo | Sí | Strategy |
| XUI.ONE | Bajo | Sí | Servicio degradable |
| Servidor de licencias | **Máximo** | **No, por diseño** | Guard global |
| Certbot / Let's Encrypt | Bajo | — | — |
| OpenStreetMap | Bajo | — | Frontend |

---

## 12.10 Inventario de componentes reutilizables

### Backend — `common/`

| Categoría | Componentes |
|---|---|
| **Dominio** | `resultado-operacion.ts` |
| **Resiliencia** | `module-health.service` · `circuit-breaker.registry` · `watcher-heartbeat.service` · `redis-lock.service` · `queue-pause.service` · `degradable.interface` |
| **Aspectos** | 2 guards + 4 interceptors + 1 filtro + 3 decoradores |
| **Utilidades** | `encryption` · `ip` · `pagination` · `pg-result` · `telefono` |
| **Observabilidad** | `errores-proceso.ts` |
| **Base** | `base.entity` · `response.dto` · `service-types` |

### Backend — reutilizables de dominio no ubicados en `common/`

`capability.engine.ts` (motor genérico, explícitamente diseñado para otros dominios) ·
`PoliticaFacturacionService` · `AplicadorFacturaService` · CTE `PUNTOS_SERVICIO` ·
`FtthOperacionLockService` · `OltProviderRegistry` + `OltOperationRouter`

### Frontend

| Categoría | LOC |
|---|---|
| `ui/` (8 archivos) | 544 |
| `shared/` (5) | 201 |
| `atoms/` (4) | 271 |
| `organisms/` (1) | 311 |
| `molecules/` (0) | 0 |
| **Total reutilizable** | **1.327 (2,3 %)** |
| Hooks | 5 |
| Stores | 4 |
| Clientes API | 27 |

---

## 12.11 Inventario de tests (protección de invariantes)

| Test | Invariante protegido |
|---|---|
| `frontera-dinero.spec.ts` | Un solo escritor del saldo |
| `extorno.spec.ts` | El extorno es la única reversión |
| `politica-facturacion.service.spec.ts` | Fórmula única del ciclo de cobro |
| `deuda-por-contrato.service.spec.ts` | Cálculo de deuda |
| `pagos.reconciliacion.spec.ts` | Pagos no aplicados |
| `estados-sql-validos.spec.ts` | Los estados usados en SQL existen |
| `outbox-red.claim.spec.ts` | Dos instancias PM2 no toman el mismo comando |
| `resultado-operacion.spec.ts` | Clasificación de resultado y traducción HTTP |
| `contrato-adaptador.spec.ts` | No inferir reintentabilidad de un código HTTP |
| `ftth-maquina-estados.spec.ts` | Transiciones legales e idempotencia derivada |
| `planta-externa-maquina-estados.spec.ts` | Ídem en planta externa |
| `olt-ownership-guard.spec.ts` | Propiedad de recursos OLT |
| `olt-perfiles-idempotencia.spec.ts` | Perfiles idempotentes |
| `provision-ftth.autoconfig.spec.ts` · `.barrido-carril.spec.ts` | Auto-config y barrido del carril |
| `tr069-staleness.service.spec.ts` | Sesiones ACS rancias |
| `router-zombi.spec.ts` | La baja de router limpia el cliente VPN |
| `subnet-route.remove.spec.ts` | Retiro de ruta |
| `portal-auth.aislamiento.spec.ts` | Un token de portal no accede a otro tenant |
| `portal-cookies.spec.ts` | Manejo de cookies del portal |
| `descripcion-consolidada.spec.ts` | Descripción del `ont` en la OLT |
| `presupuesto-optico.spec.ts` | Cálculo óptico |
| `olt-capability-catalog.spec.ts` · `olt-model-catalog.spec.ts` | Catálogos de capacidad |
| `olt-compliance-rules.spec.ts` | Reglas de compliance |
| `capability.engine.spec.ts` (×2) | Motor de capacidades |
| `genieacs.driver.spec.ts` · `registry.spec.ts` · `resolver.spec.ts` | Subsistema ZTP |
| `cwmp-auth.service.spec.ts` | Autenticación CWMP |
| `ztp.service.reconcile.spec.ts` | Reconcile ZTP |
| `contrato-onu-config.service.spec.ts` | Config de ONU por contrato |

**Lectura:** la cobertura es baja en volumen pero **quirúrgica en criterio** — cada test protege
un invariante que ya falló en producción. Es el inventario de las cicatrices del sistema.

---

## 12.12 Inventario de deuda declarada (trabajo abierto conocido)

| Elemento | Estado |
|---|---|
| Cobranza Etapa II (pasarelas) | **Pendiente a propósito** — puerta de estabilidad de 30 días |
| Planta Externa Fases 2–3 | En pausa por decisión de diseño |
| SUNAT / Facturación electrónica | No implementado (solo página) |
| Inventario / almacén | No implementado como módulo |
| Proveedor de SMS | No existe |
| ACS URL por OMCI | Objetivo abierto; hoy solo converge Option 43 |
| Señal FTTH en el listado | `rx_power_dbm` y `metricas_onu_optical` vacías |
| Tab ONU/Router del cliente | Pendiente de eliminar tras validar el modal |
| Suite de facturación | **No compila** |
| `sql:check` en CI | No integrado |
| Revisión del reconciliador nocturno | Pendiente registrado |
| Campos de config de cliente sin cablear | `mora`, `reconexión`, `esquemaImpuesto`, `impuesto1`, `avisoPantalla` |
| `migracion/` | Directorio vacío |
| Migración MikroWISP | No iniciada; requiere diseño previo |
| Dependencias sin uso | `telegraf`, `twilio`, `net-snmp` |
| Cola `mikrotik-jobs` | Declarada, no usada |
| `molecules/` | Directorio vacío |
| `mock-data/` | En el árbol de producción |
