import { Client } from 'ssh2';

const conn = new Client();

const SQL = `
-- 1782100000000: AddProyectoInversionIdToEgresosIngresos
ALTER TABLE egresos_ingresos
  ADD COLUMN IF NOT EXISTS proyecto_inversion_id UUID NULL
    REFERENCES proyectos_inversion(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_egresos_ingresos_proyecto_inversion_id
  ON egresos_ingresos (proyecto_inversion_id)
  WHERE proyecto_inversion_id IS NOT NULL;

-- 1782200000000: AddTelefonoInformativoToEmpresas
ALTER TABLE empresas
  ADD COLUMN IF NOT EXISTS telefono_informativo VARCHAR(30) NULL;

-- 1782300000000: RenamePhoneToWhatsappCorporativoInEmpresas
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'empresas' AND column_name = 'telefono'
  ) THEN
    ALTER TABLE empresas RENAME COLUMN telefono TO whatsapp_corporativo;
  END IF;
END $$;

-- Register all in typeorm_migrations
INSERT INTO typeorm_migrations (name, timestamp) VALUES
  ('AddProyectoInversionIdToEgresosIngresos1782100000000', 1782100000000),
  ('AddTelefonoInformativoToEmpresas1782200000000',        1782200000000),
  ('RenamePhoneToWhatsappCorporativoInEmpresas1782300000000', 1782300000000)
ON CONFLICT DO NOTHING;
`.trim();

conn.on('ready', () => {
  console.log('✓ SSH conectado');

  // Step 1: get DB credentials
  conn.exec(`cat /opt/datafast/backend/.env.production`, { pty: false }, (err, stream) => {
    if (err) { console.error(err.message); conn.end(); return; }
    let raw = '';
    stream.on('data', d => raw += d.toString());
    stream.on('close', () => {
      const env = {};
      for (const line of raw.split('\n')) {
        const m = line.match(/^([A-Z_]+)=(.+)$/);
        if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
      }
      const host = env.DATABASE_HOST || env.DB_HOST || 'localhost';
      const port = env.DATABASE_PORT || env.DB_PORT || '5432';
      const db   = env.DATABASE_NAME || env.DB_NAME || 'datafast_db';
      const user = env.DATABASE_USER || env.DB_USER || 'datafast_db_user';
      const pass = env.DATABASE_PASSWORD || env.DB_PASSWORD || '';
      console.log(`DB: ${user}@${host}:${port}/${db}`);

      // Step 2: apply migrations
      const migCmd = `PGPASSWORD='${pass}' psql -h ${host} -p ${port} -U ${user} -d ${db} <<'SQLEOF'\n${SQL}\nSQLEOF`;
      conn.exec(migCmd, { pty: false }, (err2, s2) => {
        if (err2) { console.error(err2.message); conn.end(); return; }
        s2.on('data', d => process.stdout.write(d.toString()));
        s2.stderr.on('data', d => process.stderr.write(d.toString()));
        s2.on('close', (code) => {
          console.log(`\n✓ Migraciones aplicadas (psql exit: ${code})`);
          if (code !== 0) { conn.end(); return; }

          // Step 3: pull + compile backend + restart
          const buildCmd = [
            'cd /opt/datafast && git pull origin main',
            'pm2 stop datafast-backend 2>/dev/null || true',
            'cd /opt/datafast/backend && NODE_OPTIONS="--max-old-space-size=1400" node_modules/.bin/tsc -p tsconfig.build.json --skipLibCheck 2>&1 | tail -20',
            'pm2 start datafast-backend',
          ].join(' && ');

          conn.exec(buildCmd, { pty: false }, (err3, s3) => {
            if (err3) { console.error(err3.message); conn.end(); return; }
            s3.on('data', d => process.stdout.write(d.toString()));
            s3.stderr.on('data', d => process.stderr.write(d.toString()));
            s3.on('close', (code3) => {
              console.log(`\n✓ Backend build (exit: ${code3})`);
              if (code3 !== 0) { conn.end(); return; }

              // Step 4: build frontend + restart
              const feCmd = [
                'pm2 stop datafast-frontend 2>/dev/null || true',
                'cd /opt/datafast && node rebuild-fe.mjs 2>&1 | tail -15',
                'pm2 start datafast-frontend',
                'pm2 status',
              ].join(' && ');

              conn.exec(feCmd, { pty: false }, (err4, s4) => {
                if (err4) { console.error(err4.message); conn.end(); return; }
                s4.on('data', d => process.stdout.write(d.toString()));
                s4.stderr.on('data', d => process.stderr.write(d.toString()));
                s4.on('close', (code4) => {
                  console.log(`\n✓ Frontend build (exit: ${code4})`);
                  conn.end();
                });
              });
            });
          });
        });
      });
    });
  });
}).connect({
  host: '149.34.48.224', port: 22,
  username: 'root', password: '10471687648',
  readyTimeout: 20000,
});
conn.on('error', e => { console.error('SSH error:', e.message); process.exit(1); });
