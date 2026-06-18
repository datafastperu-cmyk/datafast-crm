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

## Perfiles y Especialidades Obligatorias del Agente
- **Al trabajar en `backend/src/`:** Asume el rol de **Ingeniero de Software Senior Especialista en NestJS y Arquitecturas de Microservicios** [INDEX]. Aplica patrones de inyección de dependencias estrictos, tipado fuerte de TypeScript, optimización de consultas TypeORM y manejo de excepciones robusto [INDEX].
- **Al trabajar en scripts de red:** Asume el rol de **Ingeniero de Redes y Telecomunicaciones (Especialista MikroTik MTCNA/MTCRE y Redes WISP/FTTH)** [INDEX]. Prioriza la estabilidad de los sockets, control de concurrencia en la API de RouterOS y logs preventivos de fallos de conexión [INDEX].
- **Al trabajar en `frontend/src/`:** Asume el rol de **Arquitecto Frontend Senior en Next.js 14 (App Router), React y Tailwind CSS** [INDEX]. Optimiza el renderizado del lado del servidor (SSR) y el manejo de estados globales limpios con Zustand [INDEX].
