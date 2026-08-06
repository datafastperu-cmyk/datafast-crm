# F0 — Línea base y diagnóstico del módulo de Cobranza

**Ejecutado:** 2026-08-06 contra producción (`datafast-postgres`, `datafast_db`).
**Naturaleza:** solo lectura. Ninguna consulta modificó datos.
**Fase del plan:** [F0](./cobranza-plan-implementacion.md#f0--línea-base-y-diagnóstico).

---

## Resumen

| Medición | Resultado |
|---|---|
| Pagos registrados en total | **2** (S/ 192.00, 04–05/08/2026) |
| Filas en `pago_aplicaciones` | 3 (una de ellas, un consolidado a 2 comprobantes) |
| Facturas con invariante roto (global) | **0** |
| Facturas con invariante roto (post-corte) | **0** |
| Duplicados sospechosos sin nº de operación | 0 |
| Cuentas bancarias configuradas | **0** |
| Pagos verificados sin aplicar (`aplicado_en IS NULL`) | **2 — el 100%** |

El invariante de contabilidad está sano y no hay histórico que migrar. Pero el diagnóstico
destapó **dos defectos vivos** que no eran visibles desde el código, y **una divergencia
entidad↔base de datos** que invalida una de las premisas del diseño.

---

## Hallazgo 1 — No hay histórico: F1 deja de ser la fase peligrosa

```
pagos | suma_total |   desde    |   hasta
    2 |     192.00 | 2026-08-04 | 2026-08-05
```

El plan dimensionaba F1 como *"la fase irreversible del proyecto"*, con backfill por lotes,
canal `LEGACY`, mapeo versionado y verificación de suma total. **Nada de eso hace falta.**
Dos filas se migran a mano y se verifican de un vistazo.

**Consecuencia para el plan:** F1 baja de riesgo Alto a Bajo, y desaparece la justificación
principal para conservar `metodo_pago` como columna congelada. Se conserva igualmente —cuesta
una columna y compra reversibilidad—, pero ya no es la pieza que sostiene el `down()`.

**Y una consecuencia mayor:** este es el mejor momento posible para hacer el rediseño. Con
dos pagos, el coste de equivocarse es cero. Con el parque de MikroWISP migrado, no.

---

## Hallazgo 2 — El formulario escribe la etiqueta, no el valor

```
metodo_pago |  banco   | n
Efectivo    | (null)   | 1
Efectivo    | Banco 01 | 1
```

`metodo_pago` guarda `'Efectivo'` (capitalizado). El enum del dominio es
`MetodoPago.EFECTIVO = 'efectivo'` ([pago.entity.ts:5](../backend/src/modules/pagos/entities/pago.entity.ts#L5)).
El frontend está enviando el **rótulo de la interfaz**, no el valor de dominio.

Efectos medibles hoy:

- `etiquetaMetodo` ([pago.entity.ts:160](../backend/src/modules/pagos/entities/pago.entity.ts#L160))
  nunca acierta: cae siempre al fallback.
- El reporte de ingresos por método ([reportes.service.ts:79](../backend/src/modules/reportes/reportes.service.ts#L79))
  agrupa por texto libre. `Efectivo` y `efectivo` serían dos filas distintas del mismo
  concepto.
- Sobrevive solo porque `esAutoVerificado` compara en minúsculas
  ([pagos.service.ts:462](../backend/src/modules/pagos/pagos.service.ts#L462)). Es una
  casualidad defensiva, no un diseño.

La causa raíz es exactamente la que motivó el rediseño: `metodo_pago` es un `varchar(100)`
libre, así que **cualquier cosa cabe**. El catálogo con FK lo hace imposible por
construcción, que es la única forma de arreglarlo de verdad.

---

## Hallazgo 3 — Un pago en efectivo con banco "Banco 01"

```
Efectivo | Banco 01 | S/ 128.00 | 2026-08-05
```

La inconsistencia que abría la propuesta original —*"el efectivo no pertenece a ningún
banco"*— no es hipotética: está en producción, en el 50% de los pagos existentes. Queda como
evidencia de campo del problema, no como argumento.

---

## Hallazgo 4 (DEFECTO) — `registrar()` aplica el dinero pero nunca marca `aplicado_en`

**Los dos pagos tienen `aplicado_en IS NULL` y, sin embargo, sus tres facturas están
`pagada` con el saldo en cero.** El dinero SÍ surtió efecto. La marca, no.

Causa raíz: `aplicado_en` se escribe en **un solo sitio** de todo el servicio,
[pagos.service.ts:877](../backend/src/modules/pagos/pagos.service.ts#L877), dentro de
`aplicarPagoAFacturaYContrato()`. Ese método es el camino de `verificar()` (el segundo paso,
cuando un supervisor confirma días después) y del reconciliador.

Pero un pago **auto-verificado** (efectivo en caja, MercadoPago, Yape con OTP) aplica el
dinero *dentro de la transacción de `registrar()`*, y ese camino **no pasa por ahí**. Nadie
escribe la marca.

Resultado: **todo pago auto-verificado nace marcado como trabajo pendiente y lo sigue estando
para siempre.** No es un fallo intermitente ni una carrera; es determinista, y afecta al
100% de los pagos registrados hasta hoy.

El campo está bien diseñado y su comentario describe con precisión lo que debería pasar
([pago.entity.ts:81-88](../backend/src/modules/pagos/entities/pago.entity.ts#L81)) —
*"un pago verificado con esto en NULL es trabajo pendiente"*. Lo que falla es que el camino
más común del sistema no lo escribe.

---

## Hallazgo 5 (DEFECTO) — El bucle de reintentos ya está ocurriendo

> **Corrección.** La primera versión de este informe afirmaba que el reconciliador no tenía
> invocador. Era falso: `reconciliarPagosNoAplicados()` lleva `@Cron('0 */10 * * * *')`
> ([pagos.service.ts:911](../backend/src/modules/pagos/pagos.service.ts#L911)) y corre en
> `datafast-worker-auxiliary`, que tiene `RUN_CRONS=true`. La conclusión no se apoyaba en una
> medición, sino en un `grep` de llamadas que no ve un decorador — exactamente el error que
> la directriz de causa raíz manda evitar. El defecto real es **peor**, y se comprobó
> mirando producción.

El watcher funciona. Y por eso el bucle no es un riesgo futuro: **está vivo desde el 04/08**.

Registro de watchers (`watcher_heartbeat`):

```
pagos-reconciliacion | cada 600s | 1123 ejecuciones | última: 2026-08-06 05:40:00
```

Y los logs del worker, cada diez minutos, sin excepción:

```
05:40:00  error  Error aplicando pago 2b5acc9b… — queda PENDIENTE de aplicar,
                 el watcher lo reintentará: La factura ya está completamente pagada
05:40:00  warn   Pago 2b5acc9b… aplicado por reconciliación — su aplicación original falló.
```

La secuencia completa, confirmada por el stack trace de producción:

1. El reconciliador selecciona los 2 pagos (verificado + `aplicado_en` NULL + >2 min).
2. Reintenta → `aplicarPago` rechaza con *"La factura ya está completamente pagada"*
   ([facturacion.service.ts:693](../backend/src/modules/facturacion/facturacion.service.ts#L693)).
3. El `catch` traga el error, `aplicado_en` **sigue NULL**.
4. Diez minutos después, otra vez. **Desde el 04/08.**

Es el mismo patrón exacto del incidente de las ONUs —*una transición no idempotente en manos
de un watcher*, 1788 reintentos en 4 días contra el MA5800—, aquí con la base de datos y los
logs como víctima. Y con un agravante: el reconciliador **está inutilizado**. El día que un
pago real falle de verdad, su fallo se pierde entre el ruido de dos pagos que llevan meses
"fallando" sin fallar.

### Y el log afirma lo contrario de lo que ocurrió

Nótese el orden de las dos líneas: el `error` y el `warn` de éxito llevan **el mismo
timestamp y el mismo pago**. El *"aplicado por reconciliación"*
([pagos.service.ts:935](../backend/src/modules/pagos/pagos.service.ts#L935)) se emitía sin
comprobar nada: bastaba con que el catch interno no relanzara la excepción. El log describía
la intención de quien lo escribió, no el estado del sistema — la directriz *"un log describe
lo que ocurrió"*, violada de la forma más literal posible.

Esto es lo que hizo el defecto invisible durante dos días: quien mirase los logs por encima
vería "aplicado por reconciliación" y daría el problema por resuelto.

### Los dos defectos se sostienen mutuamente

H4 (la marca que no se escribe) es quien mete pagos ya aplicados en la cola. H5 (reaplicar no
es idempotente) es quien impide que salgan. Corregir uno solo no basta:

- Solo H4 → los pagos futuros nacen bien, pero cualquier aplicación que falle a medias entra
  en el mismo bucle.
- Solo H5 → se rompe el bucle, pero el 100% de los pagos sigue naciendo marcado como
  pendiente y el reconciliador sigue siendo ruido.

---

## Hallazgo 6 — La entidad declara un índice que la base de datos no tiene

```
DB : uq_pagos_empresa_numero_operacion ON pagos (empresa_id, numero_operacion)
                                       WHERE numero_operacion IS NOT NULL
```

La entidad declara ([pago.entity.ts:30](../backend/src/modules/pagos/entities/pago.entity.ts#L30)):

```ts
@Index(['empresaId', 'metodoPago', 'numeroOperacion'], { unique: true, ... })
```

**Son cosas distintas.** La base de datos no incluye `metodo_pago`.

Esto **invalida el §2.7 de la arquitectura**, que advertía sobre reanclar el índice a canal
para que Yape y Plin no colisionaran. El riesgo no existe: el índice real es por
`(empresa, nº operación)`, que además es *más estricto* y **coincide con el guard del
código** ([pagos.service.ts:82](../backend/src/modules/pagos/pagos.service.ts#L82), que
tampoco filtra por método).

El índice de producción es correcto. **Lo que está mal es la declaración de la entidad**, y
es deriva de esquema pura: si alguien regenerase el esquema desde las entidades, obtendría una
restricción más débil que la vigente y **abriría la puerta al duplicado que hoy está cerrado**.

**Corrección al plan:** la migración 044 (*ReanclarUniqueOperacionACanal*) **se elimina**. Se
sustituye por alinear la declaración de la entidad con la realidad de la base de datos, y
documentar por qué el índice no incluye el método: un número de operación no se repite aunque
uno sea Yape y otro transferencia.

---

## Hallazgo 7 — El catálogo de cuentas nace vacío

`cuentas_bancarias` tiene **0 filas**. No hay nada que extender ni migrar: hay que sembrar.
Lo que la propuesta llamaba "migrar el catálogo 3" es en realidad "crearlo", y las cuentas
tipo `caja` (Caja Principal, Caja Campo) no existen en ninguna forma hoy.

---

## Correcciones al plan de implementación

| # | Cambio | Motivo |
|---|---|---|
| 1 | **F1 baja de riesgo Alto → Bajo.** Sin backfill por lotes, sin canal `LEGACY`, sin verificación de suma | 2 pagos, no un parque histórico (H1) |
| 2 | **Se elimina la migración 044** (reanclaje del índice). Se sustituye por corregir la declaración de la entidad | El índice de producción ya es correcto; la entidad miente (H6) |
| 3 | **Nueva F0.5, previa a todo lo demás**: corregir H4 + H5 juntos, con la idempotencia primero y el cron después | Son defectos vivos, y encender el cron sin la idempotencia crea un incidente (H4+H5) |
| 4 | **F5 incluye corregir el envío del rótulo** en lugar del valor de dominio | H2 |
| 5 | **F1 siembra cuentas, no las migra** — incluidas las de tipo `caja` | H7 |

---

## F0.5 — Corrección de los defectos vivos (nueva fase, la siguiente a ejecutar)

Se ejecuta **antes** de tocar catálogos: son defectos independientes del rediseño, afectan a
producción hoy, y el rediseño no los arregla.

Se ejecuta **antes** de tocar catálogos: son defectos independientes del rediseño, afectan a
producción hoy, y el rediseño no los arregla.

### Lo implementado

**1. Idempotencia derivada del estado** — migración
[`1791800000038`](../backend/src/database/migrations/core/1791800000038-AddAplicadoEnAPagoAplicaciones.ts).

`pago_aplicaciones` gana `aplicado_en`. La tabla declaraba *qué* comprobantes cubre un pago,
pero no si esa imputación ya se había volcado; sin ese dato, reintentar era indistinguible de
aplicar por primera vez. Ahora la idempotencia **se deriva del estado de cada fila** en vez de
implementarse a mano en cada camino: se tocan solo las que siguen en NULL, y "no había nada
que hacer" es ÉXITO, no fallo.

Es también lo que resuelve el caso que ninguna de las dos correcciones cubría por separado:
un consolidado que se aplicó a la primera factura y murió antes de la segunda. El reintento
salta la primera y aplica solo la segunda.

El backfill marca el histórico como aplicado, y **la migración aborta si el invariante no se
cumple**: marcar como aplicado dinero que no llegó a la factura sería registrar una mentira
que después nadie puede distinguir.

**2. La marca, en la misma transacción que el volcado** — `registrar()` y
`aplicarPagoAFacturaYContrato`. `aplicarPago` acepta un `EntityManager` opcional para que el
UPDATE de la factura y la marca de la imputación confirmen o se deshagan juntos. Separarlos
reabre el bucle por otra puerta: una caída entre ambos deja el dinero aplicado y la
imputación sin marcar.

**3. El log dice lo que ocurrió.** El *"aplicado por reconciliación"* ahora relee
`aplicado_en` antes de cantar victoria. Si sigue en NULL, emite un error explícito que
menciona la consecuencia real — *el abonado puede estar cortado habiendo pagado*.

**4. Comentario falso, eliminado.** *"aplicarPago es idempotente"* era una garantía que nadie
sostenía. Se sustituye por el apunte de qué la sostiene ahora y dónde está el test.

**5. Deriva de esquema corregida** (H6): la declaración `@Index` de `Pago` ya coincide con la
base de datos.

**6. Cinco tests que nombran el incidente**, en
[`pagos.reconciliacion.spec.ts`](../backend/src/modules/pagos/pagos.reconciliacion.spec.ts):
un pago ya aplicado no llama a `aplicarPago` ni una vez; el consolidado a medias aplica solo
lo pendiente; volcado y marca van en la misma transacción; el histórico previo a la tabla
sigue funcionando; y el log no canta éxito sin comprobarlo.

**No hizo falta el paso "enchufar el cron"** que figuraba en la versión anterior de este
plan: el cron ya estaba enchufado (ver corrección en H5).

### Verificación

- `npx tsc --noEmit`: limpio.
- 81 tests de `pagos` + `facturacion`: en verde.
- **Pendiente en producción:** que `SELECT COUNT(*) FROM pagos WHERE estado='verificado' AND
  aplicado_en IS NULL` devuelva **0** tras el despliegue, que el bucle desaparezca de los
  logs del worker, y que siga en 0 tras registrar un pago nuevo por el formulario actual.
