import { MigrationInterface, QueryRunner } from 'typeorm';

// ─────────────────────────────────────────────────────────────────────────────
// F1 — Catálogos de cobranza: forma, canal y cuenta receptora.
//
// Hasta hoy un pago responde a dos preguntas en texto libre (`metodo_pago varchar(100)`
// y `banco varchar(100)`) y NO responde a la tercera, que es la que importa para
// tesorería: dónde entró el dinero. El ERP sabe que entraron S/ 85 por Yape y no sabe
// en qué cuenta están.
//
// Los tres ejes, ahora explícitos:
//   1. forma_pago       — ¿cómo pagó?          (taxonomía cerrada)
//   2. canal_pago       — ¿por qué medio?      (configurable por empresa)
//   3. cuenta_receptora — ¿dónde entró?        (tesorería)
//
// Lo que el texto libre permitía y esto hace imposible por construcción (medido en el
// diagnóstico F0 sobre los dos únicos pagos que existen):
//   · `metodo_pago = 'Efectivo'` capitalizado, que no es ningún valor del enum de dominio
//     — el formulario mandaba el rótulo del catálogo, no el valor.
//   · Un pago en EFECTIVO con `banco = 'Banco 01'`, porque el formulario autoselecciona
//     el primer banco de la lista y lo envía siempre, tenga sentido o no.
//
// Sobre la relación canal→cuenta: la propuesta original la modelaba como un cuarto
// catálogo de "reglas automáticas". Se descarta — una tabla 1:1 con canales es una tabla
// de canales con pasos extra. La cuenta por defecto es una columna del canal.
// ─────────────────────────────────────────────────────────────────────────────
export class CreateCatalogosCobranza1791800000040 implements MigrationInterface {
  name = 'CreateCatalogosCobranza1791800000040';

  public async up(qr: QueryRunner): Promise<void> {

    // ── 1. forma_pago — taxonomía CERRADA ────────────────────────────────────
    // No es configurable por el operador a propósito: es el eje de los reportes
    // contables y de la conciliación. Si cambia, cambia el significado del histórico.
    // Por eso no lleva `empresa_id`: no es configuración, es vocabulario.
    await qr.query(`
      CREATE TABLE IF NOT EXISTS forma_pago (
        codigo             VARCHAR(30) PRIMARY KEY,
        nombre             VARCHAR(60) NOT NULL,
        orden              SMALLINT    NOT NULL DEFAULT 100,
        -- Sugerencia para canales nuevos; el canal manda sobre esto.
        requiere_operacion BOOLEAN     NOT NULL DEFAULT FALSE
      )
    `);

    await qr.query(`
      INSERT INTO forma_pago (codigo, nombre, orden, requiere_operacion) VALUES
        ('efectivo',      'Efectivo',              10, FALSE),
        ('transferencia', 'Transferencia',         20, TRUE),
        ('deposito',      'Depósito',              30, TRUE),
        ('billetera',     'Billetera Electrónica', 40, TRUE),
        ('tarjeta',       'Tarjeta',               50, TRUE),
        ('pasarela',      'Pasarela Online',       60, TRUE),
        -- No es un ingreso de caja, pero SALDA un comprobante. Hoy las notas de crédito
        -- mueven la factura por fuera del flujo de pagos; declararlas aquí es el paso
        -- previo a reencauzarlas (F3).
        ('nota_credito',  'Nota de Crédito',       70, FALSE),
        ('otro',          'Otro',                  99, FALSE)
      ON CONFLICT (codigo) DO NOTHING
    `);

    // ── 2. cuenta_receptora: se EXTIENDE cuentas_bancarias ───────────────────
    // Crear una tabla nueva daría dos respuestas a "dónde está el dinero de la empresa".
    // Una caja física no tiene banco ni número de cuenta: esas columnas pasan a nullable.
    await qr.query(`
      ALTER TABLE cuentas_bancarias
        ADD COLUMN IF NOT EXISTS tipo                  VARCHAR(20)  NOT NULL DEFAULT 'banco',
        ADD COLUMN IF NOT EXISTS nombre                VARCHAR(120),
        ADD COLUMN IF NOT EXISTS cajero_responsable_id UUID,
        ADD COLUMN IF NOT EXISTS requiere_arqueo       BOOLEAN      NOT NULL DEFAULT FALSE
    `);
    await qr.query(`ALTER TABLE cuentas_bancarias ALTER COLUMN banco         DROP NOT NULL`);
    await qr.query(`ALTER TABLE cuentas_bancarias ALTER COLUMN numero_cuenta DROP NOT NULL`);
    await qr.query(`
      ALTER TABLE cuentas_bancarias
        DROP CONSTRAINT IF EXISTS ck_cuentas_bancarias_tipo
    `);
    await qr.query(`
      ALTER TABLE cuentas_bancarias
        ADD CONSTRAINT ck_cuentas_bancarias_tipo
        CHECK (tipo IN ('caja', 'banco', 'pasarela', 'virtual'))
    `);
    // El rótulo operativo es obligatorio de hecho; se rellena el histórico antes de
    // exigirlo por defecto en la aplicación.
    await qr.query(`
      UPDATE cuentas_bancarias
         SET nombre = COALESCE(nombre, banco || ' ' || COALESCE(moneda, 'PEN'))
       WHERE nombre IS NULL
    `);

    // ── 3. canal_pago ────────────────────────────────────────────────────────
    await qr.query(`
      CREATE TABLE IF NOT EXISTS canal_pago (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        empresa_id  UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        -- Clave de negocio INMUTABLE. El nombre es un rótulo y puede cambiar; el código
        -- es lo que referencia el histórico y lo que resuelve el pago entrante.
        codigo      VARCHAR(40)  NOT NULL,
        nombre      VARCHAR(80)  NOT NULL,
        forma_pago  VARCHAR(30)  NOT NULL REFERENCES forma_pago(codigo),

        -- Autocompletado del formulario. Nullable: un canal puede no tener cuenta fija
        -- todavía, y entonces el operador la elige. Preferible a inventarle una.
        cuenta_receptora_default_id UUID REFERENCES cuentas_bancarias(id) ON DELETE SET NULL,

        requiere_numero_operacion BOOLEAN NOT NULL DEFAULT FALSE,
        requiere_voucher          BOOLEAN NOT NULL DEFAULT FALSE,

        -- Lo que retiene el canal. NO se descuenta de lo que salda la factura: el abonado
        -- pagó el bruto. El neto es lo que hay que buscar en el extracto bancario.
        comision_porcentaje NUMERIC(6,4)  NOT NULL DEFAULT 0 CHECK (comision_porcentaje >= 0),
        comision_fija       NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (comision_fija >= 0),

        -- FALSE para canales que solo crea una pasarela: no se ofrecen en la caja manual.
        permite_registro_manual BOOLEAN NOT NULL DEFAULT TRUE,

        -- Baja LÓGICA. Un canal desactivado sale de los selectores, jamás del histórico:
        -- un pago de hace dos años tiene que seguir diciendo por dónde entró.
        activo       BOOLEAN NOT NULL DEFAULT TRUE,
        es_protegido BOOLEAN NOT NULL DEFAULT FALSE,

        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await qr.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_canal_pago_empresa_codigo
        ON canal_pago (empresa_id, codigo)
    `);
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_canal_pago_empresa_forma
        ON canal_pago (empresa_id, forma_pago) WHERE activo
    `);

    // ── 4. Los tres ejes en el pago ──────────────────────────────────────────
    // Todo nullable: el backend viejo tiene que poder seguir escribiendo mientras dure
    // el despliegue, y el histórico no tiene con qué rellenarlos.
    await qr.query(`
      ALTER TABLE pagos
        ADD COLUMN IF NOT EXISTS canal_pago_id       UUID REFERENCES canal_pago(id),
        ADD COLUMN IF NOT EXISTS cuenta_receptora_id UUID REFERENCES cuentas_bancarias(id),
        ADD COLUMN IF NOT EXISTS comision            NUMERIC(12,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS monto_neto          NUMERIC(12,2)
    `);
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_pagos_canal ON pagos (empresa_id, canal_pago_id)
    `);

    // ── 5. Siembra por empresa ───────────────────────────────────────────────
    //
    // Se siembran las CAJAS y los canales que no dependen de datos que el ERP no puede
    // inventar. Las cuentas bancarias reales (número, CCI, titular) las carga el
    // operador: inventarlas sería exactamente lo contrario de la directriz de
    // "implementación desde cero" — el ERP inyecta su config canónica, no datos falsos.
    //
    // Los canales de banco nacen SIN cuenta por defecto y el formulario pedirá elegirla.
    const empresas: Array<{ id: string }> = await qr.query(`SELECT id FROM empresas`);

    for (const { id: empresaId } of empresas) {
      // Cajas físicas. "Caja Campo" es por cobrador en cuanto haya más de uno: una caja
      // compartida hace imposible saber a quién le falta dinero, que es justo para lo
      // que existe una caja.
      await qr.query(`
        INSERT INTO cuentas_bancarias (empresa_id, tipo, nombre, banco, numero_cuenta,
                                       moneda, activa, es_principal, requiere_arqueo)
        SELECT $1, 'caja', v.nombre, NULL, NULL, 'PEN', TRUE, v.principal, TRUE
          FROM (VALUES ('Caja Principal', TRUE), ('Caja Campo', FALSE))
               AS v(nombre, principal)
         WHERE NOT EXISTS (
           SELECT 1 FROM cuentas_bancarias c
            WHERE c.empresa_id = $1 AND c.tipo = 'caja' AND c.nombre = v.nombre
         )
      `, [empresaId]);

      const [cajaPrincipal] = await qr.query(
        `SELECT id FROM cuentas_bancarias
          WHERE empresa_id = $1 AND tipo = 'caja' AND nombre = 'Caja Principal' LIMIT 1`,
        [empresaId],
      );
      const [cajaCampo] = await qr.query(
        `SELECT id FROM cuentas_bancarias
          WHERE empresa_id = $1 AND tipo = 'caja' AND nombre = 'Caja Campo' LIMIT 1`,
        [empresaId],
      );

      // Canales base. Yape y Plin son CANALES de la forma "billetera" — hasta ahora eran
      // valores del mismo enum que "transferencia_bancaria", que es un nivel distinto.
      const canales: Array<[string, string, string, string | null, boolean]> = [
        // codigo,        nombre,        forma,          cuenta por defecto,   nº operación
        ['oficina',       'Oficina',     'efectivo',     cajaPrincipal?.id ?? null, false],
        ['campo',         'Cobranza en Campo', 'efectivo', cajaCampo?.id ?? null,   false],
        ['yape',          'Yape',        'billetera',    null, true],
        ['plin',          'Plin',        'billetera',    null, true],
        ['mercadopago',   'MercadoPago', 'pasarela',     null, true],
        ['nota_credito',  'Nota de Crédito', 'nota_credito', null, false],
      ];

      for (const [codigo, nombre, forma, cuenta, requiereOp] of canales) {
        await qr.query(`
          INSERT INTO canal_pago (empresa_id, codigo, nombre, forma_pago,
                                  cuenta_receptora_default_id, requiere_numero_operacion,
                                  permite_registro_manual, es_protegido)
          VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
          ON CONFLICT (empresa_id, codigo) DO NOTHING
        `, [empresaId, codigo, nombre, forma, cuenta, requiereOp,
            // MercadoPago no se registra a mano: lo crea el webhook.
            codigo !== 'mercadopago']);
      }

      // Los bancos que el operador ya configuró en `bancos_isp` pasan a ser canales de
      // transferencia y de depósito. No se pierde configuración existente: se traduce.
      const bancos: Array<{ nombre: string }> = await qr.query(
        `SELECT nombre FROM bancos_isp
          WHERE empresa_id = $1 AND deleted_at IS NULL AND activo`,
        [empresaId],
      );
      for (const { nombre } of bancos) {
        const slug = nombre.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        for (const forma of ['transferencia', 'deposito']) {
          await qr.query(`
            INSERT INTO canal_pago (empresa_id, codigo, nombre, forma_pago,
                                    requiere_numero_operacion)
            VALUES ($1, $2, $3, $4, TRUE)
            ON CONFLICT (empresa_id, codigo) DO NOTHING
          `, [empresaId, `${forma}-${slug}`, nombre, forma]);
        }
      }
    }

    // ── 6. Backfill del histórico ────────────────────────────────────────────
    //
    // El diagnóstico F0 midió el parque completo: DOS pagos, ambos con
    // `metodo_pago = 'Efectivo'`. No hay volumen que justifique lotes ni un canal
    // "LEGACY": se resuelven por nombre contra los canales recién sembrados.
    //
    // El mapeo cubre tanto los valores del enum de dominio como los rótulos que el
    // formulario de finanzas venía enviando (`Efectivo`, `Transferencia`, `Depósito`),
    // que es de donde salió la inconsistencia.
    await qr.query(`
      UPDATE pagos p
         SET canal_pago_id = c.id
        FROM canal_pago c
       WHERE c.empresa_id = p.empresa_id
         AND p.canal_pago_id IS NULL
         AND c.codigo = CASE LOWER(TRIM(p.metodo_pago))
             WHEN 'efectivo'               THEN 'oficina'
             WHEN 'yape'                   THEN 'yape'
             WHEN 'plin'                   THEN 'plin'
             WHEN 'mercadopago'            THEN 'mercadopago'
             ELSE NULL
           END
    `);

    // Los que dependen del banco escrito a mano.
    await qr.query(`
      UPDATE pagos p
         SET canal_pago_id = c.id
        FROM canal_pago c
       WHERE c.empresa_id = p.empresa_id
         AND p.canal_pago_id IS NULL
         AND p.banco IS NOT NULL
         AND c.forma_pago = CASE LOWER(TRIM(p.metodo_pago))
             WHEN 'transferencia_bancaria' THEN 'transferencia'
             WHEN 'transferencia'          THEN 'transferencia'
             WHEN 'deposito_bancario'      THEN 'deposito'
             WHEN 'depósito'               THEN 'deposito'
             WHEN 'deposito'               THEN 'deposito'
             ELSE NULL
           END
         AND LOWER(c.nombre) = LOWER(TRIM(p.banco))
    `);

    // La cuenta receptora del histórico se hereda del canal cuando el canal la tiene.
    // Los pagos por banco quedan sin cuenta: no se sabe a cuál entraron, y adivinarlo
    // sería inventar un movimiento de tesorería.
    await qr.query(`
      UPDATE pagos p
         SET cuenta_receptora_id = c.cuenta_receptora_default_id
        FROM canal_pago c
       WHERE c.id = p.canal_pago_id
         AND p.cuenta_receptora_id IS NULL
         AND c.cuenta_receptora_default_id IS NOT NULL
    `);

    // El neto del histórico es el bruto: no había comisiones registradas.
    await qr.query(`UPDATE pagos SET monto_neto = monto WHERE monto_neto IS NULL`);

    // Guarda: un pago sin canal es un pago que el rediseño no sabe clasificar, y hay que
    // verlo AHORA y no dentro de seis meses en un reporte que no cuadra. Con dos filas en
    // la tabla, esto o pasa limpio o el mapeo estaba mal.
    const [{ n }] = await qr.query(
      `SELECT COUNT(*)::int AS n FROM pagos WHERE canal_pago_id IS NULL`,
    );
    if (Number(n) > 0) {
      const muestra = await qr.query(
        `SELECT DISTINCT metodo_pago, banco FROM pagos WHERE canal_pago_id IS NULL LIMIT 10`,
      );
      throw new Error(
        `${n} pago(s) sin canal tras el backfill. Sin clasificar: ` +
        `${JSON.stringify(muestra)}. Amplía el mapeo antes de migrar — dejarlos en NULL ` +
        `los saca de todo reporte por canal sin que nadie lo note.`,
      );
    }
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP INDEX IF EXISTS idx_pagos_canal`);
    await qr.query(`
      ALTER TABLE pagos
        DROP COLUMN IF EXISTS canal_pago_id,
        DROP COLUMN IF EXISTS cuenta_receptora_id,
        DROP COLUMN IF EXISTS comision,
        DROP COLUMN IF EXISTS monto_neto
    `);
    await qr.query(`DROP TABLE IF EXISTS canal_pago`);
    await qr.query(`DROP TABLE IF EXISTS forma_pago`);
    // Las cajas sembradas se borran; las cuentas que haya cargado el operador NO.
    await qr.query(`DELETE FROM cuentas_bancarias WHERE tipo = 'caja'`);
    await qr.query(`
      ALTER TABLE cuentas_bancarias
        DROP CONSTRAINT IF EXISTS ck_cuentas_bancarias_tipo,
        DROP COLUMN IF EXISTS tipo,
        DROP COLUMN IF EXISTS nombre,
        DROP COLUMN IF EXISTS cajero_responsable_id,
        DROP COLUMN IF EXISTS requiere_arqueo
    `);
    // `banco` y `numero_cuenta` NO recuperan el NOT NULL: si hay filas con NULL, el
    // ALTER fallaría y dejaría la reversión a medias.
  }
}
