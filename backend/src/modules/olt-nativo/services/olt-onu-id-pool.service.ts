import {
  Injectable, Logger, UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { OltOnuInventario } from '../entities/olt-onu-inventario.entity';

// ─── Service ──────────────────────────────────────────────────────
//
// Pool de ONU IDs (1–128) por puerto PON.
// Se inicializa de forma LAZY en el primer uso del puerto:
//   - Inserta IDs 1-128, marcando como "ocupado" cualquier ONU ya
//     registrada en ftth_onu_registro (contratos activos preexistentes).
//   - El INSERT es idempotente gracias al ON CONFLICT DO NOTHING.
//
// La asignación atómica usa FOR UPDATE SKIP LOCKED — garantiza
// cero colisiones bajo aprovisionamiento concurrente del mismo puerto.
// ─────────────────────────────────────────────────────────────────

@Injectable()
export class OltOnuIdPoolService {
  private readonly logger = new Logger(OltOnuIdPoolService.name);

  constructor(
    @InjectDataSource()
    private readonly ds: DataSource,

    @InjectRepository(OltOnuInventario)
    private readonly inventarioRepo: Repository<OltOnuInventario>,
  ) {}

  // ── allocar ───────────────────────────────────────────────────────
  // Auto-asigna el menor ONU ID libre para (olt, slot, port).
  // Inicializa el pool para el puerto si es la primera vez.
  async allocar(
    oltId:      string,
    empresaId:  string,
    slot:       number,
    port:       number,
    contratoId: string,
  ): Promise<number> {
    // Reutilizar si ya hay un slot ocupado para este contrato (reintento)
    const [existing] = await this.ds.query<{ onu_id: number }[]>(
      `SELECT onu_id
       FROM   olt_onu_id_pool
       WHERE  olt_id      = $1 AND slot = $2 AND port = $3
         AND  contrato_id = $4 AND estado = 'ocupado' AND deleted_at IS NULL
       LIMIT  1`,
      [oltId, slot, port, contratoId],
    );
    if (existing) {
      this.logger.log(
        `ONU ID reuse | olt=${oltId} ${slot}/${port} contrato=${contratoId} onuId=${existing.onu_id}`,
      );
      return existing.onu_id;
    }

    // Lazy init del pool para este puerto (idempotente: ON CONFLICT DO NOTHING)
    const [{ cnt }] = await this.ds.query<{ cnt: string }[]>(
      `SELECT COUNT(*)::text AS cnt
       FROM   olt_onu_id_pool
       WHERE  olt_id = $1 AND slot = $2 AND port = $3 AND deleted_at IS NULL`,
      [oltId, slot, port],
    );

    if (Number(cnt) === 0) {
      await this.ds.query(
        `INSERT INTO olt_onu_id_pool
           (id, empresa_id, olt_id, slot, port, onu_id, estado, created_at, updated_at, version)
         SELECT
           gen_random_uuid(), $1, $2, $3, $4, gs.onu_id,
           CASE WHEN ftor.onu_id IS NOT NULL THEN 'ocupado' ELSE 'libre' END,
           NOW(), NOW(), 1
         FROM generate_series(1, 128) AS gs(onu_id)
         LEFT JOIN ftth_onu_registro ftor ON (
           ftor.olt_id  = $2
           AND ftor.slot    = $3
           AND ftor.port    = $4
           AND ftor.onu_id  = gs.onu_id
           AND ftor.deleted_at IS NULL
           AND ftor.estado NOT IN ('fallido_gpon', 'fallido_wan')
         )
         ON CONFLICT (olt_id, slot, port, onu_id) DO NOTHING`,
        [empresaId, oltId, slot, port],
      );
      this.logger.log(`ONU ID pool init | olt=${oltId} slot=${slot} port=${port}`);
    }

    // Asignación atómica: FOR UPDATE SKIP LOCKED garantiza cero colisiones
    const result: any = await this.ds.query(
      `UPDATE olt_onu_id_pool
       SET estado      = 'ocupado',
           contrato_id = $1,
           locked_at   = NOW(),
           updated_at  = NOW(),
           version     = version + 1
       WHERE id = (
         SELECT id
         FROM   olt_onu_id_pool
         WHERE  olt_id     = $2
           AND  slot       = $3
           AND  port       = $4
           AND  estado     = 'libre'
           AND  deleted_at IS NULL
         ORDER  BY onu_id ASC
         LIMIT  1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING onu_id`,
      [contratoId, oltId, slot, port],
    );
    // TypeORM devuelve [filas, affectedCount] en UPDATE...RETURNING.
    const filas = Array.isArray(result?.[0]) ? result[0] : result;
    const allocated = filas?.[0] as { onu_id: number } | undefined;

    if (allocated?.onu_id != null) {
      this.logger.log(
        `ONU ID alloc | olt=${oltId} ${slot}/${port} contrato=${contratoId} onuId=${allocated.onu_id}`,
      );
      return allocated.onu_id;
    }

    throw new UnprocessableEntityException(
      `Todos los ONU IDs (1–128) están ocupados en slot=${slot} port=${port}. ` +
      `Puerto PON al máximo de capacidad.`,
    );
  }

  // ── liberar ───────────────────────────────────────────────────────
  async liberar(oltId: string, contratoId: string): Promise<void> {
    await this.ds.query(
      `UPDATE olt_onu_id_pool
       SET estado      = 'libre',
           contrato_id = NULL,
           locked_at   = NULL,
           updated_at  = NOW(),
           version     = version + 1
       WHERE olt_id      = $1
         AND contrato_id = $2
         AND deleted_at  IS NULL`,
      [oltId, contratoId],
    );
    this.logger.log(`ONU ID release | olt=${oltId} contrato=${contratoId}`);
  }

  // ── sincronizarOcupacionOlt ───────────────────────────────────────
  // Marca como ocupados los ONT-IDs que YA existen en la OLT (incluidas las ONUs
  // creadas por SmartOLT/AdminOLT, ausentes de nuestra BD). Sin esto, en un puerto
  // compartido el pool asignaría un ID en colisión y el aprovisionamiento fallaría
  // con "The ONT ID has already existed". Idempotente: inicializa el pool si hace
  // falta y solo toca las entradas 'libre' (no pisa contratos ya asignados).
  async sincronizarOcupacionOlt(
    oltId:     string,
    empresaId: string,
    slot:      number,
    port:      number,
    ontIds:    number[],
  ): Promise<number> {
    if (!ontIds.length) return 0;

    // Init idempotente del pool del puerto (1–128).
    await this.ds.query(
      `INSERT INTO olt_onu_id_pool
         (id, empresa_id, olt_id, slot, port, onu_id, estado, created_at, updated_at, version)
       SELECT gen_random_uuid(), $1, $2, $3, $4, gs.onu_id, 'libre', NOW(), NOW(), 1
       FROM   generate_series(1, 128) AS gs(onu_id)
       ON CONFLICT (olt_id, slot, port, onu_id) DO NOTHING`,
      [empresaId, oltId, slot, port],
    );

    const result: any = await this.ds.query(
      `UPDATE olt_onu_id_pool
       SET estado='ocupado', contrato_id=NULL, locked_at=NOW(), updated_at=NOW(), version=version+1
       WHERE olt_id=$1 AND slot=$2 AND port=$3
         AND onu_id = ANY($4::int[])
         AND estado='libre' AND deleted_at IS NULL
       RETURNING onu_id`,
      [oltId, slot, port, ontIds],
    );
    const filas = Array.isArray(result?.[0]) ? result[0] : result;
    const marcados = Array.isArray(filas) ? filas.length : 0;
    this.logger.log(
      `ONU ID sync OLT | olt=${oltId} ${slot}/${port} ocupados en OLT=${ontIds.length} marcados=${marcados}`,
    );
    return marcados;
  }

  // ── reconciliarTodosPuertos ─────────────────────────────────────────
  // Incremento 6 — migrar una OLT en producción (hoy controlada por
  // SmartOLT en paralelo) sin que el pool del ERP asigne un ONU-ID que
  // SmartOLT ya usa. Agrupa el inventario YA sincronizado (olt_onu_inventario,
  // no vuelve a leer la OLT) por puerto y reutiliza sincronizarOcupacionOlt
  // — el mismo primitivo que ya protege el auto-sanado de colisiones.
  async reconciliarTodosPuertos(
    oltId: string, empresaId: string,
  ): Promise<{ puertos: number; marcados: number }> {
    const filas = await this.inventarioRepo.find({ where: { oltId, empresaId } });

    const porPuerto = new Map<string, { slot: number; port: number; onuIds: number[] }>();
    for (const f of filas) {
      if (f.onuId === null) continue;
      const key = `${f.slot}/${f.port}`;
      if (!porPuerto.has(key)) porPuerto.set(key, { slot: f.slot, port: f.port, onuIds: [] });
      porPuerto.get(key)!.onuIds.push(f.onuId);
    }

    let marcados = 0;
    for (const { slot, port, onuIds } of porPuerto.values()) {
      marcados += await this.sincronizarOcupacionOlt(oltId, empresaId, slot, port, onuIds);
    }

    this.logger.log(
      `Reconciliación ONU-ID pool | olt=${oltId} puertos=${porPuerto.size} marcados=${marcados}`,
    );
    return { puertos: porPuerto.size, marcados };
  }

  // ── marcarColision ────────────────────────────────────────────────
  // El ONU-ID ya existe en la OLT (colisión): típicamente una ONU creada por
  // SmartOLT/AdminOLT fuera de nuestra BD, que el pool creía libre. Se marca ocupado
  // sin contrato para que `allocar` nunca lo devuelva. Se usa en el auto-sanado.
  async marcarColision(oltId: string, slot: number, port: number, onuId: number): Promise<void> {
    await this.ds.query(
      `UPDATE olt_onu_id_pool
       SET estado      = 'ocupado',
           contrato_id = NULL,
           locked_at   = NOW(),
           updated_at  = NOW(),
           version     = version + 1
       WHERE olt_id     = $1
         AND slot       = $2
         AND port       = $3
         AND onu_id     = $4
         AND deleted_at IS NULL`,
      [oltId, slot, port, onuId],
    );
    this.logger.warn(
      `ONU ID colisión | olt=${oltId} ${slot}/${port} onuId=${onuId} ya existe en la OLT — marcado no-usable`,
    );
  }

  // ── obtenerEstado ─────────────────────────────────────────────────
  async obtenerEstado(
    oltId:     string,
    empresaId: string,
    slot:      number,
    port:      number,
  ): Promise<{ total: number; libres: number; ocupados: number; inicializado: boolean }> {
    const [s] = await this.ds.query<{
      total: string; libres: string; ocupados: string;
    }[]>(
      `SELECT
         COUNT(*)::text                                              AS total,
         SUM(CASE WHEN estado = 'libre'   THEN 1 ELSE 0 END)::text AS libres,
         SUM(CASE WHEN estado = 'ocupado' THEN 1 ELSE 0 END)::text AS ocupados
       FROM  olt_onu_id_pool
       WHERE olt_id     = $1
         AND empresa_id = $2
         AND slot       = $3
         AND port       = $4
         AND deleted_at IS NULL`,
      [oltId, empresaId, slot, port],
    );
    const total = Number(s.total);
    return {
      total,
      libres:      Number(s.libres),
      ocupados:    Number(s.ocupados),
      inicializado: total > 0,
    };
  }
}
