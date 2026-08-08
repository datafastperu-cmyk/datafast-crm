# Estudio — Cómo resuelven facturación y cobranza los modelos validados

**Naturaleza:** documento de **estudio**, no normativo. Es el insumo del ADR de benchmark que
PD-11 exige antes de diseñar. **No decide nada todavía.**
**Fecha:** 2026-08-08 · **Estado:** parcial — falta confirmar el flujo real de Datafast (§4) y la
normativa SUNAT. Dos modelos externos ya contrastados (Odoo 18 y ERPNext).
**Resultado ya aplicado:** un defecto de dinero latente encontrado y corregido (§3.3).

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
(los conoce), que la política canónica no los exponía (los expone) y que nadie asignaba los
estados `moroso`/`cortado` (los asigna, 12 veces cada uno). El módulo está bastante más completo
de lo que sugerían mis catas.

**Este documento recoge solo el lado externo.** El lado interno —el flujo real— está en §4 como
preguntas, no como conclusiones.

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

---

## 3. La comparación estructural

| Concepto | Modelo validado | Datafast hoy |
|---|---|---|
| **Vencimiento** | *Payment term* reutilizable en el cliente; **puede producir varias fechas** (cuotas) | `diaPago`, un entero (1..28) dentro de un JSONB del cliente. Una sola fecha |
| **Escala de avisos** | **Central**, una para toda la empresa; la excepción es por cliente | **Por cliente — decisión deliberada de producto** (§3.1). Existe `plantillas_abonados` como esquema con nombre, pero se **copia** al alta, no se referencia |
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

**Lo que este arreglo NO decide** es si el abono debe ser negativo, como en los dos modelos
validados. Eso exige quitar el CHECK y revisar toda la agregación, y es materia del ADR. Que un
abono no cuente como cargo no depende del modelo que se acabe eligiendo.

---

## 4. Lo que falta: el flujo real — **preguntas, no conclusiones**

Sin esto el estudio no puede convertirse en ADR. Son puntos donde **el código no revela la
intención**, y responderlos mal produciría el peor resultado posible: cambiar algo que estaba bien.

1. **El corte.** Con «aplicar corte = 3» y gracia de 5 días, ¿la intención es cortar **al acumular
   3 comprobantes vencidos Y pasados 5 días del último**, o **5 días después del tercer
   vencimiento**? El código hace lo primero.
2. **`moroso` vs `cortado`.** El enum los distingue —*«moroso: deuda activa, aún con servicio»*—
   pero un comentario de `cobranza.worker` dice que la prórroga ya no cambia el estado. ¿Cuándo
   entra `moroso` en la práctica, y qué lo distingue de `suspendido`?
3. **Comprobante consolidado.** Un abonado con dos servicios recibe **uno solo**, con
   `contrato_id` en NULL. ¿Es siempre así, o hay casos de comprobante por contrato?
4. **Prepago / postpago.** La política contempla ambos. ¿Se usa alguno de los dos hoy?
5. **Nota de crédito.** ¿En qué casos se emite hoy, y quién la emite? (La relación con la factura
   corregida **sí existe** y es automática — ver §3.3; lo que falta saber es el uso real.)
6. **Tipo de comprobante** (boleta/factura). ¿Lo decide el cliente, el importe, o el operador?
7. **Canales de cobranza.** Existen las tablas `canal_pago` y `forma_pago`. ¿Qué representa un
   canal en vuestro flujo, y quién lo elige?
8. **Prórroga.** ¿Es un acuerdo puntual con el abonado, o una política que se aplica sola?
9. **Plantillas de abonado.** Al cambiar una política —por ejemplo, gracia de 5 a 7 días—,
   ¿cómo se hace hoy con los abonados que ya existen? ¿Uno a uno, o hay algún camino que no he
   visto? La respuesta decide si el hueco de §3.1 es real o solo aparente.

---

## 5. Estado y siguiente paso

**Parcial.** Falta:

- Las respuestas de §4.
- **La normativa SUNAT** para el comprobante electrónico, que es 🔴 por interoperabilidad
  (ADR-034) y donde PD-12 exige fijar el marco legal **antes** del diseño.

Ya hecho:

- ~~Contrastar con un segundo modelo~~ → **ERPNext, §2.6.** Converge con Odoo en las seis
  decisiones estructurales, así que lo de la tabla comparativa deja de ser el criterio de un
  fabricante.
- **El estudio ya se pagó solo**: el contraste con el abono negativo de ambos modelos destapó un
  defecto de dinero latente en el ERP, corregido y con barrera (§3.3). No hizo falta esperar al
  ADR para eso, porque no dependía de qué modelo se elija.

Con eso, esto se convierte en el **ADR de benchmark** que decide qué modelo se adopta, qué se
descarta y **qué invariantes propios se conservan pese a la adopción**.

---

## 6. Fuentes

- [Customer invoices — Odoo 18](https://www.odoo.com/documentation/18.0/applications/finance/accounting/customer_invoices.html)
- [Credit notes and refunds — Odoo 18](https://www.odoo.com/documentation/18.0/applications/finance/accounting/customer_invoices/credit_notes.html)
- [Payment terms — Odoo 18](https://www.odoo.com/documentation/18.0/applications/finance/accounting/customer_invoices/payment_terms.html)
- [Follow-up documents (dunning) — Odoo 18](https://www.odoo.com/documentation/18.0/applications/finance/accounting/payments/follow_up.html)
- [Subscriptions — Odoo 18](https://www.odoo.com/documentation/18.0/applications/sales/subscriptions.html) ·
  [Scheduled actions](https://www.odoo.com/documentation/18.0/applications/sales/subscriptions/scheduled_actions.html)
- [Payment Terms Template — ERPNext](https://docs.frappe.io/erpnext/user/manual/en/payment-terms-template)
- [Dunning — ERPNext](https://docs.frappe.io/erpnext/user/manual/en/dunning)
- [Credit Note — ERPNext](https://docs.frappe.io/erpnext/user/manual/en/credit-note)
- [Subscription — ERPNext](https://docs.frappe.io/erpnext/user/manual/en/subscription)
