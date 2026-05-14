import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { InjectDataSource }       from '@nestjs/typeorm';
import { Olt, Onu, EstadoOnu }   from '../entities/onu.entity';
import { FilterOnuDto }           from '../dto/smartolt.dto';
import { paginate, PaginatedResult } from '../dto/response.dto';

@Injectable()
export class OnuRepository {
  private readonly onuRepo: Repository<Onu>;
  private readonly oltRepo: Repository<Olt>;

  constructor(@InjectDataSource() private readonly ds: DataSource) {
    this.onuRepo = ds.getRepository(Onu);
    this.oltRepo = ds.getRepository(Olt);
  }

  // ── OLT CRUD ──────────────────────────────────────────────
  async saveOlt(data: Partial<Olt>): Promise<Olt> {
    return this.oltRepo.save(this.oltRepo.create(data));
  }

  async findOltById(id: string, empresaId: string): Promise<Olt | null> {
    return this.oltRepo.findOne({ where: { id, empresaId, deletedAt: null as any } });
  }

  async findAllOlts(empresaId: string): Promise<Olt[]> {
    return this.oltRepo.find({
      where: { empresaId, activo: true, deletedAt: null as any },
      order: { nombre: 'ASC' },
    });
  }

  async updateOlt(id: string, data: Partial<Olt>): Promise<void> {
    await this.oltRepo.update({ id }, data);
  }

  // ── ONU CRUD ──────────────────────────────────────────────
  create(data: Partial<Onu>): Onu { return this.onuRepo.create(data); }

  async save(onu: Onu): Promise<Onu> { return this.onuRepo.save(onu); }

  async update(id: string, data: Partial<Onu>): Promise<void> {
    await this.onuRepo.update({ id }, data);
  }

  async findById(id: string, empresaId: string): Promise<Onu | null> {
    return this.onuRepo.findOne({ where: { id, empresaId, deletedAt: null as any } });
  }

  async findBySerial(serial: string, empresaId: string): Promise<Onu | null> {
    return this.onuRepo.findOne({
      where: { serialNumber: serial.toUpperCase(), empresaId, deletedAt: null as any },
    });
  }

  async findByContratoId(contratoId: string): Promise<Onu | null> {
    // La ONU está ligada al contrato via la columna onu_id en contratos
    const [row] = await this.ds.query(`
      SELECT o.* FROM onus o
      JOIN contratos c ON c.onu_id = o.id
      WHERE c.id = $1 AND o.deleted_at IS NULL
    `, [contratoId]);
    return row || null;
  }

  // ── Listado paginado con filtros ───────────────────────────
  async findAllPaginated(
    empresaId: string,
    filters: FilterOnuDto,
  ): Promise<PaginatedResult<Onu>> {
    const qb = this.onuRepo.createQueryBuilder('o')
      .where('o.empresa_id = :empresaId', { empresaId })
      .andWhere('o.deleted_at IS NULL');

    if (filters.estado)       qb.andWhere('o.estado = :estado', { estado: filters.estado });
    if (filters.oltId)        qb.andWhere('o.olt_id = :oltId',  { oltId: filters.oltId });
    if (filters.serialNumber) qb.andWhere('o.serial_number ILIKE :sn', { sn: `%${filters.serialNumber}%` });
    if (filters.ponPort)      qb.andWhere('o.pon_port = :pp', { pp: filters.ponPort });
    if (filters.sinContrato)  qb.andWhere(`o.id NOT IN (SELECT onu_id FROM contratos WHERE onu_id IS NOT NULL AND deleted_at IS NULL)`);
    if (filters.search) {
      qb.andWhere('(o.serial_number ILIKE :s OR o.descripcion ILIKE :s)', { s: `%${filters.search}%` });
    }

    return paginate(qb, filters, ['createdAt', 'serialNumber', 'estado', 'rxPowerDbm']);
  }

  // ── ONUs de un OLT ────────────────────────────────────────
  async findByOlt(oltId: string, empresaId: string): Promise<Onu[]> {
    return this.onuRepo.find({
      where: { oltId, empresaId, deletedAt: null as any },
      order: { ponPort: 'ASC', onuId: 'ASC' },
    });
  }

  // ── ONUs sin aprovisionar ─────────────────────────────────
  async findSinAprovisionar(empresaId: string, oltId?: string): Promise<Onu[]> {
    const qb = this.onuRepo.createQueryBuilder('o')
      .where('o.empresa_id = :empresaId', { empresaId })
      .andWhere('o.estado = :estado', { estado: EstadoOnu.SIN_APROVISIONAR })
      .andWhere('o.deleted_at IS NULL');
    if (oltId) qb.andWhere('o.olt_id = :oltId', { oltId });
    return qb.orderBy('o.created_at', 'DESC').getMany();
  }

  // ── Soft delete ───────────────────────────────────────────
  async softDelete(id: string): Promise<void> {
    await this.onuRepo.update({ id }, { deletedAt: new Date() });
  }

  // ── Resumen por estado ────────────────────────────────────
  async getResumen(empresaId: string): Promise<Record<string, number>> {
    const rows = await this.onuRepo.createQueryBuilder('o')
      .select('o.estado', 'estado')
      .addSelect('COUNT(*)', 'total')
      .where('o.empresa_id = :empresaId', { empresaId })
      .andWhere('o.deleted_at IS NULL')
      .groupBy('o.estado')
      .getRawMany();

    return rows.reduce((acc, r) => {
      acc[r.estado] = parseInt(r.total, 10);
      return acc;
    }, {} as Record<string, number>);
  }

  // ── Vista completa (ONU + OLT + Contrato + Cliente) ───────
  async findCompletaPorId(id: string, empresaId: string): Promise<any> {
    const [row] = await this.ds.query(`
      SELECT
        o.*,
        ol.nombre        AS olt_nombre,
        ol.modelo        AS olt_modelo,
        ol.ip_gestion    AS olt_ip,
        c.id             AS contrato_id,
        c.numero_contrato,
        c.usuario_pppoe,
        c.ip_asignada,
        cl.nombre_completo AS cliente_nombre,
        cl.telefono        AS cliente_telefono,
        pl.nombre          AS plan_nombre,
        pl.velocidad_bajada,
        pl.velocidad_subida
      FROM onus o
      LEFT JOIN olts      ol ON ol.id = o.olt_id
      LEFT JOIN contratos c  ON c.onu_id = o.id  AND c.deleted_at IS NULL
      LEFT JOIN clientes  cl ON cl.id = c.cliente_id
      LEFT JOIN planes    pl ON pl.id = c.plan_id
      WHERE o.id = $1 AND o.empresa_id = $2 AND o.deleted_at IS NULL
    `, [id, empresaId]);
    return row || null;
  }
}
