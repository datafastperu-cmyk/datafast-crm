import { MigrationInterface, QueryRunner } from 'typeorm';

// ─────────────────────────────────────────────────────────────
// Canal de aprovisionamiento TR-069 por CPE (incidente 2026-07-17/18,
// CNT-2026-000004). Ver capability/cpe-provisioning-catalog.ts para el
// contexto completo: el OMCI del ONT Huawei EG8145V5 no garantiza escribir
// la ME137 (TR069 Management Server); se agrega un canal HTTP certificado
// como capacidad adicional del dispositivo, con circuit breaker propio
// (el equipo se autobloquea a los 3 intentos de login fallidos).
// ─────────────────────────────────────────────────────────────
export class CreateCpeProvisioningChannel1791800000005 implements MigrationInterface {
  name = 'CreateCpeProvisioningChannel1791800000005';

  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      CREATE TABLE cpe_web_credential (
        id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id       UUID        NOT NULL,
        olt_id           UUID        NOT NULL REFERENCES olt_dispositivos(id) ON DELETE CASCADE,
        fabricante       VARCHAR(32) NOT NULL,
        modelo_pattern   VARCHAR(64),
        usuario          VARCHAR(64) NOT NULL,
        password_cifrada TEXT        NOT NULL,
        activo           BOOLEAN     NOT NULL DEFAULT true,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at       TIMESTAMPTZ,
        version          INTEGER     NOT NULL DEFAULT 1
      )
    `);

    await qr.query(`
      CREATE INDEX idx_cwc_olt_fabricante
        ON cpe_web_credential(olt_id, fabricante)
        WHERE deleted_at IS NULL AND activo = true
    `);

    await qr.query(`
      CREATE TABLE cpe_provisioning_attempt (
        id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id             UUID        NOT NULL,
        ftth_registro_id       UUID        NOT NULL REFERENCES ftth_onu_registro(id) ON DELETE CASCADE,
        canal                  VARCHAR(32) NOT NULL,
        estado_circuito        VARCHAR(10) NOT NULL DEFAULT 'closed',
        intentos_consecutivos  SMALLINT    NOT NULL DEFAULT 0,
        bloqueado_hasta        TIMESTAMPTZ,
        ultimo_intento_en      TIMESTAMPTZ,
        ultimo_resultado       VARCHAR(24),
        ultimo_error           TEXT,
        created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at             TIMESTAMPTZ,
        version                INTEGER     NOT NULL DEFAULT 1,
        CONSTRAINT uq_cpa_registro_canal UNIQUE (ftth_registro_id, canal)
      )
    `);

    await qr.query(`
      CREATE INDEX idx_cpa_empresa
        ON cpe_provisioning_attempt(empresa_id)
        WHERE deleted_at IS NULL
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS cpe_provisioning_attempt`);
    await qr.query(`DROP TABLE IF EXISTS cpe_web_credential`);
  }
}
