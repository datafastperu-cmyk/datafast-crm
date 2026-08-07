# MOD-000 — Catálogo de Módulos y Plantilla de Especificación

---

## 2. Control documental

| Campo | Valor |
|---|---|
| **Código** | MOD-000 · **Versión** 1.0 · **Estado** Vigente |
| **Autor** | Arquitectura · **Revisores** Pendientes de asignar |
| **Fecha** | 2026-08-06 · **Documento superior** AEM-001, ARS-001 |

## 3. Historial de cambios

| Versión | Fecha | Cambio | Motivo |
|---|---|---|---|
| 1.0 | 2026-08-06 | Emisión inicial con catálogo de 44 módulos y 3 especificaciones completas | Ningún módulo estaba documentado funcional ni técnicamente |

## 4. Índice

1. Alcance de la documentación de módulos · 2. Plantilla MOD-XXX · 3. Catálogo de los 44 módulos ·
4. Orden de documentación

## 5. Objetivo

Establecer la plantilla de especificación de módulo, catalogar los 44 módulos existentes con su
ficha resumida y declarar el orden en que se documentarán en detalle.

## 6. Alcance

### 6.1 Declaración explícita de lo que se entrega

**Se entregan 3 especificaciones completas de 44 módulos:**

| Código | Módulo | Motivo de la selección |
|---|---|---|
| MOD-001 | `contratos` | Agregado raíz del sistema; 8 dependencias salientes |
| MOD-002 | `pagos` | Frontera del dinero; invariantes verificados por test |
| MOD-003 | `olt-nativo` | 25.659 LOC; el módulo de mayor complejidad y criticidad |

**Por qué no los 44 de golpe:** documentar 44 módulos en una sola emisión produciría
documentación que **nadie ha verificado** y que envejece antes de leerse. La política de este
cuerpo documental es que **un módulo se especifica cuando se toca** (POL-001 §PD-10, y §8.4 de
este documento).

Los 41 restantes tienen su **ficha resumida** en §8.3, suficiente para saber qué hace cada uno,
de qué depende y qué criticidad tiene.

## 7. Definiciones y glosario

Ver DOM-001 §8.1.

---

# 8. Contenido

## 8.1 Alcance de la documentación de módulos

Un documento MOD-XXX responde: qué hace el módulo, quién lo usa, qué reglas aplica, qué expone,
qué datos posee, qué eventos emite, con qué se integra y cómo se prueba.

**No documenta** implementación línea a línea: eso es el código.

## 8.2 Plantilla MOD-XXX

```markdown
# MOD-XXX — Módulo <nombre>

## 2. Control documental
Código · Versión · Estado · Autor · Revisores · Fecha

## 3. Historial de cambios

## 4. Índice

## 5. Objetivo
Para qué existe el módulo, en una frase.

## 6. Alcance
Qué cubre y qué NO cubre. Qué capacidades de negocio realiza (AEM-001).

## 7. Definiciones y glosario
Solo los términos propios del módulo.

## 8. Contenido

### 8.1 Objetivo
### 8.2 Alcance funcional
### 8.3 Actores
   Quién lo usa: operador, abonado, cron, otro módulo, sistema externo.
### 8.4 Casos de uso
   Tabla: caso · actor · precondición · flujo · postcondición.
### 8.5 Reglas de negocio
   Tabla: regla · mecanismo de garantía · verificado por.
### 8.6 APIs
   Tabla: método · ruta · permiso · qué devuelve · consumidor.
### 8.7 Modelo de datos
   Tablas propias, relaciones, invariantes, quién más las lee.
### 8.8 Eventos
   Emitidos y escuchados.
### 8.9 Integraciones
   Con qué habla, por qué transporte, con qué resiliencia.
### 8.10 Pruebas
   Qué invariantes están cubiertos y cuáles no.

## 9. Referencias
## 10. Anexos
```

## 8.3 Catálogo de los 44 módulos

### Dominio Comercial

| Módulo | Objetivo | Depende de | Tablas propias | LOC | Criticidad | MOD |
|---|---|---|---|---|---|---|
| `clientes` | Maestro de abonados, onboarding, RENIEC, mapa | auth, contratos, notificaciones | `clientes`, `clientes_historial_estados` | 2.705 | Máxima | Pendiente |
| **`contratos`** | Contrato de servicio y pools IPv4 | auth, mikrotik, outbox-red, planes, promesas-pago, sagas, smartolt, xui | `contratos`, `segmentos_ipv4`, `contratos_historial`, `ips_asignadas` | 3.894 | Máxima | **MOD-001** |
| `planes` | Catálogo de planes | — | `planes` | 287 | Máxima | Pendiente |
| `zonas` | Agrupación comercial | — | `zonas` | 119 | Media | Pendiente |
| `sites` | Nodos y emplazamientos | mikrotik, olt-nativo, openvpn | `sites` | 316 | Media | Pendiente |

### Dominio Financiero

| Módulo | Objetivo | Depende de | Tablas propias | LOC | Criticidad | MOD |
|---|---|---|---|---|---|---|
| `facturacion` | Emisión, ciclo de cobro, PDF | auth, config, pagos | `facturas`, `cargos_pendientes`, `comprobantes_config`, `configuracion_facturacion`, `bancos_isp`, `formas_pago_isp` | 5.477 | Máxima | Pendiente |
| **`pagos`** | Registro del dinero, caja, arqueo, extorno | auth, contratos, facturacion, workers | `pagos`, `pago_aplicaciones`, `pago_extorno`, `canal_pago`, `cuentas_bancarias`, `cierre_caja` | 5.836 | Máxima | **MOD-002** |
| `promesas-pago` | Prórrogas | mikrotik, outbox-red | `promesas_pago` | 1.067 | Alta | Pendiente |
| `finanzas-opex` | Gastos operativos | config, notificaciones | `egresos_ingresos` | 548 | Media | Pendiente |
| `proyectos-inversion` | CAPEX y ratios | — | `proyectos_inversion` | 497 | Baja | Pendiente |

### Dominio Red / OSS

| Módulo | Objetivo | Depende de | Tablas propias | LOC | Criticidad | MOD |
|---|---|---|---|---|---|---|
| **`olt-nativo`** | Ciclo de vida FTTH completo | auth, config, monitoreo, smartolt, tr069 | 27 tablas `olt_*`, `ftth_*`, `contrato_onu_config`, `cpe_*`, `operacion_wizard*` | 25.659 | Máxima | **MOD-003** |
| `mikrotik` | Provisión y control RouterOS | auth, config, contratos, openvpn, planes | `routers`, `drift_detectado`, `reconciliation_log` | 8.801 | Máxima | Pendiente |
| `openvpn` | Canal de gestión hacia la planta | config, mikrotik | `openvpn_config`, `vpn_clientes`, `vpn_alertas` | 2.473 | Máxima | Pendiente |
| `outbox-red` | Frontera transaccional negocio↔red | mikrotik, olt-nativo | `comandos_red_pendientes` | 1.060 | Máxima | Pendiente |
| `monitoreo` | Vigilancia ICMP/SNMP | auth, mikrotik | `dispositivos_monitoreo`, `metricas_monitoreo`, `alertas_sistema`, `umbrales_alerta`, `nodos*` | 2.231 | Alta | Pendiente |
| `planta-externa` | Fibra, mufas, splitters, NAPs | auth | `pe_*` (9 tablas) | 4.671 | Media | Pendiente |
| `smartolt` | Proveedor OLT alternativo | auth, mikrotik | `olts`, `onus` | 2.608 | Media | Pendiente |
| `tr069` | Modelo de dispositivo ACS | — | `tr069_device` | 318 | Alta | Pendiente |
| `reconciliador` | Reconciliación periódica BD↔red | mikrotik, smartolt | — | 280 | Alta | Pendiente |

### Dominio Comunicación

| Módulo | Objetivo | Depende de | Tablas propias | LOC | Criticidad | MOD |
|---|---|---|---|---|---|---|
| `notificaciones` | Motor por eventos, 3 estrategias | workers | `notificaciones`, `notificaciones_logs` | 1.865 | Alta | Pendiente |
| `mensajeria` | Campañas masivas con goteo | notificaciones, workers | — | 628 | Media | Pendiente |
| `crm-nativo` | Bandeja WhatsApp (Chromium) | auth, config | `crm_chats`, `crm_mensajes` | 2.484 | Baja | Pendiente |
| `plantillas` | Plantillas de mensaje y abonado | — | `plantillas_mensajes`, `plantillas_abonados` | 586 | Media | Pendiente |
| `webhooks` | Recepción de webhooks | — | — | 151 | Media | Pendiente |

### Dominio Cliente Final

| Módulo | Objetivo | Depende de | Tablas propias | LOC | Criticidad | MOD |
|---|---|---|---|---|---|---|
| `portal` | Portal del abonado (identidad propia) | clientes, facturacion, mikrotik, olt-nativo, tickets | `portal_config`, `portal_banner`, `portal_solicitud_plan`, `consumo_datos`, `consumo_snapshot` | 4.546 | Alta | Pendiente |
| `tickets` | Soporte y órdenes de trabajo | — | `tickets`, `tickets_comentarios`, `ordenes_trabajo` | 737 | Media | Pendiente |
| `xui` | IPTV (XUI.ONE) | auth | `xui_servidores`, `xui_lines` | 1.404 | Baja | Pendiente |

### Dominio Plataforma

| Módulo | Objetivo | Depende de | Tablas propias | LOC | Criticidad | MOD |
|---|---|---|---|---|---|---|
| `auth` | Autenticación de operadores | usuarios | — | 1.400 | Máxima | Pendiente |
| `usuarios` | Usuarios, roles, permisos | — | `usuarios`, `roles`, `permisos`, `usuarios_roles`, `auditoria_logs` | 921 | Máxima | Pendiente |
| `licencia` | Licenciamiento y bloqueo global | — | `licencia_estado` | 700 | Máxima | Pendiente |
| `auditoria` | Trazabilidad, versiones, undo/redo | usuarios | `entity_versions` | 792 | Alta | Pendiente |
| `sistema` | Centro de operaciones | notificaciones | `eventos_sistema` | 1.512 | Alta | Pendiente |
| `backup` | Respaldos | config | `backups` | 560 | Alta | Pendiente |
| `workers` | Motor de cobranza y facturación | aprovisionamiento, auth, config, facturacion, mikrotik, notificaciones, outbox-red | — | 2.805 | Máxima | Pendiente |
| `config` | Empresa, dominios, SSL | — | `empresas` | 1.281 | Alta | Pendiente |
| `sagas` | Bitácora de sagas | — | `saga_log` | 195 | Alta | Pendiente |
| `mantenimiento` | Pausa coordinada de colas | config, workers | — | 202 | Media | Pendiente |
| `schema-guard` | Verificación de esquema al arrancar | — | — | 33 | Alta | Pendiente |
| `health` | Salud y estado de módulos | — | — | 240 | Alta | Pendiente |
| `install` | Instalador web | — | — | 373 | Media | Pendiente |
| `reportes` | Reportes y exportación XLSX | — | — | 419 | Media | Pendiente |
| `dashboard` | Métricas de inicio | — | — | 126 | Media | Pendiente |
| `google-integration` | Google Workspace (4 servicios) | workers | `google_accounts`, `google_sync_logs`, `google_client_contacts` | 1.955 | Baja | Pendiente |
| `aprovisionamiento` | Notificación de aprovisionamiento | auth | — | 327 | Media | Pendiente |
| `migracion` | **Directorio vacío** | — | — | 0 | — | — |

## 8.4 Orden de documentación de los módulos pendientes

**Regla:** un módulo se especifica **cuando se toca**, o cuando su criticidad lo exige.

### Prioridad 1 — antes de tocarlos

| Módulo | Motivo |
|---|---|
| `outbox-red` | Frontera transaccional del sistema; su tabla no tiene entidad |
| `facturacion` | Fórmula única del ciclo de cobro; su suite de tests no compila |
| `workers` | Decide quién se queda sin servicio |
| `openvpn` | Punto único de falla del plano de red |

### Prioridad 2 — al abordar su recomendación del roadmap

| Módulo | Recomendación asociada |
|---|---|
| `mikrotik` | RDM-001 R5 (extender garantías) |
| `reconciliador` | RDM-001 R10 (unificar reconciliación) |
| `monitoreo` | RDM-001 R12 (retención de series) |
| `portal` | Superficie pública |

### Prioridad 3 — el resto, cuando se modifiquen

---

# 9. Referencias

AEM-001 · ARS-001 · DOM-001 · DAT-001 · POL-001 · MOD-001 · MOD-002 · MOD-003

---

# 10. Anexos

## Anexo A — Módulos por criticidad

| Criticidad | Módulos |
|---|---|
| **Máxima** (13) | contratos · pagos · facturacion · olt-nativo · mikrotik · openvpn · outbox-red · workers · clientes · planes · auth · usuarios · licencia |
| **Alta** (11) | monitoreo · portal · notificaciones · promesas-pago · tr069 · reconciliador · auditoria · sistema · backup · sagas · schema-guard · health · config |
| **Media** (12) | planta-externa · smartolt · mensajeria · plantillas · webhooks · tickets · zonas · sites · finanzas-opex · mantenimiento · install · reportes · dashboard · aprovisionamiento |
| **Baja** (4) | crm-nativo · xui · google-integration · proyectos-inversion |

## Anexo B — Módulos que concentran responsabilidades

| Módulo | Señal |
|---|---|
| `olt-nativo` | 25.659 LOC · 41 servicios · 24 entidades · 11 crons · 1 controlador con ~150 endpoints |
| `pagos` | 5.836 LOC · registro + canales + conciliación + Mercado Pago + arqueo + adelantos + extorno |
| `facturacion` | 5.477 LOC · emisión + política + deuda + aplicador + PDF + configuración |
| `mikrotik` | 8.801 LOC · 15 servicios · 10 consumidores · 3 caminos al hardware |
| `contratos` | 8 dependencias salientes |

## Anexo C — Módulos sin controlador (infraestructura pura)

`reconciliador` · `sagas` · `schema-guard` · `mantenimiento` · `notificaciones`

Se administran desde otros módulos (`sistema`, `workers`) o corren de forma autónoma.
