import { Injectable } from '@nestjs/common';
import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { Contrato, ContratoHistorial, EstadoContrato } from '../entities/contrato.entity';
import { SegmentoIpv4, IpAsignada } from '../entities/red.entity';
import { FilterContratoDto } from '../dto/contrato.dto';
import { paginate, PaginatedResult } from '../../../common/utils/pagination.util';

@Injectable()
export class ContratoRepository {
  private readonly repo: Repository<Contrato>;
  private readonly histRepo: Repository<ContratoHistorial>;
  private readonly segmentoRepo: Repository<SegmentoIpv4>;
  private readonly ipRepo: Repository<IpAsignada>;

  constructor(@InjectDataSource() private readonly ds: DataSource) {
    this.repo         = ds.getRepository(Contrato);
    this.histRepo     = ds.getRepository(ContratoHistorial);
    this.segmentoRepo = ds.getRepository(SegmentoIpv4);
    this.ipRepo       = ds.getRepository(IpAsignada);
  }

  create(d: Partial<Contrato>): Contrato { return this.repo.create(d); }
  async save(c: Contrato): Promise<Contrato> { return this.repo.save(c); }
  async update(id: string, d: Partial<Contrato>): Promise<void> { await this.repo.update({ id }, d); }

  async findById(id: string, empresaId: string): Promise<Contrato | null> {
    return this.repo.findOne({ where: { id, empresaId, deletedAt: null as any } });
  }

  async findByClienteId(clienteId: string, empresaId: string): Promise<Contrato[]> {
    return this.repo.find({ where: { clienteId, empresaId, deletedAt: null as any }, order: { createdAt: 'DESC' } });
  }

  async findByClienteCompleto(clienteId: string, empresaId: string): Promise<any[]> {
    return this.ds.query(`
      SELECT
        co.id, co.numero_contrato AS "numeroContrato", co.estado, co.empresa_id AS "empresaId",
        co.cliente_id AS "clienteId", co.plan_id AS "planId", co.router_id AS "routerId",
        co.nodo_id AS "nodoId", co.antena_ap_id AS "antenaApId", co.segmento_id AS "segmentoId",
        co.ip_asignada AS "ipAsignada", co.usuario_pppoe AS "usuarioPppoe",
        co.tipo_auth AS "tipoAuth",
        co.excluir_firewall AS "excluirFirewall",
        co.routes,
        co.ip_administracion AS "ipAdministracion",
        co.tipo_ipv4 AS "tipoIpv4",
        co.descripcion_servicio AS "descripcionServicio",
        co.comunidad_snmp AS "comunidadSnmp",
        co.usuario_antena AS "usuarioAntena",
        co.contrasena_antena AS "contrasenaAntena",
        CAST(co.precio_final AS FLOAT) AS "precioFinal",
        CAST(co.precio_mensual AS FLOAT) AS "precioMensual",
        CAST(co.descuento_pct AS FLOAT) AS "descuentoPct",
        CAST(co.deuda_total AS FLOAT) AS "deudaTotal",
        CAST(co.latitud_instalacion AS FLOAT) AS "latitudInstalacion",
        CAST(co.longitud_instalacion AS FLOAT) AS "longitudInstalacion",
        co.fecha_inicio AS "fechaInicio", co.fecha_instalacion AS "fechaInstalacion",
        co.fecha_baja AS "fechaBaja", co.en_prorroga AS "enProrroga",
        co.prorroga_hasta AS "prorrogaHasta", co.aprovisionado,
        co.mac_address AS "macAddress", co.vlan_id AS "vlanId",
        co.caja_nap AS "cajaNap", co.puerto_nap AS "puertoNap",
        co.tipo_antena AS "tipoAntena", co.direccion_instalacion AS "direccionInstalacion",
        co.notas_instalacion AS "notasInstalacion", co.created_at AS "createdAt",
        co.tipo_servicio AS "tipoServicio",
        pl.nombre AS "planNombre",
        pl.velocidad_bajada AS "velocidadBajada",
        pl.velocidad_subida AS "velocidadSubida",
        ro.nombre AS "routerNombre"
      FROM contratos co
      LEFT JOIN planes pl ON pl.id = co.plan_id
      LEFT JOIN routers ro ON ro.id = co.router_id
      WHERE co.cliente_id = $1 AND co.empresa_id = $2 AND co.deleted_at IS NULL
      ORDER BY co.created_at DESC
    `, [clienteId, empresaId]);
  }

  async softDelete(id: string, empresaId: string): Promise<void> {
    await this.repo.update({ id, empresaId }, { deletedAt: new Date() });
  }

  async findAllPaginated(empresaId: string, filters: FilterContratoDto): Promise<PaginatedResult<any>> {
    const page   = filters.page  ?? 1;
    const limit  = filters.limit ?? 20;
    const offset = (page - 1) * limit;

    const allowedSort: Record<string, string> = {
      createdAt:      'c.created_at',
      estado:         'c.estado',
      fechaInicio:    'c.fecha_inicio',
      precioFinal:    'c.precio_final',
      deudaTotal:     'c.deuda_total',
      numeroContrato: 'c.numero_contrato',
    };
    const sortCol = allowedSort[filters.sortBy ?? ''] ?? 'c.created_at';
    const sortDir = filters.sortOrder === 'ASC' ? 'ASC' : 'DESC';

    const conds: string[] = ['c.empresa_id = $1', 'c.deleted_at IS NULL'];
    const params: any[]   = [empresaId];

    if (filters.search) {
      params.push(`%${filters.search}%`);
      conds.push(`(c.numero_contrato ILIKE $${params.length} OR c.usuario_pppoe ILIKE $${params.length})`);
    }
    if (filters.estado) {
      params.push(filters.estado);
      conds.push(`c.estado = $${params.length}`);
    }
    if (filters.estados?.length) {
      params.push(filters.estados);
      conds.push(`c.estado = ANY($${params.length})`);
    }
    if (filters.clienteId) {
      params.push(filters.clienteId);
      conds.push(`c.cliente_id = $${params.length}`);
    }
    if (filters.planId) {
      params.push(filters.planId);
      conds.push(`c.plan_id = $${params.length}`);
    }
    if (filters.routerId) {
      params.push(filters.routerId);
      conds.push(`c.router_id = $${params.length}`);
    }
    if (filters.conMora)    conds.push('c.deuda_total > 0');
    if (filters.enProrroga) conds.push('c.en_prorroga = true');
    if (filters.aprovisionado !== undefined) {
      params.push(filters.aprovisionado);
      conds.push(`c.aprovisionado = $${params.length}`);
    }
    if (filters.fechaDesde) {
      params.push(filters.fechaDesde);
      conds.push(`c.fecha_inicio >= $${params.length}`);
    }
    if (filters.fechaHasta) {
      params.push(filters.fechaHasta);
      conds.push(`c.fecha_inicio <= $${params.length}`);
    }

    const where = conds.join(' AND ');

    const [{ total }] = await this.ds.query(
      `SELECT COUNT(*) AS total FROM contratos c WHERE ${where}`,
      params,
    );

    const data = await this.ds.query(`
      SELECT
        c.id,
        c.numero_contrato          AS "numeroContrato",
        c.estado,
        c.empresa_id               AS "empresaId",
        c.cliente_id               AS "clienteId",
        c.plan_id                  AS "planId",
        c.router_id                AS "routerId",
        c.usuario_pppoe            AS "usuarioPppoe",
        c.ip_asignada              AS "ipAsignada",
        c.mac_address              AS "macAddress",
        c.aprovisionado,
        c.en_prorroga              AS "enProrroga",
        c.prorroga_hasta           AS "prorrogaHasta",
        c.fecha_inicio             AS "fechaInicio",
        c.fecha_baja               AS "fechaBaja",
        c.dia_facturacion          AS "diaFacturacion",
        CAST(c.precio_final   AS FLOAT) AS "precioFinal",
        CAST(c.precio_mensual AS FLOAT) AS "precioMensual",
        CAST(c.descuento_pct  AS FLOAT) AS "descuentoPct",
        CAST(c.deuda_total    AS FLOAT) AS "deudaTotal",
        c.created_at               AS "createdAt",
        cl.nombre_completo         AS "clienteNombre",
        cl.telefono                AS "clienteTelefono",
        cl.numero_documento        AS "clienteDocumento",
        pl.nombre                  AS "planNombre",
        CAST(pl.velocidad_bajada AS FLOAT) AS "velocidadBajada",
        CAST(pl.velocidad_subida AS FLOAT) AS "velocidadSubida"
      FROM contratos c
      LEFT JOIN clientes cl ON cl.id = c.cliente_id AND cl.deleted_at IS NULL
      LEFT JOIN planes   pl ON pl.id = c.plan_id   AND pl.deleted_at IS NULL
      WHERE ${where}
      ORDER BY ${sortCol} ${sortDir}
      LIMIT ${limit} OFFSET ${offset}
    `, params);

    return { data, total: parseInt(total, 10), page, limit };
  }

  buildFilterQuery(empresaId: string, f: FilterContratoDto): SelectQueryBuilder<Contrato> {
    const qb = this.repo.createQueryBuilder('c')
      .where('c.empresa_id = :empresaId', { empresaId })
      .andWhere('c.deleted_at IS NULL');
    if (f.search)        qb.andWhere('(c.numero_contrato ILIKE :s OR c.usuario_pppoe ILIKE :s)', { s:`%${f.search}%` });
    if (f.estado)        qb.andWhere('c.estado = :estado', { estado:f.estado });
    if (f.estados?.length) qb.andWhere('c.estado IN (:...estados)', { estados:f.estados });
    if (f.clienteId)     qb.andWhere('c.cliente_id = :clienteId', { clienteId:f.clienteId });
    if (f.planId)        qb.andWhere('c.plan_id = :planId', { planId:f.planId });
    if (f.routerId)      qb.andWhere('c.router_id = :routerId', { routerId:f.routerId });
    if (f.conMora)       qb.andWhere('c.deuda_total > 0');
    if (f.enProrroga)    qb.andWhere('c.en_prorroga = true');
    if (f.aprovisionado !== undefined) qb.andWhere('c.aprovisionado = :ap', { ap:f.aprovisionado });
    if (f.fechaDesde)    qb.andWhere('c.fecha_inicio >= :fd', { fd:f.fechaDesde });
    if (f.fechaHasta)    qb.andWhere('c.fecha_inicio <= :fh', { fh:f.fechaHasta });
    return qb;
  }

  async findCompleto(id: string, empresaId: string) {
    const rows = await this.ds.query(`
      SELECT co.*,
        cl.nombre_completo AS cliente_nombre, cl.telefono AS cliente_telefono, cl.email AS cliente_email,
        pl.nombre AS plan_nombre, pl.velocidad_bajada, pl.velocidad_subida, pl.tipo_queue, pl.ppp_profile,
        ro.nombre AS router_nombre, ro.ip_gestion AS router_ip, ro.estado AS router_estado,
        on2.serial_number AS onu_serial, on2.estado AS onu_estado, on2.rx_power_dbm AS onu_rx_power
      FROM contratos co
      JOIN clientes cl ON cl.id = co.cliente_id
      JOIN planes   pl ON pl.id = co.plan_id
      LEFT JOIN routers ro  ON ro.id = co.router_id
      LEFT JOIN onus   on2  ON on2.id = co.onu_id
      WHERE co.id = $1 AND co.empresa_id = $2 AND co.deleted_at IS NULL
    `, [id, empresaId]);
    return rows[0] || null;
  }

  async findSegmento(id: string, empresaId: string): Promise<SegmentoIpv4 | null> {
    return this.segmentoRepo.findOne({ where: { id, empresaId, activo:true, deletedAt:null as any } });
  }

  async getIpsUsadas(segmentoId: string): Promise<string[]> {
    const rows = await this.ipRepo.find({ where: { segmentoId, activa:true }, select:['ipAddress'] });
    return rows.map(r => r.ipAddress);
  }

  async getIpsReservadas(segmentoId: string): Promise<string[]> {
    const seg = await this.segmentoRepo.findOne({ where: { id:segmentoId } });
    const res: string[] = [];
    if (seg?.gateway) res.push(seg.gateway);
    if (seg?.ipsReservadas?.length) res.push(...seg.ipsReservadas);
    return res;
  }

  async asignarIp(d: Partial<IpAsignada>): Promise<IpAsignada> {
    return this.ipRepo.save(this.ipRepo.create(d));
  }

  async liberarIp(contratoId: string): Promise<void> {
    await this.ipRepo.update({ contratoId, activa:true }, { activa:false, liberadaEn:new Date() });
  }

  async ipYaAsignada(ip: string, segmentoId: string): Promise<boolean> {
    return (await this.ipRepo.count({ where:{ ipAddress:ip, segmentoId, activa:true } })) > 0;
  }

  async generarNumeroContrato(empresaId: string): Promise<string> {
    const year   = new Date().getFullYear();
    const prefix = `CNT-${year}-`;
    const pos    = prefix.length + 1; // posición literal, no parámetro (pg envía números como text)
    const rows = await this.repo.manager.query<{ max_num: string }[]>(
      `SELECT COALESCE(MAX(CAST(SUBSTRING(numero_contrato, ${pos}) AS INTEGER)), 0) AS max_num
       FROM contratos
       WHERE empresa_id = $1 AND numero_contrato LIKE $2`,
      [empresaId, `${prefix}%`],
    );
    const next = (parseInt(rows[0]?.max_num ?? '0') || 0) + 1;
    return `${prefix}${String(next).padStart(6, '0')}`;
  }

  async guardarHistorial(d: Partial<ContratoHistorial>): Promise<void> {
    await this.histRepo.save(this.histRepo.create(d));
  }

  async getHistorial(contratoId: string): Promise<ContratoHistorial[]> {
    return this.histRepo.find({ where:{ contratoId }, order:{ createdAt:'DESC' }, take:50 });
  }

  async findMorososParaCorte(graceDays: number): Promise<Contrato[]> {
    const limitDate = new Date();
    limitDate.setDate(limitDate.getDate() - graceDays);
    return this.repo.createQueryBuilder('c')
      .where('c.estado = :estado', { estado: EstadoContrato.ACTIVO })
      .andWhere('c.deuda_total > 0').andWhere('c.deleted_at IS NULL')
      .andWhere('(c.en_prorroga = false OR (c.en_prorroga = true AND c.prorroga_hasta < :hoy))', { hoy:new Date().toISOString().split('T')[0] })
      .andWhere('c.fecha_estado <= :limite', { limite:limitDate }).getMany();
  }

  async findParaReactivar(): Promise<Contrato[]> {
    return this.repo.createQueryBuilder('c')
      .where('c.estado = :estado', { estado: EstadoContrato.SUSPENDIDO })
      .andWhere('c.deuda_total <= 0').andWhere('c.deleted_at IS NULL').getMany();
  }

  async findProrrogasVencidas(): Promise<Contrato[]> {
    const hoy = new Date().toISOString().split('T')[0];
    return this.repo.createQueryBuilder('c')
      .where('c.en_prorroga = true').andWhere('c.prorroga_hasta < :hoy', { hoy })
      .andWhere('c.deleted_at IS NULL').getMany();
  }

  async getResumen(empresaId: string) {
    return this.repo.createQueryBuilder('c')
      .select('c.estado','estado').addSelect('COUNT(*)','total').addSelect('SUM(c.deuda_total)','deuda')
      .where('c.empresa_id = :empresaId', { empresaId }).andWhere('c.deleted_at IS NULL')
      .groupBy('c.estado').getRawMany();
  }
}
