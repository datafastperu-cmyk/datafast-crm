# MAN-002 — Manual del Administrador

---

## 2. Control documental

| Campo | Valor |
|---|---|
| **Código** | MAN-002 · **Versión** 1.0 · **Estado** Vigente |
| **Autor** | Arquitectura · **Revisores** Pendientes de asignar |
| **Fecha** | 2026-08-06 · **Audiencia** Administrador del ERP y responsable técnico del ISP |

## 3. Historial de cambios

| Versión | Fecha | Cambio | Motivo |
|---|---|---|---|
| 1.0 | 2026-08-06 | Emisión inicial | La configuración del sistema no estaba documentada; varias opciones tienen consecuencias sobre clientes reales |

## 4. Índice

1. Responsabilidades del administrador · 2. Empresa y licencia · 3. Usuarios, roles y permisos ·
4. Catálogos de negocio · 5. Configuración de facturación y cobranza · 6. Configuración de red ·
7. Integraciones · 8. Portal del cliente · 9. Mensajería · 10. Centro de operaciones ·
11. Respaldos · 12. Rutinas y alarmas · 13. Operaciones peligrosas

## 5. Objetivo

Documentar la configuración y administración del ERP Datafast, señalando **qué opciones tienen
consecuencias sobre el servicio de clientes reales**.

## 6. Alcance

**Cubre:** todo lo accesible desde Configuración y desde el Centro de Operaciones.
**No cubre:** operación diaria (MAN-001) ni administración del VPS (PRO-001).

## 7. Definiciones y glosario

Ver MAN-001 §7 y DOM-001 §8.1. Términos propios de este manual:

| Término | Definición |
|---|---|
| **Baseline** | Configuración canónica que el ERP exige a una OLT |
| **Pool** | Rango de recursos (puertos, IDs, IPs) que el ERP administra |
| **Preset de ONU** | Configuración que el ERP aplica a las ONUs que provisiona |
| **Drift** | Divergencia entre lo que el ERP espera y lo que el equipo tiene |
| **Watcher** | Proceso automático que repara descuadres |
| **Degradado** | Módulo funcionando sin su dependencia externa |

---

# 8. Contenido

## 8.1 Responsabilidades del administrador

| # | Responsabilidad | Frecuencia |
|---|---|---|
| 1 | Usuarios, roles y permisos | Según necesidad |
| 2 | Catálogos (planes, canales de pago, zonas) | Según necesidad |
| 3 | Configuración de facturación y cobranza | Al inicio y ante cambios de política |
| 4 | Configuración de red (OLTs, routers, pools, baselines) | Al crecer la planta |
| 5 | Integraciones | Al inicio y ante caídas |
| 6 | **Vigilar la salud del sistema** | **Diaria** |
| 7 | Verificar respaldos | Semanal |
| 8 | Revisar drift y descuadres | Semanal |

## 8.2 Empresa y licencia

### 8.2.1 Datos de la empresa

**Dónde:** Configuración → Empresa. Razón social, identificación fiscal, dirección, contacto y
logo. Aparecen en los comprobantes.

### 8.2.2 Dominios y SSL

**Dónde:** Configuración → Servidor.

Tres roles de dominio, **ninguno obligatorio**:

| Rol | Uso |
|---|---|
| **ERP** | Panel administrativo |
| **Portal** | Portal del abonado |
| **Web** | Web pública |

El ERP puede servirse por IP, en una LAN o con los tres dominios. Desde aquí puedes ver el estado
de los certificados y solicitar su emisión.

### 8.2.3 Licencia

**Dónde:** Configuración → Licencia. Muestra el estado, el identificador de máquina y permite
activar o revalidar.

> ⚠️ **Sin licencia válida el ERP queda bloqueado por completo, incluido el acceso.** Es
> intencionado. El sistema revalida a diario y recarga cada 6 horas; si el servidor de licencias
> queda inalcanzable de forma prolongada, contacta con el proveedor **antes** de que expire.

> **Al reconstruir el servidor, el identificador de máquina cambia** y puede requerir
> reactivación. Tenlo previsto en un plan de recuperación.

## 8.3 Usuarios, roles y permisos

**Dónde:** Configuración → Personal.

| Acción | Nota |
|---|---|
| Crear usuario | Se asigna a la empresa activa |
| Asignar roles | Un usuario puede tener varios |
| Cambiar estado | Desactivar en lugar de eliminar |
| Restablecer contraseña | El usuario deberá cambiarla |
| Crear y clonar roles | Clonar es la forma rápida de crear variantes |
| Editar permisos de un rol | Afecta a todos sus usuarios |
| Ver log de personal | Auditoría de accesos |

### Buenas prácticas

| # | Práctica |
|---|---|
| 1 | Un usuario por persona. **Nunca cuentas compartidas**: la auditoría deja de servir |
| 2 | Roles por función, no por persona |
| 3 | El permiso de **prórroga** (`contratos:prorroga`) solo a quien pueda decidir aplazar cobros |
| 4 | Revisa periódicamente quién puede **extornar pagos** |
| 5 | Desactiva a quien deja la empresa **el mismo día** |

> ⚠️ **Limitación conocida:** el permiso fino por acción solo está aplicado en algunos módulos
> (contratos, planes, zonas, prórrogas). En el resto, el acceso es **por rol al módulo completo**.
> Tenlo en cuenta al diseñar los roles.

## 8.4 Catálogos de negocio

| Catálogo | Dónde | Nota |
|---|---|---|
| **Planes** | Servicios → Internet | Velocidad, precio y estrategia de limitación. **Cambiar un plan no cambia solo las velocidades ya aplicadas** |
| **Zonas** | Configuración → Ubicaciones | Agrupación comercial |
| **Sites** | Red → Sites | Nodos físicos |
| **Plantillas de mensaje** | Configuración → Plantillas | Con variables |
| **Plantillas de abonado** | Configuración → Plantillas | Perfiles predefinidos de alta |

## 8.5 Configuración de facturación y cobranza

### 8.5.1 Comprobantes

**Dónde:** Configuración → Facturación.

Series y correlativos, tipos de comprobante, comprobante por defecto.

> ⚠️ **Los correlativos son por empresa y no deben manipularse a mano.**

> ⚠️ **La facturación electrónica ante SUNAT no está implementada.** La sección existe en la
> interfaz, pero el sistema **no emite ni envía comprobantes electrónicos**. Los comprobantes son
> documentos internos en PDF.

### 8.5.2 Bancos, formas de pago, canales y cuentas receptoras

**Dónde:** Configuración → Facturación (bancos, formas de pago) · Pagos (canales, cuentas).

**Canal de pago** = por dónde entra el dinero. **Cuenta receptora** = dónde queda depositado.

> Un canal o cuenta con movimientos **se desactiva, no se elimina**: eliminarlo dejaría pagos
> históricos sin referencia.

### 8.5.3 Ciclo de cobro

**Dónde:** Configuración → Facturación (global) · ficha del cliente (particular).

| Parámetro | Significado |
|---|---|
| Día de emisión | Cuándo se genera la factura |
| Día de vencimiento | Cuándo debe estar pagada |
| **Días de gracia** | **Distancia entre el vencimiento y el corte** |

> ⚠️ **La gracia NO se suma al vencimiento: es la distancia hasta el corte.** Configurarlo mal
> puede provocar cortes antes del vencimiento — ya ocurrió y por eso el cálculo está unificado en
> un solo sitio.

### 8.5.4 Ajustes de cobranza

**Dónde:** Finanzas → Ajustes de cobranza.

> ⚠️ **Campos que se guardan pero aún no tienen efecto:** mora, reconexión, esquema de impuestos,
> impuesto 1 y aviso en pantalla. Están registrados como pendientes. **No los configures esperando
> que se apliquen.**

### 8.5.5 Pasarelas de pago

**Dónde:** Configuración → Pasarela de pagos.

**Disponible:** Mercado Pago.

> **Otras pasarelas (Niubiz, Izipay, Culqi, Stripe) no están disponibles y su ausencia es
> deliberada.** El sistema tiene definido el contrato de integración pero exige antes una puerta
> de estabilidad: 30 días de contabilidad limpia en producción, un extorno real revisado a mano y
> un cierre de caja mensual cuadrado. **No es una limitación técnica: es una decisión de
> prudencia con el dinero de clientes.**

## 8.6 Configuración de red

### 8.6.1 Registrar una OLT

**Dónde:** Configuración → OLTs → Nueva (asistente).

| Paso | Qué ocurre |
|---|---|
| 1 | Datos de conexión | El sistema detecta el modelo y la versión |
| 2 | Topología | Lee tarjetas y puertos |
| 3 | Confirmación | Registra la OLT y su inventario |

> ⚠️ **Una OLT admite un solo proveedor de operación** (nativo, SmartOLT o AdminOLT), fijado al
> registrarla. **No se puede cambiar después.**

### 8.6.2 Baselines

**Dónde:** Configuración → OLTs → Baselines.

Un baseline es la **configuración canónica** que el ERP exige: VLANs, perfiles, rangos de
service-port e identificadores.

| Regla | Motivo |
|---|---|
| **Una versión publicada nunca se edita** | Crear con el mismo nombre genera una versión nueva; así queda auditable qué se exigía en cada momento |
| **No se crean VLANs sin consumidor** | Una VLAN sin servicio que la use es configuración muerta |
| El ERP **inyecta** su configuración y **respeta** lo preexistente | Nunca reconfigura lo que ya funcionaba |

Puedes ver el **plan** (qué cambiaría) antes de aplicar, y consultar el **compliance** de cada
OLT.

### 8.6.3 Pools de recursos

**Dónde:** Configuración → OLTs → la OLT → Pools.

| Pool | Qué administra |
|---|---|
| Service-port | Identificadores de servicio (rango del ERP: 2000–3999) |
| ONU-ID | Identificadores de ONU por puerto PON (1–128) |
| IP de gestión | IPs para la gestión remota de ONUs |
| Puerto de gestión | — |

**Acciones:** configurar rango · reconciliar contra el equipo · liberar libres · retirar un tramo.

> ⚠️ **Nunca podrás retirar una IP de gestión ocupada, y es intencionado.** Esa IP está escrita en
> una ONU viva; sacarla del pool haría que el ERP perdiera constancia de que le pertenece y el
> tramo podría reasignarse a otra OLT: **dos ONUs con la misma IP en la misma red**. Para
> liberarla, primero desaprovisiona o desactiva la gestión de esa ONU.

### 8.6.4 Preset de ONU

**Dónde:** Configuración → OLTs → la OLT → Preset.

Define el WiFi y las credenciales de acceso web que el ERP aplica a las ONUs **que él
provisiona**.

> ⚠️ **Lee §8.13.1 antes de cambiarlo.**

### 8.6.5 Routers

**Dónde:** Red → Routers. Registro mediante asistente que genera el túnel VPN.

| Regla | Motivo |
|---|---|
| **El script VPN se genera una sola vez y no se regenera** | La edición solo permite verlo |
| **La IP del túnel es permanente** | Solo se libera al eliminar el router o cancelar el asistente sin terminar |
| **Al eliminar un router se revoca su certificado y se elimina el túnel** | Evita equipos reintentando conectar indefinidamente |

> ⚠️ **Nunca amplíes manualmente el alcance de un router para "llegar" a la red de otro.** Ese
> alcance declara **de quién es** cada red, no cómo se llega. Dos routers reclamando la misma red
> no da error: atribuye clientes al equipo equivocado.

### 8.6.6 VPN

**Dónde:** Red → VPN. Estado del servicio, clientes, alertas, reconciliación y limpieza de
huérfanos.

> **Si el servicio VPN cae, el ERP pierde acceso a todos los MikroTik.** No significa que los
> abonados estén sin servicio: significa que no puedes gestionarlos.

### 8.6.7 Planta externa

**Dónde:** Red → Planta externa y Cajas NAP. Mufas, fusiones, splitters, NAPs y acometidas.

> **Está en fase 1 de 3.** Las fases siguientes están en pausa por decisión de diseño.

## 8.7 Integraciones

**Dónde:** Configuración → Integraciones.

| Integración | Configuración | Si cae |
|---|---|---|
| **SmartOLT / AdminOLT** | URL y token | El camino nativo sigue funcionando |
| **Google** | OAuth por empresa | Sin agenda, contactos ni respaldo a Drive |
| **WhatsApp Business** | Credenciales del gateway | **Sin avisos de corte** |
| **IPTV (XUI)** | Servidor y credenciales | Sin gestión de líneas |
| **Gestión remota (GenieACS)** | Configurada a nivel de servidor | Sin gestión de CPE |

> ⚠️ **La gestión remota exige que las credenciales configuradas en GenieACS coincidan con las
> del servidor.** Si dejan de coincidir, **la gestión de ONUs deja de funcionar sin mensaje de
> error claro**. Ante fallos generalizados de TR-069, es lo primero que hay que verificar con el
> responsable técnico.

**Todas las integraciones son degradables:** si una cae, el ERP arranca igual y lo declara en el
estado de módulos.

## 8.8 Portal del cliente

**Dónde:** Configuración → Portal Cliente.

Activación, branding, banners y solicitudes de cambio de plan.

**Qué puede hacer el abonado:** ver facturas y consumo, ver el estado de su ONU, **cambiar su
WiFi**, gestionar dispositivos, abrir tickets y solicitar cambio de plan.

> ⚠️ **El portal alcanza hardware real:** cuando un abonado cambia su WiFi, la orden llega a su
> equipo. Ten esto presente al decidir si activarlo.

## 8.9 Mensajería

**Dónde:** Configuración → Mensajería · Plantillas.

| Aspecto | Nota |
|---|---|
| **Canales disponibles** | WhatsApp (propio y gateway) y correo |
| **SMS** | **No disponible** — no hay proveedor integrado |
| Plantillas | Con variables del cliente y del contrato |
| Envío | Con prioridades: las alertas van antes que lo informativo |
| Campañas | Con goteo, para no bloquear el número |

**Registro de envíos:** Configuración → Sistema → Logs de notificación. Permite previsualizar y
reenviar.

## 8.10 Centro de operaciones

**Dónde:** Configuración → Sistema.

| Sección | Uso |
|---|---|
| **Watchers** | **Latido de los procesos automáticos** |
| **Eventos** | Actualizaciones, reinicios, hitos |
| **Información** | Versión y estado |
| **Actualizar** | Actualización con respaldo previo |
| **Reiniciar** | Reinicio del sistema |
| **Crontab** | Tareas programadas del servidor |
| **Logs de notificación** | Envíos, previsualización y reenvío |
| **Configuración del gateway** | Mensajería |

Además: **estado de módulos** (degradados y su razón), **estado de colas** y **estado del outbox
de red**.

## 8.11 Respaldos

**Dónde:** Configuración → Backup.

Crear, listar, descargar, eliminar y configurar. Puede copiarse a Google Drive.

> ⚠️ **Un respaldo de la base de datos NO es suficiente por sí solo.** Para recuperar el sistema
> hacen falta además el archivo de configuración del servidor (contiene la clave con la que se
> cifran las credenciales de los equipos) y los certificados de la VPN. Sin ellos, el respaldo no
> permite volver a operar la red. Coordínalo con el responsable técnico (PRO-001 §8.4).

> **Un respaldo que nunca se ha restaurado no es un respaldo.** Prueba una restauración
> periódicamente en un entorno de prueba.

## 8.12 Rutinas y alarmas

### 8.12.1 Rutina diaria

| # | Comprobación | Dónde |
|---|---|---|
| 1 | **Latido de watchers** | Sistema → Watchers |
| 2 | **Estado del outbox de red** | Estado del sistema |
| 3 | Módulos degradados | Estado de módulos |
| 4 | Colas sin acumulación | Estado de colas |
| 5 | Alertas de red abiertas | Monitoreo → Alertas |

> ⚠️ **La comprobación 1 es la más importante y la menos evidente.** Si los procesos automáticos
> se detienen, **el ERP sigue respondiendo con total normalidad** mientras nadie se corta, nadie
> se reactiva y ninguna orden llega a la red. **No hay aviso en pantalla.** Hasta que exista una
> alarma automática, esta revisión manual es la única defensa.

### 8.12.2 Rutina semanal

| # | Comprobación |
|---|---|
| 1 | Drift de red (Red → Drift) |
| 2 | Discrepancias de velocidad |
| 3 | Alertas de VPN |
| 4 | Que el último respaldo existe y tiene tamaño razonable |
| 5 | Pagos pendientes de aplicar |

### 8.12.3 Señales que exigen actuar

| Señal | Significado |
|---|---|
| Sin latido de watchers | **Los procesos automáticos están caídos** |
| Órdenes de red acumulándose | El outbox no drena |
| Aviso de orden agotada | Una orden agotó sus reintentos: requiere intervención |
| «Emisor caído» | **Los avisos de corte no están saliendo** |
| Módulo degradado inesperado | Una integración cayó |
| Alertas de señal óptica | Fibra degradada o corte inminente |

## 8.13 Operaciones peligrosas

### 8.13.1 ⚠️ Antes de una migración de ONUs — LEER OBLIGATORIAMENTE

**Si vas a incorporar al ERP ONUs que ya estaban funcionando** (migración desde SmartOLT,
MikroWISP, o adopción masiva), lee esto y actúa en consecuencia. **No es opcional.**

**El mecanismo:** el ERP tiene rutinas automáticas que **reescriben el nombre y la clave del WiFi,
y las credenciales de acceso del equipo**, en toda ONU que figure como pendiente de configurar.

Para las ONUs que el ERP provisiona, eso es correcto: aplica su configuración canónica.

**En una migración no afecta a una ONU: afecta a todas a la vez, sin que nadie lo pida.** Son
clientes reales que llevan años con su configuración, muchos con su propia clave de WiFi, que se
quedan **sin internet en sus dispositivos sin que nadie sepa por qué**.

> ⚠️ **No hay una noche de margen para darse cuenta: son dos minutos.** Hay dos rutinas, y la que
> captura una ONU recién migrada **corre cada dos minutos**, no a las 03:30. Si la migración deja
> mal el origen, el daño empieza casi de inmediato.

**Protección vigente:** cada ONU declara su **origen** (aprovisionada por el ERP, adoptada o
migrada), y las rutinas automáticas **solo actúan sobre las del ERP**. Reconfigurar una ONU ajena
sigue siendo posible, pero exige una acción deliberada del operador — nunca ocurre sola.

**Reglas obligatorias:**

| # | Regla |
|---|---|
| 1 | Toda ONU incorporada declara su origen como **migrada** o **adoptada**. Si el script de migración no lo declara, el sistema asume que es del ERP — y esa es exactamente la trampa |
| 2 | El sistema **solo** aplica su configuración a las ONUs que él mismo provisiona. Una ONU que ya funcionaba **se adopta y se respeta**, nunca se reconfigura |
| 3 | Ejecutar el **pre-flight de migración antes y después** de incorporar el parque. Devuelve *seguro* o *PARAR*, no un número que haya que interpretar |

**No inicies una migración sin coordinarla con el responsable técnico.**

### 8.13.2 Otras operaciones que requieren cuidado

| Operación | Riesgo | Antes de hacerla |
|---|---|---|
| Cambiar el preset de ONU | Afecta a las próximas provisiones | Verifica que el WiFi propuesto es el deseado |
| Aplicar un baseline a una OLT en producción | Cambia configuración de central | Revisa **el plan** antes de aplicar |
| Retirar un rango de un pool | Puede dejar recursos sin control | El sistema bloquea los ocupados; **entiende por qué** |
| Eliminar un router | **Revoca su certificado y elimina el túnel** | Confirma que no hay abonados activos detrás |
| Cambiar permisos de un rol | Afecta a todos sus usuarios | Revisa quién lo tiene |
| Eliminar un canal de pago | Deja pagos históricos sin referencia | **Desactívalo en lugar de eliminarlo** |
| Restaurar un respaldo | La red **no vuelve atrás** con la base de datos | Coordina con el responsable técnico: hay que reconciliar |
| Programar mantenimiento de 02:30 a 05:00 | Coincide con cinco rutinas nocturnas | Elige otra franja |

---

# 9. Referencias

MAN-001 · PRO-001 · POL-001 · SEC-001 · MOD-002 · MOD-003 · ADR-013 · ADR-014

---

# 10. Anexos

## Anexo A — Mapa de Configuración

| Sección | Contenido |
|---|---|
| Empresa | Datos y logo |
| Servidor | Dominios y SSL |
| Licencia | Estado y activación |
| Personal | Usuarios, roles y permisos |
| Facturación | Comprobantes, series, bancos, formas de pago |
| Pasarela de pagos | Mercado Pago |
| Mensajería | Gateway y canales |
| Plantillas | Mensajes y perfiles de abonado |
| Portal Cliente | Activación, branding, banners, solicitudes |
| OLTs | Registro, baselines, pools, presets |
| Integraciones | SmartOLT, AdminOLT, Google, WhatsApp Business |
| Ubicaciones | Zonas |
| Backup | Respaldos |
| Sistema | Centro de operaciones |
| Crontab | Tareas del servidor |
| Log | Auditoría |
| Importar clientes · Cambios masivos · Campos personalizados | Utilidades |

## Anexo B — Qué funciona y qué no, con claridad

| Funcionalidad | Estado |
|---|---|
| Gestión de clientes y contratos | ✅ Completa |
| Provisión FTTH con verificación | ✅ Completa |
| Provisión WISP | ⚠️ Funciona con menos comprobaciones |
| Facturación interna (PDF) | ✅ Completa |
| **Facturación electrónica SUNAT** | ❌ **No implementada** |
| Cobranza, caja, arqueo, extorno | ✅ Completa |
| Cobro en línea | ⚠️ Solo Mercado Pago (por decisión) |
| Suspensión y reactivación automáticas | ✅ Completa |
| Prórrogas | ✅ Completa |
| Gestión remota de ONUs | ✅ Completa |
| **Sustitución de ONU** | ❌ **No implementada** — se improvisa como baja + alta |
| Cambio de plan | ⚠️ Verificar después: puede descuadrar |
| Monitoreo de red | ✅ Completa |
| Planta externa | ⚠️ Fase 1 de 3 |
| Portal del abonado | ✅ Completa |
| Notificaciones WhatsApp y correo | ✅ Completa |
| **SMS** | ❌ **No disponible** |
| **Inventario / almacén** | ❌ **No implementado** |
| IPTV | ✅ Completa |
| Reportes y exportaciones | ✅ Completa |
| Auditoría, undo/redo y papelera | ✅ Completa |
| Respaldos | ✅ Completa |

## Anexo C — Contactos y escalado

| Situación | A quién |
|---|---|
| Fallo funcional del ERP | Responsable técnico |
| Los procesos automáticos no laten | **Responsable técnico — urgente** |
| Órdenes de red acumuladas | Responsable técnico |
| Gestión remota caída en general | Responsable técnico (verificar credenciales del ACS) |
| Licencia por expirar o bloqueada | Proveedor del ERP |
| Migración de parque de ONUs | **Responsable técnico — nunca por cuenta propia** |
| Restauración de respaldo | Responsable técnico |
