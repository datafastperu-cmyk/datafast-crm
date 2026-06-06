import { Injectable, NotFoundException, ConflictException, BadRequestException, Logger, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryRunner } from 'typeorm';
import * as crypto from 'crypto';
import { ContratoRepository } from './repositories/contrato.repository';
import { PlanesService } from '../planes/planes.service';
import { AuditoriaService } from '../auth/auditoria.service';
import { JwtPayload } from '../../common/decorators/current-user.decorator';
import { Contrato, EstadoContrato, ContratoHistorial, TipoPago } from './entities/contrato.entity';
import { SegmentoIpv4, IpAsignada } from './entities/red.entity';
import { CreateContratoDto, UpdateContratoDto, FilterContratoDto, CambiarEstadoContratoDto, OtorgarProrrogaDto } from './dto/contrato.dto';
import { formatPaginatedResponse } from '../../common/utils/pagination.util';
import { encrypt } from '../../common/utils/encryption.util';
import { getNextAvailableIp, getCidrRange, isValidIp } from '../../common/utils/ip.util';
import { WirelessService } from '../mikrotik/services/wireless.service';
import { RouterConnectionPool, RouterCredentials } from '../mikrotik/services/connection-pool.service';
import { PppoeService } from '../mikrotik/services/pppoe.service';
import { ArpService } from '../mikrotik/services/arp.service';
import { FirewallService } from '../mikrotik/services/firewall.service';
import { decrypt } from '../../common/utils/encryption.util';

const TRANSICIONES: Record<EstadoContrato, EstadoContrato[]> = {
  [EstadoContrato.PENDIENTE_INSTALACION]: [EstadoContrato.ACTIVO, EstadoContrato.BAJA_DEFINITIVA],
  [EstadoContrato.ACTIVO]:               [EstadoContrato.SUSPENDIDO_MORA, EstadoContrato.SUSPENDIDO_MANUAL, EstadoContrato.BAJA_SOLICITADA, EstadoContrato.BAJA_DEFINITIVA, EstadoContrato.MIGRADO],
  [EstadoContrato.SUSPENDIDO_MORA]:      [EstadoContrato.ACTIVO, EstadoContrato.PRORROGA, EstadoContrato.BAJA_DEFINITIVA],
  [EstadoContrato.SUSPENDIDO_MANUAL]:    [EstadoContrato.ACTIVO, EstadoContrato.BAJA_DEFINITIVA],
  [EstadoContrato.PRORROGA]:             [EstadoContrato.ACTIVO, EstadoContrato.SUSPENDIDO_MORA, EstadoContrato.BAJA_DEFINITIVA],
  [EstadoContrato.BAJA_SOLICITADA]:      [EstadoContrato.ACTIVO, EstadoContrato.BAJA_DEFINITIVA],
  [EstadoContrato.BAJA_DEFINITIVA]:      [],
  [EstadoContrato.MIGRADO]:              [],
};

@Injectable()
export class ContratosService {
  private readonly logger = new Logger(ContratosService.name);

  constructor(
    private readonly contratoRepo: ContratoRepository,
    private readonly planesSvc: PlanesService,
    private readonly auditoria: AuditoriaService,
    private readonly config: ConfigService,
    private readonly wirelessSvc: WirelessService,
    private readonly pool: RouterConnectionPool,
    private readonly pppoeSvc: PppoeService,
    private readonly arpSvc: ArpService,
    private readonly firewallSvc: FirewallService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async create(dto: CreateContratoDto, user: JwtPayload, req?: any): Promise<Contrato> {
    // ── Pre-tx: validaciones read-only ────────────────────────
    let plan: any = null;
    if (dto.planId) {
      plan = await this.planesSvc.findOne(dto.planId, user.empresaId);
      if (!plan.activo) throw new BadRequestException(`Plan "${plan.nombre}" inactivo`);
      const contratosCliente = await this.contratoRepo.findByClienteId(dto.clienteId, user.empresaId);
      const duplicate = contratosCliente.find(c =>
        c.planId === dto.planId &&
        [EstadoContrato.ACTIVO, EstadoContrato.PENDIENTE_INSTALACION, EstadoContrato.PRORROGA].includes(c.estado),
      );
      if (duplicate) throw new ConflictException(`Cliente ya tiene contrato activo con plan "${plan.nombre}" (${duplicate.numeroContrato})`);
    }

    if (dto.routerId) {
      const [router] = await this.dataSource.query<any[]>(
        `SELECT tipo_control AS "tipoControl", nombre FROM routers WHERE id = $1 AND empresa_id = $2 AND deleted_at IS NULL`,
        [dto.routerId, user.empresaId],
      );
      if (!router) throw new BadRequestException('Router no encontrado');

      const requiereMac = router.tipoControl === 'amarre_ip_mac' || router.tipoControl === 'amarre_ip_mac_dhcp';
      if (requiereMac && !dto.macAddress?.trim()) {
        throw new BadRequestException(
          `El router "${router.nombre}" usa autenticación por Amarre IP/MAC. La dirección MAC es obligatoria.`,
        );
      }

      if (dto.segmentoId) {
        const [seg] = await this.dataSource.query<any[]>(
          `SELECT router_id AS "routerId", nombre FROM segmentos_ipv4 WHERE id = $1 AND empresa_id = $2`,
          [dto.segmentoId, user.empresaId],
        );
        if (!seg) throw new BadRequestException('Segmento de red no encontrado');
        if (seg.routerId !== dto.routerId) {
          throw new BadRequestException(
            `El segmento "${seg.nombre}" no está asignado al router "${router.nombre}". ` +
            `Corrija la asignación en Red → Segmentos o seleccione el segmento correcto.`,
          );
        }
        await this.verificarSubredEnRouter(dto.routerId, dto.segmentoId, user.empresaId);
      }
    }

    const numeroContrato = await this.contratoRepo.generarNumeroContrato(user.empresaId);
    const usuarioPppoe   = dto.usuarioPppoe || `cli_${dto.clienteId.replace(/-/g,'').substring(0,8)}`;
    const passwordPlain  = dto.passwordPppoePlain || this.generarPassword(12);
    let passwordCifrado: string;
    try { passwordCifrado = encrypt(passwordPlain); }
    catch { passwordCifrado = passwordPlain; }

    // ── Transacción atómica: IP lock + contrato + ips_asignadas ─
    // El bloqueo pesimista sobre segmentos_ipv4 serializa la asignación
    // concurrente entre las instancias PM2 del clúster.
    // Si cualquier paso falla el rollback libera la IP automáticamente.
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    let saved: Contrato;
    let ipAsignada: string | null = null;

    try {
      if (dto.ipManual) {
        if (!isValidIp(dto.ipManual)) throw new BadRequestException(`IP inválida: ${dto.ipManual}`);
        if (dto.segmentoId) {
          // Bloqueo pesimista en el segmento para serializar acceso al pool
          await qr.manager
            .createQueryBuilder(SegmentoIpv4, 's')
            .setLock('pessimistic_write')
            .where('s.id = :id AND s.empresa_id = :eId', { id: dto.segmentoId, eId: user.empresaId })
            .getOne();
          const ocupada = (await qr.manager.count(IpAsignada, {
            where: { ipAddress: dto.ipManual, segmentoId: dto.segmentoId, activa: true },
          })) > 0;
          if (ocupada) {
            this.logger.warn(`Race condition: IP ${dto.ipManual} ya ocupada — asignando siguiente libre del pool ${dto.segmentoId}`);
            ipAsignada = await this.calcularNextIpDesdePool(qr, dto.segmentoId, user.empresaId);
          } else {
            ipAsignada = dto.ipManual;
          }
        } else {
          ipAsignada = dto.ipManual;
        }
      } else if (dto.segmentoId) {
        ipAsignada = await this.calcularNextIpDesdePool(qr, dto.segmentoId, user.empresaId);
      }

      // Guardar contrato (dentro de la tx)
      const entity = qr.manager.create(Contrato, {
        ...dto,
        empresaId:      user.empresaId,
        numeroContrato,
        estado:         EstadoContrato.PENDIENTE_INSTALACION,
        fechaEstado:    new Date(),
        usuarioPppoe,
        passwordPppoe:  passwordCifrado,
        ipAsignada,
        precioMensual:  dto.precioMensual ?? (plan ? Number(plan.precio) : 0),
        diaFacturacion: dto.diaFacturacion ?? this.config.get('app.billing.day', 1),
        diasProrroga:   dto.diasProrroga ?? 3,
        deudaTotal: 0, mesesDeuda: 0, aprovisionado: false,
        createdBy: user.sub, updatedBy: user.sub,
      });
      saved = await qr.manager.save(entity);

      // Registrar IP en ips_asignadas dentro de la misma tx
      // → rollback automático libera la IP si algo falla después
      if (ipAsignada && dto.segmentoId) {
        await qr.manager.save(
          qr.manager.create(IpAsignada, {
            empresaId: user.empresaId, segmentoId: dto.segmentoId,
            contratoId: saved.id, ipAddress: ipAsignada,
            tipo: 'cliente', activa: true,
          }),
        );
      }

      await qr.commitTransaction();
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }

    // ── Post-commit: historial y auditoría ────────────────────
    await this.contratoRepo.guardarHistorial({ contratoId:saved.id, empresaId:user.empresaId, estadoNuevo:EstadoContrato.PENDIENTE_INSTALACION, motivo:`Plan: ${plan?.nombre ?? 'sin plan'} | IP: ${ipAsignada||'sin asignar'}`, usuarioId:user.sub });
    await this.auditoria.logCreate({ empresaId:user.empresaId, usuarioId:user.sub, usuarioEmail:user.email, modulo:'contratos', entidadId:saved.id, descripcion:`Contrato ${saved.numeroContrato}`, req });
    this.logger.log(`Contrato creado: ${saved.numeroContrato} | ip: ${ipAsignada}`);

    return saved;
  }

  // Bloqueo pesimista de escritura sobre el segmento — serializa la asignación
  // de IPs entre las 2 instancias PM2 en modo clúster sin race conditions.
  // El lock se libera automáticamente al commitTransaction() / rollbackTransaction().
  private async calcularNextIpDesdePool(
    qr: QueryRunner, segmentoId: string, empresaId: string,
  ): Promise<string> {
    const segmento = await qr.manager
      .createQueryBuilder(SegmentoIpv4, 's')
      .setLock('pessimistic_write')
      .where('s.id = :id AND s.empresa_id = :eId AND s.activo = true', { id: segmentoId, eId: empresaId })
      .getOne();
    if (!segmento) throw new NotFoundException(`Segmento ${segmentoId} no encontrado o inactivo`);

    const rows = await qr.manager.find(IpAsignada, {
      where: { segmentoId, activa: true },
      select: ['ipAddress'] as any,
    });
    const ipsUsadas    = rows.map(r => r.ipAddress);
    const ipsReservadas = await this.contratoRepo.getIpsReservadas(segmentoId);

    const ip = getNextAvailableIp(segmento.redCidr, ipsUsadas, ipsReservadas);
    if (!ip) {
      const range = getCidrRange(segmento.redCidr);
      throw new UnprocessableEntityException(
        `Pool "${segmento.nombre}" (${segmento.redCidr}) exhausto. Usadas: ${ipsUsadas.length}/${range.usableHosts}`,
      );
    }
    return ip;
  }

  private generarPassword(len: number): string {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#';
    return Array.from({ length:len }, () => chars[crypto.randomInt(0, chars.length)]).join('');
  }

  async findAll(empresaId: string, filters: FilterContratoDto) {
    return formatPaginatedResponse(await this.contratoRepo.findAllPaginated(empresaId, filters));
  }

  async findOne(id: string, empresaId: string): Promise<Contrato> {
    const c = await this.contratoRepo.findById(id, empresaId);
    if (!c) throw new NotFoundException(`Contrato ${id} no encontrado`);
    return c;
  }

  async findOneCompleto(id: string, empresaId: string) {
    const data = await this.contratoRepo.findCompleto(id, empresaId);
    if (!data) throw new NotFoundException(`Contrato ${id} no encontrado`);
    delete data.password_pppoe;
    return data;
  }

  async findByCliente(clienteId: string, empresaId: string) {
    return this.contratoRepo.findByClienteId(clienteId, empresaId);
  }

  async findByClienteCompleto(clienteId: string, empresaId: string) {
    return this.contratoRepo.findByClienteCompleto(clienteId, empresaId);
  }

  async update(id: string, dto: UpdateContratoDto, user: JwtPayload, req?: any): Promise<Contrato> {
    const existing = await this.findOne(id, user.empresaId);

    if (dto.routerId !== undefined || dto.segmentoId !== undefined || dto.macAddress !== undefined) {
      const effectiveRouterId  = dto.routerId    !== undefined ? dto.routerId    : (existing as any).routerId;
      const effectiveMac       = dto.macAddress  !== undefined ? dto.macAddress  : (existing as any).macAddress;
      const effectiveSegmentoId = dto.segmentoId !== undefined ? dto.segmentoId  : (existing as any).segmentoId;

      if (effectiveRouterId) {
        const [router] = await this.dataSource.query<any[]>(
          `SELECT tipo_control AS "tipoControl", nombre FROM routers WHERE id = $1 AND empresa_id = $2 AND deleted_at IS NULL`,
          [effectiveRouterId, user.empresaId],
        );
        if (router) {
          const requiereMac = router.tipoControl === 'amarre_ip_mac' || router.tipoControl === 'amarre_ip_mac_dhcp';
          if (requiereMac && !effectiveMac?.trim()) {
            throw new BadRequestException(
              `El router "${router.nombre}" usa autenticación por Amarre IP/MAC. La dirección MAC es obligatoria.`,
            );
          }
          if (effectiveSegmentoId) {
            const [seg] = await this.dataSource.query<any[]>(
              `SELECT router_id AS "routerId", nombre FROM segmentos_ipv4 WHERE id = $1 AND empresa_id = $2`,
              [effectiveSegmentoId, user.empresaId],
            );
            if (!seg) throw new BadRequestException('Segmento de red no encontrado');
            if (seg.routerId !== effectiveRouterId) {
              throw new BadRequestException(
                `El segmento "${seg.nombre}" no está asignado al router "${router.nombre}". ` +
                `Corrija la asignación en Red → Segmentos o seleccione el segmento correcto.`,
              );
            }
            await this.verificarSubredEnRouter(effectiveRouterId, effectiveSegmentoId, user.empresaId);
          }
        }
      }
    }

    const upd: any = { ...dto, updatedBy:user.sub };
    delete upd.ipManual; delete upd.usuarioPppoe; delete upd.passwordPppoePlain;
    await this.contratoRepo.update(id, upd);
    return this.findOne(id, user.empresaId);
  }

  async cambiarEstado(id: string, dto: CambiarEstadoContratoDto, user: JwtPayload, automatico = false, req?: any): Promise<Contrato> {
    const contrato = await this.findOne(id, user.empresaId);
    const anterior = contrato.estado;
    if (!automatico) {
      const permitidos = TRANSICIONES[contrato.estado] ?? [];
      if (!permitidos.includes(dto.estado))
        throw new BadRequestException(`Transición ${anterior} → ${dto.estado} no permitida. Válidas: ${permitidos.join(', ') || 'ninguna'}`);
    }
    const upd: Partial<Contrato> = { estado:dto.estado, fechaEstado:new Date(), motivoEstado:dto.motivo, updatedBy:user.sub };
    if (dto.estado === EstadoContrato.BAJA_DEFINITIVA) {
      upd.fechaBaja  = new Date().toISOString().split('T')[0];
      upd.motivoBaja = dto.motivo;
      upd.onuId      = null as any;  // Desvincula ONU → queda disponible para otro contrato
      if (contrato.segmentoId) await this.contratoRepo.liberarIp(id);
      await this.desaprovisionarMikrotik(id);
      await this.eliminarDeAccessListAntena(id);
    }
    await this.contratoRepo.update(id, upd);
    await this.contratoRepo.guardarHistorial({ contratoId:id, empresaId:user.empresaId, estadoAnterior:anterior, estadoNuevo:dto.estado, motivo:dto.motivo, usuarioId:user.sub, automatico });
    await this.auditoria.logUpdate({ empresaId:user.empresaId, usuarioId:user.sub, usuarioEmail:user.email, modulo:'contratos', entidadId:id, descripcion:`Estado: ${anterior} → ${dto.estado}`, req });

    if (dto.estado === EstadoContrato.BAJA_DEFINITIVA) {
      await this.contratoRepo.softDelete(id, user.empresaId);
      // El registro ya tiene deleted_at, devolvemos el estado final calculado
      return Object.assign(contrato, upd) as Contrato;
    }
    return this.findOne(id, user.empresaId);
  }

  async otorgarProrroga(id: string, dto: OtorgarProrrogaDto, user: JwtPayload, req?: any): Promise<Contrato> {
    const c = await this.findOne(id, user.empresaId);
    if (![EstadoContrato.ACTIVO, EstadoContrato.SUSPENDIDO_MORA, EstadoContrato.PRORROGA].includes(c.estado))
      throw new BadRequestException(`No se puede prorrogar contrato en estado ${c.estado}`);
    if (new Date(dto.prorrogaHasta) <= new Date()) throw new BadRequestException('Fecha de prórroga debe ser futura');
    await this.contratoRepo.update(id, { enProrroga:true, prorrogaHasta:dto.prorrogaHasta, prorrogaMotivo:dto.motivo, prorrogaOtorgadaPor:user.sub, estado:EstadoContrato.PRORROGA, updatedBy:user.sub });
    await this.contratoRepo.guardarHistorial({ contratoId:id, empresaId:user.empresaId, estadoAnterior:c.estado, estadoNuevo:EstadoContrato.PRORROGA, motivo:`Prórroga hasta ${dto.prorrogaHasta}: ${dto.motivo}`, usuarioId:user.sub });
    return this.findOne(id, user.empresaId);
  }

  async activar(id: string, user: JwtPayload, req?: any): Promise<Contrato> {
    const c = await this.findOne(id, user.empresaId);
    if (c.estado !== EstadoContrato.PENDIENTE_INSTALACION)
      throw new BadRequestException(`Solo se activan contratos PENDIENTE_INSTALACION. Estado: ${c.estado}`);
    await this.contratoRepo.update(id, { estado:EstadoContrato.ACTIVO, fechaEstado:new Date(), fechaInstalacion:new Date(), updatedBy:user.sub });
    await this.contratoRepo.guardarHistorial({ contratoId:id, empresaId:user.empresaId, estadoAnterior:EstadoContrato.PENDIENTE_INSTALACION, estadoNuevo:EstadoContrato.ACTIVO, motivo:'Instalación completada', usuarioId:user.sub });
    await this.provisionarMikrotik(id);
    await this.registrarEnAccessListAntena(id);
    // Promover cliente de PROSPECTO → ACTIVO automáticamente al activar su primer contrato
    await this.dataSource.query(
      `UPDATE clientes SET estado = 'activo', updated_at = NOW(), updated_by = $3
       WHERE id = $1 AND empresa_id = $2 AND estado = 'prospecto'`,
      [c.clienteId, user.empresaId, user.sub],
    ).catch(() => {});
    return this.findOne(id, user.empresaId);
  }

  async actualizarDeuda(id: string, deudaTotal: number, mesesDeuda: number, empresaId: string): Promise<void> {
    await this.contratoRepo.update(id, { deudaTotal, mesesDeuda });
  }

  async registrarPago(id: string, fechaPago: string, empresaId: string): Promise<void> {
    await this.contratoRepo.update(id, { fechaUltimoPago:fechaPago });
  }

  async reactivarPorPago(contratoId: string, empresaId: string, operadorId: string): Promise<Contrato> {
    const c = await this.findOne(contratoId, empresaId);
    if (![EstadoContrato.SUSPENDIDO_MORA, EstadoContrato.PRORROGA].includes(c.estado))
      throw new BadRequestException(`Solo se reactivan contratos en SUSPENDIDO_MORA o PRORROGA. Estado: ${c.estado}`);

    const CICLO_MESES: Record<string, number> = {
      mensual: 1, bimestral: 2, trimestral: 3, semestral: 6, anual: 12,
    };
    const meses = CICLO_MESES[(c as any).cicloFacturacion ?? 'mensual'] ?? 1;
    const nuevaFechaVenc = new Date();
    nuevaFechaVenc.setMonth(nuevaFechaVenc.getMonth() + meses);
    const nuevaFechaStr = nuevaFechaVenc.toISOString().split('T')[0];

    await this.dataSource.query(`
      UPDATE contratos SET
        estado = 'activo',
        fecha_estado = NOW(),
        motivo_estado = 'Reactivación manual por pago',
        en_prorroga = false,
        prorroga_hasta = NULL,
        fecha_vencimiento = $2,
        deuda_total = 0,
        meses_deuda = 0,
        updated_at = NOW(),
        updated_by = $3
      WHERE id = $1
    `, [contratoId, nuevaFechaStr, operadorId]);

    await this.contratoRepo.guardarHistorial({
      contratoId, empresaId,
      estadoAnterior: c.estado,
      estadoNuevo: EstadoContrato.ACTIVO,
      motivo: `Reactivación por pago | Nuevo vencimiento: ${nuevaFechaStr}`,
      usuarioId: operadorId,
    });

    return this.findOne(contratoId, empresaId);
  }

  async getHistorial(id: string, empresaId: string) {
    await this.findOne(id, empresaId);
    return this.contratoRepo.getHistorial(id);
  }

  async getResumen(empresaId: string) {
    const rows = await this.contratoRepo.getResumen(empresaId);
    return rows.reduce((acc, r) => { acc[r.estado] = { total:parseInt(r.total), deuda:parseFloat(r.deuda||'0') }; return acc; }, {});
  }

  async remove(id: string, user: JwtPayload): Promise<void> {
    // Usa raw query para encontrar también registros ya soft-deleted por cambiarEstado(BAJA_DEFINITIVA)
    const [row] = await this.dataSource.query<{ estado: string }[]>(
      'SELECT estado FROM contratos WHERE id = $1 AND empresa_id = $2',
      [id, user.empresaId],
    );
    if (!row) throw new NotFoundException(`Contrato ${id} no encontrado`);
    if (row.estado !== EstadoContrato.BAJA_DEFINITIVA) throw new BadRequestException('Solo se eliminan contratos en BAJA_DEFINITIVA');
    await this.contratoRepo.softDelete(id, user.empresaId);
  }

  async getMorososParaCorte(graceDays: number) { return this.contratoRepo.findMorososParaCorte(graceDays); }
  async getParaReactivar() { return this.contratoRepo.findParaReactivar(); }
  async getProrrogasVencidas() { return this.contratoRepo.findProrrogasVencidas(); }

  // ── Métodos de red simulados ──────────────────────────────────
  // Cada uno verifica crear_reglas_en_router del plan para decidir
  // si el ERP debe crear el perfil (modo activo) o usar el existente
  // en MikroTik (modo heredado). Listos para inyectar comandos reales.
  // PM2 cluster guard: si se agregan crons aquí usar
  //   if (process.env.NODE_APP_INSTANCE !== '0') return true;

  protected async provisionarMikrotik(contratoId: string): Promise<boolean> {
    let row: any;
    try {
      const [r] = await this.dataSource.query<any[]>(`
        SELECT
          co.usuario_pppoe       AS "usuarioPppoe",
          co.password_pppoe      AS "passwordPppoe",
          co.ip_asignada         AS "ipAsignada",
          co.mac_address         AS "macAddress",
          cl.nombre_completo     AS "nombreCompleto",
          ro.tipo_control        AS "tipoControl",
          ro.vpn_ip              AS "vpnIp",
          ro.ip_gestion          AS "ipGestion",
          ro.puerto_api          AS "puertoApi",
          ro.puerto_api_ssl      AS "puertoApiSsl",
          ro.usuario             AS "routerUsuario",
          ro.password_cifrado    AS "routerPassword",
          ro.usar_ssl            AS "usarSsl",
          ro.nombre              AS "routerNombre",
          pl.ppp_profile         AS "pppProfile",
          pl.crear_reglas_en_router AS "crearReglas"
        FROM contratos co
        JOIN clientes cl ON cl.id = co.cliente_id
        LEFT JOIN routers ro ON ro.id = co.router_id
        LEFT JOIN planes pl ON pl.id = co.plan_id
        WHERE co.id = $1
      `, [contratoId]);
      row = r;
    } catch (err) {
      this.logger.warn(`provisionarMikrotik → ${contratoId} | error leyendo contrato: ${err?.message}`);
      return false;
    }

    if (!row) {
      this.logger.warn(`provisionarMikrotik → ${contratoId} | contrato no encontrado`);
      return false;
    }

    if (!row.crearReglas) {
      this.logger.log(`provisionarMikrotik → ${contratoId} | modo heredado: sin inyección de reglas`);
      return true;
    }

    if (!row.vpnIp && !row.ipGestion) {
      this.logger.warn(`provisionarMikrotik → ${contratoId} | router sin IP configurada`);
      return false;
    }

    const creds: RouterCredentials = {
      id:              row.routerNombre ?? contratoId,
      ip:              row.vpnIp || row.ipGestion,
      port:            row.usarSsl ? (row.puertoApiSsl ?? 8729) : (row.puertoApi ?? 8728),
      user:            row.routerUsuario ?? 'admin',
      passwordCifrado: row.routerPassword ?? '',
      useSsl:          row.usarSsl ?? false,
      timeoutSec:      15,
      version:         'v6',
    };

    const tipoControl: string = row.tipoControl ?? 'ninguna';
    const comment = `DATAFAST:${row.nombreCompleto}`;

    try {
      if (tipoControl === 'pppoe_addresslist') {
        if (!row.usuarioPppoe) {
          this.logger.warn(`provisionarMikrotik → ${contratoId} | pppoe sin usuario asignado`);
          return false;
        }
        const password = row.passwordPppoe ? decrypt(row.passwordPppoe) : '';
        await this.pppoeSvc.crear(creds, {
          name:          row.usuarioPppoe,
          password,
          profile:       row.pppProfile ?? 'default',
          service:       'pppoe',
          remoteAddress: row.ipAsignada || undefined,
          comment,
          disabled:      false,
        });
        this.logger.log(`provisionarMikrotik → ${contratoId} | PPPoE creado: ${row.usuarioPppoe} en ${creds.ip}`);

      } else if (tipoControl === 'amarre_ip_mac' || tipoControl === 'amarre_ip_mac_dhcp') {
        if (!row.ipAsignada || !row.macAddress) {
          this.logger.warn(`provisionarMikrotik → ${contratoId} | amarre IP/MAC requiere IP y MAC asignadas`);
          return false;
        }

        const iface = await this.arpSvc.detectarInterface(creds, row.ipAsignada);
        if (!iface) {
          this.logger.warn(`provisionarMikrotik → ${contratoId} | no se encontró interfaz para ${row.ipAsignada} en ${creds.ip}`);
          return false;
        }

        await this.arpSvc.crearArpEstatico(creds, row.ipAsignada, row.macAddress, iface, comment);
        this.logger.log(`provisionarMikrotik → ${contratoId} | ARP estático creado: ${row.ipAsignada} → ${row.macAddress} (${iface})`);

        if (tipoControl === 'amarre_ip_mac_dhcp') {
          await this.firewallSvc.crearDhcpBinding(creds, {
            macAddress: row.macAddress,
            ipAddress:  row.ipAsignada,
            hostname:   row.nombreCompleto,
            comment,
          });
          this.logger.log(`provisionarMikrotik → ${contratoId} | DHCP binding creado: ${row.macAddress} → ${row.ipAsignada}`);
        }

      } else {
        this.logger.log(`provisionarMikrotik → ${contratoId} | tipo_control=${tipoControl}: sin acción de provisión`);
      }
    } catch (err) {
      this.logger.warn(`provisionarMikrotik → ${contratoId} | error al provisionar en router ${creds.ip}: ${err?.message}`);
      return false;
    }

    return true;
  }

  protected async desaprovisionarMikrotik(contratoId: string): Promise<boolean> {
    let row: any;
    try {
      const [r] = await this.dataSource.query<any[]>(`
        SELECT
          co.usuario_pppoe       AS "usuarioPppoe",
          co.ip_asignada         AS "ipAsignada",
          co.mac_address         AS "macAddress",
          ro.tipo_control        AS "tipoControl",
          ro.vpn_ip              AS "vpnIp",
          ro.ip_gestion          AS "ipGestion",
          ro.puerto_api          AS "puertoApi",
          ro.puerto_api_ssl      AS "puertoApiSsl",
          ro.usuario             AS "routerUsuario",
          ro.password_cifrado    AS "routerPassword",
          ro.usar_ssl            AS "usarSsl",
          ro.nombre              AS "routerNombre",
          pl.crear_reglas_en_router AS "crearReglas"
        FROM contratos co
        LEFT JOIN routers ro ON ro.id = co.router_id
        LEFT JOIN planes pl ON pl.id = co.plan_id
        WHERE co.id = $1
      `, [contratoId]);
      row = r;
    } catch (err) {
      this.logger.warn(`desaprovisionarMikrotik → ${contratoId} | error leyendo contrato: ${err?.message}`);
      return false;
    }

    if (!row?.crearReglas || (!row.vpnIp && !row.ipGestion)) return true;

    const creds: RouterCredentials = {
      id:              row.routerNombre ?? contratoId,
      ip:              row.vpnIp || row.ipGestion,
      port:            row.usarSsl ? (row.puertoApiSsl ?? 8729) : (row.puertoApi ?? 8728),
      user:            row.routerUsuario ?? 'admin',
      passwordCifrado: row.routerPassword ?? '',
      useSsl:          row.usarSsl ?? false,
      timeoutSec:      15,
      version:         'v6',
    };

    const tipoControl: string = row.tipoControl ?? 'ninguna';

    try {
      if (tipoControl === 'pppoe_addresslist' && row.usuarioPppoe) {
        await this.pppoeSvc.eliminar(creds, row.usuarioPppoe);
        this.logger.log(`desaprovisionarMikrotik → ${contratoId} | PPPoE eliminado: ${row.usuarioPppoe}`);
      } else if ((tipoControl === 'amarre_ip_mac' || tipoControl === 'amarre_ip_mac_dhcp') && row.ipAsignada) {
        await this.pool.execute(creds, async (api) => {
          const arps = await api.write('/ip/arp/print', [`?address=${row.ipAsignada}`]);
          for (const a of arps) {
            await api.write('/ip/arp/remove', [`=.id=${a['.id']}`]);
          }
        });
        this.logger.log(`desaprovisionarMikrotik → ${contratoId} | ARP eliminado: ${row.ipAsignada}`);

        if (tipoControl === 'amarre_ip_mac_dhcp' && row.macAddress) {
          await this.pool.execute(creds, async (api) => {
            const leases = await api.write('/ip/dhcp-server/lease/print');
            const macFmt = row.macAddress.toUpperCase().replace(/[^A-F0-9]/g, '').match(/.{2}/g)!.join(':');
            const match = leases.find((l: any) => (l['mac-address'] || '').toUpperCase() === macFmt);
            if (match) await api.write('/ip/dhcp-server/lease/remove', [`=.id=${match['.id']}`]);
          });
          this.logger.log(`desaprovisionarMikrotik → ${contratoId} | DHCP binding eliminado: ${row.macAddress}`);
        }
      }
    } catch (err) {
      this.logger.warn(`desaprovisionarMikrotik → ${contratoId} | error al desprovisionar en router ${creds.ip}: ${err?.message}`);
      return false;
    }

    return true;
  }

  protected async registrarEnAccessListAntena(contratoId: string): Promise<boolean> {
    const [row] = await this.dataSource.query<any[]>(`
      SELECT co.mac_address      AS "macAddress",
             co.antena_ap_id     AS "antenaApId",
             cl.nombre_completo  AS "nombreCompleto",
             dm.ip_address       AS "ipAddress",
             dm.usuario,
             dm.contrasena_cifrada AS "contrasenaCifrada",
             dm.puerto_api       AS "puertoApi",
             dm.use_ssl          AS "useSsl"
      FROM contratos co
      JOIN clientes cl ON cl.id = co.cliente_id
      LEFT JOIN dispositivos_monitoreo dm ON dm.id = co.antena_ap_id
      WHERE co.id = $1
    `, [contratoId]);

    if (!row?.macAddress || !row?.antenaApId || !row?.ipAddress) return false;

    const creds: RouterCredentials = {
      id:              row.antenaApId,
      ip:              row.ipAddress,
      port:            row.useSsl ? 8729 : (row.puertoApi ?? 8728),
      user:            row.usuario ?? 'admin',
      passwordCifrado: row.contrasenaCifrada ?? '',
      useSsl:          row.useSsl ?? false,
      timeoutSec:      10,
      version:         'v6',
    };

    try {
      await this.wirelessSvc.agregarMacAccessList(creds, row.macAddress, `DATAFAST:${row.nombreCompleto}`);
      this.logger.log(`registrarEnAccessListAntena → ${contratoId} | MAC ${row.macAddress} registrada en AP ${row.ipAddress}`);
    } catch (err) {
      this.logger.warn(`registrarEnAccessListAntena → ${contratoId} | error al registrar MAC en AP: ${err?.message}`);
    }
    return true;
  }

  private async eliminarDeAccessListAntena(contratoId: string): Promise<void> {
    const [row] = await this.dataSource.query<any[]>(`
      SELECT co.mac_address      AS "macAddress",
             co.antena_ap_id     AS "antenaApId",
             dm.ip_address       AS "ipAddress",
             dm.usuario,
             dm.contrasena_cifrada AS "contrasenaCifrada",
             dm.puerto_api       AS "puertoApi",
             dm.use_ssl          AS "useSsl"
      FROM contratos co
      LEFT JOIN dispositivos_monitoreo dm ON dm.id = co.antena_ap_id
      WHERE co.id = $1
    `, [contratoId]);

    if (!row?.macAddress || !row?.antenaApId || !row?.ipAddress) return;

    const creds: RouterCredentials = {
      id:              row.antenaApId,
      ip:              row.ipAddress,
      port:            row.useSsl ? 8729 : (row.puertoApi ?? 8728),
      user:            row.usuario ?? 'admin',
      passwordCifrado: row.contrasenaCifrada ?? '',
      useSsl:          row.useSsl ?? false,
      timeoutSec:      10,
      version:         'v6',
    };

    try {
      await this.wirelessSvc.eliminarMacAccessList(creds, row.macAddress);
      this.logger.log(`eliminarDeAccessListAntena → ${contratoId} | MAC ${row.macAddress} removida de AP ${row.ipAddress}`);
    } catch (err) {
      this.logger.warn(`eliminarDeAccessListAntena → ${contratoId} | error al remover MAC de AP: ${err?.message}`);
    }
  }

  // Mantiene compatibilidad con el módulo de aprovisionamiento FTTH existente.
  async executeHuaweiOltAprovisionamiento(contratoId: string, onuSn: string): Promise<boolean> {
    this.logger.log(`[SIM] executeHuaweiOltAprovisionamiento → contratoId: ${contratoId}, onuSn: ${onuSn}`);
    return true;
  }

  async getAntenasAP(routerId: string, empresaId: string): Promise<any[]> {
    return this.dataSource.query(
      `SELECT id,
              nombre_emisor AS "nombreEmisor",
              ip_address    AS "ipAddress",
              tipo_equipo   AS "tipoEquipo",
              status
       FROM dispositivos_monitoreo
       WHERE empresa_id        = $1
         AND router_acceso_id  = $2
         AND tipo_equipo       = 'ANTENA_AP'
         AND deleted_at IS NULL
       ORDER BY nombre_emisor ASC`,
      [empresaId, routerId],
    );
  }

  async aprovisionarOnuSimulado(id: string, onuSn: string, user: JwtPayload): Promise<{ ok: boolean; mensaje: string }> {
    const contrato = await this.findOne(id, user.empresaId);
    await this.executeHuaweiOltAprovisionamiento(id, onuSn);
    await this.contratoRepo.update(id, { updatedBy: user.sub });
    await this.auditoria.logUpdate({
      empresaId:    user.empresaId,
      usuarioId:    user.sub,
      usuarioEmail: user.email,
      modulo:       'contratos',
      entidadId:    id,
      descripcion:  `[SIM] ONU aprovisionada SN: ${onuSn} en contrato ${contrato.numeroContrato}`,
    });
    return { ok: true, mensaje: `ONU ${onuSn} aprovisionada correctamente (simulado)` };
  }

  private async verificarSubredEnRouter(routerId: string, segmentoId: string, empresaId: string): Promise<void> {
    const [[r], [s]] = await Promise.all([
      this.dataSource.query<any[]>(`
        SELECT vpn_ip AS "vpnIp", ip_gestion AS "ipGestion",
               puerto_api AS "puertoApi", puerto_api_ssl AS "puertoApiSsl",
               usuario, password_cifrado AS "passwordCifrado", usar_ssl AS "usarSsl",
               nombre
        FROM routers WHERE id = $1 AND empresa_id = $2 AND deleted_at IS NULL`,
        [routerId, empresaId],
      ),
      this.dataSource.query<any[]>(
        `SELECT red_cidr AS "redCidr", nombre FROM segmentos_ipv4 WHERE id = $1 AND empresa_id = $2`,
        [segmentoId, empresaId],
      ),
    ]);
    if (!r || !s) return;

    const creds: RouterCredentials = {
      id:              routerId,
      ip:              r.vpnIp || r.ipGestion,
      port:            r.usarSsl ? r.puertoApiSsl : r.puertoApi,
      user:            r.usuario ?? 'admin',
      passwordCifrado: r.passwordCifrado ?? '',
      useSsl:          r.usarSsl ?? false,
      timeoutSec:      10,
      version:         'v6',
    };

    try {
      await this.pool.execute(creds, async (api) => {
        const addrs: any[] = await api.write('/ip/address/print');
        const encontrado = addrs.some(a => a.address && this.subredCoincide(a.address, s.redCidr));
        if (!encontrado) {
          throw new BadRequestException(
            `El segmento ${s.redCidr} (${s.nombre}) no está configurado en el router "${r.nombre}". ` +
            `Agrégalo en IP → Addresses del router antes de asignar clientes.`,
          );
        }
      });
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(
        `No se pudo verificar el segmento en el router "${r.nombre}": ${err?.message ?? 'Error de conexión'}. ` +
        `Verifique que el router esté accesible.`,
      );
    }
  }

  private subredCoincide(rosAddr: string, cidr: string): boolean {
    const [rosIp, rosPfxStr] = rosAddr.split('/');
    const [netIp, netPfxStr]  = cidr.split('/');
    if (!rosIp || !rosPfxStr || !netIp || !netPfxStr) return false;
    const pfx = parseInt(netPfxStr, 10);
    if (parseInt(rosPfxStr, 10) !== pfx) return false;
    const mask = pfx === 0 ? 0 : (~0 << (32 - pfx)) >>> 0;
    return (this.ipToInt(rosIp) & mask) === (this.ipToInt(netIp) & mask);
  }

  private ipToInt(ip: string): number {
    return ip.split('.').reduce((acc, oct) => ((acc << 8) + parseInt(oct, 10)) >>> 0, 0);
  }
}
