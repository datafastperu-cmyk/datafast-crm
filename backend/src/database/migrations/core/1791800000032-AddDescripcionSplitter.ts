import { MigrationInterface, QueryRunner } from 'typeorm';

// El splitter era el único elemento de planta externa sin campo de texto libre: mufas,
// cajas NAP, segmentos, fusiones y puertos ya tenían `descripcion` u `observacion`.
//
// No es un detalle cosmético. Un splitter tiene datos que ninguna columna estructurada
// captura y que el técnico necesita: marca y modelo real, número de serie, si es de
// casete o de módulo, en qué bandeja está dentro de la caja, o que "el de arriba está
// suelto, sujetarlo al reinstalar". Sin dónde escribirlo, esa información vive en la
// cabeza de quien lo instaló y se pierde cuando esa persona no está.
export class AddDescripcionSplitter1791800000032 implements MigrationInterface {
  name = 'AddDescripcionSplitter1791800000032';

  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TABLE pe_splitter ADD COLUMN IF NOT EXISTS descripcion TEXT`);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TABLE pe_splitter DROP COLUMN IF EXISTS descripcion`);
  }
}
