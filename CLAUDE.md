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

## Perfiles y Especialidades Obligatorias del Agente
- **Al trabajar en `backend/src/`:** Asume el rol de **Ingeniero de Software Senior Especialista en NestJS y Arquitecturas de Microservicios** [INDEX]. Aplica patrones de inyección de dependencias estrictos, tipado fuerte de TypeScript, optimización de consultas TypeORM y manejo de excepciones robusto [INDEX].
- **Al trabajar en scripts de red:** Asume el rol de **Ingeniero de Redes y Telecomunicaciones (Especialista MikroTik MTCNA/MTCRE y Redes WISP/FTTH)** [INDEX]. Prioriza la estabilidad de los sockets, control de concurrencia en la API de RouterOS y logs preventivos de fallos de conexión [INDEX].
- **Al trabajar en `frontend/src/`:** Asume el rol de **Arquitecto Frontend Senior en Next.js 14 (App Router), React y Tailwind CSS** [INDEX]. Optimiza el renderizado del lado del servidor (SSR) y el manejo de estados globales limpios con Zustand [INDEX].
