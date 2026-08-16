# ADR-037 — Los estados de «no llegó a empezar»: se añaden `CANCELADO` a A §16 y `RECHAZADO` a C §5

**Estado:** **Aceptada** — 2026-08-15, Datafast
**Decide:** **Propietario del producto** — modifica corpus congelado
**Modifica:** **A §16** (estados del Contrato) · **C §5** (estados del proceso de fulfillment)
**Origen:** hallazgos **H-4** y **H-7b** de [core-benchmark.md](../estudio/core-benchmark.md),
abiertos en **ADR-036 §4.3 y §4.3bis**
**Relacionado:** E-0.2 D-5 · E-0.3 D-16 · C §37

> **Este ADR modifica documentos congelados.** Se emite por la vía que el propio corpus exige
> —revisión arquitectónica explícita, decisión del propietario y registro del motivo (E-0.1 §36,
> CON-001 §8.10 regla 3)— y no por la vía de los hechos, que quedó expresamente prohibida mientras
> la revisión estuvo abierta.

---

## 1. Problema

Al contrastar el diseño del Core contra las especificaciones publicadas apareció **dos veces el mismo
hueco**, en dos documentos distintos y en dos planos distintos:

| Plano | Documento | Estados que tiene | Lo que no puede expresar |
|---|---|---|---|
| **Contractual** | A §16 | `PENDIENTE DE ACTIVACIÓN` · `ACTIVO` · `SUSPENDIDO` · `BAJA DEFINITIVA` | El contrato que **se cancela sin haberse activado nunca** |
| **Ejecución** | C §5 | `PENDIENTE` · `EN PROCESO` · `PARCIAL` · `BLOQUEADO` · `ERROR` · `COMPLETADO` · `CANCELADO` | La orden que **se rechaza de entrada y no llega a ejecutarse** |

**Lo llamativo es que el caso ya estaba descrito.** **C §37** dedica una sección entera a *«si el
cliente desiste antes de activarse»* — y A §16 no tiene dónde registrarlo. Hoy solo cabría como
**baja definitiva**, que significa otra cosa: que el servicio existió y se retiró.

> **Que el hueco aparezca dos veces sugiere criterio, no descuido: se modelaron los caminos que
> avanzan y no los que no arrancan.**

---

## 2. Evidencia

Ambas especificaciones distinguen explícitamente lo que terminó de lo que nunca empezó.

| Fuente | Qué dice |
|---|---|
| **TMF637 v4.0.0** — `ProductStatusType` | `created` · `pendingActive` · **`cancelled`** · `active` · `pendingTerminate` · **`terminated`** · `suspended` · `aborted` |
| **TMF641 v3.0.0** — `ServiceOrderStateType` | `acknowledged` · **`rejected`** · `pending` · `held` · `inProgress` · `cancelled` · `completed` · `failed` · `partial` |

`cancelled` y `terminated` son **estados distintos** en el estándar. `rejected` y `failed`, también.

---

## 3. Decisión

### 3.1 A §16 incorpora `CANCELADO`

**Definición.** El Contrato se creó y **nunca alcanzó el estado activo**; la contratación se deja sin
efecto antes de que haya servicio prestado.

| Regla | |
|---|---|
| **Origen legal** | **Únicamente `PENDIENTE DE ACTIVACIÓN`** |
| **Prohibido** | Cancelar un contrato que estuvo `ACTIVO`, aunque haya vuelto a pendiente. Para eso existe `BAJA DEFINITIVA` |
| **Naturaleza** | Terminal |
| **Efecto técnico** | Dispara la anulación del fulfillment y **libera todo lo reservado** (C §37, E-0.3 D-21) |
| **Efecto histórico** | Conserva todo: contrato, comprobantes emitidos, auditoría (A §21, C-I18) |

**Si ya se emitió un comprobante de alta**, la cancelación **no lo borra**: se rectifica por el
mecanismo contable que corresponda, auditado. C §37 ya obligaba a preguntar *«¿hay factura? ¿hay
cargos? ¿hay pagos?»* antes de cancelar; ahora además hay un estado donde dejar el resultado.

### 3.2 C §5 incorpora `RECHAZADO`

**Definición.** El proceso de fulfillment **no llega a ejecutarse** porque se rechaza de entrada:
sin cobertura, sin recursos disponibles, datos inválidos, requisito previo incumplido.

| Regla | |
|---|---|
| **Distinto de `ERROR`** | `ERROR` significa **se intentó y falló**. `RECHAZADO` significa **no se intentó** |
| **Distinto de `CANCELADO`** | `CANCELADO` es decisión de quien pidió. `RECHAZADO` es veredicto de quien iba a ejecutar |
| **Naturaleza** | Terminal, y **no reintentable**: reintentar produce el mismo rechazo (E-0.3 D-14, `rechazado_definitivo`) |

### 3.3 Lo que NO cambia

- **A §21 se mantiene íntegra:** cancelar no es eliminar. `CANCELADO` conserva el histórico como
  cualquier otro estado terminal.
- **C-I18 se mantiene:** cancelar un proceso no equivale a borrar físicamente el Contrato.
- **La regla de activación (E-0.2 D-5) no se toca:** `CANCELADO` no participa de ella.
- **Ningún estado técnico provoca `CANCELADO`.** Es decisión humana o del vencimiento de un plazo
  declarado, nunca consecuencia de una ONU caída (C-I15).

---

## 4. Consecuencias

**Positivas.**

- **Las métricas dejan de mentir.** Un contrato cancelado antes de activarse **no es rotación de
  abonados**; contarlo como baja infla el churn con clientes que nunca lo fueron.
- **La facturación tiene un criterio claro:** un contrato que nunca se activó no debió generar
  obligaciones recurrentes. Lo que se emitió antes se rectifica; lo que no, no nace.
- **El diagnóstico mejora en el plano de ejecución:** «rechazado por falta de cobertura» deja de
  confundirse con «falló el aprovisionamiento», que es lo que hoy obligaría a mirar los dos como
  `ERROR`.
- **El wizard gana el estado que le faltaba:** C §37 describía la cancelación sin destino.

**Negativas.**

- Dos estados más que mantener en dos máquinas de estados. Es el coste mínimo de la distinción.
- **Toca corpus congelado**, con el precedente que eso sienta. Se acota en §5.

---

## 5. Qué NO autoriza esta decisión

- **No autoriza usar `CANCELADO` para deshacer un contrato activo.** El origen legal es uno solo.
- **No autoriza añadir más estados** de los dos aquí decididos. `created`, `pendingTerminate` y
  `aborted` del estándar **no se adoptan**: `created` y `pendingTerminate` son fases que nuestro
  modelo colapsa deliberadamente, y `aborted` no tiene caso de negocio identificado.
- **No autoriza tratar el corpus congelado como editable.** Este ADR existe precisamente porque no
  lo es: cada cambio necesita el suyo, con evidencia y decisión del propietario.
- **No autoriza inferir estados nuevos por analogía.** El siguiente hueco, si aparece, se abre igual.

---

## 6. Estado

**Aceptada — 2026-08-15.** Cierra **ADR-036 §4.3 y §4.3bis**.

| Pendiente | Dónde |
|---|---|
| Reflejar `CANCELADO` en la máquina de estados del Contrato | E-0.2 D-5 |
| Reflejar `RECHAZADO` en los estados del proceso | E-0.3 D-16 |
| Anotar la modificación en el corpus conceptual A y C | `pdf/DATAFAST ERP.pdf` — al reemitirse |
