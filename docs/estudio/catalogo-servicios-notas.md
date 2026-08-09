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

## 7. El paquete: qué se gana y qué cuesta

**Un cliente ya puede tener N contratos, y la factura ya los consolida en líneas**
(`facturas.items` lleva `contratoId` por ítem). «Internet + streaming» funcionaría hoy como **dos
contratos, un comprobante**, sin ningún paquete.

El paquete se gana su sitio solo si hace falta:

- **precio de paquete** — «internet + cable por S/ 90» en vez de 65 + 30; el descuento no tiene
  dónde vivir con dos contratos sueltos; o
- **ciclo de vida de paquete** — dar de baja «el paquete» como unidad.

### Y el nombre no obliga a la migración

Cuál tabla se llama «contrato» es decisión de nombres, no de estructura, y ahí está casi todo el
coste:

| | Qué implica |
|---|---|
| **`contratos` pasa a ser el paquete** | Bajar IP, PPPoE, ONU, MAC, NAP y dirección a una tabla hija. Toca el mapa de red, el corte, el outbox, el registro FTTH y los cuatro índices de recursos. **Migración grande** |
| **`contratos` se queda como el componente y se añade un padre** | No se mueve ni una columna. El padre nace nulable. **Migración mínima** |

Las dos dan `ProductBundle → ProductComponent`. La segunda deja «contrato» significando el
componente en la base y el paquete en la UI — que es justo lo que **PD-13 §4** resuelve con un mapa
de correspondencias declarado, en vez de con una migración de datos.

---

## 8. Lo que queda abierto

1. **¿Cable IPTV y coaxial son dos productos del catálogo, o uno con dos formas de entrega?** Para
   el abonado y la factura es lo mismo — «Cable, S/ 30». Para el ERP no: uno crea un usuario en un
   sistema externo y el otro no hace nada.
2. **¿Hace falta el paquete** (precio o baja como unidad), o basta con la consolidación en factura?
3. **¿Cómo se abre el catálogo?** Generalizar `planes` o poner un catálogo por encima.
4. **Dónde viven las credenciales** de las cuentas revendidas.

---

## 9. Fuentes

- [TMF637 Product Inventory Management v4.0.0](https://github.com/tmforum-apis/TMF637_ProductInventory) — definiciones de `Product`, `isBundle`, `ProductRelationship`
- [TMF620 Product Catalog Management v4.0.0](https://github.com/tmforum-apis/TMF620_ProductCatalog) — `ProductOffering`, `BundledProductOffering`
- [TMF666 Account Management](https://github.com/tmforum-apis/TMF666_AccountManagement) — `BillingAccount`, `AccountRelationship`
- Mediciones contra la base de producción, 2026-08-09
