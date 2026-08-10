# Pendientes y deuda técnica — ErpDatafast

> Registro vivo de lo que queda por hacer. **Cualquier sesión debe leer este archivo cuando
> se pregunte "¿qué pendientes hay?"**, y añadir aquí lo nuevo que quede abierto en vez de
> dejarlo solo en el mensaje de una conversación que nadie volverá a leer.
>
> Formato de cada entrada: qué falta, **por qué importa** (la consecuencia real, no la
> tarea) y cómo se comprueba. Una entrada sin consecuencia acaba siendo ignorada.
>
> Última actualización: 2026-08-08

---

## 🔴 Abierto — impacto en producción

### 0. Despliegue: el backend estuvo 11 h ejecutando código viejo (RESUELTO, pero leer)
**Estado:** corregido el 2026-08-06. Se documenta porque la clase de fallo se repitió tres
veces en el mismo día y conviene reconocerla.

`scripts/update.sh` recargaba `--only datafast-backend`, un nombre de proceso que ya no existe
(hoy: `datafast-api-core` y `datafast-worker-auxiliary`). PM2 no encontraba nada, no
fallaba de forma detectable, y el script imprimía «Backend recargado» igual. **Las
migraciones sí corrían** —son un paso aparte—, así que la base de datos avanzaba y el
código no: el esquema decía una cosa y el proceso vivo entendía otra.

Se descubrió porque una pantalla nueva devolvía 400 «uuid expected»: sus rutas no existían
en el proceso en ejecución y caían en `GET /pagos/:id`. El síntoma parecía de la pantalla;
la causa estaba en el despliegue.

Y escondía un segundo defecto: `idempotencyKey` sin `type` explícito tumbaba el arranque
(el error de SWC ya conocido). Como el backend no reiniciaba nunca, el bug vivía en el
código desplegado sin que nadie pudiera verlo. Salió en el primer reinicio real, con todo
el ERP en 500.

**El patrón, tres veces el mismo día:** una verificación que solo sabe confirmar el caso
bueno no es una verificación. El deploy afirmaba éxito sin comprobarlo; la primera
corrección miró solo el uptime, y un proceso en bucle de reinicio también tiene uptime
bajo — de hecho el bucle lo provocó esa misma corrección, al usar `--update-env` sobre el
nombre suelto en vez del ecosystem (el worker perdió su `PORT: 4001` y chocó con la API).

Hoy el script comprueba tres cosas y **aborta** si fallan: proceso online, uptime de
segundos, y contador de reinicios subiendo exactamente 1.

**Qué mirar si vuelve a pasar algo raro tras un deploy:**

```bash
pm2 list                                      # ¿el uptime del backend bajó de verdad?
pm2 logs datafast-api-core --err --lines 50   # ¿arrancó o está en bucle?
```

### 1. Gateway de mensajería: NINGÚN mensaje sale
**Estado:** pendiente por decisión del usuario (2026-08-06).

`notificaciones_logs` tiene **480 de 480 registros en `NO_ENVIADO`**. Entre ellos, 14 avisos
de servicio suspendido, 35 de bienvenida y 237 de emisor caído. El ERP cree que informa a
los abonados y no informa a nadie.

Deja inútil todo el bloque de notificaciones por cliente cableado el 05/08 (aviso de
factura nueva y los tres recordatorios de pago): se encolan y mueren igual.

```sql
SELECT estado_entrega, COUNT(*) FROM notificaciones_logs GROUP BY 1;
```

**Ojo al arreglarlo:** el gateway soporta WhatsApp (varios proveedores) y SMTP. **No existe
proveedor de SMS**, así que las opciones 'sms' y 'ambos' de la pantalla de configuración
funcionan hoy como un simple interruptor de encendido.

---

## 🟡 Abierto — funciones que faltan

### 2-bis. Cobranza Etapa II — pasarelas de pago (PENDIENTE A PROPÓSITO)
**Estado:** diseñada y contratada, **no construida**. Bloqueada por una puerta de
estabilidad, no por falta de tiempo (2026-08-06).

**⛔ Antes de escribir una sola línea, leer en este orden:**

1. [`docs/cobranza-plan-implementacion.md`](docs/cobranza-plan-implementacion.md) §"⛔ ETAPA II"
2. [`backend/src/modules/pagos/adaptadores/README.md`](backend/src/modules/pagos/adaptadores/README.md)
3. `adaptador-cobro.interface.ts` — **el contrato ya existe y tiene tests. No se reinventa.**

La Etapa I (registro de pagos) está completa y en producción: tres ejes forma/canal/cuenta
receptora, un solo escritor del saldo de una factura, extorno atómico, arqueo de caja y
clave de idempotencia por request.

**Por qué importa que no se adelante:** faltan tres criterios que **no dependen de escribir
código**, sino de que el ERP cobre dinero real unas semanas —30 días de invariante contable
limpio (arrancó el 06/08, cierra ~05/09/2026), un extorno real revisado a mano y un cierre
de caja mensual cuadrado—. Integrar proveedores sobre una frontera no demostrada se descubre
con dinero de clientes en juego, y cada proveedor apilado multiplica el coste de corregirlo.

**Orden correcto cuando la puerta se abra:** F8 (motor + `cobro_intento` + conciliador) →
F9 (MercadoPago migrado al contrato; es el único con dinero real, y si la abstracción no lo
absorbe se corrige con uno y no con tres) → F10 (nuevos proveedores) → F11 (POS/QR).

**Lo que NO hay que hacer** —las tres ya salieron mal en este repo y hay tests que las
bloquean—: crear un servicio de registro de pagos paralelo, aplicar dinero desde un
adaptador o un webhook, e inferir reintentabilidad desde un código HTTP.

```sql
-- Criterio 1 de la puerta: debe dar 0 todos los días hasta el 05/09.
SELECT COUNT(*) FROM (
  SELECT f.id FROM facturas f JOIN pago_aplicaciones pa ON pa.factura_id = f.id
   WHERE f.deleted_at IS NULL GROUP BY f.id, f.monto_pagado
  HAVING ABS(f.monto_pagado::numeric - SUM(pa.monto_aplicado)::numeric) > 0.01) x;
```

**Tarea de negocio previa, sin código:** cargar las cuentas bancarias reales (número, CCI,
titular) en Finanzas → Ajustes de Cobranza. La migración sembró las cajas pero no inventó
cuentas de banco — eso es dato del negocio, y sin él los canales de transferencia no tienen
cuenta que sugerir.

### 2. Campos de configuración del cliente que no hacen nada
**Estado:** pendiente por decisión del usuario (2026-08-05).

En *Cliente → Facturación → Configuración* se guardan y no los lee nadie:

| Campo | Qué haría falta |
|---|---|
| `aplicarMora` + `montoMora` | Generar el cargo al vencer sin pago (existe `cargos_pendientes` y `registrarCargoPendiente`; falta el disparador) |
| `aplicarReconexion` + `montoReconexion` | Generar el cargo al reactivar un servicio cortado |
| `esquemaImpuesto` | Definir antes cómo convive con la regla vigente: el IGV lo decide la carga fiscal del comprobante |
| `impuesto1` (%) | Sumarlo al total del comprobante |
| `avisoPantalla` | Portal cautivo — **no existe la infraestructura**; es el más caro de los cinco |

Un campo que se guarda y no hace nada es peor que no tenerlo: el operador cree haberlo
configurado. Si alguno no se va a implementar, la alternativa honesta es retirarlo de la
pantalla.

### 3. Comprobante fiscal del anticipo
**Estado:** cerrado por el usuario — *"lo trabajaremos internamente, así está bien"*.

El adelanto se registra como movimiento de caja con su recibo imprimible. Si SUNAT
llegara a exigir un documento de anticipo con serie y correlativo propios, es un trabajo
aparte que toca la numeración fiscal.

---

## 🟠 Deuda técnica

### 5. Tests que faltan
- Vista unificada del Log: validada a mano contra la base real, sin test que lo fije.
- La emisión diaria por ciclo de cliente tiene tests de la política de fechas
  (`politica-facturacion.service.spec.ts`, 11 casos) pero no de la selección de a quién se
  emite cada día. **Justo ahí estuvo el fallo del 06/08**, que no lo detectó ningún test
  sino una verificación manual contra producción.

### 6. Colisión de timestamps en migraciones
`FnSnOnuNormalizado1791800000035` y `CreatePagoAplicaciones1791800000035` comparten
timestamp. En producción no causó daño —son independientes y ambas se aplicaron—, pero en
una instalación nueva el orden entre ellas es indeterminado. Con migraciones dependientes
rompería.

### 7. Descripciones antiguas de pagos
Los registros anteriores al 05/08 dicen `factura: undefined`. Corregido para los nuevos.
**No se reescriben**: la auditoría no se toca.

### 8. `AuditLog.id` cambió de `number` a `string`
Por el UNION de la vista unificada. Se ajustó `AuditoriaTab`, pero no se auditó si algún
otro consumidor asume numérico.

---

## 🔵 A vigilar (no es un fallo, es un cambio sin ejercitar)

### 9. Primera emisión automática con el ciclo por cliente
**El cambio más arriesgado del 05/08.** La facturación pasó de dispararse una vez al mes
por empresa a correr **todos los días** evaluando el ciclo de cada abonado
(`diaPago − crearFactura`). Un fallo aquí no afecta a un cliente: afecta a todo el parque
a la vez y de madrugada.

**Verificación en seco hecha el 06/08** — y encontró un fallo que ya estaba tumbando la
generación (ver "Cerrado"). Tras corregirlo, el próximo ciclo queda así:

| Abonado | Se emite | Vence | Corte | Periodo (prepago) |
|---|---|---|---|---|
| James Pena / Piero Escobar | 23/08 | 28/08 | 04/09 | septiembre |

Sigue sin ejercitarse la emisión REAL: la del 23/08 es la primera. Conviene mirar los logs
del worker esa madrugada.

### 10. "Solo registrar" no tiene red de seguridad
Cobra sin reactivar el servicio (baja voluntaria que salda su último comprobante). Si se
usa por error, **el abonado queda sin servicio hasta que una persona lo note**: ningún
watcher lo levanta ni avisa. Queda en auditoría con la marca `SIN reactivar servicio`.

---

---

## 🔒 Esperando una decisión tuya — no las puede tomar el arquitecto

### 20. B-15 — la aplicación se conecta a PostgreSQL como SUPERUSUARIO
**Por qué importa:** `datafast_db_user` tiene `rolsuper` y `rolbypassrls`, y es dueña de las
111 tablas. Cualquier inyección SQL que alcance el motor lo hace con permisos totales:
`DROP`, lectura de `pg_authid`, `COPY … TO PROGRAM` (ejecución de comandos en el servidor).
No se encontró ninguna vía de inyección explotable —el SQL está parametrizado de forma
consistente—, así que es defensa en profundidad, no una puerta abierta.

**Ya está preparado, falta aplicarlo.** El `GRANT` mínimo está validado contra la base real
(11 de 11 operaciones del ERP funcionan, 4 de 4 peligrosas quedan bloqueadas) y se eliminó el
último DDL en tiempo de ejecución, que habría roto el alta de clientes. **ADR-017 §8.**

**Por qué no lo aplico solo:** el modo de fallo es que al ERP le falte un permiso *en
producción*. Falta además el rol de migración (api-core migra al arrancar, ADR-010) y probarlo
sobre una instalación limpia.

**Cómo se comprueba:** con el rol nuevo, una consulta `CREATE TABLE` debe fallar y las 11
operaciones de la batería deben pasar.

**DECISIÓN TOMADA 2026-08-08: esperar a la instalación limpia.** No se toca el servidor que
da servicio. Se hará **A y B de una vez** allí:

- **A** — un solo rol sin `SUPERUSER` ni `BYPASSRLS`, pero con DDL. Quita casi todo el riesgo
  (ya no puede leer `pg_authid` ni ejecutar comandos del sistema) y es reversible en dos
  minutos: usuario y contraseña salen de `.env.production`.
- **B** — dos roles, uno de migración y otro de ejecución. Es lo correcto, pero **cambia el
  procedimiento de despliegue**: las migraciones pasan a ser un paso explícito en vez de algo
  que ocurre al arrancar (ADR-010). Por eso se prueba donde no hay clientes.

**Por qué esperar es razonable:** no se encontró ninguna vía de inyección explotable — el SQL
está parametrizado de forma consistente. B-15 es **defensa en profundidad, no una puerta
abierta**. El coste de esperar es bajo; el de romper el ERP en producción, no.

### 21. Instalación limpia — la prueba que cierra B-14 y habilita B-15
**Por qué importa:** B-14 (el instalador generaba un arranque sin worker) se corrigió y se
verificó **leyendo los scripts y contra el servidor existente, no levantando uno nuevo**. Y es
el entorno donde probar el cambio de rol de B-15 sin arriesgar el que da servicio.

**Cómo se comprueba:** instalación desde cero → `pm2 list` muestra los cinco procesos, el
worker con `RUN_CRONS=true`, y `GET /admin/sistema/watchers` con latidos.

---

## 🟠 Deuda técnica — abierta, con techo congelado

Estas tres tienen barrera en la suite: **no pueden empeorar**, y bajan al tocar cada módulo.

### ~~22~~. B-3 — endpoints mutantes sin autorización — **CERRADO 2026-08-10**
**Por qué importa:** `RolesGuard` deja pasar a cualquier usuario autenticado cuando el
endpoint no declara ni `@Roles` ni `@RequirePermission`. No es «protegido por rol al módulo»
—como decía la ficha— es **no protegido**.

De 317 endpoints mutantes: 143 con permiso fino, 50 con rol, **102 abiertos**. Ya se
corrigieron los cinco de `auditoria` (`undo`, `redo` y dos restauraciones alcanzan CUALQUIER
tabla del sistema).

**79 de los 102 están en `olt-nativo.controller.ts`** → bajan con **R9** (partir ese
controlador), que es el momento natural para decidir quién puede provisionar.

**Por qué no se arreglan de golpe:** añadir `@Roles` a un endpoint cuyo permiso no esté
concedido al rol produce un **403 en producción**.

**Cerrado el 2026-08-10: los 317 endpoints mutantes tienen autorización.**

**Y 3 de los 102 nunca fueron un agujero.** El analizador buscaba el PRIMER `export class` del
fichero para delimitar la cabecera de la clase; en los controladores que declaran sus DTO arriba
—`portal.controller.ts` tiene cinco— la cabecera quedaba vacía y se perdían todos los decoradores
de clase. Los tres endpoints de autenticación del portal figuraban como desprotegidos con el
controlador entero marcado `@Public()`. Un informe de seguridad que exagera es tan inútil como uno
que calla: el que lo lee deja de creerle. Corregido, y de paso `GUARD-PROPIO` vuelve a distinguirse
de `PUBLICO`.

**Lo difícil no era el volumen: era no producir un 403.** Se resolvió mirando **qué roles tienen**
cada permiso antes de elegirlo, no cuál suena mejor:

| Controlador | | Permiso | Por qué |
|---|---|---|---|
| `olt-nativo` | 79 | `onu:provision` | `servicios:manage` encajaba igual de bien pero **solo lo tienen Operador NOC y Super Administrador**: un Administrador se habría quedado fuera de su propia OLT |
| `planta-externa` | 13 | `onu:provision` | Mismo dominio FTTH |
| `sites` | 3 | `redes:manage` | Infraestructura de red |
| `crm-nativo` | 4 | `tickets:edit` / `tickets:manage` | Separados: enviar un mensaje es de Atención al Cliente; vincular la cuenta de WhatsApp es administración |

**No se usó decorador de clase**, que habría sido más corto: también alcanzaría a los GET y dejaría
a Invitado sin poder **ver** ONUs, que es un permiso que hoy tiene.

**Comprobado contra producción antes de desplegar**: el administrador conserva los cuatro permisos;
Atención al Cliente mantiene el envío de mensajes y pierde aprovisionar ONUs y tocar la red — que
es el objetivo, no un daño colateral.

**Cómo se comprueba:** `npm run autorizacion:check`. Barrera: `autorizacion-endpoints.spec.ts`,
con el techo bajado de 102 a **0**.

### 23. PA-12 — 15 tablas con más de un módulo escritor
**Por qué importa:** `contratos` la escriben **diez módulos**; `clientes`, cinco. Dos escritores
son dos criterios que empiezan iguales y divergen en la primera modificación — exactamente
como pasó con la deuda (A-4).

**Cómo se comprueba:** `propiedad-tablas.spec.ts`. **Límite conocido: solo detecta SQL crudo**,
no las escrituras por repositorio TypeORM — 15 es un suelo, no un total.

### 24. B-2 — 19 tablas sin entidad TypeORM
**Por qué importa:** un nombre de columna mal escrito dentro de un literal de plantilla es
invisible para `tsc`. Las de **coordinación y dinero ya tienen entidad** (outbox, saga, lock
FTTH, arqueo, extorno); quedan 19 de menor riesgo.

**Cómo se comprueba:** `metadatos-typeorm.spec.ts`.

### 25. PA-15 — 30 de 33 consultas de fondo sin cap
**Por qué importa:** un lote sin límite no se degrada al crecer, **se cae de golpe** el día que
el volumen pasa un umbral que nadie conoce. Afecta a `cobranza.worker`, `facturacion.worker`,
`ztp.service` y los watchers FTTH.

**Sin barrera todavía.** Es el pendiente de esta lista con más probabilidad de morder solo.

---

## 🔵 Medido y no convertido en trabajo

### 26. El servidor lleva 1,9 GB en swap
**Por qué importa:** 2 GB de RAM física, 2 CPUs, y **1,9 GB en swap**. PM2 solo consume
385 MB; el resto lo comen PostgreSQL, Redis y el sistema. Todo va más lento de lo que debería,
y **es lo que bloquea la adopción de OpenTelemetry** (ADR-034 §6.1): un colector añadiría
100–200 MB.

**No lo causa el volumen de clientes** —hay 16— sino el coste fijo. Crecer no lo mejora.

### 27. Los crons de hardware ya consumen un quinto de su ventana
**Por qué importa:** con **5 ONUs registradas**, `tr069-drift` tarda 253 s sobre un intervalo
de 1 200 s (21 %) y `ftth-verificar-wan` 107 s sobre 600 s (18 %). No se puede extrapolar
—buena parte es coste fijo de sesión— y ese es justo el problema: **no conocemos la curva**.

Relacionado con ADR-033 (límite comercial de 5 000 abonados, **capacidad sin validar**).

**Cómo se comprueba:** `watcher_heartbeat.duracion_ms` frente a `intervalo_esperado_seg`.

### 28. `contratos.deuda_total` no debería existir
**Por qué importa:** un modelo contable estándar deriva la deuda de los apuntes por cobrar
abiertos. Almacenarla produjo las cuatro implementaciones de A-4 y el incidente del 04/08.
**Ya no puede divergir** —un solo escritor, una sola definición— pero el concepto sigue mal
planteado.

Registrado en **DOM-001 §8.9.1** y es **entrada obligatoria del ADR de benchmark financiero**
antes de H2-1 (SUNAT). No se toca antes: es cambio de modelo, no corrección.

### 29. El ADR de benchmark de facturación y cobranza
**Por qué importa:** PD-11 lo exige antes de diseñar SUNAT. Y **requiere fuentes citables**, no
memoria: ADR-030 §4.1 prohíbe declarar conformidad con una norma sin *gap analysis*.

**EN CURSO desde 2026-08-08.** El lado externo está en `docs/estudio/facturacion-cobranza-benchmark.md`:
**dos** modelos contrastados —Odoo 18 y ERPNext, con fuentes citadas— y la comparación estructural.
Convergen en las seis decisiones de fondo, así que la tabla ya no refleja el criterio de un solo
fabricante.

**Ya se pagó solo.** El contraste destapó un defecto de dinero LATENTE y se corrigió el mismo día
(**A-5**): una nota de crédito se contaba como deuda en los 18 consumidores, así que anular una
factura no bajaba la deuda y podía acabar cortándole el servicio al abonado. Ver **§3.3** del
estudio.

**Decisión que queda abierta y es del ADR:** si el abono debe pasar a ser **negativo**, como en
los dos modelos validados. Hoy no puede serlo —`facturas_total_check (total >= 0)`— y por eso hizo
falta distinguirlo por tipo de documento. Con importe negativo restaría solo, sin que nadie tenga
que acordarse. **No se hizo ahora a propósito:** cambia el modelo de dinero y toca toda la
agregación.

**DESBLOQUEADO 2026-08-08:** el propietario respondió las nueve preguntas del flujo real (§4) y el
veredicto contrastado contra el código está en §5. Falta solo **la normativa SUNAT** para poder
cerrar el ADR.

### 29-bis. Los tres hallazgos que esperan TU decisión (estudio §6.1)

Los tres están **verificados leyendo el código**, no supuestos, y ninguno se aplica solo porque los
tres cambian comportamiento que afecta a abonados reales.

**~~H-1~~ — CORREGIDO 2026-08-08.** Regla fijada por el propietario: *«el sistema te tolera N
comprobantes vencidos antes de cortarte, y además te ofrece N días de gracia luego del ÚLTIMO
comprobante vencido; un comprobante cuenta como vencido desde el día siguiente de su día de pago»*.
`cobranza.worker` medía desde `MIN(fecha_vencimiento)` —el más antiguo—, así que cortaba antes
(11/03 en vez de 15/03 con día de pago 10) y, sobre todo, **dejaba inertes los días de gracia
siempre que `aplicarCorte >= 2`**. Ahora agrega con `MAX`. Barrera `corte-por-acumulacion.spec.ts`
(8 tests) que fija la decisión **y** la consulta: sin lo segundo, volver a poner `MIN` no rompería
ningún test — que es exactamente cómo pasó inadvertido.

**~~H-2~~ — RESUELTO 2026-08-08, y NO como se había planteado.**
El propietario lo replanteó al ver el radio: *«que `moroso` no sea un estado, sea una etiqueta para
el análisis estadístico»*. Mejor diseño, por tres razones: una etiqueta derivada **no se puede
desincronizar** (lección de A-4), **no toca el comportamiento operativo** —escribir el estado habría
sacado al abonado de las 57 consultas que filtran por `'activo'`, incluida la que decide el corte—,
y **da historia gratis**, que es justo lo que él quiere medir.

Aplicado en `facturacion/domain/mora.ts`: `SQL_COMPROBANTE_VENCIDO()` (qué cuenta como vencido),
`sqlEnMora(cliente)` (la etiqueta, por cliente porque el comprobante es consolidado) y
`SQL_HISTORIAL_MORA` (`tasaMora` y `recurrente`, derivados de `fecha_pago` vs `fecha_vencimiento`).
**Sin tabla nueva:** las facturas ya guardan la historia completa desde el principio.

El corte usa **la misma definición** —`detectarMorosos` importa el fragmento en vez de
reescribirlo— así que no pueden divergir.

**Y el estado se BORRÓ, no solo se retiró** (2026-08-08, a indicación del propietario: «el estado
moroso nadie lo usa»). Medido antes de tocarlo: **0 contratos y 0 de las 44 filas de
contratos_historial**. No estaba en desuso — no ocurrió nunca, ni una vez. Se quitaron las 26
referencias del backend, 2 filtros del frontend y el valor del enum de TypeScript.

**Queda una cosa para la instalación limpia:** el valor sigue en el tipo `estado_contrato` de
PostgreSQL. Quitarlo obliga a recrear el tipo con las tres columnas que dependen de él
(`contratos.estado`, `contratos_historial.estado_anterior` y `estado_nuevo`) más la vista
`v_contratos_completos` — irreversible y sin ganancia funcional, porque ya no hay código que lo
nombre. En la instalación limpia el tipo nace sin él. Ver entrada 21.

**Anular emite una nota de crédito sin decirlo — APLAZADO por el propietario, no bloquea.**
El frontend manda solo `{ motivo }` y el backend crea la NC salvo `crearNotaCredito: false`. El
diálogo dice solo «Se anulará el comprobante», sin mencionar que se acuña un documento con serie
`NC-…` y correlativo propio. Como el flujo real es *anular para editar*, cada edición generaría en
silencio un comprobante no pedido. Latente (0 anulaciones), y desde A-5 una NC ya no cuenta como
deuda, que era el daño real.

**SUNAT ya no bloquea el ADR.** *«Aún no se emiten comprobantes electrónicos con el API de SUNAT»*;
los tipos actuales sirven para llevar la cuenta del IGV según la carga fiscal del comprobante y los
impuestos especiales del abonado. La normativa pasa a ser puerta del trabajo de emisión electrónica,
con un requisito ya identificado: **el correlativo tendrá que ajustarse a las exigencias de SUNAT**.

**H-3 — el primer comprobante del prepago SÍ se emite; lo emite el navegador.**
*(Corregido el 2026-08-08: mi versión anterior decía que no se emitía. El propietario indicó que sí
y tenía razón — lo busqué en `contratos.service`, y está en el frontend.)*

Están **los dos caminos**: `ClienteWizard.tsx:423` para el alta, y `ClienteDetalle.tsx:1957` para un
servicio nuevo a un cliente existente, que **lee la configuración del cliente** —el comportamiento
correcto—. Cubre también el costo de instalación. Ninguno mira `contratos.tipo_pago`.

Lo que queda mal, verificado:

- **Vive en el navegador.** Pestaña cerrada, red caída, alta por API o migración → el prepago se
  queda sin comprobante. El clic no puede ser la frontera transaccional.
- **`catch { }` vacío en los dos**, y el toast dice «Abonado registrado correctamente». Un fallo de
  dinero, en silencio y sin rastro.
- **No usan la política canónica:** periodo `hoy → hoy+1 mes` a mano en vez de `periodoServicio()`,
  que en prepago da el mes siguiente completo.
- **El vencimiento reintroduce el incidente del 05/08.** No envían `fechaVencimiento`, así que
  `facturacion.service.create` cae a `hoy + empresas.dias_gracia` — el primer comprobante **no vence
  en el `diaPago` recién configurado**, y usa la gracia como distancia al vencimiento.
- **No envían `contratoId`** (el DTO lo acepta), así que la factura nace consolidada y sin ítems
  imputables: con **el segundo servicio** la deuda no se imputa a ningún contrato.

Y `contratos.tipo_pago` es un **campo huérfano**: no lo lee la facturación, solo el portal para
decidir si permite bajar de plan con deuda, y puede contradecir al cliente sin que nada lo impida.

**Decisión de modelo que también queda abierta:** si el abono debe pasar a ser **negativo**, como en
Odoo y ERPNext. Hoy no puede —`facturas_total_check (total >= 0)`— y por eso hizo falta distinguirlo
por tipo de documento (A-5). Con importe negativo restaría solo. **No se hizo ahora a propósito:**
cambia el modelo de dinero y toca toda la agregación.

### 29-bis-2. ADR-035 espera tu aprobación — y la fase 1 tiene ventana

**Por qué importa:** `docs/gobierno/ADR-035-modelo-facturacion-tmforum.md` clasifica los 20
conceptos de facturación contra TMF666 / Stripe / Odoo / ERPNext y propone las tres piezas que
faltan: **cuenta de facturación**, **ciclo como objeto reutilizable** y **libro de cargos**.

**La ventana:** la fase 1 (`BillingAccount`, una por cliente, invisible en la UI) tiene que ir
**antes de la instalación limpia**. Después deja de ser un cambio de esquema y pasa a ser una
migración con datos de abonados reales. Hoy hay 16 clientes, 2 contratos vivos y 4 facturas.

**Cuatro decisiones tuyas en §8 del ADR:** aprobar fases 1-2, eventos del prorrateo y su tope,
vencimiento de la nota de crédito y los cargos únicos, y qué se hace con los cinco campos de
configuración que no hacen nada.

### 33. H-11 · Un abonado suspendido por una deuda que parece duplicada — **DECISIÓN TUYA**

**Encontrado el 2026-08-10 en la primera ejecución de `backend/scripts/verificar-emision.sql`.**
El verificador se escribió para el ciclo del 23 y destapó esto en datos históricos, no en los
nuevos.

**James Peña tiene dos comprobantes que se solapan 29 días:**

| | Emitida | Periodo | Origen | Estado |
|---|---|---|---|---|
| **CI-30** | 29/07 | `29/07 – 29/08` | **manual** — el alta, con el periodo calculado a mano por el navegador (`hoy → hoy+1 mes`) | **pagada** S/ 64 |
| **CI-34** | 01/08 | `01/08 – 31/08` | **automática** — mes de calendario, disparada por `dia_facturacion = 1` | **vencida** S/ 64 |

El solape va del **01/08 al 29/08**. Pagó S/ 64 por ese periodo en CI-30 y se le está cobrando
S/ 64 otra vez en CI-34.

**Y tiene consecuencia operativa: está suspendido desde el 07/08 por deber CI-34.** Si es un
duplicado, se le cortó el servicio por una deuda que ya había pagado.

**No es el escenario del 1 de septiembre que H-10 mitigó — es el mismo fallo ya materializado el 1
de agosto.** Los dos defectos que lo produjeron están corregidos: el periodo calculado a mano en el
navegador (H-3, cerrado) y el segundo generador con mes de calendario (H-10, retirado). Lo que
queda es el rastro que dejaron.

#### Por qué no lo he tocado

Anular un comprobante y reactivar a un abonado son **actos de negocio con efecto sobre un cliente
real**, no correcciones técnicas. Además hay una lectura alternativa que solo tú puedes descartar:
que CI-30 se emitiera como cobro de instalación o de un periodo anterior y su periodo esté
simplemente mal escrito, en cuyo caso la deuda de CI-34 es legítima.

#### Qué haría falta decidir

1. **¿CI-34 es un duplicado?** Si lo es, se anula por el flujo del ERP —que deja rastro y nota de
   crédito—, nunca con un UPDATE.
2. **¿Se le devuelve el servicio?** Sin CI-34, su deuda vencida baja a cero y la reactivación
   procede sola por el camino normal.
3. **¿Hay que revisar los otros dos comprobantes?** Solo hay cuatro facturas en total; conviene
   mirarlas todas antes de la instalación limpia.

**Cómo comprobarlo:** `backend/scripts/verificar-emision.sql`, apartado 3. Solo lectura.


### ~~32~~. H-10 · Dos generadores de facturas — **RESUELTO 2026-08-09**

**Encontrado el 2026-08-09 cableando la fase 4.2a.** Es el hallazgo con más alcance de la sesión y
**bloquea la fase 4.2b**.

| | Generador | Cómo decide |
|---|---|---|
| **1** | `FacturacionService.generarFacturasDelDia` | Política del abonado, días entregados (H-6), auto-reparable (H-8) |
| **2** | `workers/facturacion.worker.processGenerarFacturasEmpresa` | **Consulta propia**, cron 05:00, filtra `estado = 'activo'`, periodo = **mes de calendario** |

El segundo tiene su propio SQL —no usa `findContratosParaFacturar`— así que **ninguna corrección
del dinero de esta sesión llegó a él**: ni el prorrateo por días entregados, ni el ciclo del
abonado, ni la auto-reparación.

**Y estuvo a punto de duplicar un comprobante.** Su deduplicación comparaba `periodo_inicio` y
`periodo_fin` por **igualdad**. El generador nuevo produce el ciclo del abonado —`30/08 → 30/09`—
y este el mes de calendario —`01/09 → 30/09`—: no coinciden nunca, así que no encontraba nada. Los
dos servicios vivos tienen `dia_facturacion = 1`, de modo que **el 1 de septiembre el abonado
activo habría recibido dos facturas por el mismo mes**, la suya del día 23 y otra el día 1.

**Mitigado, no resuelto.** La deduplicación pasa a comparar por **solape**, que es la intervención
que no puede hacer daño: solo puede omitir de más, nunca emitir de más. Eso quita el riesgo
inmediato y **no decide cuál de los dos generadores es el bueno**.

#### La decisión que hace falta

Es una violación de «reutilizar antes de construir» que lleva tiempo ahí: dos caminos al mismo
resultado que ya han divergido. Hay que quedarse con uno.

**Decisión del propietario (2026-08-09), y ejecutada:** `FacturacionService` queda como **único
componente autorizado** para determinar y generar facturas. El worker **sigue existiendo como
mecanismo de ejecución** —cola, reintentos, concurrencia— pero sin reglas propias de elegibilidad,
periodo, prorrateo, agrupación ni idempotencia.

> No se mantendrán dos implementaciones de la política de facturación para lograr el mismo resultado.

**Lo ejecutado:** el disparo automático por `servicios.dia_facturacion` desaparece, y las ~320
líneas del job pasan a delegar en `generarMensual` —el mismo patrón que
`processGenerarFacturaIndividual` ya usaba veinte líneas más abajo—. El botón manual del operador
sigue funcionando. `forzar` NO se traslada: era la puerta para esquivar la idempotencia, y darle
una a la autoridad única sería devolverle al worker una regla propia por detrás.

**Comprobado antes de retirar, porque retirar a ciegas era el riesgo:**

- El generador que sobrevive **sí está programado** (cron diario → `generar-mensual` →
  `generarFacturasDelDia`). Borrar el otro no deja al ERP sin facturar.
- El aviso al abonado **no se pierde**: `FacturacionService` emite `FACTURA_EMITIDA` igual, y mejor
  —respeta las preferencias y la plantilla del cliente—.
- `facturacion.generacion.completada` **no lo escuchaba nadie**.

**Y la arqueología cierra el caso:** el worker correcto lleva escrito en un comentario por qué
existe — *«con el disparo por `dia_facturacion`, un cliente configurado para vencer el 28 se
facturaba igual el día 1»*. El camino nuevo se escribió PORQUE el viejo estaba mal, y el viejo
nunca se retiró. Esto no eligió entre dos diseños: terminó una migración a medias.

**Consecuencia anotada, corregida el mismo día:** `servicios.dia_facturacion` deja de **disparar
la generación**. **NO queda inerte** —eso se escribió primero y era falso—: `PoliticaFacturacionService.resolver`
lo sigue usando como **respaldo del día de pago** cuando el abonado no tiene configuración propia.
Son dos papeles y solo se retiró el primero.

Y al comprobarlo apareció una cola suelta del anclaje 1-31: la base tenía
`CHECK (dia_facturacion BETWEEN 1 AND 28)` y los DTO un `@Max(28)`, restos de cuando el día de
pago no admitía 29-31. El modelo sabía manejar un abonado anclado en 31 —vence el 28 de febrero y
vuelve al 31 en marzo— pero no se le podía escribir ese 31 en el campo que se lo iba a dar. La
mitad de una decisión. Corregido a 1-31 en la base y en los dos DTO.

**Barrera:** `facturacion/una-sola-autoridad.spec.ts` (4). Falla si alguien vuelve a enumerar
candidatos a facturar fuera del módulo, si inserta comprobantes desde otro sitio, si el worker
recupera criterio propio, o si `dia_facturacion` vuelve a decidir cuándo facturar. Comprobada:
reintroducir un `INSERT INTO facturas` en el controller de workers la hace fallar.

---

~~**Recomendación: el generador de `FacturacionService`**, y retirar el del worker. Es el que tiene
la política del abonado, el prorrateo y las barreras; el del worker es el que quedó atrás dos veces
—primero con el tipo de comprobante (incidente 2026-08-04) y ahora con todo el bloque del dinero—.

**Por qué bloquea 4.2b:** esa fase mueve la configuración de facturación al contrato y hace que la
generación agrupe **por contrato**. Aplicarlo a un solo generador dejaría al otro emitiendo por
cliente con la configuración vieja; aplicarlo a los dos es escribir dos veces la misma regla, que
es cómo se llegó aquí.


### ~~31~~. H-9 · El tramo del alta en PREPAGO — **CERRADO 2026-08-09**

**Apareció al cerrar H-6**, verificando qué eventos de prorrateo quedaban cableados. No es teoría:
las fechas salen de ejecutar `periodoServicio` con la política real.

Un abonado con anclaje 30 instalado el **22/08**:

| Modalidad | Qué se emite | Los días 22–30/08 |
|---|---|---|
| **Postpago** | nada al alta; el 25/08 se emite el ciclo `[31/07 → 30/08]` | **cobrados** — 9 días prorrateados, sale solo de H-6 |
| **Prepago** | al alta, el ciclo `[31/08 → 30/09]` completo | **gratis** |

En prepago esos 9 días pertenecen al ciclo `[31/07 → 30/08]`, que se emitió el 25/07 — cuando el
abonado todavía no existía. Y no lo recoge nadie después: `proximoVencimiento` nunca vuelve a
devolver el 30/07, así que ese ciclo no se vuelve a mirar.

**Por qué H-6 no lo cubre.** La rama de prepago es «ciclo completo o nada» a propósito: cobra por
delante, así que no hay días entregados que contar en un ciclo que aún no ha empezado. Esa decisión
es correcta para el ciclo futuro y es justo la que deja fuera el tramo pasado.

**No se puede resolver en el alta.** El contrato nace en `pendiente_activacion`; los días
entregados dependen de **cuándo se active**, que en ese momento no se sabe. Cobrarlos al dar de
alta sería cobrar días que quizá no se entreguen.

**Dónde sí:** en la activación. Cuando `activar()` promueve el contrato a `activo`, si el abonado es
prepago y la activación cae a mitad de ciclo, se registra el tramo como **cargo pendiente** y el
siguiente comprobante lo recoge — que es literalmente lo que pidió el propietario para el alta:
*«en su próxima facturación se prorratea para esos días y se le adiciona el costo»*.

**Lo que hay que decidir antes de construirlo:** `registrarCargoPendiente` acepta hoy
`'mora' | 'reconexion'`. El tipo `'servicio'` **ya existe** en `TipoItem`, así que no hace falta
migración — pero sí decidir cómo deriva su `aplica_igv`, que en los otros dos es fijo (mora nunca,
reconexión siempre) y en un servicio debe seguir la carga fiscal del comprobante.

**Impacto hoy:** los dos abonados vivos son prepago, así que es el camino que corre en producción.
Con 2 contratos el importe es anecdótico; con parque real, un mes de altas.

**Corregido el mismo día.** `ContratosService.registrarTramoDeAlta`, invocado desde `activar()`:
si el abonado es prepago, el tramo desde la puesta en servicio hasta el cierre del ciclo en curso
se registra como **cargo pendiente** y lo recoge el siguiente comprobante — que es lo que se había
pedido para el prorrateo del alta.

Piezas nuevas: `PoliticaFacturacionService.cicloEnCurso` —el ciclo que se está **usando**, que en
prepago NO es el que ampara su comprobante— y `cargos_pendientes` de tipo `servicio`, que ya
existía en `TipoItem` y no necesitó migración.

**Dos decisiones que se tomaron al construirlo:**

- **El tipo `servicio` no tiene interruptor de acumulación**, al contrario que mora y reconexión.
  Esos dos el operador decide si los aplica; un tramo ya entregado se debe siempre, y hacerlo
  configurable sería ofrecer la opción de regalar días prestados.
- **Su IGV sale del comprobante del abonado**, no de una constante. En mora y reconexión la carga
  fiscal es propiedad del cargo (nunca / siempre); un tramo de servicio es el mismo producto que
  la mensualidad y tributa igual. Se congela al registrarlo, como los otros dos.

Un caso que el hallazgo no mencionaba y también estaba abierto: **activar el primer día del ciclo**
no es un tramo parcial, es el ciclo entero — y también estaba sin cobrar. Se cobra completo, sin
pasar por la división.

7 tests en `tramo-de-alta.spec.ts`. Suite completa: 82 suites, 721 tests.


### ~~30~~. Los hallazgos de facturación — **los cuatro CERRADOS** (H-3, H-6, H-7, H-8)

**Por qué importa:** son defectos de dinero verificados leyendo el código. Los dos que quedan
**están enlazados**: corregir uno sin el otro deja a los abonados que sí pagan sin poder reactivarse.

#### ~~H-3~~ · El primer comprobante del prepago lo emitía el navegador — **CERRADO 09/08**

Movido a `ContratosService.emitirComprobanteDeAlta`, dentro de la creación del contrato. Eran
**cuatro** defectos, no cinco: el vencimiento en `hoy + dias_gracia` ya lo había cerrado H-4.

Al corregirlo aparecieron dos cosas que el hallazgo no podía ver, y que son el mismo patrón —
**mover código de sitio no conserva sus precondiciones**:

- `onboarding` guardaba la configuración de facturación **después** de crear el contrato. Daba
  igual mientras la emisión estaba en el navegador; adentro, habría facturado como postpago a
  **todo abonado prepago**, en silencio y con fechas plausibles.
- El registro del fallo se encadenaba con `.catch()`: el manejador que existe para que el alta no
  se caiga podía ser el que la tirara.

12 tests en `contratos/comprobante-de-alta.spec.ts`, incluida la barrera de que el navegador no
vuelva a emitir pegado al alta.

#### ~~H-6, H-7 y H-8~~ · **CERRADOS el 2026-08-09**, en un solo despliegue

Fueron juntos porque están enlazados: corregir H-6 sin H-7 dejaba a los abonados que **sí pagan**
sin poder reactivarse.

**Lo construido.** `facturacion/domain/prorrateo.ts` gana `diasEntregados`, que recorre
`contratos_historial` día a día. La generación dejó de preguntar «¿está activo hoy?» y pregunta
«¿cuántos días de este ciclo estuvo activo?». Una sola regla cubre el mes del corte, los meses
suspendidos (cero días → no se emite nada) y el de la reactivación.

**Tres cosas aparecieron al implementarlo, y ninguna estaba en los hallazgos:**

**1. H-7 no eran dos puertas. Eran CINCO.** Y las tres que faltaban son las peligrosas:

| Puerta | Qué medía |
|---|---|
| `pagos.service`, al registrar el pago | `sqlDeudaExigible` sin fecha |
| Guarda del cambio manual de estado | `contratos.deuda_total` |
| **`cobranza.worker`** | Decide **al final**: podía CANCELAR una reactivación ya autorizada — abonado pagado y sin servicio |
| **`verificarYReactivarContrato`** | Deuda **imputada total**; y reactiva con `automatico = true`, que **se salta las guardas** |
| **Ruta del comprobante consolidado** | `SUM` a nivel de cliente, sin fecha |

No era un criterio equivocado: era **el mismo criterio copiado cinco veces**. Corregir dos habría
dejado tres decidiendo con la deuda total, y el fallo habría seguido en pie con los tests en verde.
Hoy las cinco preguntan a `vencidaQueBloquea` / `vencidaDelCliente`, y una barrera falla si alguien
vuelve a escribir un `SUM(f.saldo)` en cualquiera de los tres ficheros.

**2. Hay DOS generadores, y el de producción no era el que se estaba corrigiendo.**
`generarMensual` lo llama el controlador; el que corre a diario es `generarFacturasDelDia`. La
primera pasada de H-6 tocó solo el primero. Una barrera cuenta ahora que `cargoDelContratoEnCiclo`
se invoque **dos** veces.

**3. H-8 no necesitó mecanismo nuevo.** El generador diario emitía solo si la fecha de emisión era
**exactamente** hoy, así que un ciclo perdido no se recuperaba jamás. Cambiar `===` por `<=` lo
vuelve **auto-reparable**: emite cualquier ciclo cuya emisión ya venció y que aún no tenga
comprobante. Lo seguro es la deduplicación por periodo, que ya existía. De regalo cubre el día en
que el cron no llegó a correr.

**Y la liquidación final del tramo salió gratis.** Se había aparcado para una segunda tanda; como
la regla mira el tiempo entregado y no el estado de hoy, un contrato que pasa a baja definitiva a
mitad de ciclo factura sus días sin código aparte. Lo que sigue pendiente es la liquidación de un
contrato dado de baja **fuera** del ciclo en curso.

**Decisiones aplicadas:** día del corte incluido, reactivación con cero vencidos, base
`ACTUAL_360` (PD-14). El importe del escenario del propietario —8 días de un ciclo de 31 con
mensualidad S/ 64— es **S/ 17,07**, donde antes eran S/ 0.

**Cobertura:** `domain/dias-entregados.spec.ts` (12) y `reactivacion-deuda-vencida.spec.ts` (11).
Suite completa del backend en verde: 81 suites, 714 tests.

**Detalle y trazabilidad:** `docs/estudio/facturacion-cobranza-benchmark.md` §5.2, §5.2-bis y §6.1.


### ~~29-ter~~. Anclaje 1-31 con recorte a fin de mes — RESUELTO 2026-08-09
**Cerrado.** El tope en 28 evitaba el problema de febrero prohibiendo los tres dias de cierre mas
usados en tarifa plana. Ahora el abonado guarda un ANCLAJE de 1 a 31 y la fecha se recorta al
ultimo dia real del mes, como documenta Stripe. **El anclaje no cambia**: tras el 28 de febrero
vuelve al 31 en marzo.

La trampa que estaba medida se confirmó al implementar, y además apareció una segunda:
`periodoServicio` tenía una **precondición tácita** —«el día que recibes ES el anclaje»— y
devolvía un periodo con un extremo derivado del anclaje y el otro del día suelto que le pasaran.
La detectó un test, no una revisión.

Barrido completo: politica del backend, 3 selectores del frontend y **3 helpers de fecha que
desbordaban igual** (la previsualizacion habria mostrado el 3 de marzo como fecha de pago).
26 tests en la politica; suite 77/77 - 658 tests.

---

## 📋 Índice de desviaciones abiertas — sincronizado con POL-001

> **Esto es un índice, no una segunda descripción.** El detalle, el estado objetivo y la
> condición de cierre viven en **POL-001 Anexo B**, que es la fuente. Aquí solo está la lista
> para que responder «¿qué queda abierto?» no exija auditar el corpus.
>
> **Lo mantiene sincronizado `desviaciones-en-pendientes.spec.ts`**: si se abre una desviación
> nueva en POL-001 y no aparece aquí, la suite falla. Una lista que hay que acordarse de
> actualizar se desactualiza — es la lección de PA-12 y del latido.

| # | Política | Qué falta |
|---|---|---|
| **B-1** | PD-08 | strict: false · strictNullChecks: false · noImplicitAny: false · regla no-explicit-any desactivada. Se cumple por d… |
| **B-2** | PA-13 | PARCIAL 2026-08-08 (R7). Las de coordinación y dinero ya tienen entidad: comandos_red_pendientes, operacion_wizard,… |
| **B-3** | PS-05 | MEDIDA 2026-08-08, y la ficha decía otra cosa. De 317 endpoints mutantes: 143 con permiso fino, 50 con rol, 102 ABI… |
| **B-4** | PA-07 | Las operaciones interactivas de /red/routers son síncronas, sin outbox ni garantías |
| **B-5** | PA-03 / PA-05 | El plano WISP tiene outbox parcial, sin máquina de estados, sin saga, y VIO solo como detección posterior |
| **B-6** | PA-15 | reconciliar() itera sin cap ni lock; ningún cron declara presupuesto de tiempo |
| **B-7** | PA-17 | El cambio de ONU no existe. Se improvisa como baja + alta |
| **B-8** | PI-02 / PI-03 | Mercado Pago —el único que cobra dinero real— no usa el contrato de cobro. La abstracción no está validada |
| **B-10** | PA-11 | Credenciales de connreq de GenieACS duplicadas en el ACS y en el .env, sin verificación de coincidencia. CCD y cron… |
| **B-11** | PA-08 | Implementados y en producción, sin test que los ejercite |
| **B-15** | PS-01 / OWASP | La aplicación se conecta a PostgreSQL como SUPERUSUARIO (datafast_db_user: rolsuper, rolbypassrls, dueña de las 111… |
| **C-1** | PS-06 | forbidNonWhitelisted: false: los campos extra se descartan en silencio |
| **C-2** | PA-06 | Solo en el plano de red; el financiero lanza excepciones HTTP a consumidores que a veces son máquinas |
| **C-3** | PA-01 | El patrón existe y se aplica, pero nada obliga a implementarlo en un módulo nuevo |
| **C-4** | PI-06 | telegraf, twilio, net-snmp instaladas sin uso; cola mikrotik-jobs declarada y no usada |
| **C-5** | EST-001 §8.2 | Tres convenciones simultáneas; molecules/ vacío; 1,8 % de código reutilizable |
| **C-6** | PA-16 | Se cumple, sin mecanismo que lo impida |
| **C-7** | DAT-001 §8.6 | Seis tablas de serie temporal sin política de retención ni particionado |

**18 abiertas** · Nivel A: **0** · Las marcadas arriba con entrada propia
(20-29) llevan además su consecuencia y su forma de comprobarse.

---

## ✅ Cerrado (para no volver a levantarlo)

- **La generación de facturas estaba MUERTA en producción (06/08).** `findContratosParaFacturar`
  filtraba por `co.estado IN ('activo', 'prorroga')` y el estado `prorroga` no existe en el
  enum: Postgres no devuelve menos filas, **rechaza la consulta entera**. El job falló sus
  3 intentos esa madrugada y el día 23 no habría salido ni una factura. El literal era
  preexistente pero estaba latente mientras la generación corría un día al mes. Corregido
  en los tres sitios donde aparecía (facturación y dos consultas de velocidad) y fijado con
  `estados-sql-validos.spec.ts`, que recorre el código y falla si algún SQL compara
  `co.estado` con un valor fuera del enum.
- **`auditoria_logs` sin retención y clasificada por el texto de la descripción (06/08).**
  Ahora hay columna `tipo` que decide quien escribe, y un cron diario que caduca solo el eco
  técnico con más de 90 días. Lo de negocio no se borra nunca.

- **Corte indebido del 05/08** (James Pena): el cron medía la mora desde el alta del
  contrato y no respetaba prórrogas. Corregido y desplegado.
- **`deuda_total` desfasada** de Piero (S/64 mostrados vs S/128 reales): se corrigió sola
  con el pago consolidado; hoy debe S/0.
- **Pago consolidado**: probado en producción por el usuario — un pago de S/128 con un solo
  número de operación imputado 64+64 a dos comprobantes.
- **Log del Sistema**: mostraba `mockLogs`. Ahora lee las tres fuentes reales.
