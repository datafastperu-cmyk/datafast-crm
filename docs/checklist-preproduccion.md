# Checklist Pre-Producción — DATAFAST ISP ERP

Script de verificación que confirma que el sistema está listo para operar en producción.
Se ejecuta en el servidor de **staging** antes de cualquier go-live.

---

## Ubicación

```
/opt/datafast/scripts/check-preproduccion.sh
```

El script llega al servidor automáticamente durante la instalación (`install.sh`).
No requiere descarga manual.

---

## Uso

### Ejecutar verificación completa

```bash
sudo bash /opt/datafast/scripts/check-preproduccion.sh
```

Requiere `sudo` porque verifica firewall, permisos de archivos y servicios del sistema.

### Retirar el script del servidor

Una vez que el sistema está en producción y ya no se necesita:

```bash
sudo bash /opt/datafast/scripts/check-preproduccion.sh --remove
```

Pide confirmación antes de borrar. Elimina el script y sus reportes de log.
**No toca logs de la aplicación ni datos de la base de datos.**

---

## Qué verifica

### Bloque 1 — Servicios activos

| Verificación | Resultado si falla |
|---|---|
| PostgreSQL responde en `localhost:5432` | Bloqueante |
| Redis responde con PONG en `localhost:6379` | Bloqueante |
| Evolution API responde en `localhost:8080` | Advertencia |
| OpenVPN servicio activo | Advertencia |
| PM2 proceso `datafast-backend` en estado `online` | Bloqueante |
| PM2 proceso `datafast-frontend` en estado `online` | Bloqueante |

### Bloque 2 — Aplicación

| Verificación | Resultado si falla |
|---|---|
| `GET /api/v1/health` devuelve HTTP 200 | Bloqueante |
| Frontend devuelve HTTP 200 / 307 en puerto 3000 | Bloqueante |
| Sin migraciones pendientes (`migration:show`) | Bloqueante |

### Bloque 3 — Nginx y SSL

| Verificación | Resultado si falla |
|---|---|
| Nginx servicio activo | Bloqueante |
| `nginx -t` sin errores de configuración | Bloqueante |
| Puerto 80 responde | Bloqueante |
| Puerto 443 con conexión SSL | Bloqueante |
| Redirect HTTP → HTTPS activo | Advertencia |
| Certificado SSL válido por más de 30 días | Advertencia |
| Certificado SSL válido por más de 7 días | Bloqueante |
| Header `X-Frame-Options` presente | Advertencia |
| Header `Strict-Transport-Security` (HSTS) presente | Advertencia |

### Bloque 4 — Backup

| Verificación | Resultado si falla |
|---|---|
| Script `backup.sh` existe en el servidor | Bloqueante |
| Backup ejecuta sin errores | Bloqueante |
| Archivo `.gz` generado pasa prueba de integridad | Bloqueante |
| Cron de backup registrado (`0 2 * * *`) | Advertencia |

### Bloque 5 — Firewall

| Puerto | Esperado | Resultado si no cumple |
|---|---|---|
| 22 (SSH) | Abierto | Advertencia |
| 80 (HTTP) | Abierto | Advertencia |
| 443 (HTTPS) | Abierto | Advertencia |
| 1194 (OpenVPN) | Abierto | Advertencia |
| 4000 (backend interno) | **Cerrado** | **Bloqueante** |
| 3000 (frontend interno) | **Cerrado** | **Bloqueante** |
| 5432 (PostgreSQL) | **Cerrado** | **Bloqueante** |
| 6379 (Redis) | **Cerrado** | **Bloqueante** |
| 8080 (Evolution API) | **Cerrado** | **Bloqueante** |
| 5050 (pgAdmin) | **Cerrado** | **Bloqueante** |
| 8081 (Redis Commander) | **Cerrado** | **Bloqueante** |

### Bloque 6 — Seguridad

| Verificación | Resultado si falla |
|---|---|
| Fail2Ban activo | Advertencia |
| `.env.production` con permisos `600` | Bloqueante |
| `secrets.conf` con permisos `600` | Bloqueante |
| SSH root login deshabilitado | Advertencia |
| `JWT_SECRET` no es un valor por defecto | Bloqueante |

---

## Tipos de resultado

| Símbolo | Significado | Acción requerida |
|---|---|---|
| `[✓]` | OK | Ninguna |
| `[!] ← ADVERTENCIA` | Riesgo menor | Revisar antes del go-live |
| `[✗] ← BLOQUEANTE` | Error crítico | **Corregir antes de pasar a producción** |

---

## Resultado final

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Resultado: 18 OK  2 advertencias  1 bloqueantes  (21 total)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ✗  NO listo para producción — corregir los 1 punto(s) bloqueante(s)
```

- **0 bloqueantes, 0 advertencias** → listo para producción
- **0 bloqueantes, advertencias** → puede ir con precaución, revisar cada advertencia
- **1 o más bloqueantes** → no ir a producción hasta corregirlos

El script retorna **exit code 1** si hay bloqueantes, útil para pipelines CI/CD.

---

## Reporte de log

Cada ejecución genera un reporte en:

```
/opt/datafast/logs/checklist-YYYYMMDD_HHMMSS.txt
```

Útil para llevar registro de verificaciones antes de cada deploy.

---

## Cuándo ejecutarlo

| Momento | Acción |
|---|---|
| Antes del primer go-live | Ejecutar y resolver todos los bloqueantes |
| Antes de cada actualización mayor | Ejecutar como parte del proceso de deploy |
| Después de renovar certificados SSL | Ejecutar bloque 3 mentalmente o script completo |
| Sistema ya estable en producción | Retirar con `--remove` |

---

## Flujo completo de instalación a producción

```
1. Instalar en desarrollo
   sudo bash install.sh --dev

2. Desarrollar y probar funcionalidades

3. Instalar en staging (servidor separado, dominio real)
   sudo bash install.sh

4. Ejecutar checklist en staging
   sudo bash /opt/datafast/scripts/check-preproduccion.sh

5. Corregir bloqueantes y advertencias

6. Pasar a producción
   bash deploy.sh

7. Retirar el checklist del servidor de producción
   sudo bash /opt/datafast/scripts/check-preproduccion.sh --remove
```
