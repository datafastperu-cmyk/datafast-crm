# POL-001 — Políticas Corporativas

---

## 2. Control documental

| Campo | Valor |
|---|---|
| **Código** | POL-001 · **Versión** 2.0 · **Estado** Vigente |
| **Autor** | Arquitectura · **Propietario del producto** Datafast (D1) |
| **Fecha** | 2026-08-06 · **Documento superior** CON-001 |
| **Carácter** | **Obligatorio.** Su incumplimiento requiere excepción registrada |

## 3. Historial de cambios

| Versión | Fecha | Cambio | Motivo |
|---|---|---|---|
| 1.0 | 2026-08-06 | Emisión inicial | Las reglas existían en `CLAUDE.md` y en comentarios de código, pero no eran exigibles ni citables |
| 1.1 | 2026-08-06 | **Siete políticas nuevas** (PD-11, PD-12, PS-10, PI-08, PP-14, PP-15) desde las decisiones D3, D5, D7, D8, D9 y D10. Matriz de verificación §8.7 ampliada. Dos desviaciones nuevas (B-12, B-13). **POL-001 pasa a ser la única fuente normativa**: `docs/directrices/` queda congelado | Fase 2 de PLAN-001. Dos fuentes para las mismas reglas es lo que R-006 prohíbe |
| **2.0** | **2026-08-09** | **PD-13 — el modelo cubre la forma del sector; la funcionalidad, la instalación.** El ERP es un producto para varios operadores, y el modelo de datos se diseñaba contra el estado de la instalación que lo estrena. Incluye la clasificación obligatoria **adoptado / adaptado / extendido**, la línea **regla vs estructura**, y cinco condiciones sin las cuales sería una licencia para abstraer sin límite | Lo planteó el propietario al corregir una evaluación que medía `BillingAccount` contra las necesidades de Datafast en vez de contra la forma del sector. La política **cambia una decisión ya tomada** (`DIA_PAGO_MAXIMO = 28`) y mejora el argumento de otra (`moroso`), que es como se comprueba que no es decorativa |
| **1.9** | **2026-08-08** | **B-3 medida y acotada**: 102 endpoints mutantes sin autorización alguna (no «con rol grueso», como decía la ficha), techo congelado. Corregidos los cinco de `auditoria` y un rol fantasma que dejaba `papelera/eliminar` inalcanzable | El guard deja pasar a cualquier autenticado cuando no hay ni rol ni permiso. La ficha describía un problema distinto y menos grave del real |
| **1.8** | **2026-08-08** | **Criterio de PD-11 corregido el mismo dia**: «hay autoridad» no bastaba — dejaba cinco modulos en 🔴 sin que existiera nadie que pudiera reclamar nada. Ahora 🔴 exige **al menos una de tres razones** (interoperabilidad, examen de un tercero, riesgo asimetrico) **y la fila dice cual** | Lo detecto el propietario al preguntar quien es esa autoridad. De cinco modulos en 🔴 quedo **uno**: si todo es 🔴, nada lo es |
| **1.7** | **2026-08-08** | **PD-11 reformulada por ADR-034**: se clasifica por el ORIGEN DEL MODELO (🔴 conformidad / 🟠 referencia / 🟢 estratégico), con una sola pregunta que los separa — ¿hay una autoridad externa que pueda decir que lo hicimos mal? Sustituye la tabla de cinco naturalezas | La clasificación anterior mezclaba dos ejes: quién escribe el código (siempre nosotros) y de dónde sale el modelo (lo único que hay que decidir) |
| **1.6** | **2026-08-08** | **PA-12 reforzada y verificable** (manifiesto de propiedad + barrera): la cifra de 15 tablas con varios escritores queda congelada. **Dos politicas nuevas: PA-17** (que es degradable) y **PA-18** (evento vs outbox) | ADR-032, propuesta del propietario. PA-12 llevaba escrita desde la emision y no impidio que **diez modulos escribieran `contratos`** |
| **1.5** | **2026-08-08** | **A-1 RETIRADA como nivel A** por ADR-031: el propietario confirma que el ERP es mono-empresa, y la base lo impone. **Cero desviaciones criticas abiertas.** El barrido de aislamiento sale del CI el mismo dia que entro | La desviacion no se corrigio: **se verifico que su premisa era falsa**. Nadie habia comprobado que fuera a haber mas de una empresa |
| **1.4** | **2026-08-08** | **A-1 pasa a PARCIAL** (ADR-017): entra el barrido de aislamiento con cifra triada (20 abiertas / 171 transitivas / 13 globales). **RLS se descarta por ahora: seria inerte.** Nueva desviacion **B-15** — la aplicacion se conecta a PostgreSQL como SUPERUSUARIO con BYPASSRLS y dueña de las 111 tablas | Fase 3.3. La medicion impidio escribir ``aislamiento garantizado por RLS`` sobre un mecanismo que no filtra nada |
| **1.3** | **2026-08-08** | **A-4 cerrada** por ADR-019: la deuda pasa de cuatro implementaciones a una definición y un solo escritor. **R-9 de DOM-001 sale de la lista de reglas sin mecanismo**; queda R-33 (fuga entre empresas) como la de mayor consecuencia sin barrera. Registrada **deuda de modelo** en DOM-001 §8.9: `contratos.deuda_total` no debería existir | Fase 3.2 de PLAN-001. D11 se resolvió midiendo quién escribe, no eligiendo |
| **1.2** | **2026-08-07** | **Tres desviaciones cerradas** (A-3, B-12, B-13) por ADR-020. **PP-11 y PP-07 pasan a verificación automática**: la cobertura sube de 23 % a 26 %, por barreras construidas y no por texto escrito. **Una desviación nueva: B-14** — el instalador genera un `ecosystem.config.js` que contradice al del repositorio y deja una instalación nueva sin worker | Fase 3.1 de PLAN-001. El diagnóstico original de A-3 se quedaba corto: no era solo que el latido no se vigilara, es que **37 de 47 crons no latían** |

## 4. Índice

1. Políticas de Desarrollo · 2. Políticas de Arquitectura · 3. Políticas de Seguridad ·
4. Políticas de Calidad · 5. Políticas de Integración · 6. Políticas de Producción

## 5. Objetivo

Establecer las reglas obligatorias del proyecto: qué debe cumplirse siempre, qué está prohibido y
qué requiere excepción registrada.

## 6. Alcance

Todo el código, la configuración, los datos y las operaciones del ERP Datafast. Aplica a todas
las personas y agentes que lo modifiquen.

## 7. Definiciones y glosario

| Término | Definición |
|---|---|
| **DEBE / PROHIBIDO** | Obligación absoluta. Su incumplimiento exige excepción registrada |
| **DEBERÍA** | Obligación fuerte; se puede desviar con justificación en el código |
| **PUEDE** | Opcional |
| **Excepción registrada** | Desviación documentada en un ADR o en `PENDIENTES.md`, con motivo y condición de cierre |

**Regla de las excepciones:**

> Una excepción documentada es gobernable. Una excepción silenciosa es deuda invisible, porque el
> siguiente lector construirá encima creyendo que la regla se cumple.

---

# 8. Contenido

# 8.1 Políticas de Desarrollo

## PD-01 · No se programa sin contexto — **DEBE**

Antes de escribir código: leer los archivos relevantes, revisar el historial y entender la
arquitectura. Si el contexto es insuficiente, **preguntar**; no asumir.

## PD-02 · Inspección integral antes de una solución — **DEBE**

Orden obligatorio: código local → VPS → ERP en ejecución → routers/antenas si aplica.

## PD-03 · Causa raíz antes que parche — **DEBE**

No se da por corregido un fallo sin poder explicar **cómo llegó el sistema a ese estado**.

**Checklist obligatorio:**
1. Reproducirlo y **observarlo**, no deducirlo.
2. Explicar por qué el sistema llegó a ese estado.
3. Preguntar **dónde más ocurre lo mismo**.
4. Corregir **en el punto común**.
5. Dejar constancia **de la causa**, no del arreglo.

> Si la explicación es *"no sé por qué pasaba, pero con esto ya no pasa"*, no está corregido:
> **está oculto**.

## PD-04 · Reutilizar antes de construir — **DEBE**

Antes de escribir una consulta o servicio de lectura:
1. Buscar si ya existe (un `grep` por el concepto de negocio cuesta un minuto).
2. Si existe y sirve, **usarlo** — filtrar de más es barato, mantener dos fuentes no.
3. Si no encaja, **extenderlo**; nunca clonarlo.
4. Si hace falta uno nuevo, dejar **una** definición reutilizable.
5. Si la duplicación es inevitable, **escribir en el código por qué** y qué hay que cambiar en los dos sitios si cambia la regla.

**Matiz obligatorio:** comprobar que el **coste encaja con el uso**. Un servicio válido para una
consulta puntual puede ser inviable en bucle.

## PD-05 · Solución mínima — **DEBERÍA**

Lo mínimo que resuelve el problema. Sin abstracciones, helpers, tipos ni validaciones que nadie
pidió. **Tres líneas repetidas son preferibles a una abstracción prematura.**

## PD-06 · No reescribir archivos completos — **DEBE**

Cambio parcial, no sustitución. **PROHIBIDO** "limpiar" el código alrededor del cambio: mezcla
correcciones con refactor y hace irrevisable el diff.

## PD-07 · Validar antes de declarar hecho — **DEBE**

Compilar, ejecutar tests o verificar contra el sistema real. **PROHIBIDO** declarar "listo" sin
evidencia.

## PD-08 · Idioma y tipado — **DEBE**

Documentar y comentar **en español**. Tipado estricto en TypeScript: **PROHIBIDO `any`** salvo
excepción justificada en el código.

## PD-09 · Los comentarios explican por qué, no qué — **DEBE**

Un comentario registra la **razón** de una decisión, no la traducción del código. Los comentarios
más valiosos del repositorio explican qué incidente motivó una decisión.

## PD-10 · Registro de deuda técnica — **DEBE**

Todo trabajo que quede abierto se registra en `PENDIENTES.md` con: **qué falta**, **por qué
importa** (la consecuencia real, no la tarea) y **cómo se comprueba**.

> Una entrada sin consecuencia acaba siendo ignorada.

## PD-11 · Construir o adoptar: el ORIGEN DEL MODELO se decide antes de diseñar — **DEBE**

*(Decisión D5, 2026-08-06 · reformulada por **ADR-034**, decisión D15, 2026-08-08)*

**PROHIBIDO** empezar un módulo sin clasificarlo antes. Medido: unos **24.100 LOC** del backend
reimplementan problemas que la industria resolvió — y el caso más caro no fue código de más, sino
**un concepto reinventado**: `contratos.deuda_total` no debería existir, porque un modelo contable
deriva la deuda de los apuntes abiertos en vez de almacenarla.

**La clasificación es por el ORIGEN DEL MODELO, no por la naturaleza del módulo.** Quién escribe el
código no es la pregunta —siempre nosotros, es un monolito—; la pregunta es de dónde sale el modelo.

**Un módulo es 🔴 cuando se cumple AL MENOS UNA de estas tres razones — y la clasificación debe
decir cuál:**

| # | Razón | Qué pasa si nos desviamos |
|---|---|---|
| **1** | **Interoperabilidad** — alguien al otro lado debe aceptar lo que producimos | SUNAT rechaza · el banco no procesa · ninguna herramienta lee nuestras trazas |
| **2** | **Examen de un tercero** — alguien puede revisarlo y declararlo inválido | Un auditor no acepta los libros |
| **3** | **Riesgo asimétrico** — no hay nadie enfrente, pero inventar cuesta desproporcionadamente caro y **el error no se ve hasta que te explotan** | Criptografía o autenticación propias |

| | Régimen | Cuándo | Consecuencia |
|---|---|---|---|
| 🔴 | **Conformidad** | Al menos una de las tres razones. **La fila dice cuál** | Desviarse **exige ADR**. Nadie declara conformidad sin *gap analysis* |
| 🟠 | **Referencia** | Hay modelo maduro y **desviarse solo nos cuesta a nosotros** | **Consultarlo es obligatorio** y queda en el ADR de diseño. Adaptarlo es libre |
| 🟢 | **Estratégico** | No hay modelo aplicable, o el nuestro es la ventaja | Diseño propio. Aquí va la innovación |

**Las autoridades reales de Datafast son cuatro**: SUNAT, RENIEC, los bancos y pasarelas, y un
auditor o la administración tributaria. Todo lo demás no lo es — y confundir «modelo maduro» con
«autoridad» fue el error de la primera versión de este criterio: dejaba cinco módulos en 🔴 sin que
hubiera nadie que pudiera reclamar nada. **Si todo es 🔴, nada lo es.**

**La clasificación de los 45 módulos actuales está en ADR-034 §3**, y los dominios que aún no
existen en §4 — separados a propósito de los que sí.

### Los dos guards, sin los cuales esta política hace daño

| # | Guard |
|---|---|
| 1 | **Adoptar conocimiento externo NO es adoptar código externo.** Lo que se adopta es el modelo de datos, la máquina de estados, la terminología y las reglas. El código sigue siendo nuestro. Verificar licencia y versión antes de estudiar cualquier producto |
| 2 | **Ningún invariante propio se elimina por adoptar un modelo externo sin un ADR que lo justifique.** Los dominios maduros de este ERP contienen invariantes ganados en incidentes propios que ningún producto de industria trae — p. ej. *la gracia es la distancia vencimiento→corte* |

**Todo módulo 🔴 o 🟠 requiere un ADR de benchmark antes de su diseño**, que documente: qué se
estudió **con fuentes citables**, qué modelo y qué reglas se adoptan, qué se descarta y por qué, y
qué invariantes propios se preservan pese a la adopción.

**La referencia externa por dominio está en ADR-030.**


## PD-12 · Materia regulada: el marco legal se define ANTES de diseñar — **DEBE**

*(Decisión D3, 2026-08-06)*

> **Cuando un módulo nuevo toque materia regulada, el marco legal aplicable se define antes de
> diseñarlo, no después.**

**PROHIBIDO** diseñar primero y revisar la norma después: en materia regulada la norma determina
**el modelo de datos**, no solo la integración.

| Módulo | Materia | Cuándo se define |
|---|---|---|
| **Facturación electrónica** | SUNAT: firma XML, OSE, CDR, catálogos | **Antes del diseño** |
| Portal / datos del abonado | Ley 29733 | Al tocar retención, exportación o supresión |

Esta política **sustituye** al programa de cumplimiento legal continuo, que queda suspendido por
decisión D3 (ADR-029 §6).


## PD-13 · El modelo cubre la forma del sector; la funcionalidad, la instalación — **DEBE**

*(2026-08-09. Propietario: «el modelo tiene que cubrir la forma del sector, no el estado de una
instalación» + «muchas veces habrá que adaptarse a nuestras necesidades, pero siempre siguiendo
estándares del sector»)*

> **El ERP es un producto que se instala en varios operadores. El modelo de datos se diseña contra
> la forma del sector, no contra el estado de la instalación que lo estrena.** Un concepto que el
> sector trata como entidad propia se modela como entidad propia, aunque hoy solo haya una
> instancia por fila.
>
> **La funcionalidad es lo contrario: se construye para lo que la instalación necesita hoy.** Una
> entidad puede existir en el esquema y no tener pantalla.

**Los dos ejes son distintos, y confundirlos rompe la política en las dos direcciones:** diseñar el
modelo contra la instalación produce migraciones caras; construir funcionalidad contra el sector
produce pantallas para clientes que no existen.

### Toda divergencia se clasifica y se escribe

| Estado | Cuándo | Qué exige |
|---|---|---|
| **Adoptado** | El sector lo resuelve y nos sirve | Se toma con su estructura |
| **Adaptado** | El sector lo resuelve, la regla no encaja | Se conserva la **estructura**, se cambia la **regla**, y se escribe **qué** se cambió y **por qué** |
| **Extendido** | El sector no lo contempla | Se construye y se declara extensión propia — no se disfraza de estándar |

**Una adaptación sin motivo escrito es indistinguible de un error**, y en dos años nadie sabrá cuál
era. Ya ocurrió: la nota de crédito estaba bien resuelta y se afirmó lo contrario, porque nada
declaraba que lo estuviera.

### Se adapta la REGLA, no la ESTRUCTURA

Es la línea que separa la adaptación sana de la deuda, y sale de dos casos propios:

- **Regla — barata e interoperable.** `BillingCycleSpecification` (TMF666) tiene
  `paymentDueDateOffset`; Datafast lo usa con valor 0. Misma estructura, regla propia. Un
  corporativo a 15 días es cambiar un número.
- **Estructura — cara.** El abono. El sector lo emite **negativo**; aquí es positivo porque un
  CHECK prohíbe importes negativos. Misma entidad, signo distinto → hubo que distinguirla por tipo
  de documento en 18 consultas, y dejó latente un defecto de dinero (A-5).

**Y la lección del segundo:** el signo negativo no era un capricho del estándar, **era el
mecanismo** — existe para que el abono reste solo, sin que nadie tenga que acordarse.

> **Regla práctica.** Si la necesidad se expresa como un **valor distinto en un campo que el
> estándar ya tiene**, es adaptación sana. Si obliga a **cambiar la forma de la entidad**, hay que
> parar: probablemente el estándar ya tiene el campo, y lo que se va a construir es una traducción
> que alguien tendrá que mantener.

### Las cinco condiciones

Sin ellas esto es una licencia para abstraer sin límite, y **choca con la regla de no crear
abstracciones prematuras**. Con ellas, no.

1. **La forma sale de un modelo citable** —TM Forum SID, Odoo, ERPNext, la norma aplicable—, no de
   suponer qué querrá otro operador. Sin fuente no es «el sector»: es una conjetura (PD-11, R-001).
2. **La ausencia se demuestra con un caso INEXPRESABLE**, no con uno improbable. `BillingAccount`
   entra porque «boleta en casa y factura en el negocio, mismo titular» no se puede escribir en el
   modelo actual; no porque algún día alguien pudiera quererlo.
3. **Se adapta la regla, no la estructura** (arriba).
4. **Cada concepto propio declara su correspondencia** con la entidad del estándar. Se documenta en
   español —eso no cambia—, pero mapeado. Hoy `contratos.dia_facturacion`,
   `facturacion_config.diaPago` y `billingDateShift` son el mismo concepto con tres nombres, y por
   eso el código tiene que colapsarlos con un `MIN`.
5. **Se adopta en la ventana barata.** Si el coste de migración ya domina, la respuesta correcta es
   un **adaptador en el borde**, no una reescritura.

### Qué NO autoriza

Construir funcionalidad para un operador que no existe, ni añadir niveles de modelo que el estándar
**no** separa. Al evaluar R-036 se recortaron dos de los tres niveles propuestos por esto:
`Subscription → Service → Service Instance` son tres nombres para una cosa cuando no hay composición
de producto.

### Contraste: qué habría cambiado

Una política que no cambia ninguna decisión pasada es decorativa. Esta cambia una y mejora otra:

| Decisión | Veredicto bajo PD-13 |
|---|---|
| `DIA_PAGO_MAXIMO = 28` | **La incumple.** Se eligió para *evitar* el problema de febrero — razonar desde el estado. El sector lo resuelve al revés: Stripe tiene `day_of_month = 31` con recorte a fin de mes |
| ADR-031 (mono-empresa) | **La resiste, y marca el límite.** Parece «estado de una instalación», pero cada operador tiene su propio VPS: mono-empresa **es** la forma del producto |
| Borrar el estado `moroso` | **La resiste, con mejor argumento del que se dio.** Se justificó con «nadie lo usa» —argumento de instalación—; el correcto es que el sector no modela la mora como estado del contrato sino como condición derivada |

---

# 8.2 Políticas de Arquitectura

## PA-01 · Módulos degradables nacen degradados — **DEBE**

Todo módulo que dependa de hardware, API externa, servicio de terceros o infraestructura opcional
implementa el patrón degradable **desde que se crea el archivo `.service.ts`**.

**PROHIBIDO** construirlo primero y aplicar el patrón después.

**Checklist:** `OnModuleInit` → probe ligero → `registrar('<nombre>', 'degraded'\|'ok', razón)` →
`assertNotDegraded()` en los métodos que requieren el recurso → **nunca relanzar la excepción del
probe**.

## PA-02 · El Core Indestructible no se degrada — **PROHIBIDO**

`auth` · `usuarios` · `licencia` · `clientes` · `contratos` · `planes` · `facturacion` · `pagos` ·
`finanzas-opex` · `reportes` · `zonas` · `plantillas` · `config` · `schema-guard` · `auditoria`

Si alguno falla al iniciar, **el backend debe crashear** para que PM2 conserve el proceso
anterior.

## PA-03 · VIO en toda mutación de hardware — **DEBE**

1. Tras escribir, ejecutar un comando de **lectura independiente** que confirme el efecto.
2. Sin confirmación, **PROHIBIDO reportar éxito**: se distingue "aceptado, sin confirmar" de "aplicado y confirmado".
3. La verificación no bloquea indefinidamente: reintentos acotados (3–4 con backoff corto).
4. Reutilizar las sondas existentes como patrón.

## PA-04 · VIO hacia adentro — **DEBE**

1. Todo comentario que garantice **concurrencia, atomicidad o exclusión mutua** lleva un test que lo ejercite, **o se borra**.
2. Un **log describe lo que ocurrió**, nunca lo que el código pretendía hacer.
3. Los tests de garantías **nombran el incidente** que las motivó.

## PA-05 · Máquina de estados declarativa — **DEBE**

Todo recurso con ciclo de vida contra hardware declara sus transiciones en **un solo archivo**
(`domain/*-maquina-estados.ts`).

- La idempotencia **se deriva** del estado destino (`ya_en_destino` = éxito).
- Los guards **consultan** la máquina; **PROHIBIDO** que escriban su propio array de estados.
- Retirar un estado de origen exige **justificar por qué**.

## PA-06 · Vocabulario de dominio — **DEBE**

Todo método invocable por un orquestador devuelve `ResultadoOperacion`, **no excepciones HTTP**.

1. `indeterminado` es **obligatorio** ante un timeout contra hardware.
2. Rechazos definitivos: **solo 400 y 404**. **PROHIBIDO** usar `status < 500`.
3. Ante la duda: **reintentable**.
4. **PROHIBIDO** inferir reintentabilidad de un código HTTP.

## PA-07 · Toda mutación de hardware pasa por el outbox — **DEBE**

La intención se escribe en `comandos_red_pendientes` **en la misma transacción** que el cambio de
negocio.

**PROHIBIDO** ejecutar una operación de hardware dentro del ciclo de vida de un request HTTP
(el timeout global de 30 s la rompe).

## PA-08 · Wizards: lo no confirmado se anula — **DEBE**

La frontera de confirmación es el **estado terminal verificado**, **nunca** el clic del operador.

**Obligatorio:** ruta de anulación en todos los caminos de cierre · fire-and-forget cancelable ·
red de seguridad en servidor (heartbeat + TTL) · revertir hardware **y** liberar recursos ·
prohibir operaciones concurrentes sobre el mismo recurso · **compensación registrada antes de
ejecutar** · cada paso guarda cómo deshacerse **y** cómo verificarse · compensaciones idempotentes
· VIO al deshacer · el heartbeat **suprime** el barrido con **techo absoluto** · anular es
asíncrono.

**PROHIBIDO** interrumpir una operación de hardware a mitad. Anular no es abortar: se **espera** a
que termine y luego se revierte.

## PA-09 · Contrato obligatorio de todo adaptador — **DEBE**

1. **Nunca propagar excepciones** al llamador: resultado estructurado con `exitoso`, `mensaje`, `latenciaMs`.
2. **Medir latencia** incluyendo el tiempo de conexión.
3. **PROHIBIDO modificar la base de datos desde dentro del adaptador.**
4. Las credenciales descifradas viven **solo en memoria** y **nunca se loguean**.

## PA-10 · Implementación desde cero — **DEBE**

El ERP inyecta **su** configuración canónica en los equipos que provisiona y **respeta como
intocable** lo preexistente.

**PROHIBIDO** reconfigurar un equipo que ya funcionaba. Una ONU que el ERP no aprovisionó **se
adopta**: se observa y se respeta.

**PROHIBIDO** reutilizar un recurso ajeno sin verificar que está libre.

## PA-11 · Portabilidad multi-VPS — **PROHIBIDO** lo contrario

**PROHIBIDO** que un archivo del repositorio contenga IPs, dominios, URLs de servidor o secretos.

- Variables de entorno, **nunca** literales.
- **Lazy getters** para constantes de módulo que lean `process.env`.
- `ecosystem.config.js` **sin** IPs ni secretos.
- Scripts y comandos enviados a hardware construidos **en tiempo de ejecución**.
- Toda variable nueva documentada en `.env.example`.

## PA-12 · Una tabla, un dueño — **DEBE**

Cada tabla tiene un módulo que la escribe. Los demás la leen a través de él. **Sin distinción
entre Core y degradables**: al medirlo el 2026-08-08 los mayores infractores eran módulos del
Core escribiendo tablas de otro Core.

**Verificación (ADR-032):** el dueño se declara en `common/domain/propiedad-tablas.ts` y lo
sostiene `propiedad-tablas.spec.ts`. La cifra de partida —**15 tablas con más de un escritor**,
`contratos` con diez— queda **congelada como techo: puede bajar, nunca subir**.

**Cómo se resuelve una infracción** (ADR-032 §3, en orden de preferencia): reubicar el dato en la
tabla de su dueño natural · declarar propiedad **por columna** · exponer una capacidad del dueño.
**Añadir un servicio pasarela que solo reenvía un `UPDATE` no es ninguna de las tres** — crearía
el Core-Dios que ADR-032 existe para evitar.

**Excepciones registradas:**
- `comandos_red_pendientes` — los módulos de negocio ENCOLAN aquí para que la intención viaje en
  su propia transacción (patrón outbox, ADR-002). *Corrección al texto original: `outbox-red`
  también escribe —reclamo atómico, estado, reintentos—, no solo lee.*
- `contratos.deuda_total` — propiedad de `facturacion` por declaración expresa. Resolverlo con un
  método en contratos reintroduciría la puerta que ADR-019 eliminó.

## PA-13 · Toda tabla nace con entidad — **DEBE**

Toda tabla nueva se declara como entidad TypeORM. Columnas `string | null` llevan `type:`
explícito (sin él, SWC crashea el backend en frío).

## PA-14 · El esquema solo cambia por migración — **PROHIBIDO** lo contrario

`synchronize: false` sin excepciones. **PROHIBIDO** editar una migración ya desplegada: se
corrige con otra. **Un solo proceso migra.**

## PA-15 · Todo cron declara cap, lock y latido — **DEBE**

**PROHIBIDO** un proceso de fondo que itere sin límite de trabajo. Todo cron declara su
presupuesto de tiempo, su cap por ejecución y emite latido.

## PA-16 · Los listeners de eventos no ejecutan lógica de negocio — **DEBE**

El bus es **in-process**: un evento emitido en un proceso no llega a otro. Un listener **encola**;
no ejecuta. Si ejecutara, su comportamiento dependería de dónde se emitió el evento.

## PA-17 · Toda operación rutinaria se modela explícitamente — **DEBE**

Componer una operación de negocio con operaciones destructivas **no es modelarla**.


## PA-18 · Degradable es lo que depende de algo que no controlamos — **DEBE**

*(ADR-032, decisión D13)*

Un módulo es **degradable** si depende de hardware de red, de una API de terceros o de un servicio
externo. Un módulo que solo depende de la base de datos **no tiene a qué degradarse**: si falla, es
un defecto propio y debe verse al arrancar.

**PROHIBIDO** declarar degradables a `facturacion`, `pagos` o `cobranza`. Un ERP que arranca con la
facturación degradada es un ERP que responde y no factura — el fallo que costó la desviación B-14.

**La caída de un degradable produce degradación funcional localizada y recuperable, nunca
indisponibilidad general del ERP.**

## PA-19 · Si debe ocurrir aunque el destino esté caído, no es un evento — **DEBE**

*(ADR-032 §2.2)*

El bus es in-process (PA-16): un evento no cruza procesos y **no sobrevive a la muerte del
proceso**. WhatsApp corre en su propio proceso PM2; un evento emitido en `api-core` no le llega.

| Mecanismo | Cuándo |
|---|---|
| **Evento** (`EventEmitter2`) | Reacción inmediata, mismo proceso, se puede perder sin consecuencia |
| **Outbox / cola persistente** | El trabajo **debe** ejecutarse aunque el destino esté caído |

«El evento queda pendiente y se procesa cuando el módulo vuelva» **describe un outbox**, no un
evento: un `EventEmitter` en memoria tiene cero durabilidad.

---

# 8.3 Políticas de Seguridad

## PS-01 · Ningún secreto en el repositorio — **PROHIBIDO**

Ni en código, ni en `ecosystem.config.js`, ni en `docker-compose.yml`, ni en documentación.
`ACCESOS.local.md` **nunca** sale del entorno local.

## PS-02 · El proceso más expuesto tiene los menos secretos — **DEBE**

El frontend **no recibe ningún secreto**. Su entorno se declara explícitamente, nunca se hereda
de una shell.

## PS-03 · Credenciales de terceros cifradas en base de datos — **DEBE**

Con `encryption.util` (`ENCRYPTION_KEY`). **PROHIBIDO** loguear credenciales, tokens o
contraseñas, incluso en depuración.

## PS-04 · Toda consulta filtra por `empresa_id` — **DEBE**

Ninguna consulta sobre una tabla con `empresa_id` puede omitir el filtro.

> ⚠️ **Esta política está incumplida por diseño histórico**: la garantía es hoy convencional, no
> mecánica. Registrada como riesgo crítico (RDM-001 R3). **Hasta que exista el mecanismo, la
> política se cumple manualmente y se verifica en revisión.**

## PS-05 · Autorización explícita en endpoints mutantes — **DEBERÍA** → **DEBE** para módulos nuevos

Todo endpoint que muta declara `@RequirePermission('recurso:accion')`.

**Estado actual:** aplicado en 4 de 44 módulos. **Todo módulo nuevo lo aplica sin excepción.**

## PS-06 · Validación de entrada — **DEBE**

DTO con `class-validator` en cada endpoint. **Sanitizar toda variable enviada a un CLI de hardware
o a una API de RouterOS.**

## PS-07 · La API interna no se expone — **PROHIBIDO**

El servicio Python escucha **solo** en `127.0.0.1` y exige API key. **PROHIBIDO** publicarlo.

## PS-08 · Swagger deshabilitado en producción — **DEBE**

## PS-09 · Toda mutación queda auditada — **DEBE**

Solo las lecturas de alto volumen pueden marcar `skipAudit`, y con justificación.

## PS-10 · Protección de datos personales — **DEBE**

*(Decisión D7, 2026-08-06. Alcance **técnico**; el legal queda suspendido por D3 — ADR-029 §6.2)*

El ERP guarda datos personales de alta sensibilidad:

| Dato | Dónde |
|---|---|
| Documento de identidad y datos de RENIEC | `clientes` |
| Dirección del domicilio | `clientes`, `contratos` |
| **Coordenadas GPS del domicilio** | `contratos.latitud_instalacion` |
| Foto del cliente | Uploads |
| **Conversaciones de WhatsApp** | `crm_mensajes` |
| **Dispositivos conectados dentro de la vivienda** | Portal / TR-069 |
| **Clave WiFi del abonado** | `contrato_onu_config` |

**Obligaciones técnicas:**

| # | Regla |
|---|---|
| 1 | **PROHIBIDO restaurar un respaldo de producción en un entorno de prueba sin anonimizar.** Un dump contiene el padrón completo con domicilios georreferenciados y conversaciones privadas |
| 2 | Toda tabla con datos personales **declara su plazo de retención**. Sin plazo declarado, no se crea |
| 3 | Dar de baja a un cliente **no borra su historial**, pero debe existir un procedimiento explícito de supresión cuando se solicite |
| 4 | **PROHIBIDO loguear** documento, dirección, coordenadas, contenido de mensajes o claves del abonado |
| 5 | El acceso a datos sensibles **queda auditado** (PS-09) |
| 6 | Los secretos del abonado (clave WiFi, credenciales) van **cifrados** (PS-03) y **nunca se devuelven en claro** salvo al generarlos una vez |

> **Fuera de alcance por D3:** base legal del tratamiento, derechos del titular, plazos
> normativos y cláusulas contractuales. Se definen cuando un módulo los exija (PD-12).

---

# 8.4 Políticas de Calidad

## PC-01 · Todo invariante crítico lleva test — **DEBE**

Se consideran críticos los que afectan a **dinero, aislamiento entre empresas, concurrencia o
plano físico de red**.

## PC-02 · Los tests nombran el incidente — **DEBE**

**PROHIBIDO** un test llamado "no debería fallar". El nombre indica qué incidente previene.

## PC-03 · Un comentario que garantiza concurrencia lleva test, o se borra — **DEBE**

Borrarlo es una opción legítima: **una garantía que nadie sostiene es peor que ninguna**.

## PC-04 · Verificación que confirme también el caso malo — **DEBE**

> *"Una verificación que solo sabe confirmar el caso bueno no es una verificación."*

Aplica a scripts de despliegue, healthchecks y comprobaciones automáticas.

## PC-05 · El código compila y typechequea antes del commit — **DEBE**

## PC-06 · Diseño cero-error — **DEBE**

**PROHIBIDO:** placeholders · TODOs en código productivo · bloques `catch` genéricos sin lógica de
recuperación · errores silenciados.

## PC-07 · Evaluación pesimista obligatoria — **DEBE**

Ante cualquier cambio que toque red o dinero, evaluar por escrito: timeouts, race conditions,
desfase de estado hardware↔BD y sanitización de entrada.

---

# 8.5 Políticas de Integración

## PI-01 · Toda integración nueva nace degradable — **DEBE**

## PI-02 · Toda integración nueva pasa por un puerto — **DEBE**

**PROHIBIDO** llamar a un proveedor externo directamente desde un servicio de dominio.

## PI-03 · Antes de un segundo proveedor, el primero pasa por el contrato — **DEBE**

> *"Si la abstracción no lo absorbe, la abstracción está mal y se corrige con un proveedor, no
> con tres."*

## PI-04 · Puerta de estabilidad del dinero — **PROHIBIDO** saltarla

**PROHIBIDO** integrar una pasarela de pago antes de cumplir: 30 días de invariante de
contabilidad limpio en producción, un extorno real revisado a mano y un cierre de caja mensual
cuadrado.

**PROHIBIDO** crear un segundo servicio que registre pagos o aplique dinero.

## PI-05 · Un timeout cobrando es `indeterminado` — **DEBE**

**PROHIBIDO** reintentar a ciegas (cobra dos veces) y **PROHIBIDO** reportar fallo (deja dinero
sin registro). Se reporta `indeterminado` y lo resuelve el conciliador.

## PI-06 · Sin dependencias sin consumidor — **DEBE**

Una dependencia sin uso se retira. Si se conserva, se documenta por qué y hasta cuándo.

## PI-07 · La decisión de canal es por modelo — **DEBE**

**PROHIBIDA** una dependencia global de un mecanismo de bootstrap. Un modelo no catalogado
produce un error explícito, **jamás un intento a ciegas**.

## PI-08 · Fin de vida de dependencias externas — **DEBE**

*(Decisión D9, 2026-08-06)*

Toda dependencia externa **crítica** declara: qué pasa si desaparece, tiempo estimado de
sustitución, y **si existe un puerto que permita sustituirla**.

| Dependencia | Riesgo | Puerto |
|---|---|---|
| **`whatsapp-web.js`** | **No es API oficial.** Puede dejar de funcionar sin aviso | Strategy (mitigado) |
| **Servidor de licencias** | **Su caída bloquea el ERP completo** | Ninguno — deliberado |
| GenieACS | Sin soporte; credenciales duplicadas fuera del repositorio | Driver ZTP |
| Evolution API | Versión fijada, proyecto de terceros | Strategy |
| XUI.ONE | Software de terceros | Servicio degradable |
| SmartOLT / AdminOLT | Camino legado | `IOltProvider` |

> **Una dependencia sin puerto es una dependencia insustituible.** Hoy lo son MikroTik, OpenVPN,
> Mercado Pago y WhatsApp Web: no se pueden cambiar sin tocar lógica de negocio.

**Revisión de vigencia:** anual, o ante aviso de discontinuación.

---

# 8.6 Políticas de Producción

## PP-01 · El arranque se declara en un solo archivo — **PROHIBIDO** lo contrario

`ecosystem.config.js` es la fuente de verdad única. **PROHIBIDO `pm2 start` manual.**

## PP-02 · Un solo proceso migra — **DEBE**

## PP-03 · Nunca `--reload` en producción — **PROHIBIDO**

WatchFiles reinicia el servicio al tocar cualquier archivo, y un `git reset --hard` de despliegue
lo dispara **en medio de una operación contra la OLT**.

## PP-04 · Un worker uvicorn para el servicio de OLT — **DEBE**

El MA5800 tiene un límite bajo de sesiones VTY concurrentes.

## PP-05 · Aislamiento de procesos por causa — **DEBE**

Un componente que puede descontrolarse (Chromium) vive en su **propio proceso**, para que muera
solo sin arrastrar lo crítico.

## PP-06 · Timeouts realistas contra hardware — **DEBE**

WAN 90 s · rollback GPON 150 s. **PROHIBIDO** asumir que un timeout significa que no pasó nada.

## PP-07 · Todo despliegue se verifica — **DEBE**

**PROHIBIDO** un script de despliegue que afirme éxito sin comprobarlo. La verificación debe
detectar también el proceso en bucle de reinicio, no solo el uptime.

## PP-08 · Ningún dominio es obligatorio — **DEBE**

Servirse por IP, en LAN o con tres dominios son **el caso normal**. Renombrar una variable de
entorno exige **periodo de gracia**.

## PP-09 · Usar el flujo de negocio, nunca SQL directo — **PROHIBIDO**

Un `UPDATE` directo **se salta las cascadas** (revocar certs, quitar rutas, invalidar pools).

## PP-10 · Antes de una migración de ONUs — **DEBE**

**PROHIBIDO** iniciar una migración sin ejecutar el pre-flight **antes y después**, y sin declarar
el `origen` de cada ONU incorporada.

| # | Obligación |
|---|---|
| 1 | Toda ONU incorporada declara **`origen = 'migrada'` o `'adoptada'`**. **PROHIBIDO** usar el constructor por defecto, que asume `'erp'` |
| 2 | Ejecutar `GET /olt-nativo/ztp/preflight-migracion` **antes** de empezar |
| 3 | Ejecutar el mismo pre-flight **después** de incorporar. Si devuelve `seguro: false`, **PARAR y corregir el origen** antes de continuar |

**La ventana de exposición son dos minutos, no una noche.** Son dos los barridos que aplican el
auto-config, y el que captura una ONU recién migrada (`last_applied_revision IS NULL`) es
`reconcilePendingReinjection`, que corre **cada 2 minutos** — no el de las 03:30.

Consulta equivalente si no hay acceso a la API:

```sql
SELECT origen,
       COUNT(*) FILTER (
         WHERE provisioning_enabled
           AND (last_applied_revision IS NULL OR last_applied_revision < revision)
       ) AS en_barrido
FROM   contrato_onu_config
WHERE  deleted_at IS NULL
GROUP BY origen;
```

**`en_barrido` debe ser 0 para todo origen distinto de `erp`.**

## PP-11 · Todo proceso de fondo late y es vigilado — **DEBE**

**PROHIBIDO** un watcher que no emita latido. Un fallo silencioso es peor que uno ruidoso.

## PP-12 · Nunca modificar el balanceo de OASIS sin leer antes — **PROHIBIDO**

Leer mangle, rutas y address-lists. El sistema usa `Linea1-8` por `src-address-list`, **no PCC**.

## PP-13 · Scripts de red fuera del repositorio del ERP — **DEBE**

Van en `Proyecto_CRM_ISP/mikrotik-network/`.

## PP-14 · Entorno de pruebas — **DEBE**

*(Decisión D8, 2026-08-06)*

**Hoy no existe entorno de pruebas: todo se verifica en producción, con clientes reales.** Ya se
pagó: las 11 horas de código viejo, el crash por la columna sin `type:`, el `--reload` que abortó
una provisión, y la certificación de bootstrap con falso positivo.

**Alcance mínimo obligatorio, por tipo de cambio:**

| Tipo de cambio | Dónde se prueba |
|---|---|
| Lógica de negocio, migraciones, API | **CI** — ya existe y bloquea el merge |
| Operaciones contra hardware | **Laboratorio con equipo físico** si lo hay; si no, **simulación** |
| Todo lo demás | Producción **con precauciones declaradas** |

| # | Regla |
|---|---|
| 1 | **PROHIBIDO restaurar un dump de producción sin anonimizar** (PS-10) |
| 2 | Un cambio que toque hardware declara **cómo se revierte** antes de ejecutarse |
| 3 | Probar un bootstrap sobre un equipo que **ya tiene** la configuración buscada **no prueba nada** — su falso positivo es más caro que un falso negativo |

## PP-15 · Gestión de capacidad — **DEBE**

*(Decisión D10, 2026-08-06)*

**Umbrales que disparan una decisión de capacidad:**

| Señal | Umbral | Acción |
|---|---|---|
| Memoria libre del VPS | Los límites PM2 suman **3,17 GB sobre ~1,9 GB** | Ya sobrecomprometido: vigilar |
| Conexiones a PostgreSQL | `max_connections=100`; 3 procesos × 15 | Revisar antes de añadir procesos |
| Series temporales | `metricas_monitoreo` crece cada minuto × dispositivo | Particionado y retención (ADR-023) |
| Profundidad de colas / edad del outbox | Acumulación sostenida | Segregar el worker (ADR-020) |

**Lo que NO se puede escalar:** los workers del servicio OLT. El MA5800 tiene un límite bajo de
sesiones VTY concurrentes (ADR-008). **Añadir workers empeora, no mejora.**

---

# 8.7 Verificación del cumplimiento

> **Una política sin forma de verificarse es una intención.** Esta sección declara, para cada
> política, **cómo se comprueba** que se cumple.

## 8.7.0 El CI que ya existe

`.github/workflows/ci.yml` (desde 2026-07-28, commit `a36117fd`) corre **en cada push a `main` y
en cada pull request**, y **bloquea el merge**:

| Paso | Qué verifica |
|---|---|
| `npm run typecheck` (backend) | Compilación estricta del backend |
| `npx jest --runInBand --ci` | **65 suites · 593 tests** |
| `npm run migration:run:all` sobre PostgreSQL 16 vacío | **Que el ERP se puede instalar desde cero** — la directriz de portabilidad multi-VPS |
| Volcado de `information_schema` | Produce el esquema real, sin depender de un snapshot que envejece |
| `npm run sql:check -- /tmp/schema.txt src` | **Columnas inexistentes dentro de template strings**, invisibles para el compilador |
| `npx tsc --noEmit` (frontend) | Compilación del frontend |

> *"La regla es que FALLE y bloquee el merge. Un CI que informa pero no bloquea envejece igual que
> las suites que vinimos a rescatar."* — cabecera del propio workflow.

**Corrección de la versión 1.0 de este documento (2026-08-06):** esta sección afirmaba que
`typecheck`, `test` y `sql:check` se ejecutaban a mano y que la suite de facturación no compilaba.
**Las tres afirmaciones eran falsas.** Procedían de una memoria del 2026-07-28 que registraba esos
problemas; el commit de ese mismo día los resolvió. Se propagaron sin ejecutar el comando — el
fallo que PI-2 prohíbe (*el diagnóstico se mide, no se deduce*), cometido sobre este mismo cuerpo
normativo.

**Verificado el 2026-08-06:** suite completa en verde (65/65, 593 tests, 70 s) con las mismas
banderas que usa el CI.

## 8.7.1 Tipos de evidencia

| Código | Mecanismo | Naturaleza |
|---|---|---|
| **T** | Test automatizado (`*.spec.ts`) | Automática |
| **L** | Linter / compilador (ESLint, `tsc`) | Automática |
| **D** | Restricción de base de datos (índice, constraint, trigger) | Automática |
| **R** | Guard, interceptor o mecanismo en tiempo de ejecución | Automática |
| **S** | Script de verificación (`sql:check`, `check-*.mjs`) | Automática, **ejecución manual hoy** |
| **C** | Integrado en CI | Automática y sistemática |
| **M** | Revisión manual en code review | Humana |
| **O** | Observación en operación (health, watchers, drift) | Humana asistida |

## 8.7.2 Grado de verificación

| Grado | Significado |
|---|---|
| ✅ **Automático** | Un incumplimiento **falla** sin intervención humana |
| ⚠️ **Parcial** | Existe mecanismo pero no cubre todos los casos, o no está en CI |
| ❌ **Manual** | Solo se detecta si alguien lo busca |

## 8.7.3 Matriz — Políticas de Desarrollo

| Política | Evidencia | Grado | Cómo se comprueba hoy | Objetivo |
|---|---|---|---|---|
| PD-01 No programar sin contexto | M | ❌ | Revisión | Sin mecanismo posible |
| PD-02 Inspección integral | M | ❌ | Revisión | Sin mecanismo posible |
| PD-03 Causa raíz antes que parche | M | ❌ | El commit debe explicar la causa | Plantilla de commit en CI |
| PD-04 Reutilizar antes de construir | M | ❌ | Revisión | Detección de consultas duplicadas por concepto |
| PD-05 Solución mínima | M | ❌ | Revisión | Sin mecanismo posible |
| PD-06 No reescribir archivos completos | M | ❌ | Tamaño del diff en revisión | Aviso automático si el diff sustituye >80 % del archivo |
| PD-07 Validar antes de declarar hecho | L + T + **C** | ✅ | **`typecheck` + 593 tests en CI, bloqueando el merge** | — |
| PD-08 Tipado estricto, sin `any` | L | ❌ | **El compilador NO lo exige** (§Anexo B, nivel B) | `strict: true` + regla activa (**ADR-018**) |
| PD-09 Comentarios explican el porqué | M | ❌ | Revisión | Sin mecanismo posible |
| PD-10 Registro de deuda técnica | M | ❌ | Revisión de `PENDIENTES.md` | Sin mecanismo posible |
| **PD-11 Construir o adoptar** | M | ❌ | Revisión + ADR de benchmark obligatorio para módulos Maduros | Checklist verificado en PR (R-034) |
| **PD-12 Materia regulada antes del diseño** | M | ❌ | ADR previo | Sin mecanismo posible — es criterio |
| **PD-13 El modelo cubre el sector; la funcionalidad, la instalación** | M + **parcial T** | ⚠️ | Revisión + ADR. **Sí es verificable en parte**: el mapa de correspondencias concepto↔estándar puede tener barrera, como la tuvo el manifiesto de propiedad de tablas (PA-12) | Barrera sobre el mapa de correspondencias — pendiente hasta que exista el mapa |

## 8.7.4 Matriz — Políticas de Arquitectura

| Política | Evidencia | Grado | Cómo se comprueba hoy | Objetivo |
|---|---|---|---|---|
| PA-01 Módulos degradables nacen degradados | R + M | ⚠️ | `GET /health/modules` lo expone; nada obliga a implementarlo | Checklist verificado en revisión (ADR-024) |
| PA-02 Core Indestructible no se degrada | R | ⚠️ | El backend crashea si falla el init | Test de arranque por módulo |
| PA-03 VIO en toda mutación de hardware | T + R | ⚠️ | Sondas implementadas en FTTH; **ausentes en MikroTik** | Extender a MikroTik (**ADR-021**) |
| PA-04 VIO hacia adentro | T + M | ⚠️ | Hay tests de los invariantes principales | Regla: comentario de concurrencia sin test **falla en CI** |
| PA-05 Máquina de estados declarativa | T | ⚠️ | `ftth-maquina-estados.spec.ts`, `planta-externa-…spec.ts`. **WISP no tiene máquina** | Máquina para WISP (**ADR-021**) |
| PA-06 Vocabulario de dominio | T | ⚠️ | `resultado-operacion.spec.ts`, `contrato-adaptador.spec.ts`. Solo plano de red | Extender al plano financiero |
| PA-07 Toda mutación de hardware por outbox | T + M | ⚠️ | `outbox-red.claim.spec.ts`. **Las operaciones interactivas son síncronas** | Outbox también en interactivas (**ADR-028**) |
| PA-08 Wizards anulan lo no confirmado | R + O | ⚠️ | Saga + watchers en producción. **Sin test de los 4 invariantes del compensador** | Tests del compensador |
| PA-09 Contrato de todo adaptador | M | ❌ | Escrito en `IOltProvider`; revisión humana | Test de contrato por adaptador |
| PA-10 Implementación desde cero | M | ❌ | Directriz | Campo de origen explícito (**ADR-014 → R1**) |
| PA-11 Portabilidad multi-VPS | S | ⚠️ | `check-*.mjs`; inspección | Regla de CI que rechace IPs y dominios literales |
| PA-12 Una tabla, un dueño | M | ❌ | Revisión | Detección de escrituras cruzadas |
| PA-13 Toda tabla nace con entidad | T + S + M | ⚠️ | La regla SWC del `type:` explícito **sí está testeada** (`columnas-tipadas.spec.ts`, recorre todas las entidades). Lo que falta es la cobertura: **39 tablas sin entidad** | Entidades para tablas críticas (**ADR-026**) |
| PA-14 El esquema solo cambia por migración | R + D + **C** | ✅ | `synchronize: false` + `schema-guard` + **el CI instala desde cero en cada PR** | — |
| PA-15 Todo cron declara cap, lock y latido | O | ❌ | `GET /admin/sistema/watchers`. **`reconciliar()` sin cap** | Cap y lock obligatorios (**ADR-027**) |
| PA-16 Listeners no ejecutan lógica | M | ❌ | Revisión | Regla de lint sobre `@OnEvent` |
| PA-17 Modelar lo rutinario | M | ❌ | Revisión | Cambio de ONU modelado (**ADR-022**) |

## 8.7.5 Matriz — Políticas de Seguridad

| Política | Evidencia | Grado | Cómo se comprueba hoy | Objetivo |
|---|---|---|---|---|
| PS-01 Ningún secreto en el repositorio | S + M | ⚠️ | `.gitignore` + revisión | **Escaneo de secretos en CI** |
| PS-02 El proceso expuesto, con menos secretos | R | ✅ | `ecosystem.config.js` declara entorno mínimo | — |
| PS-03 Credenciales cifradas en BD | R | ✅ | `encryption.util` en el camino de escritura | Test de que no se persiste en claro |
| PS-04 Toda consulta filtra por `empresa_id` | M | ❌ | **Solo revisión. 445 consultas** (Anexo B, **nivel A**) | **RLS en PostgreSQL + barrido en CI** (**ADR-017**) |
| PS-05 Permiso fino en endpoints mutantes | M | ❌ | **4 de 44 módulos** (Anexo B, nivel B) | Regla de CI: endpoint mutante sin `@RequirePermission` falla (**ADR-025**) |
| PS-06 Validación de entrada | R | ✅ | `ValidationPipe` global con `whitelist` | `forbidNonWhitelisted: true` (nivel C) |
| PS-07 La API interna no se expone | R | ✅ | Escucha en `127.0.0.1` + API key + red Docker interna | — |
| PS-08 Swagger deshabilitado en producción | R | ✅ | Condicional en `main.ts` | — |
| PS-09 Toda mutación queda auditada | R | ✅ | `AuditInterceptor` global | — |
| **PS-10 Protección de datos personales** | M | ❌ | Solo revisión | Test que detecte logs con datos sensibles; procedimiento de anonimización de dumps |

## 8.7.6 Matriz — Políticas de Calidad

| Política | Evidencia | Grado | Cómo se comprueba hoy | Objetivo |
|---|---|---|---|---|
| PC-01 Todo invariante crítico lleva test | T + **C** | ⚠️ | **65 suites · 593 tests en CI.** Alta calidad; cobertura aún parcial frente a ~96.000 LOC | Lista de invariantes con test obligatorio |
| PC-02 Los tests nombran el incidente | M | ❌ | Revisión | Sin mecanismo posible |
| PC-03 Comentario de concurrencia con test | M | ❌ | Revisión | Regla de CI |
| PC-04 Verificación que confirme el caso malo | M + O | ❌ | Revisión y experiencia | Checklist de despliegue (PRO-001 §8.1.3) |
| PC-05 Compila y typechequea antes del commit | L + **C** | ✅ | **CI bloquea el merge** (backend y frontend) | — |
| PC-06 Diseño cero-error | L + M | ⚠️ | ESLint parcial | Regla que rechace `catch` vacío y TODOs |
| PC-07 Evaluación pesimista obligatoria | M | ❌ | Revisión | ADR obligatorio en cambios de red o dinero |

## 8.7.7 Matriz — Políticas de Integración

| Política | Evidencia | Grado | Cómo se comprueba hoy | Objetivo |
|---|---|---|---|---|
| PI-01 Toda integración nace degradable | R + M | ⚠️ | `GET /health/modules` | Checklist en revisión |
| PI-02 Toda integración pasa por un puerto | M | ❌ | Revisión. **Mercado Pago no lo cumple** (Anexo B, nivel B) | Migrar Mercado Pago (**R11**) |
| PI-03 El primer proveedor pasa por el contrato antes que el segundo | M | ❌ | Revisión | Puerta documentada en ADR-013 |
| PI-04 Puerta de estabilidad del dinero | T + M | ⚠️ | `frontera-dinero.spec.ts` bloquea el segundo escritor | Criterios 1–3 son de negocio: **no automatizables** |
| PI-05 Un timeout cobrando es `indeterminado` | T | ✅ | `contrato-adaptador.spec.ts`, `resultado-operacion.spec.ts` | — |
| PI-06 Sin dependencias sin consumidor | S | ❌ | Inspección | Auditoría de dependencias en CI |
| PI-07 La decisión de canal es por modelo | T | ✅ | Catálogo + `olt-model-catalog.spec.ts` | — |
| **PI-08 Fin de vida de dependencias** | M | ❌ | Revisión anual | Auditoría de dependencias en CI |

## 8.7.8 Matriz — Políticas de Producción

| Política | Evidencia | Grado | Cómo se comprueba hoy | Objetivo |
|---|---|---|---|---|
| PP-01 Arranque declarado en un solo archivo | M | ❌ | Revisión de `ecosystem.config.js` | Verificación de que los procesos vivos coinciden |
| PP-02 Un solo proceso migra | R | ✅ | `RUN_MIGRATIONS` por proceso | — |
| PP-03 Nunca `--reload` en producción | M | ❌ | Revisión | Verificación de argumentos en despliegue |
| PP-04 Un worker uvicorn | M | ❌ | Revisión | Ídem |
| PP-05 Aislamiento de procesos por causa | R | ✅ | Procesos PM2 separados | — |
| PP-06 Timeouts realistas | M | ❌ | Revisión | Constantes centralizadas y testeadas |
| PP-07 Todo despliegue se verifica | S | ✅ | `scripts/lib/pm2-recargar.sh` — definición única que verifica estado, uptime y delta del contador de reinicios, consumida por `update.sh` y los cuatro scripts de despliegue | El checklist de PRO-001 §8.1.3 tiene puntos que siguen siendo manuales (humo funcional) |
| PP-08 Ningún dominio es obligatorio | R | ✅ | Plantillas Nginx con caída elegante | — |
| PP-09 Usar el flujo de negocio, nunca SQL directo | M | ❌ | Revisión y disciplina | `verificarInvariantes()` ampliado |
| PP-10 Pre-flight antes de migrar ONUs | S | ❌ | Consulta manual | **Pre-flight que falle en seco** (**R1**) |
| **PA-12 Una tabla, un dueno** | A | ✅ | Manifiesto `propiedad-tablas.ts` + barrera que congela el techo en 15 | Reducir los 15 al tocar cada modulo |
| **PA-18 Que es degradable** | A | ⚠️ | Lista explicita en POL-001; el patron degradado se verifica al arrancar | Test que compruebe la lista contra los modulos reales |
| **PA-19 Evento vs outbox** | M | ❌ | Directriz | Sin mecanismo: exige juicio sobre la naturaleza del trabajo |
| PP-11 Todo proceso de fondo late y es vigilado | O | ✅ | **Late:** `CronLatidoService` envuelve todo job del `SchedulerRegistry` (47/47) — no depende de que el autor lo llame. **Vigila:** `LatidoVigilanteService` en el proceso sin crons escribe `PLANO_AUTOMATICO_MUDO` en `eventos_sistema`. **Barrera:** test que falla si un `@Cron` no declara `name:` | — (**ADR-020**, 2026-08-07) |
| PP-12 No modificar OASIS sin leer antes | M | ❌ | Directriz | Sin mecanismo posible |
| PP-13 Scripts de red fuera del repo | M | ❌ | Revisión | Regla de CI sobre rutas |
| **PP-14 Entorno de pruebas** | C + M | ⚠️ | El CI cubre lógica, migraciones y API. Hardware: sin entorno | Laboratorio o simulación para hardware |
| **PP-15 Gestión de capacidad** | O | ❌ | Inspección manual | Métricas y umbrales (ADR-024) |

## 8.7.9 Resumen del estado de verificación

| Grado | Nº de políticas | Porcentaje | (v1.1, antes de ADR-020) | (v1.0, antes de verificar el CI) |
|---|---|---|---|---|
| ✅ Automático | **18** | **26 %** | 16 · 23 % | 14 · 22 % |
| ⚠️ Parcial | **18** | 26 % | 20 · 29 % | 20 · 32 % |
| ❌ Manual | **34** | 48 % | 34 · 48 % | 29 · 46 % |

> **El porcentaje BAJA al añadir políticas nuevas, y es correcto que baje.** En v1.1, siete
> políticas nuevas entraron sin mecanismo: declararlas no las hace cumplirse. El indicador mide
> barreras, no intenciones — si subiera al escribir texto, no serviría para nada.
>
> **Y SUBE cuando se construye una barrera, no cuando se escribe una regla.** En v1.2 sube por
> dos: PP-11 y PP-07, ambas por ADR-020. Es el único movimiento al alza que el indicador admite.

**Lectura honesta:** una cuarta parte de las políticas tiene hoy una barrera que las haga cumplir.
Las demás dependen de disciplina y revisión.

**Esto no invalida las políticas** —describen cómo debe construirse el sistema y en su mayoría se
cumplen— pero sí explica por qué la cobertura de las garantías es desigual: **donde no hay
mecanismo, el cumplimiento depende de que alguien recuerde**.

**Lo que el CI ya cubre y no hay que construir:** compilación, la suite completa, la instalación
desde cero sobre una base vacía, y la verificación de columnas dentro de template strings — las
cuatro bloqueando el merge. La brecha de verificación **no está en la infraestructura de CI: está
en cuántas políticas tienen una comprobación que ese CI pueda ejecutar.**

Añadir una política verificable es hoy barato: hay dónde enchufarla.

**Objetivo declarado:** llevar a ✅ o ⚠️ todas las políticas de nivel A y B del Anexo B. Es el
contenido de R17 (gobierno arquitectónico) en RDM-001.

## 8.7.10 Políticas que no se pueden automatizar

Se declaran explícitamente para no perseguir un imposible:

| Política | Por qué no |
|---|---|
| PD-01, PD-02, PD-05, PD-09 | Son criterios de juicio profesional |
| PC-02 (nombrar el incidente) | Requiere saber qué incidente lo motivó |
| PC-07 (evaluación pesimista) | Es un ejercicio de análisis, no una comprobación |
| PI-04 criterios 1–3 | Son criterios de negocio: 30 días de contabilidad limpia no lo verifica un script |
| PP-12 (OASIS) | Requiere leer y entender una configuración de red |

Para estas, el mecanismo es **la revisión y el ADR**, no la automatización.

---

# 9. Referencias

CON-001 · AEM-001 · ARS-001 · DOM-001 · DAT-001 · INT-001 · SEC-001 · EST-001 · GUI-001 ·
PRO-001 · RDM-001 · ADR-001…016 y ADR-017…028 (propuestas) · `CLAUDE.md` · `docs/directrices/`

---

# 10. Anexos

## Anexo A — Índice rápido de prohibiciones

| # | PROHIBIDO |
|---|---|
| 1 | Secretos, IPs o dominios en el repositorio |
| 2 | `pm2 start` manual |
| 3 | `--reload` de uvicorn en producción |
| 4 | `synchronize: true` |
| 5 | Editar una migración desplegada |
| 6 | Ejecutar hardware dentro de un request HTTP |
| 7 | Interrumpir una operación de hardware a mitad |
| 8 | Inferir reintentabilidad de un código HTTP |
| 9 | Usar `status < 500` como criterio de rechazo definitivo |
| 10 | Reintentar a ciegas tras un timeout de cobro |
| 11 | Un segundo servicio que registre pagos o aplique dinero |
| 12 | Integrar una pasarela antes de la puerta de estabilidad |
| 13 | `UPDATE` directo saltándose el flujo de negocio |
| 14 | Reconfigurar una ONU que el ERP no aprovisionó |
| 15 | Reutilizar un recurso ajeno sin verificar que está libre |
| 16 | Retirar del pool una IP de gestión ocupada |
| 17 | Editar una versión publicada de un baseline |
| 18 | Crear VLANs sin consumidor |
| 19 | Loguear credenciales, tokens o contraseñas |
| 20 | Exponer la API interna del servicio Python |
| 21 | Swagger en producción |
| 22 | `any` en TypeScript sin justificación |
| 23 | `catch` genérico sin lógica de recuperación |
| 24 | TODOs y placeholders en código productivo |
| 25 | Un test llamado "no debería fallar" |
| 26 | Un cron que itere sin cap |
| 27 | Un watcher sin latido |
| 28 | Un listener de evento que ejecute lógica de negocio |
| 29 | Un script de despliegue que afirme éxito sin comprobarlo |
| 30 | Modificar el balanceo de OASIS sin leer mangle, rutas y address-lists |

## Anexo B — Registro de desviaciones vigentes

### B.1 Clasificación

| Nivel | Nombre | Definición | Autoriza |
|---|---|---|---|
| **A** | **Incumplimiento crítico** | Puede causar **daño irreversible**: fuga entre empresas, pérdida de datos, corte indebido de servicio o dinero mal registrado | **Propietario del producto** |
| **B** | **Riesgo técnico** | Degrada mantenibilidad, trazabilidad o capacidad de detectar fallos. No causa daño irreversible por sí solo | Arquitecto |
| **C** | **Mejora futura** | Cumplimiento parcial por adopción incremental. El código nuevo ya la respeta | Arquitecto |

**Toda desviación declara cuatro cosas:** nivel · estado actual · **estado objetivo** (cómo debe
quedar) · qué la cierra.

> Una desviación sin estado objetivo no es gobernable: nadie sabe hacia dónde va. Y una excepción
> sin condición de cierre no es una excepción: es una política derogada de hecho.

### B.2 Nivel A — Incumplimientos críticos

| # | Política | Estado actual | **Estado objetivo** | Qué lo cierra | Riesgo si no se cierra |
|---|---|---|---|---|---|
| ~~**A-1**~~ | ~~**PS-04** — toda consulta filtra por `empresa_id`~~ | **RETIRADA 2026-08-08 como nivel A.** No por haberse corregido, sino porque **su consecuencia ya no puede ocurrir**: ADR-031 fija que el ERP es mono-empresa y la base lo impone con el indice unico `unica_empresa_por_instalacion`. No hay datos ajenos si no hay ajenos. **`empresa_id` pasa de control de aislamiento a clave de particion vestigial** | **ADR-031** — implementado. El barrido queda latente fuera del CI | Reabrirla exige retirar ese indice (ADR-031 §4.2) |
| ~~**A-2**~~ | ~~**PP-10** — pre-flight antes de migrar ONUs~~ | **CERRADA 2026-08-06** | Alcanzado: columna `origen`, guard en los dos barridos y en la ruta manual, pre-flight que devuelve `seguro: false`, y 4 tests que nombran el riesgo | **ADR-014** — implementado | — |
| ~~**A-3**~~ | ~~**PP-11** — todo proceso de fondo late y **es vigilado**~~ | **CERRADA 2026-08-07.** El diagnóstico se quedaba corto: no es que el latido fuera consultable en vez de vigilante, es que **37 de 47 jobs no latían**. Cerrada con latido derivado del registro, vigilante en el proceso que responde y barrera contra `@Cron` sin nombre | **ADR-020** — implementado | — |
| ~~**A-4**~~ | ~~**PD-04** — reutilizar antes de construir (aplicado a la deuda)~~ | **CERRADA 2026-08-08.** Una definición de los estados con saldo (eran **21 escrituras a mano** con tres variantes), un solo escritor de `contratos.deuda_total` (eran 4), y barrera en tests. Se eliminaron las dos puertas que permitían escribir deuda sin respaldo documental | **ADR-019** — implementado | — |
| ~~**A-5**~~ | ~~**PD-04 / PA-06** — una nota de crédito se contaba como deuda~~ | **CERRADA 2026-08-08, el mismo día en que se encontró.** A-4 unificó el ESTADO, y el defecto estaba en lo que no se unificó: el **tipo de documento**. El abono nace `emitida` con importe positivo (el CHECK `total >= 0` prohíbe el negativo de Odoo/ERPNext) y `saldo` es GENERATED, así que **anular una factura no bajaba la deuda: la original salía y su nota de crédito entraba por el mismo importe**, en los 18 consumidores. Al día siguiente pasaba a `vencida` y **sumaba al corte por meses acumulados** — anular podía cortarle el servicio al abonado — y bloqueaba la reactivación tras cobrar (`deuda <= 0` nunca se cumplía). **Latente: 0 notas y 0 anulaciones en producción**, medido antes de tocar nada | Estudio de benchmark **§3.3** — corregido en el punto común: `SQL_ESTADOS_CON_SALDO` deja de exportarse, `sqlDeudaExigible()` lo reemplaza | — |

### B.3 Nivel B — Riesgos técnicos

| # | Política | Estado actual | **Estado objetivo** | Qué lo cierra |
|---|---|---|---|---|
| **B-1** | **PD-08** — tipado estricto, sin `any` | `strict: false` · `strictNullChecks: false` · `noImplicitAny: false` · regla `no-explicit-any` **desactivada**. Se cumple por disciplina | `strict: true` · `strictNullChecks: true` · `noImplicitAny: true` · regla activa. **Adopción por fases**, no de golpe sobre ~96.000 LOC | **ADR-018** |
| **B-2** | **PA-13** — toda tabla nace con entidad | **PARCIAL 2026-08-08 (R7).** Las de **coordinación y dinero ya tienen entidad**: `comandos_red_pendientes`, `operacion_wizard`, `operacion_wizard_paso`, `ftth_operacion_lock`, `cierre_caja`, `pago_extorno`. Quedan **19 tablas** sin entidad, ninguna de esos dos grupos. *(La ficha decía 39; el recuento real antes de este trabajo era 25 — cifra corregida al medirla.)* | Las 19 restantes, de forma incremental al tocar cada módulo | **ADR-026** + RDM-001 **R7**. Barrera: `metadatos-typeorm.spec.ts` |
| **B-3** | **PS-05** — permiso fino en endpoints mutantes | **MEDIDA 2026-08-08, y la ficha decía otra cosa.** De **317** endpoints mutantes: **143 con permiso fino**, 50 con rol, **102 ABIERTOS** — sin `@Roles` ni `@RequirePermission`, que en `RolesGuard` significa **cualquier usuario autenticado**, no «protegido por rol al módulo». **79 de los 102 están en `olt-nativo.controller.ts`.** Corregidos ya los cinco de `auditoria` (`undo`, `redo` y dos restauraciones alcanzaban CUALQUIER tabla del sistema) y un **rol fantasma** que hacía `papelera/eliminar` inalcanzable para todos | Techo congelado en **102**: puede bajar, nunca subir. Los 79 de olt-nativo bajan con **R9** | Barrera `autorizacion-endpoints.spec.ts` (3 tests) · **ADR-025** |
| **B-4** | **PA-07** — toda mutación de hardware por outbox | Las operaciones interactivas de `/red/routers` son **síncronas**, sin outbox ni garantías | **Toda** mutación pasa por outbox; la operación interactiva devuelve "encolado" | **ADR-028** + RDM-001 **R5** |
| **B-5** | **PA-03 / PA-05** — VIO y máquina de estados en MikroTik | El plano WISP tiene outbox parcial, **sin máquina de estados, sin saga**, y VIO solo como detección posterior | Puerto único `IRouterProvider` + máquina de estados WISP + VIO en el momento | **ADR-021** + RDM-001 **R5** |
| **B-6** | **PA-15** — todo cron declara cap, lock y latido | `reconciliar()` **itera sin cap ni lock**; ningún cron declara presupuesto de tiempo | Cap, lock y presupuesto obligatorios; el que los excede lo registra en vez de correr indefinidamente | **ADR-027** + RDM-001 **R10** |
| **B-7** | **PA-17** — modelar lo rutinario | **El cambio de ONU no existe.** Se improvisa como baja + alta | Transición `sustituir_onu` de primera clase, con saga que reserva antes de liberar y conserva la config del abonado | **ADR-022** + RDM-001 **R6** |
| **B-8** | **PI-02 / PI-03** — toda integración pasa por un puerto | **Mercado Pago —el único que cobra dinero real— no usa el contrato de cobro.** La abstracción no está validada | Mercado Pago implementa `adaptador-cobro.interface.ts` **antes** que ningún proveedor nuevo | **ADR-013** (vigente) + RDM-001 **R11** |
| ~~**B-9**~~ | ~~**PC-05 / PD-07** — verificaciones en CI~~ | **NUNCA EXISTIÓ. Error de este documento, corregido el 2026-08-06.** El CI existe desde 2026-07-28 (`a36117fd`) y ejecuta typecheck, 593 tests, instalación desde cero y `sql:check`, bloqueando el merge. La suite compila y está verde | — | — |
| **B-10** | **PA-11** — configuración fuera del repositorio | Credenciales de connreq de GenieACS duplicadas en el ACS y en el `.env`, **sin verificación de coincidencia**. CCD y crontab fuera de control de versiones | Probe al arrancar que verifique la coincidencia; inventario versionado de lo externo con su procedimiento de restauración | RDM-001 **R15** |
| **B-11** | **PA-08** — invariantes del compensador | Implementados y en producción, **sin test que los ejercite** | Test de los cuatro invariantes (LIFO, parada al primer fallo, idempotencia, VIO al deshacer) | RDM-001 **R17** |
| ~~**B-12**~~ | ~~**PP-01** — recargar por ecosystem, nunca por nombre suelto~~ | **CERRADA 2026-08-07.** Los cinco scripts pasan por `scripts/lib/pm2-recargar.sh`: nombres leídos del ecosystem, `--only`, `--update-env` sobre el fichero y no sobre el shell | **ADR-020** §4.6 — implementado | — |
| ~~**B-13**~~ | ~~**PP-07** — todo despliegue se verifica~~ | **CERRADA 2026-08-07** para el reinicio del backend. La misma función verifica estado `online`, uptime bajo y **delta del contador de reinicios ≤ 1**, y falla si no cuadra. Los puntos de humo funcional del checklist de PRO-001 §8.1.3 siguen siendo manuales, y eso no es una desviación: es lo que un script no puede decidir | **ADR-020** §4.6 — implementado | — |
| **B-15** | **PS-01 / OWASP** — mínimo privilegio | **La aplicación se conecta a PostgreSQL como SUPERUSUARIO** (`datafast_db_user`: `rolsuper`, `rolbypassrls`, dueña de las 111 tablas). Cualquier inyección SQL que alcance el motor lo hace con permisos totales. **Prerrequisito RESUELTO 2026-08-08:** conjunto mínimo validado contra la base real (11/11 operaciones del ERP funcionan, 4/4 peligrosas bloqueadas) y eliminado el último DDL en tiempo de ejecución, que habría roto el alta de clientes. Ver **ADR-017 §8** | Aplicar el cambio de rol: uno de migración (DDL) y otro de ejecución (DML), ninguno superusuario | **Decisión del propietario.** Falta probarlo sobre instalación limpia |
| ~~**B-14**~~ | ~~**PP-01 / ADR-011** — el ecosystem es la fuente de verdad unica~~ | **CERRADA 2026-08-08.** `setup_pm2` deja de generar su propio ecosystem y pasa a VERIFICAR el del repositorio (que declare api-core, worker y frontend, y que el worker tenga `RUN_CRONS=true`). Causa corregida: las 18 rutas absolutas se derivan ahora de `__dirname`, que era lo que obligaba al instalador a generar el suyo. Corregidas ademas cinco llamadas al proceso muerto `datafast-backend` — incluida la que debia parar el ERP antes de restaurar una copia de seguridad | **ADR-011** — barrera `ecosystem-fuente-unica.spec.ts` (5 tests) | Producción no estaba afectada; el riesgo era para instalaciones nuevas |

### B.4 Nivel C — Mejoras futuras

| # | Política | Estado actual | **Estado objetivo** | Qué lo cierra |
|---|---|---|---|---|
| **C-1** | **PS-06** — validación de entrada | `forbidNonWhitelisted: false`: los campos extra se descartan en silencio | `forbidNonWhitelisted: true`, rechazando la petición | Revisión de impacto en clientes existentes |
| **C-2** | **PA-06** — vocabulario de dominio | Solo en el plano de red; el financiero lanza excepciones HTTP a consumidores que a veces son máquinas | `ResultadoOperacion` también en el plano financiero | Tras ADR-019 |
| **C-3** | **PA-01** — módulos degradables | El patrón existe y se aplica, pero **nada obliga** a implementarlo en un módulo nuevo | Checklist de módulo nuevo verificado en revisión | RDM-001 **R17** |
| **C-4** | **PI-06** — dependencias sin consumidor | `telegraf`, `twilio`, `net-snmp` instaladas sin uso; cola `mikrotik-jobs` declarada y no usada | Retiradas, o documentadas con motivo y fecha | RDM-001 **R14** |
| **C-5** | **EST-001 §8.2** — convención del frontend | Tres convenciones simultáneas; `molecules/` vacío; 1,8 % de código reutilizable | Una convención (por dominio); directorios muertos eliminados; umbral de tamaño de componente | RDM-001 **R13** |
| **C-6** | **PA-16** — listeners no ejecutan lógica | Se cumple, sin mecanismo que lo impida | Regla de lint sobre `@OnEvent` | RDM-001 **R17** |
| **C-7** | **DAT-001 §8.6** — retención de datos | Seis tablas de serie temporal **sin política de retención ni particionado** | Política declarada por tabla + particionado por tiempo | **ADR-023** + RDM-001 **H3-1** |

### B.5 Resumen

| Nivel | Abiertas | Cerradas / retiradas | Autoriza | Estado |
|---|---|---|---|---|
| **A — crítico** | **0** | **5** — A-2 (06/08) · A-3 (07/08) · A-4 y **A-5** (08/08) · **A-1 retirada (08/08)** | **Propietario del producto** | **Cerrado. La atención pasa a B-15** |
| **B — riesgo técnico** | **10** | **4** — B-9 **retirada: nunca existió** · B-12 y B-13 (07/08) · **B-14 (08/08)**. Una nueva: **B-15**, con su prerrequisito resuelto | Arquitecto · **B-15 escala al propietario** | Con condición de cierre declarada |
| **C — mejora futura** | 7 | 0 | Arquitecto | Cierre por avance natural |

**Las desviaciones de nivel A son exactamente las iniciativas críticas del roadmap
(RDM-001 §8.3.1).** No es coincidencia: el roadmap se ordenó por daño potencial, y el daño
potencial es lo que define el nivel A.

**Registro de cierres:**

| Desviación | Cerrada | Cómo se verificó |
|---|---|---|
| **A-2** — pre-flight antes de migrar ONUs | 2026-08-06 | Columna `origen` + guard en el **filtro** de los dos barridos + guard en la ruta manual + pre-flight que devuelve `seguro: false` + 4 tests que nombran el riesgo. `tsc` limpio, suite completa 65/65 · 593 tests. Ver ADR-014 §6 |
| **A-3** — el worker puede morir en silencio | 2026-08-07 | **Se midió antes de escribir**: de 47 jobs programados latían **10**, y 26 de 29 `@Cron` no tenían `name:`. (La primera medición dijo «1 de 47» y era falsa — el `grep` buscaba `heartbeat.ejecutar` y once servicios usan `this.hb.ejecutar`. Corregido el mismo día al ver los datos en producción.) Cierre en tres piezas: latido **derivado** del `SchedulerRegistry` (47/47), vigilante en el proceso sin crons que escribe `PLANO_AUTOMATICO_MUDO`, y barrera de CI contra `@Cron` sin nombre o duplicado. 17 tests nuevos; `tsc` limpio; suite 68/68 · 610 tests. Ver **ADR-020** |
| **B-12** — recargar por nombre suelto | 2026-08-07 | Los cinco scripts usan `scripts/lib/pm2-recargar.sh`. `update.sh` dejó de tener su propia copia: hay **una** definición, no seis. Ver ADR-020 §4.6 |
| **B-14** — el instalador generaba su propio ecosystem | 2026-08-08 | Toda instalación nueva nacía **sin worker**: ningún cron corría. Causa: 18 rutas absolutas en el ecosystem del repo obligaban al instalador a generar el suyo. Ahora se derivan de `__dirname` y `setup_pm2` verifica en vez de generar. Barrera de 5 tests. **Producción no estaba afectada** — se comprobó que su ecosystem era el del repo, sin modificar |
| **B-13** — despliegue sin verificar | 2026-08-07 | La misma función compara el contador de reinicios antes/después y falla si el proceso no reinició, no está `online` o subió más de uno |
| **A-1** — aislamiento multi-tenant | **Retirada 2026-08-08** | **No se corrigio: se comprobo que su premisa era falsa.** A-1 asumia que el ERP alojaria varias empresas; nadie lo habia verificado. Produccion tenia 1 empresa y **ninguna ruta para crear otra**. El propietario confirmo que es mono-empresa por diseño. Convertido en barrera: indice unico `unica_empresa_por_instalacion`. Ver **ADR-031** |
| **A-5** — una nota de crédito se contaba como deuda | 2026-08-08 | **La encontró el benchmark, no una auditoría del código**: Odoo y ERPNext hacen el abono NEGATIVO y por eso resta solo; aquí el CHECK `facturas_total_check` lo impide y nadie miraba el tipo de documento. Se midió antes de tocar: **0 notas de crédito, 0 anulaciones** — latente, y la beta es cuando alguien anula por primera vez. Corregido en el punto común (el estado suelto **ya no se exporta**), 18 consultas migradas, migración 49 para `v_resumen_financiero`, y barrera que marca cualquier fichero que sume dinero de `facturas` sin el helper. `tsc` limpio; suite **75/75 · 638 tests**. Efecto colateral corregido: la barrera de `frontera-dinero` ignoraba comentarios y un comentario que **documentaba** el defecto la hacía fallar |
| **A-4** — la deuda se calcula en 4 sitios | 2026-08-08 | **D11 resuelto con medición, no con criterio**: `facturas.saldo` es una columna GENERATED, así que el único escritor ajeno a la aplicación ya está en la base y es inviolable; la agregación no tiene ninguno → va en servicio de dominio. Defecto real hallado: `pago.repository.calcularDeudaContrato` sumaba solo `contrato_id = $1`, ciega al comprobante consolidado, y reactivaba morosos. Ver **ADR-019** |
| **B-9** — verificaciones en CI | **Retirada 2026-08-06** | **No era una desviación: era un error de este documento.** El CI existe desde 2026-07-28. Se verificó ejecutando `npx jest --runInBand --ci` (65/65, 593 tests, 70 s) y leyendo `.github/workflows/ci.yml`. **Origen del error: se propagó una memoria del 2026-07-28 sin ejecutar el comando** — el fallo que PI-2 prohíbe, cometido sobre el propio cuerpo normativo |
