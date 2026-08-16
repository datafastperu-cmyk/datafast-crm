# ADR-036 — Benchmark del Core: qué se adopta de TM Forum, qué se adapta y qué sigue sin fuente

**Estado:** **Aceptada** — 2026-08-14, Datafast
**Decide:** Datafast (propietario del producto) en §4.1 · Arquitectura en §4.2 a §4.6
**Cumple:** **PD-11** (ADR de benchmark antes de diseñar) · **PD-13** (divergencia clasificada y
correspondencia declarada) · **ADR-030 §4.1 regla 3** (ninguna conformidad sin comparación)
**Insumo:** [docs/estudio/core-benchmark.md](../estudio/core-benchmark.md) — cuatro
especificaciones descargadas y citadas el 2026-08-14
**Supersede parcialmente:** **ADR-035 §4.1** (solo la cardinalidad; el resto se conserva)
**Relacionado:** ADR-030 · ADR-032 · ADR-034 · ADR-035 · E-0.2 · E-0.3 · E-0.4 ·
[verificación transversal](E-0.2-4-verificacion-transversal.md)

---

## 1. Problema

E-0.2, E-0.3 y E-0.4 —39 fichas de decisión sobre el Core— se escribieron **sin el ADR de benchmark
que PD-11 exige antes de diseñar**, y con referencias externas tomadas de memoria. La verificación
transversal lo registró como hallazgo **F-2**, y PD-13 condición 1 lo califica sin ambigüedad:

> *«Sin fuente no es "el sector": es una conjetura.»*

Además, **E-0.2 D-1 y ADR-035 §4.1 se contradecían** sobre la cardinalidad de la Cuenta de
Facturación (hallazgo **F-1**), y ADR-035 era el único de los dos con fuente citable.

---

## 2. Lo que dicen las fuentes

Cuatro especificaciones de TM Forum, repositorios `tmforum-apis`, licencia Apache 2.0, leídas el
2026-08-14. Las citas textuales están en el estudio §2; aquí solo lo que decide.

| # | Hecho verificado | Fuente |
|---|---|---|
| **1** | `Product.billingAccount` es **referencia a un objeto único**, no un array | TMF637 v4.0.0 |
| **2** | `BillingAccount` **no tiene campo** que apunte a producto o acuerdo, y **nada limita** cuántas cuentas tiene un titular | TMF666 v5.0.0 |
| **3** | *«A product is realized as one or more service(s) and / or resource(s)»* | TMF637 v4.0.0 |
| **4** | `Service.supportingService` y `supportingResource` son **arrays**; *«only Service of type RFS can be associated with Resources»* | TMF638 v4.0.0 |
| **5** | `ProductStatusType` distingue `cancelled` de `terminated`, y añade `pendingTerminate`, `aborted`, `created` | TMF637 v4.0.0 |
| **6** | `suspended` existe en `ProductStatusType` y **no** en `ServiceStateType` | TMF637 · TMF638 |
| **7** | `ServiceOrderStateType` incluye **`partial`**; `relationshipType` define *«dependency if the order item needs to be not started until another order item is complete»* | TMF641 v3.0.0 |
| **8** | `ServiceOrderStateType` tiene **nueve** estados; C §5 define siete. Falta **`rejected`** | TMF641 v3.0.0 |
| **9** | `Resource` declara `resourceStatus`, `administrativeState`, `operationalState` y `usageState` como propiedades **separadas** | TMF639 v4.0.0 |
| **10** | La intención se expresa como **estado deseado del recurso** (CRUD sobre `/service`), **no** como catálogo de verbos | TMF640 v3.0.0 |
| **11** | La ejecución asíncrona es entidad consultable: `/monitor` con `monitorStateChangeNotification` | TMF640 v3.0.0 |
| **12** | USP define `Controller` y `Agent` como roles **funcionales**, y **no exige** que el controlador esté separado del nodo de acceso | Broadband Forum USP (TR-369) |
| **13** | Las comunicaciones internas exigen *«strong authentication… resistant to replay attacks»* y confianza acotada a CAs concretas | OWASP ASVS 5.0 V12.3.3-12.3.5 |

*(Hechos 1-6: primera ronda. 7-9: segunda. 12 y el límite de ITU-T: tercera. 10, 11 y 13: cuarta.
Detalle y citas completas en el estudio.)*

---

## 3. La corrección de fondo sobre F-1

De los hechos 1 y 2 se sigue algo que ninguno de los dos documentos en conflicto había visto:

> **El estándar fija «un producto, una cuenta» y guarda silencio sobre cuántos productos comparten
> cuenta.**

Por tanto **ninguna de las dos posturas se desvía del estándar**: E-0.2 D-1 (una cuenta por
contrato) y ADR-035 §4.1 (una por cliente) son ambas expresables y ambas conformes. **F-1 no era un
problema de conformidad.** Era una decisión de negocio que se estaba discutiendo con el argumento
equivocado — y ese argumento habría hecho ceder a la postura correcta por la razón falsa de «el
estándar dice otra cosa».

---

## 4. Decisión

### 4.1 La Cuenta de Facturación es 1:1 con el Contrato *(decide el propietario)*

**Decisión del propietario, 2026-08-14:** *«cada contrato deberá tener su cuenta de facturación, por
lo que si un cliente tiene 3 contratos deberá tener 3 comprobantes»*.

| | |
|---|---|
| **Clasificación PD-13** | **Adoptado** — se toma la estructura del estándar (`Product.billingAccount` único) tal cual |
| **Confirma** | A §13, A §14, A+B-I09 (congelados) y E-0.2 D-1 |
| **Supersede** | **ADR-035 §4.1** en la cardinalidad: la cuenta **no** es una por cliente |
| **Conserva de ADR-035** | Todo lo demás: la cuenta es **entidad propia**, y el ciclo y el tipo de comprobante **viven en ella**. Los dos documentos siempre coincidieron en la entidad |

**Qué se pierde, declarado:** la agrupación de varios contratos en un comprobante. Un abonado con
tres contratos recibe tres, y no existe forma de emitir uno solo.

**Qué NO se pierde:** el caso inexpresable que motivó ADR-035 —*«boleta en casa y factura en el
negocio, mismo titular»*— queda cubierto, porque casa y negocio son **contratos distintos**: dos
contratos, dos cuentas, cada una con su tipo de comprobante.

**Consecuencia operativa ya aceptada:** el corte es por contrato. Un abonado puede quedar con el
Contrato A suspendido y el B activo (E-0.3 D-26, C §46).

---

### 4.2 Correspondencia declarada Datafast ↔ TM Forum *(PD-13 condición 4)*

Toda la documentación sigue en español. Lo que se declara es el **mapeo**, para que nadie tenga que
adivinar si dos nombres son el mismo concepto.

| Concepto Datafast | Entidad TMF | Versión | Estado PD-13 |
|---|---|---|---|
| **Cliente** | `Party` / `Customer` | TMF632 / TMF629 ⚠ *no consultada* | **Adaptado** — un solo rol, sin separar Party (E-0.2 D-11) |
| **Contrato** | `Product` | TMF637 v4.0.0 | **Adoptado** |
| **Cuenta de Facturación** | `BillingAccount` | TMF666 v5.0.0 | **Adoptado** |
| **Servicio Contratado** | `Service` con `category` = *customer facing* (CFS) | TMF638 v4.0.0 | **Adoptado** |
| **Technical Binding** | `Service` con `category` = *resource facing* (RFS) | TMF638 v4.0.0 | **Adaptado** — misma posición en la cadena, nombre propio y **dueño declarado** (el módulo) |
| **Recursos del dominio** | `Resource` | TMF639 ⚠ *no consultada* | **Adoptado** por posición |
| **Proceso de Fulfillment** | `ServiceOrder` · y `Monitor` para la ejecución asíncrona | TMF641 v3.0.0 · TMF640 v3.0.0 | **Adaptado** — nombre propio; «monitor» significa otra cosa en operaciones |
| **Capacidad** | No hay entidad: el estándar usa **estado deseado** sobre `/service` | TMF640 v3.0.0 | **Adaptado** — capa imperativa, con cada verbo obligado a nombrar su estado destino |
| **Características comerciales** | `serviceCharacteristic` | TMF638 v4.0.0 | **Adoptado** |

**La cadena queda declarada así:**

```
TMF:      Product ──► Service (CFS) ──► Service (RFS) ──► Resource
Datafast: Contrato ─► Servicio Contratado ─► Technical Binding ─► recursos del dominio
```

**El Technical Binding no es un nivel de más: es el RFS con otro nombre.** Se conserva el nombre
propio porque expresa lo que el estándar no dice —que su dueño es el módulo técnico y no el Core—,
y porque «servicio de cara al recurso» no se entiende en una sala de operaciones.

---

### 4.3 Se abre revisión de A §16: falta el estado de lo cancelado sin activar

**Hallazgo H-4.** `ProductStatusType` distingue `cancelled` de `terminated`. **A §16 tiene cuatro
estados y ninguno para el contrato que se cancela sin haberse activado nunca** — que es exactamente
el caso que **C §37** describe (el cliente desiste antes de la instalación).

Hoy ese caso solo puede registrarse como **baja definitiva**, que el estándar reserva para lo que
**estuvo activo**. Se pierde una distinción con consecuencias reales: un contrato cancelado nunca
prestó servicio, nunca debió facturar, y **no es rotación de abonados**.

| | |
|---|---|
| **Clasificación de la desviación** (00-INDICE §7.3) | **Nivel B** — riesgo técnico: degrada la trazabilidad y las métricas, no causa daño irreversible |
| **Estado objetivo** | A §16 incorpora un estado para el procedimiento cancelado antes de la primera activación |
| **Qué la cierra** | **Revisión arquitectónica del corpus congelado.** Toca documento congelado: no se decide aquí |
| **Mientras tanto** | Se registra como desviación conocida. **Prohibido** inventar el estado por la vía de los hechos |

---

### 4.3bis Se abre revisión de C §5: falta el estado de la orden rechazada sin ejecutar

**Hallazgo H-7b, del mismo tipo que §4.3.** `ServiceOrderStateType` tiene **nueve** valores; **C §5**
define siete. El mapeo es limpio salvo en **`rejected`** — la orden que **no llega a ejecutarse
porque se rechaza de entrada**: sin cobertura, recursos no disponibles, datos inválidos. Hoy solo
cabría como `ERROR`, que significa otra cosa: que se intentó y falló.

| | |
|---|---|
| **Nivel** (00-INDICE §7.3) | **C** — mejora futura: degrada la trazabilidad, no causa daño |
| **Estado objetivo** | C §5 incorpora un estado para la orden rechazada sin ejecutar |
| **Qué la cierra** | **Revisión arquitectónica.** C está congelado. **Prohibido** crear el estado por la vía de los hechos |

> **Que el mismo hueco aparezca dos veces —`cancelled` en A §16 y `rejected` en C §5— sugiere
> criterio, no descuido: se modelaron los caminos que avanzan y no los que no arrancan.**

---

### 4.4 Se reclasifica E-0.2 D-5: su mitad comercial es conforme

**Hallazgo H-5.** `suspended` está en `ProductStatusType` y **no** en `ServiceStateType`: en el
estándar la suspensión ya es del producto —plano comercial—, no del servicio.

E-0.2 D-5 se declaró «aportación propia declarada» en su totalidad. **Era una pretensión de más.**
Queda: **conforme** en que la suspensión pertenece al plano comercial; **aportación propia** solo en
el mecanismo de derivación de la activación desde los servicios requeridos.

**Se corrige también por lo bajo:** `feasibilityChecked`, `designed` y `reserved` son fases previas a
la activación que nuestro `pendiente_activacion` colapsa en una. Es **Adaptado**, y ahora está
escrito.

### 4.4bis Otras dos reclasificaciones, ambas por haber leído la fuente

| Ficha | Antes | Ahora | Por qué |
|---|---|---|---|
| **E-0.3 D-13** | `Extendido` — «catálogo propio, sin referencia» | **`Adaptado`** | TMF640 **sí** es referencia: expresa la intención como **estado deseado**, no como verbos. Nuestro catálogo es una capa imperativa encima, y ahora obliga a que **cada verbo nombre su estado destino** — con lo que `ya_en_destino` se **deriva** en vez de implementarse (**PA-04**) |
| **E-0.4 D-32** | `Adoptado`, justificado en que «el estándar separa el ACS del nodo de acceso» | **`Adaptado`** | **La especificación no dice eso.** Define los roles de forma agnóstica a la topología. El argumento correcto es el inverso: meter la gestión del CPE en el dominio FTTH sería **restricción nuestra**, y se rompe con un abonado por radio |

**Las dos decisiones se mantienen; sus fundamentos cambian.** Y la de D-13 destapó una tensión
interna que ninguna revisión propia había visto: E-0.3 era **imperativo al pedir** y **declarativo al
comprobar**.

---

### 4.5 Alcance real de la validación, y qué implica para el estado de E-0.2/3/4

**De 40 fichas, quince tienen fuente citable** —D-1, D-3, D-4, D-5, D-7, D-13, D-16, D-18, D-24,
D-32 y D-38 completas; D-14, D-17, D-19 y D-31 parciales— más **D-29 solo por el título de su
norma**. **Las 24 restantes siguen siendo conjetura razonada.**

*(Cuatro rondas de fuentes, 2026-08-14 y 15. La cifra se recalcula sobre §14 de cada documento; no
se copia — 00-INDICE §7.4.)*

**Dónde está el techo, y por qué.** Las fichas que siguen sin fuente **no la tienen por naturaleza**:
D-15, D-20, D-21, D-22 y D-25 son **patrones de ingeniería** —durabilidad de la intención, reintentos
acotados, compensación, exclusión mutua, degradación—, no modelos de negocio, y no aparecen en las
APIs del sector. Buscar más no daría nada. Su respaldo es norma propia nacida de incidentes propios:
PA-01, PA-07, PA-16, PA-18, PA-19, PF-5, PC-03.

**E-0.4 tiene otro techo, distinto:** el cuerpo de ITU-T G.988 y G.984.1 **no es accesible** sin
compra, y no existe modelo abierto de planta pasiva (se buscó). Ese bloque no puede validarse más por
esta vía.

**Consecuencia de gobierno:** E-0.2, E-0.3 y E-0.4 **no pasan a Vigente en bloque**. Pasan por
bloques, a medida que cada uno tenga su fuente. Un documento que declarase conformidad global hoy
incumpliría ADR-030 §4.1 regla 3.

| Bloque | Estado tras este ADR |
|---|---|
| Modelo de información del Core (D-1, D-3, D-4, D-5, D-7) | **Validado con fuente** |
| Catálogo de capacidades (D-13) y verificación (D-18) | **Validado con fuente** (TMF640, TMF638) |
| Fulfillment y tareas (D-16, D-17) | **Validado con fuente.** `partial`, `dependency` y el recurso `Monitor` |
| Confianza entre fronteras (D-24) | **Validado con fuente** (ASVS 5.0 V12) |
| Inventario, recursos y CPE (D-19, D-31, D-32, D-38) | **Validado en parte.** Dimensiones de estado sí, valores no; roles USP sí, topología no |
| **Ejecución resiliente** (D-15, D-20, D-21, D-22, D-25) | **Conjetura razonada, y sin fuente posible** (§4.5). Respaldo: norma propia |
| Acceso FTTH (D-29) | **Solo título de norma.** Cuerpo de ITU-T no accesible |
| Resto de dominios (D-27, D-28, D-30, D-33…D-37, D-39) | **Conjetura razonada** |

---

### 4.6 Se adopta la taxonomía existente y se retira la inventada

**Hallazgo F-5.** E-0.2 §3 introdujo `conforme / divergencia restrictiva / expansiva / sin
referencia` cuando ya existían dos taxonomías vigentes.

**Se adopta PD-13** —`Adoptado` · `Adaptado` · `Extendido`— para la relación con el modelo del
sector, y los **niveles A/B/C** de 00-INDICE §7.3 para la gravedad de una desviación. **La taxonomía
inventada se retira** al reemitir los tres documentos.

**Y una clasificación pendiente:** IPAM y Gestión CPE (E-0.4 D-28, D-32) se crean sin figurar en
**ADR-034 §4**, que es donde viven los dominios que aún no existen. Se propone **🟠 referencia** para
ambos —hay modelo maduro y desviarse solo nos cuesta a nosotros—, **a confirmar en una enmienda a
ADR-034**, que es su documento.

---

## 5. Consecuencias

**Positivas.** F-1 queda resuelto con el argumento correcto en vez del falso. Seis fichas dejan de
ser conjetura. Aparece un hueco real en el corpus congelado (§4.3) que llevaba ahí desde que se
escribió C §37, y que ninguna cantidad de revisión interna habría encontrado: hizo falta leer la
fuente. Y el alcance de lo validado queda dicho con números, no con adjetivos.

**Negativas.** El diseño no queda validado: queda validado **en un 15 %**, y ahora eso está escrito.
Completar el resto exige consultar TMF639, TMF641, TMF622, TMF632 y los modelos de planta externa —
trabajo real, no una revisión de estilo.

**Lo que NO cambia:** la estructura del modelo. Ninguna fuente refutó ninguna ficha; refinaron dos
(§4.3, §4.4) y confirmaron cinco.

---

## 6. Qué NO autoriza esta decisión

- **No autoriza declarar conformidad con TM Forum.** Se han consultado cuatro APIs de un catálogo
  extenso, y el SID como modelo de información **no** se ha consultado.
- **No autoriza modificar A §16** (§4.3). Abre la revisión; no la cierra.
- **No autoriza pasar E-0.2/3/4 a Vigente** en bloque (§4.5).
- **No autoriza adoptar las Open APIs de TM Forum como interfaz del ERP.** Se adopta el **modelo**,
  no el transporte — ADR-030 §4.2 lo excluye expresamente y sigue vigente.
- **No autoriza clasificar IPAM ni Gestión CPE** fuera de ADR-034 (§4.6).

---

## 7. Estado

**Aceptada — 2026-08-14.**

| Pendiente | Dónde | Estado |
|---|---|---|
| ~~Revisión de **A §16** por el hueco de `cancelled` (H-4)~~ | **ADR-037** | ✅ **Cerrada** — `CANCELADO` añadido, 2026-08-15 |
| ~~Revisión de **C §5** por el hueco de `rejected` (H-7b)~~ | **ADR-037** | ✅ **Cerrada** — `RECHAZADO` añadido, 2026-08-15 |
| ~~Ratificar D-1, D-2, D-12 (E-0.2) y D-26 (E-0.3)~~ | E-0.2 §17 · E-0.3 §15 | ✅ **Ratificadas**, 2026-08-15 |
| **Comparativa dirigida de D-2 y D-12** (exigida por el propietario antes de ratificar) | Estudio H-15, H-16 | ✅ **Hecha — y cambió las dos fichas** |
| ~~Enmienda a ADR-034 §4 clasificando IPAM y Gestión CPE~~ | ADR-034 §4 | **Hecho** — ambos 🟠, 2026-08-15 |
| ~~Actualizar ADR-035: su §4.1 queda superseded en la cardinalidad~~ | ADR-035 | **Hecho** — nota de vigencia, 2026-08-15 |
| Consultar TMF622 · TMF632 · TMF629 (afectan a D-11) | docs/estudio | Pendiente, **accesibles** |
| ~~Refinar D-38 y D-19 con las dimensiones de estado~~ | E-0.3 v2.0 · E-0.4 v2.0 | **Hecho** |
| ~~Reemisión de E-0.2/3/4 con taxonomía PD-13, correspondencias y forma~~ | E-0.2/3/4 v2.0 | **Hecho** |
| ~~Consultar TMF641 completo, TMF639, TR-069/369, ASVS, planta exterior~~ | docs/estudio | **Hecho** — rondas 2, 3 y 4 |

**Nota de trazabilidad.** Este ADR se ha actualizado tras cada ronda de fuentes del mismo día
2026-08-14/15: la **segunda** confirmó D-16 y destapó H-7b y H-8; la **tercera** corrigió el
fundamento de D-32 y fijó el techo de E-0.4; la **cuarta** dio fuente a D-13, D-17, D-18 y D-24, y
destapó la tensión declarativo/imperativo. **La decisión de §4.1 no se vio afectada por ninguna.**
