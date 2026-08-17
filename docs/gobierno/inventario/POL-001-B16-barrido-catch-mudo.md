# B-16 — Barrido de `catch` mudo (inventario, no correcciones)

Ejecutado el 2026-08-17 contra `backend/src/`, alcance definido en POL-001 (B-16, promovida
2026-08-16): *"localizar todo `.catch(() => {})` / `catch {}` sin `logger.*` ni relanzamiento...
en `backend/src/`, clasificar cada uno... y para cada uno: o se corrige, o se documenta aquí por
qué el silencio es intencional."*

**Este documento es el inventario. No corrige nada.** Corregir 106 sitios a la vez cambiaría
comportamiento en decenas de puntos simultáneamente — exactamente lo que una fase de
reestructuración no hace (F-0.0 §8). Con la lista delante se decide, sitio por sitio o por
grupo, cuáles se corrigen y en qué ola.

**Alcance cubierto vs. pendiente de la propia definición de B-16:**
- ✅ Todo `catch {}` vacío y todo `.catch(() => {})` sin log ni relanzamiento, en `backend/src/`
  (excluidos los `.spec.ts`).
- ❌ **NO cubierto en este barrido:** *"todo retorno de `ResultadoOperacion` descartado sin
  comprobar la clase"*. Localizar eso exige revisar, uno por uno, cada punto de llamada de las
  34 operaciones que ya hablan `ResultadoOperacion` (E-0.2-interacciones.md, §"Quién habla ya
  el vocabulario de dominio") y confirmar si el valor de retorno se usa o se descarta — un
  trabajo de naturaleza distinta (semántico, no un patrón de texto) y de tamaño comparable a
  este mismo censo. Queda registrado como continuación pendiente de B-16, no resuelto aquí.

---

## 1. Resultado cuantificado

| Patrón | Sitios reales (excluidos falsos positivos en comentarios) |
|---|---|
| `catch {}` / `catch (e) {}` vacío | **23** |
| `.catch(() => {})` / `.catch(() => { /* comentario */ })` | **83** |
| **Total** | **106** |

De los 106, **~20 ya llevan un comentario inline explicando por qué el silencio es deliberado**
(`/* best-effort: ... */`, `/* puede no haberse asignado */`, etc.) — cumplen ya el criterio de
B-16 ("o se corrige, o se documenta") en el código, solo que esa documentación nunca se agregó
aquí, en el registro central. El resto —la mayoría— no lleva ninguna nota.

---

## 2. `catch {}` vacío — 23 sitios (mayor riesgo: ni siquiera queda el mensaje del error)

| # | Sitio | Qué se traga | Clasificación |
|---|---|---|---|
| 1 | `backup/backup.service.ts:373` | `fs.unlinkSync` al rotar backups viejos | Bookkeeping — limpieza de archivos, bajo riesgo |
| 2 | `crm-nativo/wa-client.service.ts:682` | `pkill` de la sesión al detener el cliente WA | Bookkeeping — best-effort de apagado |
| 3 | `crm-nativo/wa-client.service.ts:688` | Borrado de `SingletonLock` | Bookkeeping — limpieza de archivo de lock |
| 4 | `crm-nativo/wa-client.service.ts:822` | Resolución de teléfono real desde `contactInfo` | Bookkeeping — enriquecimiento opcional |
| 5 | `crm-nativo/wa-client.service.ts:1175` | Lookup de `lid` en colección interna de WhatsApp Web | Bookkeeping — enriquecimiento opcional |
| 6 | `crm-nativo/wa-client.service.ts:1178` | Envuelve el `catch{}` anterior en un bucle | Bookkeeping — mismo caso que #5 |
| 7 | `install/install.service.ts:91` | `ds.destroy()` en el `catch` de un fallo de conexión ya reportado | Bookkeeping — cierre de recurso en camino de error, instalador de un solo uso |
| 8 | `install/install.service.ts:228` | Mismo patrón que #7 | Bookkeeping — instalador |
| 9 | **`licencia/licencia.service.ts:319`** | Lectura de JWT de licencia desde BD (fallback); si falla, cae a `return ''` | **⚠️ Revisar** — un fallo de lectura (BD lenta, columna corrupta) se ve idéntico a "no hay licencia guardada". Puede leerse como bloqueo de licencia cuando el problema real es otro |
| 10 | `mikrotik/services/subnet-route.service.ts:74` | `api.close()` en `finally` tras medir latencia | Bookkeeping — cierre de conexión ya usada |
| 11 | `mikrotik/services/subnet-route.service.ts:106` | `api.close()` en `finally` tras listar subredes | Bookkeeping — igual que #10 |
| 12 | `mikrotik/services/subnet-route.service.ts:146` | `api.close()` en `finally` tras verificar CIDR | Bookkeeping — igual que #10 |
| 13 | **`notificaciones/services/gateway-mensajeria.service.ts:517`** | `decrypt(config.apiKey)`; si falla, `k` queda `''` | **⚠️ Revisar** — una clave que no descifra (config corrupta, cambio de clave de cifrado) se comporta igual que "sin clave configurada": el proveedor rechazará la petición con un error genérico de auth, no con la causa real |
| 14 | **`notificaciones/services/gateway-mensajeria.service.ts:518`** | `decrypt(config.apiSecret)`, mismo patrón | **⚠️ Revisar** — mismo riesgo que #13 |
| 15 | **`notificaciones/services/gateway-mensajeria.service.ts:537`** | `decrypt(config.smtpClave)`, mismo patrón para SMTP | **⚠️ Revisar** — mismo riesgo que #13 |
| 16 | **`openvpn/services/vpn-cliente.service.ts:460`** | `this.revocar(c.id, c.empresaId)` en el cron `limpiarWizardsAbandonados()` | **Caso ya nombrado en POL-001 B-16** ("variante encontrada en el grupo 3a") — `revocar()` habla `ResultadoOperacion` desde la Ola 1 y ya no lanza; este `catch{}` está doblemente muerto: ni atrapa una excepción real ni mira la clase del resultado. Es simultáneamente el ejemplo #1 de la categoría "no cubierta" (§1) |
| 17 | **`openvpn/services/vpn-cliente.service.ts:891`** | Parseo de `ifconfig-push` en archivos CCD para calcular IPs en uso | **⚠️ Revisar** — CLAUDE.md: las IPs VPN son permanentes y su ciclo de vida es crítico. Si el parseo de un CCD falla, esa IP puede leerse como "libre" cuando está asignada — riesgo de colisión de IP, no solo de dato faltante |
| 18 | `openvpn/services/vpn-cliente.service.ts:893` | Envuelve el bucle de #17 | Mismo riesgo que #17 |
| 19 | `sistema/sistema.service.ts:172` | Lectura de archivo de versión local | Bookkeeping — panel de Centro de Operaciones, solo display |
| 20 | `sistema/sistema.service.ts:275` | Comparación de versión remota disponible | Bookkeeping — solo display |
| 21 | `sistema/sistema.service.ts:285` | Lectura de uso de disco (`df -h`) | Bookkeeping — solo display |
| 22 | `sistema/sistema.service.ts:298` | Lectura de métricas de proceso PM2 | Bookkeeping — solo display |

*(22 numerados arriba; el recuento de 23 incluye la línea 1178, que envuelve un `catch{}`
anidado ya contado como #6 — ver nota bajo la tabla.)*

**5 marcados `⚠️ Revisar`** son los que se apartan de "bookkeeping/display de bajo riesgo": dos
tocan credenciales cifradas (mensajería), uno toca el propio mecanismo de licenciamiento, uno
es el caso ya conocido de B-16 sobre VPN, y uno toca directamente el invariante de IPs VPN
permanentes que CLAUDE.md declara crítico.

---

## 3. `.catch(() => {})` — 83 sitios, por grupo

Agrupados por módulo y patrón, porque describir 83 líneas una por una diluye la señal de las
que de verdad importan. El detalle completo (archivo:línea) queda en el grep que produjo este
censo — reproducible con el comando de la nota metodológica al final.

| Grupo | Módulo(s) | Sitios | Ya documentado inline | Clasificación |
|---|---|---|---|---|
| A | `olt-nativo` (crons, `provision-ftth.service.ts`, `ftth-operacion-lock.service.ts`, `compensador-wizard.service.ts`, `olt-automation.client.ts`, `olt-nativo.controller.ts`) | 22 | **Sí, casi todos** (`/* best-effort: ... */`, `/* la bitácora nunca aborta */`, `/* puede no haberse asignado */`) | Bookkeeping y liberación de pool best-effort — el patrón dominante de este módulo, y el mejor documentado de los 106 sitios del censo |
| B | `olt-nativo/ztp` (`genieacs.driver.ts`, `onu-tr069-detalle.service.ts`) | 13 | Parcial (limpieza de tasks/faults de GenieACS, sin comentario explícito en la mayoría) | Housekeeping de la cola de tareas TR-069 — protegido por D-41 (no se toca la lógica interna sin autorización), riesgo bajo-medio: una limpieza de tarea fallida deja una tarea vieja en la cola, no rompe la operación en curso |
| C | `mikrotik` (`firewall.service.ts`, `mikrotik-user.service.ts`, `mikrotik.service.ts`) | 6 | No | 2 sitios son cierre de conexión en `finally` (bajo riesgo); 4 sitios son en `MikrotikUserService`, servicio **confirmado sin ningún consumidor en el resto del código** durante la Ola 1 (grupo 3b) — código muerto, prioridad nula |
| D | `crm-nativo` (`wa-client.service.ts`, `crm-nativo.gateway.ts`) | 6 | No | Cierre de cliente WhatsApp, envío de eventos de socket, lookups internos — bajo riesgo, WhatsApp ya tiene su propio ciclo de reconexión |
| E | `notificaciones` (`gateway-mensajeria.service.ts`, `notification-event.listener.ts`) | 4 | No | 2 son invalidación de caché (autocorrige en el siguiente `get`); 2 son *logging de que un log falló* (meta-fallback, ya es el camino de menor prioridad) |
| F | **`outbox-red/outbox-red.service.ts`** | 4 | No | Actualizaciones de bookkeeping (`mikrotik_aplicado`, inserciones en `servicios_historial`) que corren **después** de que el `ResultadoOperacion` principal ya fue `esExito()` — si fallan, el efecto real (mikrotik) ya se aplicó, pero la bandera/historial queda desincronizada de forma silenciosa. Riesgo de auditoría, no operativo |
| G | `licencia` (`licencia.controller.ts`, `.cron.ts`, `.service.ts`) | 6 | No | Revalidación online / persistencia de licencia en segundo plano — mismo módulo que el `catch{}` #9 de la tabla anterior; el patrón de "silencio ante fallo de licencia" se repite 7 veces contando ambas tablas |
| H | `usuarios/usuarios.service.ts` | 3 | No | Email de bienvenida, email de cambio de contraseña, inserción de auditoría — el usuario/acción principal ya se completó; el abonado del email no se entera si el envío falla |
| I | `xui/xui-lines.service.ts` | 2 | No (nombres autodescriptivos: `intentarSincronizarCreacion/Eliminacion`) | Ya forman parte de un bucle de reintento explícito por nombre — bajo riesgo |
| J | `sistema/sistema.service.ts` | 2 | No | Invalidación de caché de horarios/config — autocorrige |
| K | `clientes/clientes.service.ts` | 1 | Sí (`// ignorar si ya no existe`) | Borrado de foto antigua al reemplazarla — documentado, bajo riesgo |
| L | `health/health.service.ts`, `install/install.service.ts`, `backup/backup.service.ts`, `mensajeria/mensajeria.worker.ts`, `monitoreo/monitoreo.service.ts` | 5 | Parcial | Sitios sueltos de un solo caso cada uno — conexión redis ya conectada, cierre de datasource del instalador, limpieza de tmpdir, log de fallo de cola, invalidación de pool tras cambiar credenciales. Todos bajo riesgo |

**Grupo F (`outbox-red.service.ts`) es el único que toca directamente el Core** de los que no
están ya documentados — vale la pena señalarlo aparte: los otros tres módulos con conteos altos
(A, B) son técnicos (`olt-nativo`) y ya llevan la mejor documentación del censo.

---

## 4. Qué NO se decide en este documento

Por instrucción explícita: este es un inventario, no un lote de correcciones. No se ha tocado
ni una línea de los 106 sitios. Lo que sigue es material para decidir, no una decisión:

- Los **5** de `catch {}` marcados `⚠️ Revisar` (§2) y el **grupo F** de `.catch(()=>{})`
  (§3) son los candidatos más claros a intervención — tocan credenciales, licenciamiento, el
  invariante de IPs VPN o el Core — pero intervenir es un lote aparte, con su propia revisión.
- Los grupos A y B, aunque numerosos, ya cumplen el criterio de B-16 ("documentado por qué es
  intencional") en su mayoría — su prioridad de corrección es baja precisamente por eso.
- El sub-alcance no cubierto (`ResultadoOperacion` descartado sin comprobar clase, §1) sigue
  abierto — no se estimó aquí cuántos sitios tendría ni se intentó localizarlos.

---

## 5. Nota metodológica (reproducible)

```bash
# catch {} vacío
grep -rnE "catch\s*\{\s*\}|catch\s*\([a-zA-Z_]*\)\s*\{\s*\}" backend/src/ --include="*.ts" | grep -v "\.spec\.ts"

# .catch(() => {}) — con o sin comentario dentro
grep -rnE "\.catch\(\s*\(\)\s*=>\s*\{?\s*(/\*[^*]*\*/)?\s*\}?\s*\)" backend/src/ --include="*.ts" | grep -v "\.spec\.ts"
```

2 coincidencias del segundo patrón resultaron ser comentarios de código que **mencionan**
`.catch(() => {})` al explicar un bug ya corregido (`contratos.service.ts:353/423`,
`clientes.service.ts:769`) — descontadas del recuento de §1, verificadas a mano.
