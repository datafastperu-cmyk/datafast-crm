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

// La raiz se deduce de donde vive ESTE fichero, no se escribe.
//
// Antes eran 14 rutas absolutas a /opt/datafast. Eso obligaba al instalador a generar su
// PROPIO ecosystem con ${INSTALL_DIR} interpolado -- y el suyo declaraba un unico proceso
// `datafast-backend` sin RUN_CRONS, asi que toda instalacion nueva nacia SIN WORKER: sin
// cortes por mora, sin reactivaciones, sin drenado del outbox hacia OLT y MikroTik, y sin
// que nada diera error (desviacion B-14).
//
// Dos autores para el mismo fichero, y el que ganaba era el equivocado. Derivando la raiz,
// este fichero sirve en cualquier directorio de instalacion y el instalador puede usarlo
// tal cual, que es lo que ADR-011 manda desde el principio.
const RAIZ = __dirname;

module.exports = {
  apps: [

    // ── API Core — atiende al frontend. NO ejecuta crons. ────────────────────
    {
      name:      'datafast-api-core',
      script:    'dist/main.js',
      cwd:       `${RAIZ}/backend`,
      exec_mode: 'fork',
      instances: 1,

      env: {
        NODE_ENV:       'production',
        RUN_CRONS:      'false',
        // ÚNICO proceso que migra: api-core y worker arrancan a la vez y competían por las
        // migraciones (2026-07-21, "duplicate key ... pg_type_typname_nsp_index").
        RUN_MIGRATIONS: 'true',
        // Chromium no arranca aquí: es un módulo complementario y no puede competir
        // por la memoria del proceso que atiende al ERP (ver datafast-whatsapp).
        WA_ENABLED:     'false',
        PORT:           4000,
        DB_POOL_MAX:    '15',
        DB_POOL_MIN:    '2',
        TZ:             'America/Lima',
      },

      max_memory_restart: '1G',
      restart_delay:      4000,
      min_uptime:         '10s',
      max_restarts:       10,

      out_file:        `${RAIZ}/logs/api-core-out.log`,
      error_file:      `${RAIZ}/logs/api-core-error.log`,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      watch:           false,
    },

    // ── Worker Auxiliary — crons, colas y watchers. NO migra. ────────────────
    {
      name:      'datafast-worker-auxiliary',
      script:    'dist/main.js',
      cwd:       `${RAIZ}/backend`,
      exec_mode: 'fork',
      instances: 1,

      env: {
        NODE_ENV:       'production',
        RUN_CRONS:      'true',
        RUN_MIGRATIONS: 'false',
        // Tampoco aquí: este proceso corre el outbox de red y los crons de
        // facturación. Hasta el 30/07/2026 alojaba Chromium por derivar el host de
        // RUN_CRONS, y el VPS llegó a 87 MB libres con el worker en riesgo de que
        // PM2 lo matara por memoria.
        WA_ENABLED:     'false',
        PORT:           4001,
        DB_POOL_MAX:    '15',
        DB_POOL_MIN:    '2',
        TZ:             'America/Lima',
      },

      max_memory_restart: '800M',
      restart_delay:      4000,
      min_uptime:         '10s',
      max_restarts:       10,

      out_file:        `${RAIZ}/logs/worker-out.log`,
      error_file:      `${RAIZ}/logs/worker-error.log`,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      watch:           false,
    },

    // ── CRM WhatsApp — único proceso que aloja Chromium. NO migra, NO crons. ─
    // Aislado a propósito: es un módulo complementario (atención al cliente desde
    // el ERP, y a futuro un chatbot). Si Chromium se descontrola muere solo, sin
    // arrastrar ni la API ni el outbox de red. nginx le enruta /api/v1/crm-nativo/
    // y /wa-socket/; el resto de rutas de este proceso no las usa nadie.
    {
      name:      'datafast-whatsapp',
      script:    'dist/main.js',
      cwd:       `${RAIZ}/backend`,
      exec_mode: 'fork',
      instances: 1,

      env: {
        NODE_ENV:       'production',
        RUN_CRONS:      'false',
        RUN_MIGRATIONS: 'false',
        WA_ENABLED:     'true',
        PORT:           4002,
        // Pool mínimo: este proceso solo persiste chats y mensajes del CRM.
        DB_POOL_MAX:    '5',
        DB_POOL_MIN:    '1',
        TZ:             'America/Lima',
      },

      // Node + Chromium en un VPS de 1.9 GB. El límite es del proceso Node; los
      // hijos de Chromium no cuentan a este RSS, por eso el corte por QR no
      // escaneado (wa-client.service.ts) es lo que realmente los libera.
      max_memory_restart: '600M',
      restart_delay:      8000,
      min_uptime:         '20s',
      max_restarts:       10,

      out_file:        `${RAIZ}/logs/whatsapp-out.log`,
      error_file:      `${RAIZ}/logs/whatsapp-error.log`,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      watch:           false,
    },

    // ── OLT Automation Service (Python/FastAPI) ──────────────────────────────
    {
      name:        'olt-automation-service',
      script:      `${RAIZ}/olt-automation-service/venv/bin/uvicorn`,
      // NUNCA `--reload` en producción: WatchFiles reinicia uvicorn al tocar cualquier
      // archivo y un `git reset --hard` de deploy lo dispara en medio de una operación
      // contra la OLT. Causó el timeout que abortó una Fase 2 WAN y dejó un ONT huérfano
      // (2026-07-21). 1 worker a propósito: cada worker abre sus propias sesiones SSH y el
      // MA5800 tiene un límite bajo de VTY concurrentes.
      args:        'app.main:app --host 127.0.0.1 --port 8001 --workers 1',
      cwd:         `${RAIZ}/olt-automation-service`,
      interpreter: 'none',
      exec_mode:   'fork',
      instances:   1,

      env_file: `${RAIZ}/olt-automation-service/.env`,
      env: {
        PYTHONPATH: `${RAIZ}/olt-automation-service`,
        TZ:         'America/Lima',
      },

      max_memory_restart: '256M',
      restart_delay:      5000,
      min_uptime:         '10s',
      max_restarts:       10,

      out_file:        `${RAIZ}/logs/olt-out.log`,
      error_file:      `${RAIZ}/logs/olt-error.log`,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      watch:           false,
    },

    // ── Frontend Next.js ─────────────────────────────────────────────────────
    {
      name:      'datafast-frontend',
      script:    'node_modules/.bin/next',
      args:      'start',
      cwd:       `${RAIZ}/frontend`,
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

      out_file:        `${RAIZ}/logs/frontend-out.log`,
      error_file:      `${RAIZ}/logs/frontend-error.log`,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      watch:           false,
    },

  ],
};
