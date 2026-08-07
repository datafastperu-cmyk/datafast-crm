# ADR — Registro de Decisiones Arquitectónicas

---

## 2. Control documental

| Campo | Valor |
|---|---|
| **Código** | ADR-000 (índice) + ADR-001 … ADR-016 · **Versión** 1.0 · **Estado** Vigente |
| **Autor** | Arquitectura — reconstruido desde el código, los comentarios de diseño y los incidentes |
| **Revisores** | Pendientes de asignar · **Fecha** 2026-08-06 |

## 3. Historial de cambios

| Versión | Fecha | Cambio | Motivo |
|---|---|---|---|
| 1.0 | 2026-08-06 | Emisión inicial con 16 ADR retroactivos | Las decisiones estaban tomadas y bien justificadas, pero dispersas en comentarios. Sin registro, la próxima persona no puede saber **qué se descartó y por qué** |

## 4. Índice

Ver §8.2 — catálogo de ADR.

## 5. Objetivo

Registrar las decisiones arquitectónicas relevantes con su problema, contexto, alternativas
consideradas, decisión, consecuencias y estado.

## 6. Alcance

**Los 16 ADR de esta emisión son retroactivos**: documentan decisiones **ya tomadas y en
producción**. Ninguno es una decisión inventada para completar el registro.

Las alternativas listadas son las que **realmente se consideraron o se probaron**; cuando una
alternativa se dedujo del contexto y no consta que se evaluara, se marca como *(inferida)*.

## 7. Definiciones y glosario

| Estado | Significado |
|---|---|
| **Aceptada** | Vigente y aplicada |
| **Aceptada con excepción** | Vigente, con desviaciones registradas |
| **Propuesta** | Registrada, no implementada |
| **Superseded por ADR-XXX** | Reemplazada |
| **Revertida** | Se implementó y se deshizo |

---

# 8. Contenido

## 8.1 Plantilla de ADR

```markdown
# ADR-XXX — <Título en una línea>

**Estado:** Propuesta | Aceptada | Aceptada con excepción | Superseded por ADR-YYY | Revertida
**Fecha:** AAAA-MM-DD
**Decide:** <rol>

## 1. Problema
Qué había que resolver.

## 2. Contexto
Restricciones reales: técnicas, físicas, de negocio, de plazo.

## 3. Alternativas
| Alternativa | Ventaja | Por qué se descartó |

## 4. Decisión
Qué se hace. En imperativo.

## 5. Consecuencias
Positivas, negativas y lo que queda condicionado.

## 6. Estado
Situación actual y desviaciones conocidas.
```

## 8.2 Catálogo

| ADR | Título | Estado | Origen |
|---|---|---|---|
| 001 | Verificar la materialización, no solo la aceptación (VIO) | Aceptada | CNT-2026-000004 |
| 002 | Outbox transaccional con reclamo atómico | Aceptada | Doble ejecución en producción |
| 003 | Vocabulario de dominio en lugar de excepciones HTTP | Aceptada | 1.788 reintentos |
| 004 | Solo 400 y 404 son rechazos definitivos | Aceptada | 409 de lock descartó trabajo |
| 005 | Máquina de estados declarativa con idempotencia derivada | Aceptada | ONU huérfana desde `suspendido` |
| 006 | Saga con bitácora write-ahead para wizards | Aceptada | Wizard cerrado a medias |
| 007 | La frontera transaccional es el estado terminal, no el clic | Aceptada | Análisis de la regla anterior |
| 008 | Un solo worker uvicorn para el servicio de OLT | Aceptada | Límite VTY del MA5800 |
| 009 | Chromium aislado en su propio proceso PM2 | Aceptada | VPS con 87 MB libres |
| 010 | Solo `api-core` ejecuta migraciones | Aceptada | Colisión de migraciones |
| 011 | `ecosystem.config.js` como fuente de verdad única del arranque | Aceptada | Instalación no reproducible |
| 012 | Portabilidad multi-VPS sin literales | Aceptada | Instalaciones múltiples |
| 013 | Fijar el contrato de cobro antes que las implementaciones | Aceptada | Prevención deliberada |
| 014 | El reconcile solo actúa sobre ONUs aprovisionadas por el ERP | **Aceptada con excepción** | Riesgo de migración |
| 015 | Bootstrap TR-069 por estrategia y decidido por modelo | Aceptada | El ME137 no materializa en EG8145V5 |
| 016 | Módulos degradables vs Core Indestructible | Aceptada | Resiliencia de arranque |
| **017–028** | **Decisiones pendientes** (ver Anexo A) | **Propuesta** | Desviaciones de POL-001 Anexo B |

---

# ADR-001 — Verificar la materialización, no solo la aceptación (VIO)

**Estado:** Aceptada · **Fecha:** 2026-07-17 · **Decide:** Arquitectura

## 1. Problema
El ERP reportaba operaciones de hardware como exitosas basándose únicamente en que el comando CLI
no devolviera error.

## 2. Contexto
Una ONU Huawei EG8145V5 aceptó sin error el comando OMCI del carril de gestión TR-069. La OLT lo
mostraba configurado. **El firmware nunca activó el IP-host**: cero tramas Ethernet emitidas,
confirmado con sniffer durante un cold-boot físico real. El ERP reportó "carril aplicado" durante
días con la gestión remota completamente muerta.

## 3. Alternativas

| Alternativa | Ventaja | Por qué se descartó |
|---|---|---|
| Confiar en el `success` del driver | Simple, rápido | **Es exactamente lo que falló** |
| Verificar solo en operaciones "importantes" | Menos coste | Nadie puede decidir a priori cuál es importante; la que falló no lo parecía |
| Verificar siempre con lectura independiente | Detecta el fallo real | **Elegida** — coste asumible con reintentos acotados |

## 4. Decisión
Toda operación mutante contra hardware externo tiene dos estados —**aceptada** y
**materializada**— y el segundo **nunca se deduce del primero**. Tras escribir se ejecuta un
comando de lectura independiente. Sin confirmación, **no se reporta éxito**: se reporta "aceptado,
sin confirmar".

## 5. Consecuencias
**Positivas:** desaparece la clase de fallo "el ERP cree que está aplicado". El operador recibe
información veraz.
**Negativas:** más latencia y más sesiones contra un equipo con VTY limitadas (mitigado con
reintentos acotados y backoff corto).
**Condiciona:** ADR-006 (VIO también al deshacer), ADR-015.

## 6. Estado
Aplicada en el plano FTTH. **Desviación conocida:** el plano MikroTik solo verifica *a
posteriori* (`/velocidad/discrepancias`). Cierre previsto en RDM-001 (R5).

---

# ADR-002 — Outbox transaccional con reclamo atómico

**Estado:** Aceptada · **Fecha:** 2026-07-28 · **Decide:** Arquitectura

## 1. Problema
Las operaciones de negocio que deben mutar la red (suspender, reactivar) podían perderse si el
hardware fallaba, o ejecutarse dos veces si dos procesos tomaban el mismo trabajo.

## 2. Contexto
El sistema corre el mismo binario como varios procesos PM2. El diseño previo usaba
`SELECT FOR UPDATE SKIP LOCKED` y un comentario afirmaba que *"dos instancias PM2 nunca toman el
mismo registro"*. **Era falso**: la transacción se cerraba antes de ejecutar contra el hardware,
así que la exclusión protegía la selección pero no la ejecución. Nadie lo verificó; lo verificó
producción, y lo salvó por casualidad un lock que existía por otra razón.

## 3. Alternativas

| Alternativa | Ventaja | Por qué se descartó |
|---|---|---|
| Llamar al hardware dentro de la transacción de negocio | Atomicidad aparente | Un fallo de red abortaría una operación comercial; y el timeout HTTP de 30 s la rompe |
| Cola Bull para las operaciones de red | Ya existe la infraestructura | **No es transaccional con el negocio**: el commit y el encolado pueden divergir |
| `FOR UPDATE SKIP LOCKED` | Estándar conocido | **Protege la selección, no la ejecución** |
| Outbox + reclamo atómico en una sentencia | Transaccional y exclusivo de verdad | **Elegida** |

## 4. Decisión
La intención de mutar la red se persiste en `comandos_red_pendientes` **en la misma transacción**
que el cambio de negocio. Un cron la drena reclamando con
`UPDATE ... SET estado='EN_PROCESO', dueno=:id, ttl=... WHERE estado='PENDIENTE' ... RETURNING *`
— **una sola sentencia**. Un segundo barrido recupera los claims expirados.

## 5. Consecuencias
**Positivas:** ninguna operación se pierde ni se duplica; sobrevive a reinicios; funciona con
varias instancias.
**Negativas:** **latencia mínima de 5 minutos** (barrido programado). Fue una de las dos causas de
los 287 s de REACTIVAR.
**Condiciona:** ADR-003 y ADR-004 (el drenador necesita clasificar resultados).

## 6. Estado
Verificado por `outbox-red.claim.spec.ts`. **Desviación:** las operaciones interactivas del
operador siguen siendo síncronas (RDM-001 R5).

---

# ADR-003 — Vocabulario de dominio en lugar de excepciones HTTP

**Estado:** Aceptada · **Fecha:** 2026-07-28 · **Decide:** Arquitectura

## 1. Problema
Los mismos métodos los consume un humano (controller HTTP) y una máquina (outbox). Los guards se
escribieron para el primero y expresaban su veredicto con excepciones de NestJS.

## 2. Contexto
Para un reintentador automático un `409` es ambiguo: puede significar "esto nunca va a funcionar"
o "vuelve en 5 minutos", y el status code no lo distingue. El outbox terminó haciendo
**arqueología sobre códigos HTTP**, y se equivocó dos veces.

## 3. Alternativas

| Alternativa | Ventaja | Por qué se descartó |
|---|---|---|
| Mantener excepciones HTTP y afinar el clasificador | Sin cambios de firma | La ambigüedad es del status code, no del clasificador |
| Códigos de error propios por módulo | Expresivo | Cada módulo inventaría los suyos; el orquestador tendría que conocerlos todos |
| Tipo de resultado de dominio común | Un solo vocabulario para toda máquina | **Elegida** |

## 4. Decisión
Todo método invocable por un orquestador devuelve `ResultadoOperacion` con seis clases:
`aplicado` · `ya_en_destino` · `no_aplica` · `rechazado_definitivo` · `reintentable` ·
`indeterminado`. **El transporte traduce en el borde**, nunca al revés.

**`indeterminado` es obligatorio ante un timeout contra hardware:** un timeout NO significa "no
pasó nada" — la operación pudo aplicarse y solo tardar más que el límite del cliente.

## 5. Consecuencias
**Positivas:** el orquestador decide sin interpretar; el operador recibe "aceptado, sin
confirmar" en lugar de un falso fallo.
**Negativas:** dos vocabularios conviven — el plano financiero sigue lanzando excepciones HTTP a
consumidores que a veces son máquinas.
**Condiciona:** ADR-004.

## 6. Estado
Verificado por `resultado-operacion.spec.ts`. Cobertura limitada al plano de red.

---

# ADR-004 — Solo 400 y 404 son rechazos definitivos

**Estado:** Aceptada · **Fecha:** 2026-07-28 · **Decide:** Arquitectura

## 1. Problema
El clasificador del outbox debía decidir qué resultados son definitivos y cuáles reintentables.

## 2. Contexto
Dos errores reales y opuestos:
- Un **no-op idempotente** se leyó como fallo → **1.788 reintentos contra el MA5800 en 4 días**.
- Un **409 de lock** se leyó como veredicto definitivo → **se descartó trabajo bueno**.

## 3. Alternativas

| Alternativa | Ventaja | Por qué se descartó |
|---|---|---|
| `status < 500` = definitivo | Simple y habitual | **Incorrecto**: 409/408/429 significan "vuelve luego" |
| Lista de reintentables | Explícito | La lista larga es la que se olvida de actualizar |
| **Lista corta de definitivos, resto reintentable** | El olvido cae del lado seguro | **Elegida** |

## 4. Decisión
La lista de rechazos definitivos es **explícita y corta: solo 400 y 404**. Todo lo demás es
reintentable. **Ante la duda: reintentable**, porque reintentar es recuperable y descartar no.
**PROHIBIDO inferir reintentabilidad de un código HTTP** en código nuevo: se usa
`ResultadoOperacion`.

## 5. Consecuencias
**Positivas:** el error por defecto es el recuperable. **Negativas:** un fallo permanente no
listado se reintentará hasta agotar intentos — mitigado con el evento `OUTBOX_RED_AGOTADO`.

## 6. Estado
Verificado por `contrato-adaptador.spec.ts` y `resultado-operacion.spec.ts`.

---

# ADR-005 — Máquina de estados declarativa con idempotencia derivada

**Estado:** Aceptada · **Fecha:** 2026-07-28 · **Decide:** Arquitectura

## 1. Problema
Los estados legales de cada operación FTTH vivían en arrays y condicionales sueltos en **13
sitios**. Nadie podía leer la máquina completa.

## 2. Contexto
**Por eso faltaba un estado de origen sin que nadie pudiera notarlo:** `desaprovisionar` no
aceptaba `suspendido`, que es el caso más frecuente del negocio (un moroso suspendido al que se
da de baja). Resultado: ONU huérfana en la OLT.

## 3. Alternativas

| Alternativa | Ventaja | Por qué se descartó |
|---|---|---|
| Revisar los 13 sitios y corregirlos | Rápido | Corrige el síntoma; el siguiente estado faltante volvería a ser invisible |
| Librería de máquinas de estados | Completa | Sobredimensionada; añade dependencia y curva de aprendizaje |
| Declaración propia en un archivo | Auditable en un PR | **Elegida** |

## 4. Decisión
Todo recurso con ciclo de vida contra hardware declara sus transiciones en **un solo archivo**.
**La idempotencia se DERIVA del estado destino**: si el recurso ya está en el destino, la
operación es `ya_en_destino` (éxito). Los guards consultan la máquina; no escriben su propio
array. Retirar un origen exige justificarlo.

## 5. Consecuencias
**Positivas:** un método nuevo no puede olvidarse de ser idempotente porque no es él quien lo
implementa. Lo que falta **se ve**.
**Negativas:** un cambio de transición requiere tocar el archivo central.

## 6. Estado
Aplicada en FTTH y **replicada voluntariamente** en `planta-externa`. Verificada por tests.
**Brecha:** el plano WISP no tiene máquina de estados.

---

# ADR-006 — Saga con bitácora write-ahead para wizards

**Estado:** Aceptada · **Fecha:** 2026-07-21 · **Decide:** Arquitectura

## 1. Problema
Un wizard de provisión FTTH cerrado a medias dejó la ONU registrada en la OLT **sin**
`ftth_onu_registro`, y una tarea async siguió corriendo contra un contrato sin registro.

## 2. Contexto
El cierre puede ser un crash del navegador, una caída de sesión o un corte de luz — casos en los
que **el navegador no puede avisar**. `beforeunload` no ejecuta trabajo asíncrono fiable.

## 3. Alternativas

| Alternativa | Ventaja | Por qué se descartó |
|---|---|---|
| `sendBeacon` al cerrar | Simple | Best-effort; **no existe justo en los casos que motivan la regla** |
| Transacción larga contra el hardware | Atomicidad | Imposible: el hardware no es transaccional |
| Registrar el paso **después** de ejecutarlo | Menos escrituras | Si el proceso muere entre ejecutar y registrar, **el huérfano renace** |
| **Bitácora write-ahead + barrido por TTL en servidor** | Sobrevive al crash | **Elegida** |

## 4. Decisión
Orden obligatorio: **escribir paso `en_vuelo` → ejecutar → marcar `aplicado`**. Cada paso guarda
**dos** cosas: cómo deshacerlo y **cómo verificar si llegó a aplicarse**. Un paso `en_vuelo` tras
el TTL es **sospechoso de haberse ejecutado**: se resuelve con su sonda.

Cuatro invariantes del compensador: **orden LIFO** · **parada al primer fallo no confirmado** ·
**idempotencia** ("does not exist" = éxito) · **VIO al deshacer**.

El heartbeat **suprime** el barrido, nunca lo autoriza, y tiene **techo absoluto**. **Anular es
asíncrono**: nunca se interrumpe el hardware a mitad.

## 5. Consecuencias
**Positivas:** un procedimiento interrumpido no deja residuos, pase lo que pase en el cliente.
**Negativas:** más escrituras; la anulación puede tardar hasta el siguiente barrido.

## 6. Estado
Implementada en el wizard FTTH. El wizard VPN usa un mecanismo distinto (revocación + cron): dos
implementaciones del mismo concepto.

---

# ADR-007 — La frontera transaccional es el estado terminal, no el clic

**Estado:** Aceptada · **Fecha:** 2026-07-21 · **Decide:** Arquitectura

## 1. Problema
Definir cuándo un procedimiento está confirmado y, por tanto, deja de anularse al cerrarse.

## 2. Contexto
La regla "lo no terminado se anula" necesita una frontera. La opción intuitiva es el clic en
"Finalizar".

## 3. Alternativas

| Alternativa | Ventaja | Por qué se descartó |
|---|---|---|
| **El clic del operador** | Intuitivo | **Dos razones fatales**: (1) es inalcanzable justo en los peores casos —crash, caída de sesión, corte de luz— que son los que motivan la regla; *una frontera que no existe en el caso que la justifica no es una frontera*. (2) Convertiría la regla en **fábrica de cortes de servicio**: provisión correcta → cliente navegando → crash → el ERP desaprovisiona a un cliente en producción |
| Un temporizador fijo | Simple | Arbitrario respecto al estado real |
| **Estado terminal verificado** | Coincide con la realidad física | **Elegida** |

## 4. Decisión
Un procedimiento está confirmado cuando su recurso alcanza el **estado terminal de su máquina de
estados con verificación VIO** (en FTTH: `activo`). Todo lo anterior es trabajo en vuelo y se
anula al cerrar. **Lo confirmado jamás se anula por un cierre**: para deshacerlo existe la
desaprovisión formal, que pide confirmación y queda auditada.

El botón "Finalizar" sigue existiendo como acto de UX y auditoría, **nunca como acto
transaccional**.

## 5. Consecuencias
**Positivas:** el caso objetivo queda cubierto al 100 % (si el procedimiento falló y el operador
cierra, el recurso está en estado no terminal y se anula completo) sin crear el riesgo opuesto.
**Negativas:** el operador puede cerrar sobre un servicio ya activo y no pasa nada — lo cual es
correcto pero puede sorprender.

## 6. Estado
Aceptada. Cableada de extremo a extremo (`useProcedimientoWizard` en el frontend).

---

# ADR-008 — Un solo worker uvicorn para el servicio de OLT

**Estado:** Aceptada · **Fecha:** 2026-07-21 · **Decide:** Ingeniería de red

## 1. Problema
Dimensionar la concurrencia del servicio que habla con las OLTs.

## 2. Contexto
**El MA5800 tiene un límite bajo de sesiones VTY concurrentes.** Cada worker uvicorn abre sus
propias sesiones SSH. Además, un episodio con `--reload` activo: WatchFiles reinició uvicorn
cuando un `git reset --hard` de despliegue tocó archivos **en medio de una Fase 2 WAN**, causando
el timeout que dejó un ONT huérfano.

## 3. Alternativas

| Alternativa | Ventaja | Por qué se descartó |
|---|---|---|
| Varios workers | Paralelismo | **Chocaría con el límite físico del MA5800** |
| Varios workers con semáforo compartido | Paralelismo controlado | Complejidad sin ganancia: el límite sigue siendo el mismo |
| **1 worker + pool de sesiones** | Respeta el límite físico | **Elegida** |

## 4. Decisión
`--workers 1`, pool de sesiones SSH reutilizadas y **prohibición absoluta de `--reload` en
producción**.

## 5. Consecuencias
**Positivas:** nunca se supera el límite del equipo; comportamiento predecible.
**Negativas:** **toda operación OLT del sistema está serializada por este proceso** — es el cuello
de botella estructural del plano de red.
**Condiciona:** el escalado del plano OLT no puede hacerse por más workers.

## 6. Estado
Aceptada y documentada en `ecosystem.config.js`. **Sin encolado explícito ni medición de la cola**
(RDM-001 R8, R11).

---

# ADR-009 — Chromium aislado en su propio proceso PM2

**Estado:** Aceptada · **Fecha:** 2026-07-30 · **Decide:** Operaciones

## 1. Problema
`whatsapp-web.js` requiere Chromium, que consume memoria de forma impredecible.

## 2. Contexto
Chromium se alojaba en el proceso worker (por derivar el host de `RUN_CRONS`). **El VPS llegó a
87 MB libres**, con el worker —que corre el outbox de red y la cobranza— en riesgo de ser matado
por PM2 por memoria.

## 3. Alternativas

| Alternativa | Ventaja | Por qué se descartó |
|---|---|---|
| Subir el límite de memoria del worker | Inmediato | El VPS tiene ~1,9 GB; no hay memoria que subir |
| Renunciar al CRM nativo | Elimina el problema | Es funcionalidad en uso |
| **Proceso PM2 dedicado** | Muere solo | **Elegida** |

## 4. Decisión
`datafast-whatsapp` es el **único** proceso con `WA_ENABLED=true`. Nginx le enruta solo
`/api/v1/crm-nativo/` y `/wa-socket/`. Límite 600 MB.

## 5. Consecuencias
**Positivas:** si Chromium se descontrola muere solo, sin arrastrar la API ni el outbox.
**Negativas:** un proceso más en un VPS con memoria justa (límites PM2 suman 3,17 GB sobre
~1,9 GB).

## 6. Estado
Aceptada. Sienta el precedente de segmentación por criticidad que RDM-001 (R2) propone extender.

---

# ADR-010 — Solo `api-core` ejecuta migraciones

**Estado:** Aceptada · **Fecha:** 2026-07-21 · **Decide:** Arquitectura

## 1. Problema
El mismo `dist/main.js` corre como `api-core` y como `worker-auxiliary`. Al reiniciar juntos,
**ambos ejecutaban las migraciones a la vez y competían**.

## 2. Contexto
Visto con la migración `CreateFtthOperacionLock`: `duplicate key ... pg_type_typname_nsp_index` —
uno creó la tabla y el otro chocó. Fue inofensivo por ser idempotente, **pero una migración menos
defensiva puede dejar el esquema a medias**.

## 3. Alternativas

| Alternativa | Ventaja | Por qué se descartó |
|---|---|---|
| Migraciones idempotentes siempre | No requiere coordinación | Depende de la disciplina en cada migración |
| Lock de aplicación | Estándar | Complejidad adicional para un problema con solución trivial |
| **Variable de entorno por proceso** | Trivial y explícito | **Elegida** |

## 4. Decisión
`RUN_MIGRATIONS` decide quién migra. `api-core` = `true`, worker = `false`. **El default es
`true` a propósito** (retrocompatible): un VPS que aún no declare la variable se comporta como
hasta ahora.

## 5. Consecuencias
**Positivas:** una sola ejecución; el arranque del worker es más rápido.
**Negativas:** si `api-core` no arranca, el esquema no avanza.

## 6. Estado
Aceptada. Ver ADR-011 para el incidente relacionado (despliegue que no recargaba nada mientras
las migraciones sí corrían).

---

# ADR-011 — `ecosystem.config.js` como fuente de verdad única del arranque

**Estado:** Aceptada · **Fecha:** 2026-07-22 · **Decide:** Operaciones

## 1. Problema
La configuración de arranque estaba repartida en tres archivos, **uno de ellos sin versionar**.

## 2. Contexto
Lo que realmente corría **no coincidía con lo declarado en el repositorio**: una instalación nueva
no era reproducible. De ahí salió, entre otras cosas, el `--reload` de uvicorn en producción.

Incidente posterior relacionado (2026-08-06): `scripts/update.sh` recargaba
`--only datafast-backend`, un proceso que **ya no existe**. PM2 no fallaba de forma detectable y
el script imprimía «Backend recargado». **Las migraciones sí corrían**, así que el esquema
avanzaba y el código no, durante 11 horas.

## 3. Alternativas

| Alternativa | Ventaja | Por qué se descartó |
|---|---|---|
| Documentar los comandos `pm2 start` | Flexible | Es la situación que falló |
| Contenerizar todo y usar solo Compose | Reproducible | Migración grande; Chromium y SSH complican |
| **Un ecosystem versionado + prohibición de arranque manual** | Reproducible ya | **Elegida** |

## 4. Decisión
Todo cambio de arranque se hace en `ecosystem.config.js` y se despliega. **PROHIBIDO `pm2 start`
manual.** Prohibido poner IPs, dominios o secretos: PM2 solo declara lo que **distingue** a cada
proceso (rol, puerto, límites).

**Regla derivada del incidente:** *"una verificación que solo sabe confirmar el caso bueno no es
una verificación"* — el despliegue debe detectar también el proceso en bucle de reinicio, no solo
el uptime.

## 5. Consecuencias
**Positivas:** instalación reproducible; el archivo documenta **por qué** cada decisión.
**Negativas:** cambiar un parámetro exige desplegar.

## 6. Estado
Aceptada.

---

# ADR-012 — Portabilidad multi-VPS sin literales

**Estado:** Aceptada · **Fecha:** 2026-07-22 · **Decide:** Arquitectura

## 1. Problema
El ERP se instala en múltiples VPS con IPs y dominios distintos.

## 2. Contexto
Además: hasta 2026-07-22 el proceso del frontend arrastraba **todos los secretos del backend**
por haberse lanzado desde una shell con el `.env` del backend cargado. El frontend es el proceso
**expuesto** y no necesita ninguno.

## 3. Alternativas

| Alternativa | Ventaja | Por qué se descartó |
|---|---|---|
| Un fichero de config por instalación en el repo | Explícito | Los secretos acabarían versionados |
| Constantes de módulo desde `process.env` | Directo | **Se evalúan antes de que `ConfigModule` lea el `.env`** |
| **Variables + lazy getters + `.env.example` como contrato** | Portable y seguro | **Elegida** |

## 4. Decisión
Ningún archivo del repositorio contiene IPs, dominios ni secretos. Las constantes de módulo que
lean `process.env` son **funciones**. `.env.example` documenta cada variable. El frontend recibe
un entorno **mínimo y explícito**.

**Ningún dominio es obligatorio:** servirse por IP, en LAN o con tres dominios son el caso normal.
`ERP_DOMAIN` cae en `APP_DOMAIN` si no está definido — **renombrar una variable sin periodo de
gracia rompe toda instalación existente** en su próxima actualización. Sin `WEB_DOMAIN`, el vhost
queda con un `server_name` inalcanzable en lugar de desaparecer: *un vhost que nadie resuelve es
inofensivo*.

## 5. Consecuencias
**Positivas:** una instalación nueva no requiere tocar código; la superficie de secretos del
proceso expuesto es cero.
**Negativas:** más variables que documentar y mantener.

## 6. Estado
Aceptada e implementada. **Desviación:** hay configuración fuera del repositorio (credenciales de
GenieACS, CCD, crontab) — RDM-001 (R15).

---

# ADR-013 — Fijar el contrato de cobro antes que las implementaciones

**Estado:** Aceptada · **Fecha:** 2026-08-06 · **Decide:** Arquitectura + Producto

## 1. Problema
Integrar pasarelas de pago adicionales (Niubiz, Izipay, Culqi, Stripe, POS, QR).

## 2. Contexto
Hoy solo Mercado Pago cobra dinero real, y **no** pasa por ninguna abstracción. Además, tres
errores ya ocurridos en esta frontera: un segundo servicio registrando pagos; **cuatro copias**
del `UPDATE` que aplica dinero (una había perdido el guard y aplicaba saldo a favor contra
facturas **anuladas**); e inferir reintentabilidad de un código HTTP.

## 3. Alternativas

| Alternativa | Ventaja | Por qué se descartó |
|---|---|---|
| Integrar la primera pasarela y abstraer después | Entrega valor antes | **La primera integración definiría el contrato de facto** y las demás se acomodarían a sus peculiaridades |
| Contrato + implementaciones ya | Completo | La frontera del dinero **aún no está demostrada en producción** |
| **Contrato ahora, implementaciones tras una puerta de estabilidad** | Evita cimentar sobre base no probada | **Elegida** |

## 4. Decisión
El contrato (`adaptador-cobro.interface.ts`) se fija ya, **sin implementaciones**. Se abre una
**puerta de estabilidad**: 30 días de invariante de contabilidad limpio en producción, un extorno
real revisado a mano y un cierre de caja mensual cuadrado. **Dos de los tres criterios no dependen
de escribir código.**

Orden obligatorio: comprobar la puerta → construir el motor de cobro (`cobro_intento` +
conciliador) → **migrar Mercado Pago al contrato antes que ningún proveedor nuevo**.

**Regla que se olvida siempre:** un timeout cobrando **no** significa "no pasó nada". Reintentar a
ciegas cobra dos veces; reportar fallo deja dinero sin registro. **Las dos opciones que parecen
simples son las dos incorrectas**: se reporta `indeterminado` y lo resuelve el conciliador.

## 5. Consecuencias
**Positivas:** la abstracción no nace deformada por un proveedor. **Negativas:** el ERP no puede
ofrecer más medios de cobro en línea hasta pasar la puerta.

## 6. Estado
Aceptada. Documentada en `pagos/adaptadores/README.md`. **Pendiente:** Mercado Pago aún no usa el
contrato (RDM-001 R11).

---

# ADR-014 — El reconcile solo actúa sobre ONUs aprovisionadas por el ERP

**Estado:** **Aceptada** (implementada 2026-08-06) · **Fecha:** 2026-08-06 · **Decide:** Arquitectura

## 1. Problema
El pipeline ZTP reescribe SSID, clave WiFi y credenciales de acceso web de toda ONU en drift. En
una migración eso no afecta a una ONU: afecta a **todas a la vez, sin que nadie lo pida**.

## 2. Contexto

**Son dos los barridos, y el peligroso no es el nocturno** (corregido al implementar; la
documentación previa señalaba solo el de las 03:30):

| Barrido | Frecuencia | Filtro |
|---|---|---|
| `ztp.reconcile()` | 03:30 | `provisioning_enabled AND (rev NULL OR rev < revision)` |
| **`ztp.reconcilePendingReinjection()`** | **cada 2 min** | `provisioning_enabled AND rev IS NULL` |

Una ONU recién migrada tiene exactamente `last_applied_revision IS NULL`: **la captura el watcher
de dos minutos**. La ventana de exposición no es "hasta la madrugada siguiente": son dos minutos.

Hay 205 ONUs en la OLT del nodo y **dos migraciones planificadas** (SmartOLT, MikroWISP). Son
clientes reales con años de configuración propia, muchos con su propia clave WiFi.

Antes de esta decisión el sistema estaba a salvo **por composición de tres decisiones
independientes**, ninguna de las cuales expresaba la regla:

1. `_nuevo()` crea siempre con `provisioning_enabled = false, revision = 0`.
2. `adoptarOnusHuerfanas` inserta solo en `ftth_onu_registro`; no crea `contrato_onu_config`.
3. El único camino automático a `provisioning_enabled = true` es el preset, invocado solo desde la provisión FTTH del propio ERP.

Un script de migración que hiciera `upsert()` + `setProvisioningEnabled(true)` —lo natural para
"dejar la ficha lista"— anulaba las tres a la vez.

## 3. Alternativas

| Alternativa | Ventaja | Por qué se descartó |
|---|---|---|
| Confiar en el efecto lateral actual | Coste cero | **Es un efecto lateral, no una regla**: quien "complete" el registro creando la config detona la mina |
| Desactivar el reconcile | Elimina el riesgo | Elimina también su función legítima sobre las ONUs del ERP |
| Filtrar por origen explícito + pre-flight obligatorio | Seguro y auditable | **Elegida** |

## 4. Decisión
`contrato_onu_config.origen` (`erp` | `adoptada` | `migrada`) declara quién trajo la ONU al ERP.
**El auto-config solo actúa sobre `origen = 'erp'`.** Una ONU que el ERP no aprovisionó se observa
y se respeta; su SSID y su clave son del abonado.

El guard está en el **filtro** de los dos barridos, no en el cuerpo del bucle: lo que importa no
es qué se hace con las filas, sino cuáles se seleccionan.

Sobrescribir la config de una ONU ajena sigue siendo posible —puede ser una decisión legítima—
pero **nunca por omisión**: exige `sobrescribirConfigAjena: true`, que quien lo haga tiene que
escribir.

Toda migración ejecuta el pre-flight (`preflightMigracion`), que devuelve `seguro: false` —no un
aviso— si alguna ONU ajena entraría en el barrido.

## 5. Consecuencias
**Positivas:** las migraciones dejan de ser un acto de fe. La regla es explícita, está en un solo
sitio y tiene test.
**Negativas:** las ONUs migradas quedan fuera del gobierno de configuración del ERP hasta que se
decida adoptarlas explícitamente — lo cual es **correcto** (implementación desde cero: respetar lo
preexistente).
**Coste:** un origen mal declarado en una migración reintroduce el riesgo. Por eso el pre-flight
es obligatorio **después** de la migración, no solo antes.

## 6. Estado

**Aceptada e implementada — 2026-08-06.** Cierra la desviación **A-2** de POL-001 Anexo B.

| Elemento | Dónde |
|---|---|
| Migración | `1791800000045-AddOrigenAContratoOnuConfig.ts` — columna + CHECK + índice del pre-flight |
| Entidad | `contrato-onu-config.entity.ts` — `origen`, con `type` explícito (regla SWC) |
| Guard en `reconcile()` | `ztp.service.ts` — `andWhere("c.origen = 'erp'")` |
| Guard en `reconcilePendingReinjection()` | `ztp.service.ts` — ídem |
| Guard en la ruta manual | `provisionContract` — `sobrescribirConfigAjena` |
| Constructor por defecto | `_nuevo()` — `origen: 'erp'`, con la razón escrita |
| Pre-flight | `ContratoOnuConfigService.preflightMigracion` + `GET /olt-nativo/ztp/preflight-migracion` |
| Tests | `ztp.service.reconcile.spec.ts` — 4 casos que nombran el riesgo (10/10 en verde) |

**Verificación:** `tsc --noEmit` sin errores · suite del módulo 10/10.
**Pendiente de despliegue:** la migración aún no se ha ejecutado en producción.

---

# ADR-015 — Bootstrap TR-069 por estrategia y decidido por modelo

**Estado:** Aceptada · **Fecha:** 2026-07-29 · **Decide:** Ingeniería de red

## 1. Problema
Escribir la ACS URL en el CPE para poder gestionarlo por TR-069.

## 2. Contexto
Se verificó que en la EG8145V5 (firmware V5R020C10S195) el **ME137 (OMCI) no materializa la ACS
URL**, mientras que `dhcp_bootstrap` (WAN de gestión por DHCP + Option 43) **sí converge**.

El 2026-07-29 se completó el procedimiento oficial de Huawei que faltaba y se intentó promover
OMCI a CERTIFIED. **Se revirtió.** De ahí una lección metodológica registrada:

> *"Una prueba de bootstrap sobre un equipo que YA tiene la configuración que se quiere ver
> aparecer **no prueba nada**, y su falso positivo es más caro que un falso negativo."*

## 3. Alternativas

| Alternativa | Ventaja | Por qué se descartó |
|---|---|---|
| Depender globalmente de Option 43 | Funciona hoy | **Ata el diseño a Huawei + un DHCP por VLAN** |
| Depender globalmente de OMCI | Es el estándar GPON | **No materializa en el firmware desplegado** |
| Nombrar los canales por tecnología | Directo | El día que ZTE use Option 125 habría que renombrar todo |
| **Canales como estrategias + catálogo por modelo** | Neutral a la tecnología | **Elegida** |

## 4. Decisión
Un canal representa una **estrategia** de bootstrap, no una tecnología: `omci_management_server`,
`dhcp_bootstrap` (Option 43 / 125 / vendor-specific), `cpe_local`. **La decisión de canal es POR
MODELO**, nunca una dependencia global.

El resolver **nunca confía en el `success` del canal**: verifica convergencia real contra
GenieACS (VIO). Un modelo no catalogado produce `CPE_MODEL_NOT_SUPPORTED`, **jamás un intento a
ciegas**.

## 5. Consecuencias
**Positivas:** añadir un fabricante es añadir una entrada al catálogo. **Negativas:** hay que
certificar modelo por modelo, con hardware físico.
**Condiciona:** el objetivo abierto de lograr la ACS URL por OMCI sigue vigente — Option 43 ata el
diseño a Huawei + un DHCP por VLAN.

## 6. Estado
Aceptada. `dhcp_bootstrap` CERTIFIED, `omci` EXPERIMENTAL para la EG8145V5.

---

# ADR-016 — Módulos degradables frente al Core Indestructible

**Estado:** Aceptada · **Fecha:** 2026-07-15 · **Decide:** Arquitectura

## 1. Problema
Qué debe ocurrir cuando un módulo no puede alcanzar su dependencia externa al arrancar.

## 2. Contexto
El ERP depende de hardware y de servicios de terceros que pueden estar caídos. Pero también tiene
un núcleo cuyo fallo hace inútil —y peligroso— seguir en pie: un backend que arranca con
`pagos` roto puede aceptar operaciones que no registrará.

## 3. Alternativas

| Alternativa | Ventaja | Por qué se descartó |
|---|---|---|
| Que todo módulo tolere fallos | Nunca cae | **Un núcleo a medias es peor que un backend caído** |
| Que cualquier fallo tumbe el backend | Simple | Un proveedor IPTV caído impediría facturar |
| **Clasificación explícita módulo por módulo** | Cada uno se comporta según su naturaleza | **Elegida** |

## 4. Decisión
Todo módulo declara, **el día que se crea**, si es degradable o Core Indestructible.

- **Degradable:** `OnModuleInit` + probe ligero + `ModuleHealthService.registrar(...)` + `assertNotDegraded()`. **Nunca relanzar la excepción del probe** — eso crashearía el backend.
- **Core Indestructible** (15 módulos): si falla en init, **el backend debe crashear**, para que PM2 conserve vivo el proceso anterior.

## 5. Consecuencias
**Positivas:** un proveedor caído no impide operar; un núcleo roto no finge funcionar. El estado
es consultable en `GET /health/modules` con su razón.
**Negativas:** la clasificación debe decidirse conscientemente y no hay mecanismo que la exija.

## 6. Estado
Aceptada. **Brecha:** los endpoints de salud son consultables, **no vigilantes** — RDM-001 (R2).

---

# 9. Referencias

CON-001 · POL-001 · ARS-001 · INT-001 · RDM-001 · `CLAUDE.md` ·
`pagos/adaptadores/README.md` · `ecosystem.config.js` ·
`olt-nativo/interfaces/olt-provider.interface.ts` ·
`olt-nativo/capability/cpe-provisioning-catalog.ts` ·
`docs/informe-cnt-2026-000004-omci-tr069-write-gap.md`

---

# 10. Anexos

## Anexo A — ADR propuestos (017–028)

Decisiones **aún no tomadas** que deben registrarse antes de implementarse. Cada una tiene número
reservado para que las desviaciones de POL-001 Anexo B puedan citarla.

**Estado de todas: Propuesta.**

| ADR | Decisión pendiente | Cierra | Prioridad |
|---|---|---|---|
| **ADR-017** | **Mecanismo de aislamiento multi-tenant**: Row-Level Security en PostgreSQL frente a barrido en CI, o ambos | Desviación **A-1** · RDM-001 R3 | **Crítica** |
| **ADR-018** | **Estrategia de adopción del tipado estricto**: global, por archivo nuevo, por opción o por módulo (ver EST-001 Anexo B.1) | Desviación **B-1** | Alta |
| **ADR-019** | **Destino único del cálculo de deuda**: función de base de datos o servicio de dominio. Criterio: si algún escritor no pasa por la aplicación, va en la base | Desviación **A-4** · RDM-001 R4 | **Crítica** |
| **ADR-020** | **Segregación del plano automático por criticidad** y mecanismo de alarma del latido | Desviación **A-3** · RDM-001 R2 | **Crítica** |
| **ADR-021** | **Puerto único hacia MikroTik** (`IRouterProvider`) y máquina de estados del servicio WISP | Desviación **B-5** · RDM-001 R5 | Alta |
| **ADR-022** | **Modelado de la sustitución de ONU** como transición de primera clase | Desviación **B-7** · RDM-001 R6 | Alta |
| **ADR-023** | **Particionado y retención de series temporales** | Desviación **C-7** · RDM-001 H3-1 | Media |
| **ADR-024** | **Stack de observabilidad** y qué se instrumenta primero | RDM-001 R8 | Alta |
| **ADR-025** | **Cobertura del permiso fino**: alcance retroactivo y regla de CI | Desviación **B-3** | Media |
| **ADR-026** | **Entidades para las tablas de coordinación y de dinero** | Desviación **B-2** · RDM-001 R7 | Alta |
| **ADR-027** | **Contrato de proceso de fondo**: cap, lock, presupuesto y latido obligatorios | Desviación **B-6** · RDM-001 R10 | Media |
| **ADR-028** | **Outbox también para las operaciones interactivas del operador** | Desviación **B-4** · RDM-001 R5 | Alta |

### Decisiones tomadas de hecho, sin ADR

Están vigentes y sostienen el sistema, pero nunca se registraron con sus alternativas. **Se
recomienda registrarlas retroactivamente la próxima vez que se toquen:**

| Tema | Por qué merece ADR |
|---|---|
| **Lógica de negocio en triggers de PostgreSQL** (saldo de factura, contador de IPs, ocupación de NAP) | Es una decisión con coste real: esas reglas no son visibles desde el código ni aparecen en ningún test de NestJS. La justificación existe (un `UPDATE` manual no puede saltárselas) pero no está registrada |
| **Modelo de acceso híbrido** (repositorio en 6 módulos + `Repository<T>` + 445 consultas crudas) | Convive con tres regímenes sin criterio escrito de cuándo usar cada uno |
| **Bus de eventos in-process** con listeners que solo encolan | Es una restricción fuerte (un evento no cruza procesos) que hoy solo se conoce leyendo el código |
| **`TimeoutInterceptor` global de 30 s** frente a operaciones de hardware de 90–150 s | Determina que toda operación de hardware deba ser asíncrona; no está registrado como decisión |

## Anexo B — Decisiones revertidas

| Decisión | Fecha | Motivo de la reversión |
|---|---|---|
| Promover el canal OMCI a CERTIFIED para EG8145V5 | 2026-07-29 | La prueba se hizo sobre un equipo que ya tenía la configuración buscada: **falso positivo** |
| `--reload` de uvicorn en producción | 2026-07-21 | Un `git reset --hard` de despliegue lo disparó en medio de una operación contra la OLT |
| Chromium en el proceso worker | 2026-07-30 | VPS con 87 MB libres |
| `SELECT FOR UPDATE SKIP LOCKED` como exclusión del outbox | 2026-07-28 | Protegía la selección, no la ejecución |
