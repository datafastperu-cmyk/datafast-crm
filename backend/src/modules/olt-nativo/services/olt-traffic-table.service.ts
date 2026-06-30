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
    let insertadas   = 0;
    let actualizadas = 0;

    for (const t of tablas) {
      const existente = await this.repo.findOne({ where: { oltId, trafficId: t.index } });
      if (existente) {
        existente.nombre  = t.name;
        existente.cirKbps = t.cir_kbps ?? null;
        existente.pirKbps = t.pir_kbps ?? null;
        await this.repo.save(existente);
        actualizadas++;
      } else {
        await this.repo.save(this.repo.create({
          oltId, empresaId,
          trafficId: t.index,
          nombre:    t.name,
          cirKbps:   t.cir_kbps ?? null,
          pirKbps:   t.pir_kbps ?? null,
        }));
        insertadas++;
      }
    }
    this.logger.log(`Traffic table sync olt=${oltId}: ${insertadas} nuevas, ${actualizadas} actualizadas`);
    return { insertadas, actualizadas };
  }

  async eliminar(oltId: string, empresaId: string, trafficId: number): Promise<void> {
    const t = await this.repo.findOne({ where: { oltId, empresaId, trafficId } });
    if (!t) throw new NotFoundException(`Traffic table ${trafficId} no encontrada.`);
    await this.repo.remove(t);
  }
}
