# ADR-035 — Modelo de facturación: se adopta el del sector y se clasifica cada divergencia

**Estado:** **Propuesta** — 2026-08-09, a partir de una recomendación del propietario
**Decide:** Datafast · **Aplica:** **POL-001 PD-13** · **Refina:** ADR-030 ·
**Sustituye:** la recomendación circulada como «R-036 — Separar Identidad, Cuenta de Facturación,
Suscripción y Servicio», cuya premisa era incorrecta (§2) y cuyo número ya está ocupado

---

## 1. Problema

El módulo de facturación se construyó desde cero. El propietario lo planteó así:

> *«Este es el core y debería estar 100 % saneado… es por eso mi solicitud de alinearnos a modelos
> ya validados y no hacer todo desde 0.»*

Y añadió el criterio que decide contra qué se compara:

> *«No tenemos planes triple play nosotros, pero sí otro operador que utilice el ERP. Es por eso
> que buscamos estandarizar modelos y conductas que estén validadas en nuestro mismo sector.»*

Eso es **PD-13**: el modelo se diseña contra la forma del sector, no contra el estado de la
instalación. Este ADR aplica esa política al modelo de facturación.

---

## 2. La premisa que hay que corregir antes de decidir nada

La recomendación original afirmaba que el ERP está construido sobre el supuesto **1 cliente =
1 servicio** y que había que corregir el modelo en la raíz. **Es falso**, verificado contra la base
de producción el 2026-08-09:

| Nivel del modelo propuesto | Qué existe hoy |
|---|---|
| Identidad única | `clientes` + índice único `(empresa_id, tipo_documento, numero_documento)` |
| Servicio, N por cliente | `contratos.cliente_id` — nada lo limita a uno |
| Ubicación del servicio | `contratos.direccion_instalacion`, `latitud_instalacion`, `longitud_instalacion`, `caja_nap`, `puerto_nap` |
| Recursos técnicos del servicio | `contratos.ip_asignada`, `usuario_pppoe`, `router_id`, `onu_id`, `segmento_id`; `ftth_onu_registro.contrato_id` |
| Cargos | `cargos_pendientes` |
| Comprobante | `facturas`, consolidada, con `contratoId` por ítem |
| Pagos | `pagos` + `pago_aplicaciones` |
| **Cuenta de facturación** | **No existe** |

El caso que motivaba la propuesta —Juan Pérez, un DNI, dos servicios en dos direcciones con dos
ONUs— **funciona hoy tal cual**. Hay además índices únicos por ONU, PPPoE, MAC e IP que impiden que
dos contratos compartan recurso.

**Importa corregirlo** porque una norma que describe mal el punto de partida manda a alguien a
reconstruir lo que ya existe. Seis de los siete niveles están; falta uno.

---

## 3. Lo estudiado, con fuentes

**PD-13 §1 y PD-11 exigen fuente citable.** Se consultaron cuatro modelos:

| Modelo | Qué aporta |
|---|---|
| **TM Forum SID / TMF666** | El modelo de datos del sector telecom. Define `PartyAccount`, `BillingAccount`, `BillingCycleSpecification` |
| **Stripe Billing** | `billing_cycle_anchor_config.day_of_month`, `days_until_due`, recuperación de impagos |
| **Odoo 18** | Términos de pago, notas de crédito por reversión, *follow-up levels* |
| **ERPNext** | *Payment Terms Template*, *Dunning*, `generate_invoice_at` |

Definiciones que deciden este ADR, textuales:

> **`BillingAccount`** — *«A party account used for billing purposes. It includes a description of
> the bill structure (frequency, presentation media, format and so on). It is a specialization of
> entity `PartyAccount`.»*
>
> **`AccountRelationship`** — *«Significant connection between accounts. For instance an aggregating
> account for a list of shop branches each having its own billing account.»*
>
> **`BillingCycleSpecification`** — *«A detailed description of when to initiate a billing cycle and
> the various sub steps of a billing cycle.»* Campos: `billingDateShift`, `billingPeriod`,
> `frequency`, `mailingDateOffset`, **`paymentDueDateOffset`**, `chargeDateOffset`,
> `creditDateOffset`, `validFor`.

La segunda cita es el caso de las sedes con factura separada, en el estándar y con esas palabras.

---

## 4. Decisión

**Se adopta el modelo del SID para facturación, en tres piezas y por fases**, y **se clasifica cada
concepto propio** como exige PD-13.

### 4.1 Las tres piezas que faltan

| # | Pieza | Por qué, con el caso inexpresable que la justifica (PD-13 §2) |
|---|---|---|
| **1** | **`BillingAccount`** entre cliente y contrato | «Boleta en casa y factura en el negocio, mismo titular» **no se puede escribir** hoy: `comprobanteConfigId` es uno por cliente. Tampoco «una factura por sede», que es el ejemplo textual del estándar |
| **2** | **`BillingCycleSpecification`** como objeto reutilizable | Hoy el ciclo son campos sueltos en un JSONB del cliente. Como objeto con nombre, cambiar una política deja de ser abonado por abonado — que es el hueco real de las plantillas |
| **3** | **Libro de cargos** | `cargos_pendientes` solo lo usan mora y reconexión; el cargo recurrente se calcula en línea al facturar. Sin libro, el prorrateo y los cargos únicos son casos especiales para siempre |

### 4.2 Lo que se recorta de la propuesta

> ⚠️ **RETIRADO el 2026-08-09.** Este recorte decia que `Subscription -> Service -> Service
> Instance` eran «tres nombres para una cosa **cuando no hay composicion de producto**». El
> propietario definio despues los servicios que va a vender —**internet y cable, sueltos o
> juntos, mas streaming como adicional**—, y eso **es** composicion. TMF637 la modela con
> `isBundle` y con dos relaciones distintas, `[bundled]` y `[reliesOn]`.
>
> Fue criterio propio aplicado **en el documento que implementa la politica que lo prohibe**
> (PD-13: no anadir niveles que el estandar no separa — pero tampoco quitar los que si separa).
>
> Lo que sustituye a este apartado esta en
> [`docs/estudio/catalogo-servicios-notas.md`](../estudio/catalogo-servicios-notas.md), todavia
> como notas de discusion. Se incorporara aqui cuando cierre.

---

## 5. Clasificación de lo que ya existe — **el entregable que PD-13 exige**

Cuatro estados. **Alineado** se distingue de **adoptado** a propósito: lo primero es coincidir sin
haberlo buscado, y conviene saber cuál es cuál.

### 5.1 Estructura

| Concepto propio | Correspondencia en el estándar | Estado |
|---|---|---|
| `clientes` (identidad, documento único) | SID `Party` / `Customer` | **Adoptado** |
| `contratos` (plan, ubicación, recursos) | SID `Service` | **Adoptado** — nombre propio, misma forma |
| `contratos.direccion_instalacion` + coords + NAP | SID *service location* | **Adoptado** |
| `ip_asignada`, `usuario_pppoe`, `onu_id`, `router_id` | SID `Resource` | **Adoptado** |
| `pagos` + `pago_aplicaciones` | Imputación de pagos | **Adoptado** |
| **cuenta de facturación** | TMF666 `BillingAccount` | **FALTA** → §4.1 |
| `facturas.items` como **JSONB** | Línea de factura como entidad (Odoo, ERPNext) | **Adaptado en ESTRUCTURA — deuda conocida.** Un nombre de campo mal escrito dentro del JSON es invisible para el compilador |
| Nota de crédito **positiva** + `factura_original_id` | Odoo: asiento de reversión · ERPNext: `is_return` con importes negativos | **Adaptado en ESTRUCTURA — deuda conocida (A-5).** El CHECK `total >= 0` impide el negativo; obligó a distinguirla por documento en 18 consultas |
| Comprobante **consolidado** por cliente | — | **Extendido** — decisión de producto |

### 5.2 Fechas del ciclo

| Concepto propio | Correspondencia | Estado |
|---|---|---|
| `diaPago` como ancla | `BillingCycleSpecification.billingDateShift` · Stripe `day_of_month` | **ADOPTADO 2026-08-09.** Anclaje 1–31 con recorte a fin de mes y sin deriva, como el ejemplo de Stripe |
| `crearFactura` (N días antes) | `mailingDateOffset` · ERPNext `Bill N days before` | **Alineado** — equivalente exacto, y ERPNext lo tiene como uno de sus tres modos |
| **vencimiento = `diaPago`** | `paymentDueDateOffset` | **Adaptado con el campo ausente.** Equivale a un offset de 0, pero **no existe como campo**, así que un plazo de crédito es inexpresable. Stripe lo confirma: el vencimiento coincide con el ancla solo cuando el cobro es automático |
| Periodo = ciclo del abonado | `billingPeriod` | **Adoptado** — corregido el 2026-08-08; antes era el mes de calendario |
| `diasGracia` (distancia vencimiento→corte) | — | **Extendido.** Invariante ganado en el incidente del 05/08. R-001 lo protege: no se elimina por adoptar un modelo externo |
| — | `chargeDateOffset` / `creditDateOffset` | **No considerado.** Hasta qué fecha entra un cargo en esta factura o pasa a la siguiente. Hace falta para el prorrateo |

### 5.3 Cobranza

| Concepto propio | Correspondencia | Estado |
|---|---|---|
| `aplicarCorte` (N comprobantes acumulados) | Stripe corta *«after the maximum number of days defined in the retry schedule»*; cuenta **intentos de cobro**, no comprobantes | **Extendido, y bien.** Sin cobro automático no hay intentos que contar: contar comprobantes es la misma intención trasladada al cobro manual |
| Mora como **etiqueta derivada** | Condición derivada, no estado del contrato | **Adoptado** — corregido el 2026-08-08 |
| Ciclo y plazo de pago **por abonado** | Stripe: por suscripción · Odoo y ERPNext: por cliente | **ALINEADO.** Se afirmó dos veces que divergía; es falso |
| Escala de recordatorios **por abonado** | Odoo: *follow-up levels* centrales · ERPNext: `Dunning Type` reutilizable | **Adaptado — decisión de producto.** Es lo único que de verdad diverge, y `plantillas_abonados` lo mitiga a medias |
| Prórroga como acuerdo puntual | Odoo: paso de automático a manual por cliente | **Alineado** |

> **Nota sobre la fila «alineado» de §5.3.** La afirmación *«la configuración por abonado va contra
> los tres modelos»* se escribió, se retiró del estudio tras una corrección del propietario, y **se
> repitió dos días después** en un resumen. Es la razón por la que PD-13 §4 exige el mapa escrito
> por concepto y no solo la corrección en prosa.

---

## 6. Fases

**PD-13 §5 — se adopta en la ventana barata.** Producción tiene **16 clientes, 2 contratos vivos y
4 facturas**, y hay una instalación limpia planificada. Con 5.000 abonados esto es una migración
seria; ahora es un cambio de esquema.

| Fase | Alcance | Cuándo |
|---|---|---|
| **1** | `BillingAccount`, **una por cliente creada automáticamente**, invisible en la UI. El ciclo y el tipo de comprobante se mudan a ella | **Antes de la instalación limpia** |
| **2** | `paymentDueDateOffset` como campo, con valor 0 por defecto — nada cambia para nadie | Con la fase 1 |
| ~~**3**~~ | ~~Anclaje 1–31 con recorte a fin de mes~~ | ✅ **HECHA 2026-08-09.** Era independiente del resto |
| **4** | Libro de cargos + `chargeDateOffset`/`creditDateOffset` + prorrateo | **Con SUNAT**, no antes: la emisión electrónica toca el mismo código (correlativo, series, anulaciones) y hacerlo dos veces sale caro |
| **5** | Segunda cuenta por cliente visible en la UI | Cuando exista el caso |

**El orden 1 → instalación limpia no es negociable.** Si la beta arranca sobre el modelo actual,
`BillingAccount` deja de ser un cambio de esquema y pasa a ser una migración con datos de abonados
reales.

---

## 7. Consecuencias

**A favor.** El modelo pasa a ser citable ante un tercero. Quedan expresables el titular con boleta
y factura, las sedes con factura separada, el tercero pagador y el plazo de crédito. Y el mapa de
§5 evita que la próxima revisión vuelva a discutir qué es propio y qué es del sector.

**En contra.** La fase 1 toca el eje del dinero: `facturas.cliente_id`, `pagos.cliente_id`,
`cargos_pendientes.cliente_id`, `clientes.facturacion_config`, `DeudaPorContratoService`, la
etiqueta de mora, la reactivación tras el cobro y el portal. No es una tabla: es una migración
acotada por el volumen actual, no por el alcance.

**Deudas que este ADR reconoce y no resuelve.** Las dos adaptaciones de estructura de §5.1 —el
ítem en JSONB y el abono positivo— siguen siendo divergencias caras. No se corrigen aquí porque
ambas cambian el modelo de dinero; quedan declaradas para que nadie las tome por estándar.

---

## 8. Decisiones abiertas del propietario

1. **¿Se aprueban las fases 1 y 2 antes de la instalación limpia?**
2. ~~**Prorrateo** — ¿en qué eventos, y el tope?~~ **CERRADO el 2026-08-09 → PD-14.** Base
   `ACTUAL_360` (días reales / 30), conteo inclusivo en los dos extremos, redondeo único y base
   congelada en el ítem. Los eventos quedan los tres: **alta** a mitad de ciclo, **cambio de plan**
   y **baja de postpago**; la **baja de prepago NO prorratea** —el periodo está comprado y el
   servicio corre hasta su fin—. El tope desapareció: con la regla del ciclo completo es
   inalcanzable, así que es un test y no una rama.

   **Queda un resto sin decidir:** el cambio de plan a mitad de ciclo, en el sector, produce **dos
   apuntes de signo contrario** —crédito por el tiempo no consumido del plan viejo y cargo por el
   restante del nuevo—, no un importe recalculado. El total sigue siendo positivo, así que
   `facturas_total_check` no estorba, pero **los ítems tendrían que admitir importe negativo** y hoy
   no está previsto en ninguna parte del diseño.
3. **¿La nota de crédito y los cargos únicos vencen en el ancla del abonado o el día de emisión?**
   Hoy hay tres reglas distintas y ninguna declarada.
4. **Los cinco campos de configuración que no hacen nada** (`aplicarMora`, `montoMora`,
   `aplicarReconexion`, `montoReconexion`, `esquemaImpuesto`, `impuesto1`): se implementan o se
   retiran de la pantalla. Un documento de política que los liste como política sería peor que no
   tenerlo.

---

## 9. Fuentes

- [TMF666 Account Management API — especificación v4.0.0](https://github.com/tmforum-apis/TMF666_AccountManagement) *(definiciones de `BillingAccount`, `PartyAccount`, `BillingCycleSpecification`, `AccountRelationship` extraídas del swagger)*
- [TMF666 Account Management API REST Specification](https://www.tmforum.org/resources/specification/tmf666-account-management-api-rest-specification-r19-0-0/)
- [GB922 Information Framework (SID)](https://www.tmforum.org/resources/suite/gb922-information-framework-sid-r17-0-1/)
- [Stripe — Set the subscription billing renewal date](https://docs.stripe.com/billing/subscriptions/billing-cycle) · [The Subscription object](https://docs.stripe.com/api/subscriptions/object) · [Automate payment retries](https://docs.stripe.com/billing/revenue-recovery/smart-retries)
- [ERPNext — Payment Terms Template](https://docs.frappe.io/erpnext/user/manual/en/payment-terms-template) · [Dunning](https://docs.frappe.io/erpnext/user/manual/en/dunning) · [Credit Note](https://docs.frappe.io/erpnext/user/manual/en/credit-note) · [Subscription](https://docs.frappe.io/erpnext/user/manual/en/subscription)
- [Odoo 18 — Payment terms](https://www.odoo.com/documentation/18.0/applications/finance/accounting/customer_invoices/payment_terms.html) · [Credit notes](https://www.odoo.com/documentation/18.0/applications/finance/accounting/customer_invoices/credit_notes.html) · [Follow-up documents](https://www.odoo.com/documentation/18.0/applications/finance/accounting/payments/follow_up.html)
- Estudio interno: `docs/estudio/facturacion-cobranza-benchmark.md`
