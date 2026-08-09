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
| **Cable IPTV** | principal | **XUI One** (API externa) | un usuario en XUI |
| **Cable coaxial** | principal | **ninguno** | ninguno |
| **Streaming** | adicional | cuenta de un tercero | una cuenta |

**Cable es hermano de internet en el eje comercial y primo del streaming en el técnico.** Esa es
la observación que ordena todo lo demás.

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

> ⚠️ **La cuenta entregada al abonado —correo y clave— no puede vivir en la descripción.** Acaba en
> logs, exportaciones y fichas impresas. Si se van a guardar credenciales de cuentas revendidas,
> necesitan su sitio y su cifrado, como ya se hace con las de los routers.

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
| Internet | Automática (MikroTik) |
| Cable IPTV | Deshabilitar el usuario en XUI One — automatizable cuando exista el módulo |
| Cable coaxial | **Ninguna.** Alguien tiene que ir al poste |
| Streaming | Revocar la cuenta — manual |

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
- `contratos.precio_final` — **`NULL` = «sigue al plan»**; con valor = negociado, no se toca.
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

## 8. Lo que queda abierto

1. **¿Cómo se abre el catálogo?** Generalizar `planes` o poner un catálogo por encima. El
   propietario lo aplazó: requiere consultas externas. Ahora está mejor acotado — un plan
   **combinado no tiene campos técnicos**, así que las 21 columnas de conexión en null dejan de ser
   una anomalía y pasan a ser lo correcto para esa fila.
2. **¿Cable IPTV y coaxial son dos productos, o uno con dos formas de entrega?** Para el abonado y
   la factura es lo mismo; para el ERP no: uno crea un usuario en XUI One y el otro no hace nada.
3. **El nombre de las tablas.** Hoy `contratos` es lo que el modelo llama **servicio**. O se
   renombra —26 columnas, 14 FKs, 48 referencias y toda la UI— o el padre nuevo lleva otro nombre y
   se declara la correspondencia (PD-13 §4). Lo segundo cuesta cinco tablas repuntadas.
4. **Inclusividad de los días en el prorrateo.** Con alta el 22 y cierre el 30, ¿el primer día
   facturable es el 22 o el 23, y el último el 30 o el 29? Lo planteó el propio propietario al
   señalar que «del 20 al 30 son 11 días si contamos ambos extremos», y decide cuánto se cobra.
5. **Dónde viven las credenciales** de las cuentas de streaming revendidas.
6. **Las dos columnas de precio** de `contratos` (§7-bis).

## 9. Fuentes

- [TMF637 Product Inventory Management v4.0.0](https://github.com/tmforum-apis/TMF637_ProductInventory) — definiciones de `Product`, `isBundle`, `ProductRelationship`
- [TMF620 Product Catalog Management v4.0.0](https://github.com/tmforum-apis/TMF620_ProductCatalog) — `ProductOffering`, `BundledProductOffering`
- [TMF666 Account Management](https://github.com/tmforum-apis/TMF666_AccountManagement) — `BillingAccount`, `AccountRelationship`
- Mediciones contra la base de producción, 2026-08-09
