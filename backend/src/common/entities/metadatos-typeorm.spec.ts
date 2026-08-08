import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { join } from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════
// El arranque en frío, comprobado en la suite.
//
// TypeORM construye los metadatos de todas las entidades al inicializarse, y ahí es donde
// revienta con `DataTypeNotSupportedError: Data type "Object" ... is not supported`. Es un
// fallo que **no aparece al compilar, ni al pasar los tests, ni con el proceso ya
// levantado**: solo cuando el backend arranca de verdad. El 2026-08-06 se coló así y el ERP
// entero devolvió 500 en el primer reinicio real.
//
// `columnas-tipadas.spec.ts` lo previene por regex, mirando el código fuente. Esto lo
// comprueba de verdad: **construye los metadatos**, que es la operación que fallaba. La
// regex puede quedarse corta ante una forma que nadie previó; esto no, porque es el mismo
// código que corre al arrancar.
//
// `buildMetadatas()` no abre conexión: no hace falta base de datos.
// ═══════════════════════════════════════════════════════════════════════════
describe('Los metadatos de TypeORM se construyen sin errores (arranque en frío)', () => {
  const SRC = join(__dirname, '..', '..');

  const construir = async (): Promise<DataSource> => {
    const ds = new DataSource({
      type: 'postgres',
      entities: [join(SRC, '**', '*.entity{.ts,.js}')],
    });
    // `buildMetadatas` es `protected`: TypeORM no espera que se llame sin inicializar. Se
    // invoca igualmente porque es EXACTAMENTE la operación que falla al arrancar, y
    // comprobarla aquí cuesta 20 ms frente a un backend en bucle de reinicio.
    // Es ASINCRONA: carga las entidades por glob. Llamarla sin esperar devuelve antes de
    // que se hayan importado, y el test pasaba sin comprobar nada.
    await (ds as unknown as { buildMetadatas(): Promise<void> }).buildMetadatas();
    return ds;
  };

  it('todas las entidades del proyecto producen metadatos válidos', async () => {
    await expect(construir()).resolves.toBeDefined();
  });

  it('el mapa de tablas es el esperado y ninguna queda sin columnas', async () => {
    const ds = await construir();

    // Si esto baja de golpe, alguien movió o borró entidades sin querer.
    expect(ds.entityMetadatas.length).toBeGreaterThan(80);

    const vacias = ds.entityMetadatas.filter((m) => m.columns.length === 0).map((m) => m.tableName);
    expect(vacias).toEqual([]);
  });

  // Las tablas de coordinación y dinero que R7 pedía modelar. Se nombran una a una: si
  // alguien retira una entidad de estas, el compilador deja de vigilar el outbox o la saga
  // y nadie se entera hasta el siguiente incidente.
  it('las tablas de coordinación y dinero tienen entidad (R7 · B-2)', async () => {
    const ds = await construir();
    const tablas = new Set(ds.entityMetadatas.map((m) => m.tableName));

    for (const t of [
      'comandos_red_pendientes',   // el outbox de red
      'operacion_wizard',          // la saga
      'operacion_wizard_paso',     // los pasos y sus compensaciones
      'ftth_operacion_lock',       // la exclusión mutua por contrato
      'cierre_caja',               // arqueo
      'pago_extorno',              // anulación de pagos
    ]) {
      expect([...tablas].includes(t) ? t : `FALTA ${t}`).toBe(t);
    }
  });
});
