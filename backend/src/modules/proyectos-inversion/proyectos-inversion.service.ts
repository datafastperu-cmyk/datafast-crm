import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectDataSource }  from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ProyectoInversion } from './proyecto-inversion.entity';
import {
  CreateProyectoInversionDto,
  UpdateProyectoInversionDto,
  FilterProyectoInversionDto,
  RatiosFinancierosResult,
} from './proyecto-inversion.dto';
import { paginate, PaginatedResult } from '../../common/utils/pagination.util';

@Injectable()
export class ProyectosInversionService {
  constructor(
    @InjectRepository(ProyectoInversion)
    private readonly repo: Repository<ProyectoInversion>,
    @InjectDataSource()
    private readonly ds: DataSource,
  ) {}

  // ─── CRUD ────────────────────────────────────────────────────

  async list(empresaId: string, f: FilterProyectoInversionDto): Promise<PaginatedResult<ProyectoInversion>> {
    const qb = this.repo.createQueryBuilder('p').where('p.empresa_id = :eid', { eid: empresaId });
    if (f.estado)   qb.andWhere('p.estado = :estado',      { estado: f.estado });
    if (f.sectorId) qb.andWhere('p.sector_id = :sectorId', { sectorId: f.sectorId });
    qb.orderBy('p.fecha_inicio', 'DESC');
    return paginate(qb, f, ['fechaInicio', 'nombreProyecto', 'createdAt']);
  }

  async getById(id: string, empresaId: string): Promise<ProyectoInversion> {
    const p = await this.repo.findOne({ where: { id, empresaId } });
    if (!p) throw new NotFoundException('Proyecto no encontrado');
    return p;
  }

  async create(empresaId: string, dto: CreateProyectoInversionDto): Promise<ProyectoInversion> {
    return this.repo.save(this.repo.create({ ...dto, empresaId }));
  }

  async update(id: string, empresaId: string, dto: UpdateProyectoInversionDto): Promise<ProyectoInversion> {
    const p = await this.getById(id, empresaId);
    Object.assign(p, dto);
    return this.repo.save(p);
  }

  async remove(id: string, empresaId: string): Promise<void> {
    const p = await this.getById(id, empresaId);
    await this.repo.remove(p);
  }

  // ─── Lógica financiera ────────────────────────────────────────

  async calcularRatiosFinancieros(
    proyectoId: string,
    empresaId:  string,
  ): Promise<RatiosFinancierosResult> {
    const proyecto = await this.getById(proyectoId, empresaId);
    const desde    = proyecto.fechaInicio;         // 'YYYY-MM-DD'
    const hasta    = new Date().toISOString().split('T')[0];

    // ── 1. Ingresos mensuales: pagos verificados de clientes de la zona ──
    const ingRows: Array<{ mes: string; total: string }> = await this.ds.query(`
      SELECT
        TO_CHAR(DATE_TRUNC('month', p.fecha_pago::date), 'YYYY-MM') AS mes,
        SUM(p.monto)::float                                         AS total
      FROM pagos p
      JOIN clientes cl ON cl.id = p.cliente_id
      WHERE p.empresa_id = $1
        AND cl.zona_id   = $2
        AND p.estado     = 'verificado'
        AND p.fecha_pago >= $3
        AND p.fecha_pago <= $4
      GROUP BY DATE_TRUNC('month', p.fecha_pago::date)
      ORDER BY mes ASC
    `, [empresaId, proyecto.sectorId, desde, hasta]);

    // ── 2. Egresos mensuales asignados explícitamente a este sector ──
    const egRows: Array<{ mes: string; total: string }> = await this.ds.query(`
      SELECT
        TO_CHAR(DATE_TRUNC('month', fecha_registro::date), 'YYYY-MM') AS mes,
        SUM(monto)::float                                              AS total
      FROM egresos_ingresos
      WHERE empresa_id       = $1
        AND sector_id        = $2
        AND tipo             = 'EGRESO'
        AND estado           = 'PAGADO'
        AND fecha_registro  >= $3
        AND fecha_registro  <= $4
      GROUP BY DATE_TRUNC('month', fecha_registro::date)
      ORDER BY mes ASC
    `, [empresaId, proyecto.sectorId, desde, hasta]);

    // ── 3. Combinar en serie mensual completa ────────────────────
    const meses = this.generarMeses(desde, hasta);
    const ingMap = new Map(ingRows.map(r => [r.mes, r.total]));
    const egMap  = new Map(egRows.map(r => [r.mes, r.total]));

    const flujosMensuales = meses.map(
      mes => (Number(ingMap.get(mes) ?? 0)) - (Number(egMap.get(mes) ?? 0)),
    );

    const inversion  = Number(proyecto.inversionInicial);
    const tasaAnual  = Number(proyecto.tasaDescuento);

    // ── 4. VAN y TIR ─────────────────────────────────────────────
    const van         = this.calcVAN(flujosMensuales, inversion, tasaAnual);
    const tir         = this.calcTIR(flujosMensuales, inversion);
    const paybackMeses = this.calcPayback(flujosMensuales, inversion);

    return {
      proyectoId:       proyecto.id,
      nombreProyecto:   proyecto.nombreProyecto,
      sectorId:         proyecto.sectorId,
      inversionInicial: inversion,
      tasaDescuento:    tasaAnual,
      fechaInicio:      proyecto.fechaInicio,
      mesesEvaluados:   meses.length,
      flujosMensuales,
      van,
      tir,
      paybackMeses,
    };
  }

  // ─── Helpers matemáticos ─────────────────────────────────────

  private generarMeses(desde: string, hasta: string): string[] {
    const meses: string[] = [];
    const [ay, am] = desde.split('-').map(Number);
    const [by, bm] = hasta.split('-').map(Number);
    let y = ay, m = am;
    while (y < by || (y === by && m <= bm)) {
      meses.push(`${y}-${String(m).padStart(2, '0')}`);
      m++;
      if (m > 12) { m = 1; y++; }
    }
    return meses;
  }

  /**
   * VAN = -I₀ + Σ [ Fₜ / (1 + r_m)^t ]
   * donde r_m = tasa mensual equivalente = (1 + tasaAnual)^(1/12) - 1
   */
  private calcVAN(flujos: number[], inversion: number, tasaAnual: number): number {
    const rm = Math.pow(1 + tasaAnual, 1 / 12) - 1;
    const van = flujos.reduce((acc, f, i) => acc + f / Math.pow(1 + rm, i + 1), -inversion);
    return Math.round(van * 100) / 100;
  }

  /**
   * TIR mensual: busca r tal que VAN(r) = 0 usando Newton-Raphson.
   * Devuelve la TIR anualizada: (1 + r_mensual)^12 - 1
   * Devuelve null si no converge o si la serie no tiene cambio de signo.
   */
  private calcTIR(flujos: number[], inversion: number): number | null {
    const cf = [-inversion, ...flujos];

    // Función VPN y su derivada respecto a r
    const vpn  = (r: number) => cf.reduce((s, c, t) => s + c / Math.pow(1 + r, t), 0);
    const dvpn = (r: number) => cf.reduce((s, c, t) => t === 0 ? s : s - (t * c) / Math.pow(1 + r, t + 1), 0);

    let r = 0.01; // semilla: 1% mensual
    for (let i = 0; i < 300; i++) {
      const f  = vpn(r);
      const df = dvpn(r);
      if (Math.abs(df) < 1e-14) return null;
      const rNew = r - f / df;
      if (!isFinite(rNew) || rNew <= -1) return null;
      if (Math.abs(rNew - r) < 1e-10) { r = rNew; break; }
      r = rNew;
    }

    if (!isFinite(r) || r <= -1) return null;
    const tirAnual = Math.pow(1 + r, 12) - 1;
    return Math.round(tirAnual * 10000) / 10000; // 4 decimales, ej. 0.1823 = 18.23%
  }

  /**
   * Payback simple: número de meses para recuperar la inversión acumulando flujos.
   * Devuelve null si nunca se recupera dentro de los datos disponibles.
   */
  private calcPayback(flujos: number[], inversion: number): number | null {
    let acumulado = 0;
    for (let i = 0; i < flujos.length; i++) {
      acumulado += flujos[i];
      if (acumulado >= inversion) return i + 1;
    }
    return null;
  }
}
