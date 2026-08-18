# ADR-038 — El contrato de una lectura, y el veredicto de un conjunto

**Estado:** **Aceptada** — 2026-08-18, Datafast
**Decide:** **Propietario del producto**
**Modifica:** **E-0.3** — D-14 (§6 queda respondida) · D-15 (gana contrato de resultado) · tres
invariantes nuevos
**No modifica corpus congelado.** A · B · C · D-0.x · E-0.1 no definen forma de resultado
**Origen:** **R-6**, hueco de diseño registrado durante la Ola 1 de
[F-0.1](F-0.1-plan-de-reestructuracion.md)
**Relacionado:** E-0.3 D-13 §1.1 · D-16 · D-18 · E03-02 · E03-05 · E03-07 · E-0.2 E02-10 · E-0.4 E04-10

---

## 1. Problema

**D-14 define seis clases para una capacidad que MUTA.** Dos contratos quedaron sin definir, y nadie
lo notó mientras el único consumidor automático fue el outbox — que solo ejecuta mutaciones.

La Ola 1 los destapó con evidencia: al convertir las 26 capacidades aparecieron **cuatro** que no
cabían en las seis clases. Se registraron como excepciones locales
(`CASOS_FUERA_DE_D14_RESULTADO_OPERACION`, techo 4) en vez de decidirse sobre la marcha.

| Caso | Qué devuelve | Qué contrato le falta |
|---|---|---|
| `OnuTr069DetalleService.refrescarWifi()` | Una **lectura** que el portal pinta | El resultado de una **consulta** |
| `OnuTr069DetalleService.setWifi()` · `setWifiAmbasBandas()` | `ok / applied / total / fallidas` | El **éxito parcial** |
| `ProvisionFtthService.activarCarril()` | El **estado observado** tras aplicar | Dónde va la evidencia de la verificación |

> **El hueco no era uno: eran dos preguntas distintas** —qué responde una lectura, y qué responde un
> conjunto de partes— **más un dato que ya teníamos obligación de producir y estábamos tirando.**

**D-14 §6 ya fijaba el listón:** *«Una séptima clase exige ADR y demostrar que ninguna de las seis la
cubre.»* Este ADR es esa demostración, y sale en negativo: **no hace falta una séptima clase.**

---

## 2. Evidencia — fuentes consultadas, con cita textual

| Fuente | Cita verbatim | Qué decide |
|---|---|---|
| **TM Forum**, `ServiceOrderStateType.schema.json` | Descripción: *«Possible values for the state of the order»*. Enum: `acknowledged, rejected, pending, held, inProgress, cancelled, completed, failed, partial, assessingCancellation, pendingCancellation` | `partial` es estado **de la orden**, no de la acción |
| **TM Forum**, `ServiceOrderItem.schema.json` | `state`: *«State of the order item: described in the state machine diagram. This is the requested state.»* | Las **partes se rastrean individualmente**; por eso el agregado puede ser parcial |
| **Kubernetes**, API conventions | *«The status summarizes the current state of the object in the system, and is usually persisted with the object by automated processes **but may be generated on-the-fly**.»* | Una lectura puede venir del almacén o del plano real, y **eso es parte del dato** |
| **Kubernetes**, `status.conditions` | `status`: *«one of True, False, **Unknown**»* · `reason`: *«a programmatic identifier indicating the reason for the condition's last transition»* · `message`: *«a human readable message indicating details about the transition»* · `lastTransitionTime` · `observedGeneration`: *«represents the .metadata.generation that the condition was set based upon»* | La observación se transporta **tipada, fechada y con motivo legible por máquina**. Su `Unknown` es nuestro `indeterminado` |
| **RFC 9111** — HTTP Caching | `Age`: *«the sender's estimate of the time since the response was generated or successfully validated at the origin server»*. Y el campo `Warning` se declara **obsoleto** porque *«its advisory role proved unnecessary in practice»* | La vejez de un dato se expresa como **magnitud**, no como etiqueta. Y el metadato que nadie consume **sobra** |

**Convergencia:** dos modelos independientes —uno de infraestructura, uno de la web— expresan la
frescura de una observación como **número** (segundos transcurridos, generación observada), no como
categoría. Ninguno de los dos ofrece `en_vivo | cacheado` como valor cerrado.

---

## 3. Decisión

### 3.1 No hay séptima clase. `partial` pertenece al fulfillment

Una capacidad **nombra un estado destino** (D-13 §1.1). Si de cinco parámetros se aplicaron tres,
**el destino no se alcanzó**: eso no es una clase nueva, es que no se llegó.

Lo parcial vive donde hay partes con identidad propia — el proceso de fulfillment (D-16), que ya
adoptó `partial` de TMF641 en la v2.0 de E-0.3 **sin que se sacara esta consecuencia**.

### 3.2 El veredicto de un conjunto es el peor de sus partes

Cuando un llamador abre una operación en N partes, el veredicto agregado se **deriva**, no se
inventa:

```
indeterminado  >  reintentable  >  rechazado_definitivo  >  aplicado / ya_en_destino
```

**El orden lo pone lo que no se puede perder, no la gravedad aparente:**

| Posición | Por qué ahí |
|---|---|
| `indeterminado` domina | Reintentar a ciegas es la acción peligrosa. Si una sola parte pudo aplicarse, el conjunto exige verificación antes de actuar |
| `reintentable` antes que `rechazado_definitivo` | Queda trabajo que **puede** salir bien. Descartarlo es irreversible; reintentarlo, no |
| El detalle por parte **es evidencia** | Nunca una clase. Va donde dice §3.4 |

**Consecuencia obligatoria (E03-07):** una capacidad que puede aplicarse parcialmente **debe
enumerar qué aplicó**. Sin esa lista, el proceso no es reanudable ni compensable.

### 3.3 Contrato de una capacidad de consulta

D-15 ya separa consultas de mutaciones —*«Solo las consultas son síncronas»*— y ya declara su
garantía: **«Ninguna: se repregunta»**. Le faltaba la forma del resultado.

| Campo | Qué transporta |
|---|---|
| `valor` | El dato, **tipado por capacidad** |
| `observado_en` | **Cuándo** se observó. Magnitud, no etiqueta (RFC 9111 `Age`, K8s `observedGeneration`) |
| `fuente` | De dónde salió: plano técnico, almacén propio, cálculo del Core |

Y **dos** desenlaces de fallo, no seis:

| Clase | Significa | Qué hace quien la recibe |
|---|---|---|
| `no_disponible` | La fuente no responde o está degradada | **Repreguntar cuando haga falta.** No es `reintentable`: nadie debe reintentar una lectura por su cuenta |
| `no_existe` | El sujeto consultado no existe | Definitivo |

**Una consulta NUNCA devuelve `indeterminado`.** Esa clase existe porque una mutación **pudo haberse
aplicado**; una lectura que falla no aplicó nada. Admitirla ahí vaciaría de significado la única
clase que obliga a un humano a ir a mirar.

> **Por qué `observado_en` y no una etiqueta:** la única pregunta que un llamador necesita responder
> es *¿es bastante fresco para lo que voy a hacer?* Pintar la señal de una ONU en una pantalla
> tolera un minuto; decidir un corte, no. Una categoría no responde eso; un instante, sí.

### 3.4 `aplicado` puede llevar la evidencia de su verificación

**E03-05 ya obliga** a que `aplicado` se sostenga en una **lectura independiente**. Esa lectura
produce algo —un estado observado— que hoy se descarta y luego se echa de menos.

`aplicado` puede transportar `evidencia`: **lo que la lectura de verificación observó**, con su
instante.

**Restricción dura, y es la razón de que esto no sea lo que ya se rechazó:**

| Sí | No |
|---|---|
| Tipada **por capacidad** | `Record<string, unknown>` ni equivalente |
| **Derivada de la verificación** que E03-05 ya exige | Un canal de propósito general para «datos que el llamador necesita» |
| Observaciones del plano técnico | **Identificadores ni recursos de proveedor** (E02-10 · E04-10) |

Un payload que no es el resultado de verificar **no es evidencia**: es un dato de conveniencia, y
para esos la respuesta sigue siendo no.

### 3.5 Lo que NO cambia

- **Las seis clases de D-14 se mantienen intactas**, y siguen siendo el contrato de toda mutación.
- **E03-02 no se relaja:** toda capacidad **mutante** responde con una de las seis.
- **E03-03 sigue igual de ancha:** ninguna operación de frontera —consulta incluida— habla
  vocabulario de transporte.
- **`ResultadoAprovisionarOnu` no queda legitimado.** Sigue siendo transitorio y muere en la Ola 3
  por E02-10: el identificador que SmartOLT asigna no es evidencia de verificación, es un recurso de
  proveedor que el Core no debe guardar.

---

## 4. Consecuencias

**Positivas.**

- **El registro de excepciones baja de 4 a 0 y se retira.** Las cuatro se reclasifican: una es
  consulta, dos son evidencia de verificación, una es evidencia del estado observado.
- **La lectura deja de ser una afirmación sin fecha.** Es la lección que este ERP ya pagó: la BD
  dice `activo` y la OLT dice `rogue`. Un valor sin instante de observación es un `success: true`
  sin comprobar, en versión de lectura.
- **El éxito parcial deja de ser inexpresable sin inventar nada:** ya estaba resuelto en D-16, y la
  regla de agregación lo hace utilizable.
- **La Ola 3 queda desbloqueada.**

**Negativas.**

- **Dos contratos de resultado en vez de uno.** Es el coste de que leer y mutar no sean lo mismo;
  fingir que lo eran es lo que produjo los cuatro casos.
- **`evidencia` es la puerta que hay que vigilar.** Nace con restricción escrita: si aparece una
  `evidencia` que no procede de una verificación, es un abuso, no un caso nuevo.

---

## 5. Qué NO autoriza esta decisión

- **No autoriza un campo de datos genérico** en el resultado canónico. Sigue prohibido, y esta
  decisión no es una versión suave de aquello: `evidencia` está atada a E03-05.
- **No autoriza una séptima clase.** Este ADR es la demostración que D-14 §6 pedía, y concluye que
  no hace falta.
- **No autoriza que una consulta devuelva `indeterminado`**, ni que una mutación devuelva
  `no_disponible`. Los dos contratos son disjuntos.
- **No autoriza sacar conceptos de proveedor por la vía de la evidencia** (E02-10 · E04-10).
- **No autoriza decidir sobre la marcha el siguiente hueco.** Si aparece un tercer contrato sin
  definir, se para y se abre ADR, como este.

---

## 6. Inferencia frente a cita — declarado

**Con cita:** que `partial` es del agregado (TM Forum) · que una observación viaja con su instante y
su procedencia (K8s, RFC 9111) · que la frescura se expresa como magnitud (RFC 9111 `Age`, K8s
`observedGeneration`) · que existe un `Unknown` canónico equivalente a `indeterminado` (K8s).

**Inferencia propia, sin fuente externa:** **que una consulta nunca devuelve `indeterminado`.** Se
deduce de D-15 —*«Garantía: ninguna: se repregunta»*— y de la definición de `indeterminado` en D-14.
Ninguna de las fuentes consultadas lo enuncia.

**Inferencia propia:** el **orden de dominancia** de §3.2. Ningún modelo consultado ordena veredictos
agregados; se deriva de PF-5 y de los dos incidentes de 2026-07 (un no-op leído como fallo; un lock
leído como veredicto).

---

## 7. Hallazgo colateral — registrado, NO decidido aquí

Kubernetes separa `reason` (*«programmatic identifier»*) de `message` (*«human readable»*). Nuestro
`ResultadoOperacion` lleva **una sola cadena** (`mensaje` / `motivo`) que leen a la vez el operador y
el reintentador automático.

**Es el mismo defecto que la Ola 1 corrigió, sobreviviendo un nivel más abajo:** subimos la clase a
vocabulario de dominio y dejamos el *porqué* en prosa libre, de modo que un consumidor que quiera
decidir por causa vuelve a hacer arqueología —ahora sobre texto, antes sobre códigos HTTP.

**No se decide aquí.** Se registra para resolverse cuando la Ola 3 toque estos tipos, y no antes: hoy
ningún consumidor decide por causa, así que separarlo ahora sería construir una precisión que nadie
consume — justo lo que RFC 9111 declaró innecesario al obsoletar `Warning`.

---

## 8. Fuentes

- Kubernetes — *API Conventions*,
  `contributors/devel/sig-architecture/api-conventions.md` (kubernetes/community).
- TM Forum — `schemas/Service/ServiceOrderStateType.schema.json` y
  `schemas/Service/ServiceOrderItem.schema.json` (tmforum-apis/Open_Api_And_Data_Model).
- IETF — **RFC 9111**, *HTTP Caching*, §4.2 (freshness), §5.1 (`Age`).
