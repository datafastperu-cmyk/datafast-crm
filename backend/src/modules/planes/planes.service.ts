import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Plan } from './entities/plan.entity';
import { CreatePlanDto, UpdatePlanDto, FilterPlanDto } from './dto/plan.dto';
import { JwtPayload } from '../../common/decorators/current-user.decorator';

@Injectable()
export class PlanesService {
  private readonly logger = new Logger(PlanesService.name);
  constructor(@InjectRepository(Plan) private readonly repo: Repository<Plan>) {}

  async create(dto: CreatePlanDto, user: JwtPayload): Promise<Plan> {
    const existe = await this.repo.findOne({ where:{ nombre:dto.nombre, empresaId:user.empresaId, deletedAt:null as any } });
    if (existe) throw new ConflictException(`Plan "${dto.nombre}" ya existe`);
    const plan = this.repo.create({ ...dto, empresaId:user.empresaId });
    return this.repo.save(plan);
  }

  async findAll(empresaId: string, filters: FilterPlanDto) {
    const qb = this.repo.createQueryBuilder('p')
      .where('p.empresa_id = :empresaId', { empresaId }).andWhere('p.deleted_at IS NULL');
    if (filters.search) qb.andWhere('p.nombre ILIKE :s', { s:`%${filters.search}%` });
    if (filters.tipo) qb.andWhere('p.tipo = :tipo', { tipo:filters.tipo });
    if (filters.tipoServicio) qb.andWhere('p.tipo_servicio = :ts', { ts:filters.tipoServicio });
    if (filters.activo !== undefined) qb.andWhere('p.activo = :activo', { activo:filters.activo });
    qb.orderBy('p.orden_display','ASC').addOrderBy('p.precio','ASC');
    const [data, total] = await qb.getManyAndCount();
    return { data, total };
  }

  async findOne(id: string, empresaId: string): Promise<Plan> {
    const plan = await this.repo.findOne({ where:{ id, empresaId, deletedAt:null as any } });
    if (!plan) throw new NotFoundException(`Plan ${id} no encontrado`);
    return plan;
  }

  async update(id: string, dto: UpdatePlanDto, user: JwtPayload): Promise<Plan> {
    await this.findOne(id, user.empresaId);
    await this.repo.update(id, dto);
    return this.findOne(id, user.empresaId);
  }

  async remove(id: string, user: JwtPayload): Promise<void> {
    await this.findOne(id, user.empresaId);
    await this.repo.update(id, { deletedAt:new Date() });
  }
}
