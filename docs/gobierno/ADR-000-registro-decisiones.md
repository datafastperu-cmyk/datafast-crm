# ADR — Registro de Decisiones Arquitectónicas

---

## 2. Control documental

| Campo | Valor |
|---|---|
| **Código** | ADR-000 (índice) + **19 aceptados** (001–016, 019, 020, 030; 029 parcial) + **10 propuestos** (017–018, 021–028) · **Versión** 1.2 · **Estado** Vigente |
| **Autor** | Arquitectura — reconstruido desde el código, los comentarios de diseño y los incidentes |
| **Revisores** | Pendientes de asignar · **Fecha** 2026-08-06 |

## 3. Historial de cambios

| Versión | Fecha | Cambio | Motivo |
|---|---|---|---|
| 1.0 | 2026-08-06 | Emisión inicial con 16 ADR retroactivos | Las decisiones estaban tomadas y bien justificadas, pero dispersas en comentarios. Sin registro, la próxima persona no puede saber **qué se descartó y por qué** |
| 1.1 | 2026-08-06 | ADR-014 pasa a **Aceptada** (implementado). Se reservan ADR-017…028 y se redacta **ADR-029 — Marco normativo externo de referencia** | ADR-014: cerrada la desviación A-2. ADR-029: se detectó que el cuerpo normativo **no declara filiación con ningún estándar externo** y que nunca se evaluó conformidad — el error que R-001/R-004 previenen, cometido sobre los propios documentos de gobierno |
| **1.2** | **2026-08-08** | **ADR-020 y ADR-019 pasan de propuestos a aceptados**, cada uno en fichero propio. ADR-027 hereda de ADR-020 la segregación del worker por criticidad y sube de prioridad Media a Alta | Fases 3.1 y 3.2 de PLAN-001. Dos de las tres desviaciones críticas cerradas en dos días; queda **A-1** (aislamiento multi-tenant, ADR-017) |

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
| 014 | El reconcile solo actúa sobre ONUs aprovisionadas por el ERP | Aceptada (implementada 2026-08-06) | Riesgo de migración |
| 015 | Bootstrap TR-069 por estrategia y decidido por modelo | Aceptada | El ME137 no materializa en EG8145V5 |
| 016 | Módulos degradables vs Core Indestructible | Aceptada | Resiliencia de arranque |
| **017** | RLS no es hoy un mecanismo de aislamiento: primero hay que poder aplicarla ([fichero propio](ADR-017-aislamiento-multi-tenant.md)) | **Aceptada** (2026-08-08) — **A-1 sigue parcialmente abierta** | La app es superusuario: RLS seria inerte |
| **019** | La deuda se calcula en un servicio de dominio, no en la base ([fichero propio](ADR-019-destino-del-calculo-de-deuda.md)) | **Aceptada** (implementada 2026-08-08) | 4 cálculos; uno reactivaba morosos |
| **020** | El latido se deriva del registro y lo vigila el proceso que responde ([fichero propio](ADR-020-latido-vigilado.md)) | **Aceptada** (implementada 2026-08-07) | De 47 crons latían 10 |
| **018 · 021–028** | **Decisiones pendientes** (ver Anexo A) | **Propuesta** | Desviaciones de POL-001 Anexo B |
| **029** | Marco normativo externo de referencia | **Aceptada parcialmente** (D3, 2026-08-06) | Certificación descartada · adopción selectiva aceptada · programa legal suspendido con excepción |
| **030** | Referencia por tipo de módulo (incluye TM Forum) | **Aceptada** (D4, 2026-08-06) — pendiente de reescritura | ¿Cada módulo desde 0? |

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

# ADR-029 — Marco normativo externo de referencia

**Estado:** **Aceptada parcialmente** — 2026-08-06, Datafast
**Fecha:** 2026-08-06 · **Decide:** Datafast (decisión D3, PLAN-001 §5)

## 1. Problema

El cuerpo normativo del ERP (21 documentos) **no declara filiación con ningún estándar externo**,
y **nunca se ha evaluado si el sistema conforma con alguno**.

Dos preguntas que hoy no se pueden responder:

| Pregunta | Respuesta actual |
|---|---|
| ¿Nuestras políticas siguen algún marco reconocido? | **No se sabe. Cero referencias** en los 21 documentos |
| ¿El sistema cumple normativas internacionales? | **No se sabe. Nunca se auditó contra ninguna** |

Afirmar cualquiera de las dos sin haberlo comprobado sería exactamente el tipo de aserción sin
verificar que este cuerpo normativo existe para impedir.

## 2. Contexto

### 2.1 Lo medido

Búsqueda sobre los 21 documentos de gobierno, la auditoría, la consolidación y las directrices:
**una sola referencia real** — "OWASP Top 10", heredada de `CLAUDE.md` como estándar de código y
**nunca verificada**. Ninguna a ISO, TOGAF, ITIL, COBIT, NIST ni ISO 27001.

### 2.2 El matiz: las prácticas sí son estándar, sin declararlo

| Práctica usada | Origen no citado |
|---|---|
| Vistas C4 (Contexto / Contenedores / Componentes) | Simon Brown |
| Formato de ADR (problema · contexto · alternativas · decisión · consecuencias) | Michael Nygard |
| DOM-001 completo: lenguaje ubicuo, contextos delimitados, agregados, objetos de valor, eventos de dominio | **Domain-Driven Design** |
| `IOltProvider` y los adaptadores | Ports & Adapters (hexagonal) |
| Outbox, Saga con compensación, Circuit Breaker | Catálogos de patrones establecidos |
| Estructura documental (control, historial, alcance, glosario, referencias, anexos) | Estilo de documentación técnica ISO |

**No se inventó el método. Lo que falta es declarar la filiación y comprobar conformidad**, que
son cosas distintas de usar la práctica.

### 2.3 La observación que motiva este ADR

El gobierno de arquitectura es un **dominio maduro**: la industria lo resolvió y lo estandarizó
hace décadas. Construir un cuerpo normativo desde cero sin hacer benchmark es **precisamente el
error que R-001 y R-004 previenen** (REC-001 §8.2), cometido sobre los documentos que los recogen.

Aplicando la clasificación de REC-001 §8.2.5, "gobierno de arquitectura" caería en **Maduro**, y
R-004 exigiría un ADR de benchmark **antes** de diseñarlo. Este ADR es ese benchmark, hecho tarde.

### 2.4 Evaluación indicativa — **no es una certificación**

Basada solo en lo que la auditoría midió. **No se ha hecho gap analysis formal contra ninguna
norma.**

| Norma | Qué exige | Indicio |
|---|---|---|
| **ISO/IEC 25010** — calidad de producto | 8 características | **Fiabilidad y portabilidad: fuertes.** Eficiencia: **no evaluable, no hay medición**. Mantenibilidad: desigual. Seguridad: con brechas |
| **ISO/IEC 42010** — descripción de arquitectura | Stakeholders, concerns, viewpoints, vistas | **Cerca sin proponérselo.** AEM/ARS/DOM/DAT/INT/SEC funcionan como viewpoints. Faltan stakeholders y concerns declarados |
| **ISO/IEC 27001** — SGSI | Inventario de activos, riesgos, tratamiento, revisión de accesos, incidentes, proveedores, datos personales | **Lejos.** Hay controles técnicos (cifrado, RBAC, auditoría) pero **no hay sistema de gestión**: sin ownership, sin revisión de accesos, sin modelo de riesgos vivo, **sin política de datos personales** |
| **ITIL / ISO 20000** — gestión de servicios | Incidentes, problemas, cambios, releases, capacidad, continuidad | **Parcial.** PRO-001 cubre release, backup y recuperación. Faltan gestión formal de incidentes y problemas, SLA y gestión de capacidad |
| **TOGAF** | Ciclo ADM, repositorio, planificación por capacidades | **Parcial.** Existen las cuatro arquitecturas; falta el ciclo formal y la planificación por capacidades (R-007) |
| **COBIT** | Roles, responsabilidad, métricas | **Brecha central: R-009.** 21 documentos con *"Revisores: pendientes de asignar"* |
| **OWASP Top 10 / ASVS** | Verificación de seguridad aplicativa | **Nunca verificado.** Lo medido apunta a **A01 Broken Access Control** (aislamiento multi-tenant por convención; permiso fino en 4 de 44 módulos) y **A06** (sin auditoría de dependencias) |

### 2.5 Lo urgente no es ISO — es lo legal

**Requiere verificación con especialista legal peruano; el arquitecto no es la fuente autorizada
en esto.**

| Obligación | Estado medido | Gravedad |
|---|---|---|
| **Ley 29733 — Protección de Datos Personales** | El ERP guarda documento de identidad, dirección, **coordenadas GPS del domicilio**, foto, **conversaciones de WhatsApp**, dispositivos conectados en la vivienda y claves WiFi del abonado. **Cero políticas de datos personales** en los 21 documentos: sin plazos de retención, sin supresión al dar de baja, sin anonimización en respaldos ni en entornos de prueba | **Alta** |
| **SUNAT — comprobantes electrónicos** | **No implementado.** Hay página en la interfaz y no hay backend: ni firma XML, ni OSE, ni CDR | **Alta** |
| **OSIPTEL — obligaciones del operador** | **Desconocido.** No se dispone del detalle vigente y **no se infiere** | **Verificar** |

## 3. Alternativas

| # | Alternativa | Ventaja | Coste / por qué se descarta |
|---|---|---|---|
| **A** | **No adoptar ninguna norma externa** (mantener el statu quo) | Coste cero. El cuerpo normativo ya funciona y es coherente | No es citable ante un tercero, no es auditable, y **repite trabajo que la industria ya hizo** — el error de R-001 |
| **B** | **Certificación formal** (ISO 27001 y/o 9001) | Reconocimiento externo; exigible en licitaciones y contratos corporativos | **Desproporcionado para un ISP regional.** Exige un SGSI completo, auditorías periódicas y coste recurrente. Con 3 desviaciones de nivel A abiertas, certificar sería certificar un estado que sabemos incompleto |
| **C** | **Adopción selectiva declarada, sin certificar** — tomar de ISO/IEC 42010, ISO/IEC 25010, COBIT y OWASP ASVS lo que aporte; declarar filiación; gap analysis acotado | Barato. Aprovecha conocimiento validado. Deja el camino abierto a certificar más adelante sin rehacer nada | Requiere disciplina para no convertirse en una lista de siglas decorativas |
| **D** | **Solo cumplimiento legal** (Ley 29733 + SUNAT), ignorando marcos ISO | Ataca la exposición real e inmediata | Insuficiente por sí solo: no ordena el gobierno interno ni la calidad |

## 4. Decisión

**PENDIENTE — corresponde al propietario del producto.**

### Recomendación del arquitecto: **D con prioridad, luego C. Descartar B.**

| Orden | Qué | Por qué |
|---|---|---|
| **1º** | **D — cumplimiento legal**, empezando por **R-036 (protección de datos personales)** con asesoría legal | Es exposición real, no formal. Un respaldo de producción restaurado en pruebas contiene el padrón completo con domicilios georreferenciados y conversaciones privadas, y **hoy nada lo regula** |
| **2º** | **C — adopción selectiva**: declarar filiación de los patrones ya usados (coste casi nulo) y adoptar de **ISO/IEC 42010** los stakeholders y concerns, de **ISO/IEC 25010** el vocabulario de atributos de calidad para R-016, y de **OWASP ASVS** una verificación acotada de A01 | Aprovecha lo maduro sin ceremonia. ISO 42010 es el que menos cuesta porque el cuerpo ya está cerca |
| **3º** | **Descartar B** salvo que aparezca una exigencia comercial concreta | Certificar un sistema con desviaciones críticas abiertas es certificar el papel, no el sistema |

**Regla propuesta si se adopta C:** ningún documento declara conformidad con una norma **hasta
haber hecho el gap analysis correspondiente**. Escribir "conforme a ISO 25010" en una portada sin
haberlo comprobado sería la misma clase de afirmación sin verificar que este registro existe para
impedir.

## 5. Consecuencias

**Si se adopta D + C:**
- *Positivas:* cierra la exposición legal, que es la única con consecuencia externa; el cuerpo gana vocabulario reconocible y trazable; queda abierta la vía a certificar sin rehacer.
- *Negativas:* consume capacidad del Horizonte 1; la asesoría legal tiene coste; el gap analysis puede destapar más brechas de las esperadas —lo cual es el punto, pero hay que estar dispuesto a registrarlas.

**Si se adopta A (statu quo):**
- Aceptable técnicamente. **No aceptable en la parte legal**: la ausencia de política de datos personales no es una carencia de gobierno, es una exposición.

**Condiciona:** R-036 (protección de datos personales), R-037 (entorno de pruebas — depende de la
anonimización), R-016 (objetivos de calidad — su vocabulario saldría de ISO 25010), H2-1 (SUNAT).

## 6. Estado

**Aceptada parcialmente — 2026-08-06 (Datafast, decisión D3).**

| Componente | Decisión |
|---|---|
| **B — certificación formal** (ISO 27001/9001) | **DESCARTADA** |
| **C — adopción selectiva declarada** | **ACEPTADA.** Se detalla en ADR-030 |
| **D — cumplimiento legal como programa** | **SUSPENDIDO por el momento**, con una excepción (§6.1) |

### 6.1 La excepción, y la regla que se deriva de ella

Literal de la decisión: *el tema legal se suspende, **salvo cuando implique el diseño de algún
módulo**; entonces se define en ese momento.*

**Regla derivada — propuesta para POL-001:**

> **Cuando un módulo nuevo toque materia regulada, el marco legal aplicable se define ANTES de
> diseñarlo, no después.**

Es una regla mejor que el programa que sustituye. Evita el coste de un programa de cumplimiento
que hoy nadie va a mantener, y evita el fallo real: diseñar un módulo y descubrir después que la
norma exigía otra estructura de datos. Módulos afectados hoy:

| Módulo | Materia regulada | Cuándo se define |
|---|---|---|
| **Facturación electrónica (H2-1)** | SUNAT: firma XML, OSE, CDR, catálogos | **Antes de diseñarlo.** Determina el modelo de datos, no solo la integración |
| **Portal / datos del abonado** | Ley 29733 | Al tocar retención, exportación o supresión |
| Inventario (H2-4) | — | No aplica |

### 6.2 Alcance de R-036 tras esta decisión

D7 aprobó R-036 (protección de datos personales) y D3 suspendió lo legal. **Se interpretan como
complementarias, no contradictorias:**

| Parte de R-036 | Estado |
|---|---|
| **Técnica** — retención por tabla, anonimización en respaldos y entornos de prueba, quién accede a datos sensibles, registro de accesos | **ACTIVA.** No requiere abogado: son decisiones de ingeniería |
| **Legal** — base de tratamiento, derechos del titular, plazos normativos, cláusulas | **SUSPENDIDA** hasta que un módulo la exija (§6.1) |

**Si esta interpretación no es la correcta, corregir aquí antes de ejecutar R-036.**

### 6.3 Pendiente de este ADR

El alcance concreto de C —qué se adopta de ISO/IEC 42010, ISO 25010 y OWASP ASVS— se resuelve en
**ADR-030**, ya decidido en D4.

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
| ~~**ADR-017**~~ | ~~Mecanismo de aislamiento multi-tenant~~ — **ACEPTADA 2026-08-08**, ver [ADR-017](ADR-017-aislamiento-multi-tenant.md). Entra el barrido; **RLS se descarta por ahora porque seria inerte** — la app conecta como superusuario con BYPASSRLS. A-1 queda parcialmente abierta a proposito, bloqueada por la nueva **B-15** | Desviación **A-1** · RDM-001 R3 | — |
| **ADR-018** | **Estrategia de adopción del tipado estricto**: global, por archivo nuevo, por opción o por módulo (ver EST-001 Anexo B.1) | Desviación **B-1** | Alta |
| ~~**ADR-019**~~ | ~~Destino único del cálculo de deuda~~ — **ACEPTADA 2026-08-08**, ver [ADR-019](ADR-019-destino-del-calculo-de-deuda.md). El criterio de D11 se resolvió midiendo: `facturas.saldo` es una columna GENERATED, el único escritor ajeno a la aplicación ya está en la base; la agregación no tiene ninguno → servicio de dominio | Desviación **A-4** · RDM-001 R4 | — |
| ~~**ADR-020**~~ | ~~Segregación del plano automático y alarma del latido~~ — **ACEPTADA 2026-08-07**, ver [ADR-020](ADR-020-latido-vigilado.md). La **alarma** queda resuelta; la **segregación por criticidad** se traslada a ADR-027, porque decidirla exige la medición de duración que ADR-020 acaba de habilitar | Desviación **A-3** · RDM-001 R2 | — |
| **ADR-021** | **Puerto único hacia MikroTik** (`IRouterProvider`) y máquina de estados del servicio WISP | Desviación **B-5** · RDM-001 R5 | Alta |
| **ADR-022** | **Modelado de la sustitución de ONU** como transición de primera clase | Desviación **B-7** · RDM-001 R6 | Alta |
| **ADR-023** | **Particionado y retención de series temporales** | Desviación **C-7** · RDM-001 H3-1 | Media |
| **ADR-024** | **Stack de observabilidad** y qué se instrumenta primero | RDM-001 R8 | Alta |
| **ADR-025** | **Cobertura del permiso fino**: alcance retroactivo y regla de CI | Desviación **B-3** | Media |
| **ADR-026** | **Entidades para las tablas de coordinación y de dinero** | Desviación **B-2** · RDM-001 R7 | Alta |
| **ADR-027** | **Contrato de proceso de fondo**: cap, lock y presupuesto obligatorios, **más la segregación del worker por criticidad** heredada de ADR-020. El **latido** ya no forma parte de esta decisión: se deriva del registro desde 2026-08-07 | Desviación **B-6** · RDM-001 R10 | **Alta** (era Media: ahora arrastra la segregación) |
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
