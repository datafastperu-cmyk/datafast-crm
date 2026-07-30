import { MigrationInterface, QueryRunner } from 'typeorm';

// Última lectura de los contadores del router por contrato.
//
// Los contadores de una simple queue de RouterOS son ACUMULADOS desde que la queue se
// creó o se reseteó, no un consumo por período. El consumo real es la diferencia entre
// dos lecturas, así que el colector necesita recordar la anterior.
//
// Sin esta tabla, cada corrida escribiría el acumulado histórico como si fuera el
// consumo de la hora: el primer día el abonado vería un número gigante y creciente.
export class CreateConsumoSnapshot1791800000025 implements MigrationInterface {
  name = 'CreateConsumoSnapshot1791800000025';

  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      CREATE TABLE IF NOT EXISTS consumo_snapshot (
        contrato_id UUID PRIMARY KEY REFERENCES contratos(id) ON DELETE CASCADE,
        empresa_id  UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,

        -- Valores crudos leídos del router en la última corrida.
        rx_bytes    BIGINT      NOT NULL,
        tx_bytes    BIGINT      NOT NULL,
        leido_en    TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_consumo_snapshot_empresa
        ON consumo_snapshot (empresa_id, leido_en DESC)
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS consumo_snapshot`);
  }
}
