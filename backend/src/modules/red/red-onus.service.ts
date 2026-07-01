import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DataSource, Repository }                from 'typeorm';
import { InjectDataSource, InjectRepository }    from '@nestjs/typeorm';
import { EventEmitter2 }                         from '@nestjs/event-emitter';
import { v4 as uuidv4 }                          from 'uuid';
import { FtthOnuRegistro }     from '../olt-nativo/entities/ftth-onu-registro.entity';
import { MetricasOnuOptical }  from '../olt-nativo/entities/metricas-onu-optical.entity';
import { OltNativoService }    from '../olt-nativo/olt-nativo.service';
import { ProvisionFtthService } from '../olt-nativo/services/provision-ftth.service';
import { ObtenerMetricasDto }   from '../olt-nativo/dto/olt-nativo-ops.dto';

// ─── Tipos públicos ───────────────────────────────────────────

export const RED_ONU_SEÑAL   = 'red.onu.señal';
export const RED_BATCH_DONE  = 'red.batch.completado';

export type CalidadSeñal = 'buena' | 'marginal' | 'critica' | 'sin_datos';

export interface OnuRow {
  id:                  string;
  sn:                  string;
  slot:                number;
  port:                number;
  onuId:               number;
  estado:              string;
  vlan:                number;
  oltId:               string;
  oltNombre:           string;
  oltMarca:            string;
  clienteId:           string | null;
  clienteNombre:       string | null;
  numeroContrato:      string | null;
  planNombre:          string | null;
  zonaNombre:          string | null;
  zonaId:              string | null;
  rxPowerDbm:          number | null;
  txPowerDbm:          number | null;
  señalActualizadaEn:  string | null;
  calidadSeñal:        CalidadSeñal;
}

export interface OnuListResponse {
  data: OnuRow[];
  meta: { total: number; page: number; limit: number; pages: number };
}

export interface ListarOnusFilters {
  page?:   number;
  limit?:  number;
  oltId?:  string;
  estado?: string;
  zonaId?: string;
  calidad?: string;
  q?:      string;
  sort?:   string;
  dir?:    'ASC' | 'DESC';
}

// ─────────────────────────────────────────────────────────────

const SORT_MAP: Record<string, string> = {
  cliente:       'cl.nombre_completo',
  sn:            'r.sn',
  estado:        'r.estado',
  calidad_señal: 'calidad_señal',
  olt_nombre:    'o.nombre',
};

@Injectable()
export class RedOnusService {
  private readonly logger = new Logger(RedOnusService.name);

  constructor(
    @InjectDataSource()
    private readonly ds: DataSource,

    @InjectRepository(FtthOnuRegistro)
    private readonly ftthRepo: Repository<FtthOnuRegistro>,

    @InjectRepository(MetricasOnuOptical)
    private readonly metricasRepo: Repository<MetricasOnuOptical>,

    private readonly oltService:    OltNativoService,
    private readonly ftthService:   ProvisionFtthService,
    private readonly events:        EventEmitter2,
  ) {}

  // ── Paso 3 + 4: query principal con filtros ───────────────

  async listar(empresaId: string, filters: ListarOnusFilters = {}): Promise<OnuListResponse> {
    const page    = Math.max(1, filters.page  ?? 1);
    const limit   = Math.min(100, Math.max(1, filters.limit ?? 50));
    const offset  = (page - 1) * limit;
    const sort    = SORT_MAP[filters.sort ?? ''] ?? 'cl.nombre_completo';
    const dir     = filters.dir === 'DESC' ? 'DESC' : 'ASC';

    const params: unknown[] = [empresaId];
    const where: string[]   = [`r.empresa_id = $${params.length} AND r.deleted_at IS NULL`];

    if (filters.oltId)  { params.push(filters.oltId);   where.push(`r.olt_id = $${params.length}`); }
    if (filters.estado) { params.push(filters.estado);  where.push(`r.estado = $${params.length}`); }
    if (filters.zonaId) { params.push(filters.zonaId);  where.push(`cl.zona_id = $${params.length}`); }

    if (filters.calidad) {
      const calMap: Record<string, string> = {
        buena:     'm.rx_power_dbm >= -23',
        marginal:  'm.rx_power_dbm >= -27 AND m.rx_power_dbm < -23',
        critica:   'm.rx_power_dbm < -27',
        sin_datos: 'm.rx_power_dbm IS NULL',
      };
      const expr = calMap[filters.calidad];
      if (expr) where.push(`(${expr})`);
    }

    if (filters.q) {
      params.push(`%${filters.q.trim().slice(0, 100)}%`);
      const n = params.length;
      where.push(`(r.sn ILIKE $${n} OR cl.nombre_completo ILIKE $${n} OR c.numero_contrato ILIKE $${n})`);
    }

    const whereClause = where.join(' AND ');

    const sql = `
      SELECT
        r.id,
        r.sn,
        r.slot,
        r.port,
        r.onu_id                                         AS "onuId",
        r.estado,
        r.vlan,
        o.id                                             AS "oltId",
        o.nombre                                         AS "oltNombre",
        o.marca::text                                    AS "oltMarca",
        cl.id                                            AS "clienteId",
        cl.nombre_completo                               AS "clienteNombre",
        c.numero_contrato                                AS "numeroContrato",
        p.nombre                                         AS "planNombre",
        z.nombre                                         AS "zonaNombre",
        z.id                                             AS "zonaId",
        m.rx_power_dbm                                   AS "rxPowerDbm",
        m.tx_power_dbm                                   AS "txPowerDbm",
        m.timestamp                                      AS "señalActualizadaEn",
        CASE
          WHEN m.rx_power_dbm IS NULL    THEN 'sin_datos'
          WHEN m.rx_power_dbm >= -23     THEN 'buena'
          WHEN m.rx_power_dbm >= -27     THEN 'marginal'
          ELSE                                'critica'
        END                                              AS "calidadSeñal",
        COUNT(*) OVER()                                  AS "__total"
      FROM ftth_onu_registro r
      JOIN olt_dispositivos  o  ON o.id = r.olt_id AND o.deleted_at IS NULL
      LEFT JOIN contratos    c  ON c.id = r.contrato_id AND c.deleted_at IS NULL
      LEFT JOIN clientes     cl ON cl.id = c.cliente_id AND cl.deleted_at IS NULL
      LEFT JOIN planes       p  ON p.id = c.plan_id
      LEFT JOIN zonas        z  ON z.id = cl.zona_id
      LEFT JOIN LATERAL (
        SELECT rx_power_dbm, tx_power_dbm, timestamp
        FROM   metricas_onu_optical
        WHERE  olt_dispositivo_id = r.olt_id
        ORDER  BY timestamp DESC
        LIMIT  1
      ) m ON TRUE
      WHERE ${whereClause}
      ORDER BY ${sort} ${dir} NULLS LAST
      LIMIT ${limit} OFFSET ${offset}
    `;

    const rows = await this.ds.query(sql, params);
    const total = rows.length > 0 ? Number(rows[0].__total) : 0;

    const data: OnuRow[] = rows.map((r: any) => { // eslint-disable-line
      const { __total, ...rest } = r;
      return {
        ...rest,
        slot:       Number(r.slot),
        port:       Number(r.port),
        onuId:      Number(r.onuId),
        vlan:       Number(r.vlan),
        rxPowerDbm: r.rxPowerDbm  != null ? Number(r.rxPowerDbm)  : null,
        txPowerDbm: r.txPowerDbm  != null ? Number(r.txPowerDbm)  : null,
      };
    });

    return {
      data,
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  }

  // ── Paso 5: export CSV ────────────────────────────────────

  async exportCsv(empresaId: string, filters: ListarOnusFilters = {}): Promise<string> {
    const params: unknown[] = [empresaId];
    const where: string[]   = [`r.empresa_id = $${params.length} AND r.deleted_at IS NULL`];

    if (filters.oltId)  { params.push(filters.oltId);   where.push(`r.olt_id = $${params.length}`); }
    if (filters.estado) { params.push(filters.estado);  where.push(`r.estado = $${params.length}`); }
    if (filters.zonaId) { params.push(filters.zonaId);  where.push(`cl.zona_id = $${params.length}`); }
    if (filters.q) {
      params.push(`%${filters.q.trim().slice(0, 100)}%`);
      const n = params.length;
      where.push(`(r.sn ILIKE $${n} OR cl.nombre_completo ILIKE $${n} OR c.numero_contrato ILIKE $${n})`);
    }

    const sql = `
      SELECT
        r.sn,
        cl.nombre_completo                              AS cliente,
        c.numero_contrato                               AS contrato,
        p.nombre                                        AS plan,
        o.nombre                                        AS olt,
        z.nombre                                        AS zona,
        r.slot,
        r.port                                          AS puerto,
        r.estado,
        m.rx_power_dbm                                  AS rx_onu_dbm,
        m.tx_power_dbm                                  AS tx_onu_dbm,
        CASE
          WHEN m.rx_power_dbm IS NULL THEN 'sin_datos'
          WHEN m.rx_power_dbm >= -23  THEN 'buena'
          WHEN m.rx_power_dbm >= -27  THEN 'marginal'
          ELSE 'critica'
        END                                             AS calidad_señal,
        m.timestamp                                     AS ultima_señal
      FROM ftth_onu_registro r
      JOIN olt_dispositivos  o  ON o.id = r.olt_id AND o.deleted_at IS NULL
      LEFT JOIN contratos    c  ON c.id = r.contrato_id AND c.deleted_at IS NULL
      LEFT JOIN clientes     cl ON cl.id = c.cliente_id AND cl.deleted_at IS NULL
      LEFT JOIN planes       p  ON p.id = c.plan_id
      LEFT JOIN zonas        z  ON z.id = cl.zona_id
      LEFT JOIN LATERAL (
        SELECT rx_power_dbm, tx_power_dbm, timestamp
        FROM   metricas_onu_optical
        WHERE  olt_dispositivo_id = r.olt_id
        ORDER  BY timestamp DESC
        LIMIT  1
      ) m ON TRUE
      WHERE ${where.join(' AND ')}
      ORDER BY cl.nombre_completo ASC NULLS LAST
      LIMIT 10000
    `;

    const rows = await this.ds.query(sql, params);

    const headers = ['SN','Cliente','Contrato','Plan','OLT','Zona','Slot','Puerto','Estado','Rx_ONU_dBm','Tx_ONU_dBm','Calidad_Señal','Ultima_Señal'];
    const csvRows = rows.map((r: any) => [ // eslint-disable-line
      r.sn, r.cliente ?? '', r.contrato ?? '', r.plan ?? '',
      r.olt, r.zona ?? '', r.slot, r.puerto, r.estado,
      r.rx_onu_dbm ?? '', r.tx_onu_dbm ?? '', r.calidad_señal, r.ultima_señal ?? '',
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));

    return [headers.join(','), ...csvRows].join('\r\n');
  }

  // ── Paso 6: señal individual ──────────────────────────────

  async refreshSenal(sn: string, empresaId: string): Promise<{
    rxPowerDbm: number | null; txPowerDbm: number | null;
    calidadSeñal: CalidadSeñal; stale: boolean; staleReason?: string;
    señalActualizadaEn: string | null;
  }> {
    const registro = await this.ftthRepo.findOne({
      where: { sn, empresaId, deletedAt: null as any },
    });
    if (!registro) throw new NotFoundException(`ONU ${sn} no encontrada`);

    try {
      const dto: ObtenerMetricasDto = {
        slot:  registro.slot,
        port:  registro.port,
        onuId: registro.onuId,
        sn:    registro.sn,
      };
      const result = await Promise.race([
        this.oltService.obtenerMetricasOnuNativa(registro.oltId, empresaId, dto),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 15_000)),
      ]);

      if (result.metricsAvailable) {
        const m = this.metricasRepo.create({
          onuId:            registro.id,
          oltDispositivoId: registro.oltId,
          empresaId,
          rxPowerDbm:       result.rxPowerDbm ?? null,
          txPowerDbm:       result.txPowerDbm ?? null,
          temperaturaC:     result.temperatureC ?? null,
          timestamp:        new Date(),
        });
        await this.metricasRepo.save(m);

        const rx = result.rxPowerDbm ?? null;
        return {
          rxPowerDbm:  rx,
          txPowerDbm:  result.txPowerDbm ?? null,
          calidadSeñal: this._calidad(rx),
          stale:        false,
          señalActualizadaEn: new Date().toISOString(),
        };
      }
    } catch (err) {
      this.logger.warn(`refreshSenal: OLT no respondió para ${sn}: ${(err as Error).message}`);
    }

    // Fallback: última lectura de BD
    const ultima = await this.metricasRepo.findOne({
      where: { oltDispositivoId: registro.oltId },
      order: { timestamp: 'DESC' },
    });

    return {
      rxPowerDbm:  ultima?.rxPowerDbm  ?? null,
      txPowerDbm:  ultima?.txPowerDbm  ?? null,
      calidadSeñal: this._calidad(ultima?.rxPowerDbm ?? null),
      stale:        true,
      staleReason:  'OLT no respondió',
      señalActualizadaEn: ultima?.timestamp?.toISOString() ?? null,
    };
  }

  // ── Paso 7: señal batch con WS ────────────────────────────

  async iniciarBatchSenal(sns: string[], empresaId: string): Promise<{ jobId: string }> {
    const jobId = uuidv4();
    void this._ejecutarBatch(jobId, sns, empresaId);
    return { jobId };
  }

  private async _ejecutarBatch(jobId: string, sns: string[], empresaId: string): Promise<void> {
    // Agrupar por OLT para minimizar conexiones SSH
    const registros = await this.ftthRepo
      .createQueryBuilder('r')
      .where('r.sn IN (:...sns)', { sns })
      .andWhere('r.empresa_id = :empresaId', { empresaId })
      .andWhere('r.deleted_at IS NULL')
      .getMany();

    const byOlt = new Map<string, typeof registros>();
    for (const r of registros) {
      const list = byOlt.get(r.oltId) ?? [];
      list.push(r);
      byOlt.set(r.oltId, list);
    }

    let exitosas = 0;
    let fallidas  = 0;

    await Promise.allSettled(
      [...byOlt.entries()].map(async ([, list]) => {
        for (const r of list) {
          try {
            const result = await Promise.race([
              this.oltService.obtenerMetricasOnuNativa(r.oltId, empresaId, {
                slot: r.slot, port: r.port, onuId: r.onuId, sn: r.sn,
              } as ObtenerMetricasDto),
              new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 15_000)),
            ]);

            if (result.metricsAvailable) {
              const m = this.metricasRepo.create({
                onuId:            r.id,
                oltDispositivoId: r.oltId,
                empresaId,
                rxPowerDbm:       result.rxPowerDbm ?? null,
                txPowerDbm:       result.txPowerDbm ?? null,
                temperaturaC:     result.temperatureC ?? null,
                timestamp:        new Date(),
              });
              await this.metricasRepo.save(m);

              this.events.emit(RED_ONU_SEÑAL, {
                jobId, empresaId, sn: r.sn,
                rxPowerDbm:  result.rxPowerDbm  ?? null,
                txPowerDbm:  result.txPowerDbm  ?? null,
                calidadSeñal: this._calidad(result.rxPowerDbm ?? null),
                stale: false,
              });
              exitosas++;
            } else {
              fallidas++;
              this.events.emit(RED_ONU_SEÑAL, { jobId, empresaId, sn: r.sn, stale: true, staleReason: 'sin datos' });
            }
          } catch {
            fallidas++;
            this.events.emit(RED_ONU_SEÑAL, { jobId, empresaId, sn: r.sn, stale: true, staleReason: 'timeout' });
          }
        }
      }),
    );

    this.events.emit(RED_BATCH_DONE, { jobId, empresaId, total: sns.length, exitosas, fallidas });
    this.logger.log(`Batch señal ${jobId}: ${exitosas}/${sns.length} exitosas`);
  }

  // ── Paso 8: acciones delegadas ────────────────────────────

  async suspender(sn: string, empresaId: string): Promise<{ exitoso: boolean; mensaje: string }> {
    const r = await this._findRegistro(sn, empresaId);
    const contratoId = this._requireContrato(r);
    return this.ftthService.suspender(r.oltId, empresaId, contratoId);
  }

  async rehabilitar(sn: string, empresaId: string): Promise<{ exitoso: boolean; mensaje: string }> {
    const r = await this._findRegistro(sn, empresaId);
    const contratoId = this._requireContrato(r);
    return this.ftthService.rehabilitar(r.oltId, empresaId, contratoId);
  }

  async resetear(sn: string, empresaId: string): Promise<{ exitoso: boolean; mensaje: string }> {
    const r = await this._findRegistro(sn, empresaId);
    return this.oltService.resetearOnu(r.oltId, empresaId, r.slot, r.port, r.onuId);
  }

  async getVersion(sn: string, empresaId: string): Promise<{
    exitoso: boolean; ontVersion: string | null; softwareVersion: string | null;
    equipmentId: string | null; error: string | null;
  }> {
    const r = await this._findRegistro(sn, empresaId);
    return this.oltService.versionOnt(r.oltId, empresaId, r.slot, r.port, r.onuId);
  }

  // ── Helpers ───────────────────────────────────────────────

  private async _findRegistro(sn: string, empresaId: string): Promise<FtthOnuRegistro> {
    const r = await this.ftthRepo.findOne({ where: { sn, empresaId, deletedAt: null as any } });
    if (!r) throw new NotFoundException(`ONU ${sn} no encontrada`);
    return r;
  }

  private _requireContrato(r: FtthOnuRegistro): string {
    if (!r.contratoId) throw new NotFoundException(`ONU ${r.sn} no tiene contrato vinculado`);
    return r.contratoId;
  }

  private _calidad(rx: number | null): CalidadSeñal {
    if (rx == null) return 'sin_datos';
    if (rx >= -23)  return 'buena';
    if (rx >= -27)  return 'marginal';
    return 'critica';
  }
}
