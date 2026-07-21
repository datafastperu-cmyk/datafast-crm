# Contexto del Proyecto: ErpDatafast

## Stack Tecnológico Principal
- **Lenguaje base:** TypeScript (89.9%) / JavaScript (2.1%)
- **Backend / Scripts auxiliares:** Python (3.6%) / Shell (3.7%)

## Reglas de Codificación para el Equipo IA
- Responder y documentar siempre en **Idioma Español**.
- Mantener tipado estricto en TypeScript (evitar el uso de `any`).
- Seguir la arquitectura modular existente en el repositorio local.
- Respetar los formatos del linter o formateador del proyecto al guardar cambios.

## Directrices de Negocio Críticas

### VPN — Ciclo de vida de IPs (OpenVPN + MikroTik)
- **Las IPs VPN son permanentes.** Una vez que un cert conecta y recibe su IP del servidor, esa IP queda bloqueada en el CCD del servidor (`ifconfig-push`) para ese cert. OpenVPN nunca debe reasignar esa IP a otro equipo.
- **La IP solo se libera en dos casos:**
  1. El router es eliminado del sistema → `removeRouter` revoca todos los certs vinculados → se elimina el CCD → se mata el túnel.
  2. El wizard de registro se cierra/cancela sin completar el paso 3 → `fireRevoke` revoca el cert → se elimina el CCD → se mata el túnel.
- **Al eliminar un router o al cancelar el wizard, el túnel VPN con ese router debe eliminarse** (`revocar` → `killClienteVpnManagement` + borrar CCD). No dejarlo activo.
- **Implementación vigente:**
  - `validarTunel` escribe el CCD con `ifconfig-push` en el primer handshake (bloqueo inmediato de IP).
  - `revocar` elimina el CCD y mata la sesión → libera la IP.
  - `fireRevoke` en el wizard no tiene guard por túnel activo — siempre revoca al cerrar sin registrar.
  - Cron `limpiarWizardsAbandonados` (cada 30 min, corte a 2h) es red de seguridad adicional.
- **Nunca reutilizar un cert que ya tenga `vpnIp` asignada** sin verificar primero que esa IP no esté en uso por otro router activo en BD.

## Arquitectura de Resiliencia — Regla de Construcción Obligatoria

### Módulos Degradables: construir degradado desde el primer commit

Todo módulo nuevo que dependa de hardware físico, API externa, servicio de terceros o
infraestructura opcional (no es BD principal ni auth) **DEBE implementar el patrón degradado
desde el momento en que se crea el archivo `.service.ts`**. No se acepta construirlo primero
y aplicar el patrón después.

**Checklist obligatorio para cualquier módulo degradable nuevo:**

1. `implements OnModuleInit` en el servicio principal.
2. `onModuleInit()` ejecuta un probe ligero (ping, `which <cmd>`, check de env var, query mínima).
3. Si el probe falla → `this.moduleHealth.registrar('<nombre>', 'degraded', '<razón>')`. El módulo arranca igual.
4. Si el probe pasa → `this.moduleHealth.registrar('<nombre>', 'ok')`.
5. Métodos que requieren el recurso externo tienen `this.assertNotDegraded()` o retornan `ModuleResult<T>` estructurado.
6. **Nunca relanzar la excepción del probe** fuera del `onModuleInit` — eso crashearía el backend.

**Módulos/integraciones pendientes de construcción que DEBEN nacer degradados:**
- IPTV / Streaming (API externa XUI ONE u otra)
- Portal Cliente (backend/API para app móvil del abonado)
- Inventario / Almacén (descuento automático de stock)
- Pasarelas de pago adicionales (Webpay, Stripe, Culqi, etc.)
- Cualquier integración futura con APIs de terceros (RENIEC, SMS, SMTP propio, etc.)

**Módulos del Core Indestructible — NUNCA aplicar el patrón degradado:**
auth, usuarios, licencia, clientes, contratos, planes, facturacion, pagos (caja manual),
finanzas-opex, reportes, zonas, plantillas, config, schema-guard, auditoria.
Si alguno de estos falla en init → el backend debe crashear para proteger el servidor anterior en PM2.

## Verified Infrastructure Operations (VIO) — Regla de Construcción Obligatoria

### Aceptar una configuración no significa que la infraestructura la haya materializado

Origen: incidente 2026-07-17 (CNT-2026-000004). Una ONU Huawei EG8145V5 aceptó sin error
el comando OMCI del carril de gestión TR-069 (`ont ipconfig ... dhcp vlan 1600`) — la OLT
lo mostraba configurado — pero el firmware de la ONU nunca activó el IP-host (0 tramas
Ethernet emitidas, confirmado con sniffer durante un cold-boot físico real). El ERP reportó
"carril aplicado" durante días mientras la gestión remota estaba completamente muerta,
porque el código solo verificaba que el comando CLI no devolviera error — nunca verificó
que el cambio existiera realmente en el plano operativo.

**Regla:** toda operación mutante contra hardware externo (OLT, MikroTik, cualquier
dispositivo de red) tiene dos estados distintos, y el segundo NUNCA se asume a partir del
primero:

1. **Accepted** — el comando CLI/API no devolvió error. Esto es lo único que confirma
   `success: true` de un driver típico. **No es suficiente para marcar algo como aplicado.**
2. **Materialized/Verified** — existe evidencia observable, obtenida con un comando de
   lectura independiente (`display ...`), de que el cambio vive en el plano operativo.

**Checklist obligatorio para operaciones mutantes nuevas o modificadas sobre hardware
externo (OLT/MikroTik/etc.):**

1. Tras ejecutar el comando de escritura, ejecutar un comando de lectura independiente que
   confirme el efecto esperado (estado real del recurso, no el eco del comando).
2. Si la verificación falla o no puede confirmarse en un tiempo acotado, el método
   **NO reporta éxito silencioso** — distingue explícitamente "aceptado, sin confirmar" de
   "aplicado y confirmado" en el mensaje/resultado devuelto al operador.
3. La verificación no debe bloquear indefinidamente el flujo (usar reintentos acotados,
   p.ej. 3-4 intentos con backoff corto) — si el recurso puede tardar en converger de forma
   legítima (ej. DHCP), no fallar duro, pero sí dejar constancia de que no se confirmó.
4. Reutilizar/extender las funciones de verificación ya existentes en
   `olt-automation-service/app/services/provisioning.py` como referencia de patrón:
   `_undo_service_port_verificado`, `check_ont_wan_pppoe`, `check_ont_mgmt_ip`, y el loop de
   verificación de `rollback_gpon`/`suspend_onu`/`rehabilitate_onu`.

**Alcance de aplicación:** aplica a todo código **nuevo** o que se **modifique** por otra
razón (bug, feature) sobre drivers de hardware externo. No es mandato de refactor retroactivo
masivo de las funciones existentes del driver Huawei/MikroTik que hoy no verifican
materialización — se corrigen incrementalmente, una por una, la próxima vez que se toquen.

## Wizards y Modales — Regla de Construcción Obligatoria

### Un procedimiento no terminado se anula por completo

**Ningún wizard o modal que se cierre, por el motivo que sea, puede dejar procesos pendientes.**
Si se cierra sin completarse — botón X, Cancelar, ESC, click fuera, navegación, recarga,
cierre de pestaña, crash del navegador, pérdida de sesión — **todo lo que se ejecutó dentro
debe anularse**.

Origen: incidente 2026-07-21 (CNT-2026-000004). Un wizard de provisión FTTH cerrado a medias
dejó la ONU registrada en la OLT sin `ftth_onu_registro`, y una tarea async del carril TR-069
siguió corriendo contra un contrato que ya no tenía registro
(`carril (async): No hay registro FTTH para el contrato`). Resultado: ONU huérfana — discordancia
entre el plano físico (OLT) y el lógico (ERP).

**Checklist obligatorio para cualquier wizard/modal que toque hardware o reserve recursos**
(pools de service-port, ONU ID, IP de gestión, certs VPN, etc.):

1. **Ruta de anulación completa** invocada en TODOS los caminos de cierre — no solo en "Cancelar".
2. **El fire-and-forget debe ser cancelable/anulable.** Una tarea en vuelo (p.ej. el carril TR-069
   async) no puede sobrevivir a la muerte del wizard: se aborta o se revierte.
3. **Red de seguridad del lado servidor**, porque el cierre puede ser un crash y el navegador no
   alcanza a avisar: marca de "wizard en curso" con dueño y heartbeat/TTL, más un barrido que
   revierta lo iniciado si el wizard nunca confirmó término.
4. **Anular = revertir el hardware Y liberar los recursos reservados**, respetando el invariante
   de atomicidad: nunca borrar el registro con la OLT sucia (estado `fallido_rollback` +
   watcher `reintentarRollbacksFallidos`).
5. **Prohibir operaciones concurrentes sobre el mismo contrato/ONU.** Una desaprovisión y una
   provisión en vuelo simultáneas fueron causa directa de un huérfano (2026-07-21).

Referencia de patrón ya aplicado correctamente: el wizard de registro de routers VPN
(`fireRevoke` al cerrar sin completar el paso 3 + cron `limpiarWizardsAbandonados` como red
de seguridad).

## Portabilidad Multi-VPS — Regla Crítica de Configuración

Este ERP se instala en múltiples servidores VPS con IPs y dominios distintos.
**Ningún archivo del repositorio puede contener IPs, dominios o URLs de servidor hardcodeadas.**

### Qué nunca hacer

```typescript
// ❌ MAL — amarrado a una instalación concreta
const API_BASE = 'http://149.34.48.224:4000';
const VPS_IP   = '149.34.48.224';
```

```javascript
// ❌ MAL — ecosystem.config.js con IP fija
env: { APP_URL: 'http://149.34.48.224:4000' }
```

### Qué hacer siempre

```typescript
// ✅ BIEN — leído de process.env en tiempo de llamada (no de carga de módulo)
const getApiBase = () => (process.env.APP_URL || '').replace(/\/$/, '');
const getVpsIp   = () => process.env.VPN_SERVER_IP || process.env.APP_URL?.replace(/^https?:\/\//, '').split(':')[0] || '';
```

**Reglas concretas:**

1. **Variables de entorno, nunca literales.** Cualquier valor que cambie entre instalaciones (`APP_URL`, `VPN_SERVER_IP`, `VPN_SERVER_PORT`, dominio público, etc.) va en `.env.production` de cada VPS — nunca en código ni en `ecosystem.config.js`.

2. **Lazy getters para constantes de módulo.** Las constantes top-level en servicios NestJS se evalúan al cargar el módulo, *antes* de que `ConfigModule` lea el `.env`. Si el valor viene de `process.env`, conviértelo en función: `const getFoo = () => process.env.FOO`.

3. **`ecosystem.config.js` sin IPs.** Solo puede contener variables que no cambian entre servidores (`NODE_ENV`, `PORT`, `RUN_CRONS`, límites de memoria). Las vars de red van en `.env.production`.

4. **Scripts generados dinámicamente.** Scripts MikroTik, comandos CLI, URLs de descarga y endpoints que se envían a hardware externo deben construirse llamando a los getters en tiempo de ejecución, no interpolando constantes de módulo.

5. **`.env.example` como contrato.** Toda variable nueva que dependa del servidor debe documentarse en `.env.example` con un comentario que explique qué valor poner. Es la guía de instalación para un nuevo servidor.

### Checklist antes de hacer commit con cualquier URL o IP

- [ ] ¿El valor viene de `process.env`?
- [ ] Si es una constante de módulo, ¿es un lazy getter (función)?
- [ ] ¿`ecosystem.config.js` sigue sin IPs ni dominios?
- [ ] ¿`.env.example` documenta la variable?

## Perfiles y Especialidades Obligatorias del Agente
- **Al trabajar en `backend/src/`:** Asume el rol de **Ingeniero de Software Senior Especialista en NestJS y Arquitecturas de Microservicios** [INDEX]. Aplica patrones de inyección de dependencias estrictos, tipado fuerte de TypeScript, optimización de consultas TypeORM y manejo de excepciones robusto [INDEX].
- **Al trabajar en scripts de red:** Asume el rol de **Ingeniero de Redes y Telecomunicaciones (Especialista MikroTik MTCNA/MTCRE y Redes WISP/FTTH)** [INDEX]. Prioriza la estabilidad de los sockets, control de concurrencia en la API de RouterOS y logs preventivos de fallos de conexión [INDEX].
- **Al trabajar en `frontend/src/`:** Asume el rol de **Arquitecto Frontend Senior en Next.js 14 (App Router), React y Tailwind CSS** [INDEX]. Optimiza el renderizado del lado del servidor (SSR) y el manejo de estados globales limpios con Zustand [INDEX].
