import { Injectable } from '@nestjs/common';
import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { Cliente, ClienteHistorialEstado, EstadoCliente } from '../entities/cliente.entity';
import { FilterClienteDto } from '../dto/cliente.dto';
import { paginate, PaginatedResult } from '../dto/response.dto';

@Injectable()
export class ClienteRepository {
  private readonly repo: Repository<Cliente>;
  private readonly histRepo: Repository<ClienteHistorialEstado>;

  constructor(@InjectDataSource() private readonly ds: DataSource) {
    this.repo     = ds.getRepository(Cliente);
    this.histRepo = ds.getRepository(ClienteHistorialEstado);
  }

  create(data: Partial<Cliente>): Cliente { return this.repo.create(data); }
  async save(c: Cliente): Promise<Cliente> { return this.repo.save(c); }

  async findById(id: string, empresaId: string): Promise<Cliente | null> {
    return this.repo.findOne({ where: { id, empresaId, deletedAt: null as any } });
  }

  async findByDocumento(tipo: string, numero: string, empresaId: string): Promise<Cliente | null> {
    return this.repo.findOne({ where: { tipoDocumento: tipo as any, numeroDocumento: numero, empresaId, deletedAt: null as any } });
  }

  async findAllPaginated(empresaId: string, filters: FilterClienteDto): Promise<PaginatedResult<Cliente>> {
    const qb = this.buildFilterQuery(empresaId, filters);
    return paginate(qb, filters, ['createdAt','nombreCompleto','estado','tipoServicio','fechaEstado','codigoCliente']);
  }

  buildFilterQuery(empresaId: string, filters: FilterClienteDto): SelectQueryBuilder<Cliente> {
    const qb = this.repo.createQueryBuilder('c')
      .where('c.empresa_id = :empresaId', { empresaId })
      .andWhere('c.deleted_at IS NULL');

    if (filters.search?.trim()) {
      const term = `%${filters.search.trim()}%`;
      qb.andWhere(
        `(c.nombre_completo ILIKE :term OR c.numero_documento ILIKE :term
          OR c.email ILIKE :term OR c.telefono ILIKE :term
          OR c.codigo_cliente ILIKE :term OR c.direccion ILIKE :term)`,
        { term },
      );
    }
    if (filters.estado)          qb.andWhere('c.estado = :estado', { estado: filters.estado });
    if (filters.estados?.length)  qb.andWhere('c.estado IN (:...estados)', { estados: filters.estados });
    if (filters.tipoServicio)    qb.andWhere('c.tipo_servicio = :tipoServicio', { tipoServicio: filters.tipoServicio });
    if (filters.tipoDocumento)   qb.andWhere('c.tipo_documento = :tipoDocumento', { tipoDocumento: filters.tipoDocumento });
    if (filters.documento)       qb.andWhere('c.numero_documento = :documento', { documento: filters.documento });
    if (filters.telefono)        qb.andWhere('(c.telefono ILIKE :tel OR c.telefono_alt ILIKE :tel)', { tel: `%${filters.telefono}%` });
    if (filters.distrito)        qb.andWhere('c.distrito ILIKE :distrito', { distrito: `%${filters.distrito}%` });
    if (filters.vendedorId)      qb.andWhere('c.vendedor_id = :vendedorId', { vendedorId: filters.vendedorId });
    if (filters.conUbicacion)    qb.andWhere('c.latitud IS NOT NULL AND c.longitud IS NOT NULL');
    if (filters.esEmpresa !== undefined) qb.andWhere('c.es_empresa = :esEmpresa', { esEmpresa: filters.esEmpresa });
    if (filters.etiqueta)        qb.andWhere(':etiqueta = ANY(c.etiquetas)', { etiqueta: filters.etiqueta });
    if (filters.fechaDesde)      qb.andWhere('c.created_at >= :fechaDesde', { fechaDesde: new Date(filters.fechaDesde) });
    if (filters.fechaHasta) {
      const h = new Date(filters.fechaHasta); h.setHours(23, 59, 59, 999);
      qb.andWhere('c.created_at <= :fechaHasta', { fechaHasta: h });
    }
    return qb;
  }

  async getResumenEstados(empresaId: string): Promise<Record<string, number>> {
    const rows = await this.repo.createQueryBuilder('c')
      .select('c.estado','estado').addSelect('COUNT(*)','total')
      .where('c.empresa_id = :empresaId', { empresaId })
      .andWhere('c.deleted_at IS NULL')
      .groupBy('c.estado').getRawMany();
    return rows.reduce((acc, r) => { acc[r.estado] = parseInt(r.total, 10); return acc; }, {});
  }

  async findConUbicacion(empresaId: string): Promise<Partial<Cliente>[]> {
    return this.repo.createQueryBuilder('c')
      .select(['c.id','c.nombreCompleto','c.estado','c.latitud','c.longitud','c.tipoServicio','c.direccion','c.telefono'])
      .where('c.empresa_id = :empresaId', { empresaId })
      .andWhere('c.latitud IS NOT NULL').andWhere('c.deleted_at IS NULL')
      .getMany();
  }

  async softDelete(id: string, empresaId: string): Promise<void> {
    await this.repo.update({ id, empresaId }, { deletedAt: new Date() });
  }

  async update(id: string, data: Partial<Cliente>): Promise<void> {
    await this.repo.update({ id }, data);
  }

  async existeDocumento(tipo: string, numero: string, empresaId: string, excludeId?: string): Promise<boolean> {
    const qb = this.repo.createQueryBuilder('c')
      .where('c.empresa_id = :empresaId', { empresaId })
      .andWhere('c.tipo_documento = :tipo', { tipo })
      .andWhere('c.numero_documento = :numero', { numero })
      .andWhere('c.deleted_at IS NULL');
    if (excludeId) qb.andWhere('c.id != :excludeId', { excludeId });
    return (await qb.getCount()) > 0;
  }

  async guardarHistorial(data: Partial<ClienteHistorialEstado>): Promise<void> {
    await this.histRepo.save(this.histRepo.create(data));
  }

  async getHistorialEstados(clienteId: string): Promise<ClienteHistorialEstado[]> {
    return this.histRepo.find({ where: { clienteId }, order: { createdAt: 'DESC' }, take: 50 });
  }

  async getEstadisticas(empresaId: string) {
    const [totales, nuevosEsteMes] = await Promise.all([
      this.repo.createQueryBuilder('c')
        .select('c.estado','estado').addSelect('COUNT(*)','total')
        .where('c.empresa_id = :empresaId', { empresaId })
        .andWhere('c.deleted_at IS NULL')
        .groupBy('c.estado').getRawMany(),
      this.repo.createQueryBuilder('c')
        .where('c.empresa_id = :empresaId', { empresaId })
        .andWhere('c.deleted_at IS NULL')
        .andWhere("c.created_at >= DATE_TRUNC('month', NOW())")
        .getCount(),
    ]);
    return { totales, nuevosEsteMes };
  }

  async findAllForExport(empresaId: string, filters: any): Promise<Cliente[]> {
    const qb = this.buildFilterQuery(empresaId, filters);
    return qb.orderBy('c.nombre_completo','ASC').take(10000).getMany();
  }
}
