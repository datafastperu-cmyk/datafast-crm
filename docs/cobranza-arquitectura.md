# Arquitectura del Módulo de Cobranza — ERP Datafast

> Especificación definitiva. Consolida la propuesta funcional de catálogos (formas/canales/
> cuentas), la propuesta de arquitectura en dos etapas, y el estado real del código en
> producción a 2026-08-06.
>
> **Documento normativo.** Lo que aquí se declara obligatorio no admite excepción sin
> modificar este documento y justificar el cambio.

---

## 0. Principio rector

> **El dinero es el único dato del ERP que no se puede recalcular.**

Una ONU mal aprovisionada se vuelve a aprovisionar. Una factura mal emitida se anula y se
reemite. Un pago perdido, duplicado o mal revertido es dinero real de un abonado real, y su
única fuente de verdad es un papel que el cliente tiene en la mano y el ERP no.

De ahí se derivan las tres invariantes de este módulo, en orden de prioridad. Cuando dos
entren en conflicto, gana la de arriba:

1. **No perder dinero registrado.** Antes que aplicarlo, antes que aplicarlo bien.
2. **No cobrar dos veces el mismo ingreso.** Un ingreso físico = una fila de pago.
3. **No dejar a un abonado cortado habiendo pagado.** Es el fallo con cara visible.

Nótese el orden: es preferible un pago registrado y sin aplicar (detectable, reparable por
un reconciliador) que un pago aplicado y sin registrar (invisible, irreparable).

---

## 1. Estado real del punto de partida

Esta especificación **no parte de cero**. Lo siguiente ya existe y está en producción:

| Pieza | Ubicación | Estado |
|---|---|---|
| Registro transaccional de pagos | `pagos.service.ts:65 registrar()` | Producción. TX ACID: idempotencia → validación → persistencia → aplicación → reevaluación de contrato → auditoría |
| Imputación multi-factura | `pago_aplicaciones` (`pago-aplicacion.entity.ts`) | Producción. Un pago, N comprobantes |
| Reconciliador de pagos no aplicados | `pagos.service.ts:912 reconciliarPagosNoAplicados()` | Producción. Cierra la ventana "verificado pero sin surtir efecto" (`aplicadoEn IS NULL`) |
| Adelantos (saldo a favor) | `adelantos.service.ts` | Producción. Con guard de no-convivencia con deuda |
| Catálogo de cuentas bancarias | `CuentaBancaria` (`pago.entity.ts:180`) | Producción. Base del catálogo de cuentas receptoras |
| Idempotencia por nº de operación | `pagos.service.ts:78-92` + índice único | Producción |
| Conciliación bancaria (campos) | `conciliado`, `conciliadoEn`, `extractoBancoRef` | Esquema listo, flujo parcial |
| Integración MercadoPago | `mercadopago.service.ts`, `pagos.service.ts:620` | Producción |
| `ResultadoOperacion` | `common/domain/resultado-operacion.ts` | Producción |
| Auditoría central | `modules/auditoria/` | Producción |

**Consecuencia normativa:** queda prohibido crear una clase nueva llamada
`PaymentRegistryService`, o cualquier servicio equivalente, que reimplemente `registrar()`.
El Payment Registry es `PagosService`. Este proyecto lo **endurece y le pone frontera**; no
lo reescribe. Dos servicios de registro serían dos verdades sobre el dinero, y la segunda
nacería sin el reconciliador, sin `aplicadoEn` y sin el guard de adelanto-con-deuda — es
decir, violando la invariante 1 desde el primer commit.

Regla de proyecto aplicada: *"Reutilizar antes de construir"* (CLAUDE.md).

---

## 2. Modelo de dominio

### 2.1 Los tres ejes de un ingreso

Todo ingreso de dinero responde tres preguntas independientes. Hoy las tres viven
colapsadas en dos columnas de texto libre (`metodo_pago`, `banco`), y por eso `yape` y
`transferencia_bancaria` conviven en el mismo enum siendo cosas de distinto nivel.

| Eje | Pregunta | Entidad |
|---|---|---|
| **Forma de Pago** | ¿Cómo pagó? | `forma_pago` |
| **Canal de Pago** | ¿Por qué medio concreto? | `canal_pago` |
| **Cuenta Receptora** | ¿Dónde entró el dinero? | `cuenta_receptora` |

Sin el tercer eje no existe tesorería: hoy el ERP sabe que entraron S/ 85 por Yape y **no
sabe en qué cuenta están**. Ese es el defecto de fondo que este rediseño corrige; los
catálogos son el medio, no el fin.

### 2.2 Catálogo 1 — `forma_pago`

Taxonomía **cerrada y estable**. No es configurable por el operador: es el eje de los
reportes contables y de la conciliación, y si cambia, cambia el significado del histórico.

```
efectivo | transferencia | deposito | billetera | tarjeta | pasarela | nota_credito | otro
```

`nota_credito` se incluye desde ya: un descuento aplicado como saldo no es un ingreso de
caja, pero sí salda un comprobante, y hoy lo hace por fuera del flujo de pagos (§3.2).

### 2.3 Catálogo 2 — `canal_pago`

Configurable por empresa. Absorbe el "Catálogo 4 / Reglas Automáticas" de la propuesta
original: una tabla 1:1 con canales es una tabla de canales con pasos extra.

| Campo | Notas |
|---|---|
| `id`, `empresa_id`, `nombre`, `codigo` | `codigo` es inmutable y es la clave de negocio |
| `forma_pago` | FK al catálogo 1 |
| `cuenta_receptora_default_id` | Nullable. Ausente = el operador debe elegir |
| `requiere_numero_operacion` | Controla obligatoriedad y visibilidad del campo |
| `requiere_voucher` | Independiente del anterior |
| `comision_porcentaje`, `comision_fija` | Base del cálculo (§2.5) |
| `permite_registro_manual` | `false` para canales que solo crea una pasarela |
| `activo` | Baja lógica. **Nunca DELETE físico** |

**Regla de baja:** `activo = false` retira el canal de los selectores, jamás del histórico.
Un pago de hace dos años debe seguir mostrando su canal aunque esté desactivado. Los
catálogos de cobranza son *append-only* en la práctica.

### 2.4 Catálogo 3 — `cuenta_receptora`

**Se construye extendiendo `cuentas_bancarias`**, no creando una tabla nueva. Dos tablas
para "dónde está el dinero de la empresa" es exactamente la clase de duplicación que
produce dos respuestas distintas a la misma pregunta.

Campos añadidos: `tipo` (`caja | banco | pasarela | virtual`), `nombre` (rótulo operativo),
`cajero_responsable_id` (nullable), `requiere_arqueo` (bool). `banco` y `numero_cuenta`
pasan a nullable — una caja física no tiene banco.

**Decisión sobre cajas y arqueo (obligatoria, condiciona el modelo):** una cuenta de tipo
`caja` con `requiere_arqueo = true` pertenece a **un** responsable. "Caja Campo" como cuenta
única compartida por todos los cobradores hace imposible determinar a quién le falta
dinero, y ese es el motivo por el que existe una caja. Un cobrador nuevo = una cuenta nueva.

### 2.5 Comisión: bruto, neto y por qué importa

La propuesta original pedía un campo "Comisión" en el formulario sin definirlo en el modelo.
Definición normativa:

- `monto` = **lo que pagó el abonado**. Es lo único que salda la factura. Siempre.
- `comision` = lo que retiene el canal. Derivado del canal, editable con permiso.
- `monto_neto` = `monto - comision`. **Es lo que hay que buscar en el extracto bancario.**

Si se saldara la factura con el neto, el abonado que paga S/ 85 por una pasarela con 3.5%
quedaría debiendo S/ 2.98 y el ERP lo cortaría por moroso. Si no se registrara el neto, la
conciliación bancaria (`extractoBancoRef`, ya en el esquema) nunca cuadraría y alguien
acabaría "ajustando" cifras a mano, que es como se pierde la trazabilidad del dinero.

La comisión es **gasto**, y debe emitir el asiento correspondiente en `finanzas-opex`.

### 2.6 Migración del histórico

`metodo_pago` es `varchar(100)` con datos reales. La migración es la parte irreversible del
proyecto y se somete a:

1. **Mapeo explícito y versionado** enum → (forma, canal). Los valores sin mapeo claro
   (`otro`, `cheque`) van a un canal `LEGACY` por forma, nunca a un canal inventado.
2. **`metodo_pago` NO se borra.** Se conserva como columna congelada de auditoría. El coste
   es una columna; el beneficio es poder demostrar dentro de tres años qué decía el registro
   original. En dinero, la desnormalización histórica es una virtud.
3. **Cuenta receptora nullable para el histórico.** Un pago de 2025 no tiene cuenta y no se
   le inventa una. `cuenta_receptora_id IS NULL AND fecha_pago >= <fecha_corte>` es una
   condición que debe dar cero filas — y hay un test que lo verifica.
4. **Migración reversible**: `down()` real y probado en staging con copia de producción.

### 2.7 El índice único: la trampa silenciosa

Índice vigente: `(empresa_id, metodo_pago, numero_operacion) WHERE numero_operacion IS NOT NULL`
(`pago.entity.ts:30`).

Si `metodo_pago` se sustituye por `forma_pago`, **Yape y Plin dejan de ser valores
distintos**: dos operaciones legítimas de billeteras diferentes con el mismo número
colisionan, y el cajero recibe un "pago duplicado" que no es duplicado.

**Normativo:** el índice se reancla a `(empresa_id, canal_pago_id, numero_operacion)`.
Nunca a la forma.

Nótese que el guard de código (`pagos.service.ts:82`) es **más estricto** que el índice: no
filtra por método. Esa asimetría es deliberada y correcta — el código rechaza antes con un
mensaje útil; el índice es la red de seguridad ante concurrencia. Debe quedar documentada en
el código, porque el próximo lector va a "arreglar" la que crea inconsistente.

---

## 3. La frontera única

### 3.1 La regla

> Ningún módulo del ERP modifica el estado de una factura, el saldo de un abonado o el
> estado de su servicio **como consecuencia de una entrada de dinero**, salvo a través del
> flujo de pagos.

### 3.2 La regla ya está violada hoy — y ese es el trabajo real

Una garantía que nadie sostiene con un mecanismo es peor que ninguna, porque el siguiente
lector construye encima (CLAUDE.md, *"VIO hacia adentro"*). Escritores actuales del estado
de factura fuera del flujo de pagos:

| Escritor | Veredicto |
|---|---|
| `facturacion.service.ts:665 aplicarPago()` | **Cerrar.** Público, SQL directo sobre `monto_pagado`/`estado`. Pasa a interno del flujo de pagos |
| `adelantos.service.ts:197` | **Cerrar.** `UPDATE facturas ... 'pagada'` propio. Debe pasar por el mismo camino |
| `facturacion.service.ts:649 marcarVencidas()` | **Excepción legítima y declarada.** No es entrada de dinero. Se documenta como excepción, o alguien la "corregirá" |
| Notas de crédito | **Cerrar.** Saldan comprobante ⇒ forma de pago `nota_credito` (§2.2) |

El `aplicarPago` actual es técnicamente bueno — UPDATE atómico con la condición de saldo en
el `WHERE`, sin race de leer-calcular-escribir. **No se reescribe: se encapsula.** Deja de
ser una puerta pública y pasa a ser el mecanismo interno del único flujo autorizado.

### 3.3 El mecanismo que la sostiene

La regla se acompaña de **tres piezas ejecutables**, no de un párrafo:

1. **Test de frontera**, nombrado por su motivo, que falla si un módulo ajeno importa o
   invoca el aplicador. Un test llamado "no debería fallar" se borra en la primera limpieza;
   uno que dice *"la factura solo la mueve el flujo de pagos — dos escritores paralelos,
   2026-08"* sobrevive.
2. **Invariante de contabilidad**, verificable en frío y en cron:
   `facturas.monto_pagado == SUM(pago_aplicaciones.monto_aplicado)` para todo comprobante
   posterior a la fecha de corte. Cualquier divergencia es un escritor clandestino, y lo
   dice el mismo día, no en el cierre del mes.
3. **Barrido de coherencia caja↔tesorería**: todo pago verificado tiene cuenta receptora, y
   la suma por cuenta y día es la base del arqueo.

---

## 4. Reversión — el flujo más peligroso del módulo

La propuesta original lo mencionaba como una palabra dentro de "Auditoría". Es el flujo con
mayor potencial de daño de todo el ERP: un extorno mal hecho **corta a un abonado que
pagó**, o deja pagada una factura que nunca se cobró.

### 4.1 Nunca se borra un pago

`eliminar()` deja de significar borrado y pasa a significar **extorno**. Un pago registrado
es un hecho histórico; lo que se registra es que fue anulado, por quién y por qué.

### 4.2 Motivos tipificados

`error_registro` | `devolucion_cliente` | `cheque_rebotado` | `contracargo` | `pago_duplicado`
| `fraude`. El motivo no es decorativo: determina si el servicio se corta de nuevo y si el
dinero vuelve al abonado.

### 4.3 Extorno atómico

En una sola transacción, y en este orden:

1. Marcar el pago `EXTORNADO` (`EstadoPago` gana el valor; `DEVUELTO` queda para la
   devolución bancaria concreta).
2. Revertir cada fila de `pago_aplicaciones` con el mismo UPDATE condicional del aplicador
   — nunca con un `SET monto_pagado = X` calculado en memoria.
3. Recalcular el estado del comprobante desde `SUM(pago_aplicaciones)`, no restando.
4. Registrar en auditoría **antes** del commit.
5. **Reevaluación del servicio fuera de la transacción**, como job, nunca en línea.

### 4.4 El corte por extorno nunca es automático

Un extorno puede dejar al abonado en mora, pero cortarle el servicio en el mismo request es
inaceptable: el motivo más frecuente de extorno es `error_registro` — un error del cajero —,
y el ERP estaría cortando a un cliente por una equivocación propia, en segundos, sin que
nadie lo revise.

**Normativo:** el extorno deja el contrato en `revision_cobranza` y encola una revisión. El
corte lo decide el ciclo de cobranza normal, con su tiempo de gracia, o un humano con
permiso explícito. Un corte automático se puede añadir después si el negocio lo pide; una
llamada de un cliente cortado por error no se puede deshacer.

### 4.5 Extorno de pago consolidado

Es todo o nada, por el mismo motivo por el que el consolidado se registra todo o nada
(§5.1): extornar parcialmente obliga a decidir de qué comprobante se retira el dinero, y esa
decisión no la tiene el sistema.

---

## 5. Reglas de aplicación de dinero

### 5.1 Consolidado: todo o nada (se confirma la regla vigente)

La propuesta pedía simultáneamente "pago parcial" y "múltiples facturas". La regla vigente
(`pagos.service.ts:161-170`) rechaza el consolidado que no cubre el total, con un motivo
escrito en el código: repartir un importe insuficiente obliga a inventar un criterio de
imputación que nadie decidió.

**Se confirma.** Pago parcial ⇒ un solo comprobante, el más antiguo. Consolidado ⇒ importe
exacto. Si en el futuro el negocio pide parcial-multifactura, el criterio será **FIFO por
fecha de vencimiento** y deberá declararse en este documento antes de implementarse, no
inferirse del código.

### 5.2 Orden de imputación

Cuando el sistema elige (adelantos, notas de crédito, portal): **FIFO por vencimiento**,
mora antes que capital dentro del mismo comprobante. Una sola definición, consumida por
todos — no un criterio por consumidor.

### 5.3 Moneda

`pago.moneda` debe coincidir con `cuenta_receptora.moneda`. Divergencia ⇒ rechazo, salvo que
exista tipo de cambio registrado en el pago. Hoy todo es PEN por defecto y eso funciona
hasta el primer pago en dólares — que es exactamente cuando nadie recuerda esta regla.

### 5.4 Redondeo

Toda comparación de importes usa tolerancia de 1 céntimo (criterio ya vigente) y toda
operación aritmética de dinero pasa por `numeric` en base de datos, nunca por acumulación de
`float` en JavaScript. Un `reduce()` sobre `Number` en TypeScript es aceptable solo para
validar, jamás como valor persistido.

---

## 6. Escenarios pesimistas

Esta sección no es un anexo: es el criterio con el que se acepta o rechaza la
implementación. Cada fila debe tener una defensa implementada y un test que la ejercite.

| # | Escenario | Defensa exigida |
|---|---|---|
| P1 | El cajero pulsa "Registrar" dos veces / doble clic / reintento del navegador | Idempotencia por `numeroOperacion` + índice único por canal. Para efectivo sin operación: **clave de idempotencia por request** generada en el cliente. Es el hueco real de hoy — el efectivo no tiene nº de operación |
| P2 | Caída del proceso entre `INSERT pago` y `UPDATE factura` | Imposible: misma TX. La TX es el mecanismo, y por eso nada de lo anterior sale de ella |
| P3 | Caída entre commit y reactivación del servicio | Ya resuelto: `aplicadoEn IS NULL` + `reconciliarPagosNoAplicados`. **Se extiende** con alerta si un pago lleva > 15 min sin aplicar |
| P4 | Dos cajeros cobran la misma factura a la vez | UPDATE condicional atómico (`WHERE ... AND monto <= saldo + 0.01`). El segundo recibe rechazo con saldo real, no un sobrepago silencioso |
| P5 | Webhook de pasarela duplicado (son *at-least-once* por diseño) | ID de transacción del proveedor → `numeroOperacion`. **Contrato del adaptador, no criterio de cada integración** |
| P6 | Webhook perdido: la pasarela cobró, el ERP no se enteró | `cobro_intento` + conciliador que consulta al proveedor los intentos no resueltos. Sin esto hay dinero cobrado al cliente que el ERP nunca sabrá |
| P7 | Timeout contra la pasarela | `ResultadoOperacion.indeterminado` — **obligatorio**. Un timeout cobrando puede significar que al cliente sí le cobraron. Ni reintento ciego ni "falló" |
| P8 | La pasarela está caída | Módulo degradable (`OnModuleInit` + probe + `moduleHealth`). **La caja manual jamás depende de una pasarela**: es Core Indestructible |
| P9 | Reversión ejecutada dos veces | Compensación idempotente: recalcular desde `SUM(pago_aplicaciones)`, nunca restar |
| P10 | Extorno de un pago ya conciliado con el banco | Prohibido sin permiso de supervisor + nota obligatoria. Rompe un cierre contable ya cerrado |
| P11 | Alguien desactiva un canal con pagos históricos | Baja lógica; el histórico lee catálogos sin filtrar `activo` |
| P12 | Alguien cambia la cuenta receptora de un pago registrado | Permitido con permiso, auditado con valor anterior. Es un movimiento de tesorería, no una corrección de tipografía |
| P13 | Reloj del cajero desfasado / `fechaPago` retroactiva | `fechaPago` acotada: no futura, no anterior a N días sin permiso. Una fecha retroactiva mueve el pago a un período contable cerrado |
| P14 | Cliente paga el último día y el cron de corte corre esa madrugada | Ya cubierto por la reevaluación en el registro; el reconciliador es la red. Test explícito del caso frontera |
| P15 | Pago aplicado a una factura anulada en paralelo | El UPDATE condicional excluye `anulada`; el rechazo es explícito |
| P16 | Restauración de backup: se reprocesan webhooks | La idempotencia debe ser **persistente**, nunca en memoria ni en caché |

**Sobre P1:** es el único hueco abierto del flujo actual. Un cobro en efectivo no tiene
número de operación, y hoy nada impide que un doble clic genere dos filas de S/ 85. Es la
violación de la invariante 2 más probable en el día a día, y es de la Etapa I.

---

## 7. Etapas

El secuenciamiento en dos etapas de la propuesta es correcto y se conserva. Se corrige el
contenido.

### Etapa I — Núcleo de registro (Core Indestructible)

| # | Entregable | Cierra |
|---|---|---|
| I.1 | Catálogos (forma/canal/cuenta extendida) + migración versionada y reversible | §2 |
| I.2 | Reanclaje del índice único a canal | §2.7 |
| I.3 | **Cierre de la frontera**: encapsular `aplicarPago`, reencauzar adelantos y notas de crédito, test de frontera, invariante de contabilidad | §3 |
| I.4 | **Extorno completo** con motivos, atomicidad y sin corte automático | §4 |
| I.5 | Clave de idempotencia por request (hueco del efectivo, P1) | §6 |
| I.6 | Formulario en cascada con autocompletado y permisos | §8 |
| I.7 | Comisión bruto/neto + asiento en `finanzas-opex` | §2.5 |
| I.8 | Cierre de caja / arqueo por cuenta y responsable | §2.4 |
| I.9 | **Contrato del adaptador de cobro**, definido aunque no se implemente ninguno | §7.1 |
| I.10 | Reportes migrados al eje canal (`reportes.service.ts:79`) | §7.2 |

**Criterio de "estable" antes de abrir la Etapa II** — no es una impresión, son cinco
hechos verificables:

1. El invariante `monto_pagado == SUM(aplicaciones)` da cero divergencias durante 30 días
   corridos en producción.
2. El test de frontera está en CI y ha bloqueado al menos una regresión (o se ha verificado
   que falla al introducirla a propósito).
3. Un extorno real ejecutado en producción, revisado a mano de punta a punta.
4. Un cierre de caja mensual cuadrado sin ajustes manuales.
5. Cero pagos con `aplicadoEn IS NULL` de más de 15 minutos en el período.

#### 7.1 El contrato del adaptador se fija en la Etapa I

Aunque no se implemente ninguna integración. Si se deja para la Etapa II, **la primera
integración lo define de facto** y las demás se acomodan a las peculiaridades de Niubiz.

MercadoPago, que ya está en producción, es el caso de prueba: si la abstracción no puede
absorber el único proveedor real que existe hoy, la abstracción está mal. Una interfaz
diseñada sin ninguna integración viva es una hipótesis, y la rompe el primer proveedor.

Todo adaptador devuelve `ResultadoOperacion`, nunca excepciones HTTP; el transporte traduce
en el borde con `traducirAHttp`.

#### 7.2 Sobre los reportes

`reportes.service.ts:79` agrupa ingresos por `metodo_pago`. Al cambiar el eje, el reporte
cambia de significado sin que nadie lo pida. Se migra a **canal**: la pregunta real del
negocio es "cuánto entró por Yape", no "cuánto por billetera electrónica". El corte por
forma queda disponible por agregación.

### Etapa II — Motor de cobro

| # | Entregable |
|---|---|
| II.1 | Motor de cobro: orquesta, **nunca registra** |
| II.2 | `cobro_intento`: máquina de estados de un cobro en vuelo |
| II.3 | Conciliador de intentos no resueltos (P6) |
| II.4 | Adaptadores: MercadoPago migrado primero, luego Niubiz/Izipay/Culqi |
| II.5 | Webhooks idempotentes, con verificación de firma |
| II.6 | Cobro presencial (POS/QR/NFC) |

**Corrección de encuadre:** el Portal del Cliente y la app móvil **no son módulos del motor
de cobro**, son consumidores de su API (y `portal-facturacion.service.ts` ya existe).
Incluirlos dentro infla la etapa y difumina la frontera que todo el diseño intenta
proteger. Van en su propio plan.

#### 7.3 El estado en vuelo

Un cobro en línea tiene estados que el registro manual no tiene:

```
iniciado → pendiente → { aprobado | rechazado | expirado | indeterminado }
                                │
                                ▼
                    PagosService.registrar()
```

`indeterminado` es un estado de primera clase, no un error. Es VIO aplicado al dinero:
**"aceptado por la pasarela" ≠ "registrado en el ERP"**, exactamente como "comando aceptado
por la OLT" ≠ "configuración materializada". El mismo defecto que costó el incidente
CNT-2026-000004, aplicado a dinero en lugar de a una ONU.

Sin `cobro_intento` no hay forma de detectar dinero cobrado al abonado que el ERP nunca
supo, y ese caso no lo reporta un log: lo reporta el cliente, enfadado, semanas después.

---

## 8. Interfaz de registro

### 8.1 Cascada

```
Factura(s) → Forma de Pago → Canal → Cuenta Receptora → Monto → [Nº Op.] → [Voucher] → Fecha
```

- Los canales se filtran por forma; las cuentas se sugieren por canal.
- `requiere_numero_operacion` controla obligatoriedad **y** visibilidad.
- La cuenta receptora sugerida es editable **solo** con permiso `cobranza.cambiar_cuenta`.
  Si el usuario no lo tiene y la cuenta por defecto está inactiva, el canal no se ofrece —
  no se ofrece un camino que termina en un error.

### 8.2 Permisos

`cobranza.registrar` · `cobranza.verificar` · `cobranza.cambiar_cuenta` ·
`cobranza.extornar` · `cobranza.extornar_conciliado` · `cobranza.fecha_retroactiva` ·
`cobranza.cerrar_caja`

Separados a propósito: quien cobra no debería ser quien verifica ni quien extorna. Es
segregación de funciones, el control antifraude más barato que existe en un módulo de caja.

### 8.3 Regla de UX con consecuencia contable

El formulario **no permite guardar en estado ambiguo**. No hay borradores de pago. Un pago
existe o no existe; un "pago a medio registrar" es dinero sin dueño.

---

## 9. Auditoría y observabilidad

**Auditar** (usuario, IP, origen, timestamp, valores previo y posterior): registro,
verificación, extorno, cambio de cuenta receptora, cambio de comisión, cierre de caja,
altas/bajas de catálogo.

**Métricas con alerta:**

| Métrica | Umbral |
|---|---|
| Pagos con `aplicadoEn IS NULL` | > 0 durante 15 min |
| Divergencia `monto_pagado` vs `SUM(aplicaciones)` | > 0 filas |
| Extornos por cajero y día | Desviación sobre la media |
| `cobro_intento` sin resolver | > 30 min |
| Pagos sin cuenta receptora posteriores al corte | > 0 filas |

Regla de logging vigente en el proyecto: **un log describe lo que ocurrió, nunca lo que el
código pretendía hacer.** En cobranza esto es literal — un log que dice "pago aplicado"
cuando solo se registró es la clase de afirmación que hace que nadie mire el reconciliador.

---

## 10. Lo que este diseño deliberadamente NO hace

Declararlo evita que se implemente por inercia:

- **No corta el servicio automáticamente al extornar** (§4.4).
- **No reparte un pago insuficiente entre varias facturas** (§5.1).
- **No borra pagos** (§4.1).
- **No permite que el módulo de facturación aplique dinero** (§3).
- **No construye un `PaymentRegistryService` nuevo** (§1).
- **No hace multimoneda con tipo de cambio automático.** Se valida coincidencia y se rechaza
  la divergencia (§5.3); el día que el negocio cobre en dólares, se diseña.
- **No integra ninguna pasarela en la Etapa I.**

---

## 11. Resumen ejecutivo

Lo que la propuesta original describía como construcción está, en su mayor parte,
construido. El valor real de este proyecto está en cuatro cosas que hoy faltan y que son
justamente las que separan un módulo que funciona de uno que aguanta años:

1. **Saber dónde está el dinero** — el eje de cuenta receptora, que hoy simplemente no
   existe.
2. **Una frontera que se sostiene sola** — tres escritores paralelos cerrados y un
   invariante que delata al cuarto el día que aparezca.
3. **Poder deshacer** — extorno atómico, tipificado y sin corte automático.
4. **Saber cuándo el sistema no sabe** — `indeterminado`, `cobro_intento` y el conciliador:
   la diferencia entre un ERP que se equivoca y uno que lo dice.

La Etapa II es entonces mecánica: adaptadores contra una frontera probada. Si la Etapa I se
cierra bien, ningún proveedor de pago que se sume en los próximos años obliga a tocar la
lógica de negocio. Si se cierra mal, cada integración nueva vuelve a abrir la caja.
