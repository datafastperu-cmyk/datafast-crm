import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fase 3b del plan del core — **existe el nivel de CONTRATO y los servicios cuelgan de él**.
 *
 * Con 3a la tabla pasó a llamarse `servicios`, que es lo que siempre guardó. Aquí aparece el nivel
 * que faltaba: el ACUERDO con el abonado, que agrupa uno o varios servicios. Es lo que hace
 * expresable «un contrato con internet y cable», y es donde vivirá la cuenta de facturación.
 *
 * **El dinero no se mueve todavía.** `facturas`, `pagos`, `cargos_pendientes` y `promesas_pago`
 * siguen apuntando a `servicios`; eso es 3c y va en su propio despliegue.
 *
 * **Ningún código lee esta tabla aún**, y es deliberado: la migración la crea y la puebla, y la
 * entidad llega con la fase 4, que es cuando algo la necesita de verdad. Crear ahora una entidad
 * que nadie consulta sería adelantar el renombrado de la clase `Contrato` —138 usos— sin ninguna
 * razón para hacerlo hoy.
 *
 * **Desde este despliegue vuelve a existir el nombre `contratos`**, así que un `FROM contratos`
 * olvidado deja de fallar y pasa a leer la tabla equivocada en silencio. Lo único que lo impide es
 * `sql-nombra-servicios.spec.ts`, que por eso se queda.
 */
export class NivelDeContrato1791800000054 implements MigrationInterface {
  name = 'NivelDeContrato1791800000054';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE contratos (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id       UUID        NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        cliente_id       UUID        NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
        numero_contrato  VARCHAR(30) NOT NULL,
        fecha_inicio     DATE        NOT NULL DEFAULT CURRENT_DATE,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at       TIMESTAMPTZ,
        version          INTEGER     NOT NULL DEFAULT 1,
        CONSTRAINT uq_contratos_numero UNIQUE (empresa_id, numero_contrato)
      )
    `);

    await q.query(`
      COMMENT ON TABLE contratos IS
        'El ACUERDO con el abonado. Agrupa uno o varios servicios (internet, cable, streaming) y '
        'es donde vive la cuenta de facturacion. NO tiene estado: el ciclo de vida -activar, '
        'suspender, dar de baja- es de cada servicio, que es lo que se enciende y se apaga.'
    `);

    await q.query(`CREATE INDEX idx_contratos_cliente ON contratos (cliente_id) WHERE deleted_at IS NULL`);

    // ── Un acuerdo por abonado ───────────────────────────────────────────────
    // Uno y no más: nadie ha pedido todavía dos acuerdos separados para el mismo titular —eso es
    // la fase 5 del ADR-035, «cuando exista el caso»—. Agrupar por cliente es la lectura fiel de
    // lo que hay hoy: los servicios de un abonado SON su acuerdo con la empresa.
    //
    // La numeración se calcula en una subconsulta y no con una ventana sobre el agregado: mezclar
    // ROW_NUMBER() con GROUP BY en la misma proyección es un error de sintaxis silencioso de leer
    // y ruidoso de ejecutar.
    await q.query(`
      INSERT INTO contratos (empresa_id, cliente_id, numero_contrato, fecha_inicio)
      SELECT g.empresa_id,
             g.cliente_id,
             'CTR-' || TO_CHAR(g.desde, 'YYYY') || '-' ||
               LPAD(ROW_NUMBER() OVER (PARTITION BY g.empresa_id ORDER BY g.desde, g.cliente_id)::text, 6, '0'),
             g.desde
        FROM (
          SELECT empresa_id, cliente_id, MIN(fecha_inicio) AS desde
            FROM servicios
           WHERE deleted_at IS NULL
           GROUP BY empresa_id, cliente_id
        ) g
    `);

    // ── Los servicios cuelgan del acuerdo ────────────────────────────────────
    await q.query(`
      ALTER TABLE servicios
        ADD COLUMN contrato_id UUID REFERENCES contratos(id) ON DELETE RESTRICT
    `);

    await q.query(`
      UPDATE servicios s
         SET contrato_id = c.id
        FROM contratos c
       WHERE c.empresa_id = s.empresa_id
         AND c.cliente_id = s.cliente_id
    `);

    await q.query(`CREATE INDEX idx_servicios_contrato ON servicios (contrato_id)`);

    await q.query(`
      COMMENT ON COLUMN servicios.contrato_id IS
        'Acuerdo al que pertenece este servicio. Nulo solo en servicios borrados antes de la fase '
        '3b: los vivos lo tienen todos.'
    `);

    // La garantía se comprueba aquí, no se confía: si algún servicio vivo se quedara sin acuerdo,
    // la migración falla y no deja el sistema a medias.
    const filas: Array<{ huerfanos: string }> = await q.query(`
      SELECT COUNT(*)::text AS huerfanos FROM servicios WHERE deleted_at IS NULL AND contrato_id IS NULL
    `);
    const huerfanos = Number(filas[0]?.huerfanos ?? 0);
    if (huerfanos > 0) {
      throw new Error(`Fase 3b: ${huerfanos} servicios vivos se quedaron sin contrato`);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS idx_servicios_contrato`);
    await q.query(`ALTER TABLE servicios DROP COLUMN IF EXISTS contrato_id`);
    await q.query(`DROP TABLE IF EXISTS contratos`);
  }
}
