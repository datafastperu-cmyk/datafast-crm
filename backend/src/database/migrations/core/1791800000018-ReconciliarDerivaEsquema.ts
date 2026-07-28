import { MigrationInterface, QueryRunner } from 'typeorm';

// Reconcilia la DERIVA entre el esquema de producción y el que producen las migraciones.
//
// Descubierta el 2026-07-28 al conseguir por primera vez una instalación desde cero
// (`migration:run:all`) y comparar el resultado contra la base de producción. Las 96
// tablas coincidían, pero tres tenían columnas distintas — en ambos sentidos:
//
//  1. `ftth_onu_registro.traffic_index_down/up` — la ENTIDAD las declara y producción las
//     tiene, pero NINGUNA migración las crea. Se añadieron fuera del control de
//     migraciones. Una instalación nueva arrancaría sin ellas y el ERP fallaría al leer
//     el registro FTTH. Este es el defecto con impacto real.
//  2. `empresas.moneda` y `empresas.tipo_comprobante_default` — al revés: producción ya
//     no las tiene (se movieron a `configuracion_facturacion` / `comprobantes_config`)
//     pero ninguna migración las elimina, así que una instalación nueva las recrea como
//     columnas huérfanas. Inocuo, pero es deriva y confunde a quien lea el esquema.
//  3. `ftth_onu_registro.description` — residuo solo en producción, sin entidad ni
//     migración que lo respalde. Se deja como está: eliminar una columna con datos
//     históricos exige revisarlos antes, y no es urgente.
//
// La migración es idempotente en las dos direcciones (IF NOT EXISTS / IF EXISTS): sobre
// producción no cambia nada de (1) porque ya está, y limpia (2); sobre una instalación
// nueva crea (1) y evita (2). Ambos caminos convergen al mismo esquema, que es el punto.
export class ReconciliarDerivaEsquema1791800000018 implements MigrationInterface {
  name = 'ReconciliarDerivaEsquema1791800000018';

  public async up(qr: QueryRunner): Promise<void> {
    // (1) Columnas que la entidad declara y ninguna migración creaba.
    await qr.query(`
      ALTER TABLE ftth_onu_registro
        ADD COLUMN IF NOT EXISTS traffic_index_down INT,
        ADD COLUMN IF NOT EXISTS traffic_index_up   INT
    `);

    // (2) Columnas migradas a otras tablas que seguían recreándose en instalaciones nuevas.
    await qr.query(`
      ALTER TABLE empresas
        DROP COLUMN IF EXISTS moneda,
        DROP COLUMN IF EXISTS tipo_comprobante_default
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    // No se revierte (1): quitar columnas que la entidad declara dejaría el backend
    // roto, que es justo el estado del que veníamos.
    await qr.query(`
      ALTER TABLE empresas
        ADD COLUMN IF NOT EXISTS moneda                   VARCHAR(3),
        ADD COLUMN IF NOT EXISTS tipo_comprobante_default VARCHAR(30)
    `);
  }
}
