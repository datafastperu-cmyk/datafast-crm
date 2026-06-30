import {
  ConflictException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { OltVlan } from '../entities/olt-vlan.entity';

export class AgregarVlanDto {
  @IsInt() @Min(1) @Max(4094) @Type(() => Number) vlanId:      number;
  @IsString() @MaxLength(64)                       nombre:      string;
  @IsOptional() @IsString()                        descripcion?: string;
}

@Injectable()
export class OltVlanService {
  private readonly logger = new Logger(OltVlanService.name);

  constructor(
    @InjectRepository(OltVlan)
    private readonly repo: Repository<OltVlan>,
  ) {}

  async listar(oltId: string, empresaId: string): Promise<OltVlan[]> {
    return this.repo.find({
      where: { oltId, empresaId },
      order: { vlanId: 'ASC' },
    });
  }

  async agregar(oltId: string, empresaId: string, dto: AgregarVlanDto): Promise<OltVlan> {
    const existente = await this.repo.findOne({ where: { oltId, vlanId: dto.vlanId } });
    if (existente) {
      throw new ConflictException(`VLAN ${dto.vlanId} ya existe para esta OLT.`);
    }
    const vlan = this.repo.create({
      oltId, empresaId,
      vlanId:      dto.vlanId,
      nombre:      dto.nombre,
      descripcion: dto.descripcion ?? null,
    });
    return this.repo.save(vlan);
  }

  async eliminar(oltId: string, empresaId: string, vlanId: number): Promise<void> {
    const vlan = await this.repo.findOne({ where: { oltId, empresaId, vlanId } });
    if (!vlan) throw new NotFoundException(`VLAN ${vlanId} no encontrada.`);
    await this.repo.remove(vlan);
  }

  // Sincronización masiva desde array (resultado del listar perfiles de OLT).
  // UPSERT masivo: 1 query en lugar de N findOne + N save.
  async sincronizarDesdeArray(
    oltId:     string,
    empresaId: string,
    vlans:     Array<{ vlan_id: number; nombre: string }>,
  ): Promise<{ insertadas: number; omitidas: number }> {
    if (vlans.length === 0) return { insertadas: 0, omitidas: 0 };

    const ids    = vlans.map(v => v.vlan_id);
    const names  = vlans.map(v => v.nombre);

    const [row] = await this.repo.manager.query<[{ insertadas: string }]>(
      `WITH upserted AS (
         INSERT INTO olt_vlans
           (id, olt_id, empresa_id, vlan_id, nombre, created_at, updated_at)
         SELECT gen_random_uuid(), $1, $2, t.vid, t.name, NOW(), NOW()
         FROM   unnest($3::int[], $4::text[]) AS t(vid, name)
         ON CONFLICT (olt_id, vlan_id) DO NOTHING
         RETURNING 1
       )
       SELECT COUNT(*) AS insertadas FROM upserted`,
      [oltId, empresaId, ids, names],
    );

    const insertadas = Number(row.insertadas);
    const omitidas   = vlans.length - insertadas;
    this.logger.log(`VLAN sync olt=${oltId}: ${insertadas} insertadas, ${omitidas} omitidas (ya existían)`);
    return { insertadas, omitidas };
  }
}
