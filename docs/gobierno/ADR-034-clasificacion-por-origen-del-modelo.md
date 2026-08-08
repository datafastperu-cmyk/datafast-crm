# ADR-034 — Se clasifica por el origen del modelo, no por la naturaleza del módulo

**Estado:** **Aceptada** — 2026-08-08, Datafast (decisión **D15**, propuesta del propietario)
**Decide:** Datafast · **Sustituye:** la tabla de clasificación de **PD-11** ·
**Refina:** **ADR-030** · **Conserva:** los dos guards de PD-11

---

## 1. Problema

PD-11 clasifica los módulos por **naturaleza** — Estratégico, Maduro, Integración, Soporte,
Transversal — y con eso mezcla dos ejes que no son el mismo:

| Eje | Respuesta en este ERP |
|---|---|
| ¿Quién escribe el código? | **Siempre nosotros.** Es un monolito modular y no va a dejar de serlo |
| ¿De dónde sale el **modelo**? | **Depende**, y es lo único que hay que decidir antes de diseñar |

Al mezclarlos, la clasificación no responde la pregunta que se hace quien va a construir. Y el
resultado se ve en el código: **~24.100 LOC reimplementan problemas resueltos**, y el caso más
caro no fue escribir código de más, sino **reinventar un concepto**:

> `contratos.deuda_total` **no debería existir.** Un modelo contable estándar deriva la deuda de
> los apuntes por cobrar abiertos: no hay nada que sincronizar y, por tanto, nada que pueda
> contradecirse. Almacenarla produjo cuatro implementaciones divergentes del cálculo (A-4) y el
> incidente del 2026-08-04 — ficha S/64, deuda real S/128, reactivación denegada tras pagar.
>
> **No se inventó código: se inventó un concepto que llevaba décadas resuelto.**

---

## 2. El criterio

Tres regímenes, con una sola pregunta que los separa:

> **¿Existe una autoridad externa que pueda decir que lo hicimos mal?**

| | Régimen | Cuándo | Consecuencia |
|---|---|---|---|
| 🔴 | **Conformidad** | Hay una **autoridad**: un organismo, una norma o un estándar de facto cuyo incumplimiento **es un defecto** | Desviarse **exige un ADR**. Nadie declara conformidad sin *gap analysis* (ADR-030 §4.1) |
| 🟠 | **Referencia** | Hay un **modelo maduro** pero ninguna autoridad. Se estudia y se adapta al negocio ISP | **Consultarlo es obligatorio** y queda registrado en el ADR de diseño. Adaptarlo es libre |
| 🟢 | **Estratégico** | **No hay modelo aplicable**, o el nuestro es la ventaja competitiva | Diseño propio. Aquí va la innovación |

**Por qué esta pregunta y no otra:** la propuesta original usaba 🔴 «no reinventar» y 🟠 «modelo
establecido» como etiquetas distintas, pero varias filas llevaban ambas a la vez —*Proveedores 🔴
Modelo establecido*, *Backups 🔴 Modelo establecido*—. Si no se distinguen leyendo la fila, la
clasificación no sobrevive al primer módulo nuevo, que es para lo único que sirve.

### 2.1 Los dos guards, que no cambian

Se conservan intactos de PD-11, y sin ellos esta política hace daño:

| # | Guard |
|---|---|
| 1 | **Adoptar conocimiento externo NO es adoptar código externo.** Se adopta el modelo de datos, la máquina de estados, el vocabulario y las reglas. **El código sigue siendo nuestro.** Verificar licencia y versión de cualquier producto que se estudie antes de mirarlo |
| 2 | **Ningún invariante propio se elimina por adoptar un modelo externo sin un ADR que lo justifique.** El más claro: *la gracia es la distancia vencimiento→corte, no se suma al vencimiento*. Ningún producto de industria trae eso, y perderlo sería un corte masivo |

---

## 3. Clasificación de lo que EXISTE

45 módulos, **85.466 LOC**. Se clasifica lo que hay; lo que no existe va en §4, separado a
propósito — este corpus ya se equivocó tres veces describiendo cosas inexistentes.

### 3.1 🟢 Estratégico — no se busca modelo externo

| Módulo | LOC | |
|---|---|---|
| `olt-nativo` | 23.680 | Provisionamiento GPON, ZTP, pools, máquina de estados FTTH |
| `mikrotik` | 7.852 | Automatización RouterOS, PPPoE, colas, address-lists |
| `planta-externa` | 3.566 | Cajas NAP, presupuesto óptico, trazas |
| `openvpn` | 2.365 | Ciclo de vida de certificados y túneles |
| `smartolt` | 2.272 | Orquestación FTTH |
| `monitoreo` | 2.231 | Estado de red ISP |
| `xui` · `tr069` · `aprovisionamiento` · `reconciliador` | 2.325 | IPTV, ACS, orquestación, reconciliación físico↔lógico |
| **Total** | **~44.300** | **Es el activo tecnológico. Buscar aquí un modelo externo sería el error inverso.** |

### 3.2 🔴 Conformidad — hay autoridad

| Módulo | LOC | Autoridad | Estado |
|---|---|---|---|
| `auth` · `usuarios` | 2.143 | **RBAC/ABAC · OWASP ASVS** | **B-3 abierta**: permiso fino incompleto en endpoints mutantes |
| `auditoria` | 792 | Modelo de *audit trail*: actor, acción, recurso, antes/después, correlación, retención | Sin declarar |
| `backup` | 560 | Estrategia probada: copia, restauración, retención y **verificación de la restauración** | Sin declarar |
| `outbox-red` | 971 | **Transactional outbox** — patrón con nombre propio | Implementado correctamente **tras** 1.788 reintentos contra el MA5800 (ADR-002/003). Se llegó al patrón por dolor |
| `health` · `sistema` (actualizaciones) | 1.807 | Versionado, migraciones, *rollback*, *health checks* | Parcial |

### 3.3 🟠 Referencia — hay modelo, no autoridad

| Módulo | LOC | Modelo a consultar |
|---|---|---|
| `facturacion` · `pagos` | 9.277 | Modelo contable: comprobante, línea, saldo, aplicación de pago, nota de crédito, período |
| `workers` (cobranza) · `promesas-pago` | 3.177 | *Dunning*: niveles de aviso, *aging buckets*, promesa de pago, escalado |
| `contratos` · `planes` | 3.881 | *Contract lifecycle* · Producto/Servicio/Recurso (ADR-030 §2.3) |
| `clientes` · `crm-nativo` | 4.447 | *Customer lifecycle*, contactos, actividades |
| `notificaciones` · `mensajeria` · `plantillas` | 3.079 | Plantillas, canales, preferencias, cola, reintentos, *dead-letter* |
| `finanzas-opex` · `proyectos-inversion` | 1.045 | Modelos financieros de gasto e inversión |
| `portal` | 3.526 | Autoservicio del abonado |
| `config` · `licencia` · `tickets` · `reportes` · resto | ~3.400 | *Configuration management* · *entitlements* · ITIL · separación OLTP/reporting |

---

## 4. Dominios que NO existen todavía

**No están en §3 a propósito.** Aquí la clasificación es norma para cuando se construyan, no
descripción de nada.

| Dominio | | Nota |
|---|---|---|
| **Contabilidad** | 🔴 | Principios contables. `finanzas-opex` es gasto, no contabilidad |
| **Facturación electrónica SUNAT** | 🔴 | **PD-12 aplica: el marco legal se fija antes del diseño** |
| **RENIEC** | 🔴 | Interfaz oficial |
| **Compras / Proveedores** | 🟠 | *Procure-to-Pay*, maestro de proveedores |
| **Inventario / almacén** | 🟠 | Movimientos, valoración. Nace degradado (regla del CLAUDE.md) |
| **Observabilidad** | 🔴 | **OpenTelemetry** — ver §6.1, su adopción está condicionada |
| **Workflows** (motor genérico) | 🟠 | `sagas` no es un motor de workflow |
| **Documentos** · **Calendario** · **BI** · **API Gateway** | 🟠 | Modelos consolidados |

---

## 5. Los cinco candidatos a adoptar modelo, con su disparo

**Adaptar un módulo existente casi nunca vale la pena «porque sí».** Vale la pena en dos momentos:
cuando **ya duele** o cuando **estás a punto de extenderlo**. Por eso llevan condición de disparo,
no fecha.

| # | Módulo | Evidencia de que reinventar costó | Se dispara cuando |
|---|---|---|---|
| 1 | **facturacion + pagos** | **A-4**: cuatro cálculos de deuda, uno reactivaba morosos. `deuda_total` almacenada en vez de derivada. Incidente 04/08 | **Antes de diseñar H2-1 (SUNAT)** — ya obligatorio por PD-11 |
| 2 | **cobranza** | **Tres fórmulas distintas** del ciclo de cobro; el corte caía antes del vencimiento (incidente 05/08) | Al tocar el ciclo de mora o añadir un nivel de aviso |
| 3 | **notificaciones + mensajeria** | **Cinco módulos escriben `notificaciones_logs`** (ADR-032) | Al añadir un canal nuevo |
| 4 | **auth + usuarios** | **B-3 abierta** | Al cerrar B-3: se alinea con ASVS y se cierra el modelo a la vez |
| 5 | **auditoria** | Sin incidente. Pequeño y muy estandarizado | Al tocarlo por cualquier motivo |

**`contratos` queda fuera de la lista.** El colapso Producto/Servicio/Recurso está registrado como
deuda de modelo (DOM-001 §8.9.2), pero re-modelar el agregado raíz es de otro orden de magnitud.
Registrado, no programado.

> **Un dato que cambia el marco:** CON-001 §8.11.3 prohibía re-modelar con desviaciones críticas
> abiertas. **Desde el 2026-08-08 hay cero.** Esa puerta está abierta por primera vez — abrirla no
> obliga a cruzarla.

---

## 6. Precisiones sobre la propuesta original

### 6.1 OpenTelemetry: destino sí, adopción no todavía

Es el estándar y se declara como tal (🔴). **Pero hoy no cabe**: el servidor tiene **1,9 GB en swap
sobre 2 GB de RAM física y 2 CPUs**. Un colector añade 100–200 MB. Adoptarlo ahora degradaría el
ERP para poder observarlo mejor.

Mientras tanto, el latido de ADR-020 ya registra duración por cron, que es la mayor parte del valor
a coste cero. **Su adopción queda condicionada a capacidad, y esa condición se escribe aquí para
que no se lea como una tarea pendiente sino como una decisión tomada con su motivo.**

### 6.2 ISO 20022: referencia, no marco

Es mensajería **interbancaria**. Las integraciones de este ERP son Yape, Plin, transferencias y
pasarelas, cada una con su propia API. Se anota como referencia **si algún día hay conciliación
bancaria automatizada**; no es el marco del módulo de pagos.

### 6.3 Lo que esta clasificación NO autoriza

- **No autoriza refactorizar nada por estar en 🟠 o 🔴.** La lista de §5 lleva disparos, no fechas.
- **No autoriza declarar conformidad con ninguna norma** sin *gap analysis* previo (ADR-030 §4.1).
- **No autoriza buscar modelo externo para lo 🟢.**
- **No autoriza tocar los dos guards de §2.1.**

---

## 7. Consecuencias

**Positivas:** quien va a construir un módulo tiene una pregunta única y contestable —*¿hay una
autoridad que pueda decir que lo hicimos mal?*— en vez de una taxonomía de cinco categorías que
mezclaba ejes. Los 45 módulos quedan clasificados, y lo que no existe queda separado de lo que sí.

**Negativas:** una clasificación es una foto y envejece. Un módulo puede cambiar de régimen —
`outbox-red` habría sido 🟠 antes de que el patrón se le pusiera nombre. **Se revisa cuando se
añade un módulo, no periódicamente**: un repaso por calendario se convierte en trámite.

**Riesgo declarado:** §5 puede leerse como una lista de trabajo pendiente. No lo es. Cinco
adopciones sin disparo serían cinco refactores buscando excusa — exactamente lo contrario de lo que
esta decisión pretende.
