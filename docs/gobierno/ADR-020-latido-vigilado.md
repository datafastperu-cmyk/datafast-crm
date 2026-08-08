# ADR-020 — El latido se deriva del registro y lo vigila el proceso que responde

**Estado:** **Aceptada** — 2026-08-07, Datafast (PLAN-001 Fase 3.1)
**Decide:** Datafast · **Cierra:** desviación **A-3** · **Relacionado:** ADR-011 · ADR-027 (propuesto) ·
POL-001 PP-01 · PP-07 · PP-11 · RDM-001 **R2**

---

## 1. Problema

**El worker puede morir en silencio y el ERP sigue respondiendo con normalidad.**

`datafast-api-core` atiende al frontend; `datafast-worker-auxiliary` ejecuta los crons, las colas y
los watchers. Si el segundo muere, el primero no se entera: la interfaz responde, los listados
cargan, los formularios guardan. Lo que deja de ocurrir es todo lo automático — nadie se corta por
mora, nadie se reactiva al pagar, el outbox no drena hacia la OLT ni hacia MikroTik, y ninguna ONU
se reconcilia. Sin una sola señal.

El diagnóstico de la auditoría (desviación A-3) decía que el latido existía pero que los endpoints
eran *«consultables, no vigilantes»*. **Al medirlo antes de escribir código, el estado real era
peor:**

| Medición 2026-08-07 | |
|---|---|
| Jobs programados en el backend | **47** (29 `@Cron` + 18 `addCronJob`) |
| Jobs que registraban latido | **10** (11 nombres: el job de VPN emite dos a propósito) |
| `@Cron` sin `name:` en su decorador | **26 de 29** |

> **Corrección de la propia medición, el mismo día.** La primera cifra que se escribió aquí fue
> «**1** de 47», y era falsa: el `grep` buscaba `heartbeat.ejecutar` y once servicios usan
> `this.hb.ejecutar`. Se descubrió al mirar los datos en producción tras desplegar —filas con
> miles de ejecuciones que no podían ser nuevas— y se corrigió en los ocho sitios donde ya se
> había propagado. Es el mismo fallo que retiró la desviación B-9: **una medición deducida de un
> `grep` incompleto no es una medición**. Se deja escrito porque el error importa más que la
> cifra: el argumento no dependía del número, pero el documento normativo sí depende de que sus
> números sean ciertos.

`WatcherHeartbeatService` existía desde el 2026-07-28, estaba bien construido —envuelve la
ejecución, registra en el `finally`, no lanza nunca— y su módulo era `@Global()` con un comentario
que decía, literalmente, que se hizo así porque *«obligar a cada módulo a importar este sería
fricción que termina en watchers sin latido — justo lo que se quiere evitar»*.

**El `@Global()` quitó la fricción de IMPORTAR y dejó intacta la de LLAMAR, que era la que
contaba.** Diez días después, la cobertura era del 21 %.

### 1.1 Por qué esto es la misma lección de siempre

Es exactamente el patrón que ADR-005 corrigió en otro terreno. Allí la idempotencia dejó de
implementarse a mano en cada método y pasó a **derivarse** del estado destino, porque *«un método
nuevo no puede olvidarse de ser idempotente si no es él quien lo implementa»*.

Aquí ocurría lo mismo con la observabilidad: una garantía que cada autor debe **acordarse** de
implementar no es una garantía, es una estadística. Y su incumplimiento es silencioso — el cron
sigue funcionando, solo deja de ser observable.

---

## 2. Contexto

### 2.1 Los dos huecos son distintos y necesitan respuestas distintas

| Hueco | Síntoma | Qué NO lo resuelve |
|---|---|---|
| **Nadie late** | 37 de 47 jobs invisibles | Una alarma sobre lo que no se registra no denuncia nada |
| **Nadie vigila** | El latido se consulta, no avisa | Hacer latir a los 47 no sirve si nadie mira la tabla |

Resolver uno sin el otro no cierra A-3.

### 2.2 El obstáculo técnico que decidió la forma de la solución

NestJS registra los `@Cron` en el `SchedulerRegistry`, lo que permite interceptarlos en un solo
sitio. Pero **un `@Cron()` sin `name:` recibe un UUID v4 como clave**
(`scheduler.orchestrator.js` → `addCron`: `options.name || uuid.v4()`), **distinto en cada
arranque**.

Usar esa clave como identidad de latido dejaría una fila huérfana por cron y por despliegue, y el
detector de rancios gritaría por todas ellas cada vez que se reinicia el backend. Una alarma que
grita cuando todo va bien deja de leerse — que es la forma más rápida de perder la que sí importa.

### 2.3 El punto ciego que ninguna de las dos mitades cubre por sí sola

Si el worker muere, **todos** los watchers quedan rancios a la vez. Cuarenta eventos que dicen lo
mismo esconden el único que hay que leer. Y con la tabla casi vacía, «este watcher lleva rato sin
latir» no distingue un proceso muerto de uno que todavía no ha registrado nada.

Hace falta una pregunta agregada distinta: **¿ha latido alguien?**

---

## 3. Alternativas

| # | Alternativa | Por qué se descarta |
|---|---|---|
| A | Instrumentar los 47 crons a mano con `hb.ejecutar` | Es lo que ya estaba disponible y produjo 10 de 47 en diez días. El cron nº 48 vuelve a olvidarse, y en silencio |
| B | Monitor externo (Uptime Kuma, healthcheck de PM2) | Sabe si el PROCESO vive, no si sus crons corren. Un worker vivo con el scheduler colgado pasa el check |
| C | Que el worker se vigile a sí mismo | Un testigo que se apaga con la luz. Falla justo en el caso que motiva la regla |
| D | Alarma solo sobre `rancios()` | Con el worker muerto emite 40 eventos sin causa; con la tabla vacía, ninguno |
| **E** | **Latido derivado del registro + vigilancia desde el proceso que responde** | **Elegida** |

---

## 4. Decisión

### 4.1 El latido se deriva de estar registrado, no de acordarse de llamarlo

`CronLatidoService` intercepta el `SchedulerRegistry` y envuelve **todo** job programado. Un cron
nuevo late sin que su autor escriba una línea de latido.

| Aspecto | Decisión | Por qué |
|---|---|---|
| **Punto de intercepción** | Los **callbacks** del `CronJob`, no `fireOnTick()` | En cron 3.2.1 `fireOnTick` hace `void callback.call(...)`: **no espera**. Envolviéndolo por fuera se mediría el tiempo hasta el primer `await`, y un cron que revienta a mitad quedaría registrado como exitoso |
| **Momento** | Parche de `addCronJob` en `onModuleInit` **+** barrido en `onApplicationBootstrap` | El orden de `onModuleInit` entre módulos depende del grafo de dependencias y no es algo sobre lo que apostar. El barrido es idempotente |
| **Intervalo esperado** | Deducido de la propia expresión cron (`nextDates(2)`) | Es la misma fuente que decide cuándo corre el job: no puede divergir de él |
| **Crons con clave UUID** | **No se envuelven: se denuncian** | Ensuciarían la tabla en cada despliegue (§2.2) |

### 4.2 Todo `@Cron` declara un `name:` estable, y hay una barrera que lo exige

Los 26 `@Cron` sin nombre se nombraron. La regla no vive en una guía —se incumpliría en el primer
cron que alguien añada con prisa, y en silencio— sino en un test que recorre el código fuente y
falla si aparece un `@Cron` sin `name:` **o con un nombre duplicado**: dos crons con el mismo
nombre comparten fila de latido y uno de los dos se vuelve invisible sin que nada falle.

### 4.3 El que trabaja late; el que responde vigila

**Los dos servicios son complementarios y nunca coinciden en el mismo proceso:**

| Servicio | Activo cuando | Función |
|---|---|---|
| `CronLatidoService` | `RUN_CRONS === 'true'` (worker) | Hace latir a todo cron registrado |
| `LatidoVigilanteService` | `RUN_CRONS !== 'true'` (api-core) | Denuncia lo que no late |

**Que el latido NO se registre en api-core es la mitad crítica del diseño, no un detalle de
eficiencia.** Allí los crons arrancan con un guard que retorna al instante; si también registraran
latido, la tabla se vería sana justo mientras el worker está muerto — el fallo exacto que A-3
existe para detectar.

### 4.4 Qué denuncia el vigilante, y con qué prioridad

| Código | Nivel | Condición |
|---|---|---|
| `PLANO_AUTOMATICO_MUDO` | `critical` | Nadie ha latido en más de 900 s |
| `WATCHER_RANCIO:<nombre>` | `error` | Un watcher concreto pasa de 3× su intervalo, **con el resto del plano vivo** |

**Con el plano mudo se emite UNA causa, no un evento por watcher caído.** Es un diagnóstico, no un
inventario de síntomas.

Tres decisiones de calibración:

1. **Gracia de arranque (600 s).** Un despliegue reinicia los dos procesos y el que responde
   arranca antes que el que trabaja: durante unos minutos la tabla está legítimamente fría.
2. **La gracia SUPRIME la alarma, nunca la autoriza.** Pasado el margen, el veredicto depende solo
   del latido. Una tabla vacía con el proceso llevando horas vivo **es** plano mudo, no «aún no hay
   datos» — es la misma regla del techo absoluto de la directriz de wizards.
3. **Deduplicación de 60 minutos, atómica en la sentencia.** Hay más de un proceso sin crons
   (`api-core` y `whatsapp`) y los dos vigilan: un `SELECT` seguido de un `INSERT` deja una ventana
   en la que ambos deciden que no existe. Una sola sentencia no la tiene.

### 4.5 Dónde queda constancia

Se escribe en `eventos_sistema`, que ya es el registro persistente de errores de producción y ya lo
lee el panel. **Se descartó `alertas_sistema`** porque exige un `dispositivo_id` con clave ajena a
`dispositivos_monitoreo`: es el canal de las averías de red, y el worker del ERP no es un
dispositivo.

`GET /admin/sistema/watchers` devuelve además el veredicto (`plano`). Sigue siendo consultable;
quien no espera a que le pregunten es el vigilante.

### 4.6 Una sola definición de «recargar el backend» (cierra B-12 y B-13)

La misma operación estaba escrita de cinco maneras y solo una verificaba algo:

| Script | Antes |
|---|---|
| `scripts/update.sh` | `pm2 restart $ECOSYSTEM --only <app> --update-env` + verificación completa |
| `be-deploy.mjs` | `pm2 restart datafast-api-core --update-env` ← **B-12** |
| `deploy.mjs` · `deploy-quick.mjs` · `deploy_backend_olt.mjs` | `pm2 restart <nombre>`, sin verificar nada |

La lógica se extrajo a **`scripts/lib/pm2-recargar.sh`** como definición única, que `update.sh`
ahora consume en lugar de tener su propia copia. Nombres leídos del ecosystem, `--only`, y
verificación de que el proceso **reinició de verdad sin entrar en bucle** (estado `online`, uptime
bajo, y delta del contador de reinicios ≤ 1).

---

## 5. Consecuencias

**Positivas**

- La cobertura de latido pasa de **10/47 a 47/47**, y el cron nº 48 la hereda sin hacer nada.
- El fallo que A-3 describe deja de ser invisible: pasa a `eventos_sistema` como `critical` en
  menos de 20 minutos.
- PP-11 pasa de verificación manual a **automática**; PP-01 y PP-07 quedan cubiertas en los cinco
  scripts, no en uno.
- 17 tests nuevos que nombran el incidente que los motiva.

**Negativas y sus mitigaciones**

| Riesgo | Mitigación |
|---|---|
| `_callbacks` es interno de la librería `cron` | Un test construye un `CronJob` real y comprueba que el latido se registra. Si una futura versión lo renombra, **el test cae**, que es lo que debe pasar |
| Una escritura en `watcher_heartbeat` por tick de cron | `UPSERT` sobre clave primaria; el más frecuente del ERP corre cada 30 s |
| Falsos positivos en despliegues largos | Gracia de arranque + umbral de 900 s + deduplicación de 60 min |

**No resuelve** (sigue abierto, y con razón):

- **La segregación del plano automático por criticidad** que el título original de ADR-020
  contemplaba. Un worker único sigue mezclando el cobro con la telemetría de la OLT. Separarlo es
  una decisión de topología con coste de memoria en el VPS, y **necesita antes la medición que
  este ADR acaba de habilitar**: con `duracion_ms` por cron ya registrándose, esa decisión se
  tomará sobre datos y no sobre intuición. Se traslada a **ADR-027**.
- **El cap y el presupuesto por cron** (PLAN-001 §3.1). El latido ya mide la duración de cada
  pasada, que es el requisito previo; el límite de trabajo por pasada va con ADR-027.

---

## 6. Verificación

| Qué | Cómo |
|---|---|
| El latido no depende de que nadie se acuerde | `cron-latido.service.spec.ts` — 7 tests sobre `CronJob` reales |
| Ningún `@Cron` se queda sin nombre estable ni duplicado | `cron-nombres.barrera.spec.ts` — recorre el código fuente |
| El que responde denuncia al que no late | `latido-vigilante.service.spec.ts` — 10 tests |
| Ningún nombre de cron pisa el de un latido manual | `cron-nombres.barrera.spec.ts` — ver §6.1 |

Los tres nombran el incidente. Un test llamado «no debería fallar» se borra en la primera limpieza.

### 6.1 Lo que solo se vio mirando producción

Los once latidos manuales que ya existían **son más finos que el automático**: varios devuelven
contadores en `resultado` —`address-list-reconciliador` guarda `{sobrantes, revisados,
noRevisados}` porque *«0 sobrantes con routers sin revisar no es lo mismo que 0 habiéndolos mirado
todos»*— y el job de VPN emite **dos** latidos a propósito, para poder distinguir cuál de sus dos
watchers murió.

Por eso no se eliminaron. Pero en dos casos el nombre del cron coincidía con el del latido interno
(`olt-sync-periodico` y `vpn-reconciliar-estado`): comparten fila, y **el envoltorio externo, que
devuelve `void`, pisaba el `resultado` del interno**. La tabla parecía correcta; el dato se perdía.

Se renombraron los dos nombres externos (`olt-sync-tick`, `vpn-watchers-tick`) y **se añadió una
barrera** que falla si un nombre de cron vuelve a colisionar con uno de latido. No se detectó con
tests ni con `tsc`: se detectó **consultando `watcher_heartbeat` en el servidor**, que es el único
sitio donde ese fallo es visible.

---

## 7. Hallazgo colateral — no lo arregla este ADR

Al revisar los nombres de proceso apareció una divergencia que **excede el alcance de esta
decisión y se registra como desviación nueva** (POL-001 Anexo B):

`installer/scripts/08-pm2.sh` **genera y sobrescribe** `${INSTALL_DIR}/ecosystem.config.js` con un
contenido que contradice al del repositorio —declarado *«fuente de verdad única»* por ADR-011—:

| | Repositorio | Instalador |
|---|---|---|
| Procesos | `datafast-api-core` + `datafast-worker-auxiliary` | **`datafast-backend`**, uno solo |
| Modo | `fork`, 1 instancia | **`cluster`**, N instancias |
| `RUN_CRONS` / `RUN_MIGRATIONS` | Declarados y opuestos por proceso | **Ausentes** |

Consecuencia: **una instalación nueva no tiene worker**, así que nace con el plano automático
muerto — el escenario que este ADR hace visible, permanente desde el primer día. Y `update.sh` no
encontraría procesos de backend en ese ecosystem.

Verificado leyendo el generador, **no probado sobre una instalación limpia.**
