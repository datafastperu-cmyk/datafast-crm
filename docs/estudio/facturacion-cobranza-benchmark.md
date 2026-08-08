# Estudio — Cómo resuelven facturación y cobranza los modelos validados

**Naturaleza:** documento de **estudio**, no normativo. Es el insumo del ADR de benchmark que
PD-11 exige antes de diseñar. **No decide nada todavía.**
**Fecha:** 2026-08-08 · **Estado:** parcial — falta confirmar el flujo real de Datafast (§4)

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

---

## 3. La comparación estructural

| Concepto | Modelo validado | Datafast hoy |
|---|---|---|
| **Vencimiento** | *Payment term* reutilizable en el cliente; **puede producir varias fechas** (cuotas) | `diaPago`, un entero (1..28) dentro de un JSONB del cliente. Una sola fecha |
| **Escala de avisos** | **Central**, una para toda la empresa; la excepción es por cliente | **Toda la configuración es por cliente** |
| **Preaviso** | Un nivel más, con días negativos | Mecanismo aparte (`crearFactura`, `notif-preventivas`) |
| **Corte** | *Automatic Closing* = N días sin pago | **Dos condiciones**: `diasGracia` **y** `aplicarCorte` (comprobantes acumulados) |
| **Línea de factura** | Entidad con producto, cantidad, impuestos | **JSONB** |
| **Nota de crédito** | Mismo objeto + **asiento de reversión** que la liga al original | Valor del enum `tipo_comprobante`, **sin relación al documento que rectifica** |
| **Próxima emisión** | Campo `Next Invoice Date` en la suscripción | Se **deriva** del `diaPago` en cada corrida del cron |
| **Inmutabilidad** | Publicada no se modifica; para cambiarla, se revierte | Estados `borrador → emitida`, sin regla equivalente escrita |

### 3.1 El hallazgo que probablemente explica el desorden

> **Odoo centraliza la escala de cobranza y deja en el cliente solo el término de pago y las
> excepciones. Datafast pone TODO en el cliente.**

Eso encaja con el síntoma descrito —*«tiene configuradas las prórrogas, meses acumulados para el
corte, tipo de comprobante y más… y no están funcionando correctamente»*—: mantener **N escalas de
cobranza**, una por abonado, es un orden de magnitud más de superficie que mantener una y marcar
excepciones.

**No es una conclusión todavía.** Es la hipótesis que §4 debe confirmar o descartar, porque un ISP
peruano puede tener razones para lo contrario.

### 3.2 Dos cosas de Datafast que el modelo externo NO trae

Van aquí para que el benchmark no las borre por parecer anomalías:

1. **El corte por comprobantes acumulados.** Odoo cierra por días sin pago; Datafast exige además
   N comprobantes vencidos. Para un ISP con abonados que pagan tarde de forma habitual, cortar al
   primer impago sería comercialmente inviable. **Parece una adaptación correcta al negocio.**
2. **La gracia como distancia vencimiento→corte.** Invariante ganado en el incidente del
   2026-08-05 y protegido por el guard 2 de PD-11. **No se toca.**

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
5. **Nota de crédito.** ¿En qué casos se emite hoy, y quién la emite? ¿Se relaciona a mano con la
   factura que corrige?
6. **Tipo de comprobante** (boleta/factura). ¿Lo decide el cliente, el importe, o el operador?
7. **Canales de cobranza.** Existen las tablas `canal_pago` y `forma_pago`. ¿Qué representa un
   canal en vuestro flujo, y quién lo elige?
8. **Prórroga.** ¿Es un acuerdo puntual con el abonado, o una política que se aplica sola?

---

## 5. Estado y siguiente paso

**Parcial.** Falta:

- Las respuestas de §4.
- Contrastar con al menos **un segundo modelo** — ERPNext o similar— para no adoptar el criterio de
  un solo producto.
- **La normativa SUNAT** para el comprobante electrónico, que es 🔴 por interoperabilidad
  (ADR-034) y donde PD-12 exige fijar el marco legal **antes** del diseño.

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
