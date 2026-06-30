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

  // Sincronización masiva desde array (resultado del listar perfiles de OLT)
  async sincronizarDesdeArray(
    oltId:     string,
    empresaId: string,
    vlans:     Array<{ vlan_id: number; nombre: string }>,
  ): Promise<{ insertadas: number; omitidas: number }> {
    let insertadas = 0;
    let omitidas   = 0;
    for (const v of vlans) {
      try {
        await this.agregar(oltId, empresaId, { vlanId: v.vlan_id, nombre: v.nombre });
        insertadas++;
      } catch {
        omitidas++;
      }
    }
    this.logger.log(`VLAN sync olt=${oltId}: ${insertadas} insertadas, ${omitidas} omitidas`);
    return { insertadas, omitidas };
  }
}
