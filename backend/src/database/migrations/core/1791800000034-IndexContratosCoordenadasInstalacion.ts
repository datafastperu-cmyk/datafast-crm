import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Índice para la capa de abonados del mapa de red.
 *
 * La capa consulta el punto de INSTALACIÓN del contrato acotado por bounding box, y esas
 * columnas no tenían índice: con la planta cargada, cada movimiento del mapa provocaba un
 * recorrido secuencial de `contratos` — y el mapa consulta en cada `moveend`, así que el
 * coste se paga por arrastre, no por sesión.
 *
 * Parcial por dos razones: sólo se buscan contratos vivos, y la mayoría de instalaciones
 * antiguas no tienen coordenada. Indexar las filas que la consulta nunca mira agranda el
 * índice y encarece cada escritura sobre `contratos` sin devolver nada.
 */
export class IndexContratosCoordenadasInstalacion1791800000034 implements MigrationInterface {
  name = 'IndexContratosCoordenadasInstalacion1791800000034';

  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_contratos_coordenadas_instalacion
          ON contratos (latitud_instalacion, longitud_instalacion)
       WHERE deleted_at IS NULL AND latitud_instalacion IS NOT NULL
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP INDEX IF EXISTS idx_contratos_coordenadas_instalacion`);
  }
}
