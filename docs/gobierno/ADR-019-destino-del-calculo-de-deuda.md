# ADR-019 — La deuda se calcula en un servicio de dominio, no en la base

**Estado:** **Aceptada** — 2026-08-08, Datafast (PLAN-001 Fase 3.2, decisión **D11**)
**Decide:** Datafast · **Cierra:** desviación **A-4** · **Relacionado:** ADR-030 · PD-04 · PD-11 ·
DOM-001 · RDM-001 **R4**

---

## 1. Problema

**Cuatro implementaciones del cálculo de deuda, y una de ellas decide cortes de servicio.**

D11 fijó el criterio con el que había que resolverlo, y es un criterio de evidencia, no de gusto:

> **Si algún escritor no pasa por la aplicación, el cálculo va en la base de datos.**

O sea: primero medir quién escribe. Esto es lo que se encontró.

---

## 2. La medición

### 2.1 El saldo por factura ya vive en la base, y es inviolable

`facturas.saldo` es una columna **`GENERATED ALWAYS AS (total - monto_pagado) STORED`**. La
calcula PostgreSQL en cada escritura y **ningún camino puede saltársela** — ni un `UPDATE`
manual, ni un script, ni una integración futura.

Hubo un trigger (`fn_sync_factura_saldo`) que intentaba asignarla; se eliminó en
`1789100000000` porque PostgreSQL rechaza (`428C9`) cualquier `UPDATE` que toque una columna
generada. La base ya defendía su propio invariante.

**El primitivo, por tanto, está resuelto y en el sitio correcto.** No es lo que A-4 denuncia.

### 2.2 Lo que sí estaba repartido: la agregación

| Qué se duplicaba | Cuántas veces | Divergencia real encontrada |
|---|---|---|
| **Qué estados cuentan como deuda** | **21 escrituras a mano** | Tres variantes. `cobranza.worker` (que **corta el servicio**) incluía `en_cobranza`; `v_resumen_financiero` y `sistema.service` no |
| **Cómo se suma** | **4 implementaciones** | Ver §2.3 |
| **Quién escribe `contratos.deuda_total`** | **4 escritores** | Solo uno partía de las facturas |

### 2.3 El defecto concreto, no el teórico

`pago.repository.calcularDeudaContrato` sumaba `WHERE f.contrato_id = $1`.

**El comprobante de este ERP es CONSOLIDADO por cliente** —`contrato_id` en NULL, un abonado con
dos servicios recibe uno solo—, así que ese `SUM` devolvía **cero** para clientes que sí debían. Su
consumidor, `verificarYReactivarContrato`, usaba ese cero para **reactivar el servicio de un
moroso** y para escribir `deuda_total = 0` en la ficha.

Es el mecanismo exacto del **incidente 2026-08-04** (ficha S/64, deuda real S/128, reactivación
denegada tras pagar). Ese incidente se corrigió… **en `cobranza.worker`**, que añadió
`OR (contrato_id IS NULL AND cliente_id = ...)`. La ruta de pagos se quedó atrás.

> **Dos puertas al mismo sitio; se arregló una.** Es literalmente el punto 3 del checklist de PD-03
> —«preguntar dónde más ocurre lo mismo»— sin ejecutar. La corrección de agosto fue real y correcta;
> lo que faltó fue el barrido.

Y `contratos.reactivarPorPago` escribía `deuda_total = 0, meses_deuda = 0` **sin consultar una sola
factura**.

---

## 3. Decisión

**La agregación vive en `DeudaPorContratoService`, un servicio de dominio. No baja a la base.**

Aplicando D11 literalmente: **el único escritor que se salta la aplicación es PostgreSQL calculando
`saldo`, y eso ya está en la base.** La agregación no tiene ningún escritor externo — ni triggers,
ni scripts, ni integraciones. No gana nada bajando, y perdería lo que la hace revisable: los tests,
el tipado y la imputación proporcional del consolidado, que en PL/pgSQL sería mucho menos legible.

### 3.1 Las cuatro piezas

| # | Decisión | Efecto |
|---|---|---|
| 1 | **Una constante para los estados con saldo** (`facturacion/domain/estados-con-saldo.ts`), más una **barrera** que falla si alguien vuelve a teclear la lista | 21 escrituras a mano → 1 |
| 2 | **`DeudaPorContratoService` es el único escritor** de `contratos.deuda_total` | 4 escritores → 1 |
| 3 | **Se eliminan las dos puertas** que permitían escribir una deuda sin respaldo: `contratos.actualizarDeuda(...)` y `pago.repository.calcularDeudaContrato(...)` | Un cálculo paralelo no puede reaparecer por descuido |
| 4 | **Se retiran las definiciones que viven en la base**: `v_resumen_financiero` se corrige (le faltaba `en_cobranza`) y `fn_calcular_deuda_contrato` **se borra** | Eran las más difíciles de ver: no salen en un `grep` del código que las consume |

### 3.2 Por qué se BORRA la función de base en vez de corregirla

Tenía **cero consumidores** desde la aplicación. Una definición divergente que nadie usa no es
código inofensivo: es una trampa esperando a que alguien la encuentre y la crea autorizada. Y
arrastraba el mismo defecto que la copia de `pago.repository` —ciega al consolidado—, así que quien
la adoptara heredaría el incidente completo.

### 3.3 Reactivar con deuda es legítimo; mentir sobre la deuda no

`reactivarPorPago` ya no pone la deuda a cero: la **recalcula**.

Reactivar es una decisión del operador y puede tomarla con deuda viva —una promesa de pago, un
gesto comercial—. Lo que no puede es que el ERP responda que el abonado no debe nada. Escribir el
cero convertía la orden *«reactiva el servicio»* en la afirmación *«este abonado está al día»*, que
es otra cosa y puede ser falsa.

Con el recálculo el servicio se levanta igual y la ficha dice la verdad. Si queda deuda, el cobro
nocturno volverá a verla — que es exactamente lo que debe pasar.

---

## 4. Alternativas

| # | Alternativa | Por qué se descarta |
|---|---|---|
| A | Función en PL/pgSQL como fuente única | D11 no se cumple: no hay escritor fuera de la aplicación que lo justifique. Y ya existía una, muerta y divergente — la prueba de que ponerla ahí no la mantiene viva |
| B | Vista materializada de deuda por contrato | Añade latencia de refresco a un dato que decide cortes. El coste de estar desactualizado es cortar a quien pagó |
| C | Dejar las cuatro y añadir un test que las compare | Congela la duplicación y multiplica el trabajo de cada cambio futuro. PD-04 punto 4: **una** definición reutilizable |
| **D** | **Servicio de dominio único + barrera contra la reaparición** | **Elegida** |

---

## 5. Consecuencias

**Positivas:** una sola respuesta a «¿cuánto debe este abonado?»; `en_cobranza` deja de ser deuda
para unos y no para otros; el camino de pagos deja de poder reactivar a un moroso con comprobante
consolidado; y la barrera hace que la vigésimo segunda escritura a mano no compile en CI.

**Negativas:** `DeudaPorContratoService` pasa a ser una dependencia de contratos, pagos, facturación
y workers. Se mitiga con `DeudaPorContratoModule`, módulo propio sin dependencias — el mismo patrón
que `AdelantosModule`, extraído en su día por esta misma razón.

---

## 6. Lo que esta decisión NO resuelve, y que es más grande

**`contratos.deuda_total` no debería existir.**

En un modelo contable estándar la deuda no es un campo: se deriva de los apuntes por cobrar
abiertos. No hay nada que sincronizar, y por tanto nada que pueda contradecirse. Las cuatro
implementaciones que este ADR unifica son el **síntoma** de almacenar algo que debería calcularse.

Conviene decirlo sin adornos: **el incidente 2026-08-04 enseñó por dolor un axioma que cualquier
sistema maduro trae de fábrica.** El propio código lo reconoce — el comentario de
`facturacion.worker` explica que se abandonó el contador incremental *«se recalcula desde facturas,
la única fuente»*. Se llegó solo a la conclusión correcta, pagándola.

**No se elimina el campo aquí**, por dos razones:

1. CON-001 §8.11.3: no se re-modela el agregado raíz con desviaciones críticas abiertas.
2. Eliminarlo toca el cobro nocturno, el portal y los listados a la vez. Es un cambio de modelo,
   no una corrección — y esta fase es una corrección.

**Queda registrado como deuda de modelo conocida en DOM-001**, y es entrada obligatoria del **ADR de
benchmark financiero** que PD-11 exige antes de diseñar H2-1 (SUNAT). Cuando se haga ese benchmark,
la pregunta no será «¿cómo mantenemos sincronizado `deuda_total`?» sino **«¿por qué existe?»**.

Dos guards para ese benchmark, que no son negociables:

- **PD-11 guard 1:** se adopta el **modelo**, la documentación y el vocabulario. **Nunca el código.**
  Conviene verificar licencia y versión de cualquier producto que se estudie antes de mirarlo — para
  un ERP que se instala en servidores de terceros esto no es un detalle académico.
- **PD-11 guard 2:** los invariantes ganados en incidentes propios **no se borran** por adoptar un
  modelo externo. El más claro: *la gracia es la distancia vencimiento→corte, no se suma al
  vencimiento*. Ningún producto de industria trae eso.

---

## 7. Verificación

| Qué | Cómo |
|---|---|
| La lista de estados con saldo solo se escribe en un sitio | `estados-con-saldo.spec.ts` — recorre el código fuente |
| `en_cobranza` cuenta como deuda | Mismo fichero, test propio: era la divergencia que separaba al cobro nocturno del resumen financiero |
| La agregación es única | `deuda-por-contrato.service.spec.ts` |

### 7.1 Medición en producción — 2026-08-08

La corrección impide que el desajuste se produzca de nuevo pero **no repara el existente**, así que
había que medirlo antes de dar la fase por cerrada.

| Comprobación | Resultado |
|---|---|
| Contratos vivos | 2 |
| **Ficha en 0 con deuda real (incluidas las consolidadas)** | **0 casos** |
| `v_resumen_financiero.cuentas_por_cobrar` | 128,00 |

**No hay nada que reparar.** No se necesita recálculo masivo.

> **La primera consulta que se escribió para esto estaba mal, y conviene dejarlo escrito.**
> Comparaba `contratos.deuda_total` con la suma de las facturas *atadas a ese contrato*, y marcó
> `CNT-2026-000007` como desajustado: ficha 64,00 contra 0,00 en sus propias facturas. No era un
> desajuste — era **la imputación del comprobante consolidado funcionando correctamente**. La
> consulta de verificación tenía exactamente la ceguera que este ADR acaba de eliminar del código.
>
> Es la advertencia práctica de todo esto: cuando el criterio está disperso, hasta la herramienta
> que escribes para auditarlo hereda la versión equivocada.
