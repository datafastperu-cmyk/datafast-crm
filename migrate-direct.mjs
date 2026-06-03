import { Client } from 'ssh2';
import { VPS } from './vps.config.mjs';

// Lee .env del VPS para obtener credenciales, luego ejecuta SQL via psql
const GET_ENV = `cat /opt/datafast/backend/.env.production 2>/dev/null || cat /opt/datafast/backend/.env 2>/dev/null | head -30`;

const conn = new Client();
conn.on('ready', () => {
  console.log('✓ SSH conectado — leyendo .env del VPS...');

  conn.exec(GET_ENV, { pty: false }, (err, stream) => {
    if (err) { console.error(err.message); conn.end(); return; }
    let envRaw = '';
    stream.on('data', d => envRaw += d.toString());
    stream.on('close', () => {
      // Parsear .env
      const env = {};
      for (const line of envRaw.split('\n')) {
        const m = line.match(/^([A-Z_]+)=(.+)$/);
        if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
      }

      const host = env.DATABASE_HOST || env.DB_HOST || 'localhost';
      const port = env.DATABASE_PORT || env.DB_PORT || '5432';
      const db   = env.DATABASE_NAME || env.DB_NAME || 'datafast_db';
      const user = env.DATABASE_USER || env.DB_USER || 'datafast_db_user';
      const pass = env.DATABASE_PASSWORD || env.DB_PASSWORD || '';

      console.log(`DB: ${user}@${host}:${port}/${db}`);

      const SQL = `
-- ── Migración 1: CreateEgresosIngresos ──────────────────────
DO $$ BEGIN CREATE TYPE tipo_movimiento_opex AS ENUM ('INGRESO_OTRO','EGRESO'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE categoria_movimiento_opex AS ENUM ('SERVICIOS_LUZ_AGUA','INTERNET_PROVEEDOR','PLANILLA_EMPLEADOS','ALQUILERES','OTROS'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE estado_movimiento_opex AS ENUM ('PAGADO','PENDIENTE_PAGO'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS egresos_ingresos (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  empresa_id      UUID          NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  tipo            tipo_movimiento_opex NOT NULL,
  categoria       categoria_movimiento_opex NOT NULL DEFAULT 'OTROS',
  monto           DECIMAL(12,2) NOT NULL,
  fecha_registro  DATE          NOT NULL,
  descripcion     TEXT,
  es_recurrente   BOOLEAN       NOT NULL DEFAULT FALSE,
  dia_vencimiento SMALLINT      CHECK (dia_vencimiento BETWEEN 1 AND 31),
  estado          estado_movimiento_opex NOT NULL DEFAULT 'PAGADO',
  plantilla_id    UUID          REFERENCES egresos_ingresos(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_egresos_ingresos_empresa_fecha ON egresos_ingresos (empresa_id, fecha_registro);
CREATE INDEX IF NOT EXISTS idx_egresos_ingresos_recurrentes ON egresos_ingresos (empresa_id, es_recurrente, dia_vencimiento) WHERE es_recurrente = TRUE;
CREATE INDEX IF NOT EXISTS idx_egresos_ingresos_pendientes ON egresos_ingresos (empresa_id, estado) WHERE estado = 'PENDIENTE_PAGO';

-- ── Migración 2: AddSectorIdToEgresosIngresos ───────────────
ALTER TABLE egresos_ingresos ADD COLUMN IF NOT EXISTS sector_id UUID REFERENCES zonas(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_egresos_ingresos_sector ON egresos_ingresos (empresa_id, sector_id) WHERE sector_id IS NOT NULL;

-- ── Migración 3: CreateProyectosInversion ───────────────────
DO $$ BEGIN CREATE TYPE estado_proyecto_inversion AS ENUM ('activo','completado','cancelado'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS proyectos_inversion (
  id                UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  empresa_id        UUID         NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nombre_proyecto   VARCHAR(200) NOT NULL,
  sector_id         UUID         NOT NULL REFERENCES zonas(id),
  inversion_inicial DECIMAL(14,2) NOT NULL,
  tasa_descuento    DECIMAL(6,4) NOT NULL CONSTRAINT chk_tasa_descuento CHECK (tasa_descuento BETWEEN 0.001 AND 0.99),
  fecha_inicio      DATE         NOT NULL,
  descripcion       TEXT,
  estado            estado_proyecto_inversion NOT NULL DEFAULT 'activo',
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proyectos_inversion_empresa_sector ON proyectos_inversion (empresa_id, sector_id);

-- ── Registrar en typeorm_migrations ─────────────────────────
INSERT INTO typeorm_migrations (name, timestamp) VALUES
  ('CreateEgresosIngresos1781800000000', 1781800000000),
  ('AddSectorIdToEgresosIngresos1781900000000', 1781900000000),
  ('CreateProyectosInversion1782000000000', 1782000000000)
ON CONFLICT DO NOTHING;
`.trim();

      // Ejecutar via psql heredoc
      const cmd = `PGPASSWORD='${pass}' psql -h ${host} -p ${port} -U ${user} -d ${db} <<'SQLEOF'\n${SQL}\nSQLEOF`;

      conn.exec(cmd, { pty: false }, (err2, stream2) => {
        if (err2) { console.error(err2.message); conn.end(); return; }
        stream2.on('data', d => process.stdout.write(d.toString()));
        stream2.stderr.on('data', d => process.stderr.write(d.toString()));
        stream2.on('close', (code) => {
          console.log(`\n✓ psql terminó con código: ${code}`);
          conn.end();
        });
      });
    });
  });
}).connect(VPS);
conn.on('error', e => { console.error('SSH error:', e.message); process.exit(1); });
