# ADR-032 — El Core es dueño de sus capacidades: contratos, no acceso directo

**Estado:** **Aceptada** — 2026-08-08, Datafast (decisión **D13**, propuesta del propietario)
**Decide:** Datafast · **Refuerza:** PA-12 · PA-16 · ADR-016 · CON-001
**Relacionado:** ADR-002 (outbox) · ADR-011

---

## 1. Problema

El corpus ya distingue **Core Indestructible** y **módulos degradables** (ADR-016), y **PA-12** ya
dice, literalmente:

> *«Cada tabla tiene un módulo que la escribe. Los demás la leen a través de él.»*

**Medido el 2026-08-08, la política no se cumple en las tablas que más importan.**

| Tabla | Módulos que la ESCRIBEN |
|---|---|
| **`contratos`** | **10** — promesas-pago (6 escrituras), contratos, smartolt, workers, clientes, facturacion, google-integration, olt-nativo, outbox-red, reconciliador |
| **`clientes`** | **5** — contratos (5), clientes (3), promesas-pago (3), google-integration, workers |
| `notificaciones_logs` | 5 · `facturas` 3 · `pagos` 3 · `clientes_historial_estados` 3 |

**56 tablas escritas desde código, 15 con más de un escritor.**

La separación Core/degradable existe hoy como **organización de carpetas y patrón de arranque**, no
como frontera de propiedad. Cualquier módulo escribe cualquier tabla.

> **Límite de la medición, declarado:** el inventario detecta **solo SQL crudo** en literales de
> plantilla. No ve las escrituras vía repositorio TypeORM — por eso `usuarios` aparece con un único
> escritor (`install`) y `vpn_clientes` con `mantenimiento`, que es falso. **La cifra de 15 es un
> suelo, no un total.**

---

## 2. La propuesta, y las tres precisiones que necesita

La propuesta del propietario: *el Core expone capacidades y contratos; los módulos consumen esas
capacidades sin acceder a sus internals*, con tres mecanismos —llamada interna, API interna,
eventos— y **sin** convertir el Core en un cuello de botella por el que pase todo.

Se acepta el fondo. Tres precisiones surgidas de contrastarla con el código.

### 2.1 Facturación y Cobranza NO son degradables

La propuesta las dibujaba como degradables. **No lo son, y no deben serlo**: CON-001 y ADR-016 las
sitúan en el Core Indestructible. Un ERP que arranca con la facturación degradada es un ERP que
responde y no factura — el fallo que B-14 acaba de costar dos días.

Se adopta el criterio que faltaba, y que hasta ahora estaba implícito:

> **Degradable es lo que depende de algo que no controlamos** — hardware de red, API de terceros,
> un servicio externo. Un módulo que solo depende de la base de datos **no tiene a qué degradarse**:
> si falla, es un defecto nuestro y debe verse al arrancar.

| Degradables | Core Indestructible |
|---|---|
| olt-nativo · mikrotik · smartolt · openvpn · xui/IPTV · crm-nativo (WhatsApp) · mensajeria · google-integration · pasarelas de pago | auth · usuarios · licencia · clientes · contratos · planes · **facturacion** · **pagos** · **cobranza** · finanzas-opex · reportes · config · auditoria · schema-guard |

### 2.2 El bus de eventos no cruza procesos: lo que la propuesta pide es un outbox

**PA-16** ya lo declara: *«El bus es in-process: un evento emitido en un proceso no llega a otro.»*

El ejemplo `PaymentRegistered → WhatsApp` **no funcionaría**: WhatsApp corre en su propio proceso
PM2 (`datafast-whatsapp`). Y esta parte de la propuesta —

```
WhatsApp cae → el evento queda pendiente → WhatsApp vuelve → lo procesa
```

— **requiere durabilidad**, y un `EventEmitter` en memoria tiene cero: si el proceso muere, el
evento no existió. Lo descrito no es un evento: es un **outbox**.

El ERP ya resolvió exactamente esto para la red (`comandos_red_pendientes` + `outbox-red`, con
reclamo atómico y reintentos, ADR-002). El mecanismo 3 se desdobla:

| Mecanismo | Cuándo | Con qué |
|---|---|---|
| **Evento** | Reacción inmediata, mismo proceso, **se puede perder sin consecuencia** | `EventEmitter2` |
| **Trabajo diferido** | **Debe ejecutarse aunque el destino esté caído** | Outbox persistente o cola Redis |

**Regla:** si la frase «esto tiene que ocurrir aunque el módulo esté caído» es cierta, **no es un
evento**. Los listeners siguen sin ejecutar lógica: encolan (PA-16).

### 2.3 La regla es para todos, no solo para los degradables

La propuesta prohibía a **los degradables** escribir tablas del Core. Los datos dicen que los
mayores infractores son **Core escribiendo Core**: promesas-pago escribe `contratos` seis veces,
contratos escribe `clientes` cinco. Acotada a degradables, la regla no tocaría el problema real.

**Se adopta PA-12 sin distinción de categoría: cada tabla, un dueño.**

---

## 3. La corrección de fondo: la propiedad se declara, el salto no la crea

Aplicar la regla como *«todo pasa por una API del Core»* produciría el Core-Dios que la propia
propuesta quiere evitar, con más pasos. Y en un caso concreto **desharía trabajo correcto**:

`DeudaPorContratoService` vive en `facturacion` y escribe `contratos.deuda_total`. La lectura
literal exigiría `facturacion → ContratosService.actualizarDeuda() → contratos`. **Ese método
existía y se eliminó el 2026-08-08** (ADR-019): aceptaba cualquier cifra sin contrastarla con una
factura, y su único consumidor la usaba para reactivar morosos.

> **Un salto de API no crea propiedad: la disfraza.** `deuda_total` es un dato de facturación
> almacenado en una tabla de contratos; el problema es de **ubicación de la propiedad**, no de
> número de capas.

Por eso la directriz que se adopta habla de **dueño declarado**, y admite tres formas de
resolverlo, en este orden de preferencia:

1. **Reubicar el dato** en una tabla que su dueño natural posea.
2. **Declarar propiedad por columna**: la tabla tiene un custodio y una columna concreta tiene otro
   dueño, escrito en el manifiesto. Es el caso de `contratos.deuda_total` → `facturacion`.
3. **Exponer una capacidad** del dueño, cuando la operación es de negocio y no un simple `UPDATE`.

**Añadir un servicio pasarela que solo reenvía un `UPDATE` no es ninguna de las tres.**

---

## 4. Decisión

### 4.1 Las dos directrices

> **D-1.** El Core es el propietario de las capacidades y los datos fundamentales del ERP. Ningún
> módulo accede a los internals ni a las tablas de otro. Toda interacción se realiza mediante
> contratos de aplicación, APIs internas o trabajo encolado, **según la naturaleza de la
> operación** — no por HTTP en todos los casos.
>
> **D-2.** Ningún módulo degradable es necesario para la disponibilidad de las capacidades críticas
> del Core. La caída de un módulo produce **degradación funcional localizada y recuperable**, nunca
> indisponibilidad general del ERP.

### 4.2 Arquitectura: monolito modular, una sola base de datos

**No se separa una base de datos por módulo.** Sería microservicios por moda, y multiplicaría por
diez la dificultad de las transacciones que hoy sostienen el dinero.

Un módulo se extrae a servicio independiente **solo cuando exista una razón medida** —carga,
disponibilidad o independencia operativa— y para entonces el contrato ya existirá, así que la
extracción no rediseña el dominio. `olt-automation-service` ya es precedente de eso.

### 4.3 El manifiesto de propiedad

Se declara un dueño por tabla en `backend/src/common/domain/propiedad-tablas.ts`, con la **foto
actual** y las excepciones justificadas. Es la parte que convierte la directriz en algo verificable.

**Excepción heredada de PA-12:** `comandos_red_pendientes` la escriben los módulos de negocio para
que la intención viaje en su transacción, y `outbox-red` la consume. Se mantiene, corrigiendo la
redacción: `outbox-red` **también escribe** (reclamo, estado, reintentos), cosa que el texto
original de PA-12 no contemplaba.

### 4.4 La barrera

Un test compara el manifiesto contra el código y **falla si aparece un escritor no declarado**. La
cifra actual —**15 tablas con más de un escritor**— se congela como techo: puede bajar, nunca subir.

**No se rompe el build con las 15 de golpe.** Se declaran como deuda conocida, con dueño y con
infractores nombrados, y se reducen cuando cada módulo se toque por otra razón — el mismo criterio
de alcance incremental que rige VIO.

---

## 5. Consecuencias

**Positivas:** la separación Core/degradable deja de ser una convención de carpetas. El criterio de
qué es degradable pasa a ser verificable en vez de intuitivo. Y `contratos`, con diez escritores,
deja de poder crecer a once en silencio.

**Negativas:** el manifiesto es trabajo de mantenimiento, y **está incompleto por construcción** —
solo ve SQL crudo (§1). Un módulo que escriba por repositorio TypeORM se le escapa. Se declara el
límite en vez de fingir cobertura total; ampliarlo al repositorio es trabajo posterior.

**Lo que NO cambia:** ADR-016 (patrón degradado), ADR-002 (outbox), PA-16 (listeners que encolan) y
la base de datos única. Esta decisión los **formaliza y hace exigibles**, no los sustituye.

---

## 6. Qué NO autoriza esta decisión

- **No autoriza refactorizar los 15 casos ahora.** CON-001 §8.11.3 y el sentido común: se reducen
  al tocar cada módulo por otra razón.
- **No autoriza añadir capas pasarela** para cumplir la letra (§3).
- **No autoriza convertir facturación, cobranza o pagos en degradables** (§2.1).
- **No autoriza sustituir el outbox por eventos** en trabajo que debe sobrevivir a una caída (§2.2).
