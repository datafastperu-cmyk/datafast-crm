import {
  Injectable, Logger, UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

// ─── DTOs ─────────────────────────────────────────────────────────

export class ConfigurarPoolDto {
  @IsInt() @Min(1) @Type(() => Number) inicio: number;
  @IsInt() @Min(1) @Type(() => Number) fin:    number;
}

export interface EstadoPool {
  total:    number;
  libres:   number;
  ocupados: number;
  rango?:   { min: number; max: number };
}

// ─── Service ──────────────────────────────────────────────────────

@Injectable()
export class OltServicePortPoolService {
  private readonly logger = new Logger(OltServicePortPoolService.name);

  constructor(
    @InjectDataSource()
    private readonly ds: DataSource,
  ) {}

  // ── configurarRango ───────────────────────────────────────────────
  // Puebla el pool con IDs desde inicio hasta fin (inclusive).
  // Usa INSERT ON CONFLICT DO NOTHING: idempotente y seguro para re-ejecución.
  async configurarRango(
    oltId:     string,
    empresaId: string,
    dto:       ConfigurarPoolDto,
  ): Promise<{ insertados: number; omitidos: number }> {
    if (dto.fin < dto.inicio) {
      throw new UnprocessableEntityException(
        `"fin" (${dto.fin}) debe ser ≥ "inicio" (${dto.inicio}).`,
      );
    }
    if (dto.fin - dto.inicio >= 4096) {
      throw new UnprocessableEntityException(
        `El rango no puede superar 4096 IDs por operación (pedido: ${dto.fin - dto.inicio + 1}).`,
      );
    }

    const ids: number[] = [];
    for (let i = dto.inicio; i <= dto.fin; i++) ids.push(i);

    const rows = await this.ds.query<{ service_port_id: number }[]>(
      `INSERT INTO olt_service_port_pool
         (id, empresa_id, olt_id, service_port_id, estado, created_at, updated_at, version)
       SELECT gen_random_uuid(), $1, $2, svc_id, 'libre', NOW(), NOW(), 1
       FROM   unnest($3::int[]) AS svc_id
       ON CONFLICT (olt_id, service_port_id) DO NOTHING
       RETURNING service_port_id`,
      [empresaId, oltId, ids],
    );

    const insertados = rows.length;
    const omitidos   = ids.length - insertados;
    this.logger.log(
      `Pool config | olt=${oltId} rango=${dto.inicio}–${dto.fin} ` +
      `insertados=${insertados} omitidos=${omitidos}`,
    );
    return { insertados, omitidos };
  }

  // ── allocar ───────────────────────────────────────────────────────
  // Asigna atómicamente el siguiente service_port_id libre.
  // Retorna null → pool sin configurar (modo bypass: DTO debe traer servicePortId).
  // Lanza UnprocessableEntityException si pool configurado pero agotado.
  async allocar(oltId: string, contratoId: string): Promise<number | null> {
    // Reutilizar si ya hay slot ocupado para este contrato (flujo de reintento)
    const [existing] = await this.ds.query<{ service_port_id: number }[]>(
      `SELECT service_port_id
       FROM   olt_service_port_pool
       WHERE  olt_id      = $1
         AND  contrato_id = $2
         AND  estado      = 'ocupado'
         AND  deleted_at  IS NULL
       LIMIT  1`,
      [oltId, contratoId],
    );
    if (existing) {
      this.logger.log(
        `Pool reuse | olt=${oltId} contrato=${contratoId} svcPort=${existing.service_port_id}`,
      );
      return existing.service_port_id;
    }

    // Asignación atómica: FOR UPDATE SKIP LOCKED garantiza cero colisiones bajo carga concurrente
    const result: any = await this.ds.query(
      `UPDATE olt_service_port_pool
       SET estado      = 'ocupado',
           contrato_id = $1,
           locked_at   = NOW(),
           updated_at  = NOW(),
           version     = version + 1
       WHERE id = (
         SELECT id
         FROM   olt_service_port_pool
         WHERE  olt_id     = $2
           AND  estado     = 'libre'
           AND  deleted_at IS NULL
         ORDER  BY service_port_id ASC
         LIMIT  1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING service_port_id`,
      [contratoId, oltId],
    );
    // TypeORM devuelve [filas, affectedCount] en UPDATE...RETURNING.
    const filas = Array.isArray(result?.[0]) ? result[0] : result;
    const allocated = filas?.[0] as { service_port_id: number } | undefined;

    if (allocated?.service_port_id != null) {
      this.logger.log(
        `Pool alloc | olt=${oltId} contrato=${contratoId} svcPort=${allocated.service_port_id}`,
      );
      return allocated.service_port_id;
    }

    // ¿El pool existe para esta OLT o está en modo bypass?
    const [{ total }] = await this.ds.query<{ total: string }[]>(
      `SELECT COUNT(*)::text AS total
       FROM   olt_service_port_pool
       WHERE  olt_id    = $1
         AND  deleted_at IS NULL`,
      [oltId],
    );

    if (Number(total) === 0) {
      // Sin pool configurado → el DTO debe traer servicePortId manualmente
      return null;
    }

    this.logger.warn(`Pool de Service Ports AGOTADO | olt=${oltId}`);
    throw new UnprocessableEntityException(
      `Pool de Service Port IDs agotado para esta OLT. ` +
      `Configura un rango más amplio desde el panel de la OLT.`,
    );
  }

  // ── liberar ───────────────────────────────────────────────────────
  // Devuelve un service port al pool (rollback de GPON fallido).
  async liberar(oltId: string, contratoId: string): Promise<void> {
    await this.ds.query(
      `UPDATE olt_service_port_pool
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
    this.logger.log(`Pool release | olt=${oltId} contrato=${contratoId}`);
  }

  // ── marcarColision ────────────────────────────────────────────────
  // El ID ya existe en la OLT (colisión): se marca ocupado sin contrato para
  // que allocar nunca lo devuelva. Se usa en el auto-sanado de la provisión.
  async marcarColision(oltId: string, servicePortId: number): Promise<void> {
    await this.ds.query(
      `UPDATE olt_service_port_pool
       SET estado      = 'ocupado',
           contrato_id = NULL,
           locked_at   = NOW(),
           updated_at  = NOW(),
           version     = version + 1
       WHERE olt_id          = $1
         AND service_port_id = $2
         AND deleted_at      IS NULL`,
      [oltId, servicePortId],
    );
    this.logger.warn(
      `Pool colisión | olt=${oltId} svcPort=${servicePortId} ya existe en la OLT — marcado no-usable`,
    );
  }

  // ── obtenerEstado ─────────────────────────────────────────────────
  async obtenerEstado(oltId: string, empresaId: string): Promise<EstadoPool> {
    const [s] = await this.ds.query<{
      total:    string;
      libres:   string;
      ocupados: string;
      min_id:   number | null;
      max_id:   number | null;
    }[]>(
      `SELECT
         COUNT(*)::text                                              AS total,
         SUM(CASE WHEN estado = 'libre'   THEN 1 ELSE 0 END)::text AS libres,
         SUM(CASE WHEN estado = 'ocupado' THEN 1 ELSE 0 END)::text AS ocupados,
         MIN(service_port_id)                                       AS min_id,
         MAX(service_port_id)                                       AS max_id
       FROM  olt_service_port_pool
       WHERE olt_id     = $1
         AND empresa_id = $2
         AND deleted_at IS NULL`,
      [oltId, empresaId],
    );

    return {
      total:    Number(s.total),
      libres:   Number(s.libres),
      ocupados: Number(s.ocupados),
      rango:    s.min_id != null ? { min: s.min_id, max: s.max_id! } : undefined,
    };
  }

  // ── limpiarLibres ─────────────────────────────────────────────────
  // Soft-delete de todas las entradas libres para reconfigurar el rango.
  // Las entradas ocupadas se mantienen intactas.
  async limpiarLibres(oltId: string, empresaId: string): Promise<{ eliminados: number }> {
    const result: any = await this.ds.query(
      `UPDATE olt_service_port_pool
       SET deleted_at = NOW(),
           updated_at = NOW(),
           version    = version + 1
       WHERE olt_id     = $1
         AND empresa_id = $2
         AND estado     = 'libre'
         AND deleted_at IS NULL
       RETURNING id`,
      [oltId, empresaId],
    );
    // TypeORM/pg devuelve [filas, affectedCount] para UPDATE...RETURNING.
    const filas = Array.isArray(result?.[0]) ? result[0] : result;
    const eliminados = Array.isArray(filas) ? filas.length : Number(result?.[1]) || 0;
    this.logger.log(`Pool limpiar libres | olt=${oltId} eliminados=${eliminados}`);
    return { eliminados };
  }
}
