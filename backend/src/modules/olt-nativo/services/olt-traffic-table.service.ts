import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OltTrafficTable } from '../entities/olt-traffic-table.entity';

@Injectable()
export class OltTrafficTableService {
  private readonly logger = new Logger(OltTrafficTableService.name);

  constructor(
    @InjectRepository(OltTrafficTable)
    private readonly repo: Repository<OltTrafficTable>,
  ) {}

  async listar(oltId: string, empresaId: string): Promise<OltTrafficTable[]> {
    return this.repo.find({
      where: { oltId, empresaId },
      order: { trafficId: 'ASC' },
    });
  }

  async sincronizarDesdeOlt(
    oltId:     string,
    empresaId: string,
    tablas:    Array<{ index: number; name: string; cir_kbps?: number; pir_kbps?: number }>,
  ): Promise<{ insertadas: number; actualizadas: number }> {
    if (tablas.length === 0) return { insertadas: 0, actualizadas: 0 };

    const ids    = tablas.map(t => t.index);
    const names  = tablas.map(t => t.name);
    const cirs   = tablas.map(t => t.cir_kbps ?? null);
    const pirs   = tablas.map(t => t.pir_kbps ?? null);

    // UPSERT masivo: 1 query en lugar de 2N queries individuales.
    // xmax=0 distingue INSERT nuevo de UPDATE existente.
    const [row] = await this.repo.manager.query<[{ insertadas: string; actualizadas: string }]>(
      `WITH upserted AS (
         INSERT INTO olt_traffic_tables
           (id, olt_id, empresa_id, traffic_id, nombre, cir_kbps, pir_kbps, created_at, updated_at)
         SELECT gen_random_uuid(), $1, $2,
                t.idx, t.name, t.cir, t.pir, NOW(), NOW()
         FROM   unnest($3::int[], $4::text[], $5::int[], $6::int[])
                AS t(idx, name, cir, pir)
         ON CONFLICT (olt_id, traffic_id) DO UPDATE
           SET nombre     = EXCLUDED.nombre,
               cir_kbps   = EXCLUDED.cir_kbps,
               pir_kbps   = EXCLUDED.pir_kbps,
               updated_at = NOW()
         RETURNING (xmax = 0) AS is_insert
       )
       SELECT
         COUNT(*) FILTER (WHERE is_insert)      AS insertadas,
         COUNT(*) FILTER (WHERE NOT is_insert)  AS actualizadas
       FROM upserted`,
      [oltId, empresaId, ids, names, cirs, pirs],
    );

    const insertadas   = Number(row.insertadas);
    const actualizadas = Number(row.actualizadas);
    this.logger.log(`Traffic table sync olt=${oltId}: ${insertadas} nuevas, ${actualizadas} actualizadas`);
    return { insertadas, actualizadas };
  }

  async eliminar(oltId: string, empresaId: string, trafficId: number): Promise<void> {
    const t = await this.repo.findOne({ where: { oltId, empresaId, trafficId } });
    if (!t) throw new NotFoundException(`Traffic table ${trafficId} no encontrada.`);
    await this.repo.remove(t);
  }
}
