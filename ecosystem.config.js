// ─────────────────────────────────────────────────────────────────────────────
// CRM ISP DATAFAST — PM2 Ecosystem (FUENTE DE VERDAD ÚNICA)
// ─────────────────────────────────────────────────────────────────────────────
// Este archivo describe los CUATRO procesos de producción. Antes estaban repartidos
// entre tres archivos —uno de ellos (`ecosystem.dev.config.js`) SIN VERSIONAR— y lo que
// realmente corría no coincidía con lo declarado en el repo: una instalación nueva no era
// reproducible. De ahí salió, entre otras cosas, el `--reload` de uvicorn en producción.
//
// REGLAS:
//  · Cualquier cambio de arranque se hace AQUÍ y se despliega; nunca con `pm2 start` manual.
//  · Prohibido poner IPs, dominios o secretos: van en los `.env` de cada VPS
//    (ver § Portabilidad Multi-VPS en CLAUDE.md).
//  · Las apps de backend NO reciben credenciales por `env`: las lee la propia aplicación
//    desde `.env.production` vía ConfigModule. PM2 solo declara lo que distingue a cada
//    proceso (rol, puerto, límites).
//
// Aplicar:  pm2 delete all && pm2 start ecosystem.config.js && pm2 save
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  apps: [

    // ── API Core — atiende al frontend. NO ejecuta crons. ────────────────────
    {
      name:      'datafast-api-core',
      script:    'dist/main.js',
      cwd:       '/opt/datafast/backend',
      exec_mode: 'fork',
      instances: 1,

      env: {
        NODE_ENV:       'production',
        RUN_CRONS:      'false',
        // ÚNICO proceso que migra: api-core y worker arrancan a la vez y competían por las
        // migraciones (2026-07-21, "duplicate key ... pg_type_typname_nsp_index").
        RUN_MIGRATIONS: 'true',
        PORT:           4000,
        DB_POOL_MAX:    '15',
        DB_POOL_MIN:    '2',
        TZ:             'America/Lima',
      },

      max_memory_restart: '1G',
      restart_delay:      4000,
      min_uptime:         '10s',
      max_restarts:       10,

      out_file:        '/opt/datafast/logs/api-core-out.log',
      error_file:      '/opt/datafast/logs/api-core-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      watch:           false,
    },

    // ── Worker Auxiliary — crons, colas y watchers. NO migra. ────────────────
    {
      name:      'datafast-worker-auxiliary',
      script:    'dist/main.js',
      cwd:       '/opt/datafast/backend',
      exec_mode: 'fork',
      instances: 1,

      env: {
        NODE_ENV:       'production',
        RUN_CRONS:      'true',
        RUN_MIGRATIONS: 'false',
        PORT:           4001,
        DB_POOL_MAX:    '15',
        DB_POOL_MIN:    '2',
        TZ:             'America/Lima',
      },

      max_memory_restart: '800M',
      restart_delay:      4000,
      min_uptime:         '10s',
      max_restarts:       10,

      out_file:        '/opt/datafast/logs/worker-out.log',
      error_file:      '/opt/datafast/logs/worker-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      watch:           false,
    },

    // ── OLT Automation Service (Python/FastAPI) ──────────────────────────────
    {
      name:        'olt-automation-service',
      script:      '/opt/datafast/olt-automation-service/venv/bin/uvicorn',
      // NUNCA `--reload` en producción: WatchFiles reinicia uvicorn al tocar cualquier
      // archivo y un `git reset --hard` de deploy lo dispara en medio de una operación
      // contra la OLT. Causó el timeout que abortó una Fase 2 WAN y dejó un ONT huérfano
      // (2026-07-21). 1 worker a propósito: cada worker abre sus propias sesiones SSH y el
      // MA5800 tiene un límite bajo de VTY concurrentes.
      args:        'app.main:app --host 127.0.0.1 --port 8001 --workers 1',
      cwd:         '/opt/datafast/olt-automation-service',
      interpreter: 'none',
      exec_mode:   'fork',
      instances:   1,

      env_file: '/opt/datafast/olt-automation-service/.env',
      env: {
        PYTHONPATH: '/opt/datafast/olt-automation-service',
        TZ:         'America/Lima',
      },

      max_memory_restart: '256M',
      restart_delay:      5000,
      min_uptime:         '10s',
      max_restarts:       10,

      out_file:        '/opt/datafast/logs/olt-out.log',
      error_file:      '/opt/datafast/logs/olt-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      watch:           false,
    },

    // ── Frontend Next.js ─────────────────────────────────────────────────────
    {
      name:      'datafast-frontend',
      script:    'node_modules/.bin/next',
      args:      'start',
      cwd:       '/opt/datafast/frontend',
      exec_mode: 'fork',
      instances: 1,

      // Entorno MÍNIMO a propósito. El proceso que corría hasta 2026-07-22 arrastraba, por
      // haberse lanzado desde una shell con el .env del backend cargado, TODOS los secretos:
      // DB_PASSWORD, ENCRYPTION_KEY, JWT_SECRET, REDIS_PASSWORD… El frontend es el proceso
      // expuesto y no necesita ninguno: en runtime solo usa NODE_ENV; sus NEXT_PUBLIC_* se
      // hornean en tiempo de build desde los .env del propio frontend.
      env: {
        NODE_ENV: 'production',
        PORT:     3000,
        TZ:       'America/Lima',
      },

      max_memory_restart: '512M',
      restart_delay:      8000,
      min_uptime:         '10s',
      max_restarts:       10,
      listen_timeout:     30000,

      out_file:        '/opt/datafast/logs/frontend-out.log',
      error_file:      '/opt/datafast/logs/frontend-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      watch:           false,
    },

  ],
};
