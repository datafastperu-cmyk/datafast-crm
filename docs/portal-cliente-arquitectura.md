# Portal del Cliente — Documento de Arquitectura

Estado: **Fases 0 a 6 implementadas y desplegadas al repositorio.** Fase 7 (pasarela real) fuera de alcance por decisión de negocio.
Fecha: 2026-07-30

---

## 0. Qué existe hoy (verificado en repo, no asumido)

| Pieza | Estado real |
|---|---|
| Credenciales | `clientes.usuario_portal` + `password_portal` (bcrypt, `clientes.service.ts:110`). Obligatorias en `ClienteDetalle.tsx:247-248`. **Sin índice único** y **sin endpoint de login**. |
| WiFi + hosts LAN | `OnuTr069DetalleService.getDetalle/setWifi` → `OnuWifiBand[]`, `OnuHost[]`. Expuesto en `onu/:sn/tr069/*`. Funciona. |
| Carril TR-069 | Bajo demanda: `POST onu/:contratoId/tr069/activar \| desactivar \| uso`. Barrido por inactividad (TTL 3 d). |
| Consumo | Tabla `consumo_datos` creada en `1700000009000`. Al arrancar el proyecto **nadie la escribía**; desde la Fase 6 la alimenta `ConsumoColectorService` — apagado por defecto (`CONSUMO_COLECTOR_ENABLED`). |
| Facturas / pagos | Módulos completos. Pasarela: MercadoPago. |
| Planes | `planes.visible_en_portal` **ya existe** (`plan.entity.ts:49`) + `descripcion`. Resuelve el catálogo del portal sin schema nuevo. |
| Tickets | `tickets.abierto_por_portal` ya existe. |
| Nginx | `20-portal.conf` publica `portal.tudominio.com` (**hardcodeado, viola portabilidad multi-VPS**) y ya devuelve 403 a todo `/api/` fuera de `auth\|portal\|facturas\|pagos\|tickets\|consumo`. |
| Frontend | Nada. `configuracion/portal-cliente` es placeholder. |

---

## 1. Decisiones de arquitectura

### 1.1 URL y despliegue

- **Subdominio dedicado**, no path. Aísla cookies, CSP y rate-limit del ERP interno; un XSS en el portal no alcanza la sesión del operador.
- Dominio **parametrizado por instalación** (regla de portabilidad multi-VPS):
  `PORTAL_DOMAIN=portal.miempresa.pe` en `.env.production` + `.env.example`.
  `20-portal.conf` pasa a plantilla `20-portal.conf.template` con `envsubst` en el arranque del contenedor. Se elimina `portal.tudominio.com` del repo.
- **Mismo proceso Next**, route group `(portal)`. El `middleware.ts` enruta por `Host`:
  `host === PORTAL_DOMAIN` → reescribe a `/portal/*` y usa la cookie del portal; cualquier otra ruta bajo ese host → 404. Y al revés: el host del ERP no sirve `/portal/*`.
- **PWA instalable** (`next-pwa` ya está). Manifest propio del portal, `display: standalone`, sin service worker de datos (nada de cachear facturas o estado de servicio).

### 1.2 Autenticación

- Endpoint propio `POST /api/v1/portal/auth/login` — **no reutiliza** `auth.service`.
- Credenciales: `usuario_portal` + `password_portal`, tal como se cargan hoy en Detalle del Cliente. **El cliente no puede cambiar su clave** (decisión de negocio). El único camino de cambio/reseteo es el operador desde `ClienteDetalle`.
- JWT con `aud: 'portal'`, `sub: clienteId`, `empresaId`. `PortalJwtGuard` valida el `aud` — **un token de portal no pasa ningún guard interno y un token de operador no pasa el del portal**. Sin roles compartidos.
- Cookies distintas: `portal_access_token` / `portal_refresh_token` (no colisionan con las del ERP aunque el navegador comparta dominio raíz). Access 30 min, refresh 7 d, `HttpOnly`, `Secure`, `SameSite=Lax`.
- Rate-limit: 5 intentos / 15 min por `usuario_portal` + por IP; bloqueo temporal de 15 min con registro en auditoría.

**Defecto a corregir antes del login (bloqueante):** `usuario_portal` no tiene unicidad. Dos clientes con el mismo usuario hacen el login ambiguo o suplantable.
→ Migración: `CREATE UNIQUE INDEX ux_clientes_usuario_portal ON clientes (empresa_id, lower(usuario_portal)) WHERE usuario_portal IS NOT NULL AND deleted_at IS NULL;`
Resolución de empresa: por `PORTAL_DOMAIN` → `empresa_id` (una instalación puede ser multi-empresa; el host decide el tenant, nunca el usuario).

### 1.3 Vocabulario y errores

El portal consume el mismo `ResultadoOperacion` del dominio; el borde HTTP traduce. Tres mensajes distintos y nunca intercambiables en la UI:

| Situación | Mensaje al cliente |
|---|---|
| ERP/API caído | "No pudimos conectar con nuestro sistema. Reintenta en unos minutos." + botón Reintentar |
| Router/ONU no responde (TR-069 sin sesión viva) | "Tu router no está respondiendo. Verifica que esté encendido." + Reintentar |
| Operación aceptada sin confirmar (`indeterminado`) | "Enviamos el cambio, pero aún no pudimos confirmarlo. Revisa en unos minutos." — **jamás "guardado"** |

---

## 2. Modelo de sesión: cliente → contratos

Un cliente puede tener **varios contratos**. El portal abre con un **selector de servicio** persistente en el header:

```
┌────────────────────────────────────────────┐
│ ▼ FTTH 300 Mbps · Av. Los Álamos 452       │  ← número de contrato + plan + dirección
│   Activo · Corte 15/08                     │
└────────────────────────────────────────────┘
```

Se muestra `numero_contrato`, plan, `direccion_instalacion` y estado. Con un solo contrato el selector se colapsa a texto fijo.

**Todo endpoint del portal recibe `contratoId` y valida `contrato.cliente_id === jwt.sub`.** Sin esa validación, el portal es un IDOR sobre todo el parque.

### Ficha del titular (pedida explícitamente)

Bloque de perfil, **solo lectura**, con exactamente estos campos y estas fuentes:

| Campo mostrado | Fuente |
|---|---|
| Nombre completo | `clientes.nombres + apellidos` |
| DNI / documento | `clientes` (número de documento) |
| Dirección | `contratos.direccion_instalacion` (la del servicio seleccionado, no la fiscal del cliente) |
| Teléfono | `clientes.whatsapp` |
| Plan actual | `plan.nombre`, `velocidad_bajada` / `velocidad_subida`, `descripcion` |
| **Precio que paga** | `contratos.precio_final` — **no `plan.precio`** |
| Fecha de pago | `contratos.dia_facturacion` / `fecha_ultimo_pago` |
| Fecha de corte | derivada de `dia_facturacion` + `dias_prorroga`, o `prorroga_hasta` si `en_prorroga` |
| Deuda | `contratos.deuda_total`, `meses_deuda` |

**El precio es el del contrato, no el de la lista de planes.** `precio_final` es columna generada que ya aplica `descuento_pct` ([contrato.entity.ts:136](../backend/src/modules/contratos/entities/contrato.entity.ts#L136)). Mostrar `plan.precio` le cobraría de más en pantalla a todo cliente con descuento y generaría un reclamo por cada uno.

La identidad del plan se toma de la **misma fuente que usa el detalle de facturación** (`plan_nombre` resuelto en el join del contrato, `facturacion.service.ts:233`), para que lo que ve en su perfil y lo que dice su factura no puedan divergir.

Si algún dato está mal, el cliente **no lo edita**: abre un ticket de categoría `cambio_datos` (ya existe en el enum).

---

## 3. Secciones

### 3.1 Dashboard

- Estado del servicio: `Activo` / `Suspendido por pago` / `Cortado` / `En prórroga hasta DD/MM`. Fuente: `contratos.estado` + `en_prorroga`.
- Consumo del mes (ver §4).
- Próximo pago y deuda, con CTA.
- Botón flotante de pago (§5) — visible solo si hay deuda > 0.

### 3.2 Facturación

Listado con filtro Pagadas / Pendientes / Vencidas, estado de cuenta y deuda acumulada. Solo lectura salvo el pago.

**Sin descargas.** Decisión de negocio: el portal **no expone ningún documento descargable** — ni comprobante PDF, ni contrato firmado. La información de cada factura se muestra **en pantalla** (número, período, concepto, monto, estado, fecha de pago). Consecuencias asumidas:

- No se implementa `GET /portal/facturas/:id/pdf`, y `pdf.service` no se toca desde el portal.
- Se elimina toda superficie de descarga: sin endpoints de archivo, sin URLs firmadas, sin adjuntos servidos al cliente. Es también la superficie de ataque más barata de no tener.
- El cliente que necesite su comprobante formal lo pide por ticket y se lo entrega el operador desde el ERP.
- **Excepción a revisar contigo si algún día facturan electrónicamente con SUNAT**: la entrega del CPE al adquirente puede ser una obligación legal, no una opción de producto. Hoy queda fuera de alcance.

### 3.3 Mi WiFi (§6)

### 3.4 Dispositivos conectados

Tabla desde `OnuHost[]`: nombre, IP, MAC, tipo (inferido del hostname/OUI), estado activo/inactivo.
**Solo lectura.** Nada de bloquear ni renombrar desde el portal: bloquear un dispositivo por error es un corte que el cliente no sabe deshacer, y el soporte no tendría trazabilidad.

### 3.5 Soporte (tickets) — HABILITADO

- Crear ticket: categoría (subconjunto seguro del enum: `sin_internet`, `lentitud`, `intermitencia`, `equipo_danado`, `facturacion`, `cambio_datos`, `otro`), descripción, adjunto opcional.
- `abierto_por_portal = true`. Prioridad **la asigna el ERP**, no el cliente (si no, todo llega "crítico").
- Ver historial, estado, y calificar al cerrarse (`calificacion_cliente` ya existe).
- Anti-spam: máximo 3 tickets abiertos simultáneos por contrato.

### 3.6 Cambio de plan — propuesta

**No es autoservicio: es una solicitud.** Un cambio de plan toca cola/queue en MikroTik, precio del contrato, prorrateo de la factura en curso y, si sube de velocidad, puede exigir revisión del perfil de la ONU. Aplicarlo automáticamente desde un clic del cliente es exactamente el patrón que este repo prohíbe (mutación de hardware disparada por un actor sin contexto).

Flujo propuesto:

1. **Catálogo**: el portal lista los planes con `visible_en_portal = true` de la empresa (campo que **ya existe**; se administra desde la UI interna de Planes — cumple tu requisito sin schema nuevo). Muestra nombre, velocidad, `descripcion`, precio. Marca el plan actual.
2. El cliente pulsa **Solicitar cambio** → confirmación con el impacto: precio nuevo, desde cuándo aplica (siguiente ciclo de facturación), y que requiere aprobación.
3. Se crea una **solicitud** (tabla nueva `portal_solicitudes_plan`: contrato, plan origen, plan destino, estado `pendiente|aprobada|rechazada|aplicada`, motivo, auditoría) — **no se toca el contrato ni la red**.
4. Aparece en la bandeja del operador en el ERP. Al aprobar, el operador ejecuta el cambio de plan **por el flujo de negocio existente**, nunca por SQL (directriz vigente).
5. El portal muestra el estado de su solicitud y bloquea solicitudes nuevas mientras haya una pendiente.

**Regla de bajada de plan con deuda pendiente (decidida):** solo se permite si `contrato.tipo_pago = 'prepago'`.

Fundamento: en prepago el cliente ya pagó el período en curso — bajar de plan no deja saldo impago detrás, y la deuda visible corresponde al período siguiente aún no comprado. En postpago la deuda es servicio ya consumido al precio del plan actual; permitir bajar antes de pagarla convertiría el portal en un mecanismo de descuento retroactivo unilateral.

| `tipo_pago` | Deuda | Solicitud de **bajada** | Solicitud de **subida** |
|---|---|---|---|
| `prepago` | cualquiera | permitida | permitida |
| `postpago` | `deuda_total = 0` | permitida | permitida |
| `postpago` | `deuda_total > 0` | **bloqueada** | bloqueada |

- La comparación subida/bajada se hace por `plan.precio` del plan destino frente al vigente del contrato, no por velocidad: es el precio lo que determina el impacto económico.
- El guard vive **en el backend** (`POST /portal/planes/solicitud`), no solo en la UI. El portal deshabilita el botón y explica el motivo ("Para cambiar de plan primero regulariza tu deuda de S/ X"), pero un cliente que llame la API directamente recibe el mismo rechazo.
- Rechazo = `rechazado_definitivo` con motivo de dominio, no un 400 genérico: el operador debe poder ver en auditoría por qué se rechazó.
- `tipo_pago` es **nullable** en el contrato. Un contrato sin `tipo_pago` definido se trata como `postpago` (criterio conservador): ante la duda, el camino que no regala servicio.

---

## 4. Consumo — acumulado mensual y por días

Alcance acordado: **maqueta ahora, colector después.** Pero la maqueta se construye contra el contrato de datos definitivo, para que cablearla sea cambiar el origen y nada más.

- **Contrato de API** (definitivo desde el día 1):
  `GET /portal/consumo/:contratoId?desde=YYYY-MM-DD&hasta=YYYY-MM-DD`
  → `{ periodo, totalRxBytes, totalTxBytes, dias: [{ fecha, rxBytes, txBytes }], fuente: 'medido'|'no_disponible' }`
- **Sin cuota/FUP**: los planes son ilimitados, así que la vista es **informativa**, no un medidor con tope. Barras diarias (recharts, ya está en el proyecto) + totales de bajada/subida del mes. Nada de porcentajes ni "te queda X".
- **`fuente: 'no_disponible'`** es un estado de primera clase, no un error: mientras no exista colector, la sección muestra "Aún no hay datos de consumo para este servicio" en vez de gráficas falsas. **La maqueta con datos inventados vive solo en desarrollo (`NEXT_PUBLIC_PORTAL_MOCK=1`), nunca en producción** — un cliente no puede ver GB que nadie midió.
- **Colector futuro** (fase aparte, no en esta): cron que lee contadores de la cola/PPPoE en MikroTik (`queue.service`/`pppoe.service` ya existen) y escribe agregado horario en `consumo_datos`. Requiere manejar reinicio de contadores del router (delta negativo = reset, no consumo negativo) y ser idempotente por `(contrato, fecha, hora)`.

---

## 5. Pagos — maqueta

Sección de pago construida completa en UI (botón flotante, resumen de deuda, selección de facturas) con la integración **stubbeada**: al confirmar muestra "Pagos en línea estarán disponibles próximamente" y ofrece los medios actuales. El contrato de API queda definido (`POST /portal/pagos/intencion` → `{ urlPasarela }`) para enchufar MercadoPago/Yape/Izipay sin rehacer la vista.

---

## 6. Mi WiFi — el punto delicado

Solo aplica a contratos **FTTH con ONU gestionable**. Para cualquier otro (`tipo_servicio` inalámbrico, router propio, CPE no TR-069) la sección se muestra **no disponible con explicación**, nunca vacía ni rota.

### 6.1 "Conectar router" — apertura del carril TR-069 desde el portal

El carril está cerrado por defecto. Estados que ve el cliente:

```
cerrado ──[Conectar router]──> conectando ──> conectado ──> (inactividad TTL) ──> cerrado
                                    │
                                    └──> error (mensaje + reintentar)
```

- Botón **Conectar router** → `POST /portal/onu/:contratoId/conectar`, que internamente llama a `activarCarril` (mismo servicio que usa el operador, sin duplicar lógica).
- **Es asíncrono.** Activar el carril toca la OLT y toma el `FtthOperacionLockService`. El portal encola, devuelve `202` con un `jobId` y hace polling cada 3 s hasta `conectado` o `error`, con una barra de progreso honesta ("Conectando con tu router… puede tomar hasta 2 minutos"). Nunca un spinner infinito.
- **Mientras la sección está abierta, se llama a `marcarUsoTr069` con heartbeat** (cada 60 s) para que el barrido por inactividad no cierre el carril debajo del cliente. El heartbeat **suprime el barrido, no autoriza nada**, y tiene techo absoluto — regla vigente de wizards.
- Al salir de la sección **no se desactiva el carril**: desactivarlo es otra operación contra la OLT y el cliente puede volver en 2 minutos. Lo cierra el barrido por TTL, que es la autoridad del servidor.

**Peor escenario evaluado — protecciones obligatorias:**

| Riesgo | Mitigación |
|---|---|
| N clientes pulsan "Conectar" a la vez → el MA5800 tiene **límite bajo de sesiones VTY** | Cola serializada por OLT con concurrencia máxima (2-3) y espera visible al cliente. Sin esto, el portal es un DoS contra la OLT hecho por clientes legítimos. |
| Cliente martillea el botón | Rate limit: 1 activación / 10 min por contrato; reintentos idempotentes (si ya está conectado → `ya_en_destino`, éxito). |
| Cliente suspendido/cortado | Puede **leer** su WiFi si el carril responde, pero **no escribir**. Escribir sobre un servicio cortado genera falsas expectativas y trabajo contra hardware que no debería mutarse. |
| Activación en vuelo + operación del operador sobre el mismo contrato | Ya cubierto por `FtthOperacionLockService` → 409 = **reintentable**, jamás veredicto definitivo. |

### 6.2 Lectura de SSID reales (requisito explícito)

Los campos SSID **deben mostrar el nombre actual de las redes del router**, no un placeholder. `getDetalle` sirve del último inform de GenieACS, que puede estar rancio.

**Regla:** al abrir la sección se hace `refresh(serial)` (lectura viva contra el CPE) antes de pintar. Si el refresh no converge, se muestran los valores conocidos **etiquetados con su antigüedad** ("última lectura hace 2 h") y los campos de edición quedan deshabilitados. Un formulario editable sobre datos rancios escribe encima de una configuración que el operador no está viendo.

### 6.3 Edición

- Dos bandas independientes (2.4 GHz y 5 GHz), cada una con SSID + clave y su propio botón Guardar.
- Validaciones (cliente **y** servidor, la del cliente es cosmética):
  - SSID: 1-32 caracteres, sin caracteres de control, sin `?"$[\]+` iniciales; se advierte si ambas bandas quedan con el mismo nombre.
  - Clave: **mínimo 8 caracteres** (requisito WPA2), máximo 63; se rechazan claves triviales (`12345678`, `password`, el propio SSID).
  - Nunca se precarga la clave actual en claro en el input: se muestra enmascarada con opción "ver", y el campo vacío significa "no cambiar".
- **Confirmación explícita antes de guardar**: "Se desconectarán todos los dispositivos conectados a esta red. Deberás volver a conectarlos con la nueva clave."
- Rate limit: 3 cambios / día por contrato.
- **Toda escritura queda auditada** con actor = cliente (no operador), IP y valores anterior/nuevo (clave hasheada o redactada en el log, nunca en claro).

### 6.4 VIO al escribir — no se dice "guardado" sin verificar

`setWifi` encola un `setParameterValues` en GenieACS. Que se encole no es que se aplique.
Flujo obligatorio: escribir → releer el parámetro (3-4 intentos con backoff corto) → comparar con lo enviado.

| Resultado | Mensaje |
|---|---|
| Releído e igual | "Listo. Tu red ya usa el nombre/clave nuevos." |
| No confirmado en el tiempo acotado | "Enviamos el cambio a tu router, pero aún no lo confirmamos. Si en unos minutos tu red no cambia, contáctanos." + queda evento para revisión |
| Error del CPE | Mensaje de router no responde + Reintentar |

---

## 7. Diseño y responsive

- **Mobile-first**, sin negociación: el 90 % del tráfico de un portal de abonado es un teléfono de gama baja con datos móviles.
- Se **reutiliza el design system del ERP** (tokens Tailwind, dark mode, `useToast`) para no mantener dos sistemas, pero con **shell propio**: nada de sidebar de operador.
  - Móvil: header compacto (logo + selector de servicio + salir) + **nav inferior de 5 ítems**: Inicio · Facturas · WiFi · Soporte · Perfil. Botón de pago **flotante** sobre el nav.
  - ≥ 1024 px: la nav inferior pasa a lateral izquierda y el contenido se centra a `max-w-5xl`.
- **Branding por empresa** (logo y color primario desde `empresas`), porque el mismo binario sirve a varias instalaciones.
- Accesibilidad: contraste AA, targets ≥ 44 px, todo operable con teclado, textos de error asociados al campo.
- **Sin datos técnicos crudos**: nada de "ONT-44", "VLAN 1600", "service-port". El cliente ve "Tu router", "Tu red WiFi".

### 7.1 Referencia visual aprobada (captura del cliente)

Layout de escritorio confirmado por el usuario:

```
┌──────────────────────────────────────────────────────────────────────┐
│ [logo DATAFAST]                          🔔    (AC) NOMBRE TITULAR ▾ │  header blanco
├───────────────┬──────────────────────────────────────────────────────┤
│  (AC)         │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐         │
│  NOMBRE       │  │ DEUDA  │ │ TICKET │ │CONSUMO │ │ ESTADO │         │  fila de KPIs
│  TITULAR      │  │S/. 0.00│ │   0    │ │201.9 GB│ │ ACTIVO │         │
│               │  │ Ver →  │ │ Ver →  │ │        │ │ Ver →  │         │
│  Menú         │  └────────┘ └────────┘ └────────┘ └────────┘         │
│  · Inicio     │                                                       │
│  · …          │  (contenido de la sección)                            │
└───────────────┴──────────────────────────────────────────────────────┘
```

**Elementos a construir:**

- **Header blanco fijo**: logo de la empresa a la izquierda (branding por tenant), campana de notificaciones y menú de usuario con avatar de iniciales + nombre del titular a la derecha. El desplegable contiene Mis datos, Selector de servicio y Cerrar sesión.
- **Sidebar oscura** (≥1024 px) con el avatar y nombre repetidos arriba, encabezado "Menú" y la navegación. En móvil esta sidebar **no existe**: se reemplaza por la nav inferior de 5 ítems ya definida — no se convierte en hamburguesa, que esconde la navegación justo donde más se usa.
- **Fila de 4 tarjetas KPI** al tope del dashboard, cada una con etiqueta en mayúsculas, valor grande, icono en cuadro de color y enlace de acción abajo a la derecha. Grid `4 / 2 / 1` columnas en desktop / tablet / móvil.

**Mapeo de cada tarjeta a su fuente real** (ninguna es decorativa):

| Tarjeta | Valor | Fuente | Enlace |
|---|---|---|---|
| DEUDA ACTUAL | `S/ 0.00` | `contratos.deuda_total` del servicio seleccionado | → Facturación |
| TICKET SOPORTE | `0` + "Ticket abierto(s)" | conteo de tickets no cerrados del contrato | → Soporte |
| CONSUMO DEL MES | `201.9 GB ↓` | `GET /portal/consumo` (ver salvedad) | → Consumo |
| ESTADO | `ACTIVO` | `contratos.estado` (+ prórroga) | → Mis datos |

**Ajustes obligatorios sobre la referencia:**

1. **CONSUMO DEL MES no puede mostrar un número mientras no exista colector.** Es el único KPI sin fuente real hoy (§4). Con `fuente: 'no_disponible'` la tarjeta se renderiza en estado vacío ("Sin datos aún"), atenuada y sin enlace. Un `201.9 GB` inventado en producción es una cifra que el cliente puede reclamar y que nadie puede sustentar.
2. **La tarjeta ESTADO cambia de color según el valor** — verde `ACTIVO`, ámbar `EN PRÓRROGA`, rojo `SUSPENDIDO`/`CORTADO` — y **nunca solo por color**: el texto ya distingue, el color acompaña (accesibilidad AA, daltonismo).
3. **DEUDA ACTUAL en rojo si es > 0** y el botón flotante de pago aparece solo en ese caso.
4. Los iconos van dentro del cuadro de color como en la referencia, pero cada uno debe corresponder a su métrica (hoy en la captura el icono de ESTADO es un bocadillo de chat y el de CONSUMO un archivador — no comunican nada).
5. El nombre del titular se muestra tal como está en el ERP; si es largo, se trunca con `title` completo en hover, no se parte en dos líneas dentro del header.
6. La sidebar debe mostrar **el servicio seleccionado** bajo el nombre cuando el cliente tiene más de un contrato — si no, en la captura no hay forma de saber a cuál servicio corresponden los KPIs.

---

## 8. Superficie de API del portal

Prefijo único `/api/v1/portal/*` (encaja con el allowlist ya existente en nginx).

```
POST   /portal/auth/login              { usuario, password } → tokens + perfil
POST   /portal/auth/refresh
POST   /portal/auth/logout
GET    /portal/me                      → titular, documento, whatsapp, contratos[]
GET    /portal/contratos/:id           → plan, estado, direccion, fechas pago/corte, deuda
GET    /portal/facturas/:contratoId    → listado + estado de cuenta (sin PDF, sin descargas)
POST   /portal/pagos/intencion         → (maqueta) { urlPasarela }
GET    /portal/consumo/:contratoId     → mensual + diario
GET    /portal/onu/:contratoId/estado  → carril: cerrado|conectando|conectado|error
POST   /portal/onu/:contratoId/conectar        → 202 { jobId }
POST   /portal/onu/:contratoId/heartbeat       → 204
GET    /portal/onu/:contratoId/wifi            → bandas con SSID reales (refresh VIO)
PUT    /portal/onu/:contratoId/wifi/:banda     → { ssid?, password? } (VIO al escribir)
GET    /portal/onu/:contratoId/dispositivos    → hosts LAN
GET    /portal/tickets  |  POST /portal/tickets  |  POST /portal/tickets/:id/calificar
GET    /portal/planes                  → visible_en_portal = true
POST   /portal/planes/solicitud        → solicitud de cambio (no aplica nada)
```

Todos bajo `PortalJwtGuard` salvo `login`. Todos validan pertenencia del recurso al `sub` del token.

---

## 9. Módulo degradable

`PortalModule` **no** es Core Indestructible en su parte de red: WiFi, dispositivos y consumo dependen de GenieACS/OLT/MikroTik.
La degradación es **por sección, no por módulo**: autenticación, perfil, servicios, facturación, soporte y planes solo dependen de la BD principal y no pueden caerse por hardware. El portal nunca cae entero porque un ACS esté caído.

Dos servicios publican su salud en `GET /health/modules` (`implements OnModuleInit`, probe ligero, sin relanzar nunca):

| Módulo | `ok` | `degraded` |
|---|---|---|
| `portal-red` | GenieACS configurado | `GENIEACS_NBI_URL` vacío → Mi WiFi y Dispositivos no disponibles; el resto del portal funciona |
| `portal-consumo` | colector activo | `CONSUMO_COLECTOR_ENABLED=false` → el portal declara el consumo como "sin datos" |

**El colector apagado se publica como `degraded` a propósito**, aunque sea una decisión deliberada: no es una avería, pero **es** la explicación del "Sin datos" que ve el abonado. Sin ese registro, el síntoma se diagnostica como un bug del portal.

`portal-red` sondea **configuración, no liveness**: `isReady()` mira si el NBI está configurado, y eso no cambia en caliente. La salud del ACS vivo la publica el módulo `tr069`, que sí lo sondea — duplicar ese sondeo aquí sería un segundo poller contra GenieACS que puede contradecir al primero.

---

## 9.bis Configuración del portal desde el ERP (`/configuracion/portal-cliente`)

La página ya existe como placeholder y pasa a ser el panel de administración del portal. Referencia aprobada: pantalla equivalente de MikroWISP (pestañas General / Reporte pago / Banners / Diseño).

### Modelo

Tabla nueva `portal_config`, **una fila por empresa** (`UNIQUE (empresa_id)`), leída por el portal y editada solo desde el ERP. Nunca se lee de código hardcodeado.

### Pestaña General

| Campo | Notas |
|---|---|
| URL Portal | `https://cliente.datafastperu.com` — se usa en los avisos que se envían al cliente (WhatsApp). Ver conflicto abajo. |
| Título del portal | Ej. "Acceso Cliente". Va en `<title>` y en el header. |
| URL test de velocidad | Ej. `https://fast.com/es/`. Se abre en pestaña nueva con `rel="noopener noreferrer"`. Validar que sea `https` y host permitido. |
| Título del menú personalizado | Ej. "Lugares de Pagos" |
| Contenido del menú personalizado | HTML/texto libre → **se sanitiza en el servidor** antes de guardar y se renderiza sin `dangerouslySetInnerHTML` crudo. Un campo HTML libre que se pinta a todos los clientes es XSS almacenado servido a todo el parque. |

**Conflicto URL Portal ↔ `PORTAL_DOMAIN` (resolución):** el dominio que **sirve** el portal es infraestructura (nginx `server_name` + certificado TLS) y vive en `PORTAL_DOMAIN` del `.env` — un campo de BD no puede reconfigurar nginx. El campo de esta pantalla es la **URL pública canónica para los avisos**. Se guardan ambos, y el panel **valida que coincidan**: si el host de la URL configurada ≠ `PORTAL_DOMAIN`, muestra advertencia visible. Si no, el ERP enviaría por WhatsApp un enlace que no resuelve — y nadie se enteraría hasta que un cliente lo reportara.

### Pestaña Opciones (toggles)

Todos los toggles son **feature flags reales**: apagar uno **quita también el endpoint**, no solo el ítem del menú. Ocultar el botón y dejar la API viva no es una opción — el `PortalJwtGuard` consulta la config de la empresa y responde 404 en la sección deshabilitada.

| Toggle | Decisión |
|---|---|
| Mis comprobantes | Sí — vista en pantalla, sin descarga (§3.2) |
| Soporte técnico | Sí (§3.5) |
| Informar pago | Sí — el cliente reporta un pago hecho por transferencia/Yape; entra a la bandeja del operador para conciliar. Encaja con "pagos como maqueta": es la vía real mientras no haya pasarela. |
| Test de velocidad | Sí — enlace externo, sin integración |
| Tráfico actual / estadísticas de tráfico | **Se muestran deshabilitados con nota "requiere colector de consumo"** hasta la Fase 6. Coherente con §4. |
| Notificaciones | Sí — avisos publicados desde el ERP |
| Banner de publicidad | Sí (pestaña Banners) |
| Menú personalizado | Sí (con sanitización) |
| Permitir actualizar datos | **No en Fase 1.** Que el cliente edite su propio nombre/DNI/dirección altera datos de facturación y de instalación. Va por ticket `cambio_datos` (§2). Reevaluable como "solicitud de actualización" con aprobación del operador. |
| Permitir cambiar contraseña | **No.** Contradice la decisión de negocio ya tomada: el cliente no cambia su clave; la administra el operador desde Detalle del Cliente. El toggle no se implementa, para que no exista la posibilidad de encenderlo por error. |
| **Permitir Autologin** | **No se implementa.** En MikroWISP autentica al cliente por su IP de red — cualquiera dentro de la misma LAN (o tras CGNAT, cualquiera que comparta la IP pública) entra a la cuenta ajena sin credenciales, con acceso a su deuda, sus datos personales y el control de su WiFi. Su propia advertencia ("solo compatible con servidores locales y una red sin doble NAT") describe exactamente la fragilidad. No hay versión segura de esto y no entra al alcance. |

### Pestañas restantes

- **Reporte pago**: destinatarios y plantilla del aviso cuando un cliente informa un pago; medios de pago que se muestran (cuentas bancarias, Yape/Plin) — hoy es el sustituto de la pasarela.
- **Banners**: imágenes promocionales con vigencia (desde/hasta) y orden. Validar tipo MIME y tamaño; servir desde el propio backend, no hotlink externo.
- **Diseño**: logo, color primario y tema del portal por empresa (alimenta el branding de §7).

### Regla transversal

La configuración se **cachea en el backend** con invalidación al guardar. El portal la consulta en un único `GET /portal/config` público-por-tenant (resuelto por Host), sin exponer nada sensible: solo lo que ya es visible en pantalla.

---

## 10. Fases de implementación

| Fase | Contenido | Bloqueantes |
|---|---|---|
| **0** ✅ | Migración de índice único `usuario_portal` + parametrizar `APP_DOMAIN`/`PORTAL_DOMAIN` en nginx/env | Hecha — ver §12 |
| **0.5** ✅ | `portal_config` (tabla + módulo) y panel `/configuracion/portal-cliente`: General, Opciones, Reporte pago, Banners, Diseño | Fase 0 — el portal lee su branding y sus flags de aquí |
| **1** ✅ | Shell del portal: route group `(portal)`, middleware por Host, login, `/me`, selector de contrato, perfil del titular | Fase 0 |
| **2** ✅ | Dashboard + Facturación + botón de pago (maqueta) | Fase 1 |
| **3** ✅ | Mi WiFi: conectar router, lectura de SSID reales, edición con VIO, dispositivos conectados | Fase 1; ONU física para validar |
| **4** ✅ | Consumo (vista + estado `no_disponible`) y Soporte/tickets | Fase 1 |
| **5** ✅ | Catálogo de planes + solicitud de cambio + bandeja en el ERP | Fase 1 |
| **6** ✅ | Colector de consumo real desde MikroTik | Hecha — apagada por defecto (`CONSUMO_COLECTOR_ENABLED`) |
| **7** | Pasarela de pago real | **Fuera de alcance por decisión de negocio**: los pagos quedan como maqueta hasta nuevo aviso |

---

## 11. Pendientes de confirmación

Todas las preguntas de estructuración están resueltas. Quedan estos supuestos fijados por criterio, revocables:

1. ~~Bajada de plan con deuda pendiente~~ — **resuelto**: permitida solo en `prepago` (§3.6).
2. ~~Documentos descargables~~ — **resuelto**: ninguno (§3.2).
3. ~~Datos del titular~~ — **resuelto**: nombre completo, DNI, dirección, teléfono, plan y `precio_final` (§2).
4. **Notificaciones push de la PWA: fuera de alcance por ahora** (supuesto). El aviso de vencimiento y corte sigue por WhatsApp, que es el canal que el cliente ya lee y el que el ERP ya opera (`mensajeria`). Añadir push implicaría gestionar suscripciones, claves VAPID y un segundo canal que puede contradecir al primero. Se reevalúa cuando el portal tenga uso real.

---

## 12. Fase 0 — ejecutada

**Migración `1791800000022-UniqueUsuarioPortalCliente`**
Índice único parcial `(empresa_id, lower(usuario_portal))` sobre no borrados. Normaliza espacios, convierte `''` a NULL y resuelve duplicados preexistentes de forma determinista (conserva el cliente con contratos vigentes; a igualdad, el más antiguo), anulando solo `usuario_portal` de los perdedores y dejando constancia en `eventos_sistema` con código `PORTAL_USUARIO_DUPLICADO`. No destruye `password_portal`. Nadie pierde acceso: el portal aún no existe.

**Dominios parametrizados**
`nginx/conf.d/*.conf` → `nginx/templates/*.conf.template`, resueltos por el entrypoint oficial de nginx con `envsubst`. `conf.d` deja de montarse (debe ser escribible para recibir el render). `NGINX_ENVSUBST_FILTER=^(APP_DOMAIN|PORTAL_DOMAIN)$` acota la sustitución para no tocar las variables propias de nginx. Nuevas vars en `.env.example`: `APP_DOMAIN`, `PORTAL_DOMAIN`.

**Defecto corregido de paso**: `ssl-setup.sh` derivaba el dominio del portal de `FRONTEND_URL`, que en `.env.example` apunta al mismo host que `APP_URL` — pedía dos veces el certificado del panel y ninguno para el portal, sin fallar. Ahora usa `PORTAL_DOMAIN` y aborta si falta o si coincide con `APP_DOMAIN`.

### Verificación

- `tsc --noEmit` del backend: sin errores.
- Plantillas renderizadas con `envsubst`: cero placeholders sin resolver, dominios correctos, y las 36 referencias a variables de nginx (`$host`, `$scheme`, `$remote_addr`…) intactas.
- **No ejecutado**: `nginx -t` sobre el render — no hay docker ni nginx en el entorno local. Debe correrse en el VPS antes de recargar.
- **No ejecutada**: la migración contra producción. Pendiente de decisión del operador.

### Deuda detectada, NO corregida aquí

1. **`/etc/nginx/ssl/` no se monta en `docker-compose.yml`.** Ambos vhosts referencian `/etc/nginx/ssl/live/<dominio>/…` pero el único volumen de certificados es `certbot-conf:/etc/letsencrypt`. En la ruta docker, nginx no encontraría los certificados. Es preexistente y no se tocó porque producción **no corre nginx por docker**: usa PM2 + nginx nativo generado por `installer/scripts/05-nginx.sh`. Corregirlo a ciegas podía romper la ruta que sí funciona.
2. ~~El instalador real no tiene vhost del portal~~ — **resuelto**. `05-nginx.sh` genera `datafast-portal` cuando existe `DOMINIO_PORTAL`; ver §13.

---

## 13. Despliegue del portal en el instalador real

Producción no usa la ruta docker: corre PM2 + nginx nativo generado por `installer/scripts/`. El portal se publica ahí.

### Variable que lo gobierna: `DOMINIO_PORTAL`

Sin ella **no se publica nada** y el ERP se comporta exactamente igual que antes. No hay fallback a la IP: servir el portal en el mismo host que el panel anularía el aislamiento de cookies, CSP y rate-limit que justifica el subdominio.

| Script | Qué hace con `DOMINIO_PORTAL` |
|---|---|
| `12-finish.sh` | La declara y exporta; genera `PORTAL_JWT_SECRET` con `openssl rand -hex 64` y lo guarda en `config/secrets.conf` |
| `05-nginx.sh` | Genera y enlaza el vhost `datafast-portal`. Si la variable está vacía, **retira** el enlace (una reinstalación sin portal no deja un vhost huérfano sirviendo un dominio que ya nadie administra) |
| `06-ssl.sh` | Añade el subdominio al **mismo** certificado de Certbot. Pedirlo aparte multiplicaría renovaciones y dejaría el portal sin HTTPS si una fallara en silencio |
| `07-app.sh` | Escribe `PORTAL_DOMAIN` en el `.env.production` de **backend y frontend**, más `PORTAL_JWT_SECRET` y `CONSUMO_COLECTOR_ENABLED=false` |

### El vhost

- **Allowlist de API en el borde**: solo `/api/v1/portal/*`. Cualquier otra ruta bajo `/api/` devuelve **404**. El backend ya lo protege por audiencia de token, pero un dominio público que enruta a `/api/v1/clientes` es superficie que no tiene por qué existir.
- `/api/v1/portal/auth/` tiene su propia zona (`portal_auth`, 10 r/m): ahí un usuario es un DNI adivinable. El resto del portal usa `portal` (120 r/m), más holgada que la del panel porque los abonados llegan desde CGNAT móvil compartiendo IP.
- **Sin WebSocket**: el portal no usa `socket.io`. Exponerlo abriría un canal que nadie consume y que el guard del portal ni siquiera cubre.
- `client_max_body_size 2M` — el abonado no sube archivos.
- `X-Robots-Tag: noindex, nofollow`: zona privada.
- `proxy_set_header Host $host` **no es cosmético**: el portal comparte proceso Next con el ERP (puerto 3000) y el middleware separa por `Host`. Sin esa cabecera, el portal no existe.

### Verificado

- `bash -n` sobre los 4 scripts modificados: sintaxis correcta.
- Vhost renderizado con `DOMINIO_PORTAL=cliente.datafastperu.com`: dominio sustituido, las variables de nginx (`$host`, `$remote_addr`, `$request_uri`) intactas, llaves balanceadas (10/10), y el `return 404` de la allowlist presente.
- **`PORTAL_DOMAIN` se lee en RUNTIME, no se inlinea en build.** Comprobado construyendo el frontend con un valor de prueba: el literal no aparece en `.next/server/src/middleware.js`, y sí `process.env.PORTAL_DOMAIN`. Consecuencia práctica: en el VPS actual basta añadir la variable al `.env.production` y reiniciar PM2 — **no hace falta recompilar el frontend**.
- **No ejecutado**: `nginx -t` sobre el vhost final. No hay nginx en el entorno local. El propio instalador lo corre antes de recargar y avisa si falla.

### Para el VPS que ya está instalado

El instalador cubre instalaciones nuevas. En el servidor existente hay que hacerlo a mano, una vez:

1. `DOMINIO_PORTAL` + `PORTAL_JWT_SECRET` (`openssl rand -hex 64`, **distinto** de `JWT_SECRET`) en `backend/.env.production`; `PORTAL_DOMAIN` en `frontend/.env.production`.
2. Apuntar el DNS del subdominio al VPS.
3. Correr `setup_nginx` (o copiar el vhost que genera) y `certbot --nginx -d <portal>` para sumarlo al certificado.
4. `pm2 reload datafast-api-core datafast-worker-auxiliary datafast-frontend --update-env`.
