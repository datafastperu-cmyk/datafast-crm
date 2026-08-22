import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { Contrato, ContratoHistorial, EstadoContrato } from '../entities/contrato.entity';
import { SegmentoIpv4, IpAsignada } from '../entities/red.entity';
import { FilterContratoDto } from '../dto/contrato.dto';
import { paginate, PaginatedResult } from '../../../common/utils/pagination.util';
import { DeudaPorContratoService } from '../../facturacion/deuda-por-contrato.service';
import { sqlDeudaExigible } from '../../facturacion/domain/estados-con-saldo';

@Injectable()
export class ContratoRepository {
  private readonly repo: Repository<Contrato>;
  private readonly histRepo: Repository<ContratoHistorial>;
  private readonly segmentoRepo: Repository<SegmentoIpv4>;
  private readonly ipRepo: Repository<IpAsignada>;

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly deudaSvc: DeudaPorContratoService,
  ) {
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
    const filas = await this.ds.query(`
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
        ro.nombre AS "routerNombre",
        -- Presencia de ONU FTTH: permite distinguir en la UI "aprovisionar" (no hay equipo)
        -- de "gestionar" (ya lo hay). Sin este dato, el botón se ocultaba con el contrato
        -- suspendido y dejaba sin acceso al equipo de un abonado cortado — justo cuando hay
        -- que diagnosticarlo, o reemplazar una ONU robada o quemada.
        fo.sn     AS "onuSn",
        fo.estado AS "onuEstado"
      FROM servicios co
      LEFT JOIN planes pl ON pl.id = co.plan_id
      LEFT JOIN routers ro ON ro.id = co.router_id
      LEFT JOIN ftth_onu_registro fo ON fo.contrato_id = co.id AND fo.deleted_at IS NULL
      WHERE co.cliente_id = $1 AND co.empresa_id = $2 AND co.deleted_at IS NULL
      ORDER BY co.created_at DESC
    `, [clienteId, empresaId]);

    // `deudaTotal` ya no sale de `co.deuda_total` (Ola 4, el acumulador se retira): un solo
    // cliente, así que una sola llamada a `DeudaPorContratoService.calcular()` cubre TODOS
    // los servicios devueltos aquí — nunca una por fila.
    if (filas.length) {
      const deudas = await this.deudaSvc.calcular(clienteId, empresaId);
      for (const fila of filas) fila.deudaTotal = deudas.get(fila.id)?.monto ?? 0;
    }
    return filas;
  }

  async softDelete(id: string, empresaId: string): Promise<void> {
    await this.repo.update({ id, empresaId }, { deletedAt: new Date() });
  }

  async findAllPaginated(empresaId: string, filters: FilterContratoDto): Promise<PaginatedResult<any>> {
    const page   = filters.page  ?? 1;
    const limit  = filters.limit ?? 20;
    const offset = (page - 1) * limit;

    // Ola 4: `deuda_total` se retira. Listado paginado interactivo → presenta, no decide
    // (mismo criterio que `getResumen()`): se acepta el modelo destino (D-1, deuda a nivel
    // de CONTRATO, sin el reparto proporcional por servicio que sí preserva
    // `detectarMorosos()`). UN SOLO predicado para el filtro `conMora` y el `ORDER BY` — si
    // difirieran, el listado mostraría filas en un orden que no explica su propio filtro.
    // Subconsulta correlacionada, no un JOIN: usa `idx_facturas_contrato_exigible`
    // (1791800000072) por fila, y con `LIMIT`/`OFFSET` de por medio el plan solo la evalúa
    // sobre las filas que de verdad importan al filtro, nunca sobre toda la tabla de
    // facturas de una vez.
    const DEUDA_EXPR =
      `(SELECT COALESCE(SUM(f.saldo), 0) FROM facturas f WHERE f.contrato_id = c.contrato_id AND ${sqlDeudaExigible('f')})`;

    const allowedSort: Record<string, string> = {
      createdAt:      'c.created_at',
      estado:         'c.estado',
      fechaInicio:    'c.fecha_inicio',
      precioFinal:    'c.precio_final',
      deudaTotal:     DEUDA_EXPR,
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
    if (filters.conMora)    conds.push(`${DEUDA_EXPR} > 0`);
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
      `SELECT COUNT(*) AS total FROM servicios c WHERE ${where}`,
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
        CAST(${DEUDA_EXPR}    AS FLOAT) AS "deudaTotal",
        c.created_at               AS "createdAt",
        cl.nombre_completo         AS "clienteNombre",
        cl.telefono                AS "clienteTelefono",
        cl.numero_documento        AS "clienteDocumento",
        pl.nombre                  AS "planNombre",
        CAST(pl.velocidad_bajada AS FLOAT) AS "velocidadBajada",
        CAST(pl.velocidad_subida AS FLOAT) AS "velocidadSubida"
      FROM servicios c
      LEFT JOIN clientes cl ON cl.id = c.cliente_id AND cl.deleted_at IS NULL
      LEFT JOIN planes   pl ON pl.id = c.plan_id   AND pl.deleted_at IS NULL
      WHERE ${where}
      ORDER BY ${sortCol} ${sortDir}
      LIMIT ${limit} OFFSET ${offset}
    `, params);

    return { data, total: parseInt(total, 10), page, limit };
  }

  async findCompleto(id: string, empresaId: string) {
    const rows = await this.ds.query(`
      SELECT co.*,
        cl.nombre_completo AS cliente_nombre, cl.telefono AS cliente_telefono, cl.email AS cliente_email,
        pl.nombre AS plan_nombre, pl.velocidad_bajada, pl.velocidad_subida, pl.tipo_queue, pl.ppp_profile,
        ro.nombre AS router_nombre, ro.ip_gestion AS router_ip, ro.estado AS router_estado,
        on2.serial_number AS onu_serial, on2.estado AS onu_estado, on2.rx_power_dbm AS onu_rx_power
      FROM servicios co
      JOIN clientes cl ON cl.id = co.cliente_id
      JOIN planes   pl ON pl.id = co.plan_id
      LEFT JOIN routers ro  ON ro.id = co.router_id
      LEFT JOIN onus   on2  ON on2.id = co.onu_id
      WHERE co.id = $1 AND co.empresa_id = $2 AND co.deleted_at IS NULL
    `, [id, empresaId]);
    const row = rows[0];
    if (!row) return null;

    // `co.*` ya no trae `deuda_total`/`meses_deuda` como columna propia (Ola 4, el
    // acumulador se retira) — se calculan en vivo y se escriben con el mismo nombre que
    // `co.*` ya usaba, para no romper a quien lea esta fila.
    const deudas = await this.deudaSvc.calcular(row.cliente_id, empresaId);
    const deuda  = deudas.get(row.id);
    row.deuda_total = deuda?.monto ?? 0;
    row.meses_deuda = deuda?.comprobantes ?? 0;
    return row;
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

  async liberarIp(servicioId: string): Promise<void> {
    await this.ipRepo.update({ servicioId, activa:true }, { activa:false, liberadaEn:new Date() });
  }

  async ipYaAsignada(ip: string, segmentoId: string): Promise<boolean> {
    return (await this.ipRepo.count({ where:{ ipAddress:ip, segmentoId, activa:true } })) > 0;
  }

  /**
   * Número de contrato correlativo, serializado por (empresa, año).
   *
   * `MAX()+1` es un TOCTOU: dos altas simultáneas leen el mismo máximo y proponen el mismo
   * número. El índice `uq_contratos_empresa_numero` impide el duplicado —así que nunca se
   * corrompió nada— pero el segundo operador recibía un 500 sin explicación ni reintento.
   *
   * `pg_advisory_xact_lock` serializa a los concurrentes y se libera SOLO al terminar la
   * transacción. Por eso importa pasar el `manager` de la transacción que inserta el
   * contrato: así el número queda reservado hasta el commit. Llamarlo fuera de la
   * transacción reabre la ventana, porque el lock se soltaría antes del INSERT.
   *
   * Los otros dos correlativos del ERP ya se generaban de forma segura —`nextval` para el
   * código de cliente, `UPDATE ... RETURNING` para el de comprobante—; este se había
   * quedado atrás.
   */
  async generarNumeroContrato(empresaId: string, manager?: EntityManager): Promise<string> {
    const ejecutor = manager ?? this.repo.manager;
    const year   = new Date().getFullYear();
    const prefix = `CNT-${year}-`;
    const pos    = prefix.length + 1; // posición literal, no parámetro (pg envía números como text)

    await ejecutor.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`contrato:${empresaId}:${year}`]);

    const rows = await ejecutor.query<{ max_num: string }[]>(
      `SELECT COALESCE(MAX(CAST(SUBSTRING(numero_contrato, ${pos}) AS INTEGER)), 0) AS max_num
       FROM servicios
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
    return this.histRepo.find({ where:{ servicioId: contratoId }, order:{ createdAt:'DESC' }, take:50 });
  }

  async findProrrogasVencidas(): Promise<Contrato[]> {
    const hoy = new Date().toISOString().split('T')[0];
    // Se excluyen los estados terminales: un contrato dado de baja no tiene prórroga que
    // vencer, y actuar sobre él (suspender, tocar el router) sería operar sobre un
    // servicio que ya no existe. El filtro va aquí y no en el llamador porque este método
    // es la definición de "prórroga vencida" para todo el que pregunte.
    return this.repo.createQueryBuilder('c')
      .where('c.en_prorroga = true').andWhere('c.prorroga_hasta < :hoy', { hoy })
      .andWhere('c.estado <> :baja', { baja: EstadoContrato.BAJA_DEFINITIVA })
      .andWhere('c.deleted_at IS NULL').getMany();
  }

  /**
   * Resumen de contratos por estado — dashboard, `GET /contratos/resumen`. Solo presenta:
   * `skipAudit: true` en el controller, no alimenta ninguna decisión de corte ni reactivación
   * (esas son `detectarMorosos()`/reactivación por pago, que sí preservan el reparto exacto).
   *
   * Ola 4: `deuda_total` se retira. Aquí SÍ se acepta el modelo destino (D-1: la deuda es del
   * CONTRATO) en vez de recalcular el reparto proporcional por servicio: el bucle por cliente
   * que preserva ese reparto exacto (como en `detectarMorosos()`) escala con el número de
   * clientes de la empresa, y este endpoint lo abren N operadores M veces al día — al revés
   * del cron nocturno, que corre una vez. Diferencia de comportamiento, no oculta:
   *
   *   Un contrato con servicios en DOS estados (p. ej. uno activo y otro suspendido) y una
   *   factura consolidada reparte su deuda ENTRE columnas del desglose por estado con el
   *   modelo viejo (proporcional a las líneas de cada servicio); con este cambio, TODA la
   *   deuda del contrato cae en una sola columna — se prioriza `activo` > `suspendido` >
   *   `pendiente_activacion` > el resto, para no fragmentarla. El TOTAL no cambia: cada
   *   contrato aporta su deuda una única vez (`DISTINCT ON` evita la doble suma cuando un
   *   contrato tiene más de un servicio), nunca cero, nunca dos — verificado en
   *   `getResumen() — Ola 4` (contrato.repository.spec.ts).
   */
  async getResumen(empresaId: string) {
    return this.ds.query(`
      WITH deuda_contrato AS (
        SELECT contrato_id, COALESCE(SUM(saldo), 0) AS deuda
          FROM facturas
         WHERE ${sqlDeudaExigible()}
         GROUP BY contrato_id
      ),
      contrato_estado_atribuido AS (
        SELECT DISTINCT ON (s.contrato_id) s.contrato_id, s.estado
          FROM servicios s
         WHERE s.empresa_id = $1 AND s.deleted_at IS NULL AND s.contrato_id IS NOT NULL
         ORDER BY s.contrato_id,
           CASE s.estado
             WHEN 'activo' THEN 0 WHEN 'suspendido' THEN 1
             WHEN 'pendiente_activacion' THEN 2 ELSE 3
           END
      ),
      deuda_por_estado AS (
        SELECT cea.estado, COALESCE(SUM(dc.deuda), 0) AS deuda
          FROM contrato_estado_atribuido cea
          LEFT JOIN deuda_contrato dc ON dc.contrato_id = cea.contrato_id
         GROUP BY cea.estado
      )
      SELECT s.estado AS estado, COUNT(*) AS total, COALESCE(MAX(dpe.deuda), 0) AS deuda
        FROM servicios s
        LEFT JOIN deuda_por_estado dpe ON dpe.estado = s.estado
       WHERE s.empresa_id = $1 AND s.deleted_at IS NULL
       GROUP BY s.estado
    `, [empresaId]);
  }
}
