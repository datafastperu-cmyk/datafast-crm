// PM2 multi-proceso: API Core (sin crons) + Worker Auxiliary (crons + queues)
// Uso: pm2 start ecosystem.config.js
// Stop viejo: pm2 delete datafast-backend (antes de aplicar este config)
module.exports = {
  apps: [
    {
      name: 'datafast-api-core',
      script: 'dist/main.js',
      cwd: '/opt/datafast/backend',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '1G',
      out_file: '/opt/datafast/logs/api-core-out.log',
      error_file: '/opt/datafast/logs/api-core-error.log',
      env: {
        NODE_ENV: 'production',
        RUN_CRONS: 'false',
        // Este proceso es el ÚNICO que ejecuta migraciones (ver worker: RUN_MIGRATIONS='false').
        RUN_MIGRATIONS: 'true',
        PORT: 4000,
        DB_POOL_MAX: '15',
        DB_POOL_MIN: '2',
      },
    },
    {
      name: 'datafast-worker-auxiliary',
      script: 'dist/main.js',
      cwd: '/opt/datafast/backend',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '800M',
      out_file: '/opt/datafast/logs/worker-out.log',
      error_file: '/opt/datafast/logs/worker-error.log',
      env: {
        NODE_ENV: 'production',
        RUN_CRONS: 'true',
        // NO migra: api-core y worker arrancan a la vez y competían por las migraciones
        // (2026-07-21, CreateFtthOperacionLock: "duplicate key ... pg_type_typname_nsp_index").
        RUN_MIGRATIONS: 'false',
        PORT: 4001,
        DB_POOL_MAX: '15',
        DB_POOL_MIN: '2',
      },
    },
  ],
};
