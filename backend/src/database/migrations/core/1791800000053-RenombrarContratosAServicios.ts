import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fase 3a del plan del core — **la tabla pasa a llamarse por lo que guarda**.
 *
 * `contratos` nunca guardó contratos: guardaba **servicios**. Una fila es una conexión —un PPPoE,
 * una ONU—, y un abonado con internet y cable tenía dos «contratos» sin nada que dijera que son el
 * mismo acuerdo. Ese es el problema de vocabulario que abrió todo el rediseño.
 *
 * **Esta migración solo renombra. No crea el nivel de contrato**, y eso es deliberado.
 *
 * El código lleva 142 referencias a la tabla en SQL crudo, repartidas en 55 ficheros, y
 * TypeScript no ve ninguna: son cadenas de texto. Si en el mismo paso se creara una tabla nueva
 * llamada `contratos`, cada consulta que se me hubiera escapado **seguiría funcionando** — leyendo
 * la tabla equivocada, devolviendo cero filas en silencio. Un corte que no corta, una factura que
 * no se emite, y ni un error en el log.
 *
 * Dejando el nombre `contratos` VACÍO durante esta fase, cualquier sitio no barrido falla con
 * «relation contratos does not exist»: ruidoso, inmediato e imposible de ignorar. El hueco es la
 * red de seguridad, y por eso el nivel de contrato llega en 3b y el dinero en 3c.
 */
export class RenombrarContratosAServicios1791800000053 implements MigrationInterface {
  name = 'RenombrarContratosAServicios1791800000053';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE contratos           RENAME TO servicios`);
    await q.query(`ALTER TABLE contratos_historial RENAME TO servicios_historial`);

    await q.query(`
      COMMENT ON TABLE servicios IS
        'Un SERVICIO contratado: una conexión de internet, una línea de cable, una cuenta de '
        'streaming. Se llamaba contratos, pero el contrato es el acuerdo que los agrupa y '
        'vive en su propia tabla desde la fase 3b.'
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE servicios_historial RENAME TO contratos_historial`);
    await q.query(`ALTER TABLE servicios           RENAME TO contratos`);
  }
}
