import { MigrationInterface, QueryRunner } from 'typeorm';

// Marca de "sesión TR-069 rancia detectada". Sostiene la GRACIA del watcher de staleness
// (B4): una ONU que deja de informar no se toca en la primera pasada — un corte de luz
// doméstico o un reboot legítimo la dejarían muda unos minutos, y actuar de inmediato
// convertiría cada microcorte en trabajo contra la OLT.
//
// Se marca cuándo se detectó, se espera la ventana de gracia, y recién entonces se
// discrimina con evidencia de DOS planos: si la OLT dice que la ONU está óptimamente
// ONLINE pero el ACS lleva horas sin un Inform, la gestión está muerta aunque el
// servicio funcione — que es exactamente el agujero que dejaba el reset por botón
// FÍSICO, invisible para el ERP hasta ahora.
export class AddTr069StaleDesde1791800000017 implements MigrationInterface {
  name = 'AddTr069StaleDesde1791800000017';

  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE ftth_onu_registro
        ADD COLUMN IF NOT EXISTS tr069_stale_desde     TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS tr069_recuperado_en   TIMESTAMPTZ
    `);

    // El watcher busca candidatos con carril activo; el índice evita escanear la tabla
    // entera cada 30 min cuando la flota crezca.
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_ftth_stale_desde
        ON ftth_onu_registro (tr069_stale_desde)
        WHERE tr069_stale_desde IS NOT NULL AND deleted_at IS NULL
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP INDEX IF EXISTS idx_ftth_stale_desde`);
    await qr.query(`
      ALTER TABLE ftth_onu_registro
        DROP COLUMN IF EXISTS tr069_stale_desde,
        DROP COLUMN IF EXISTS tr069_recuperado_en
    `);
  }
}
