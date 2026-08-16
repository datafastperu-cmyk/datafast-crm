# Módulo Planta Externa FTTH/GPON — Propuesta de Arquitectura

> ⚠ **Documento anterior al diseño del Core, y de un módulo que aún no se ha reestructurado.**
> Donde diga algo distinto de **E-0.2 / E-0.3 / E-0.4** (Vigentes), **mandan estos últimos**
> (00-INDICE §4). Se reescribirá en la fase de su módulo (F-0.1 §12).
> **No se cita como fuente en un documento vigente.**

---


Estado: **Fase 1 implementada y validada contra base de datos** (ver §13). Fases 2-4 pendientes de aprobación.
Base: expediente técnico "Módulo Avanzado de Diseño y Gestión de Redes FTTH/GPON" (Julio 2026),
corregido contra el estado real del repositorio y las directrices de `CLAUDE.md`.

---

## 0. Principio rector

El expediente propone un **módulo documental**: dibujar la red en un mapa. Esta propuesta
lo eleva a **módulo de diagnóstico**: la planta externa documentada se contrasta
automáticamente contra la lectura viva de la OLT (`olt_onu_inventario`, potencia óptica),
de modo que una NAP mal documentada **se delata sola** en vez de esperar a la próxima avería.

Ese cambio de alcance no agrega tablas: agrega una columna de confianza y un reconciliador.
Es la diferencia entre un plano y un sistema.

### Clasificación de resiliencia

| Componente | Clase | Motivo |
|---|---|---|
| `planta-externa` (CRUD, grafo, asignación de puertos) | **Core Indestructible** | Es BD propia. Si falla en init, el backend debe crashear. Sin patrón degradado. |
| `GoogleMapsService` (geocode / tiles) | **Degradable** | API de terceros. Nunca puede impedir guardar una coordenada manual. |
| `PlantaExternaReconciliadorService` (VIO) | **Degradable** | Depende de lectura de OLT. Si la OLT no responde, no invalida nada. |

---

## 1. Modelo de datos

Prefijo `pe_` para todas las tablas. Todas heredan `BaseModel` (`id UUID`, `created_at`,
`updated_at`, `deleted_at`, `version`) y llevan `empresa_id NOT NULL` (multi-tenant).

### 1.1 Grafo: nodos y aristas

El grafo óptico tiene **3 tipos de nodo** (`site`, `mufa`, `nap`) y **1 tipo de arista**
(`fibra_segmento`). Los hilos son los conductores dentro de la arista; las fusiones y los
splitters son las **transiciones internas** de un nodo.

No se usa FK polimórfica (destruye la integridad referencial). Se usan columnas separadas
con `CHECK` de exclusividad — Postgres garantiza la integridad y el planner puede usar los índices.

```sql
-- Referencia a nodo: exactamente una de las tres columnas no nula.
CONSTRAINT chk_origen_unico CHECK (
  (origen_site_id IS NOT NULL)::int +
  (origen_mufa_id IS NOT NULL)::int +
  (origen_nap_id  IS NOT NULL)::int = 1
)
```

### 1.2 Tablas

**`pe_fibra_segmento`** — tendido de cable entre dos nodos.
```
empresa_id, codigo (único por empresa), jerarquia ENUM('troncal','subtroncal','distribucion'),
hilos_totales INT CHECK (hilos_totales IN (2,4,6,8,12,24,48,96,144,288)),
tipo_instalacion ENUM('aereo','subterraneo','fachada'),
longitud_m NUMERIC(10,2) NOT NULL,          -- necesario para presupuesto óptico
atenuacion_db_km NUMERIC(4,3) DEFAULT 0.35, -- 1490nm típico
origen_{site|mufa|nap}_id, destino_{site|mufa|nap}_id,   + CHECKs de exclusividad
ruta_geojson JSONB,                          -- polilínea del trazado (capa 2 del visor)
estado ENUM (ver §3)
```
`ruta_geojson` en lugar de tabla de vértices: el trazado se lee y escribe siempre completo,
nunca por punto. Índice GIN sólo si en el futuro se consulta por contenido.

**`pe_fibra_hilo`** — N filas por segmento, creadas atómicamente al alta del segmento.
```
segmento_id FK, numero INT, color VARCHAR(20),   -- código EIA-598
estado ENUM('libre','en_uso','averiado','reservado'),
UNIQUE (segmento_id, numero)
```
Sin esta tabla no existe trazabilidad ni continuidad: es la omisión principal del expediente.

**`pe_mufa`** — `jerarquia ENUM('primer_nivel','segundo_nivel')`, `descripcion`, `direccion`,
`latitud/longitud NOT NULL`, `precision_gps_m`, `capacidad_fusiones INT`, `estado`.

**`pe_nap`** — `codigo` (único por empresa), `mufa_origen_id`, `segmento_alimentador_id`,
`direccion`, `latitud/longitud NOT NULL`, `precision_gps_m`, `estado`,
**`capacidad_puertos INT CHECK (capacidad_puertos IN (8,16,24,32))`**.

`capacidad_puertos` es la cantidad de adaptadores **físicos** de la caja, y es independiente de
la capacidad de sus splitters. Una NAP de 16 puertos con un solo 1x8 instalado tiene 8 puertos
que existen físicamente pero no dan servicio: se habilitan cuando se monta el segundo splitter,
alimentado por un hilo de paso del cable que cruza la caja. Fusionar ambos conceptos (como hace
el expediente §2.4, con relación fija por caja) hace que el planificador vea capacidad donde no
puede conectar a nadie.

**`pe_splitter`** — **entidad propia, no atributo**. Un splitter tiene 1 entrada y N salidas,
y puede vivir en una mufa o en una NAP. Modelarlo como columna de la NAP (como propone el
expediente §2.4) imposibilita las cascadas 1x2 → 1x8, que son estándar en planta real.
```
alojado_en_mufa_id | alojado_en_nap_id   (CHECK: exactamente uno),
relacion ENUM('1x2','1x4','1x8','1x16','1x32'),
perdida_db NUMERIC(4,2) NOT NULL,       -- 1x8 ≈ 10.5 dB, 1x16 ≈ 13.5 dB
hilo_entrada_id FK pe_fibra_hilo
```

**`pe_splitter_salida`** — una fila por salida. Cada salida alimenta **o** un hilo (cascada
hacia otra mufa) **o** un puerto NAP (cliente). CHECK de exclusividad.

**`pe_fusion`** — matriz de empalme dentro de una mufa.
```
mufa_id FK, hilo_a_id FK, hilo_b_id FK,
perdida_db NUMERIC(4,2) DEFAULT 0.10,
UNIQUE (hilo_a_id), UNIQUE (hilo_b_id)   -- un hilo se fusiona una sola vez
```
Los dos UNIQUE son el invariante físico: un hilo no puede ir a dos sitios. Se impone en la BD,
no en el servicio — un guard de servicio no sobrevive a dos requests concurrentes.

**`pe_nap_puerto`** — **una fila física por puerto**. Es la corrección más importante de toda
la propuesta (ver §2.1).

Se crean las `capacidad_puertos` filas **al dar de alta la NAP**, con estado inicial
`no_habilitado`: el adaptador físico existe desde que se instala la caja. Al instalar un
splitter, sus salidas se mapean a N puertos y **ésos** pasan a `libre`.

Distingue tres situaciones que en campo no son la misma:
- `no_habilitado` — hay adaptador, no hay splitter detrás → se resuelve instalando un splitter.
- `libre` — hay splitter, no hay cliente → se resuelve con una acometida.
- `averiado` — está todo y está roto.

La numeración es **continua por NAP** (1..capacidad_puertos, atravesando todos sus splitters),
nunca reiniciada por splitter: es la que el técnico lee rotulada en la caja, y si no coincide
con la del ERP el dato es inútil en campo.
```
nap_id FK, numero INT CHECK (numero BETWEEN 1 AND 64),
estado ENUM('no_habilitado','libre','reservado','ocupado','averiado','retirado'),
splitter_salida_id FK nullable,
reservado_por_usuario_id, reservado_hasta TIMESTAMPTZ,   -- reserva con TTL (§2.2)
UNIQUE (nap_id, numero)
```

**`pe_acometida`** — última milla: el drop del cliente.
```
contrato_id FK, nap_puerto_id FK, longitud_m NUMERIC(6,2),
confianza ENUM('declarado','verificado','discrepante'),   -- VIO (§4)
verificado_at, verificado_evidencia JSONB,                -- {olt_id, slot, port, sn, rx_dbm}
presupuesto_optico_db NUMERIC(5,2),                       -- calculado (§5)
UNIQUE (nap_puerto_id) WHERE deleted_at IS NULL,
UNIQUE (contrato_id)   WHERE deleted_at IS NULL
```
Los dos UNIQUE parciales son la garantía de exclusión mutua real: **un puerto, un contrato**.

**`pe_traza_cache`** — ruta materializada extremo a extremo (§5).
**`pe_geocode_cache`** — caché de geocodificación por dirección normalizada (§6.2).

### 1.3 Índices obligatorios

```sql
CREATE INDEX idx_pe_nap_bbox   ON pe_nap  (empresa_id, latitud, longitud) WHERE deleted_at IS NULL;
CREATE INDEX idx_pe_mufa_bbox  ON pe_mufa (empresa_id, latitud, longitud) WHERE deleted_at IS NULL;
CREATE INDEX idx_pe_puerto_nap ON pe_nap_puerto (nap_id, estado);
CREATE INDEX idx_pe_hilo_seg   ON pe_fibra_hilo (segmento_id, estado);
```
Índices parciales `WHERE deleted_at IS NULL`: el 100% de las consultas del visor filtran vivos.

---

## 2. Atomicidad y concurrencia

### 2.1 Asignación de puerto — el defecto crítico del expediente

El expediente §2.4 especifica *"Puertos Libres = Capacidad del Splitter − Cantidad de Clientes
Activos"*. Eso es una race condition: dos operadores dando de alta a la vez leen ambos
"puerto 3 libre" y ambos lo asignan. **Contar no es reservar.**

Asignación atómica, una sola sentencia, sin `SELECT` previo:

```sql
UPDATE pe_nap_puerto
   SET estado = 'ocupado', version = version + 1, updated_at = now()
 WHERE id = $1 AND empresa_id = $2 AND estado IN ('libre','reservado')
   AND (estado = 'libre' OR reservado_por_usuario_id = $3)
RETURNING id;
```
- 0 filas afectadas → `ResultadoOperacion.rechazadoDefinitivo('puerto no disponible')`.
- 1 fila → se inserta `pe_acometida`, en la **misma transacción**.
- Si otro request ganó la carrera igual, el `UNIQUE (nap_puerto_id)` de `pe_acometida`
  es la segunda línea de defensa. La BD es la autoridad, no el servicio.

### 2.2 Reserva con TTL — directriz de wizards

El alta de un abonado es un wizard multi-paso. Reservar el puerto en el paso 2 y confirmarlo
en el paso 5 deja el puerto colgado si el navegador crashea. Por directriz (`CLAUDE.md`,
"Wizards y Modales"), **el servidor es la autoridad y el mecanismo real es la expiración del TTL**:

- `reservar()` → `estado='reservado'`, `reservado_hasta = now() + 20 min`.
- `PlantaExternaBarridoCron` (cada 5 min) libera `reservado` con `reservado_hasta < now()`.
- El heartbeat del wizard **extiende** el TTL, con **techo absoluto de 2 h**: una pestaña
  olvidada no puede bloquear un puerto para siempre.
- La frontera de confirmación es la `pe_acometida` persistida, **no el clic de "Finalizar"**.

No hace falta saga con bitácora de compensación: **no hay hardware involucrado**. Todo el
procedimiento cabe en una transacción de Postgres, que ya es atómica. Introducir una saga aquí
sería complejidad sin invariante que proteja.

### 2.3 Edición concurrente de fusiones

Dos técnicos editando la matriz de la misma mufa es el caso normal, no el raro.
Optimistic locking con la columna `version` que `BaseModel` ya trae: `UPDATE ... WHERE version = $n`;
0 filas → `409 reintentable` (nunca `rechazado_definitivo` — incidente 28/07: un 409 de lock
no es un veredicto).

### 2.4 Altas transaccionales

- `INSERT segmento` + `INSERT N hilos` → **una transacción**.
- `INSERT nap` + `INSERT capacidad_puertos puertos` (en `no_habilitado`) → **una transacción**.
- `INSERT splitter` + `INSERT N salidas` + `UPDATE N puertos → libre` → **una transacción**.

Un segmento sin hilos, una NAP sin sus puertos físicos, o un splitter sin salidas es un registro
corrupto que ninguna lógica posterior puede reparar sola.

**Guard de capacidad física:** al instalar un splitter, la suma de salidas de todos los
splitters de la NAP no puede exceder `capacidad_puertos` → `rechazado_definitivo`. Un 1x16 no
entra en una caja de 8.

**Alimentación del segundo splitter:** su `hilo_entrada_id` suele ser un hilo *de paso* del
cable que cruza la NAP, no del alimentador original. El modelo no lo restringe: basta que el
hilo pertenezca a un segmento que toque la NAP.

**Retirar un splitter con puertos ocupados es `rechazado_definitivo`.** Sin ese guard, retirar
el splitter borraría en cascada los puertos y con ellos la trazabilidad de clientes que siguen
conectados.

---

## 3. Máquina de estados declarativa

Por directriz, las transiciones viven en **un solo archivo**
(`backend/src/modules/planta-externa/domain/planta-externa-maquina-estados.ts`),
nunca en condicionales dispersos. Un criterio disperso no es auditable.

Son **dos** máquinas, porque son dos ciclos de vida distintos:

```
Elemento (mufa, NAP, segmento, splitter):
  planificado → instalado → operativo ⇄ averiado → retirado
        └──────────────────────↗   (planta preexistente se documenta hacia atrás)

Puerto de NAP:
  no_habilitado ⇄ libre → reservado → ocupado
                    ⇅              ↘ liberar ↗
                 averiado                → retirado (nunca desde ocupado)
```

**Sin estado `degradado`.** El borrador lo contemplaba y se descartó al implementar: en
planta externa no hay telemetría que distinga "degradado" de "averiado" en una mufa o un
tendido — lo decidiría un humano por corazonada. Un estado que nadie sabe cuándo poner se
llena mal, y después se razona sobre él como si significara algo. La degradación real
(fusión sucia, curvatura) se detecta por **presupuesto óptico** (Fase 3), que sí es una
medición, y se reporta como alerta sobre un elemento que sigue `operativo`.
- La **idempotencia se deriva del estado destino**: si el recurso ya está en el destino,
  la operación es `ya_en_destino` (ÉXITO). Ningún método la implementa a mano.
- Los guards consultan `evaluarTransicion()`, jamás escriben su propio array.
- Estados de origen legales declarados explícitamente por transición — el bug de
  `desaprovisionar` que no aceptaba `suspendido` nació exactamente de no tener esto.

Todos los métodos públicos devuelven `ResultadoOperacion` (`common/domain/resultado-operacion.ts`),
no excepciones HTTP. El controller traduce en el borde con `traducirAHttp`.

---

## 4. VIO — la documentación es una afirmación sin verificar

Que un técnico haya escrito "NAP-12, puerto 3" no significa que el cliente esté ahí.
Es exactamente el patrón del incidente CNT-2026-000004: *accepted* ≠ *materialized*.

**Puente verificable ya existente en el ERP:** `olt_onu_inventario` (`olt_id, slot, port, sn`)
más la lectura de potencia óptica.

`PlantaExternaReconciliadorService` (nocturno, con cap y lock — ver §9):
1. Para cada acometida, deriva del grafo el puerto PON que *debería* servirla.
2. Lo compara con el `slot/port` real de la ONU del contrato.
3. Coinciden → `confianza='verificado'`, con `verificado_evidencia` y timestamp.
4. No coinciden → `confianza='discrepante'` + evento en `auditoria`. **Nunca corrige solo**:
   no se sabe cuál de los dos planos miente.
5. OLT no responde → **no cambia nada**. Módulo degradado, no invalida datos buenos.

En el visor, `declarado` y `verificado` se pintan distinto. Mezclarlos en la misma columna
sería repetir el `success: true` sin comprobar.

---

## 5. Grafo, traza y presupuesto óptico

### 5.1 Recorrido
CTE recursiva en Postgres (nunca N+1 desde el frontend), **con cap de profundidad de 20 saltos
y detección de ciclos** por array de visitados: una matriz de fusiones mal documentada crea
un ciclo, y sin cap cuelga el backend.

### 5.2 Materialización
El resultado se materializa en `pe_traza_cache` (`acometida_id`, `ruta JSONB`,
`presupuesto_db`, `calculado_at`, `hash_topologia`). Se invalida **por evento** al editar
cualquier eslabón (segmento, fusión, splitter, puerto), no por TTL: el TTL o recalcula de más
o sirve datos viejos.

### 5.3 Presupuesto óptico — el entregable de mayor valor
```
pérdida_total = Σ(longitud_km × atenuacion_db_km)
              + Σ(pérdida de cada splitter en la ruta)
              + Σ(0.1 dB por fusión)
              + 0.3 dB por conector
```
Se contrasta contra el `rx_power_dbm` real de la ONU. Desviación > 3 dB → alerta de planta:
fusión sucia, curvatura o documentación incorrecta. **Esto es lo que convierte el módulo
de un plano a un sistema de diagnóstico**, y sale casi gratis una vez existe el grafo.

---

## 6. Rendimiento y escalabilidad

### 6.1 Visor cartográfico
Cargar 5 capas completas revienta el navegador y el pool de conexiones. Contrato de API:

`GET /planta-externa/mapa?bbox=minLng,minLat,maxLng,maxLat&zoom=N&capas=napa,mufas`

- Respuesta **GeoJSON** (`FeatureCollection`), consumible por cualquier motor de mapas.
- **Clustering en servidor** por celda de grid según `zoom`: bajo zoom devuelve agregados
  (`{lat, lng, count}`), no miles de pines.
- `ETag` + `Cache-Control` para revalidación barata.
- Cap duro de features por respuesta; si se excede, se devuelve agregado. El backend nunca
  emite una respuesta ilimitada.
- Sin PostGIS: la box query sobre el índice btree compuesto basta. Si el parque crece a
  decenas de miles, se habilita PostGIS + GIST **sin cambiar el contrato de la API**.

### 6.2 Geocodificación
`pe_geocode_cache` por dirección normalizada. Cada llamada a Google cuesta dinero y la misma
dirección se geocodifica N veces en un alta típica.

### 6.3 Ocupación de NAP
**Dos** contadores denormalizados en `pe_nap`, mantenidos por trigger sobre `pe_nap_puerto`:
`puertos_libres` (con splitter, sin cliente) y `puertos_no_habilitados` (sin splitter detrás).
El semáforo de la capa 4 los consulta directo, sin agregación por NAP.

Son dos y no uno porque responden preguntas de negocio distintas: *"¿puedo conectar un cliente
hoy?"* vs *"¿esta caja necesita inversión en un splitter?"*. Un solo contador de "libres"
mezclaría ambas y haría que el planificador vea capacidad donde no puede conectar a nadie.

La **fuente de verdad sigue siendo `pe_nap_puerto`**; los contadores son sólo caché de lectura.

---

## 7. Seguridad y multi-tenant

1. **Toda** query filtra `empresa_id`, tomado del JWT — jamás del body ni del query string.
2. **La capa 5 expone PII sobre un mapa.** Autorización por rol específico
   (`red:mapa:clientes`), no basta con estar autenticado. Un técnico de campo ve la planta;
   no necesariamente la lista georreferenciada de abonados.
3. Coordenadas validadas en rango (`lat ∈ [-90,90]`, `lng ∈ [-180,180]`) y `ruta_geojson`
   validada con Zod contra un esquema estricto antes de persistir — es JSONB entrante de cliente.
4. Rate limit en el endpoint de mapa: es el más barato de abusar.
5. Cero IPs/URLs hardcodeadas (portabilidad multi-VPS): la URL del proveedor de tiles y la
   API key van a `.env.production` y a `.env.example`, leídas con **lazy getters**.

---

## 8. Escenario pesimista → respuesta del diseño

| Escenario | Respuesta |
|---|---|
| Dos altas simultáneas al mismo puerto | `UPDATE` condicional + `UNIQUE` en `pe_acometida` (§2.1) |
| Wizard cerrado / navegador crasheado a media alta | Reserva TTL 20 min + barrido servidor + techo 2 h (§2.2) |
| Google Maps caído o sin cuota | Módulo degradado + circuit breaker; **coordenada manual siempre se guarda** |
| Instalación sin dominio/HTTPS (VPS o servidor local) → no hay GPS nativo | `isSecureContext` evaluado al montar el form; Mapa Picker pasa a camino principal, `ModuleHealth` lo marca degradado; ningún alta se bloquea (§11.1) |
| GPS con 2 km de error | `precision_gps_m` persistido; captura por encima del umbral se rechaza con motivo |
| Fusiones que forman un ciclo | Cap de 20 saltos + array de visitados en la CTE (§5.1) |
| NAP borrada con clientes colgando | Soft-delete + guard referencial: `rechazado_definitivo` si hay hijos activos |
| Documentación no coincide con la realidad física | Reconciliador VIO → `discrepante` + auditoría, nunca autocorrección (§4) |
| OLT no responde durante la reconciliación | No invalida nada; el módulo se marca degradado |
| Migración de `caja_nap` con datos sucios | Dos releases, aditiva primero, reporte de irreconciliables (§10 Fase 2) |
| Dos operadores editando la misma mufa | Optimistic locking por `version` → 409 **reintentable** (§2.3) |
| Reconciliador nocturno saturando la OLT | Cap por corrida + lock de instancia + backoff (§9) |
| Dispositivo de campo sin internet | Datos del ERP cacheados primero; tiles después (§10 Fase 4) |

---

## 9. Cron y watchers

| Job | Frecuencia | Protección |
|---|---|---|
| `barrerReservasExpiradas` | 5 min | Idempotente; sólo `reservado` vencidas |
| `reconciliarPlantaVsOlt` | Nocturno, fuera de la ventana 03:30 ya ocupada | **Cap de N acometidas por corrida**, lock de instancia (`watcher-heartbeat`), backoff. El MA5800 tiene límite bajo de sesiones VTY concurrentes |
| `recalcularTrazasInvalidadas` | 10 min | Sólo las marcadas sucias por evento |

La ventana horaria se elige explícitamente para **no** colisionar con el reconciliador ZTP
de las 03:30 (ver memoria `project_revisar_reconciliador_nocturno`).

---

## 10. Plan de fases

> **Estado al 2026-07-31: Fase 1 implementada y VALIDADA contra base de datos.**
> Código completo y con typecheck limpio (backend y frontend); 41 tests propios en verde
> y la suite completa del backend (451) sin regresiones. Migraciones probadas con ciclo
> `up`/`down`/`up` y test de concurrencia real (50 sesiones → 1 ganador) sobre una BD
> desechable con el esquema de producción. Falta desplegar. Ver §13.

**Fase 1 — Fundación (crítica).** Migraciones `pe_*` con hilos, puertos y splitters como
entidades; máquina de estados declarativa; CRUD con `ResultadoOperacion`; hardening de
`GoogleMapsService` (degradado + breaker + caché); RF-03 con `accuracy` y detección de
secure context.
*Aceptación:* test de concurrencia que dispara 50 asignaciones paralelas al mismo puerto y
exige exactamente 1 éxito y 49 `rechazado_definitivo`.

**Fase 2 — Integración CRM.** Migración aditiva de `caja_nap`/`puerto_nap` → `nap_puerto_id`,
backfill, reporte de irreconciliables, conciliación manual, deprecación en release posterior.
Vinculación **obligatoria condicional al tipo de servicio FTTH** — obligarla a todo abonado
rompería el alta de clientes inalámbricos, que este ERP sí tiene.
*Aceptación:* alta de cliente WISP sigue funcionando sin NAP; alta FTTH sin NAP se rechaza.

**Fase 3 — Visor y grafo.** Endpoint bbox + GeoJSON + clustering; 5 capas alternables; CTE
recursiva con cap; `pe_traza_cache`; presupuesto óptico; reconciliador VIO y estado de confianza.
*Aceptación:* traza extremo a extremo de un contrato real en < 300 ms; una acometida real
marcada `verificado` contra la OLT NODO MALVINAS.

**Fase 4 — Continuidad offline.** **Abstract del proveedor de tiles desde la Fase 3**, aunque
sólo exista Google — si no, es refactor total del visor.
4a: caché de la data del ERP (pines, líneas, fusiones) en IndexedDB con
`navigator.storage.persist()` verificado. Es lo que el técnico realmente necesita en campo.
4b: tiles. **El expediente propone descargar en masa de OpenStreetMap, lo cual viola la tile
usage policy de OSM igual que la de Google.** Opción viable: tiles auto-hospedados en el VPS
o vector tiles propios (PMTiles/Protomaps), con URL por `.env` (portabilidad multi-VPS).

---

## 11. Bloqueantes a resolver antes de empezar

1. **RESUELTO — GPS sin HTTPS: capacidad degradable, nunca bloqueante.**
   El ERP se instala también en VPS sin dominio y en servidores locales sin IP pública, donde
   no hay certificado. `navigator.geolocation` y el Service Worker de la Fase 4 exigen
   *secure context*, así que en esas instalaciones no existen.
   Decisión: se trata como **capacidad degradable del entorno**, con el mismo patrón que
   cualquier módulo degradado.
   - La detección es `window.isSecureContext`, **no** una comprobación de prefijo `https`.
     `localhost` / `127.0.0.1` **sí** son secure context (servidor local operado desde la
     propia máquina tiene GPS); una IP de LAN no lo es; un certificado autofirmado aceptado
     por el navegador **sí** lo es.
   - Se evalúa **al montar el formulario**, no al hacer clic: sin secure context, el Mapa
     Picker pasa a ser el camino principal y el botón GPS queda deshabilitado con la razón
     visible. El aviso al clic es red de seguridad, no el mecanismo — el operador no debe
     descubrirlo a media alta.
   - El mensaje ofrece la salida real ("requiere HTTPS; sin dominio se resuelve con
     certificado autofirmado o CA interna"), porque es una limitación con solución conocida
     y quien instala necesita saberlo.
   - Se registra en `ModuleHealth` como `geolocalizacion_gps: degraded — sin secure context`
     y se expone en Centro de Operaciones, para que sea un estado visible del servidor y no
     un hallazgo sorpresa de un técnico en campo.
   - **Ningún alta se bloquea jamás por esto**: la coordenada siempre puede fijarse por Mapa
     Picker o tecleándola. El GPS es una comodidad, no una dependencia.
2. **RESUELTO — Motor de mapas: MapLibre GL** como motor único desde el día 1, con Google
   como *fuente* de tiles y OSM/PMTiles como respaldo. Adoptar el SDK de Google y luego migrar
   a Leaflet para el failsafe (como sugiere el expediente) implica escribir el visor dos veces.
3. **RESUELTO — Topologías reales de planta.** Confirmado con operaciones:
   - **No existen splitters sin contenedor.** Todo splitter vive en una mufa o en una NAP →
     el `CHECK` de exclusividad de dos alojamientos es suficiente; no hace falta convertir el
     poste en nodo del grafo.
   - **Hay mufas sin splitter**: de fusión pura (continuidad) y de derivación (varios segmentos
     terminan en la mufa y las fusiones reparten hilos entre ellos, sin división de potencia).
     Ya soportado — nada limita el número de segmentos por mufa, y el splitter es tabla aparte.
     Importa para el presupuesto óptico: una derivación suma ~0.1 dB de fusión, un 1x8 suma
     ~10.5 dB. Modelarlos distinto hace que el cálculo salga correcto solo.
   - **Una mufa o una NAP puede alojar más de un splitter** → relación 1:N ya prevista.
     Caso real: caja de 16 puertos con un 1x8 instalado; los 8 restantes se habilitan después
     con un segundo splitter alimentado por un hilo de paso. De ahí la separación entre
     `capacidad_puertos` (físico, de la caja) y capacidad de splitter (servicio), y el estado
     `no_habilitado` (ver §1.2 y §2.4). La relación fija 1x8/1x16 por caja del expediente §2.4
     queda descartada.

---

## 12. Tests que nombran su incidente

Por directriz "VIO hacia adentro": una garantía sin test es un comentario, y un comentario
que nadie sostiene es peor que ninguno.

- `asignarPuerto: 50 requests paralelos → exactamente 1 acometida (race del expediente §2.4)`
- `reserva de puerto expira aunque el navegador nunca avise (wizard cerrado, directriz 2026-07-21)`
- `409 de optimistic lock en fusiones es reintentable, no un veredicto (incidente 28/07)`
- `traza con ciclo de fusiones termina en 20 saltos y no cuelga el backend`
- `Google Maps caído: el alta de mufa con coordenada manual sigue funcionando`
- `reconciliador con OLT inalcanzable no degrada una acometida ya verificada`
- `sin secure context el alta de mufa sigue completándose por Mapa Picker (instalación local sin dominio)`
- `NAP con dos splitters: numeración continua 1..N y ningún puerto duplicado`
- `NAP de 16 con un 1x8: 8 libres y 8 no_habilitados; asignar a un no_habilitado se rechaza`
- `instalar un 1x16 en una caja de 8 puertos es rechazado_definitivo (guard de capacidad física)`
- `retirar un splitter con puertos ocupados es rechazado, no borra la trazabilidad del cliente`

---

## 13. Estado de implementación y qué falta validar (2026-07-31)

### Entregado

| Componente | Archivos | Verificación |
|---|---|---|
| Máquina de estados declarativa | `modules/planta-externa/domain/planta-externa-maquina-estados.ts` + spec | 21 tests verdes |
| Migraciones (grafo / óptica / acceso) | `migrations/core/1791800000028..30` | **`up`/`down`/`up` limpio contra BD real** (ver abajo) |
| Entidades TypeORM (8) | `modules/planta-externa/entities/` | typecheck OK, `type:` explícito en toda columna nullable |
| Servicio de puertos (atómico + TTL) | `planta-externa-puertos.service.ts` + spec | 20 tests verdes |
| Servicio CRUD (altas transaccionales, guard de capacidad) | `planta-externa.service.ts` | typecheck OK |
| Controller + DTOs + auditoría | `planta-externa.controller.ts`, `dto/` | typecheck OK |
| Cron de barrido de reservas | `planta-externa-barrido.cron.ts` | typecheck OK |
| Hardening de geocodificación | `google-integration/services/google-maps.service.ts` | typecheck OK |
| Frontend: captura de coordenadas | `components/planta-externa/CapturaCoordenadas.tsx` | typecheck OK |
| Frontend: cajas NAP | `components/red/CajasNapContent.tsx`, `red/cajas-nap/page.tsx` | typecheck OK |

Suite completa del backend: **451 tests, sin regresiones**.

### Validado contra base de datos real

Se clonó el **esquema** de producción (`pg_dump --schema-only`, sin datos, lectura pura) a
una base desechable `pe_test` en el Postgres de la VPS, se corrieron ahí las migraciones y
se eliminó la base al terminar. **Producción no se tocó en ningún momento.**

El SQL probado se extrae de las propias clases de migración con
`backend/scripts/dump-planta-externa-sql.ts` (un `QueryRunner` falso que graba las
sentencias), de modo que lo validado es exactamente lo que correrá en producción y no una
copia manual que se desincroniza al primer cambio.

**Criterio de aceptación de la fase — CUMPLIDO.**
`pgbench -c 50 -j 10 -t 1` ejecutando el mismo `UPDATE` condicional que emite
`asignarPuerto()` sobre un único puerto:

| Métrica | Resultado |
|---|---|
| Transacciones ejecutadas | 50 / 50 |
| **Sesiones que reclamaron el puerto** | **1** |
| `version` del puerto | 1 → 2 (un solo UPDATE efectivo) |
| `puertos_libres` tras la carrera | 1 → 0, actualizado por el trigger |

Es la race condition del expediente reproducida y cerrada: con
"puertos libres = capacidad − clientes" las 50 habrían leído "libre" y las 50 habrían
asignado.

**Invariantes ejercitados** — cada uno se intentó violar y Postgres lo rechazó, sin dejar
una sola fila basura:

| # | Intento | Restricción que lo frenó |
|---|---|---|
| 1 | Puerto `libre` sin salida de splitter | `chk_pe_puerto_habilitado_tiene_salida` |
| 2 | Puerto `reservado` sin dueño ni vencimiento | `chk_pe_puerto_reserva_completa` |
| 3 | Número de puerto duplicado en la caja | `uq_pe_puerto_nap_numero` |
| 4 | Segmento con dos orígenes | `chk_pe_segmento_origen_unico` |
| 5 | Segmento con 13 hilos | `chk_pe_segmento_hilos` |
| 6 | Splitter sin contenedor | `chk_pe_splitter_alojamiento_unico` |
| 7 | Latitud 95° | `chk_pe_nap_coords` |
| 8 | Caja de 13 puertos | `chk_pe_nap_capacidad` |
| 9 | Código de NAP duplicado | `uq_pe_nap_codigo` |
| 10 | Acometida `verificado` sin evidencia | `chk_pe_acometida_verificada_con_evidencia` |
| 11 | Dos acometidas en el mismo puerto | `uq_pe_acometida_puerto` |
| 12 | Un contrato con dos acometidas | `uq_pe_acometida_contrato` |
| 13 | Un hilo fusionado dos veces | `uq_pe_fusion_hilo_a` |
| 14 | Hilo fusionado consigo mismo | `chk_pe_fusion_distintos` |

Además se confirmó que el **soft-delete libera el puerto**: al marcar `deleted_at` en una
acometida, el índice único parcial deja entrar la siguiente. Sin eso, dar de baja a un
cliente inutilizaría su puerto para siempre.

**Ciclo `up → down → up` limpio.** El `down` deja 0 tablas `pe_*` y elimina la función del
trigger; el `up` posterior reconstruye las 9 tablas y el trigger.

### Sigue pendiente

- **Desplegar.** `database.config.ts` tiene `migrationsRun: true`: las migraciones corren
  solas al arrancar el backend, así que **desplegar es ejecutarlas**. El esquema está
  validado, pero el despliegue en sí no se ha hecho.
- **Dato de campo confirmado:** este VPS sirve el ERP en `http://149.34.48.224:3000`, sin
  HTTPS. La captura por GPS no estará disponible ahí — el formulario lo detecta y lo dice,
  y el alta sigue funcionando con la coordenada a mano (§11.1).

### Decisiones tomadas durante la implementación

- **Se eliminó el estado `degradado`** del ciclo de vida del elemento. En planta externa
  no hay telemetría que lo distinga de `averiado`: lo decidiría un humano por corazonada,
  y un estado que nadie sabe cuándo poner se llena mal. La degradación real se detecta por
  presupuesto óptico en la Fase 3, que sí es una medición.
- **`ocupar` no deriva idempotencia** (`hacia: null`). Si la derivara, un puerto ocupado
  por OTRO contrato devolvería `ya_en_destino` — un falso éxito con dos contratos creyendo
  tener el mismo puerto. La decisión baja al servicio, que sí conoce al dueño.
- **Sin circuit breaker en la geocodificación.** El `CircuitBreakerRegistry` del repo
  depende de Redis, y la geocodificación se llama unas pocas veces al día, no en un bucle
  contra hardware. Alcanza con probe + `ModuleHealth` + caché + devolver `null` en vez de
  lanzar. Además el alta de mufa/NAP **ya era inmune**: las coordenadas vienen del DTO y
  el servicio nunca llama a Google.
- **El Mapa Picker (Variante B) no está en la Fase 1.** Necesita MapLibre GL, que llega
  con la Fase 3. Hoy la coordenada se fija por GPS (si hay secure context) o a mano.
