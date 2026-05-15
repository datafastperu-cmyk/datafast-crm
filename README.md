# CRM ISP DATAFAST

Sistema ERP/CRM completo para proveedores de internet FTTH y WISP.

## Stack

- **Backend**: Node.js + NestJS + TypeORM
- **Frontend**: Next.js 14 + TailwindCSS
- **Base de datos**: PostgreSQL 16 + Redis 7
- **Infraestructura**: Docker + Nginx + SSL

---

## Inicio Rápido (Desarrollo)

```bash
# 1. Clonar el repositorio
git clone https://github.com/tuempresa/datafast-crm.git
cd datafast-crm

# 2. Configurar variables de entorno
cp .env.example .env
# Editar .env con tus valores

# 3. Levantar en modo desarrollo
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d

# 4. Ver logs
docker compose logs -f backend
```

Acceder a:
- Panel admin: http://localhost (o http://localhost:80)
- API directa: http://localhost:3000
- Swagger docs: http://localhost:3000/api/docs
- pgAdmin: http://localhost:5050
- Redis Commander: http://localhost:8081

---

## Deploy en Producción

### Requisitos del servidor
- Ubuntu 22.04 LTS (recomendado)
- CPU: 2 cores mínimo (4 recomendado)
- RAM: 4GB mínimo (8GB recomendado)
- Disco: 40GB SSD mínimo
- Dominio configurado con DNS apuntando al servidor

### Paso a paso

```bash
# 1. Configurar servidor (como root)
sudo bash scripts/setup.sh

# 2. Clonar proyecto
cd /opt
git clone https://github.com/tuempresa/datafast-crm.git datafast
cd datafast

# 3. Configurar variables
cp .env.example .env
nano .env          # Completar TODOS los valores

# 4. Obtener SSL (dominio debe apuntar al servidor)
bash scripts/ssl-setup.sh

# 5. Actualizar dominios en nginx
# Reemplazar "tudominio.com" en nginx/conf.d/*.conf
sed -i 's/tudominio.com/midominio.com/g' nginx/conf.d/*.conf

# 6. Levantar en producción
docker compose up -d

# 7. Verificar estado
docker compose ps
docker compose logs backend --tail=50
```

### Deploy de actualizaciones

```bash
bash scripts/deploy.sh
```

### Backup manual

```bash
bash scripts/backup.sh
```

---

## Variables de entorno obligatorias

Las siguientes variables son **obligatorias** para el funcionamiento básico:

| Variable | Descripción |
|----------|-------------|
| `DB_PASSWORD` | Password PostgreSQL |
| `REDIS_PASSWORD` | Password Redis |
| `JWT_SECRET` | Secret JWT (mínimo 64 chars) |
| `JWT_REFRESH_SECRET` | Secret refresh token |
| `ENCRYPTION_KEY` | Clave para cifrar passwords de routers |
| `APP_URL` | URL completa del panel admin |

Las demás variables son para integraciones opcionales (Yape, WhatsApp, RENIEC, etc.)

---

## Estructura del proyecto

Ver: `docs/estructura.txt`

---

## API Documentation

Swagger disponible en: `https://app.tudominio.com/api/docs`

---

## Secuencia de generación de módulos

1. **Fase 1**: Infraestructura + Auth + RBAC + Migraciones BD
2. **Fase 2**: Clientes + Planes + Contratos + Facturación + Pagos + IPv4
3. **Fase 3**: Mikrotik + SmartOLT + Aprovisionamiento + Monitoreo
4. **Fase 4**: Workers automáticos + Notificaciones + Tickets + WebSocket
5. **Fase 5**: Frontend Next.js completo + Portal del cliente

---

## Licencia

Propietario — CRM ISP DATAFAST © 2024
