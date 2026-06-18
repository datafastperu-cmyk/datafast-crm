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
        PORT: 4001,
        DB_POOL_MAX: '15',
        DB_POOL_MIN: '2',
      },
    },
  ],
};
