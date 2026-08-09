# Notas de diseño — Catálogo de servicios y qué significa «contrato»

**Naturaleza:** **notas de una discusión**, no normativa. No hay nada decidido formalmente aquí.
Existe para que lo hablado no se evapore antes de estar cerrado.
**Fecha:** 2026-08-09 · **Interlocutor:** el propietario · **Destino previsto:** ADR-035, cuando cierre

---

## 1. El problema de vocabulario que lo abrió

El propietario lo planteó así:

> *«Existe una mala interpretación de servicio con contrato. **Servicio** es internet, cable,
> telefonía, streaming. **Contrato** es el paquete: internet + cable, internet + cable + teléfono.»*

Tiene respaldo en el sector. **TMF637** define exactamente esa separación:

> *«A product offering procured by a customer… **A product is realized as one or more service(s)
> and/or resource(s)**.»*
>
> `isBundle`: *«If true, the product is a **ProductBundle**… If false, the product is a
> **ProductComponent**.»*

Y distingue **dos** relaciones que aquí importan:

> `ProductRelationship`: *«**[bundled]** if the product is a bundle and you want to describe the
> bundled products inside this bundle; **[reliesOn]** if the product needs another already owned
> product to rely on.»*

- **Internet + cable** → `bundled`. Dos principales que se venden sueltos o juntos.
- **Streaming** → `reliesOn` si exige un principal debajo; producto suelto si no. Ver §4.

**Consecuencia para ADR-035:** su §4.2 recortó los niveles de producto por «no hay composición de
producto». Con internet + cable **sí la hay**, así que ese recorte hay que retirarlo. Fue criterio
propio aplicado en el documento que implementa la política que lo prohíbe (PD-13).

---

## 2. Los servicios que Datafast va a trabajar

Definido por el propietario: **internet y cable** como principales —sueltos o juntos— y
**streaming** como adicional.

Y aparece un segundo eje que no habíamos separado. **No fundirlos**: el primero manda en la
facturación, el segundo en el plano de red.

| | Eje comercial | Eje de aprovisionamiento | Recursos en el ERP |
|---|---|---|---|
| **Internet** | principal | OLT/ONU + MikroTik | ONU, IP, PPPoE, cola, NAP |
| **Cable IPTV** | principal · **producto propio** | **XUI One** (API externa) | un usuario en XUI |
| **Cable coaxial** | principal · **producto propio** | **ninguno** | ninguno |
| **Streaming** | adicional | cuenta de un tercero | una cuenta |

**Cable es hermano de internet en el eje comercial y primo del streaming en el técnico.** Esa es
la observación que ordena todo lo demás.

### IPTV y coaxial son DOS productos, no uno con dos entregas — *(cerrado 2026-08-09)*

> *«Mejor que sean dos servicios separados, así pueden tener un precio distinto.»*

El precio zanja la pregunta comercial, y hay un segundo motivo estructural: **con un solo producto
«Cable», la capacidad de corte dejaría de ser propiedad del producto** —habría que mirar el atributo
de cada instancia—, y eso contradice §5. Con dos productos, «tiene corte automático» es una columna
del catálogo y el barrido de morosos la lee sin excepciones.

Y es lo más simple de construir: **cero columnas nuevas en el contrato**, el cambio de coaxial a
IPTV reusa el prorrateo por cambio de plan, y el catálogo hay que tocarlo igualmente. Las filas de
catálogo son baratas; las columnas en la instancia y los casos especiales, no.

### El cable, en palabras del propietario

> *«El cable va por la fibra, pero **a nivel de ONU y OLT no se está configurando nada**, y por el
> momento así se mantendrá. Existen dos formas de dar cable: por **IPTV**, que conlleva crear un
> usuario en el apartado **XUI One**; o por **coaxial**, que no exige configurar nada
> físicamente.»*

De ahí sale lo más útil: **el cable coaxial es una línea de facturación pura.** No toca la OLT, no
toca MikroTik, no hay nada que reconciliar ni que verificar con VIO. Se cobra y ya.

**Enganche con lo ya decidido:** XUI One ya figura en la lista de módulos que **deben nacer
degradados**. Un operador que venda solo coaxial nunca lo configurará, y el ERP tiene que arrancar
sin él.

---

## 3. Streaming: el tipo es el servicio, no la marca

> *«Netflix es solo ejemplo. En realidad el servicio sería **streaming**; dentro de este puede ser
> Netflix, HBO u otra cuenta.»*

Correcto, y por una razón de fondo: **el tipo describe qué se entrega, no quién lo provee.** Añadir
HBO no crea un servicio nuevo. Es el mismo error de vocabulario que `contratos.tipo_servicio`, que
se llama «tipo de servicio» y guarda `ftth`/`wisp` — **tecnologías de acceso**.

Sobre si basta una descripción libre para decir cuál es: **no**, y el propietario lo aceptó. Una
fila por proveedor en el catálogo no es explosión, es su uso normal, y compra dos cosas:

- **El precio.** Con un único producto «Streaming», el operador teclea el importe en cada alta.
- **El reporte.** «Cuánto vendo de cada uno» es imposible sobre texto libre, o frágil con `LIKE`.

**Queda así:** tipo = `streaming` · producto del catálogo = por proveedor, con precio ·
descripción = la variante («4 pantallas», «plan familiar»).

### La cuenta del proveedor: una etiqueta, no un secreto — *(cerrado 2026-08-09)*

> *«Las cuentas streaming no están cableadas, así que consignar la cuenta de Netflix o HBO solo nos
> sirve para recordarla y saber a qué cuenta pertenece el cliente.»*

Con eso basta **el identificador** —el correo de la cuenta— **en texto plano y sin cifrar**. Un
correo de una cuenta propia no es un secreto: es una etiqueta que dice cuál le tocó a quién. Cero
trabajo: un campo en el servicio.

Lo que se pierde: reenviarle la clave desde el ERP si el abonado la pierde. Hay que entrar al panel
del proveedor, que para un puñado de cuentas es razonable.

> ⚠️ **La frontera, para que nadie la cruce sin darse cuenta.** Si algún día se guarda también la
> **clave**, deja de ser una etiqueta y pasa a ser un secreto: entonces va cifrada con
> `common/utils/encryption.util.ts` —la misma que usan las credenciales de los routers— y se revela
> con una acción auditada, no como un campo que se ve al abrir la ficha.
>
> **Por eso el campo debe llamarse `cuenta_proveedor` y no `credenciales`:** el nombre es lo que
> impide que alguien meta ahí una contraseña «de paso». Y en ningún caso va en la `descripcion`,
> que es texto libre y acaba en logs, exportaciones y fichas impresas — imposible de anonimizar en
> un volcado, que es lo que PS-10 exige.

---

## 4. ¿Se puede contratar solo streaming?

**Sí**, y lo contraintuitivo es que **permitirlo cuesta menos que prohibirlo**. Prohibirlo exige un
guard que impida agregarlo sin principal, y una regla de cascada para la baja del último principal.
Permitirlo no exige nada: es un contrato con un producto y sin recursos de red, y eso el modelo ya
lo aguanta.

**Pero la implicación real no es esa, y ya la hay con el cable coaxial**, que se vende solo.

---

## 5. El corte no es universal: es una propiedad del producto

Un abonado con solo servicios sin plano de red es **un abonado al que el ERP no puede cortarle
nada**. Hoy «cortar» es meter la IP en el address-list de MikroTik y tirar la sesión PPPoE.

| Servicio | Acción de corte posible |
|---|---|
| Internet | **Automática (MikroTik)** — la única construida hoy |
| Cable IPTV | Deshabilitar el usuario en XUI One — automatizable, **sin construir** |
| Cable coaxial | **Ninguna.** Alguien tiene que ir al poste |
| Streaming | **Manual.** *«No están cableadas»* — revocar en el panel del proveedor |

> **Consecuencia que conviene ver:** hoy **solo internet corta solo**. Para los tres productos
> nuevos, la orden de trabajo **no es el caso raro, es el mayoritario** — así que ese camino tiene
> que funcionar de verdad, no quedarse en un esbozo.

Sin esto, el barrido de morosos marcaría «suspendido» en la base y **no pasaría nada en el mundo
real**: el abonado seguiría recibiendo el servicio con el ERP afirmando lo contrario. Es
exactamente la discordancia plano lógico ↔ plano físico que VIO existe para impedir.

### Lo decidido: tarea, y luego baja

> *«El corte no puede ser automático, debe ser una tarea, y una vez realizada la tarea se debe dar
> de baja al cliente o al servicio.»* → **baja y alta**, confirmado.

**Es VIO con un humano como ejecutor:** el ERP no afirma el corte hasta que hay evidencia de que se
materializó. La tarea es la evidencia, y el estado sigue a la confirmación en vez de precederla.

**Y baja —no suspensión— se sostiene:** con una IP, suspender y reactivar es gratis; con el
coaxial, **cada cambio de estado cuesta una visita**. Un estado intermedio que en realidad cuesta un
camión es una promesa que el ERP no puede cumplir. La reconexión es un **alta nueva**, con su cargo
de instalación si lo lleva.

**Consecuencia útil:** el cargo de *reconexión* deja de aplicar a estos servicios. Uno menos de los
cinco campos muertos que definir.

**«Al cliente o al servicio» ya está resuelto en el código, y a favor del servicio.** El estado del
cliente se sincroniza solo si no le queda ningún contrato dando servicio: *«Con dos servicios y uno
cortado, el cliente sigue activo, que es la verdad»*.

### El mecanismo ya existe — `ordenes_trabajo`

Antes de proponer nada nuevo (PD-04, reutilizar antes de construir):

```
contrato_id · tecnico_id · tipo · estado · fecha_programada
fecha_inicio_real · fecha_fin_real
descripcion_trabajo · conformidad_cliente · firma_cliente_url
latitud_ejecucion · longitud_ejecucion
```

Los tres últimos son lo que la convierte en **evidencia**: hora real de cierre, conformidad del
abonado y **dónde estuvo el técnico**.

Falta poco: un **tipo de orden** para corte y baja manual, y que al cerrarse cambie el estado del
servicio. `tickets.categoria` tiene `sin_internet`, `lentitud`, `instalacion`, `traslado`,
`facturacion`… pero **ni corte ni reconexión**.

> **Alcance no verificado:** `tickets` y `ordenes_trabajo` están **vacías en producción** y no se ha
> comprobado si tienen pantalla. Puede ser esquema sin UI, y eso cambia el esfuerzo.

---

## 5-bis. Retiro de equipos y baja por suspensión prolongada

Lo que se hace de verdad, en palabras del propietario:

> *«Cuando un cliente suspende voluntariamente o por mora, luego de 3 meses sin reactivar o recibir
> el pago, se recoge el material y se da de baja definitiva a ese cliente, quedando el inventario
> libre. Podríamos poner tareas que cuando un cliente lleve suspendido por más de 3 meses se
> programe la tarea de retirar equipos y darle de baja definitiva.»*

**El número de meses lo elige el operador** — no se fija en el código. Hay precedente:
`empresas.cron_horarios` ya guarda horarios de barridos por empresa.

### Lo que ya está construido, y es sólido

La baja definitiva **ya libera todo el lado lógico**, con saga y pasos registrados: libera la IP,
desaprovisiona la OLT, encola la ONU nativa por outbox con reintentos, limpia MikroTik —con
reencolado si falla— y quita la entrada de la access-list de la antena. Y pone a null `onuId`,
`routerId`, `segmentoId` e `ipAsignada`.

### El hueco: el equipo físico no tiene dónde volver

**`olt_onu_inventario` no es un almacén: es una foto de la OLT.** Sus columnas son
`estado_operativo`, `run_state`, `rx_power_dbm`, `snapshot_at` — lo que el equipo reporta, no lo que
hay en un estante. **No existe inventario de almacén en el ERP**, y está en la lista de módulos
pendientes («Inventario / Almacén, descuento automático de stock»).

Hoy, cuando el técnico recoge la ONU, esta simplemente desaparece de la foto porque deja de estar
conectada. La tarea se puede crear y cerrar; lo que no ocurre todavía es «queda el inventario libre»
**dentro del ERP**.

### Tres reglas para cuando se construya

**1 · El equipo vuelve al stock cuando el técnico lo confirma, no cuando corre la baja.** Si la baja
lo marcara como recuperado, habría stock en el papel que está en el salón de un abonado. Es VIO: el
estado sigue a la evidencia, y la orden ya tiene `fecha_fin_real`, `conformidad_cliente` y
coordenadas para sostenerlo.

**2 · La recuperación falla a menudo, y hay que modelarlo.** El abonado no está, se niega, o el
equipo se perdió. La orden debe poder cerrarse como **«no recuperado»**: la ONU se marca perdida —no
vuelve a stock— y **la baja se ejecuta igual**. Si no, un abonado que no abre la puerta conserva el
contrato vivo para siempre.

**3 · La baja cierra el servicio, no la deuda.** Quien se va por mora sigue debiendo, y si vuelve es
un alta nueva con deuda vieja. Conviene decirlo, porque «baja definitiva» suena a caso cerrado.

### Quién decide qué — *(cerrado 2026-08-09)*

> *«La baja definitiva no se hace en automático, siempre la hace un operador del ERP con
> autorización. El recojo de equipos no es una acción que necesite tanta supervisión.»*

| Acción | Quién | Autorización |
|---|---|---|
| **Baja definitiva** | Operador del ERP | **Permiso fino.** Es irreversible |
| **Cerrar orden de retiro** | Rol Técnico | Ninguna. Poner una firma encima solo lograría que las órdenes se queden abiertas |
| **Cerrar como «no recuperado»** | Rol Técnico | Ninguna, pero **con motivo y contador** |

**La asimetría no está entre la baja y el retiro: está entre los dos desenlaces del retiro.**
Cerrar como recuperado es rutina. Cerrar como **no recuperado es merma de inventario** — una ONU
perdida es dinero. Merece dejar rastro del motivo y aparecer en un contador, porque un patrón
—«este mes ocho no recuperados»— solo se ve si se cuenta.

Y es **visibilidad después, no autorización antes**: no cuesta tiempo al técnico ni bloquea el
cierre.

### El umbral sugiere; la baja genera la tarea — *(cerrado 2026-08-09)*

Los dos hechos son **independientes y ninguno bloquea al otro**:

| | Qué libera | Cuándo |
|---|---|---|
| **Baja definitiva** | Los recursos **lógicos**: IP, ONU ID, puerto de servicio, PPPoE, línea XUI | Cuando el operador la decide |
| **Cierre de la tarea** | El equipo **físico**: entra en stock, o se marca perdido | Cuando el técnico lo confirma |

**El umbral configurable solo SUGIERE**: «estos contratos superan los X días suspendidos». No
ejecuta nada. Y **la tarea de retiro la genera la baja**, ocurra cuando ocurra — si el operador da
de baja a los dos días de la suspensión, la tarea se genera igual.

Eso permite además el caso inverso, que existe: **el abonado que devuelve la ONU en la oficina.**
El retiro ocurre antes que la baja y no hay que forzar ningún orden.

**El precio de que la baja sea manual:** puede no ocurrir nunca. El contrato se queda suspendido,
sin facturar, con la ONU fuera y la IP reservada. **La lista de sugerencias es lo único que impide
que eso se vuelva permanente**, así que tiene que envejecer a la vista y estar cuantificada:

> *4 contratos suspendidos más de 90 días — 4 ONUs sin recuperar, 4 IPs y 4 puertos reservados.*

Una lista se ignora; un inventario inmovilizado, menos. Y no puede ser una notificación: el gateway
hoy no envía nada.

**Enganche con B-3:** «con autorización» significa que ese endpoint necesita permiso fino, y hoy
hay **102 endpoints mutantes sin ninguna autorización**. Dar de baja definitiva no puede quedar en
«cualquier usuario autenticado» — ese permiso entra en el mismo trabajo.

### Dos huecos que esto destapa

| Hueco | Estado |
|---|---|
| **Programador de tareas** | `ordenes_trabajo.fecha_programada` **ya existe**; falta la maquinaria: quién asigna, qué pasa al llegar la fecha, cómo se ve la agenda del técnico |
| **Notificaciones al vencer una tarea** | Se apoyan en el gateway de mensajería, que hoy tiene **480 de 480 mensajes en `NO_ENVIADO`**. Es el bloqueo bajo el bloqueo: sin gateway, la notificación de tarea muere igual que las demás |

---

## 6. Lo que hoy bloquea vender cable o streaming — medido

No es el modelo. Son tres cosas concretas, verificadas contra producción el 2026-08-09:

1. **`planes` es un catálogo de planes de internet.** Obligatorios: `velocidad_bajada`,
   `velocidad_subida`, `tipo_queue`, `tipo_servicio`, `crear_reglas_en_router`. Un plan de cable o
   de streaming tendría que inventarse una velocidad y una cola de MikroTik. Los siete planes
   existentes son de internet.
2. **`contratos.tipo_servicio` es obligatorio** y sus valores son `ftth` y `wisp` — tecnologías, no
   tipos de servicio.
3. **El alta asume que todo contrato se aprovisiona en red.**

Y lo que **no** bloquea, y conviene saberlo: `contratos` ya admite filas sin recursos —IP, PPPoE,
ONU y MAC son nulables y sus índices únicos ignoran los nulos—. Un contrato de cable coaxial cabe
hoy en esa tabla tal cual.

**Decisión abierta:** generalizar `planes` haciendo nulable lo de conexión, o dejarlo como catálogo
de conexión y poner un catálogo de productos por encima. La primera es rápida y deja media tabla
inaplicable según la fila; la segunda es más limpia y cuesta más.

---

## 7. El modelo, tal como quedó — **plan → contrato**

Lo definió el propietario, y **es literalmente la relación más establecida del modelo del sector**:

> *«El contrato debe manejar planes. Dentro de los planes vamos a tener plan cable IPTV, cable
> coaxial, internet, cuenta streaming — **o pueden ser mezclados y combinados**. Cuando creamos un
> cliente asignamos un plan, y **ese plan se convierte en contrato**.»*

Eso es **ProductOffering → Product**: catálogo → instancia. Y el `isBundle` existe **en los dos
niveles**:

> **`ProductOffering.isBundle`** *(catálogo)*: *«determines whether a productOffering represents a
> single productOffering (false), or **a bundle of productOfferings** (true).»*
>
> **`Product.isBundle`** *(instancia)*: *«If true, the product is a **ProductBundle**, which is **an
> instantiation of a BundledProductOffering**.»*

```
Cliente
  └── Contrato  1..N              ← el plan instanciado. LLEVA la cuenta de facturación
        ├── ciclo · comprobante · deuda · corte
        └── Servicio  1..N        ← los planes componentes instanciados
              └── recursos (ONU, IP, PPPoE / línea XUI / ninguno)
```

**Por qué esto cierra la discusión de nombres:** no hay que inventar «paquete» ni «componente». El
nivel de arriba es el plan combinado instanciado —el contrato— y el de abajo son sus planes
componentes instanciados —los servicios—. Una sola idea con dos niveles.

### La cuenta de facturación va sobre el CONTRATO

Decisión del propietario, tras descartar tanto «una por cliente» como «una por servicio»:

- **Los servicios de un mismo contrato comparten factura** → el descuento de paquete tiene dónde
  vivir, y el abonado recibe un comprobante por contrato.
- **Contratos distintos son independientes** → ciclos, deudas y cortes separados, y uno puede ir a
  boleta y otro a factura. Resuelve el caso «casa e negocio, mismo titular».

Ni la consolidación total ni la fragmentación por servicio. Es el punto medio, y el estándar lo
soporta: el ciclo (`BillingCycleSpecification`) cuelga del `billStructure` de la cuenta, no del
cliente.

### Qué se mueve al contrato y qué se queda en el cliente — *(confirmado 2026-08-09)*

> *«La facturación, cobranza, notificaciones y tipo de comprobante están por cliente, no por
> contrato. Esta configuración debe moverse a cada contrato.»* — y confirmado que el reparto de
> abajo es «exactamente lo que se quiere».

| Se mueve al **contrato** | Se queda en el **cliente** |
|---|---|
| Día de pago, días antes de emitir, días de gracia, comprobantes para el corte | — |
| Tipo de comprobante, esquema de impuestos, mora y reconexión | — |
| **Cuándo** avisar: aviso de factura nueva, los tres recordatorios, sus offsets y plantillas | **Por dónde** avisar: WhatsApp, teléfono, correo |

**El reparto natural: el contrato dice cuándo y de qué se avisa; el cliente dice por dónde.** Un
abonado con dos contratos no tiene dos teléfonos.

**El cliente deja de tener configuración**, no la conserva «por defecto» — eso serían dos fuentes
otra vez. Los valores por defecto salen de `plantillas_abonados`, que existe justo para eso.

**Y el alta del segundo contrato necesita un atajo.** Con la configuración en el contrato, dar de
alta un segundo servicio obliga a elegir día de pago, gracia y comprobante otra vez. Además de la
plantilla, el alta debería ofrecer **«copiar la configuración de otro contrato de este abonado»**,
que es lo que el operador querrá casi siempre.

### El coste medido de moverlo

Hoy la configuración de facturación vive en `clientes.facturacion_config`. Moverla al contrato:

| | |
|---|---|
| Ficheros que la leen | **4** — y 11 de las 21 referencias están dentro de `politica-facturacion.service.ts`, que es la fuente única |
| Puntos de llamada a la política | **8** |
| Tablas de dinero que suben al contrato | **5** — `facturas`, `pagos`, `cargos_pendientes`, `promesas_pago`, `portal_solicitud_plan` |
| Tablas de red que **no** se tocan | **~17** — todo el plano FTTH, MikroTik, pools e inventario |

**Es barato precisamente por el trabajo de A-4.** Con la configuración dispersa en quince consultas
—como estaba el 2026-08-06— esta decisión habría sido inviable.

---

## 7-bis. El precio

### Por plan, y el combinado no es la suma

> *«El precio debe ser por plan. Si hay planes de solo internet y planes de solo cable, un plan que
> combine los dos **no necesariamente debe ser la suma** de estos.»*

Correcto, y el estándar lo contempla explícitamente: `ProductOfferingPrice.isBundle` — *«A flag
indicating if this ProductOfferingPrice is composite (bundle) or not»*.

**Consecuencia para la factura:** con precio propio del plan combinado, el comprobante lleva **una
línea por contrato** («Dúo Hogar S/ 90»), no una por servicio. Si algún día hace falta el desglose
—para reportar cuánto se vende de cada servicio— habrá que derivarlo de los componentes del plan,
no de las líneas del comprobante.

### Subir el precio: operación explícita, no propagación silenciosa

El propietario pidió que al subir el precio del plan suba también a los abonados que lo tienen,
desde su siguiente facturación. **La intención es normal en telecom**, pero el mecanismo automático
no es el de los modelos validados. Stripe:

> *«you must change the subscription item to reflect the new selection… prompting you to **replace
> the underlying price** of that subscription item»* · *«Changing a subscription often results in a
> **proration**.»*

Reemplazo explícito, suscripción por suscripción. Editar el catálogo no toca a nadie. Tres razones:

1. **Sin registro de quién estaba en qué precio.** Un `UPDATE` cambiaría lo que pagan N abonados sin
   rastro del importe anterior ni de la fecha.
2. **Sin dónde enganchar la notificación.** Subir el precio de un servicio contratado exige avisar
   con antelación; con propagación implícita no se sabe ni a quién. *(Sin citar normativa: no se ha
   consultado la de OSIPTEL. El hueco debe existir en el diseño.)*
3. **Va contra una decisión ya tomada.** Con `plantillas_abonados` se eligió **copiar y no
   referenciar**, para que editar una plantilla no alterara a los abonados existentes.

**Lo acordado** — una operación del operador con alcance visible: «aplicar el nuevo precio a los N
contratos con este plan», que **dice cuántos son antes de ejecutarse**, deja registro por contrato
(de → a, fecha, quién), respeta los precios negociados y surte efecto **desde la siguiente
facturación**. El resultado comercial es el que pedía; la diferencia es que el cambio es un acto con
nombre y no un efecto colateral.

**Cómo encaja con lo que ya existe:**

- `planes.precio` — precio vigente del catálogo.
- `contratos.precio_mensual` — el precio del contrato. **`precio_final` NO sirve para esto: es una
  columna GENERADA** — `precio_mensual × (1 − descuento_pct/100)`, como `facturas.saldo`—, así que
  no puede ser `NULL` para significar nada. *(Se propuso usarla así el 2026-08-09 y era imposible;
  corregido el mismo día al medirlo.)*
- **`sigue_precio_del_plan`** (booleano) — lo que decide si la operación de cambio de precio alcanza
  a este contrato. Explícito, y deja ver de un vistazo cuáles son negociados sin comparar importes.
- La factura toma `COALESCE(contrato.precio_final, plan.precio)` al emitir y **congela el importe en
  el ítem**. Los comprobantes ya emitidos no cambian nunca.

**Dos cosas que hay que resolver al implementarlo:**

- **Hay dos columnas de precio** — `precio_mensual` (obligatoria) y `precio_final` (nulable), ambas
  a 64,00 en los dos contratos vivos con `descuento_pct = 0`. Parecen «precio del plan» y «precio
  tras descuento». Hay que decidir qué significa cada una o acabamos con dos verdades, como en A-4.
- **La migración del `NULL`:** hoy los contratos existentes tienen valor en `precio_final`, así que
  todos quedarían marcados como negociados y ninguno seguiría al plan. Hay que poner a `NULL` los
  que coincidan con el precio de su plan.

---

## 7-ter. El prorrateo

### La regla del ciclo completo: nunca se prorratea

**Un ciclo completo se cobra a tarifa plana, dure 28 o 31 días.** El abonado de febrero paga lo
mismo que el de marzo. El `/30` **solo aparece cuando hay que partir un ciclo**, y ese es el sentido
del «mes comercial de 30 días»: hace que el día de servicio valga igual todo el año.

Sin esta regla, un ciclo de 31 días calculado como `31 × (precio/30)` daría el **103 %** de la
mensualidad.

### La fórmula

```
importe = mínimo( precio_mensual ,  precio_mensual / 30 × días )
```

**El tope no es decorativo:** con la convención de contar el primer día, un tramo de 31 días
existe y daría más que la mensualidad completa.

### La convención: `[inicio, fin)` — el primer día CUENTA

Decidido el 2026-08-09, siguiendo el estándar. El propietario lo planteó y aceptó la recomendación:
*«sigamos estándares ya validados»*.

**Lo primero que hay que decir es que el modelo validado no cuenta días:**

> **Stripe:** *«By default, Stripe calculates prorations **down to the second**. To change the time
> granularity —for example, to prorate by day, hour, week, or month— use proration customizations.»*

Instalado el 22 a las 15:00, se cobra desde las 15:00. La pregunta «¿cuenta el 22?» no existe ahí.
**Contar por días es una simplificación propia**, y conviene saberlo.

Sobre el conteo por días, la fuente es explícita en que **no hay regla universal** —«no hay
terminología estándar», varía según el mercado—. La convención más usada, Actual/Actual ISDA:

> *«In this convention **the first day of the period is included and the last day is excluded**.»*

Y coincide con lo que el propio propietario había recomendado antes: *«el ERP debe definir
formalmente si los períodos utilizan `[start, end)` o `[start, end]`. Yo recomiendo intervalos
semiabiertos»*.

**Ejemplo trabajado.** Anclaje 30, alta el 22 de agosto. El ciclo es `[31/07 → 30/08]`, que en
notación semiabierta es `[31/07, 31/08)` — el mismo intervalo. El abonado tuvo servicio del **22 al
30 = 9 días**, y se le cobra `precio / 30 × 9`.

**Por qué no empezar el 23**, que era la intuición inicial: el abonado **tuvo servicio ese día** —
con activación matutina, catorce horas—, y con instalación el mismo día, que es lo normal en FTTH,
no cobrarlo sería un regalo **sistemático**, no ocasional. Sería una cortesía comercial legítima,
pero no una convención, y habría que declararla como tal.

**Una sola regla para todo.** Si el alta cuenta el primer día, la baja cuenta el último de la misma
forma. Si no, el abonado paga dos veces el día del cambio — o ninguna de las dos.

### Los eventos

| Evento | Qué se prorratea | Estado |
|---|---|---|
| **Alta a mitad de ciclo** | Los días desde la activación hasta el cierre. Se **añade a la siguiente facturación** | Confirmado |
| **Baja anticipada** | Se cobra hasta el día efectivo, no el ciclo completo | Confirmado |
| **Cambio de plan a mitad de ciclo** | Los días de cada plan por separado | **Confirmado 2026-08-09.** Es el ejemplo canónico de Stripe: *«−5 USD for unused time on the initial price, and 10 USD for the remaining time on the new price»* |
| Suspensión voluntaria | — | **Sin decidir.** Ojo: si el corte es por mora, prorratear premia al que no paga |

### Desde qué fecha cuenta el alta

Lo justo es **desde que hay servicio, no desde que hay firma**. Tres candidatas, medidas:

| Candidata | Estado |
|---|---|
| `contratos.fecha_inicio` | Existe y es obligatoria, pero es **papel**: la fecha del acuerdo, no la del servicio |
| `ordenes_trabajo.fecha_fin_real` | Sería la ideal —instalación efectiva con firma y coordenadas— pero la tabla está **vacía**: si el alta no genera orden, ese campo es siempre nulo |
| **`contratos_historial`, transición a `activo`** | **La correcta hoy.** Hay **14 activaciones registradas** con su `created_at`. Es cuándo el servicio empezó a funcionar de verdad |

**Recomendación: la fecha de activación del historial.** Y cuando las órdenes de trabajo estén en
uso, seguirá siendo la misma cosa — la orden se cierra y eso activa el servicio. No hay que elegir
entre las dos: la segunda alimentará a la primera.

### El mecanismo ya existe

`cargos_pendientes` guarda el cargo con `contrato_id`, `tipo` y `monto`, y `consumirCargosPendientes`
lo incluye como línea en la siguiente factura marcándolo con `incluido_en_factura_id`. Es
literalmente «se le adiciona el costo a la siguiente facturación».

**No hay que construir el mecanismo, solo el cálculo y el disparador.**

---

## 7-quater. Los estados del contrato y del servicio

Lo detectó el propietario: la conversación usaba los tres términos como sinónimos. Al mirarlo,
**resulta que en el código ya tienen significado — pero no el que estábamos usando.**

### Lo que significan hoy

`cortado` **sí se escribe**, en dos sitios y del mismo flujo: `promesas-pago.service` cuando vence
una **promesa de pago** incumplida, y `outbox-red.service` cuando ese corte se ejecuta de forma
asíncrona. El comentario del enum lo dice: *«sin servicio, deuda vencida (post-prórroga)»*.

| | Significado actual |
|---|---|
| `suspendido` | Cortado por mora ordinaria |
| `cortado` | Cortado **tras romper una prórroga** |

**No es «lógico vs físico»: es por qué se llegó ahí.** Y operativamente son idénticos — sin
servicio, hay que pagar para volver.

### Lo que la conversación venía usando

El criterio implícito en todo el diseño es otro, y es **cuánto cuesta revertirlo**:

| | Cómo se revierte |
|---|---|
| **Suspensión** | Un clic. Todo sigue instalado y reservado — internet |
| **Corte** | Una visita — el coaxial en el poste |
| **Baja** | Visita + alta nueva; se liberan los recursos |

Ese criterio es el que ordenó todo: por eso el coaxial no se suspende, por eso hay tarea, por eso a
los tres meses es baja.

### El problema y la propuesta

Dos estados que **se comportan igual** obligan a escribir `IN ('suspendido','cortado')` en todas
partes, y olvidarse de uno es un fallo silencioso — es literalmente lo que pasó con `moroso`.

Y aplica el mismo principio que cerró aquel caso: **el porqué no es un estado.** Que el abonado
rompiera una prórroga cabe en `motivo_estado`, que ya existe, o en el historial.

### Decidido el 2026-08-09 — **tres estados para todo, y la evidencia vive en la tarea**

> *«Para todos los contratos habrá solo 3 estados: activo, suspendido y baja definitiva. El cable
> puede estar suspendido, no utilizaremos estado corte. Suspendido en cable coaxial y streaming
> genera la tarea de visita. Baja definitiva es cuando se liberan equipos, se liberan IPs y ONUs, se
> desaprovisiona, y se elimina del XUI.»*

```
activo  →  suspendido  →  baja_definitiva
```

**Una sola máquina, sin variantes por tipo de servicio.** `cortado` se retira.

#### Por qué esto es mejor que la propuesta anterior

Se había decidido, tres mensajes antes, distinguir `suspendido` de `cortado` por el **coste de
revertir** —un clic frente a una visita—, para que el ERP no afirmara que el coaxial estaba cortado
sin haberlo verificado.

**El error de aquella propuesta: un estado no puede llevar evidencia.** «Cortado» es una palabra —
no dice quién fue, ni cuándo, ni si el cliente conformó.

**La tarea sí.** `ordenes_trabajo` guarda `fecha_fin_real`, `conformidad_cliente`, firma y
coordenadas de ejecución. Ahí es donde VIO tiene sentido; en un enum, no.

| | Qué afirma |
|---|---|
| Estado `suspendido` | La decisión administrativa: este servicio está suspendido |
| **Tarea abierta** | Todavía **no** se ha materializado |
| **Tarea cerrada** | Materializado, con quién, cuándo y dónde |

El ERP no miente: dice «suspendido» y al lado «corte físico pendiente desde hace 12 días».
**Juntos son verdad, y con más detalle del que un estado daría nunca.**

#### Y resuelve el dúo sin excepciones

El contrato pasa a `suspendido` y **cada servicio hace lo que puede** — internet y IPTV en un clic,
coaxial y streaming generando la tarea. No hay que elegir un estado ni inventar «parcialmente
suspendido».

Y aparece una simetría limpia: **entrar o salir de `suspendido` en un servicio sin control remoto
genera una tarea**, y si el estado vuelve antes de que el técnico vaya, **la tarea se cancela** —
sin visita, sin coste, sin nada que deshacer.

Con esto se cierra también lo que quedaba colgando: **un contrato de solo coaxial sí pasa por
`suspendido`**, con su tarea, y llega a `baja_definitiva` como todos. Sin casos especiales.

#### El porqué del cambio de estado va TIPADO, no en prosa — *(cerrado 2026-08-09)*

El sitio ya existe y está bien alimentado:  registra historial en cada cambio vía
, y  y  hacen lo propio.



 ya separa «lo hizo un cron» de «lo hizo una persona», pero **no basta**: un operador
puede suspender a mano por mora, y saldría como no automático igual que una pausa voluntaria.

**Se añade un campo tipado a :**



> **«El porqué no es un estado» no significa «el porqué es texto libre».**

Se quitó  como estado y se va a quitar . Pero el motivo sigue necesitando dónde
vivir, y si va en prosa **no se puede contar**:  es arqueología, no consulta. Es
el mismo problema que el proveedor de streaming en un campo de descripción (§3).

| Campo | Qué guarda |
|---|---|
|  | **Tipado.** Para contar y aplicar reglas |
|  | Texto libre, el detalle humano — *«viaje a Lima, vuelve en octubre»* |
|  ·  | Quién lo hizo. Ya existen |

**No se duplica en .** El origen de la suspensión vigente es el de la última transición
a  — se deriva. Guardarlo también en el contrato sería una proyección que puede
divergir: A-4 otra vez.

**Cierra dos cosas de golpe:** el límite de suspensiones voluntarias pasa a ser contable
( en los últimos doce meses), y el «prórroga incumplida» que hacía falta al
retirar  ya tiene sitio.

> ⚠️ **Al implementarlo:** si es un enum de PostgreSQL, **añadir un valor después es una
> migración** — y ya costó una vez, con el literal  huérfano tumbando la consulta entera
> de facturación por *«invalid input value for enum»*. La lista se define pensando en lo que hará
> falta, no en lo mínimo de hoy.

#### Las tres condiciones para que se sostenga

**1 · La tarea es obligatoria, no opcional.** Si un coaxial puede pasar a `suspendido` sin generar
tarea, el estado **sí** es mentira. La tarea es lo que lo convierte en verdad, así que no puede
depender de que alguien se acuerde — como el latido, se deriva del hecho, no se recuerda.

**2 · Retirar `cortado`, igual que se hizo con `moroso`.**

| Dónde | Qué |
|---|---|
| `promesas-pago.service` | Escribe `cortado` al vencer una prórroga → pasa a `suspendido` con `motivo_estado` |
| `outbox-red.service` | Igual, en la rama asíncrona del mismo flujo |
| ~7 lectores | Dejan de necesitar `IN ('suspendido','cortado')` |
| Producción | **Un contrato** está en `cortado` y hay que reubicarlo |

Y mata el patrón que ya costó un fallo silencioso: dos estados equivalentes que había que acordarse
de listar juntos siempre.

**3 · La baja crece.** Hoy el saga libera IP, desaprovisiona la OLT, encola la ONU por outbox y
limpia MikroTik. Con esta definición hay que añadir **eliminar la línea de XUI** y **el retiro de
equipos** — que es la parte que necesita el almacén que todavía no existe (§5-bis).

---

## 8. Lo que queda abierto

1. **¿Prorratea la suspensión voluntaria?** Lo demás del prorrateo está cerrado (§7-ter).
   **La suspensión por mora nunca prorratea** — eso no está en duda, y hoy el riesgo existe porque
   comparte estado con la voluntaria. Para la voluntaria, la regla de los tres meses (§5-bis) acota
   la objeción del inventario, pero no la otra: quien suspenda el día 5 de cada ciclo y reactive
   pagaría cinco días al mes. Si prorratea, con un límite de veces al año.
2. **Programador de tareas** y **notificaciones al vencer una tarea** (§5-bis). La segunda depende
   del gateway de mensajería, que hoy no envía nada.
3. **Inventario de almacén** — no existe; sin él, «queda el inventario libre» no ocurre dentro del
   ERP (§5-bis).

### Cerrados el 2026-08-09

| | Decisión |
|---|---|
| ~~Cable IPTV vs coaxial~~ | **Dos productos.** Por precio distinto, y porque con uno solo la capacidad de corte dejaría de ser propiedad del producto (§2) |
| ~~El nombre de las tablas~~ | **El nivel de contrato se llama `contratos`.** La tabla actual se renombra a `servicios`. Coste desglosado abajo |
| ~~Cambio de plan~~ | **Sí prorratea** (§7-ter) |
| ~~Desde qué fecha cuenta el alta~~ | **La activación en `contratos_historial`**, no la firma ni la orden de trabajo (§7-ter) |
| ~~Las credenciales de streaming~~ | **Solo el identificador, en claro.** No están cableadas: la cuenta sirve para recordar cuál le tocó a quién (§3) |
| ~~Suspensión, corte y baja~~ | **Tres estados para todo** —`activo`, `suspendido`, `baja_definitiva`—; `cortado` se retira. La evidencia del corte físico vive en **la tarea**, no en un estado (§7-quater) |
| ~~Las dos columnas de precio~~ | **No eran dos verdades:** `precio_final` es GENERADA. Lo que hacía falta era otra cosa — un booleano `sigue_precio_del_plan` (§7-bis) |

**El renombrado, desglosado — es menos de lo que se dijo primero.** Se había estimado como
«migración grande»; al desglosarlo:

| Parte | Qué implica |
|---|---|
| `ALTER TABLE contratos RENAME TO servicios` | Una sentencia |
| Las **17 columnas `contrato_id`** del plano de red → `servicio_id` | **Mecánico, sin mover datos.** Los valores ya apuntan a la fila correcta; solo cambia el nombre |
| Las **5 tablas de dinero** → apuntar al contrato nuevo | **Migración real.** Es la parte con riesgo |
| El barrido de código y la UI | Grande pero mecánico |

## 8-bis. APARCADO — cable IPTV por XUI One

> **No desarrollar todavía.** El propietario lo dejó explícitamente para más adelante: *«es una
> idea que tengo pero la tomaremos en su momento, no quiero que enteveremos los temas»*. Se recoge
> para que no se pierda, no para diseñarlo.

La idea, en sus palabras:

- Cuando el plan contenga IPTV, el plan debe permitir elegir **cuántas sesiones** tiene la cuenta.
- Y también el **bouquet** — así llama XUI a los paquetes de contenido que se pueden añadir.
- **Sesiones y bouquets se extraen de XUI**, no se inventan en el ERP.
- La cuenta IPTV se crea con **usuario = el código del contrato**, para que quede trazable a qué
  contrato pertenece cada cuenta.
- En la ficha del cliente, donde hoy dice «Servicios» dirá **«Contratos»**, y dentro figurarán los
  contratos de ese abonado.

**El terreno no está vacío**, y conviene saberlo antes de empezar:

| Ya existe | Qué es |
|---|---|
| `planes.cuenta_iptv` (booleano) y `planes.sesiones_iptv` | Alguien ya anticipó las sesiones en el plan — aunque como atributo de un plan de internet, que es el modelo «IPTV como característica de la conexión» que este documento descarta |
| Tabla `xui_lines` con `contrato_id` | La integración tiene tabla. Vacía en producción |
| XUI One en la lista de **módulos que nacen degradados** | La regla ya está escrita: probe al arrancar, y el backend arranca aunque XUI no responda |

**Una advertencia que conviene dejar antes de construirlo:** *usuario* = código del contrato es
buena idea y da la trazabilidad que se busca. ***Contraseña* = código del contrato, no.** El número
de contrato aparece en el comprobante, en la ficha y en cualquier exportación — no es un secreto.
Si la clave de la cuenta IPTV es ese mismo código, cualquiera que vea una factura puede entrar. La
clave hay que generarla.

---

## 9. Fuentes

- [TMF637 Product Inventory Management v4.0.0](https://github.com/tmforum-apis/TMF637_ProductInventory) — definiciones de `Product`, `isBundle`, `ProductRelationship`
- [TMF620 Product Catalog Management v4.0.0](https://github.com/tmforum-apis/TMF620_ProductCatalog) — `ProductOffering`, `BundledProductOffering`
- [TMF666 Account Management](https://github.com/tmforum-apis/TMF666_AccountManagement) — `BillingAccount`, `AccountRelationship`
- Mediciones contra la base de producción, 2026-08-09
