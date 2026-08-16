# Estudio — El modelo del Core contra las especificaciones publicadas de TM Forum

**Naturaleza:** documento de **estudio**, no normativo. Es el insumo del ADR de benchmark que
**PD-11** exige antes de diseñar. **No decide nada.**
**Fecha:** 2026-08-14
**Objeto:** validar o refutar las fichas D-1…D-39 de E-0.2, E-0.3 y E-0.4 contra fuentes citables.
**Motivo:** la verificación transversal registró como hallazgo **F-2** que los tres documentos se
escribieron sin ADR de benchmark y con referencias de memoria. Bajo **PD-13 condición 1**, *«sin
fuente no es "el sector": es una conjetura»*.

**Precedente:** [facturacion-cobranza-benchmark.md](facturacion-cobranza-benchmark.md) hizo lo mismo
para facturación y cobranza (Odoo 18 · Stripe · ERPNext) y desembocó en ADR-035. **Ese estudio no
cubre el Core**: no menciona `BillingAccount` ni la separación Producto/Servicio.

---

## 1. Fuentes consultadas

Todas descargadas y leídas el **2026-08-14**. Licencia Apache 2.0 (repositorios `tmforum-apis`).

| # | Fuente | Versión | Qué se extrajo |
|---|---|---|---|
| **S-1** | [TMF666 Account Management](https://raw.githubusercontent.com/tmforum-apis/TMF666_AccountManagement/main/TMF666-Account_Management-v5.0.0.oas.yaml) | v5.0.0 OAS | Definición de `BillingAccount` y sus relaciones |
| **S-2** | [TMF637 Product Inventory](https://raw.githubusercontent.com/tmforum-apis/TMF637_ProductInventory/main/TMF637-ProductInventory-v4.0.0.swagger.json) | v4.0.0 | `Product`, `billingAccount`, `realizingService`, `ProductStatusType` |
| **S-3** | [TMF638 Service Inventory](https://raw.githubusercontent.com/tmforum-apis/TMF638_ServiceInventory/main/TMF638-ServiceInventory-v4.0.0.swagger.json) | v4.0.0 | `Service`, `category`, `supportingService`, `supportingResource`, `ServiceStateType` |
| **S-4** | [TMF641 Service Ordering](https://raw.githubusercontent.com/tmforum-apis/TMF641_ServiceOrder/main/TMF641-Service_Ordering-v4.0.0.swagger.json) | v4.0.0 | `OrderItemActionType`. **Lectura parcial** — completada con S-5 |
| **S-5** | [TMF641 Service Ordering](https://raw.githubusercontent.com/tmforum-apis/TMF641_ServiceOrder/main/TMF641-ServiceOrdering-3.0.0.swagger.json) | v3.0.0 | `ServiceOrderStateType` completo · `orderItemRelationship` · `relationshipType` |
| **S-6** | [TMF639 Resource Inventory](https://raw.githubusercontent.com/tmforum-apis/TMF639_ResourceInventory/main/TMF639-ResourceInventory-v4.0.0.swagger.json) | v4.0.0 | `Resource` y sus cuatro dimensiones de estado |
| **S-7** | [Broadband Forum USP — especificación](https://usp.technology/specification/) | TR-369 | Definiciones de `Controller` y `Agent`; relación con TR-069 |
| **S-8** | [ITU-T G.988](https://www.itu.int/rec/T-REC-G.988) | 2022 Am.2 (05/25) | **Solo metadatos** — título y estado. Cuerpo no accesible |
| **S-9** | [ITU-T G.984.1](https://www.itu.int/rec/T-REC-G.984.1-200803-I/en) | 03/2008, en vigor | **Solo metadatos** — título y estado. Cuerpo no accesible |
| **S-10** | [TMF640 Activation & Configuration](https://raw.githubusercontent.com/tmforum-apis/TMF640_ActivationConfiguration/main/TMF640-ServiceActivationConfiguration-3.0.0.swagger.json) | v3.0.0 | Operaciones, recurso `Monitor`, `ServiceStateType`, `startMode` |
| **S-11** | [OWASP ASVS](https://raw.githubusercontent.com/OWASP/ASVS/master/5.0/en/0x21-V12-Secure-Communication.md) | 5.0 · V12 | Requisitos 12.3.1, 12.3.3, 12.3.4, 12.3.5 |
| **S-12** | [TMF620 Product Catalog](https://raw.githubusercontent.com/tmforum-apis/TMF620_ProductCatalog/main/TMF620-Product_Catalog_Management-v5.0.0.oas.yaml) | v5.0.0 OAS | `BundledProductOffering` · `BundledProductOfferingOption` y sus límites |
| **S-13** | [TMF666 Account Management](https://raw.githubusercontent.com/tmforum-apis/TMF666_AccountManagement/main/TMF666-Account_Management-v5.0.0.oas.yaml) | v5.0.0 OAS | `Account.accountBalance` · `AccountBalance` (`balanceType`, `validFor`) |
| **S-14** | [ERPNext — Sales Invoice](https://docs.frappe.io/erpnext/user/manual/en/sales-invoice) | vigente | Tratamiento del saldo pendiente y del pago parcial |

**Guard 1 de PD-11 respetado:** se estudia el **modelo** —entidades, campos, enumeraciones—, no se
adopta código. Los repositorios son Apache 2.0 y solo se han leído.

---

## 2. Citas textuales

### S-2 · TMF637 — `Product`

> **Product:** *«A product offering procured by a customer or other interested party playing a party
> role. A product is realized as one or more service(s) and / or resource(s).»*
>
> **billingAccount:** *«BillingAccount reference. A BillingAccount is a detailed description of a
> bill structure.»* — **referencia a un objeto único, no un array.**
>
> **realizingService:** array — *«Service reference, for when Service is used by other entities»*
>
> **productRelationship:** array — *«Linked products to the one instantiate, such as [bundled] if
> the product is a bundle …; [reliesOn] if the product needs another already owned product to rely
> on …»*
>
> **status:** *«Is the lifecycle status of the product.»*
>
> **ProductStatusType:** `created` · `pendingActive` · `cancelled` · `active` · `pendingTerminate` ·
> `terminated` · `suspended` · `aborted`

### S-1 · TMF666 — `BillingAccount`

> **BillingAccount:** *«A party account used for billing purposes. It includes a description of the
> bill»*
>
> **relatedParty:** *«List of parties that have some relationship with the account, for example the
> customer to whom the account belongs»*
>
> **accountRelationship:** *«List of balances related to the account. For example a list of billing
> accounts that contribute to a financial account»*

**Ausencias comprobadas en el esquema:** no existe campo que enlace `BillingAccount` con un producto,
suscripción o acuerdo; y **no hay restricción que ate una cuenta a exactamente un party**, ni que
impida a un party tener varias.

### S-3 · TMF638 — `Service`

> **Service:** *«Service is a base class for defining the Service hierarchy. All Services are
> characterized as either being possibly visible and usable by a Customer or not.»*
>
> **category:** *«Is it a customer facing or resource facing service»*
>
> **supportingService:** array — *«A collection of services that support this service (bundling,
> link CFS to RFS)»*
>
> **supportingResource:** array — *«Note: only Service of type RFS can be associated with
> Resources»*
>
> **serviceCharacteristic:** array — *«characterize this service»*
>
> **isServiceEnabled:** *«If FALSE and hasStarted is FALSE, this particular Service has NOT been
> enabled for use - if FALSE and hasStarted is TRUE then the service has failed»*
>
> **ServiceStateType:** `feasibilityChecked` · `designed` · `reserved` · `inactive` · `active` ·
> `terminated`

### S-4 / S-5 · TMF641 — `ServiceOrder`

> **OrderItemActionType:** `add` · `modify` · `delete` · `noChange` *(S-4)*
>
> **ServiceOrderStateType:** `acknowledged` · `rejected` · `pending` · `held` · `inProgress` ·
> `cancelled` · `completed` · `failed` · **`partial`** *(S-5)*
>
> **orderItemRelationship:** *«A list of order items related to this order item»* *(S-5)*
>
> **relationshipType:** *«The type of related order item, can be: dependency if the order item needs
> to be not started until another order item is complete»* *(S-5)*

### S-6 · TMF639 — `Resource`

> **Resource:** *«Resource is an abstract entity that describes the common set of attributes shared
> by all concrete resources (e.g. TPE, EQUIPMENT) in the inventory.»*
>
> Propiedades de estado **separadas**: `resourceStatus` · `administrativeState` ·
> `operationalState` · `usageState`
>
> **resourceRelationship** y **resourceCharacteristic**: arrays · **place**:
> `RelatedPlaceRefOrValue`

---

## 3. Hallazgos

### H-1 · La disputa de la Cuenta de Facturación no es de conformidad — el estándar admite las dos

**Qué dice la fuente.** En S-2, `Product.billingAccount` es **una referencia a un objeto único**: cada
producto apunta a **una** cuenta. En S-1, `BillingAccount` **no tiene ningún campo** que apunte al
producto, y **nada limita** cuántas cuentas puede tener un party.

**Consecuencia.** El estándar fija *«un producto, una cuenta»* y **guarda silencio** sobre cuántos
productos comparten cuenta. Por tanto:

| Postura | ¿Conforme a TMF? |
|---|---|
| **E-0.2 D-1** — una cuenta por contrato | **Sí.** Cada producto apunta a la suya |
| **ADR-035 §4.1** — una cuenta por cliente | **Sí.** Varios productos apuntan a la misma |

**Esto reclasifica el hallazgo F-1.** No es un choque de conformidad: **ninguna de las dos se desvía
del estándar.** Es una decisión de negocio, y la que está congelada en **A §13/§14** es la del
contrato. Lo que el ADR debe registrar no es *cuál cumple la norma* —cumplen ambas— sino **cuál
quiere el negocio y qué pierde la otra**.

**Matiz que sobrevive.** Lo que ADR-035 sí aporta y D-1 no contradice: la cuenta es **entidad propia**
—el ciclo y el tipo de comprobante viven en ella, no sueltos en el cliente ni en el contrato—, que es
exactamente lo que E-0.2 D-1 §4 llamó «precisa A §13». Ambos documentos coinciden en la entidad y
discrepan solo en la cardinalidad.

---

### H-2 · D-3 queda confirmada con fuente, y el riesgo F-9 se desactiva

**Qué dice la fuente.** S-2: *«A product is realized as one or more service(s)»*. S-3: `Service` es
clase base con `category` = *«customer facing or resource facing»*.

**Consecuencia.** La separación **Producto ↔ Servicio** es estructura del estándar, no invención
nuestra, y el *«one or more»* valida la cardinalidad 1:N de **E-0.2 D-7**. La ficha **D-3** pasa de
conjetura a **conforme citable**.

**Y desactiva F-9.** El recorte de R-036 —*«`Subscription → Service → Service Instance` son tres
nombres para una cosa»*— no aplica aquí: aquello colapsaba tres nombres de **una misma** entidad; lo
nuestro separa **dos entidades que el estándar separa**. Es la diferencia entre inventar un nivel y
adoptar el que existe.

---

### H-3 · D-4 confirmada, con un nivel que hay que declarar

**Qué dice la fuente.** S-3: `supportingService` y `supportingResource` son **arrays**, y
*«only Service of type RFS can be associated with Resources»*.

**Consecuencia.** El 1:N de **E-0.4 D-4** es la forma del estándar. **Pero el estándar interpone un
nivel que nuestro modelo nombra distinto:**

```
TMF:      Product ──► Service (CFS) ──► Service (RFS) ──► Resource
Datafast: Contrato ─► Servicio Contratado ─► Technical Binding ─► recursos del dominio
```

**El Technical Binding ocupa el lugar del RFS.** No es un nivel de más: es el mismo, con otro nombre
y con dueño declarado (el módulo). **PD-13 condición 4 exige escribir esa correspondencia**, o el
próximo lector creerá que nos saltamos una capa.

---

### H-4 · Hueco real en A §16, encontrado por consultar la fuente

**Qué dice la fuente.** `ProductStatusType` distingue **ocho** estados, entre ellos `cancelled` y
`terminated` como estados **distintos**, más `pendingTerminate` y `aborted`.

**Qué tiene A §16 congelado:** cuatro — `PENDIENTE DE ACTIVACIÓN`, `ACTIVO`, `SUSPENDIDO`,
`BAJA DEFINITIVA`.

**El hueco.** **C §37 describe la cancelación de un contrato que nunca llegó a activarse** —el cliente
desiste antes de la instalación— y **A §16 no tiene estado donde ponerlo**. Hoy ese caso tendría que
registrarse como «baja definitiva», que el estándar reserva para lo que **estuvo activo**. Se pierde
una distinción que importa: un contrato cancelado nunca prestó servicio, nunca debió facturar, y no
computa como baja en ninguna métrica de rotación.

**Impacto.** Toca **A §16, congelado**. Exige revisión arquitectónica —o declarar la desviación con
su motivo. **No se resuelve en este estudio.**

---

### H-5 · La asimetría de D-5 tiene respaldo en la fuente

**Qué dice la fuente.** `suspended` aparece en `ProductStatusType` (S-2) y **no** en
`ServiceStateType` (S-3), cuyos valores son `feasibilityChecked · designed · reserved · inactive ·
active · terminated`.

**Consecuencia.** En el estándar, **la suspensión es del producto —plano comercial—, no del
servicio**. Eso es exactamente la asimetría que **E-0.2 D-5** declaró como «aportación propia»: la
activación se deriva desde abajo, la suspensión se ordena desde arriba. **Deja de ser aportación
propia en su mitad comercial y pasa a ser conforme**; lo propio es solo el mecanismo de derivación.

**Además, `feasibilityChecked`, `designed` y `reserved`** describen fases previas a la activación que
nuestro `pendiente_activacion` colapsa en una. No es defecto —es simplificación deliberada— pero
**es una adaptación y, por PD-13, debe escribirse como tal**.

---

### H-6 · `isServiceEnabled` nombra lo que nosotros llamamos VIO

**Qué dice la fuente.** S-3, `isServiceEnabled`: *«If FALSE and hasStarted is FALSE, this particular
Service has NOT been enabled for use — if FALSE and hasStarted is TRUE then the service has
failed»*.

**Consecuencia.** El estándar distingue **«no se ha habilitado»** de **«se intentó y falló»** con dos
banderas. Es la misma distinción que **PF-2** (*aceptar no es aplicar*) y **E-0.3 D-18**. Coincidencia
independiente: refuerza la regla y da vocabulario para mapearla.

---

### H-7 · D-16 confirmada literalmente — incluido el estado `partial` y la dependencia entre tareas

**Qué dice la fuente (S-5).** `ServiceOrderStateType` incluye **`partial`** como valor propio, y
`relationshipType` define la dependencia con esta redacción: *«dependency if the order item needs to
be not started until another order item is complete»*.

**Consecuencia.** **E-0.3 D-16 deja de ser la ficha sin fuente y pasa a confirmada con cita
textual**, en sus dos afirmaciones estructurales:

| Lo que D-16 declara | Lo que dice la fuente |
|---|---|
| El fulfillment admite estado **PARCIAL** | `partial` es valor del enum |
| Las tareas declaran **dependencias** | `dependency`: no empezar hasta que otra esté completa |

Y **C §20** —Internet ✓ / IPTV ✓ / Streaming ✗ ⇒ fulfillment PARCIAL— queda respaldado por el
estándar, no solo por criterio propio.

---

### H-7b · Segundo hueco del mismo tipo: falta `rechazado` en C §5

**Qué dice la fuente (S-5).** El enum tiene **nueve** estados; C §5 (congelado) define **siete**. El
mapeo es limpio salvo en dos:

| TMF641 | C §5 |
|---|---|
| `pending` · `inProgress` · `partial` · `held` · `failed` · `completed` · `cancelled` | `PENDIENTE` · `EN PROCESO` · `PARCIAL` · `BLOQUEADO` · `ERROR` · `COMPLETADO` · `CANCELADO` |
| **`acknowledged`** | — |
| **`rejected`** | — |

**`rejected`** es la orden que **no llega a ejecutarse porque se rechaza de entrada** —recursos no
disponibles, dirección fuera de cobertura, datos inválidos—. Hoy solo cabría registrarla como
`ERROR`, que significa otra cosa: que se intentó y falló.

**Es el mismo patrón que H-4**: al corpus le faltan los estados de *«no llegó a empezar»*, tanto en
el plano contractual (`cancelled`) como en el de ejecución (`rejected`). Que aparezca dos veces
sugiere criterio, no descuido: se modelaron los caminos que avanzan y no los que no arrancan.

`acknowledged` no se echa en falta: es el acuse de recepción de una orden entre sistemas distintos,
y aquí el proceso lo crea el propio Core.

---

### H-8 · El recurso tiene cuatro dimensiones de estado, no una

**Qué dice la fuente (S-6).** `Resource` declara como propiedades **separadas** `resourceStatus`,
`administrativeState`, `operationalState` y `usageState`.

**Consecuencia.** **D-0.2 §17** (congelado) declara tres dimensiones —comercial, operación, salud— y
es correcto en su plano. Pero **dentro del plano del recurso**, el estándar separa tres más, y esa
separación es exactamente la que hoy falta para no confundir tres cosas distintas:

| Dimensión | Pregunta que responde | Ejemplo Datafast |
|---|---|---|
| **Administrativa** | ¿está permitido que preste servicio? | ONU suspendida por mora |
| **Operativa** | ¿está funcionando? | ONU apagada, fibra cortada |
| **De uso** | ¿está ocupado? | Puerto NAP asignado, IP reservada |

Sin esta separación, «ONU suspendida» y «ONU apagada» acaban en el mismo campo, y un barrido de
reconciliación no puede distinguir un corte deliberado de una avería. **Refina E-0.4 D-38
(inventario) y E-0.3 D-19 (reconciliación).**

**Además confirma dos fichas:** *«in the inventory»* respalda **D-38** (el recurso existe con
independencia del servicio), y `place` como propiedad del recurso respalda **D-31** (la
georreferencia vive en Planta, con el recurso físico).

---

### H-9 · D-32 se sostiene, pero **no** por el argumento que le puse

**Qué dice la fuente (S-7).** El estándar define los roles de forma **funcional**:

> *«A Controller is an Endpoint that manipulates Service Elements through one or more Agents.»*
> *«An Agent is an Endpoint that exposes Service Elements to one or more Controllers.»*
> *«Simple migration from the CPE WAN Management Protocol (CWMP) — commonly known by its document
> number, "TR-069" — through use of the same data model and data modeling tools.»*

**Y lo que NO dice, comprobado:** *la especificación **no** afirma que el controlador deba estar
separado de la infraestructura de acceso.* Define los roles sin imponer topología.

**Consecuencia — corrección de un argumento propio.** E-0.4 D-32 justificaba el dominio propio
diciendo que *«el estándar define el servidor de gestión como elemento independiente del nodo de
acceso»*. **Eso es más de lo que la fuente dice.** El argumento correcto es el inverso, y es más
fuerte:

> El estándar es **agnóstico a la topología**: define la gestión del CPE como una función, no como
> un accesorio del nodo de acceso, y contempla explícitamente el mismo modelo de datos viniendo de
> CWMP. **Meter la gestión del CPE dentro del dominio FTTH sería una restricción nuestra**, no del
> estándar — y una que se rompe el día que haya un abonado por radio.

**La decisión no cambia; su fundamento sí.** Queda **Adaptado**: se adopta la separación
Controller/Agent como funciones, y se **añade** una regla propia —dominio separado— que el estándar
permite pero no exige.

---

### H-10 · ITU-T: solo metadatos, y aun así dicen algo

**Qué se pudo obtener (S-8, S-9).** El cuerpo de ambas Recomendaciones **no es accesible**; sus
metadatos, sí:

| | Título verbatim | Estado |
|---|---|---|
| **G.988** | *«ONU management and control interface (OMCI) specification»* | En vigor · 2022 Am.2 (05/25) |
| **G.984.1** | *«Gigabit-capable **passive** optical networks (GPON): General characteristics»* | En vigor · 03/2008 |

**Lo poco que sostienen, sostenido.** El título de G.988 confirma que **la gestión de la ONU es una
interfaz normalizada propia** —refuerza D-29 en que la ONU es elemento de red gestionado— y el de
G.984.1 nombra **passive** la red de distribución, que es la línea exacta de E04-04: *el equipo
activo es Acceso FTTH; el medio pasivo es Planta.*

**Lo que no sostienen.** Ninguna definición, ningún campo, ninguna entidad. **D-29 sigue sin fuente
para su contenido**: lo que hay es el nombre de la norma, no su texto.

---

### H-11 · No existe modelo abierto para la topología de planta pasiva — y se buscó

**Qué se buscó.** Un modelo de información citable para mufa, fusión, splitter, caja NAP, hilo y
acometida **como topología conectada**.

**Qué se encontró.** Nada consultable: documentación de fabricante, material divulgativo sobre SID y
patentes. El detalle de cómo el marco de información del sector modela estos elementos **no está
disponible en abierto**.

**Consecuencia.** **E-0.4 D-31 se queda en `Extendido`**, que es exactamente lo que PD-13 manda hacer
cuando el sector no lo contempla o no se puede consultar: *«se construye y se declara extensión
propia — no se disfraza de estándar»*.

**Y queda escrito que se buscó.** Que una ficha sea `Extendido` por haber mirado es distinto de que
lo sea por no haber mirado, aunque el resultado se escriba igual.

---

### H-12 · El estándar es **declarativo**; nuestro catálogo de capacidades es **imperativo**

**Qué dice la fuente (S-10).** TMF640: *«Service Activation and Configuration API goal is to provide
the ability to activate and configure Services.»* Y sus operaciones son **CRUD sobre el recurso
servicio**:

| Operación | Intención equivalente |
|---|---|
| `POST /service` | Activar |
| `PATCH /service/{id}` | Configurar o cambiar |
| `DELETE /service/{id}` | Desaprovisionar |
| `state` (`ServiceStateType`) · `isServiceEnabled` · `hasStarted` · `startMode` | Cómo se expresa qué debe pasar |

**No hay catálogo de verbos.** El estándar expresa la intención como **estado deseado del recurso**,
no como una lista de operaciones con nombre.

**Consecuencia — y una tensión interna que esto destapa.** E-0.3 tiene dos fichas que se miran de
reojo y nadie lo había notado:

- **D-13** define un catálogo **imperativo**: `PROVISIONAR_ACCESO`, `SUSPENDER_ACCESO`…
- **D-19** define reconciliación **declarativa**: estado deseado frente a estado observado.

Un sistema no puede ser imperativo al pedir y declarativo al comprobar sin una regla que los una.
**La regla que los une ya existe en la casa:** PA-03 (los estados legales se declaran en un solo
lugar) y PA-04 (la idempotencia se deriva del estado destino).

> **Precisión que hay que escribir en D-13:** cada capacidad se define como **la transición a un
> estado destino declarado**, no como un procedimiento. `SUSPENDER_ACCESO` significa *«lleva este
> servicio al estado suspendido»*, no *«ejecuta el procedimiento de suspensión»*.

Con eso, `ya_en_destino` de D-14 deja de ser un caso especial que hay que acordarse de contemplar y
pasa a ser **consecuencia del modelo**, que es exactamente lo que PA-04 exige. **D-13 queda
`Adaptado`**: misma finalidad que el estándar, forma imperativa declarada, y cada verbo obligado a
nombrar su estado destino.

---

### H-13 · `Monitor`: el estándar también hace de la operación asíncrona un recurso consultable

**Qué dice la fuente (S-10).** Junto a `/service`, TMF640 expone `/monitor` —`listMonitor`,
`retrieveMonitor`— y notificaciones propias: `monitorCreateNotification`,
`monitorStateChangeNotification`, `monitorDeleteNotification`.

**Consecuencia.** El estándar **persiste y expone la ejecución asíncrona como entidad de primera
clase**, con su propio ciclo de estado y sus eventos. Es lo mismo que **E-0.3 D-16** declara para el
fulfillment y lo que **D-17** necesita para que alguien publique el hecho y otro decida.

**Segunda fuente para D-18:** `isServiceEnabled` y `hasStarted` reaparecen aquí, con el mismo par de
banderas que distingue «no se habilitó» de «se intentó y falló».

**Y un eco para C §25** (tareas manuales y automáticas): el esquema tiene `startMode`. **Sus valores
no se verificaron** — solo consta la propiedad.

---

### H-14 · ASVS cierra D-24, y matiza una frase mía

**Qué dice la fuente (S-11).** OWASP ASVS 5.0, V12 — Secure Communication:

> **12.3.3:** *«Verify that TLS or another appropriate transport encryption mechanism used for all
> connectivity between internal, HTTP-based services within the application, and does not fall back
> to insecure or unencrypted communications.»*
>
> **12.3.4:** *«Verify that TLS connections between internal services use trusted certificates.
> Where internally generated or self-signed certificates are used, the consuming service must be
> configured to only trust specific internal CAs and specific self-signed certificates.»*
>
> **12.3.5:** *«Verify that services communicating internally within a system (intra-service
> communications) use strong authentication to ensure that each endpoint is verified. Strong
> authentication methods, such as TLS client authentication, must be employed to ensure identity,
> using public-key infrastructure and mechanisms that are resistant to replay attacks.»*

**Consecuencia.** **E-0.3 D-24 pasa a fuente consultada**, y con más exigencia de la que tenía: no
basta con «canal cifrado e identidad verificable» — el estándar pide **autenticación fuerte con
verificación de cada extremo y resistencia a repetición**, y **certificados de confianza acotada**
para el tráfico interno.

**Matiz honesto.** D-24 afirma que *«la pertenencia a la red interna no es autorización»*. **ASVS no
lo dice con esas palabras**: lo que hace es exigir a las comunicaciones internas los mismos
controles que a las externas, de donde se sigue. **Es inferencia propia a partir de la fuente, y
así queda declarado** — la misma corrección que hubo que hacer en H-9.

---

### H-15 · D-2: el sector pone la obligatoriedad en la OFERTA, y la expresa como CARDINALIDAD

**Encargo.** El propietario pidió no ratificar D-2 sin contrastarla. Se consultó **TMF620 v5.0.0**.

**Qué dice la fuente.**

> **BundledProductOffering:** *«Represents a containment of a product offering within another product
> offering, including specification of cardinality (e.g. **is the bundled offering mandatory**, how
> many times can it be instantiated in the parent product, etc.).»*
>
> **BundledProductOfferingOption:** *«A set of numbers that specifies the lower and upper limits for a
> ProductOffering that can be procured as part of the related BundledProductOffering. **Values can
> range from 0 to unbounded**»* — con `numberRelOfferDefault`, `numberRelOfferLowerLimit` y
> `numberRelOfferUpperLimit`.

**Comparativa.**

| Modelo | Dónde vive la decisión | Cómo se expresa |
|---|---|---|
| **TMF620 v5.0.0** | En el **catálogo**, en la composición del bundle | **Cardinalidad**: límite inferior ≥ 1 ⇒ obligatorio; límite inferior 0 ⇒ opcional |
| **TMF638 / TMF641** | No lo modelan | `supportingService` no marca obligatoriedad. TMF641 modela **dependencia** entre ítems, que es otra cosa |
| **E-0.2 D-2 (v2.0)** | En la **instancia** (Servicio Contratado) | Booleano `requerido_para_activacion`, fijo en `true` |

**Dos diferencias, y las dos importan.**

1. **Sitio.** El estándar decide la obligatoriedad **en la oferta**, no en la instancia. Es coherente:
   que el IPTV sea bloqueante o no es una característica del **plan que se vende**, igual para todos
   sus abonados — no algo que se decida abonado por abonado. Ponerlo en la instancia habría
   construido flexibilidad que nadie pidió, contra **C-010** y **PI-5**.
2. **Forma.** El estándar usa **tres números** en vez de un booleano. Y esos tres números **cubren un
   requisito nuestro que hoy no tiene sitio**: *«el Plan puede definir perfiles incluidos = 2»*
   (B §54) es exactamente `numberRelOfferDefault = 2`. Con el booleano propio, «2 perfiles»
   necesitaría un campo inventado aparte.

**Propuesta.** La composición **Plan ↔ Servicio** lleva la terna del estándar —por defecto, mínimo,
máximo—; **`requerido` se DERIVA** de `mínimo ≥ 1` y deja de ser un campo; y al contratar, la
composición **se copia** al Servicio Contratado como toda condición congelada (D-10, A §26). Hoy todo
plan nace con `mínimo = 1` y sin interfaz para cambiarlo: **igual de mínimo que antes, con la forma
del estándar, y B §54 resuelto de paso**.

**Clasificación: `Adoptado`** — antes era `Extendido` con un booleano propio.

---

### H-16 · D-12: el sector SÍ guarda saldo — pero tipado y con periodo de validez

**Encargo.** Igual que D-2. Se consultó **TMF666 v5.0.0** y **ERPNext**.

**Qué dice la fuente (TMF666 v5.0.0).**

> **`Account.accountBalance`:** *«List of balances for the account, for example regular postpaid
> balance, deposit balance, write-off balance.»* — array.
>
> **`AccountBalance`:** *«Balances linked to the account»*, con **`balanceType`** — *«Type of the
> balance : deposit balance, disputed balance, loyalty balance, receivable balance...»* — y
> **`validFor`** (`TimePeriod`).

**Qué dice ERPNext.** El saldo pendiente vive **en la factura** y lo reduce el asiento de pago: *«A
payment or credit has reduced, but not cleared, the outstanding amount»* · *«The payment reduces the
invoice's outstanding amount»*. La página consultada **no documenta** un total por cliente.

**Comparativa.**

| Modelo | Saldo por documento | Agregado |
|---|---|---|
| **TMF666 v5.0.0** | — | **Sí**, pero como **lista de saldos tipados con periodo de validez** |
| **ERPNext** | **Sí**, reducido por el pago | No documentado en la página consultada |
| **E-0.2 D-12 (v2.0)** | No lo menciona | **Nada guardado** |

**Dos hallazgos.**

1. **Un saldo guardado no es necesariamente una segunda verdad — si tiene tipo y validez.** El
   estándar no guarda «la deuda»: guarda **saldos tipados** —por cobrar, depósito, en disputa,
   incobrable— **cada uno con el periodo para el que vale**. Eso es exactamente la forma de una
   **proyección**, no de una autoridad. D-12 §5 ya permitía una proyección declarada; **lo que le
   faltaba era la forma, y el estándar se la da**.
2. **El residual por documento existe en los sistemas reales, y D-12 puede leerse mal.** Redactada
   como *«la deuda no existe como atributo»*, se presta a entender que se prohíbe también el saldo del
   comprobante — y sería un error: **es el mecanismo por el que un pago parcial se refleja**. Lo que
   el incidente A-4 condenó no fue eso, sino el **agregado** `contratos.deuda_total`, escrito a mano
   por cuatro caminos distintos.

**Propuesta.**

| Nivel | Regla |
|---|---|
| **Por comprobante** | El saldo **existe y es derivado** —calculado, nunca escrito a mano—. Es el mecanismo del pago parcial |
| **Agregado** (contrato, cuenta, cliente) | **No existe como dato.** Si el rendimiento lo exigiera, se adopta la forma de `AccountBalance`: **tipado y con periodo de validez**, declarado proyección, y jamás autoridad |
| **Invariante que no cambia** | Una sola definición y un solo escritor. **Ajustar una deuda exige emitir un documento**, auditado |

**Clasificación: `Adaptado`** — se adopta la estructura (saldos tipados con validez) y se restringe la
regla: hoy no se materializa ninguno.

---

## 4. Qué NO se pudo verificar

**Se declara en vez de rellenarse con memoria.**

| Punto | Estado |
|---|---|
| Enumeraciones de estado de `Resource` (`ResourceStatusType`, `AdministrativeState`, `OperationalState`, `UsageState`) | **No verificadas.** Los valores concretos no aparecen en los ficheros leídos. Se confirma que las **dimensiones** existen; **no** qué valores admite cada una |
| TMF622 (Product Ordering) · TMF632 (Party) · TMF629 (Customer) | **No consultados.** Afectan a E-0.2 D-11 (Cliente como rol) |
| Modelos de inventario de planta exterior | **Buscados y no encontrados en abierto** (H-11). D-31 queda `Extendido` con la búsqueda registrada |
| **Cuerpo** de ITU-T G.988 y G.984.1 | **No accesible.** Solo metadatos (H-10). D-29 sigue sin fuente de contenido |
| **Cuerpo** de TR-069 (CWMP) | **No accesible** — el PDF del Broadband Forum devuelve 403. Se sustituyó por TR-369/USP (S-7), que sí es público |
| eTOM, ITIL, ASVS, OpenTelemetry, patrón saga, bucles de reconciliación | **No consultados.** Siguen siendo referencias de memoria en E-0.2/3/4 |

**Consecuencia honesta:** de las 40 fichas, este estudio da fuente citable a **quince** —D-1, D-3,
D-4, D-5, D-7, D-13, D-14 (parcial), D-16, D-17 (parcial), D-18, D-19 (parcial), D-24, D-31
(parcial), D-32 y D-38—, más **D-29 solo por el título de su norma**. **Las 24 restantes siguen
siendo conjetura razonada.**

**Dónde duele ahora la ausencia:** el bloque de **ejecución resiliente** de E-0.3 —encolado (D-15),
anulación y compensación (D-21), concurrencia (D-22), reintentos (D-20), degradación (D-25)—. Son
patrones de ingeniería, no modelos de negocio, y por eso no aparecen en las APIs del sector.
Respaldo real: norma propia (PA-01, PA-07, PA-16, PA-18, PA-19, PF-5). **Que no es un benchmark, y
se dice.**

---

## 5. Qué debe decidir el ADR que siga a este estudio

1. **Cardinalidad de la Cuenta** (H-1): ambas conformes; decide el negocio, y se registra qué pierde
   la descartada. Resuelve F-1. → **decidido en ADR-036 §4.1**
2. **Correspondencia declarada** (H-3, PD-13 condición 4): tabla Datafast ↔ TMF con versión de la
   especificación. → **ADR-036 §4.2**
3. **El hueco de `cancelled`** (H-4): ampliar A §16 por revisión arquitectónica, o declarar la
   desviación. → **ADR-036 §4.3, abierta**
4. **Reclasificar D-5** (H-5): su mitad comercial es conforme, no aportación propia. →
   **ADR-036 §4.4**
5. **Declarar el alcance real de la validación** (§4). → **ADR-036 §4.5, a actualizar a nueve
   fichas**
6. **El hueco de `rejected`** (H-7b): mismo tratamiento que H-4, sobre **C §5**. **Pendiente**
7. **Las cuatro dimensiones de estado del recurso** (H-8): refinar **E-0.4 D-38** y **E-0.3 D-19**
   antes de reemitirlas. **Pendiente**
