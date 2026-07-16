import {
  Injectable, Logger, NotFoundException,
  ServiceUnavailableException, UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { CanalServicePort } from '../entities/olt-service-port-pool.entity';
import { OltDispositivo } from '../entities/olt-dispositivo.entity';
import { OltAutomationClient } from '../olt-automation.client';
import { OltConnService } from './olt-conn.service';

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

export interface ResultadoReconciliacion {
  reales:        number;
  marcadosOcupados: number;
  porCanal:      Record<CanalServicePort, number>;
}

// ─── Service ──────────────────────────────────────────────────────

@Injectable()
export class OltServicePortPoolService {
  private readonly logger = new Logger(OltServicePortPoolService.name);

  constructor(
    @InjectDataSource()
    private readonly ds: DataSource,

    @InjectRepository(OltDispositivo)
    private readonly oltRepo: Repository<OltDispositivo>,

    private readonly automation: OltAutomationClient,
    private readonly connService: OltConnService,
  ) {}

  // ── configurarRango ───────────────────────────────────────────────
  // Puebla el pool con IDs desde inicio hasta fin (inclusive).
  // Usa INSERT ON CONFLICT DO NOTHING: idempotente y seguro para re-ejecución.
  async configurarRango(
    oltId:     string,
    empresaId: string,
    dto:       ConfigurarPoolDto,
    canal:     CanalServicePort = 'datos',
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
         (id, empresa_id, olt_id, canal, service_port_id, estado, created_at, updated_at, version)
       SELECT gen_random_uuid(), $1, $2, 'datos', svc_id, 'libre', NOW(), NOW(), 1
       FROM   unnest($3::int[]) AS svc_id
       ON CONFLICT (olt_id, service_port_id) DO NOTHING
       RETURNING service_port_id`,
      [empresaId, oltId, ids],
    );

    const insertados = rows.length;
    const omitidos   = ids.length - insertados;
    this.logger.log(
      `Pool config | olt=${oltId} canal=${canal} rango=${dto.inicio}–${dto.fin} ` +
      `insertados=${insertados} omitidos=${omitidos}`,
    );
    return { insertados, omitidos };
  }

  // ── allocar ───────────────────────────────────────────────────────
  // Asigna atómicamente el siguiente service_port_id libre.
  // Retorna null → pool sin configurar (modo bypass: DTO debe traer servicePortId).
  // Lanza UnprocessableEntityException si pool configurado pero agotado.
  async allocar(
    oltId: string,
    contratoId: string,
    canal: CanalServicePort = 'datos',
  ): Promise<number | null> {
    // Reutilizar si ya hay slot ocupado para este contrato (flujo de reintento)
    const [existing] = await this.ds.query<{ service_port_id: number }[]>(
      `SELECT service_port_id
       FROM   olt_service_port_pool
       WHERE  olt_id      = $1
         AND  contrato_id = $2
         AND  canal       = $3
         AND  estado      = 'ocupado'
         AND  deleted_at  IS NULL
       LIMIT  1`,
      [oltId, contratoId, canal],
    );
    if (existing) {
      this.logger.log(
        `Pool reuse | olt=${oltId} canal=${canal} contrato=${contratoId} svcPort=${existing.service_port_id}`,
      );
      return existing.service_port_id;
    }

    // Asignación atómica sobre el NAMESPACE ÚNICO (Opción A): se toma el menor ID libre
    // del pool SIN importar el rol previo y se ESTAMPA el rol (canal) en la fila. Como la
    // unicidad es (olt_id, service_port_id), un ID solo puede quedar asignado a un
    // contrato/rol a la vez → cero solape entre datos y gestión por construcción.
    // FOR UPDATE SKIP LOCKED garantiza cero colisiones bajo carga concurrente.
    const result: any = await this.ds.query(
      `UPDATE olt_service_port_pool
       SET estado      = 'ocupado',
           contrato_id = $1,
           canal       = $3,
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
      [contratoId, oltId, canal],
    );
    // TypeORM devuelve [filas, affectedCount] en UPDATE...RETURNING.
    const filas = Array.isArray(result?.[0]) ? result[0] : result;
    const allocated = filas?.[0] as { service_port_id: number } | undefined;

    if (allocated?.service_port_id != null) {
      this.logger.log(
        `Pool alloc | olt=${oltId} canal=${canal} contrato=${contratoId} svcPort=${allocated.service_port_id}`,
      );
      return allocated.service_port_id;
    }

    // ¿El pool existe para esta OLT o está en modo bypass? Namespace único → se cuenta
    // todo el pool de la OLT, no por canal (los IDs libres son neutrales hasta asignarse).
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

    this.logger.warn(`Pool de Service Ports AGOTADO | olt=${oltId} canal=${canal}`);
    throw new UnprocessableEntityException(
      `Pool de Service Port IDs (canal ${canal}) agotado para esta OLT. ` +
      `Configura un rango más amplio desde el panel de la OLT.`,
    );
  }

  // ── liberar ───────────────────────────────────────────────────────
  // Devuelve un service port al pool (rollback de GPON fallido).
  async liberar(
    oltId: string,
    contratoId: string,
    canal: CanalServicePort = 'datos',
  ): Promise<void> {
    // Al liberar se NEUTRALIZA el rol (canal='datos'): la fila vuelve al pool único como
    // ID libre neutro, reasignable a cualquier rol. Se localiza por el rol con que se asignó.
    await this.ds.query(
      `UPDATE olt_service_port_pool
       SET estado      = 'libre',
           contrato_id = NULL,
           canal       = 'datos',
           locked_at   = NULL,
           updated_at  = NOW(),
           version     = version + 1
       WHERE olt_id      = $1
         AND contrato_id = $2
         AND canal       = $3
         AND deleted_at  IS NULL`,
      [oltId, contratoId, canal],
    );
    this.logger.log(`Pool release | olt=${oltId} canal=${canal} contrato=${contratoId}`);
  }

  // ── marcarColision ────────────────────────────────────────────────
  // El ID ya existe en la OLT (colisión): se marca ocupado sin contrato para
  // que allocar nunca lo devuelva. Se usa en el auto-sanado de la provisión.
  async marcarColision(
    oltId: string,
    servicePortId: number,
    canal: CanalServicePort = 'datos',
  ): Promise<void> {
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

  // ── reconciliarConOlt ───────────────────────────────────────────────
  // Incremento 6 — migrar una OLT en producción (hoy controlada por
  // SmartOLT en paralelo) sin que el ERP choque con IDs que SmartOLT ya
  // usa. Lee TODOS los service-ports reales de la OLT y los marca
  // 'ocupado, sin contrato' en el pool — inserta si el ID nunca existió
  // en el pool, o lo pisa a 'ocupado' si estaba libre. Nunca toca un ID
  // que YA tiene contrato_id asignado por el ERP (no se pisa una
  // asignación propia real).
  //
  // Solo lectura hacia la OLT — no escribe nada en el hardware.
  async reconciliarConOlt(oltId: string, empresaId: string): Promise<ResultadoReconciliacion> {
    const olt = await this.oltRepo.findOne({ where: { id: oltId, empresaId } });
    if (!olt) throw new NotFoundException(`OLT ${oltId} no encontrada.`);

    const conn = await this.connService.buildConn(olt);
    const res  = await this.automation.servicePorts({ connection: conn });

    if (!res.success) {
      throw new ServiceUnavailableException(`No se pudo leer service-ports de la OLT: ${res.error}`);
    }

    // Heurística de canal: la VLAN de gestión/TR-069 configurada en el ERP
    // (si existe) define el canal 'gestion'; todo lo demás es 'datos'.
    // Con NODO MALVINAS sin VLAN de gestión declarada todavía, todo cae en
    // 'datos' — se corrige cuando se declare la VLAN real (paso 2 del plan).
    const vlanGestion = olt.tr069MgmtVlan ?? olt.vlanGestionDefecto;
    const porCanal: Record<CanalServicePort, number> = { datos: 0, gestion: 0 };

    for (const port of res.ports) {
      const canal: CanalServicePort = vlanGestion != null && port.vlan_id === vlanGestion ? 'gestion' : 'datos';
      porCanal[canal]++;

      await this.ds.query(
        `INSERT INTO olt_service_port_pool
           (id, empresa_id, olt_id, canal, service_port_id, estado, locked_at, created_at, updated_at, version)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, 'ocupado', NOW(), NOW(), NOW(), 1)
         ON CONFLICT (olt_id, service_port_id) DO UPDATE
           SET estado     = 'ocupado',
               canal      = EXCLUDED.canal,
               locked_at  = NOW(),
               updated_at = NOW(),
               version    = olt_service_port_pool.version + 1
           WHERE olt_service_port_pool.contrato_id IS NULL`,
        [empresaId, oltId, canal, port.index],
      );
    }

    this.logger.log(
      `Reconciliación pool | olt=${oltId} reales=${res.ports.length} datos=${porCanal.datos} gestion=${porCanal.gestion}`,
    );

    return { reales: res.ports.length, marcadosOcupados: res.ports.length, porCanal };
  }

  // ── obtenerEstado ─────────────────────────────────────────────────
  async obtenerEstado(
    oltId: string,
    empresaId: string,
    canal: CanalServicePort = 'datos',
  ): Promise<EstadoPool> {
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
  async limpiarLibres(
    oltId: string,
    empresaId: string,
    canal: CanalServicePort = 'datos',
  ): Promise<{ eliminados: number }> {
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
    this.logger.log(`Pool limpiar libres | olt=${oltId} canal=${canal} eliminados=${eliminados}`);
    return { eliminados };
  }
}
