import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
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
  private readonly logger = new Logger(ProyectosInversionService.name);

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

  /**
   * Retorna VAN, TIR, Payback y esViable a partir de los flujos reales del sector.
   *
   * Flujos = pagos verificados de clientes (zona_id = sectorId)
   *        - egresos imputados al sector (sector_id = sectorId, tipo = EGRESO, estado = PAGADO)
   *
   * Períodos: mensuales desde fechaInicio hasta el mes actual inclusive.
   * Tasa:     tasaDescuento es anual → se convierte a mensual equivalente
   *           r_m = (1 + r_a)^(1/12) - 1   antes de iterar el VAN.
   */
  async calcularRatiosFinancieros(
    proyectoId: string,
    empresaId:  string,
  ): Promise<RatiosFinancierosResult> {
    const proyecto = await this.getById(proyectoId, empresaId);

    // Los transformers de columna garantizan que estos ya son number, no string.
    const inversion: number = proyecto.inversionInicial;
    const tasaAnual: number = proyecto.tasaDescuento;
    const desde             = proyecto.fechaInicio;
    const hasta             = new Date().toISOString().split('T')[0];

    // ── 1. Ingresos mensuales por zona usando QueryBuilder ───────
    //    pagos verificados de clientes cuya zona_id = sectorId del proyecto
    const ingRows = await this.ds.createQueryBuilder()
      .select("TO_CHAR(DATE_TRUNC('month', p.fecha_pago::date), 'YYYY-MM')", 'mes')
      .addSelect('SUM(p.monto::numeric(12,2))', 'total')
      .from('pagos', 'p')
      .innerJoin('clientes', 'cl', 'cl.id = p.cliente_id')
      .where('p.empresa_id  = :eid',    { eid:    empresaId          })
      .andWhere('cl.zona_id = :sid',    { sid:    proyecto.sectorId  })
      .andWhere('p.estado   = :estado', { estado: 'verificado'       })
      .andWhere('p.fecha_pago >= :fd',  { fd:     desde              })
      .andWhere('p.fecha_pago <= :fh',  { fh:     hasta              })
      .groupBy("DATE_TRUNC('month', p.fecha_pago::date)")
      .orderBy('mes', 'ASC')
      .getRawMany<{ mes: string; total: string }>();

    // ── 2. Egresos mensuales imputados al sector usando QueryBuilder
    const egRows = await this.ds.createQueryBuilder()
      .select("TO_CHAR(DATE_TRUNC('month', ei.fecha_registro::date), 'YYYY-MM')", 'mes')
      .addSelect('SUM(ei.monto::numeric(12,2))', 'total')
      .from('egresos_ingresos', 'ei')
      .where('ei.empresa_id      = :eid',    { eid:    empresaId         })
      .andWhere('ei.sector_id    = :sid',    { sid:    proyecto.sectorId })
      .andWhere('ei.tipo         = :tipo',   { tipo:   'EGRESO'          })
      .andWhere('ei.estado       = :estado', { estado: 'PAGADO'          })
      .andWhere('ei.fecha_registro >= :fd',  { fd:     desde             })
      .andWhere('ei.fecha_registro <= :fh',  { fh:     hasta             })
      .groupBy("DATE_TRUNC('month', ei.fecha_registro::date)")
      .orderBy('mes', 'ASC')
      .getRawMany<{ mes: string; total: string }>();

    // ── 3. Serie mensual completa desde fechaInicio hasta hoy ───
    const meses  = this.generarMeses(desde, hasta);
    const ingMap = new Map(ingRows.map(r => [r.mes, parseFloat(r.total)]));
    const egMap  = new Map(egRows.map(r => [r.mes, parseFloat(r.total)]));

    // Flujo neto mensual redondeado a 2 decimales (precisión monetaria)
    const flujosMensuales: number[] = meses.map(mes =>
      r2((ingMap.get(mes) ?? 0) - (egMap.get(mes) ?? 0)),
    );

    // ── 4. Cálculo contable ──────────────────────────────────────
    const van         = this.calcVAN(flujosMensuales, inversion, tasaAnual);
    const tir         = this.calcTIR(flujosMensuales, inversion);
    const paybackMeses = this.calcPayback(flujosMensuales, inversion);

    return {
      proyectoId:       proyecto.id,
      nombreProyecto:   proyecto.nombreProyecto,
      sectorId:         proyecto.sectorId,
      inversionInicial: r2(inversion),
      tasaDescuento:    tasaAnual,
      fechaInicio:      proyecto.fechaInicio,
      mesesEvaluados:   meses.length,
      flujosMensuales,
      van,
      tir,
      paybackMeses,
      esViable: van > 0,
    };
  }

  // ─── Helpers matemáticos ─────────────────────────────────────

  /** Genera el array ['YYYY-MM', ...] desde el primer mes del proyecto hasta el mes actual. */
  private generarMeses(desde: string, hasta: string): string[] {
    const meses: string[] = [];
    let [y, m] = desde.split('-').map(Number);
    const [by, bm] = hasta.split('-').map(Number);
    while (y < by || (y === by && m <= bm)) {
      meses.push(`${y}-${String(m).padStart(2, '0')}`);
      if (++m > 12) { m = 1; y++; }
    }
    return meses;
  }

  /**
   * VAN = -I₀ + Σ[ Fₜ / (1 + r_m)^t ]   para t = 1..N
   *
   * r_m = tasa mensual equivalente = (1 + tasaAnual)^(1/12) - 1
   * Usando la tasa mensual equivalente se descuenta correctamente
   * cada flujo según su distancia en meses desde la inversión inicial.
   */
  private calcVAN(flujos: number[], inversion: number, tasaAnual: number): number {
    const rm  = Math.pow(1 + tasaAnual, 1 / 12) - 1;
    const van = flujos.reduce(
      (acc, flujo, i) => acc + flujo / Math.pow(1 + rm, i + 1),
      -inversion,
    );
    return r2(van);
  }

  /**
   * TIR mensual por Newton-Raphson (máximo 100 iteraciones).
   *
   * Resuelve: 0 = -I₀ + Σ[ Fₜ / (1 + r)^t ]
   *
   * Condiciones de retorno 0 (no viable / indeterminada):
   *   - Flujos sin cambio de signo (todos negativos → sin recuperación)
   *   - Derivada nula o denominador inestable
   *   - No convergencia en 100 iteraciones
   *   - r ≤ -1 (tasa inválida: activo sin valor)
   *
   * Retorna la TIR anualizada: (1 + r_mensual)^12 - 1
   */
  private calcTIR(flujos: number[], inversion: number): number {
    // Precondición: debe haber al menos un flujo positivo para que exista TIR > 0
    const hayPositivo = flujos.some(f => f > 0);
    if (!hayPositivo) {
      this.logger.warn('[TIR] Sin flujos positivos — retorna 0');
      return 0;
    }

    // CF completo: CF[0] = −inversión, CF[t] = flujo del mes t
    const cf = [-inversion, ...flujos];

    const vpn  = (r: number): number =>
      cf.reduce((s, c, t) => s + c / Math.pow(1 + r, t), 0);

    const dvpn = (r: number): number =>
      cf.reduce((s, c, t) => (t === 0 ? s : s - (t * c) / Math.pow(1 + r, t + 1)), 0);

    let r = 0.01; // semilla: 1 % mensual ≈ 12.68 % anual

    for (let i = 0; i < 100; i++) {
      const fn  = vpn(r);
      const dfn = dvpn(r);

      if (Math.abs(dfn) < 1e-12) {
        this.logger.warn(`[TIR] Derivada nula en iter ${i} — retorna 0`);
        return 0;
      }

      const rNew = r - fn / dfn;

      if (!isFinite(rNew) || rNew <= -1) {
        this.logger.warn(`[TIR] Tasa inválida (${rNew}) en iter ${i} — retorna 0`);
        return 0;
      }

      if (Math.abs(rNew - r) < 1e-10) {
        r = rNew;
        break; // convergió
      }

      r = rNew;

      if (i === 99) {
        this.logger.warn('[TIR] No convergió en 100 iteraciones — retorna 0');
        return 0;
      }
    }

    // Anualizar r_mensual → r_anual = (1 + r_m)^12 - 1
    const tirAnual = Math.pow(1 + r, 12) - 1;
    return r2(tirAnual * 100); // Devuelve el porcentaje anual, ej. 18.23
  }

  /**
   * Payback simple: número de meses hasta recuperar la inversión acumulando flujos netos.
   * Devuelve null si la inversión no se recupera dentro del histórico disponible.
   */
  private calcPayback(flujos: number[], inversion: number): number | null {
    let acumulado = 0;
    for (let i = 0; i < flujos.length; i++) {
      acumulado = r2(acumulado + flujos[i]);
      if (acumulado >= inversion) return i + 1;
    }
    return null;
  }
}

/** Redondea a 2 decimales (precisión monetaria). */
function r2(n: number): number {
  return Math.round(n * 100) / 100;
}
