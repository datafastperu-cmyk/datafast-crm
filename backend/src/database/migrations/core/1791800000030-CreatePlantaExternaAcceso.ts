import { MigrationInterface, QueryRunner } from 'typeorm';

// ─────────────────────────────────────────────────────────────────────────────
// Planta externa FTTH — 3/3: el ACCESO (puertos y acometidas)
//
// Es la parte del módulo donde la corrección importa más, porque es la única que
// se disputa bajo concurrencia: dos operadores dando de alta a la vez.
//
// El expediente original especificaba "Puertos Libres = Capacidad del Splitter −
// Cantidad de Clientes Activos". Eso es una race condition: ambos leen "puerto 3
// libre" y ambos lo asignan. Contar no es reservar. Aquí el puerto es una FILA que
// se toma con un UPDATE condicional, y el UNIQUE de la acometida es la segunda
// línea de defensa por si alguien en el futuro escribe el UPDATE mal.
// ─────────────────────────────────────────────────────────────────────────────
export class CreatePlantaExternaAcceso1791800000030 implements MigrationInterface {
  name = 'CreatePlantaExternaAcceso1791800000030';

  public async up(qr: QueryRunner): Promise<void> {

    // ── Puertos de NAP ──────────────────────────────────────────────────
    // Una fila FÍSICA por puerto, creadas en la misma transacción que la NAP con
    // estado inicial `no_habilitado`: el adaptador existe desde que se instala la
    // caja. Al instalar un splitter, sus salidas se mapean a N puertos y ésos pasan
    // a `libre`.
    //
    // La numeración es continua por NAP (1..capacidad_puertos, atravesando todos sus
    // splitters), nunca reiniciada por splitter: es la que el técnico lee rotulada en
    // la caja, y si no coincide con la del ERP el dato es inútil en campo.
    await qr.query(`
      CREATE TABLE IF NOT EXISTS pe_nap_puerto (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        empresa_id  UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        nap_id      UUID NOT NULL REFERENCES pe_nap(id) ON DELETE CASCADE,

        numero      INTEGER     NOT NULL,
        estado      VARCHAR(20) NOT NULL DEFAULT 'no_habilitado',

        -- Qué salida de splitter lo alimenta. NULL = no_habilitado (no hay splitter
        -- detrás). ON DELETE RESTRICT: retirar un splitter cuyas salidas alimentan
        -- puertos debe fallar explícitamente, no vaciarlos en cascada — eso borraría
        -- la trazabilidad de clientes que siguen navegando.
        splitter_salida_id UUID UNIQUE REFERENCES pe_splitter_salida(id) ON DELETE RESTRICT,

        -- Reserva del wizard de alta. El servidor es la autoridad: 'beforeunload' no
        -- puede ejecutar trabajo asíncrono fiable, así que el mecanismo real de
        -- liberación es la expiración de este TTL barrida por un cron, jamás un aviso
        -- best-effort del navegador (directriz de wizards, punto 10).
        reservado_por_usuario_id UUID,
        reservado_hasta          TIMESTAMPTZ,

        observacion TEXT,

        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        deleted_at  TIMESTAMPTZ,
        version     INTEGER NOT NULL DEFAULT 1,

        CONSTRAINT chk_pe_puerto_estado CHECK (
          estado IN ('no_habilitado','libre','reservado','ocupado','averiado','retirado')
        ),
        CONSTRAINT chk_pe_puerto_numero CHECK (numero BETWEEN 1 AND 64),

        -- Un puerto 'reservado' SIEMPRE tiene dueño y vencimiento. Sin esto una
        -- reserva sin fecha queda retenida para siempre y el barrido no la ve:
        -- exactamente el recurso bloqueado por una pestaña olvidada que la directriz
        -- de wizards manda evitar.
        CONSTRAINT chk_pe_puerto_reserva_completa CHECK (
          estado <> 'reservado'
          OR (reservado_por_usuario_id IS NOT NULL AND reservado_hasta IS NOT NULL)
        ),

        -- Un puerto sin splitter detrás no puede estar dando servicio. Cierra la
        -- distinción entre capacidad de caja y capacidad de splitter a nivel de BD,
        -- no sólo de servicio.
        CONSTRAINT chk_pe_puerto_habilitado_tiene_salida CHECK (
          estado NOT IN ('libre','reservado','ocupado') OR splitter_salida_id IS NOT NULL
        )
      )
    `);

    // ── Acometidas (última milla) ───────────────────────────────────────
    await qr.query(`
      CREATE TABLE IF NOT EXISTS pe_acometida (
        id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        empresa_id    UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,

        contrato_id   UUID NOT NULL REFERENCES contratos(id)     ON DELETE RESTRICT,
        nap_puerto_id UUID NOT NULL REFERENCES pe_nap_puerto(id) ON DELETE RESTRICT,

        longitud_m    NUMERIC(6,2),

        -- ── VIO: la documentación es una afirmación SIN VERIFICAR ────────
        -- Que un técnico haya escrito "NAP-12, puerto 3" no significa que el cliente
        -- esté ahí. Es el patrón del incidente CNT-2026-000004: accepted ≠ materialized.
        -- El puente verificable es olt_onu_inventario (olt_id, slot, port, sn) más la
        -- potencia óptica; el reconciliador de la Fase 3 lo cruza.
        --   declarado   → lo escribió un humano, nadie lo comprobó (estado de alta)
        --   verificado  → el puerto PON derivado del grafo coincide con el real
        --   discrepante → NO coinciden. No se autocorrige: no se sabe cuál miente.
        confianza     VARCHAR(20) NOT NULL DEFAULT 'declarado',
        verificado_at TIMESTAMPTZ,
        verificado_evidencia JSONB,

        -- Pérdida acumulada calculada por el grafo (Fase 3). Se contrasta contra el
        -- rx_power_dbm real de la ONU: desviación > 3 dB es alerta de planta.
        presupuesto_optico_db NUMERIC(5,2),

        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        deleted_at  TIMESTAMPTZ,
        version     INTEGER NOT NULL DEFAULT 1,

        CONSTRAINT chk_pe_acometida_confianza
          CHECK (confianza IN ('declarado','verificado','discrepante')),
        -- Una acometida 'verificado' sin evidencia ni fecha es exactamente el
        -- "success: true" sin comprobar que la regla VIO existe para impedir.
        CONSTRAINT chk_pe_acometida_verificada_con_evidencia CHECK (
          confianza <> 'verificado'
          OR (verificado_at IS NOT NULL AND verificado_evidencia IS NOT NULL)
        )
      )
    `);

    // ── Invariantes de exclusión mutua ──────────────────────────────────

    // Un puerto no se repite dentro de su caja.
    await qr.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_pe_puerto_nap_numero
        ON pe_nap_puerto (nap_id, numero) WHERE deleted_at IS NULL
    `);

    // UN PUERTO, UN CONTRATO. Estos dos índices son la garantía real de que la
    // asignación es exclusiva. El UPDATE condicional del servicio es la primera
    // defensa; estos índices son la que no depende de que ese UPDATE esté bien
    // escrito hoy y siga estándolo dentro de dos años.
    await qr.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_pe_acometida_puerto
        ON pe_acometida (nap_puerto_id) WHERE deleted_at IS NULL
    `);
    await qr.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_pe_acometida_contrato
        ON pe_acometida (contrato_id) WHERE deleted_at IS NULL
    `);

    // Búsqueda de puertos asignables y barrido de reservas vencidas.
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_pe_puerto_nap_estado
        ON pe_nap_puerto (nap_id, estado) WHERE deleted_at IS NULL
    `);
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_pe_puerto_reserva_vencida
        ON pe_nap_puerto (reservado_hasta)
        WHERE estado = 'reservado' AND deleted_at IS NULL
    `);
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_pe_acometida_empresa
        ON pe_acometida (empresa_id, confianza) WHERE deleted_at IS NULL
    `);

    // ── Contadores denormalizados de la NAP ─────────────────────────────
    //
    // Recalcula por NAP en vez de aplicar deltas incrementales. Es más trabajo por
    // escritura y a cambio es imposible que derive: un delta que se pierde (un UPDATE
    // que cambia dos veces de estado en la misma transacción, un rollback parcial)
    // deja el contador mintiendo para siempre, y nadie lo nota hasta que el semáforo
    // del mapa muestra puertos que no existen.
    //
    // La escritura de puertos es poco frecuente (altas y bajas de clientes), la
    // lectura del mapa es constante. Pagar en la escritura barata para que la lectura
    // cara sea un SELECT directo es el intercambio correcto.
    //
    // La FUENTE DE VERDAD sigue siendo pe_nap_puerto. Esto es caché.
    await qr.query(`
      CREATE OR REPLACE FUNCTION pe_recalcular_contadores_nap() RETURNS TRIGGER AS $$
      DECLARE
        v_nap_id UUID;
      BEGIN
        v_nap_id := COALESCE(NEW.nap_id, OLD.nap_id);

        UPDATE pe_nap n SET
          puertos_libres = (
            SELECT COUNT(*) FROM pe_nap_puerto p
             WHERE p.nap_id = v_nap_id AND p.deleted_at IS NULL AND p.estado = 'libre'
          ),
          puertos_no_habilitados = (
            SELECT COUNT(*) FROM pe_nap_puerto p
             WHERE p.nap_id = v_nap_id AND p.deleted_at IS NULL AND p.estado = 'no_habilitado'
          )
        WHERE n.id = v_nap_id;

        RETURN NULL;  -- AFTER trigger: el valor de retorno se ignora
      END;
      $$ LANGUAGE plpgsql
    `);

    await qr.query(`
      CREATE TRIGGER trg_pe_contadores_nap
        AFTER INSERT OR UPDATE OF estado, deleted_at OR DELETE ON pe_nap_puerto
        FOR EACH ROW EXECUTE FUNCTION pe_recalcular_contadores_nap()
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TRIGGER IF EXISTS trg_pe_contadores_nap ON pe_nap_puerto`);
    await qr.query(`DROP FUNCTION IF EXISTS pe_recalcular_contadores_nap()`);
    await qr.query(`DROP TABLE IF EXISTS pe_acometida`);
    await qr.query(`DROP TABLE IF EXISTS pe_nap_puerto`);
  }
}
