import { MigrationInterface, QueryRunner } from 'typeorm';

// ─────────────────────────────────────────────────────────────────────────────
// Planta externa FTTH — 1/3: el GRAFO (nodos y aristas)
//
// El grafo óptico tiene tres tipos de nodo (site, mufa, nap) y un tipo de arista
// (segmento de fibra). Los hilos son los conductores dentro de la arista.
//
// Va en tres migraciones y no en una porque el `down()` de una tabla es reversible
// y el de nueve, en la práctica, no: si algo falla a mitad hay que saber exactamente
// hasta dónde llegó el esquema.
//
// NO se usan FKs polimórficas (una columna `tipo` + una `id` suelta). Destruyen la
// integridad referencial: Postgres no puede validar a qué apunta la fila. Se usan
// columnas separadas con un CHECK de exclusividad — la BD garantiza la integridad y
// el planner puede usar los índices.
// ─────────────────────────────────────────────────────────────────────────────
export class CreatePlantaExternaGrafo1791800000028 implements MigrationInterface {
  name = 'CreatePlantaExternaGrafo1791800000028';

  public async up(qr: QueryRunner): Promise<void> {

    // ── Mufas de empalme ────────────────────────────────────────────────
    // Una mufa puede ser de fusión pura (continuidad), de derivación (varios
    // segmentos terminan en ella y las fusiones reparten hilos entre ellos) o
    // alojar splitters. Las tres son la misma tabla: lo que las diferencia es lo
    // que cuelga de ellas, no un atributo declarado que alguien deba mantener.
    await qr.query(`
      CREATE TABLE IF NOT EXISTS pe_mufa (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        empresa_id  UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,

        codigo      VARCHAR(50)  NOT NULL,
        jerarquia   VARCHAR(20)  NOT NULL DEFAULT 'primer_nivel',
        descripcion TEXT,
        direccion   VARCHAR(200),

        -- Obligatorias: una mufa sin coordenada es una mufa que nadie encuentra,
        -- y encontrarla es el motivo por el que existe este módulo.
        latitud     DECIMAL(10,7) NOT NULL,
        longitud    DECIMAL(10,7) NOT NULL,
        -- Precisión reportada por el GPS del dispositivo, en metros. Se persiste
        -- porque un GPS con 2 km de error rellena el formulario igual que uno bueno,
        -- y sin este dato nadie se entera hasta que un técnico va a buscarla.
        precision_gps_m INTEGER,

        capacidad_fusiones INTEGER,
        estado      VARCHAR(20) NOT NULL DEFAULT 'planificado',

        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        deleted_at  TIMESTAMPTZ,
        version     INTEGER NOT NULL DEFAULT 1,

        CONSTRAINT chk_pe_mufa_jerarquia
          CHECK (jerarquia IN ('primer_nivel', 'segundo_nivel')),
        CONSTRAINT chk_pe_mufa_estado
          CHECK (estado IN ('planificado','instalado','operativo','averiado','retirado')),
        CONSTRAINT chk_pe_mufa_coords
          CHECK (latitud BETWEEN -90 AND 90 AND longitud BETWEEN -180 AND 180)
      )
    `);

    // ── Segmentos de fibra ──────────────────────────────────────────────
    await qr.query(`
      CREATE TABLE IF NOT EXISTS pe_fibra_segmento (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        empresa_id  UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,

        codigo      VARCHAR(50) NOT NULL,
        jerarquia   VARCHAR(20) NOT NULL,
        descripcion TEXT,

        hilos_totales    INTEGER NOT NULL,
        tipo_instalacion VARCHAR(20) NOT NULL DEFAULT 'aereo',

        -- longitud_m y atenuacion_db_km existen para el presupuesto óptico (Fase 3).
        -- Sin ellas el módulo sería sólo documental: es la diferencia entre dibujar la
        -- red y poder decir "este cliente ve -27 dBm y debería ver -22, hay algo mal".
        longitud_m       NUMERIC(10,2) NOT NULL,
        atenuacion_db_km NUMERIC(4,3)  NOT NULL DEFAULT 0.350,

        -- Extremos: exactamente un origen y exactamente un destino, de tres tipos.
        origen_site_id   UUID REFERENCES sites(id)   ON DELETE RESTRICT,
        origen_mufa_id   UUID REFERENCES pe_mufa(id) ON DELETE RESTRICT,
        origen_nap_id    UUID,
        destino_site_id  UUID REFERENCES sites(id)   ON DELETE RESTRICT,
        destino_mufa_id  UUID REFERENCES pe_mufa(id) ON DELETE RESTRICT,
        destino_nap_id   UUID,

        -- Polilínea del trazado (capa 2 del visor). JSONB y no tabla de vértices:
        -- la ruta se lee y se escribe siempre completa, nunca por punto.
        ruta_geojson JSONB,

        estado      VARCHAR(20) NOT NULL DEFAULT 'planificado',

        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        deleted_at  TIMESTAMPTZ,
        version     INTEGER NOT NULL DEFAULT 1,

        CONSTRAINT chk_pe_segmento_jerarquia
          CHECK (jerarquia IN ('troncal', 'subtroncal', 'distribucion')),
        CONSTRAINT chk_pe_segmento_instalacion
          CHECK (tipo_instalacion IN ('aereo', 'subterraneo', 'fachada')),
        CONSTRAINT chk_pe_segmento_estado
          CHECK (estado IN ('planificado','instalado','operativo','averiado','retirado')),
        CONSTRAINT chk_pe_segmento_hilos
          CHECK (hilos_totales IN (2,4,6,8,12,24,48,96,144,288)),
        CONSTRAINT chk_pe_segmento_longitud
          CHECK (longitud_m > 0),

        -- Exactamente un extremo de cada lado. Sin esto, un segmento puede quedar
        -- colgando de dos nodos a la vez o de ninguno, y el recorrido del grafo
        -- devuelve rutas que no existen.
        CONSTRAINT chk_pe_segmento_origen_unico CHECK (
          (origen_site_id IS NOT NULL)::int +
          (origen_mufa_id IS NOT NULL)::int +
          (origen_nap_id  IS NOT NULL)::int = 1
        ),
        CONSTRAINT chk_pe_segmento_destino_unico CHECK (
          (destino_site_id IS NOT NULL)::int +
          (destino_mufa_id IS NOT NULL)::int +
          (destino_nap_id  IS NOT NULL)::int = 1
        )
      )
    `);

    // ── Hilos ───────────────────────────────────────────────────────────
    // N filas por segmento, creadas en la MISMA transacción que el segmento.
    // Sin esta tabla no existe trazabilidad ni continuidad: es la omisión principal
    // del expediente original, que pedía "matriz de fusiones hilo X ↔ hilo Y" pero
    // no declaraba dónde vive el hilo.
    await qr.query(`
      CREATE TABLE IF NOT EXISTS pe_fibra_hilo (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        empresa_id  UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        segmento_id UUID NOT NULL REFERENCES pe_fibra_segmento(id) ON DELETE CASCADE,

        numero      INTEGER     NOT NULL,
        color       VARCHAR(20),
        estado      VARCHAR(20) NOT NULL DEFAULT 'libre',

        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        deleted_at  TIMESTAMPTZ,
        version     INTEGER NOT NULL DEFAULT 1,

        CONSTRAINT chk_pe_hilo_estado
          CHECK (estado IN ('libre','en_uso','averiado','reservado')),
        CONSTRAINT chk_pe_hilo_numero CHECK (numero BETWEEN 1 AND 288)
      )
    `);

    // ── Cajas NAP ───────────────────────────────────────────────────────
    await qr.query(`
      CREATE TABLE IF NOT EXISTS pe_nap (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        empresa_id  UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,

        codigo      VARCHAR(50) NOT NULL,
        descripcion TEXT,
        direccion   VARCHAR(200),

        latitud     DECIMAL(10,7) NOT NULL,
        longitud    DECIMAL(10,7) NOT NULL,
        precision_gps_m INTEGER,

        mufa_origen_id          UUID REFERENCES pe_mufa(id)           ON DELETE RESTRICT,
        segmento_alimentador_id UUID REFERENCES pe_fibra_segmento(id) ON DELETE RESTRICT,

        -- Cantidad de adaptadores FÍSICOS de la caja. Es independiente de la capacidad
        -- de sus splitters: una NAP de 16 con un solo 1x8 tiene 8 puertos que se ven y
        -- se tocan pero no dan servicio, hasta que se instala el segundo splitter
        -- alimentado por un hilo de paso. El expediente fusionaba ambos conceptos con
        -- una relación fija por caja, y con eso el planificador ve capacidad donde no
        -- puede conectar a nadie.
        capacidad_puertos INTEGER NOT NULL DEFAULT 8,

        -- Contadores denormalizados (caché de lectura para el semáforo del visor).
        -- La fuente de verdad es SIEMPRE pe_nap_puerto; estos los mantiene un trigger.
        -- Son dos y no uno porque responden preguntas distintas: "¿puedo conectar un
        -- cliente hoy?" vs "¿esta caja necesita inversión en un splitter?".
        puertos_libres         INTEGER NOT NULL DEFAULT 0,
        puertos_no_habilitados INTEGER NOT NULL DEFAULT 0,

        estado      VARCHAR(20) NOT NULL DEFAULT 'planificado',

        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        deleted_at  TIMESTAMPTZ,
        version     INTEGER NOT NULL DEFAULT 1,

        CONSTRAINT chk_pe_nap_estado
          CHECK (estado IN ('planificado','instalado','operativo','averiado','retirado')),
        CONSTRAINT chk_pe_nap_capacidad
          CHECK (capacidad_puertos IN (8,16,24,32)),
        CONSTRAINT chk_pe_nap_coords
          CHECK (latitud BETWEEN -90 AND 90 AND longitud BETWEEN -180 AND 180)
      )
    `);

    // FK diferida: pe_fibra_segmento se creó antes que pe_nap porque pe_nap la
    // referencia. La dependencia inversa (un segmento que nace o muere en una NAP)
    // se cierra aquí.
    await qr.query(`
      ALTER TABLE pe_fibra_segmento
        ADD CONSTRAINT fk_pe_segmento_origen_nap
        FOREIGN KEY (origen_nap_id) REFERENCES pe_nap(id) ON DELETE RESTRICT
    `);
    await qr.query(`
      ALTER TABLE pe_fibra_segmento
        ADD CONSTRAINT fk_pe_segmento_destino_nap
        FOREIGN KEY (destino_nap_id) REFERENCES pe_nap(id) ON DELETE RESTRICT
    `);

    // ── Índices ─────────────────────────────────────────────────────────
    // Parciales WHERE deleted_at IS NULL: el 100% de las consultas del visor y del
    // CRUD filtran vivos. Un índice que incluye borrados es un índice más grande
    // que nadie usa entero.

    // Código único por empresa mientras el elemento viva. Sin esto, dos técnicos
    // crean "NAP-042" en la misma zona y el de campo no sabe a cuál ir.
    await qr.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_pe_mufa_codigo
        ON pe_mufa (empresa_id, codigo) WHERE deleted_at IS NULL
    `);
    await qr.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_pe_nap_codigo
        ON pe_nap (empresa_id, codigo) WHERE deleted_at IS NULL
    `);
    await qr.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_pe_segmento_codigo
        ON pe_fibra_segmento (empresa_id, codigo) WHERE deleted_at IS NULL
    `);

    // Un hilo no se repite dentro de su segmento.
    await qr.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_pe_hilo_segmento_numero
        ON pe_fibra_hilo (segmento_id, numero) WHERE deleted_at IS NULL
    `);

    // Consultas por bounding box del visor cartográfico. Sin PostGIS: el btree
    // compuesto resuelve la box query. Si el parque crece a decenas de miles se
    // habilita PostGIS + GIST sin cambiar el contrato de la API.
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_pe_mufa_bbox
        ON pe_mufa (empresa_id, latitud, longitud) WHERE deleted_at IS NULL
    `);
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_pe_nap_bbox
        ON pe_nap (empresa_id, latitud, longitud) WHERE deleted_at IS NULL
    `);

    // Recorrido del grafo: buscar aristas por cada extremo.
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_pe_segmento_origen
        ON pe_fibra_segmento (origen_mufa_id, origen_nap_id, origen_site_id)
        WHERE deleted_at IS NULL
    `);
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_pe_segmento_destino
        ON pe_fibra_segmento (destino_mufa_id, destino_nap_id, destino_site_id)
        WHERE deleted_at IS NULL
    `);
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_pe_hilo_segmento
        ON pe_fibra_hilo (segmento_id, estado) WHERE deleted_at IS NULL
    `);
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_pe_nap_mufa
        ON pe_nap (mufa_origen_id) WHERE deleted_at IS NULL
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TABLE IF EXISTS pe_fibra_segmento DROP CONSTRAINT IF EXISTS fk_pe_segmento_destino_nap`);
    await qr.query(`ALTER TABLE IF EXISTS pe_fibra_segmento DROP CONSTRAINT IF EXISTS fk_pe_segmento_origen_nap`);
    await qr.query(`DROP TABLE IF EXISTS pe_nap`);
    await qr.query(`DROP TABLE IF EXISTS pe_fibra_hilo`);
    await qr.query(`DROP TABLE IF EXISTS pe_fibra_segmento`);
    await qr.query(`DROP TABLE IF EXISTS pe_mufa`);
  }
}
