import { Injectable, NotFoundException, ConflictException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Plan } from './entities/plan.entity';
import { CreatePlanDto, UpdatePlanDto, FilterPlanDto } from './dto/plan.dto';
import { JwtPayload } from '../../common/decorators/current-user.decorator';

@Injectable()
export class PlanesService {
  private readonly logger = new Logger(PlanesService.name);
  constructor(
    @InjectRepository(Plan) private readonly repo: Repository<Plan>,
    @InjectDataSource()     private readonly ds:   DataSource,
  ) {}

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
    const [planes, total] = await qb.getManyAndCount();

    if (planes.length === 0) return { data: [], total: 0 };

    const ids = planes.map(p => p.id);
    const counts: { plan_id: string; cnt: string }[] = await this.ds.query(
      `SELECT plan_id, COUNT(*) AS cnt FROM contratos
       WHERE plan_id = ANY($1) AND deleted_at IS NULL
       AND estado IN ('activo','suspendido')
       GROUP BY plan_id`,
      [ids],
    );
    const countMap = new Map(counts.map(r => [r.plan_id, Number(r.cnt)]));
    const data = planes.map(p => ({ ...p, contratosCount: countMap.get(p.id) ?? 0 }));
    return { data, total };
  }

  async findOne(id: string, empresaId: string): Promise<Plan> {
    const plan = await this.repo.findOne({ where:{ id, empresaId, deletedAt:null as any } });
    if (!plan) throw new NotFoundException(`Plan ${id} no encontrado`);
    return plan;
  }

  async update(id: string, dto: UpdatePlanDto, user: JwtPayload): Promise<Plan> {
    const plan = await this.findOne(id, user.empresaId);

    if (dto.version !== undefined && plan.version !== dto.version) {
      throw new ConflictException({
        code: 'CONCURRENCY_CONFLICT',
        message: 'Los datos fueron modificados por otro usuario. Por favor, recargue la página e intente nuevamente.',
      });
    }

    if (dto.nombre && dto.nombre !== plan.nombre) {
      const existe = await this.repo.findOne({
        where: { nombre: dto.nombre, empresaId: user.empresaId, deletedAt: null as any },
      });
      if (existe) throw new ConflictException(`Plan "${dto.nombre}" ya existe`);
    }

    const { version: _v, ...camposPlan } = dto;
    await this.repo.update(id, camposPlan);
    return this.findOne(id, user.empresaId);
  }

  async remove(id: string, user: JwtPayload): Promise<void> {
    await this.findOne(id, user.empresaId);
    const [{ cnt }] = await this.ds.query(
      `SELECT COUNT(*) AS cnt FROM contratos
       WHERE plan_id = $1 AND deleted_at IS NULL
       AND estado IN ('activo','suspendido')`,
      [id],
    );
    if (Number(cnt) > 0)
      throw new BadRequestException('No es posible eliminar el plan porque hay contratos de abonados activos que lo están utilizando.');
    await this.repo.update(id, { deletedAt:new Date() });
  }
}
