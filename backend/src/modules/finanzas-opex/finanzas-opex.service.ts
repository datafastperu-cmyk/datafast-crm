import {
  Injectable, NotFoundException, BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  EgresoIngreso, CategoriaMovimiento, EstadoMovimiento,
} from './egreso-ingreso.entity';
import {
  CreateEgresoIngresoDto, UpdateEgresoIngresoDto, FilterEgresoIngresoDto,
} from './egreso-ingreso.dto';
import { paginate, PaginatedResult } from '../../common/utils/pagination.util';

@Injectable()
export class FinanzasOpexService {
  constructor(
    @InjectRepository(EgresoIngreso)
    private readonly repo: Repository<EgresoIngreso>,
  ) {}

  // ─── Listado paginado ────────────────────────────────────────
  async list(
    empresaId: string,
    f: FilterEgresoIngresoDto,
  ): Promise<PaginatedResult<EgresoIngreso>> {
    const qb = this.repo.createQueryBuilder('e')
      .where('e.empresa_id = :empresaId', { empresaId });

    if (f.tipo)               qb.andWhere('e.tipo = :tipo',           { tipo: f.tipo });
    if (f.categoria)          qb.andWhere('e.categoria = :cat',       { cat: f.categoria });
    if (f.estado)             qb.andWhere('e.estado = :estado',       { estado: f.estado });
    if (f.soloRecurrentes !== undefined)
                              qb.andWhere('e.es_recurrente = :er',    { er: f.soloRecurrentes });
    if (f.fechaDesde)         qb.andWhere('e.fecha_registro >= :fd',  { fd: f.fechaDesde });
    if (f.fechaHasta)         qb.andWhere('e.fecha_registro <= :fh',  { fh: f.fechaHasta });

    qb.orderBy('e.fecha_registro', 'DESC').addOrderBy('e.created_at', 'DESC');

    return paginate(qb, f, ['fechaRegistro', 'monto', 'createdAt']);
  }

  // ─── Crear ───────────────────────────────────────────────────
  async create(empresaId: string, dto: CreateEgresoIngresoDto): Promise<EgresoIngreso> {
    if (dto.esRecurrente && !dto.diaVencimiento) {
      throw new BadRequestException('diaVencimiento es requerido para movimientos recurrentes');
    }
    const record = this.repo.create({
      empresaId,
      tipo:           dto.tipo,
      categoria:      dto.categoria ?? CategoriaMovimiento.OTROS,
      monto:          dto.monto,
      fechaRegistro:  dto.fechaRegistro,
      descripcion:    dto.descripcion,
      esRecurrente:   dto.esRecurrente ?? false,
      diaVencimiento: dto.diaVencimiento,
      estado:         EstadoMovimiento.PAGADO,
    });
    return this.repo.save(record);
  }

  // ─── Obtener por ID ──────────────────────────────────────────
  async getById(id: string, empresaId: string): Promise<EgresoIngreso> {
    const record = await this.repo.findOne({ where: { id, empresaId } });
    if (!record) throw new NotFoundException('Registro no encontrado');
    return record;
  }

  // ─── Actualizar ──────────────────────────────────────────────
  async update(
    id: string,
    empresaId: string,
    dto: UpdateEgresoIngresoDto,
  ): Promise<EgresoIngreso> {
    const record = await this.getById(id, empresaId);
    const seráRecurrente = dto.esRecurrente ?? record.esRecurrente;
    const tendraDia      = dto.diaVencimiento ?? record.diaVencimiento;
    if (seráRecurrente && !tendraDia) {
      throw new BadRequestException('diaVencimiento es requerido para movimientos recurrentes');
    }
    Object.assign(record, dto);
    return this.repo.save(record);
  }

  // ─── Eliminar ────────────────────────────────────────────────
  async remove(id: string, empresaId: string): Promise<void> {
    const record = await this.getById(id, empresaId);
    await this.repo.remove(record);
  }

  // ─── Marcar como pagado ──────────────────────────────────────
  async marcarPagado(id: string, empresaId: string): Promise<EgresoIngreso> {
    const record = await this.getById(id, empresaId);
    record.estado = EstadoMovimiento.PAGADO;
    return this.repo.save(record);
  }

  // ─── Pendientes de pago ──────────────────────────────────────
  async getPendientes(empresaId: string): Promise<EgresoIngreso[]> {
    return this.repo.find({
      where: { empresaId, estado: EstadoMovimiento.PENDIENTE_PAGO },
      order: { fechaRegistro: 'ASC' },
    });
  }

  // ─── Resumen del mes ─────────────────────────────────────────
  async getResumen(empresaId: string): Promise<{
    totalIngresosMes: number;
    totalEgresosMes:  number;
    pendientes:       number;
  }> {
    const mesInicio = new Date();
    mesInicio.setDate(1);
    const desde = mesInicio.toISOString().split('T')[0];

    const [row] = await this.repo.manager.query(`
      SELECT
        COALESCE(SUM(monto) FILTER (WHERE tipo = 'INGRESO_OTRO' AND estado = 'PAGADO'), 0)::float AS total_ingresos,
        COALESCE(SUM(monto) FILTER (WHERE tipo = 'EGRESO'        AND estado = 'PAGADO'), 0)::float AS total_egresos,
        COUNT(*) FILTER (WHERE estado = 'PENDIENTE_PAGO')::int                                    AS pendientes
      FROM egresos_ingresos
      WHERE empresa_id = $1
        AND fecha_registro >= $2
    `, [empresaId, desde]);

    return {
      totalIngresosMes: row.total_ingresos,
      totalEgresosMes:  row.total_egresos,
      pendientes:       row.pendientes,
    };
  }

  // ─── Llamado por el scheduler diario ────────────────────────
  // Lógica 3 estados por plantilla recurrente con vencimiento <= hoy:
  //   · Sin registro este mes  → crea PENDIENTE_PAGO + incluye en generados
  //   · Registro PENDIENTE_PAGO → no crea nada, incluye en recordatorios
  //   · Registro PAGADO         → ignora silenciosamente
  async generarPendientesDelDia(hoy: Date): Promise<{
    generados:     EgresoIngreso[];
    recordatorios: EgresoIngreso[];
  }> {
    const diaHoy  = hoy.getDate();
    const anioMes = hoy.toISOString().slice(0, 7);

    const plantillas = await this.repo.find({ where: { esRecurrente: true } });

    const generados:     EgresoIngreso[] = [];
    const recordatorios: EgresoIngreso[] = [];

    for (const p of plantillas) {
      if (!p.diaVencimiento || p.diaVencimiento > diaHoy) continue;

      const yaExiste = await this.repo
        .createQueryBuilder('e')
        .where('e.plantilla_id = :pid', { pid: p.id })
        .andWhere("TO_CHAR(e.created_at, 'YYYY-MM') = :ym", { ym: anioMes })
        .getOne();

      if (yaExiste?.estado === EstadoMovimiento.PAGADO) continue;

      if (yaExiste) {
        recordatorios.push(yaExiste);
        continue;
      }

      const nuevo = await this.repo.save(this.repo.create({
        empresaId:      p.empresaId,
        tipo:           p.tipo,
        categoria:      p.categoria,
        monto:          p.monto,
        fechaRegistro:  hoy.toISOString().split('T')[0],
        descripcion:    p.descripcion,
        esRecurrente:   false,
        diaVencimiento: p.diaVencimiento,
        estado:         EstadoMovimiento.PENDIENTE_PAGO,
        plantillaId:    p.id,
      }));
      generados.push(nuevo);
    }

    return { generados, recordatorios };
  }
}
