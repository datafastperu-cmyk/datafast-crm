// ─────────────────────────────────────────────────────────────────────────────
// CRM ISP DATAFAST — PM2 Ecosystem (fuente de verdad única)
// ─────────────────────────────────────────────────────────────────────────────
// IMPORTANTE: Este archivo está en git. Cualquier cambio de configuración
// debe hacerse aquí y desplegarse con `scripts/update.sh`.
// NO usar `pm2 start` manual; siempre usar `pm2 start ecosystem.config.js`.
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  apps: [

    // ── Backend NestJS ───────────────────────────────────────────────────────
    {
      name:      'datafast-backend',
      script:    './dist/main.js',
      cwd:       '/opt/datafast/backend',
      instances: 1,
      exec_mode: 'fork',

      env_file: '/opt/datafast/backend/.env.production',
      env: {
        NODE_ENV:           'production',
        PORT:               4000,
        UV_THREADPOOL_SIZE: 8,
        TZ:                 'America/Lima',
        // ALLOWED_ORIGINS se lee del .env.production — no hardcodear IPs aquí
      },

      // Estabilidad
      max_memory_restart:        '900M',
      restart_delay:             4000,
      exp_backoff_restart_delay: 100,
      max_restarts:              10,
      min_uptime:                '10s',

      // Zero-downtime: PM2 espera 'ready' antes de enrutar tráfico
      wait_ready:     true,
      listen_timeout: 20000,
      kill_timeout:   10000,   // ms antes de SIGKILL tras SIGTERM

      // Logs
      log_file:        '/opt/datafast/logs/backend-combined.log',
      out_file:        '/opt/datafast/logs/backend-out.log',
      error_file:      '/opt/datafast/logs/backend-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs:      true,
      log_type:        'json',

      node_args: ['--max-old-space-size=768', '--optimize-for-size'],
      watch:     false,
    },

    // ── OLT Automation Service (Python/FastAPI) ──────────────────────────────
    {
      name:        'olt-automation-service',
      script:      '/opt/datafast/olt-automation-service/venv/bin/uvicorn',
      args:        'app.main:app --host 127.0.0.1 --port 8001 --workers 2',
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
      max_restarts:       10,
      min_uptime:         '10s',

      log_file:        '/opt/datafast/logs/olt-combined.log',
      out_file:        '/opt/datafast/logs/olt-out.log',
      error_file:      '/opt/datafast/logs/olt-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs:      true,

      watch: false,
    },

    // ── Frontend Next.js ─────────────────────────────────────────────────────
    //
    // USA server.js DIRECTAMENTE (no npm start).
    // Motivo: `npm start` crea una cadena de procesos (npm → sh → next-server).
    // PM2 mata npm con SIGTERM, pero el hijo `next-server` puede sobrevivir
    // unos milisegundos con el puerto 3000 todavía abierto. El nuevo proceso
    // arranca y choca → EADDRINUSE.
    //
    // Con `node server.js`, PM2 gestiona el proceso Node directamente.
    // server.js captura SIGTERM, llama server.close() y sale limpiamente
    // antes de que PM2 lance el reemplazo. Puerto liberado, sin colisión.
    {
      name:      'datafast-frontend',
      script:    'server.js',        // ← custom server, no npm
      cwd:       '/opt/datafast/frontend',
      instances: 1,
      exec_mode: 'fork',

      env_file: '/opt/datafast/frontend/.env.production',
      env: {
        NODE_ENV: 'production',
        PORT:     3000,
        HOSTNAME: '0.0.0.0',
        TZ:       'America/Lima',
      },

      // CRÍTICO: estos tres parámetros son los que evitan EADDRINUSE
      kill_timeout:   10000,   // PM2 espera 10 s tras SIGTERM antes de SIGKILL
      wait_ready:     true,    // PM2 espera process.send('ready') para continuar
      listen_timeout: 30000,   // tiempo máximo para recibir 'ready'

      max_memory_restart: '512M',
      restart_delay:      4000,
      max_restarts:       10,
      min_uptime:         '10s',

      log_file:        '/opt/datafast/logs/frontend-combined.log',
      out_file:        '/opt/datafast/logs/frontend-out.log',
      error_file:      '/opt/datafast/logs/frontend-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      watch: false,
    },
  ],
};
