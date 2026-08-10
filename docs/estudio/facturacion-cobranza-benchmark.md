# Estudio — Cómo resuelven facturación y cobranza los modelos validados

**Naturaleza:** documento de **estudio**, no normativo. Es el insumo del ADR de benchmark que
PD-11 exige antes de diseñar. **No decide nada todavía.**
**Fecha:** 2026-08-08 · **Actualizado:** 2026-08-09 · **Estado:** el flujo real **está respondido**
(§4) y contrastado contra el código (§5). **Tres modelos externos** contrastados: Odoo 18, ERPNext
y Stripe. **SUNAT ya no bloquea**: aún no se emite electrónicamente, así que la normativa es puerta
del trabajo de emisión, no de este estudio (§6).
**Aplicado ya:** el defecto de la nota de crédito (§3.3) y el del corte por acumulación (H-1).
**Su conclusión vive ahora en [ADR-035](../gobierno/ADR-035-modelo-facturacion-tmforum.md)**, que
clasifica los 20 conceptos contra TMF666.

---

## 1. Por qué existe y qué NO es

El propietario lo planteó así: *«todo el módulo de facturación y cobranza debería evaluarse
primero, siempre y cuando tenga el flujo real de trabajo de estos módulos, para saber qué está
bien así parezca que está mal, y qué está mal realmente»*.

Ese criterio es correcto y ordena el trabajo. **Sin el flujo real, comparar el código contra un
modelo externo produce falsos defectos**: marcaría como error lo que es adaptación deliberada al
negocio ISP.

Prueba de que el riesgo es real: al preparar este estudio hice cuatro comprobaciones puntuales
sobre el código y **me equivoqué en tres**. Afirmé que el corte no conocía los meses acumulados
(los conoce), que la política canónica no los exponía (los expone), y que la nota de crédito no se
relacionaba con el documento que rectifica (sí lo hace, §3.3).

> **Y una de esas «correcciones» era a su vez falsa.** Dije también que *«nadie asigna los estados
> `moroso`/`cortado`»*, me corregí a *«los asigna 12 veces cada uno»*… y al verificarlo en serio
> resultó que **la primera versión era la correcta**: las 26 apariciones de `moroso` son lecturas,
> ninguna escritura (H-2 en §5.2). Contar coincidencias de `grep` no es leer código. Es el mismo
> fallo que ya produjo la cifra falsa «1 de 47» del latido, y queda escrito por eso.

**Este documento recogía solo el lado externo.** El lado interno —el flujo real— lo respondió el
propietario el 2026-08-08 y está en **§4**; el veredicto contrastado contra el código, en **§5**.

---

## 2. Lo estudiado, con fuentes

Cinco páginas de la documentación oficial de Odoo 18. Se citan porque **ADR-030 §4.1 prohíbe
declarar conformidad con un modelo sin haberlo consultado**, y porque una afirmación sobre un
sistema ajeno escrita de memoria es exactamente lo que este corpus no admite.

### 2.1 El comprobante

- Dos estados centrales: **Draft** y **Posted**. *«Draft invoices have no accounting impact until
  they are confirmed.»* Y al confirmarse, *«the invoice's status changes to Posted, and a journal
  entry is generated»*.
- **Una vez publicado no se modifica**: hay que devolverlo a borrador explícitamente.
- **La línea de factura es una entidad**, con producto, cantidad, precio e impuestos.
- Se considera **pagado** cuando el apunte contable queda conciliado con el movimiento bancario.

### 2.2 La nota de crédito

- **Es el mismo objeto que la factura**, distinguido por su propósito y su numeración: la nota de
  `INV/2025/0004` se numera `RINV/2025/0004`.
- **La relación con el documento corregido existe**: se materializa como un **asiento de
  reversión** que cancela los apuntes del original.
- Dos caminos al emitirla: **Reverse** (abre un borrador prellenado que se puede modificar → nota
  parcial) y **Reverse and Create invoice** (revierte, concilia y abre una factura nueva).
- La **nota de débito** es simétrica y aumenta lo adeudado.

### 2.3 El vencimiento — *payment terms*

Esto es lo más distinto de Datafast.

- El vencimiento **no es un número en el cliente**: es un **término de pago**, un objeto
  reutilizable compuesto de **líneas**.
- Cada línea lleva **valor** (porcentaje, importe fijo o saldo) y **regla de fecha**: días tras la
  fecha de factura, día del mes, o «días a fin de mes más N».
- **Una factura puede tener VARIAS fechas de vencimiento** — cuotas. Cada línea genera su propio
  apunte en cuentas por cobrar **con su fecha**, y eso es lo que hace correctos el *aging* y el
  seguimiento.

### 2.4 La cobranza — *follow-up levels*

- Los niveles se configuran en **Contabilidad → Configuración → Niveles de seguimiento**, y
  **aplican a toda la organización**, no por cliente.
- El disparador es **días transcurridos desde la fecha de vencimiento**.
- Admite **días negativos** para avisar **antes** del vencimiento: el preaviso es un nivel más de
  la misma escala, no un mecanismo aparte.
- Cada nivel puede: correo, carta, SMS, y **crear una actividad con responsable asignado**.
- Hay **fecha de próximo recordatorio** y **responsable** por cliente, y se puede pasar de
  automático a manual — ahí es donde vive la excepción individual.

### 2.5 La recurrencia — suscripciones

- Cada suscripción lleva su **Next Invoice Date**, y una acción programada
  (*Sale Subscription: Generate recurring invoices*) emite lo que toque.
- **La fecha vive en la suscripción**, no se recalcula desde una regla global en cada corrida.
- **Automatic Closing = N días**: si se renueva el día 1 y el cierre está en 15 días, la
  suscripción se cierra el 16 si no hay pago. Es el equivalente directo del corte.

### 2.6 El segundo modelo: ERPNext

Se contrasta con un segundo producto **a propósito**: adoptar el criterio de uno solo sería
copiar un producto, no identificar un modelo. Lo que importa aquí es **dónde convergen los dos
de forma independiente** — eso ya no es la opinión de un fabricante.

| Concepto | Odoo 18 | ERPNext | ¿Convergen? |
|---|---|---|---|
| Vencimiento | *Payment term* reutilizable con líneas | *«A Payment Terms Template combines reusable Payment Term records into a schedule»* — `Invoice Portion` + `Credit Days` + `Due Date Based On` | **Sí** |
| Varias fechas por comprobante | Sí, cuotas | Sí: *«A 50% Advance, 50% Net 30 template contains two installments»* | **Sí** |
| Dónde se asigna | Cliente y/o factura | *«Set the appropriate default on the relevant Customer»*, o en la transacción | **Sí** |
| Nota de crédito | Mismo objeto + asiento de reversión | *«a Sales Invoice marked as a return, with negative quantities and amounts»*, creada desde la original, que *«preserves the reference»* | **Sí** |
| Cobranza | *Follow-up levels* centrales | *Dunning*: *«a formal payment reminder for one or more overdue Sales Invoice instalments»*, con `Dunning Type` reutilizable (fee, interés anual, carta) | **Sí** |
| Recurrencia | `Next Invoice Date` en la suscripción | `generate_invoice_at`: `Postpaid` · `Prepaid` · **`Bill N days before`**; más `days_until_due` | **Sí** |

**Dos convergencias merecen atención especial, y una es a favor de Datafast:**

- **`Bill N days before` + `days_until_due` es, literalmente, el modelo de Datafast.** La política
  canónica emite en `diaPago − crearFactura` y vence en `diaPago`: emitir N días antes de un
  vencimiento fijo. Un producto validado tiene ese mismo modo como una de sus tres opciones. **No
  es una rareza del ERP; está bien.**
- **El abono es NEGATIVO en los dos.** Odoo por asiento de reversión, ERPNext con cantidades en
  negativo. Es la razón por la que en ambos un abono resta sin que nadie tenga que acordarse de
  restarlo. Esto tuvo consecuencia directa aquí: ver §3.3.

### 2.7 El tercer modelo: Stripe Billing

Se añade un tercero porque **es donde estaba mi error**: el estudio afirmaba que la configuración
por abonado de Datafast diverge del modelo validado, y solo había consultado a Odoo. Stripe lo
desmiente de la forma más clara posible.

- **El ancla es un día del mes, y se recorta a fin de mes.** *«Set `day_of_month` to `31` to create
  a monthly subscription that renews at the end of the month, even in months with less than 31
  days. If a month has less than 31 days, the subscription renews on the last day of that month.»*
  Y el ejemplo textual: *«A monthly subscription with a billing cycle anchor date of January 31
  bills the last day of the month closest to the anchor date, so February 28 (or February 29 in a
  leap year), then March 31, April 30, and so on.»*
- **El vencimiento es un campo separado del ancla:** `days_until_due` — *«Number of days a customer
  has to pay invoices generated by this subscription»*.
- **Y dice cuándo coinciden:** *«This value will be `null` for subscriptions where
  `collection_method = charge_automatically`.»* Es decir, el vencimiento **es** el ancla solo cuando
  se cobra automáticamente al cerrar el ciclo.
- **El corte va por días, no por comprobantes.** Agotados los reintentos, la suscripción pasa a
  `canceled`, `unpaid` o `past_due` *«after the maximum number of days defined in the retry
  schedule»*.
- **Ancla y plazo de pago viven en la SUSCRIPCIÓN**, no en una configuración global de la empresa.

Dos consecuencias directas para este estudio, y las dos corrigen algo que decía:

1. **El anclaje con recorte a fin de mes está en el estándar, con el día 31 como ejemplo.** El tope
   de Datafast en 28 —«el único día que existe en los doce meses»— evita el problema en vez de
   resolverlo. Anotado en PENDIENTES 29-ter.
2. **Datafast está alineado, no divergente**, en poner el ciclo por abonado. Stripe es incluso más
   granular: por suscripción.

---

## 3. La comparación estructural

| Concepto | Modelo validado | Datafast hoy |
|---|---|---|
| **Vencimiento** | *Payment term* reutilizable en el cliente; **puede producir varias fechas** (cuotas) | `diaPago`, un entero (1..28) dentro de un JSONB del cliente. Una sola fecha |
| **Dónde vive el ciclo y el plazo de pago** | **Por parte en los tres.** Stripe: en la *suscripción*. Odoo y ERPNext: *«Set the appropriate default on the relevant Customer»* | **Por abonado — ALINEADO**, no divergente. Ver §3.4 |
| **Escala de avisos** | **Solo esto es central**, y solo en Odoo (*follow-up levels*); ERPNext usa `Dunning Type` reutilizable | **Por cliente — decisión deliberada de producto** (§3.1). Existe `plantillas_abonados` como esquema con nombre, pero se **copia** al alta, no se referencia |
| **Anclaje del día de cierre** | Stripe: `day_of_month` **1..31**, recortado al último día real del mes | **Topado en 28**, que evita el problema en vez de resolverlo → PENDIENTES 29-ter |
| **Preaviso** | Un nivel más, con días negativos | Mecanismo aparte (`crearFactura`, `notif-preventivas`) |
| **Corte** | *Automatic Closing* = N días sin pago | **Dos condiciones**: `diasGracia` **y** `aplicarCorte` (comprobantes acumulados) |
| **Línea de factura** | Entidad con producto, cantidad, impuestos | **JSONB** |
| **Nota de crédito** | Mismo objeto + **asiento de reversión**; importes **negativos** | Mismo objeto, **con FK `factura_original_id`** y serie propia `NC-…`. Importe **positivo** (el CHECK prohíbe negativos) → §3.3 |
| **Próxima emisión** | Campo `Next Invoice Date` en la suscripción | Se **deriva** del `diaPago` en cada corrida del cron |
| **Inmutabilidad** | Publicada no se modifica; para cambiarla, se revierte | Estados `borrador → emitida`, sin regla equivalente escrita |

### 3.1 La hipótesis que este estudio tenía, y por qué era FALSA

> **RETIRADA el 2026-08-08, el mismo día.** La primera versión de este documento proponía que
> Datafast tuviera «demasiada configuración por cliente» frente al modelo centralizado de Odoo, y
> que eso explicara el desorden.
>
> **Era exactamente el falso defecto contra el que el propietario advirtió.** Su respuesta:
> *«configurar facturación, notificaciones, cortes y tipo de comprobante por cliente es
> DELIBERADO; así se debe trabajar para ofrecer mayor flexibilidad»*. Es una decisión de producto,
> no una carencia. Se deja escrita la equivocación porque el estudio existe para distinguir lo que
> está bien de lo que está mal, y confundirlos es su único modo de fallo.

#### Lo que la corrección revela, que es más útil

**El patrón de esquema reutilizable YA EXISTE en el ERP**, y es bueno:

- `plantillas_abonados` guarda un `FacturacionConfig` completo —`diaPago`, `crearFactura`,
  `diasGracia`, `aplicarCorte`, mora, reconexión, impuesto— **más** un `NotificacionesConfig` con
  los tres recordatorios y sus plantillas de mensaje.
- El alta de abonado ofrece **«Cargar desde plantilla»**.

**Pero es una COPIA, no una referencia.** El cliente no guarda `plantilla_id`, y
`PoliticaFacturacionService` nunca consulta la plantilla: solo lee `clientes.facturacion_config`.

**Y copiar es defendible.** Es lo contrario de lo que hace Odoo —que referencia el término de
pago— pero para un ISP tiene una ventaja concreta: **cambiar una plantilla no altera el ciclo de
los abonados existentes**, que es la misma lógica del invariante propio de congelar el vencimiento
en la factura al emitirla. Con referencia, editar una plantilla podría adelantarle el corte a
cientos de abonados sin que nadie lo pidiera.

#### La consecuencia real, que sí es un hueco

Con copia y sin referencia, **no existe forma de cambiar la política de muchos abonados a la vez**.
Si mañana se decide pasar los días de gracia de 5 a 7, hay que tocarlos uno a uno: la plantilla
solo sirve para los que se den de alta después.

Eso es un **hueco de funcionalidad**, no un defecto de diseño, y admite solución sin renunciar a
la flexibilidad: una operación masiva que aplique una plantilla a un conjunto de abonados
seleccionados, dejando constancia de a quién y cuándo. Sigue siendo copia —nada cambia solo—,
pero deja de ser de uno en uno.

#### Lo que sigue en pie del lado externo

Independientemente de dónde viva la configuración, estas diferencias de la tabla anterior no
dependen de esa decisión y siguen siendo válidas: la línea de factura como entidad y el
vencimiento capaz de producir varias fechas.

### 3.2 Dos cosas de Datafast que el modelo externo NO trae

Van aquí para que el benchmark no las borre por parecer anomalías:

1. **El corte por comprobantes acumulados.** Odoo cierra por días sin pago; Datafast exige además
   N comprobantes vencidos. Para un ISP con abonados que pagan tarde de forma habitual, cortar al
   primer impago sería comercialmente inviable. **Parece una adaptación correcta al negocio.**
2. **La gracia como distancia vencimiento→corte.** Invariante ganado en el incidente del
   2026-08-05 y protegido por el guard 2 de PD-11. **No se toca.**

### 3.3 Lo que el benchmark encontró que SÍ estaba mal — corregido el 2026-08-08

Esto es lo que el estudio buscaba: **no un desvío del modelo externo, sino un defecto de dinero
que el contraste con el modelo externo hizo visible.**

#### La corrección previa

La primera versión de esta tabla decía que la nota de crédito era *«un valor del enum
`tipo_comprobante`, sin relación al documento que rectifica»*. **Falso, y es la cuarta afirmación
equivocada que este estudio corrige sobre facturación.** `crearNotaCredito` existe, es completa y
es buena: FK real `factura_original_id`, serie propia `NC-<serie>` con correlativo bajo
`pg_advisory_xact_lock`, nota **parcial** vía `montoAcreditar`, emisión automática al anular, y
`anular` rechaza una factura pagada diciendo *«emite una nota de crédito»*. Estructuralmente es
lo mismo que hacen Odoo y ERPNext.

#### El defecto, que estaba en otro sitio

El abono nace `estado = 'emitida'` con **`total` POSITIVO**, porque el CHECK
`facturas_total_check (total >= 0)` prohíbe el importe negativo con el que Odoo y ERPNext
consiguen que un abono reste solo. Y `saldo` es `GENERATED ALWAYS AS (total - monto_pagado)`.

**La nota de crédito nacía, por tanto, con saldo a cobrar** — y ninguno de los **dieciocho**
consumidores de la deuda miraba qué documento era cada fila. Anular una factura de S/ 50 no
bajaba la deuda: la original salía al pasar a `anulada`, y su propia nota de crédito entraba por
el mismo importe. El descargo se convertía en una deuda nueva.

Y seguía. La nota nace con `fecha_vencimiento` = hoy, así que al día siguiente
`MARCAR_FACTURAS_VENCIDAS` la pasa a `vencida`. Desde ahí:

| Consumidor | Qué hacía con el abono |
|---|---|
| `cobranza.worker` (barrido de morosos) | Un comprobante vencido más → **suma a los meses acumulados del corte** |
| `pagos.service` (reactivación) | Exige `deuda <= 0` → el abonado **paga todo y no se le reactiva nunca** |
| `promesas-pago` | Igual: la promesa no se puede cumplir |
| `deuda_total` / portal / dashboard | Deuda inflada por el importe del abono |
| Cobranza | **Le reclama al abonado el pago del abono que se le acaba de conceder** |

**Anular una factura podía cortarle el servicio al abonado.**

#### Estado medido y corrección aplicada

Verificado contra producción el 2026-08-08: **0 notas de crédito y 0 facturas anuladas**. El
defecto estaba **latente** — se dispara la primera vez que un operador anule algo, que es
exactamente lo que va a pasar en la beta. Nada que reparar en los datos.

Corregido en el punto común, no en los dieciocho sitios: `SQL_ESTADOS_CON_SALDO` **dejó de
exportarse** y en su lugar hay `sqlDeudaExigible(alias?)`, que añade `factura_original_id IS
NULL`. El estado suelto ya no se puede pedir, que es lo que permitía olvidar el tipo de
documento. Barrera: un test marca cualquier fichero que consulte `facturas` sumando dinero sin
pasar por el helper. La vista `v_resumen_financiero` lleva la misma condición.

**Lo que este arreglo NO decide** es si el abono debe ser negativo, como en Odoo y ERPNext. Eso exige quitar el CHECK y revisar toda la agregación, y es materia del ADR. Que un
abono no cuente como cargo no depende del modelo que se acabe eligiendo.

### 3.4 La afirmación que este estudio hizo DOS veces, y era falsa las dos

Con Stripe consultado (§2.7), la corrección de §3.1 se puede cerrar con evidencia en lugar de solo
con la palabra del propietario. La afirmación era:

> *«Datafast pone toda la configuración en el cliente, frente al modelo centralizado de los
> productos validados.»*

**El ciclo y el plazo de pago son por parte en los tres:**

| | Dónde vive |
|---|---|
| **Stripe** | `billing_cycle_anchor` y `days_until_due` son campos **de la suscripción** — más granular que por cliente |
| **ERPNext** | *«Set the appropriate default on the relevant Customer, Supplier, or Company»* |
| **Odoo** | *«Set the appropriate default on the relevant Customer»* |

Lo único centralizado es la **escala de cobranza**, y solo en Odoo — donde además hay *«fecha de
próximo recordatorio y responsable por cliente»*. ERPNext ni eso: sus `Dunning Type` son plantillas
reutilizables.

**Así que lo que de verdad diverge es mucho más estrecho:** los tres recordatorios viven por abonado
en vez de ser plantillas con nombre. Y hasta eso está a medias resuelto con `plantillas_abonados`.

#### Por qué se registra el error, y no solo la corrección

La primera vez se escribió como hipótesis central del estudio y **se retiró** el 2026-08-08 tras
una corrección del propietario. La segunda vez se repitió **dos días después**, en una frase de
resumen, sin volver a mirar la evidencia — y la evidencia ya estaba recogida en este mismo
documento.

**Retirar una afirmación de un documento no la retira de la cabeza de quien la escribió.** Es la
razón por la que **POL-001 PD-13** exige clasificar cada concepto como adoptado, adaptado,
extendido o **alineado**, en una tabla y por concepto (ADR-035 §5), en vez de corregir en prosa. La
prosa se olvida; una fila de tabla que dice «ALINEADO» no se vuelve a leer al revés.

---

## 4. El flujo real — **respondido por el propietario el 2026-08-08**

Nueve preguntas, nueve respuestas. Se transcriben antes de juzgar nada, porque son **la
especificación**: a partir de aquí, «bien» y «mal» significan «coincide o no coincide con esto».

| # | Tema | Lo que dijo el propietario |
|---|---|---|
| 1 | **Corte** | Acumular **3 comprobantes vencidos MÁS 5 días** |
| 2 | **`moroso`** | «Cuando supera la fecha de corte y **está haciendo uso de los días de gracia y/o prórrogas**» |
| 3 | **Consolidado** | El comprobante es consolidado cuando el abonado tiene **más de un servicio**. *«Si deben estar amarrados a contratos, eso hay que estudiarlo y evaluarlo»* |
| 4 | **Prepago / postpago** | **Se usan los dos.** Prepago: el abonado *«nace pagando el mes que va a consumir»* — al contratar se le emite ya su comprobante. Postpago: consume y después se le genera. *«Sería bueno analizar este punto»* |
| 5 | **Nota de crédito** | **No se ha contemplado en ningún escenario.** Lo que se hacía era **editar el pago, o anularlo para poder editar el comprobante**. *«Necesita análisis»* |
| 6 | **Tipo de comprobante** | **Lo decide el operador.** Puede cambiar la configuración de facturación, cobranza y notificaciones del abonado, y **afecta desde la modificación hacia adelante**. Elige entre los comprobantes creados previamente; el **por defecto es un comprobante interno sin carga tributaria** |
| 7 | **Canales de cobranza** | Es **el flujo de cómo entra el dinero**, y debe ser configurable. *«Hoy está construido pero no es intuitivo ni flexible»* |
| 8 | **Prórroga** | Un **acuerdo con el cliente** |
| 9 | **Plantillas de abonado** | Configuración **preestablecida para ahorrar tiempo**. Por sí solas **no producen efecto**: se cargan en el paso 2 del wizard de alta o en Facturación → Configuración, y no se guardan salvo que se termine el wizard o se pulse guardar. El operador puede **adoptarla entera, en parte, o ajustarla**. Se espera implementar **cambios masivos** de esta configuración —p. ej. poner día de pago 10, o prepago, a un grupo—, y **afectarán desde ahí hacia adelante: no corrigen lo ya hecho** |

**La respuesta 9 confirma §3.1 entera**: copiar en vez de referenciar es deliberado, el operador
ajusta caso a caso, y el hueco es la operación masiva — que ya está prevista, con pantalla de
referencia (filtros por router, plan, estado, ubicación y día de pago sobre los mismos campos de
Facturación y Notificaciones).

---

## 5. El veredicto — qué está bien aunque parezca mal, y qué está mal

Cada punto contrastado contra el código. **Lo que se afirma aquí está leído, no supuesto**, y se
nombra el fichero para que se pueda comprobar.

### 5.1 Está BIEN, aunque el modelo externo lo haga distinto

| Tema | Por qué está bien |
|---|---|
| **Configuración por abonado** (§3.1) | Decisión de producto. Odoo y ERPNext centralizan; un ISP con cobranza flexible, no |
| **Emitir N días antes de un vencimiento fijo** | ERPNext tiene ese modo literal: `Bill N days before` + `days_until_due` |
| **Corte por comprobantes acumulados** | Ni Odoo ni ERPNext lo traen, y para un ISP cortar al primer impago es inviable |
| **Congelar el vencimiento en la factura** | `PoliticaFacturacionService`: la configuración nueva no reescribe deuda ya notificada. Coincide con la respuesta 6 («afecta hacia adelante») y con la 9 |
| **Copiar la plantilla, no referenciarla** | Respuesta 9. Referenciar movería el ciclo de abonados vivos al editar una plantilla |
| **Comprobante interno sin carga tributaria por defecto** | `comprobantes_config` lo modela con `tiene_carga_fiscal`, y la factura guarda el **snapshot** del tipo y de esa marca al emitir. Correcto: el histórico no cambia si el tipo se renombra |

### 5.2 Está MAL — tres hallazgos verificados

#### H-1 · El corte NO contaba «3 vencidos más 5 días» — **CORREGIDO el 2026-08-08**

> **Regla confirmada por el propietario:** *«El sistema te tolera N comprobantes vencidos antes de
> cortarte, y además te ofrece N días de gracia **luego del último comprobante vencido**. Un
> comprobante cuenta como vencido desde el día siguiente de su día de pago.»*
>
> Aplicado: la CTE agrega con `MAX(fecha_vencimiento)` en vez de `MIN`. Barrera en
> `corte-por-acumulacion.spec.ts` (8 tests), que fija tanto la decisión como la consulta — sin la
> segunda, volver a poner `MIN` no rompería ningún test.

Lo que estaba mal, y por qué nadie lo vio:

`cobranza.worker.detectarMorosos` exige dos condiciones:

```
comprobantes_vencidos >= aplicarCorte          ← 3
dias_vencido          >= diasGracia            ← 5
```

pero `dias_vencido` se calcula sobre **`MIN(fecha_vencimiento)`** — el comprobante **más
antiguo**, no el tercero:

```sql
MIN(fecha_vencimiento) AS vencimiento_mas_antiguo,
(CURRENT_DATE - im.vencimiento_mas_antiguo)::int AS dias_vencido
```

Con día de pago 10 y facturación mensual: la 1.ª vence el 10/01, la 2.ª el 10/02, la 3.ª el 10/03.
El 11/03 hay tres vencidas y el más antiguo lleva **60 días**, así que `60 >= 5` se cumple solo.
**Se corta el 11/03; según la respuesta 1 debería cortarse el 15/03.**

Y el efecto general es mayor que esos cuatro días: **con `aplicarCorte >= 2`, los días de gracia
no hacen nada nunca**, porque para cuando se acumula el segundo vencimiento el más antiguo ya
lleva un mes. La gracia solo influye con `aplicarCorte = 1`.

Nadie lo notó porque **con `aplicarCorte = 1` —el valor heredado por defecto— `MIN` y `MAX` son el
mismo comprobante** y el resultado coincide. El defecto solo aparecía en la configuración que el
propietario usa de verdad.

#### H-2 · `moroso` no lo escribe nadie, y dos módulos entienden lo contrario por él — **RESUELTO, ver §6.2**

La respuesta 2 lo define como *«pasó la fecha de corte pero sigue con servicio, usando gracia o
prórroga»*, y el comentario del enum dice exactamente eso: *«deuda activa, aún con servicio
(dentro de prórroga)»*.

**Hay 26 apariciones de `moroso` en el código y las 26 son LECTURAS**: tablas de transición,
filtros `IN (…)`, listas de reactivación. **Ninguna lo asigna.** El ciclo automático va
`activo → suspendido` directo, y el propio `cobranza.worker` lo dice: *«La prórroga ya no cambia
estado — el contrato permanece ACTIVO hasta que detectarMorosos lo suspende»*.

Consecuencia: **el estado que describe tu operación no existe en los datos.** Todo abonado en
mora con servicio figura como `activo`, indistinguible de uno al día. No se puede listar, ni
contar, ni notificar distinto.

Y hay una contradicción latente encima: `address-list-reconciliador.service.ts` declara

```ts
const ESTADOS_CORTADOS = ['suspendido', 'cortado', 'moroso'];
```

es decir, **trata `moroso` como SIN servicio**, justo lo contrario del enum y de la respuesta 2.
No ha dado la cara porque nadie asigna el estado — el mismo patrón que la nota de crédito: un
defecto que espera al primer uso. Si un operador marca `moroso` a mano (la transición está
permitida), el reconciliador le corta el tráfico en MikroTik.

#### H-3 · El primer comprobante del prepago SÍ se emite — pero lo emite el navegador — **CORREGIDO**

> **Corregido el 2026-08-08 tras una indicación del propietario:** *«la configuración de facturación
> se da por cliente, no por contrato; un contrato nuevo dentro del cliente nace con la configuración
> del cliente, así que si el cliente es prepago, al crear un servicio nuevo se debe emitir un
> comprobante. Esto ya está hecho»*.
>
> **Tenía razón, y mi hallazgo era falso en su parte principal.** Busqué la emisión en
> `contratos.service` —donde no está— y concluí que no existía. **Existe, y en los dos caminos**:

| Camino | Dónde | Cómo decide |
|---|---|---|
| Alta de abonado nuevo | `ClienteWizard.tsx:423-455` | `s2.facturacion.tipo === 'prepago'` (lo que el operador acaba de elegir) |
| **Servicio nuevo a un cliente existente** | `ClienteDetalle.tsx:1957-1984` | `clientesApi.getFacturacionConfig(clienteId)` → **lee la configuración del cliente**, exactamente como describe el propietario |

También cubre el **costo de instalación**, con o sin prepago. Y confirma la regla: **ninguno de los
dos mira `contratos.tipo_pago`** — la verdad para facturar es siempre la del cliente.

**Lo que queda en pie de H-3, y es distinto de lo que dije:**

**a) La emisión vive en el navegador.** Los dos caminos son código de frontend. Si el operador
cierra la pestaña, pierde la red, o el alta entra por API, importación o migración, **el prepago se
queda sin su comprobante**. Es la regla del corpus sobre wizards, al revés: el clic no puede ser la
frontera transaccional, porque no existe justo en los casos que la justifican.

**b) `catch { /* no bloquea el flujo principal */ }` — vacío, en los dos.** Si la emisión falla, el
error se descarta y el toast dice *«Abonado registrado correctamente»*. **Es un fallo de dinero,
silencioso y sin rastro**: nadie sabrá que ese prepago no tiene comprobante hasta que alguien lo
eche en falta.

**c) No usan la política canónica.** Construyen el periodo a mano —`hoy → hoy + 1 mes`— en vez de
`periodoServicio()`, que en prepago devuelve el **mes siguiente completo** (día 1 a fin de mes). El
periodo del primer comprobante no encaja con el de los siguientes.

**d) El vencimiento reintroduce el incidente del 2026-08-05.** El frontend no envía
`fechaVencimiento` —aunque el DTO lo acepta—, así que `facturacion.service.create` cae a
`calcularFechaVencimiento(empresas.dias_gracia)`: **hoy + días de gracia**. Es decir, el primer
comprobante **no vence en el `diaPago` que el operador acaba de configurar**, y usa los días de
gracia como distancia al vencimiento, que es exactamente lo que `PoliticaFacturacionService` existe
para prohibir.

**e) No envían `contratoId` —que el DTO también acepta—**, así que la factura nace consolidada
(`contrato_id` NULL) y sus ítems no llevan `contratoId`. `DeudaPorContratoService` no puede
imputarla: con un solo contrato vivo hay un fallback, pero **con el segundo servicio —el caso
exacto de la pregunta— la deuda queda sin imputar a ningún contrato** y se sale del corte por
contrato.

**Lo que sí subsiste tal cual:** `contratos.tipo_pago` es un campo **huérfano**. No lo lee la
facturación; solo el portal, para decidir si permite bajar de plan con deuda. Puede contradecir la
configuración del cliente sin que nada lo impida — no es «dos fuentes compitiendo por facturar»,
como escribí, sino **un campo que decide otra cosa a partir de una verdad que puede estar caducada**.

> **CORREGIDO el 2026-08-09.** La emisión se movió a `ContratosService.emitirComprobanteDeAlta`,
> dentro de la creación del contrato. Cubierto por `contratos/comprobante-de-alta.spec.ts` (12).

**Eran CUATRO defectos, no cinco.** El (d) —el vencimiento en `hoy + dias_gracia`— ya estaba
corregido cuando se fue a corregir: cayó con H-4, y `facturacion.service.create` lo materializa
ahora desde el día de pago del abonado y **rechaza** cualquier otro que se le mande. El apartado se
deja escrito arriba porque describe bien el defecto, pero no había nada que hacer con él. Es la
misma lección del §3.4: lo que un documento afirma envejece; antes de corregir, se mira el código.

**Cómo quedó.** El primer comprobante del prepago cubre **el ciclo prepagado completo** al precio
del contrato —no el del plan, para que respete el descuento pactado con ese abonado— y el cobro de
instalación viaja como un ítem más del mismo comprobante. El vencimiento no se pasa: lo pone la
política. Los días sueltos entre la instalación y el cierre del ciclo en curso **no entran aquí**:
son el prorrateo, y van al siguiente comprobante.

**El fallo ya no se pierde, pero tampoco tumba el alta.** El contrato está comprometido en la base
antes de emitir; hacerlo fallar por un correlativo dejaría al abonado sin servicio para arreglar un
problema de papeleo, y el operador ya no tiene los datos en pantalla. Queda en auditoría, con el
número de contrato y el motivo.

**Dos cosas que sólo aparecieron al corregirlo, y ninguna se veía desde el hallazgo:**

**1. El orden dentro de `onboarding` era una precondición, no un detalle.**
`saveFacturacionConfig` corría **después** de crear el contrato. Mientras la emisión vivía en el
navegador —en una tercera llamada, posterior a las dos— daba exactamente igual. Al traerla adentro,
ese orden habría hecho que la política se resolviera con los valores por defecto de la empresa:
**todo abonado prepago se habría facturado como postpago**, en silencio y con fechas plausibles.
Un fallo que ninguna prueba de tipos detecta y que en producción se ve semanas después, al no
aparecer el cobro. Hoy la configuración se guarda primero, y un test fija el orden.

**2. El manejador de errores podía lanzar.** El registro en auditoría se encadenaba con `.catch()`,
que revienta si la llamada no devuelve una promesa. Es decir: la vía que existe para que el alta
**no** se caiga podía ser justamente la que la tirara. Lo destapó el spec de contratos, cuyo doble
de auditoría no devuelve promesa; en producción bastaba con la tabla bloqueada. Va en su propio
`try`, con un test que lo ejercita.

Las dos son el mismo patrón, y merece la pena nombrarlo: **mover código de sitio no conserva sus
precondiciones**. Lo que era irrelevante en el navegador —el orden de dos llamadas, la forma del
valor de retorno de un doble— pasa a ser determinante dentro del servicio. Ninguna de las dos
estaba en el hallazgo, porque el hallazgo describía el defecto, no su corrección.


#### H-4 · El periodo del comprobante era el mes de calendario, no el ciclo del abonado — **CORREGIDO**

Lo señaló el propietario el 2026-08-08: *«comienzo de periodo es un día después de su fecha de
pago y fin de periodo es la siguiente fecha de pago»*. Tenía razón.

`periodoServicio()` devolvía `YYYY-MM-01` al último día del mes, con un desplazamiento de un mes
en prepago. Con día de pago 10, el comprobante decía **«01/03 – 31/03»** mientras el ciclo que el
abonado estaba pagando iba del **11/03 al 10/04**. El dato impreso era sencillamente falso.

Y era **incoherente con el resto del módulo**: la emisión, el vencimiento y el corte ya salían de
SU día de pago; solo el periodo seguía anclado al calendario. La regla ahora:

```
postpago (ya consumió)     vence 10/03  →  ampara 11/02 – 10/03
prepago  (por adelantado)  vence 10/03  →  ampara 11/03 – 10/04
```

El mismo intervalo en ambos; lo que cambia es si va por delante o por detrás del vencimiento. El
inicio es el **día siguiente** porque el día del pago pertenece al ciclo que se cierra: sin eso,
dos comprobantes consecutivos se solaparían un día y el abonado lo tendría facturado dos veces.

**Efecto lateral que había que resolver:** la generación masiva deduplicaba comparando
`periodo_inicio`/`periodo_fin` exactos, lo cual solo funcionaba mientras el periodo era el mismo
mes para todo el parque. Con ciclos por abonado eso deja de identificar nada, así que **la clave
pasa a ser el vencimiento**: un comprobante vivo por abonado y fecha de pago. Es la regla de
negocio real y no depende de cómo se decida nombrar el periodo mañana.

#### H-5 · El vencimiento se podía fijar por encima del día de pago — **CORREGIDO**

*«Dijimos que las fechas eran las mismas.»* Había **tres** puertas abiertas, y solo la emisión
automática hacía lo correcto:

| Puerta | Qué hacía |
|---|---|
| `create()` sin `fechaVencimiento` | Caía en **`hoy + empresas.dias_gracia`**. Ni el día de pago del cliente, y encima usando la gracia como distancia al VENCIMIENTO — el defecto exacto del incidente 2026-08-05, reintroducido por donde entra el primer comprobante de todo prepago |
| `create()` con `fechaVencimiento` | Aceptaba cualquier fecha, sin validar |
| `update()` | El vencimiento era **editable en una factura ya emitida** |

La tercera es la grave. `cobranza.worker` decide el corte contra el `fecha_vencimiento` **grabado**
en cada factura, precisamente para que un cambio de configuración no mueva una deuda ya notificada.
Dejarlo editable abría por detrás la puerta que ese invariante cierra por delante: mover el
vencimiento de una factura viva adelanta o retrasa un corte de servicio sin que nadie lo vea venir.

Ahora `create()` lo deriva de la política y **rechaza** —no ignora en silencio— un vencimiento que
no sea el del ciclo; `update()` no lo deja mover; y el campo está deshabilitado en los dos modales,
mostrando la fecha en vez de dejar escribirla.

#### H-6 · El tramo entregado hasta el corte no se factura nunca

`findContratosParaFacturar` filtra `AND co.estado = 'activo'`. **Un contrato suspendido no entra en
la generación.**

Con el escenario que planteó el propietario —emisión 23/08, vence 30/08, cinco días de gracia,
prórroga hasta el 07/09, se suspende el 07/09 y paga el 25/09—:

```
23/09   no se emite nada: el contrato está suspendido
        pero el abonado tuvo servicio del 31/08 al 07/09
```

**Ocho días entregados y jamás cobrados.** Y no se recuperan después: el siguiente comprobante
cubrirá octubre.

**Corrección de la primera versión de este hallazgo.** Se dijo que «el mes de suspensión sale
gratis», citando a Stripe —*«Invoices continue to be generated»*—. Era demasiado fuerte: la fuga son
**los días entregados antes del corte**, no el mes entero. Y la diferencia con Stripe se explica
sola: allí `unpaid` puede seguir con el servicio activo, así que sigue facturando; aquí la
suspensión **es** la interrupción del servicio, y facturar lo que no se entrega no es rigor, es
cobrar de más.

**Cómo se corrige:** prorrateando el borde, que es lo que el diseño ya define. La factura que
provocó el corte se debe entera —se entregó el mes completo—; el tramo del ciclo en curso hasta el
corte se prorratea; durante la suspensión no se factura nada.

#### H-7 · La reactivación exige deuda TOTAL cero, no deuda vencida

`pagos.service` comprueba `SUM(f.saldo) <= 0` sobre `sqlDeudaExigible`, **sin filtrar por fecha de
vencimiento**. Una factura emitida y todavía no vencida cuenta como deuda que impide reactivar.

**Hoy no se nota, porque H-6 lo tapa:** como no se factura a los suspendidos, nunca hay una factura
nueva que estorbe.

**Pero aparece en cuanto se corrija H-6.** Con el mismo escenario: el 23/09 se emitiría la factura de
septiembre, que vence el 30. El abonado paga agosto el 25 —lo que realmente debe— y **no se
reactivaría**, porque le queda septiembre pendiente aunque todavía no haya vencido.

Eso es exigirle pago adelantado para devolverle el servicio. La reactivación debe mirar la **deuda
vencida**, no la total.

> **Los dos están enlazados:** corregir H-6 sin corregir H-7 dejaría a los abonados que **sí pagan**
> sin poder reactivarse. No se pueden desplegar por separado.


#### H-8 · Prepago: el ciclo de la reactivación no lo emite nadie

Apareció **diseñando la corrección de H-6**, no analizándolo. Es la otra mitad del mismo
principio, y es peor en importe: H-6 se fuga días, H-8 se fuga un ciclo entero.

El prepago cobra por delante, así que el tramo consumido antes del corte **ya está facturado**
— ahí no hay fuga. La fuga está al volver:

```
23/09   generación del ciclo [30/09 → 31/10]  →  NO se emite: el contrato está suspendido
25/09   el abonado paga lo vencido y se reactiva
        ...tiene servicio, y ese ciclo no tiene comprobante
23/10   la siguiente generación ya cubre [31/10 → 30/11]
```

**Un ciclo completo sin comprobante**, y esta vez no son ocho días: es el mes entero. La
generación mensual es el único momento en que se emite, y el abonado no estaba activo cuando
pasó. Al volver, nadie mira hacia atrás.

Es simétrico de H-6 y no una casualidad: la generación decide con **el estado de hoy** lo que
debería decidir con **el tiempo entregado**. En postpago eso deja sin cobrar el tramo previo al
corte; en prepago deja sin cobrar el ciclo posterior a la reactivación.

**Se corrige con la otra mitad de la misma regla:** al reactivar se emite lo que falte del ciclo
en curso, prorrateado desde la fecha de reactivación. No es un mecanismo nuevo — es la misma
cuenta de días entregados, aplicada en el otro extremo.

---

### 5.2-bis Diseño acordado para H-6, H-7 y H-8

El principio, que es uno solo y cubre los tres:

> **Un abonado tiene comprobante por todo el tiempo en que tuvo servicio, y por ninguno en que
> no lo tuvo.**

**Días entregados.** La generación deja de preguntar «¿está activo hoy?» y pregunta «¿cuántos
días de este ciclo estuvo activo?», leyendo las transiciones de `contratos_historial`. Una sola
definición, la misma que necesita el prorrateo del alta.

**Convención de conteo — decidida el 2026-08-09.** El ciclo es un intervalo **cerrado**: es como
ya lo define `periodoServicio` —`[31/08, 30/09]`, y el siguiente abre el 01/10—. Por tanto:

```
días del ciclo   = fin   − inicio + 1
días entregados  = corte − inicio + 1     ← el día del corte SÍ se cuenta
```

Se propuso primero `[inicio, corte)`, media abierta, citando la convención Actual/Actual ISDA.
Estaba mal, y el error era de coherencia interna, no de referencia: ISDA describe periodos de
interés donde el fin de uno **es** el inicio del siguiente. Nuestro modelo es cerrado y el
siguiente abre al día después. Mezclar las dos convenciones inventa un día que no pertenece a
ningún ciclo. Stripe no zanja la duda porque no cuenta días —prorratea al segundo—, así que el
día del corte entra en proporción: más cerca de contarlo que de descartarlo.

La prueba de que la convención es la correcta: **los tramos parciales suman el ciclo entero.**
Cortar el último día da el ciclo completo; cortar el primero da un día.

**Ciclo completo sin división.** Si los días entregados son todo el ciclo, el importe es el precio
íntegro, sin pasar por la proporción. Si no, aparecen céntimos de redondeo en la factura normal de
todos los abonados para resolver un caso de borde de unos pocos.

**Reactivación — decidida el 2026-08-09: cero comprobantes vencidos.** No «bajar del umbral de
corte». Con H-6 corregido la deuda deja de crecer durante la suspensión, así que no existe la
trampa de pagar y seguir cortado para siempre. Se consulta a través de `SQL_COMPROBANTE_VENCIDO`
(`facturacion/domain/mora.ts`), que ya existe desde H-2, en **los dos** sitios que hoy miran la
deuda total: la reactivación automática de `pagos.service` y la guarda de cambio manual de estado
en `contratos.service`, que lee `c.deudaTotal`.

**Liquidación final — decidida el 2026-08-09: como el sector.** Un contrato que pasa a baja
definitiva con días entregados sin facturar recibe su comprobante de cierre. Es el *final bill*
del sector y evita que dar de baja sea una forma de perder el último tramo. Va en una segunda
tanda: no bloquea nada de lo anterior.


### 5.3 Reconocido por el propietario como pendiente de diseño

No son defectos: son trabajo que él mismo señala.

- **Nota de crédito (respuesta 5).** Hoy se **anula o se edita el pago** para corregir. Los dos
  modelos validados prohíben exactamente eso: un documento publicado no se modifica, se rectifica
  con otro documento. Es la diferencia entre «el importe cambió» y «hay constancia de por qué
  cambió». El ERP **ya tiene el mecanismo correcto construido** (`crearNotaCredito`, §3.3); lo que
  falta es decidir usarlo y cerrar la puerta de la edición.
- **Canales de cobranza (respuesta 7).** *«Construido pero no intuitivo ni flexible.»*
- **Comprobante por contrato vs. consolidado (respuesta 3).** A estudiar.
- **Cambios masivos de configuración (respuesta 9).** Funcionalidad prevista, con la pantalla de
  referencia ya identificada.

---

## 6. Estado y siguiente paso

Ya hecho:

- ~~Contrastar con un segundo modelo~~ → **ERPNext (§2.6) y Stripe (§2.7).** Convergen con Odoo en
  las decisiones estructurales, así que la tabla comparativa deja de ser el criterio de un
  fabricante. El tercero se añadió el 2026-08-09 **porque era donde estaba el error de §3.4**.
- ~~El flujo real de trabajo~~ → **§4, respondido el 2026-08-08**, y contrastado punto por punto
  contra el código en **§5**.
- ~~Convertirlo en decisión~~ → **[ADR-035](../gobierno/ADR-035-modelo-facturacion-tmforum.md)**,
  que clasifica los 20 conceptos contra TMF666 y propone las tres piezas que faltan.
- **El estudio ya se pagó solo, dos veces**: el contraste con el abono negativo destapó un defecto
  de dinero latente (§3.3), y el de Stripe destapó que el tope del anclaje en 28 evita el problema
  de febrero en lugar de resolverlo (PENDIENTES 29-ter). Ninguno dependía de qué modelo se elija.

**SUNAT ya no bloquea este ADR.** El propietario lo aclaró el 2026-08-08: *«aún no se emiten
comprobantes electrónicos con el API de SUNAT»*. Los tipos actuales (`int`, `fac`, `ci`) sirven para
**llevar la cuenta del IGV y de los impuestos** según la carga fiscal del comprobante y los
impuestos especiales que la configuración del abonado le asigne. La normativa pasa a ser una
**puerta del trabajo de emisión electrónica**, no de este estudio — y con un requisito ya
identificado: *«tendremos que ver el tema del correlativo y ajustarnos a las exigencias de SUNAT»*.
El correlativo actual se calcula por serie con `pg_advisory_xact_lock`, que es la parte difícil ya
resuelta; lo que cambiará es la forma de la serie y las reglas de anulación.

### 6.1 Estado de los hallazgos

| | Hallazgo | Estado |
|---|---|---|
| **H-1** | El corte no contaba «N vencidos + N días desde el último» | ✅ **CORREGIDO 2026-08-08.** `MAX` en vez de `MIN`; barrera de 8 tests |
| **H-3** | El primer comprobante del prepago lo emitía el **navegador**, con `catch` vacío, sin el ciclo del abonado y sin `contratoId` | **CORREGIDO 09/08.** Emisión dentro de la creación del contrato. Eran cuatro defectos: el vencimiento ya lo había cerrado H-4 |
| **H-6** | **El tramo entregado hasta el corte no se factura nunca** — la generación excluye a los suspendidos | **ABIERTO.** Se corrige prorrateando el borde |
| **H-7** | **La reactivación exige deuda TOTAL cero**, no vencida — quien paga lo que debe no se reactiva si tiene una factura emitida sin vencer | **ABIERTO, y enlazado a H-6:** no se pueden desplegar por separado |
| **H-8** | Prepago: tras reactivar, **el ciclo en curso no lo emite nadie** — la generación ya pasó mientras estaba suspendido | **Abierto.** La otra mitad de H-6: emitir al reactivar lo que falte del ciclo, prorrateado. Un mes entero, no ocho días |
| **H-2** | `moroso` no lo escribe nadie | ✅ **RESUELTO 2026-08-08, y no como se planteó**: la mora pasa a ser una **etiqueta derivada**, no un estado. Ver §6.2 |
| **H-4** | El periodo del comprobante era el mes de calendario, no el ciclo del abonado | ✅ **CORREGIDO 2026-08-08.** Del día siguiente a una fecha de pago hasta la siguiente. La deduplicación pasa a ir por vencimiento |
| **H-5** | El vencimiento se podía fijar por encima del día de pago — y **editar en una factura emitida** | ✅ **CORREGIDO 2026-08-08.** Derivado de la política, validado al crear, inmutable al editar |
| — | Nota de crédito vs. anular/editar (respuesta 5) | **Aplazado por el propietario**, sin bloquear nada. Ver §6.3 |
| — | Cambios masivos de configuración (respuesta 9) | Funcionalidad nueva, ya especificada |
| — | Comprobante por contrato vs. consolidado (respuesta 3) | A estudiar |
| — | Canales de cobranza (respuesta 7) | Rediseño, reconocido por el propietario |

### 6.2 H-2 — resuelto, y no como se había planteado

El propietario lo replanteó el mismo día, después de ver el radio del cambio:

> *«Que `moroso` no sea un estado, sea una **etiqueta** para el análisis estadístico.»*

**Es mejor diseño que el que él mismo había pedido antes**, y conviene dejar por qué:

1. **No se puede desincronizar.** Un estado almacenado es una segunda verdad que alguien
   debe acordarse de mantener; una etiqueta derivada de las facturas **es** la verdad. Es la
   lección de A-4 (la deuda en cuatro sitios) y la del latido derivado del `SchedulerRegistry`:
   lo que se deriva no se olvida.
2. **No toca el comportamiento operativo.** Era el problema real: `estado = 'activo'` aparece en
   **57 consultas**, y escribir `moroso` habría hecho desaparecer al abonado de todas ellas sin
   que nada fallara. La peor, `cobranza.worker.detectarMorosos`, filtra por `'activo'` — **el
   estado creado para medir la morosidad habría impedido cortar a los morosos.**
3. **Da historia gratis.** Un estado dice cómo está hoy. Las facturas dicen cómo estuvo siempre,
   y eso es justo lo que se quiere saber: *«¿qué probabilidad tiene de pasar a moroso? ¿es un
   moroso recurrente?»*.

**Aplicado el 2026-08-08** (`facturacion/domain/mora.ts`):

| Pieza | Qué es |
|---|---|
| `SQL_COMPROBANTE_VENCIDO()` | Qué cuenta como vencido e impago: exigible (ni pagada, ni anulada, ni nota de crédito), con saldo, y `fecha_vencimiento < CURRENT_DATE` — **desde el día siguiente al día de pago**, sin gracia dentro de la cuenta |
| `sqlEnMora(aliasCliente)` | La etiqueta: `EXISTS` de al menos uno. **Por cliente**, porque el comprobante es consolidado |
| `SQL_HISTORIAL_MORA` | `comprobantes`, `pagados_tarde`, `vencidos_hoy` → `tasaMora` y `recurrente` |

**El corte usa la misma definición.** `detectarMorosos` ya no reescribe las condiciones: importa
`SQL_COMPROBANTE_VENCIDO()` y encima cuenta cuántos hay y cuántos días lleva el último. Dos
preguntas distintas sobre **un solo criterio** — si divergieran, habría abonados etiquetados en
mora que el corte no ve, o al revés.

**Sin tabla nueva.** Una instantánea diaria habría dado lo mismo empezando desde hoy, con una
política de retención que mantener (C-7) y una fuente más que puede divergir. `facturas` ya guarda
`fecha_vencimiento` y `fecha_pago` desde el principio: la historia completa ya estaba escrita.

**El estado se BORRÓ.** La primera versión lo dejó «retirado pero presente», y el propietario
zanjó el matiz: *«el estado moroso nadie lo usa»*. Lo medí antes de tocarlo y tenía razón en un
sentido más fuerte del que yo daba por bueno: **cero contratos y cero registros entre las 44 filas
de `contratos_historial`**. No estaba en desuso — **no ocurrió nunca, ni una vez** en toda la vida
del sistema. Las transiciones registradas son solo `activo↔suspendido`, `activo→cortado`,
`pendiente_activacion→activo` y las bajas.

Fuera, entonces: las 26 referencias del backend, 2 filtros del frontend
(`ModalNuevaProrroga`, `finanzas/registro`) y el valor del `enum EstadoContrato`. Se conservan los
nombres que solo se llaman igual —el address-list `morosos_datafast` de MikroTik, el job
`detectar-morosos`, la clase CSS `badge-moroso`—: son otra cosa, y castigar el nombre en vez del
uso es como se fabrican los falsos positivos.

**Un residuo, y va a la instalación limpia:** el valor sigue en el tipo `estado_contrato` de
PostgreSQL. Quitarlo obliga a recrear el tipo con las tres columnas que dependen de él
(`contratos.estado`, `contratos_historial.estado_anterior` y `estado_nuevo`) más la vista
`v_contratos_completos` — irreversible, y sin ganancia funcional ahora que ningún código lo nombra.
En la instalación limpia el tipo nace ya sin él.

**Y se corrigió la contradicción latente.** `address-list-reconciliador` tenía `moroso` dentro de
`ESTADOS_CORTADOS`, es decir lo leía como «sin servicio», al revés del enum y de la definición del
propietario. Nunca dio la cara porque nadie asignaba el estado; un operador que lo pusiera a mano
le habría cortado el tráfico a un abonado que por definición debía conservarlo. Producción tenía
**0 contratos en `moroso`**, comprobado antes de tocarlo, así que el cambio no movió nada hoy.

Primer consumidor real, para que la definición no naciera como código muerto: el dashboard expone
`contratos.enMora`. Se **solapa con `activos` a propósito** — son dos preguntas, no dos casillas
excluyentes.

Barrera `mora-es-etiqueta.spec.ts`: nadie asigna el estado (distinguiendo escritura de `where`,
porque buscar contratos en `moroso` sigue siendo legítimo), la tabla no ofrece entradas, y
`ESTADOS_CORTADOS` no lo contiene.

### 6.3 Lo que queda anotado sin bloquear

**Anular emite una nota de crédito sin decirlo.** El frontend llama a `PATCH /facturacion/:id/anular`
con solo `{ motivo }`, y el backend crea la NC salvo que reciba `crearNotaCredito: false`. El
diálogo de confirmación dice únicamente *«Se anulará el comprobante. Deja de ser exigible al
cliente»* — no menciona que se acuña un documento nuevo con serie `NC-…` y correlativo propio.

Como el flujo real es **anular para poder editar** (respuesta 5), cada edición generaría en silencio
un comprobante que nadie pidió. **Latente:** producción tiene 0 anulaciones.

El propietario lo aplazó explícitamente, y **no bloquea nada**: no hay notas de crédito emitidas,
y desde A-5 una nota de crédito ya no se cuenta como deuda, que era el daño real. Queda como
decisión de operación para cuando se aborde el modelo del abono.

Con eso, esto se convierte en el **ADR de benchmark** que decide qué modelo se adopta, qué se
descarta y **qué invariantes propios se conservan pese a la adopción**.

---

## 7. Fuentes

- [Customer invoices — Odoo 18](https://www.odoo.com/documentation/18.0/applications/finance/accounting/customer_invoices.html)
- [Credit notes and refunds — Odoo 18](https://www.odoo.com/documentation/18.0/applications/finance/accounting/customer_invoices/credit_notes.html)
- [Payment terms — Odoo 18](https://www.odoo.com/documentation/18.0/applications/finance/accounting/customer_invoices/payment_terms.html)
- [Follow-up documents (dunning) — Odoo 18](https://www.odoo.com/documentation/18.0/applications/finance/accounting/payments/follow_up.html)
- [Subscriptions — Odoo 18](https://www.odoo.com/documentation/18.0/applications/sales/subscriptions.html) ·
  [Scheduled actions](https://www.odoo.com/documentation/18.0/applications/sales/subscriptions/scheduled_actions.html)
- [Stripe — Set the subscription billing renewal date](https://docs.stripe.com/billing/subscriptions/billing-cycle) ·
  [The Subscription object](https://docs.stripe.com/api/subscriptions/object) ·
  [Automate payment retries](https://docs.stripe.com/billing/revenue-recovery/smart-retries)
- [Payment Terms Template — ERPNext](https://docs.frappe.io/erpnext/user/manual/en/payment-terms-template)
- [Dunning — ERPNext](https://docs.frappe.io/erpnext/user/manual/en/dunning)
- [Credit Note — ERPNext](https://docs.frappe.io/erpnext/user/manual/en/credit-note)
- [Subscription — ERPNext](https://docs.frappe.io/erpnext/user/manual/en/subscription)
