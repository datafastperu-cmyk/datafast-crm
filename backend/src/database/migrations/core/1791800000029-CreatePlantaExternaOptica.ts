import { MigrationInterface, QueryRunner } from 'typeorm';

// ─────────────────────────────────────────────────────────────────────────────
// Planta externa FTTH — 2/3: la ÓPTICA (splitters y fusiones)
//
// Son las transiciones internas de un nodo: qué le pasa a la luz cuando entra en
// una mufa o en una NAP. Los dos casos son distintos y el presupuesto óptico los
// distingue: una derivación por fusión suma ~0.1 dB, un splitter 1x8 suma ~10.5 dB.
// Modelarlos como la misma cosa haría que el cálculo mienta por un orden de magnitud.
// ─────────────────────────────────────────────────────────────────────────────
export class CreatePlantaExternaOptica1791800000029 implements MigrationInterface {
  name = 'CreatePlantaExternaOptica1791800000029';

  public async up(qr: QueryRunner): Promise<void> {

    // ── Splitters ───────────────────────────────────────────────────────
    // Entidad propia, NO un atributo de la NAP como proponía el expediente.
    // Un splitter tiene 1 entrada y N salidas, y puede vivir en una mufa o en una
    // NAP. Modelarlo como columna de la caja impide dos cosas que en planta real
    // ocurren todo el tiempo:
    //   · cascadas 1x2 → 1x8;
    //   · más de un splitter en la misma caja (una NAP de 16 con dos 1x8, donde el
    //     segundo se instala meses después al saturarse el primero).
    await qr.query(`
      CREATE TABLE IF NOT EXISTS pe_splitter (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        empresa_id  UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,

        codigo      VARCHAR(50),
        relacion    VARCHAR(10) NOT NULL,

        -- Pérdida por inserción, en dB. Se persiste en vez de derivarse de la
        -- relación porque varía por fabricante y por generación: un 1x8 puede ser
        -- 10.2 o 10.8 dB. Derivarla de una tabla fija haría que el presupuesto
        -- óptico arrastre un error sistemático que nadie puede corregir sin tocar
        -- código. El default cubre el caso normal.
        perdida_db  NUMERIC(4,2) NOT NULL,

        -- Alojamiento: exactamente uno. Confirmado con operaciones que NO existen
        -- splitters sin contenedor (en poste suelto), así que dos opciones bastan;
        -- si apareciera un tercer alojamiento habría que decidir si el poste pasa a
        -- ser un nodo del grafo.
        alojado_en_mufa_id UUID REFERENCES pe_mufa(id) ON DELETE RESTRICT,
        alojado_en_nap_id  UUID REFERENCES pe_nap(id)  ON DELETE RESTRICT,

        -- Hilo que lo alimenta. En el segundo splitter de una caja suele ser un hilo
        -- DE PASO del cable que la cruza, no del alimentador original: por eso no se
        -- restringe al segmento alimentador de la NAP.
        hilo_entrada_id UUID REFERENCES pe_fibra_hilo(id) ON DELETE RESTRICT,

        estado      VARCHAR(20) NOT NULL DEFAULT 'planificado',

        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        deleted_at  TIMESTAMPTZ,
        version     INTEGER NOT NULL DEFAULT 1,

        CONSTRAINT chk_pe_splitter_relacion
          CHECK (relacion IN ('1x2','1x4','1x8','1x16','1x32')),
        CONSTRAINT chk_pe_splitter_estado
          CHECK (estado IN ('planificado','instalado','operativo','averiado','retirado')),
        CONSTRAINT chk_pe_splitter_perdida
          CHECK (perdida_db > 0 AND perdida_db < 30),
        CONSTRAINT chk_pe_splitter_alojamiento_unico CHECK (
          (alojado_en_mufa_id IS NOT NULL)::int +
          (alojado_en_nap_id  IS NOT NULL)::int = 1
        )
      )
    `);

    // ── Salidas de splitter ─────────────────────────────────────────────
    // Una fila por salida, creadas en la MISMA transacción que el splitter.
    // Un splitter sin salidas es un registro corrupto que ninguna lógica posterior
    // puede reparar sola.
    //
    // Cada salida alimenta O un hilo (cascada hacia otra mufa) O un puerto de NAP.
    // El vínculo con el puerto vive en UN SOLO lado — `pe_nap_puerto.splitter_salida_id`,
    // en la migración 3/3 — y no aquí. Guardarlo en ambos lados obliga a mantener dos
    // verdades sincronizadas, y tarde o temprano divergen.
    await qr.query(`
      CREATE TABLE IF NOT EXISTS pe_splitter_salida (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        empresa_id  UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        splitter_id UUID NOT NULL REFERENCES pe_splitter(id) ON DELETE CASCADE,

        numero      INTEGER NOT NULL,

        -- No nulo sólo en cascadas: la salida sigue por fibra hacia otro nodo.
        hilo_salida_id UUID REFERENCES pe_fibra_hilo(id) ON DELETE SET NULL,

        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        deleted_at  TIMESTAMPTZ,
        version     INTEGER NOT NULL DEFAULT 1,

        CONSTRAINT chk_pe_salida_numero CHECK (numero BETWEEN 1 AND 32)
      )
    `);

    // ── Fusiones ────────────────────────────────────────────────────────
    // Matriz de empalme dentro de una mufa: hilo A ↔ hilo B.
    await qr.query(`
      CREATE TABLE IF NOT EXISTS pe_fusion (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        empresa_id  UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        mufa_id     UUID NOT NULL REFERENCES pe_mufa(id) ON DELETE CASCADE,

        hilo_a_id   UUID NOT NULL REFERENCES pe_fibra_hilo(id) ON DELETE RESTRICT,
        hilo_b_id   UUID NOT NULL REFERENCES pe_fibra_hilo(id) ON DELETE RESTRICT,

        perdida_db  NUMERIC(4,2) NOT NULL DEFAULT 0.10,
        observacion TEXT,

        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        deleted_at  TIMESTAMPTZ,
        version     INTEGER NOT NULL DEFAULT 1,

        -- Un hilo no se fusiona consigo mismo. Parece obvio; es un typo de un dígito
        -- en un formulario de 48 filas, y crea un lazo que el recorrido del grafo
        -- tendría que detectar en tiempo de consulta en vez de impedirlo aquí.
        CONSTRAINT chk_pe_fusion_distintos CHECK (hilo_a_id <> hilo_b_id),
        CONSTRAINT chk_pe_fusion_perdida CHECK (perdida_db >= 0 AND perdida_db < 5)
      )
    `);

    // ── Índices e invariantes ───────────────────────────────────────────

    // Una salida no se repite dentro de su splitter.
    await qr.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_pe_salida_splitter_numero
        ON pe_splitter_salida (splitter_id, numero) WHERE deleted_at IS NULL
    `);

    // INVARIANTE FÍSICO: un hilo se fusiona UNA sola vez, por cada extremo.
    //
    // Se impone en la BD y no en el servicio a propósito. Un guard de servicio que
    // consulta y después inserta no sobrevive a dos requests concurrentes: ambos leen
    // "libre" y ambos insertan. Es el mismo error que el expediente cometía al deducir
    // puertos libres contando clientes.
    //
    // Son dos índices y no uno porque un hilo puede aparecer como A en una fila o como
    // B en otra; hay que cerrar los dos lados.
    await qr.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_pe_fusion_hilo_a
        ON pe_fusion (hilo_a_id) WHERE deleted_at IS NULL
    `);
    await qr.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_pe_fusion_hilo_b
        ON pe_fusion (hilo_b_id) WHERE deleted_at IS NULL
    `);

    // Recorrido del grafo y detalle de mufa.
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_pe_fusion_mufa
        ON pe_fusion (mufa_id) WHERE deleted_at IS NULL
    `);
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_pe_splitter_alojamiento
        ON pe_splitter (alojado_en_mufa_id, alojado_en_nap_id) WHERE deleted_at IS NULL
    `);
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_pe_splitter_hilo_entrada
        ON pe_splitter (hilo_entrada_id) WHERE deleted_at IS NULL
    `);
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_pe_salida_splitter
        ON pe_splitter_salida (splitter_id) WHERE deleted_at IS NULL
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS pe_fusion`);
    await qr.query(`DROP TABLE IF EXISTS pe_splitter_salida`);
    await qr.query(`DROP TABLE IF EXISTS pe_splitter`);
  }
}
