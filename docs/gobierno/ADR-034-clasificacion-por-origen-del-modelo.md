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

> **La primera versión de este criterio no aguantaba su propia tabla.** Preguntaba *«¿existe una
> autoridad externa que pueda decir que lo hicimos mal?»* y después clasificaba como 🔴 a `auth`,
> `auditoria`, `backup`, `outbox-red` y `health` — **cinco filas donde no hay ninguna autoridad**.
> La columna se titulaba «Autoridad» y estaba rellena con **modelos**. Es el mismo defecto que este
> ADR le señalaba a la propuesta original. Corregido aquí, el mismo día.

### 2.1 Las autoridades reales de Datafast son cuatro

Conviene tenerlas nombradas, porque la lista es corta y todo lo demás **no** lo es:

| Autoridad | Qué puede hacer |
|---|---|
| **SUNAT** | Rechazar un comprobante electrónico mal formado |
| **RENIEC** | Su interfaz oficial, o ninguna |
| **Bancos y pasarelas de pago** | Aceptar o no el mensaje |
| **Un auditor o la administración tributaria** | Declarar los libros inválidos |

### 2.2 Pero «autoridad» no es la única razón para no inventar

Hay **tres**, y colapsarlas en una fue el error. Cada fila 🔴 debe decir **cuál** aplica:

| # | Razón | Qué pasa si nos desviamos |
|---|---|---|
| **1** | **Interoperabilidad** — alguien al otro lado tiene que aceptar lo que producimos | SUNAT rechaza · el banco no procesa · ninguna herramienta lee nuestras trazas |
| **2** | **Examen de un tercero** — alguien puede revisarlo y declararlo inválido | Un auditor no acepta los libros |
| **3** | **Riesgo asimétrico** — no hay nadie enfrente, pero **inventar cuesta desproporcionadamente caro y el error no se ve hasta que te explotan** | Criptografía o autenticación propias |

### 2.3 Los tres regímenes

| | Régimen | Cuándo | Consecuencia |
|---|---|---|---|
| 🔴 | **Conformidad** | Se cumple **al menos una** de las tres razones de §2.2. **La fila debe decir cuál** | Desviarse **exige un ADR**. Nadie declara conformidad sin *gap analysis* (ADR-030 §4.1) |
| 🟠 | **Referencia** | Hay un modelo maduro y **desviarse solo nos cuesta a nosotros**: más trabajo, peor diseño, ninguna consecuencia externa | **Consultarlo es obligatorio** y queda en el ADR de diseño. Adaptarlo es libre |
| 🟢 | **Estratégico** | **No hay modelo aplicable**, o el nuestro es la ventaja competitiva | Diseño propio. Aquí va la innovación |

> **Si todo es 🔴, nada lo es.** Al aplicar bien el criterio, el 🔴 de los módulos existentes pasa de
> cinco a **uno**. Esa reducción no es una rebaja de exigencia: es lo que hace que un 🔴 signifique
> algo cuando aparezca.

**El régimen puede cambiar.** `auditoria` es 🟠 hoy; el día que su registro sirva como evidencia
ante un tercero pasa a 🔴 por la razón 2. Se reclasifica cuando cambia el hecho, no en un repaso
por calendario.

### 2.4 Los dos guards, que no cambian

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

### 3.2 🔴 Conformidad — uno solo, y por riesgo asimétrico

| Módulo | LOC | Razón | Referencia | Estado |
|---|---|---|---|---|
| `auth` · `usuarios` | 2.143 | **3 — riesgo asimétrico** | **OWASP ASVS · RBAC/ABAC** | **B-3 abierta**: permiso fino incompleto en endpoints mutantes |

Nadie sanciona a Datafast por su modelo de permisos. Está en 🔴 porque **inventar autenticación,
sesiones o control de acceso cuesta desproporcionadamente caro y el error no se manifiesta hasta
que alguien lo explota** — no hay ciclo de realimentación que lo corrija por su cuenta.

### 3.3 🟠 Referencia — hay modelo, desviarse solo nos cuesta a nosotros

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
| `auditoria` | 792 | *Audit trail*: actor, acción, recurso, antes/después, correlación, retención. **Pasaría a 🔴 (razón 2) el día que su registro sirva como evidencia ante un tercero** |
| `backup` | 560 | Copia, restauración, retención y **verificación de la restauración** — la parte que casi nadie hace |
| `health` · `sistema` (actualizaciones) | 1.807 | Versionado, migraciones, *rollback*, *health checks* |
| `outbox-red` | 971 | *Transactional outbox*. **Ya resuelto correctamente** — ver nota |

> **`outbox-red` no es un candidato a adoptar nada.** El patrón está bien implementado, con reclamo
> atómico, dueño y TTL (ADR-002). Se llegó a él **por dolor** —1.788 reintentos contra el MA5800 en
> cuatro días— en vez de por consulta previa, y esa es justamente la historia que este ADR existe
> para no repetir. Figura aquí como referencia declarada, no como trabajo pendiente.

---

## 4. Dominios que NO existen todavía

**No están en §3 a propósito.** Aquí la clasificación es norma para cuando se construyan, no
descripción de nada.

> **Enmienda 2026-08-15.** Se añaden **Direccionamiento (IPAM)** y **Gestión de CPE**, creados como
> dominios propios en E-0.4 (D-28, D-32) y que hasta hoy no figuraban aquí — incumplimiento de
> **PD-11**, detectado en la [verificación transversal](E-0.2-4-verificacion-transversal.md) como
> hallazgo **F-7** y propuesto en **ADR-036 §4.6**.

| Dominio | | Razón (§2.2) | Nota |
|---|---|---|---|
| **Facturación electrónica SUNAT** | 🔴 | **1 — interoperabilidad** | SUNAT rechaza el comprobante. **PD-12: el marco legal se fija antes del diseño** |
| **RENIEC** | 🔴 | **1 — interoperabilidad** | Su interfaz oficial, o ninguna |
| **Contabilidad** | 🔴 | **2 — examen de un tercero** | Un auditor puede declarar los libros inválidos. `finanzas-opex` es gasto, no contabilidad |
| **Observabilidad** | 🔴 | **1 — interoperabilidad** | **OpenTelemetry**: sin él, ninguna herramienta lee nuestras trazas. **Adopción condicionada — §6.1** |
| **Compras / Proveedores** | 🟠 | — | *Procure-to-Pay*, maestro de proveedores |
| **Inventario / almacén** | 🟠 | — | Movimientos, valoración. **Nace degradado** (regla del CLAUDE.md) |
| **Workflows** (motor genérico) | 🟠 | — | `sagas` no es un motor de workflow |
| **Documentos** · **Calendario** · **BI** · **API Gateway** | 🟠 | — | Modelos consolidados |
| **Direccionamiento (IPAM)** | 🟠 | — | *Enmienda 2026-08-15.* Creado como dominio propio en **E-0.4 D-28**, cerrando la excepción que E-0.1 §35 dejó abierta. Hay modelo maduro de gestión de direccionamiento y **desviarse solo nos cuesta a nosotros**: ninguna de las cuatro autoridades reclama nada aquí |
| **Gestión de CPE (TR-069/TR-369)** | 🟠 | — | *Enmienda 2026-08-15.* Creado como dominio propio en **E-0.4 D-32**, resolviendo la duplicidad E-0.1 §6.3 / D-0.3 §3. **Ojo con el límite:** el ERP **ya conforma** con el protocolo (ADR-030 §2.2) — eso es 🔴 por interoperabilidad con el CPE. Lo que aquí se clasifica 🟠 es **el modelo del dominio**: qué posee, qué expone y cómo se sustituye el servidor de gestión |

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
