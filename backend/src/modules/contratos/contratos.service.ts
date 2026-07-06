import { Injectable, NotFoundException, ConflictException, BadRequestException, Logger, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryRunner } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NOTIFICATION_EVENTS } from '../notificaciones/events/notification.events';
import * as crypto from 'crypto';
import { ContratoRepository } from './repositories/contrato.repository';
import { PlanesService } from '../planes/planes.service';
import { AuditoriaService } from '../auth/auditoria.service';
import { JwtPayload } from '../../common/decorators/current-user.decorator';
import { Contrato, EstadoContrato, ContratoHistorial, TipoPago } from './entities/contrato.entity';
import { SegmentoIpv4, IpAsignada } from './entities/red.entity';
import { CreateContratoDto, UpdateContratoDto, FilterContratoDto, CambiarEstadoContratoDto, OtorgarProrrogaDto } from './dto/contrato.dto';
import { formatPaginatedResponse } from '../../common/utils/pagination.util';
import { encrypt, decrypt } from '../../common/utils/encryption.util';
import { getNextAvailableIp, getCidrRange, isValidIp } from '../../common/utils/ip.util';
import { WirelessService } from '../mikrotik/services/wireless.service';
import { RouterConnectionPool, RouterCredentials } from '../mikrotik/services/connection-pool.service';
import { PppoeService } from '../mikrotik/services/pppoe.service';
import { ArpService } from '../mikrotik/services/arp.service';
import { FirewallService } from '../mikrotik/services/firewall.service';
import { MikrotikService } from '../mikrotik/mikrotik.service';
import { SmartoltApiService } from '../smartolt/smartolt-api.service';
import { SagaLogService } from '../sagas/saga-log.service';
import { SagaTipo } from '../sagas/entities/saga-log.entity';
import { OutboxRedService }    from '../outbox-red/outbox-red.service';
import { PromesasPagoService } from '../promesas-pago/promesas-pago.service';

export interface ActivarResultado {
  contrato:     Contrato;
  mikrotikOk:   boolean;
  antenaOk:     boolean;
  advertencias: string[];
}

const withTimeout = <T>(p: Promise<T>, ms: number, label: string): Promise<T> =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`timeout ${ms}ms en ${label}`)), ms))]);

const TRANSICIONES: Record<EstadoContrato, EstadoContrato[]> = {
  [EstadoContrato.PENDIENTE_ACTIVACION]: [EstadoContrato.ACTIVO, EstadoContrato.BAJA_DEFINITIVA],
  [EstadoContrato.ACTIVO]:               [EstadoContrato.SUSPENDIDO, EstadoContrato.MOROSO, EstadoContrato.BAJA_DEFINITIVA],
  [EstadoContrato.SUSPENDIDO]:           [EstadoContrato.ACTIVO, EstadoContrato.MOROSO, EstadoContrato.CORTADO, EstadoContrato.BAJA_DEFINITIVA],
  [EstadoContrato.MOROSO]:               [EstadoContrato.ACTIVO, EstadoContrato.SUSPENDIDO, EstadoContrato.CORTADO, EstadoContrato.BAJA_DEFINITIVA],
  [EstadoContrato.CORTADO]:              [EstadoContrato.ACTIVO, EstadoContrato.BAJA_DEFINITIVA],
  [EstadoContrato.BAJA_DEFINITIVA]:      [],
};

// Guardas de negocio por transición — condición que debe cumplirse además de la transición válida.
// Se evalúan solo cuando !automatico && !adminOverride.
type GuardaFn = (c: Contrato) => string | null; // null = pasa, string = mensaje de error

const GUARDAS: Partial<Record<string, GuardaFn>> = {
  [`${EstadoContrato.SUSPENDIDO}->${EstadoContrato.ACTIVO}`]:
    (c) => c.deudaTotal > 0 ? `Deuda pendiente S/ ${Number(c.deudaTotal).toFixed(2)} — use adminOverride para forzar` : null,
  [`${EstadoContrato.MOROSO}->${EstadoContrato.ACTIVO}`]:
    (c) => c.deudaTotal > 0 ? `Deuda pendiente S/ ${Number(c.deudaTotal).toFixed(2)} — use adminOverride para forzar` : null,
  [`${EstadoContrato.CORTADO}->${EstadoContrato.ACTIVO}`]:
    (c) => c.deudaTotal > 0 ? `Deuda pendiente S/ ${Number(c.deudaTotal).toFixed(2)} — use adminOverride para forzar` : null,
  [`${EstadoContrato.ACTIVO}->${EstadoContrato.SUSPENDIDO}`]:
    (c) => (c.enProrroga && c.prorrogaHasta && new Date(c.prorrogaHasta) > new Date())
      ? `Prórroga activa hasta ${c.prorrogaHasta} — use adminOverride para suspender antes` : null,
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
    private readonly mikrotikSvc: MikrotikService,
    private readonly smartoltApi: SmartoltApiService,
    private readonly sagaLog: SagaLogService,
    private readonly outboxRed: OutboxRedService,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly events: EventEmitter2,
    private readonly promesasSvc: PromesasPagoService,
  ) {}

  async create(dto: CreateContratoDto, user: JwtPayload, req?: any): Promise<Contrato> {
    // ── Pre-tx: validaciones read-only ────────────────────────
    let plan: any = null;
    if (dto.planId) {
      plan = await this.planesSvc.findOne(dto.planId, user.empresaId);
      if (!plan.activo) throw new BadRequestException(`Plan "${plan.nombre}" inactivo`);
    }

    if (dto.macAddress?.trim()) {
      const [macExistente] = await this.dataSource.query<any[]>(
        `SELECT numero_contrato FROM contratos WHERE empresa_id = $1 AND mac_address = $2 AND estado != 'baja_definitiva' AND deleted_at IS NULL LIMIT 1`,
        [user.empresaId, dto.macAddress.trim()],
      );
      if (macExistente) throw new ConflictException(`La MAC ${dto.macAddress} ya está registrada en el contrato ${macExistente.numero_contrato}`);
    }

    if (dto.routerId) {
      const [router] = await this.dataSource.query<any[]>(
        `SELECT tipo_control AS "tipoControl", controla_autenticacion AS "controlaAutenticacion", nombre FROM routers WHERE id = $1 AND empresa_id = $2 AND deleted_at IS NULL`,
        [dto.routerId, user.empresaId],
      );
      if (!router) throw new BadRequestException('Router no encontrado');

      const authEfectivo = router.controlaAutenticacion ? router.tipoControl : (dto.tipoAuth ?? 'ninguna');
      const requiereMac  = authEfectivo === 'amarre_ip_mac' || authEfectivo === 'amarre_ip_mac_dhcp';
      if (requiereMac && !dto.macAddress?.trim()) {
        throw new BadRequestException(
          `La autenticación por Amarre IP/MAC requiere dirección MAC.`,
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
        // PPPoE asigna IPs desde un pool interno del servidor PPPoE, no desde una interfaz LAN.
        // Solo amarre_ip_mac y amarre_ip_mac_dhcp requieren la subred configurada en el router.
        if (authEfectivo !== 'pppoe' && authEfectivo !== 'ninguna') {
          await this.verificarSubredEnRouter(dto.routerId, dto.segmentoId, user.empresaId);
        }
      }
    }

    const numeroContrato = await this.contratoRepo.generarNumeroContrato(user.empresaId);

    // Generar usuario PPPoE único: sufijo _N si el cliente ya tiene contratos activos
    const [{ total: totalContratos }] = await this.dataSource.query<any[]>(
      `SELECT COUNT(*)::int AS total FROM contratos WHERE cliente_id = $1 AND empresa_id = $2 AND estado != 'baja_definitiva' AND deleted_at IS NULL`,
      [dto.clienteId, user.empresaId],
    );
    const base = `cli_${dto.clienteId.replace(/-/g, '').substring(0, 8)}`;
    const pppoeBase = dto.usuarioPppoe || (totalContratos > 0 ? `${base}_${totalContratos + 1}` : base);

    // Verificar unicidad PPPoE en el ERP
    const [pppoeExistente] = await this.dataSource.query<any[]>(
      `SELECT numero_contrato FROM contratos WHERE empresa_id = $1 AND usuario_pppoe = $2 AND estado != 'baja_definitiva' AND deleted_at IS NULL LIMIT 1`,
      [user.empresaId, pppoeBase],
    );
    if (pppoeExistente) throw new ConflictException(`El usuario PPPoE "${pppoeBase}" ya está en uso (contrato ${pppoeExistente.numero_contrato})`);

    const usuarioPppoe = pppoeBase;
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
        estado:         EstadoContrato.PENDIENTE_ACTIVACION,
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
    await this.contratoRepo.guardarHistorial({ contratoId:saved.id, empresaId:user.empresaId, estadoNuevo:EstadoContrato.PENDIENTE_ACTIVACION, motivo:`Plan: ${plan?.nombre ?? 'sin plan'} | IP: ${ipAsignada||'sin asignar'}`, usuarioId:user.sub });
    await this.auditoria.logCreate({ empresaId:user.empresaId, usuarioId:user.sub, usuarioEmail:user.email, modulo:'contratos', entidadId:saved.id, descripcion:`Contrato ${saved.numeroContrato}`, req });
    this.logger.log(`Contrato creado: ${saved.numeroContrato} | ip: ${ipAsignada}`);

    // Al crear nuevo contrato se elimina la nota de baja del abonado (reactivación)
    await this.dataSource.query(
      `UPDATE clientes SET nota_baja = NULL WHERE id = $1 AND nota_baja IS NOT NULL`,
      [dto.clienteId],
    );

    return saved;
  }

  // ── Actualizar servicio con re-provisión MikroTik ───────────
  async actualizarServicio(id: string, dto: UpdateContratoDto, user: JwtPayload, req?: any): Promise<Contrato> {
    const existing: any = await this.findOne(id, user.empresaId);

    if (dto.version !== undefined && existing.version !== dto.version) {
      throw new ConflictException({
        code: 'CONCURRENCY_CONFLICT',
        message: 'Los datos fueron modificados por otro usuario. Recargue la página e intente nuevamente.',
      });
    }

    // ── Re-asignación de IP si cambia el segmento ──────────────
    let newIp: string | undefined;
    const segmentoCambio = dto.segmentoId && dto.segmentoId !== existing.segmentoId;

    if (segmentoCambio) {
      const qr = this.dataSource.createQueryRunner();
      await qr.connect();
      await qr.startTransaction();
      try {
        // Liberar IP vieja DENTRO de la TX: si falla el resto, el rollback la reactiva
        if (existing.ipAsignada && existing.segmentoId) {
          await qr.manager.update(IpAsignada, { contratoId: id, activa: true }, { activa: false, liberadaEn: new Date() });
        }
        newIp = dto.ipManual?.trim()
          ? dto.ipManual.trim()
          : await this.calcularNextIpDesdePool(qr, dto.segmentoId!, user.empresaId);

        // Validar IP manual no ocupada si fue provista explícitamente
        if (dto.ipManual?.trim()) {
          const ocupada = await qr.manager.count(IpAsignada, {
            where: { ipAddress: dto.ipManual.trim(), segmentoId: dto.segmentoId!, activa: true },
          });
          if (ocupada > 0) {
            this.logger.warn(`Race condition: IP ${dto.ipManual} ya ocupada — asignando siguiente libre`);
            newIp = await this.calcularNextIpDesdePool(qr, dto.segmentoId!, user.empresaId);
          }
        }

        await qr.manager.save(
          qr.manager.create(IpAsignada, {
            empresaId:   user.empresaId,
            segmentoId:  dto.segmentoId!,
            contratoId:  id,
            ipAddress:   newIp,
            tipo:        'cliente',
            activa:      true,
          }),
        );
        await qr.commitTransaction();
      } catch (err) {
        await qr.rollbackTransaction();
        throw err;
      } finally {
        await qr.release();
      }
    } else if (dto.segmentoId && !existing.ipAsignada) {
      // Mismo segmento pero contrato sin IP asignada → asignación inicial
      const qr = this.dataSource.createQueryRunner();
      await qr.connect();
      await qr.startTransaction();
      try {
        if (dto.ipManual?.trim()) {
          const ocupada = await qr.manager.count(IpAsignada, {
            where: { ipAddress: dto.ipManual.trim(), segmentoId: dto.segmentoId, activa: true },
          });
          newIp = ocupada > 0
            ? await this.calcularNextIpDesdePool(qr, dto.segmentoId, user.empresaId)
            : dto.ipManual.trim();
        } else {
          newIp = await this.calcularNextIpDesdePool(qr, dto.segmentoId, user.empresaId);
        }

        await qr.manager.save(
          qr.manager.create(IpAsignada, {
            empresaId:  user.empresaId,
            segmentoId: dto.segmentoId,
            contratoId: id,
            ipAddress:  newIp,
            tipo:       'cliente',
            activa:     true,
          }),
        );
        await qr.commitTransaction();
      } catch (err) {
        await qr.rollbackTransaction();
        throw err;
      } finally {
        await qr.release();
      }
    }

    // ── Actualizar campos en BD ─────────────────────────────────
    const { version: _v, ...rest } = dto;
    const upd: any = { ...rest, updatedBy: user.sub };
    delete upd.ipManual;
    delete upd.passwordPppoePlain;

    if (dto.usuarioPppoe)       upd.usuarioPppoe  = dto.usuarioPppoe;
    if (dto.passwordPppoePlain) {
      try { upd.passwordPppoe = encrypt(dto.passwordPppoePlain); }
      catch { upd.passwordPppoe = dto.passwordPppoePlain; }
    }
    if (newIp) upd.ipAsignada = newIp;

    await this.contratoRepo.update(id, upd);

    // ── Responder inmediatamente; hardware en background ───────
    // Capturar el tipoAuth ANTERIOR antes de que el update lo sobreescriba en BD,
    // para que desaprovisionarMikrotik sepa qué tipo de regla eliminar del router.
    const tipoAuthAnterior: string | undefined = (existing as any).tipoAuth ?? undefined;

    const contratoActualizado = await this.findOne(id, user.empresaId);
    await this.auditoria.logUpdate({ empresaId: user.empresaId, usuarioId: user.sub, usuarioEmail: user.email, modulo: 'contratos', entidadId: id, descripcion: 'Actualización de servicio con re-provisión', req });

    setImmediate(async () => {
      this.logger.log(`actualizarServicio background → iniciando re-provisión contrato ${id} | tipoAuth anterior: ${tipoAuthAnterior ?? 'desconocido'}`);
      await withTimeout(this.desaprovisionarMikrotik(id, tipoAuthAnterior), 25000, 'desaprovision')
        .catch((e: any) => this.logger.warn(`actualizarServicio desaprovision: ${e?.message}`));
      await withTimeout(this.provisionarMikrotik(id), 25000, 'provision')
        .catch((e: any) => this.logger.warn(`actualizarServicio provision: ${e?.message}`));
      await withTimeout(this.eliminarDeAccessListAntena(id), 15000, 'antena-remove')
        .catch((e: any) => this.logger.warn(`actualizarServicio antena remove: ${e?.message}`));
      await withTimeout(this.registrarEnAccessListAntena(id), 15000, 'antena-register')
        .catch((e: any) => this.logger.warn(`actualizarServicio antena register: ${e?.message}`));
      this.logger.log(`actualizarServicio background → re-provisión completada contrato ${id}`);
    });

    return contratoActualizado;
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

    if (dto.version !== undefined && existing.version !== dto.version) {
      throw new ConflictException({
        code: 'CONCURRENCY_CONFLICT',
        message: 'Los datos fueron modificados por otro usuario. Por favor, recargue la página e intente nuevamente.',
      });
    }

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

    // Validar unicidad de MAC si cambia
    if (dto.macAddress?.trim() && dto.macAddress.trim() !== (existing as any).macAddress) {
      const [macExistente] = await this.dataSource.query<any[]>(
        `SELECT numero_contrato FROM contratos WHERE empresa_id = $1 AND mac_address = $2 AND estado != 'baja_definitiva' AND deleted_at IS NULL AND id != $3 LIMIT 1`,
        [user.empresaId, dto.macAddress.trim(), id],
      );
      if (macExistente) throw new ConflictException(`La MAC ${dto.macAddress} ya está registrada en el contrato ${macExistente.numero_contrato}`);
    }

    const { version: _v, ...dtoSinVersion } = dto;
    const upd: any = { ...dtoSinVersion, updatedBy:user.sub };
    delete upd.ipManual; delete upd.usuarioPppoe; delete upd.passwordPppoePlain;
    await this.contratoRepo.update(id, upd);
    return this.findOne(id, user.empresaId);
  }

  async cambiarEstado(id: string, dto: CambiarEstadoContratoDto, user: JwtPayload, automatico = false, req?: any): Promise<Contrato> {
    const contrato = await this.findOne(id, user.empresaId);
    const anterior = contrato.estado;

    if (!automatico) {
      // Validar transición permitida
      const permitidos = TRANSICIONES[contrato.estado] ?? [];
      if (!permitidos.includes(dto.estado))
        throw new BadRequestException(`Transición ${anterior} → ${dto.estado} no permitida. Válidas: ${permitidos.join(', ') || 'ninguna'}`);

      // Aplicar guarda de negocio (omitir si adminOverride = true)
      if (!dto.adminOverride) {
        const guardaKey = `${contrato.estado}->${dto.estado}`;
        const guarda = GUARDAS[guardaKey];
        if (guarda) {
          const error = guarda(contrato);
          if (error) throw new BadRequestException(error);
        }
      }
    }
    const upd: Partial<Contrato> = { estado:dto.estado, fechaEstado:new Date(), motivoEstado:dto.motivo, updatedBy:user.sub };
    if (dto.estado === EstadoContrato.ACTIVO && [EstadoContrato.SUSPENDIDO, EstadoContrato.MOROSO, EstadoContrato.CORTADO].includes(anterior as EstadoContrato)) {
      // ── Revertir suspensión en MikroTik (quitar de address-list + habilitar PPPoE) ──
      // Requiere solo routerId: el firewall necesita ipAsignada pero el secret PPPoE no.
      if (contrato.routerId && (contrato.ipAsignada || contrato.usuarioPppoe)) {
        setImmediate(async () => {
          try {
            const [router] = await this.dataSource.query<any[]>(`
              SELECT vpn_ip AS "vpnIp", ip_gestion AS "ipGestion",
                     usuario, password_cifrado AS "passwordCifrado",
                     usar_ssl AS "usarSsl", puerto_api AS "puertoApi",
                     puerto_api_ssl AS "puertoApiSsl", version_ros AS "versionRos",
                     timeout_conexion AS "timeoutConexion"
              FROM routers WHERE id = $1
            `, [contrato.routerId]);

            if (router) {
              const creds = {
                id:              contrato.routerId,
                ip:              router.vpnIp || router.ipGestion,
                port:            router.usarSsl ? (router.puertoApiSsl ?? 8729) : (router.puertoApi ?? 8728),
                user:            router.usuario ?? 'admin',
                passwordCifrado: router.passwordCifrado ?? '',
                useSsl:          router.usarSsl ?? false,
                timeoutSec:      router.timeoutConexion ?? 15,
                version:         (router.versionRos === 'v7' ? 'v7' : 'v6') as 'v6' | 'v7',
              };

              // 1. Quitar IP de address-list morosos (solo si tiene IP asignada)
              if (contrato.ipAsignada) {
                await this.firewallSvc.reactivarCliente(creds, contrato.ipAsignada);
              }

              // 2. Habilitar secreto PPPoE (requiere solo usuarioPppoe, no IP)
              if (contrato.usuarioPppoe) {
                await this.pppoeSvc.setEstado(creds, contrato.usuarioPppoe, false);
              }

              this.logger.log(`cambiarEstado → MikroTik reactivado: contrato ${id} | IP: ${contrato.ipAsignada ?? 'dinámica'}`);
            }
          } catch (err: any) {
            this.logger.warn(`cambiarEstado → fallo MikroTik al reactivar contrato ${id}: ${err?.message}`);
            if (contrato.routerId) {
              await this.outboxRed.encolar('REACTIVAR', id, contrato.routerId, {
                ipAsignada:   contrato.ipAsignada,
                usuarioPppoe: contrato.usuarioPppoe,
                clienteId:    contrato.clienteId,
                deudaTotal:   Number(contrato.deudaTotal),
              }).catch(() => void 0);
            }
          }
        });
      }

      // ── Notificación de reactivación ──────────────────────────
      this.dataSource.query(
        `SELECT cl.whatsapp, cl.telefono, cl.nombre_completo
         FROM clientes cl WHERE cl.id = $1 AND cl.deleted_at IS NULL`,
        [contrato.clienteId],
      ).then(([cl]: any[]) => {
        const tel = cl?.whatsapp || cl?.telefono;
        if (!tel) return;
        this.events.emit(NOTIFICATION_EVENTS.SERVICIO_REACTIVADO, {
          telefono:      tel,
          clienteNombre: cl.nombre_completo,
          planNombre:    '',
          empresaId:     user.empresaId,
          contratoId:    id,
          clienteId:     contrato.clienteId,
        });
      }).catch((e: any) => this.logger.warn(`cambiarEstado: no se pudo emitir notif reactivación: ${e?.message}`));
    }

    if (dto.estado === EstadoContrato.BAJA_DEFINITIVA) {
      const sagaBajaId = await this.sagaLog.iniciar(
        SagaTipo.BAJA_DEFINITIVA, id, user.empresaId, user.sub, 4,
      );

      upd.fechaBaja  = new Date().toISOString().split('T')[0];
      upd.motivoBaja = dto.motivo;
      upd.onuId      = null as any;
      upd.routerId   = null as any;
      upd.segmentoId = null as any;
      upd.ipAsignada = null as any;

      // S1: Liberar IP
      const t1 = Date.now();
      if (contrato.segmentoId) {
        try { await this.contratoRepo.liberarIp(id); await this.sagaLog.registrarPaso(sagaBajaId, 1, 'liberar_ip', 'OK', undefined, Date.now() - t1); }
        catch (e: any) { await this.sagaLog.registrarPaso(sagaBajaId, 1, 'liberar_ip', 'FAIL', e?.message, Date.now() - t1); }
      } else { await this.sagaLog.registrarPaso(sagaBajaId, 1, 'liberar_ip', 'SKIPPED'); }

      // S2: Desprovisionar OLT (soft — no bloquea baja)
      const t2 = Date.now();
      await withTimeout(this.desaprovisionarOlt(id), 20000, 'desaprovision-olt')
        .then(() => this.sagaLog.registrarPaso(sagaBajaId, 2, 'desprovisionar_olt', 'OK', undefined, Date.now() - t2))
        .catch((e: any) => { this.logger.warn(`cambiarEstado baja OLT: ${e?.message}`); return this.sagaLog.registrarPaso(sagaBajaId, 2, 'desprovisionar_olt', 'FAIL', e?.message, Date.now() - t2); });

      // S2b: Desaprovisionar ONU nativa (FTTH/Path B) de forma resiliente vía outbox.
      // Cubre el caso que desaprovisionarOlt() no maneja (ONU nativa sin SmartOLT ID):
      // el outbox reintenta hasta que la OLT esté disponible; omite si no hay ONU FTTH.
      await this.outboxRed.encolarDesaprovisionarOnu(id, user.empresaId).catch(() => void 0);

      // S3: Desprovisionar MikroTik (soft — no bloquea baja; reintento via outbox si falla)
      const t3 = Date.now();
      await withTimeout(this.desaprovisionarMikrotik(id), 25000, 'desaprovision-mikrotik')
        .then(() => this.sagaLog.registrarPaso(sagaBajaId, 3, 'desprovisionar_mikrotik', 'OK', undefined, Date.now() - t3))
        .catch(async (e: any) => {
          this.logger.warn(`cambiarEstado baja MikroTik: ${e?.message}`);
          await this.sagaLog.registrarPaso(sagaBajaId, 3, 'desprovisionar_mikrotik', 'FAIL', e?.message, Date.now() - t3);
          // Encolar para reintento automático — el outbox reintenta cada 5 min hasta 12 veces
          await this.outboxRed.encolarDesprovisionar(id, 'baja_definitiva_hardware_fallo').catch(() => void 0);
        });

      // S4: Eliminar de access list antena (soft)
      const t4 = Date.now();
      await withTimeout(this.eliminarDeAccessListAntena(id), 15000, 'baja-antena')
        .then(() => this.sagaLog.registrarPaso(sagaBajaId, 4, 'eliminar_antena_ap', 'OK', undefined, Date.now() - t4))
        .catch((e: any) => { this.logger.warn(`cambiarEstado baja antena: ${e?.message}`); return this.sagaLog.registrarPaso(sagaBajaId, 4, 'eliminar_antena_ap', 'FAIL', e?.message, Date.now() - t4); });

      // Completar saga aunque algunos pasos de hardware hayan fallado
      // El reconciliador detectará hardware huérfano y lo limpiará
      await this.sagaLog.completar(sagaBajaId);

      // Nota informativa con las credenciales de la última conexión
      const partes: string[] = [];
      if (contrato.usuarioPppoe) {
        let passPlain = '';
        try { passPlain = contrato.passwordPppoe ? decrypt(contrato.passwordPppoe) : ''; } catch { /* cifrado desconocido */ }
        partes.push(`PPPoE: ${contrato.usuarioPppoe}${passPlain ? ` / ${passPlain}` : ''}`);
      }
      if (contrato.ipAsignada)  partes.push(`IP: ${contrato.ipAsignada}`);
      if (contrato.macAddress)  partes.push(`MAC: ${contrato.macAddress}`);
      if (partes.length > 0) {
        const fecha = new Date().toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' });
        await this.dataSource.query(
          `UPDATE clientes SET nota_baja = $1 WHERE id = $2`,
          [`Última conexión (${fecha}): ${partes.join(' | ')}`, contrato.clienteId],
        );
      }
    }
    await this.contratoRepo.update(id, upd);
    await this.contratoRepo.guardarHistorial({ contratoId:id, empresaId:user.empresaId, estadoAnterior:anterior, estadoNuevo:dto.estado, motivo:dto.motivo, usuarioId:user.sub, automatico });
    await this.auditoria.logUpdate({ empresaId:user.empresaId, usuarioId:user.sub, usuarioEmail:user.email, modulo:'contratos', entidadId:id, descripcion:`Estado: ${anterior} → ${dto.estado}`, req });

    // Sincronizar clientes.estado cuando se reactiva un contrato suspendido.
    // Solo pone 'activo' si el cliente no tiene otros contratos suspendidos.
    if (
      dto.estado === EstadoContrato.ACTIVO &&
      [EstadoContrato.SUSPENDIDO, EstadoContrato.MOROSO, EstadoContrato.CORTADO].includes(anterior as EstadoContrato)
    ) {
      const [clienteActualizado] = await this.dataSource.query(`
        UPDATE clientes
        SET estado = 'activo', fecha_estado = NOW()
        WHERE id = $1
          AND estado = 'suspendido'
          AND NOT EXISTS (
            SELECT 1 FROM contratos
            WHERE cliente_id = $1
              AND estado IN ('suspendido', 'moroso', 'cortado')
              AND deleted_at IS NULL
              AND id != $2
          )
        RETURNING id
      `, [contrato.clienteId, id]);

      if (clienteActualizado) {
        await this.dataSource.query(`
          INSERT INTO clientes_historial_estados
            (cliente_id, empresa_id, estado_anterior, estado_nuevo, motivo, usuario_id, automatico)
          VALUES ($1, $2, 'suspendido', 'activo', $3, $4, $5)
        `, [
          contrato.clienteId,
          user.empresaId,
          dto.motivo ?? `Reactivación de contrato ${id}`,
          user.sub,
          automatico ?? false,
        ]).catch((e: any) =>
          this.logger.warn?.(`contratos.cambiarEstado historial cliente: ${e.message}`),
        );
      }
    }

    if (dto.estado === EstadoContrato.SUSPENDIDO) {
      // ── Aplicar suspensión en MikroTik (firewall + PPPoE) ──────
      // Requiere solo routerId: firewall necesita ipAsignada pero secret PPPoE no.
      if (contrato.routerId && (contrato.ipAsignada || contrato.usuarioPppoe)) {
        setImmediate(async () => {
          try {
            const [[router], [cliente]] = await Promise.all([
              this.dataSource.query<any[]>(`
                SELECT vpn_ip AS "vpnIp", ip_gestion AS "ipGestion",
                       usuario, password_cifrado AS "passwordCifrado",
                       usar_ssl AS "usarSsl", puerto_api AS "puertoApi",
                       puerto_api_ssl AS "puertoApiSsl", version_ros AS "versionRos",
                       timeout_conexion AS "timeoutConexion"
                FROM routers WHERE id = $1
              `, [contrato.routerId]),
              this.dataSource.query<any[]>(
                `SELECT nombre_completo FROM clientes WHERE id = $1`, [contrato.clienteId],
              ),
            ]);

            if (router) {
              const creds = {
                id:              contrato.routerId,
                ip:              router.vpnIp || router.ipGestion,
                port:            router.usarSsl ? (router.puertoApiSsl ?? 8729) : (router.puertoApi ?? 8728),
                user:            router.usuario ?? 'admin',
                passwordCifrado: router.passwordCifrado ?? '',
                useSsl:          router.usarSsl ?? false,
                timeoutSec:      router.timeoutConexion ?? 15,
                version:         (router.versionRos === 'v7' ? 'v7' : 'v6') as 'v6' | 'v7',
              };

              // 1. Agregar IP a address-list morosos (solo si tiene IP asignada)
              if (contrato.ipAsignada) {
                await this.firewallSvc.suspenderCliente(
                  creds,
                  contrato.ipAsignada,
                  contrato.clienteId,
                  `Suspensión manual: ${cliente?.nombre_completo ?? contrato.clienteId} | ${dto.motivo ?? 'sin motivo'} | ${new Date().toLocaleDateString('es-PE')}`,
                );
              }

              // 2. Desconectar sesión PPPoE y deshabilitar secret (requiere solo usuarioPppoe, no IP)
              if (contrato.usuarioPppoe) {
                await this.pppoeSvc.desconectarSesion(creds, contrato.usuarioPppoe);
                await this.pppoeSvc.setEstado(creds, contrato.usuarioPppoe, true);
              }

              this.logger.log(`cambiarEstado → MikroTik suspendido: contrato ${id} | IP: ${contrato.ipAsignada ?? 'dinámica'}`);
            }
          } catch (err: any) {
            this.logger.warn(`cambiarEstado → fallo MikroTik al suspender contrato ${id}: ${err?.message}`);
            if (contrato.routerId) {
              await this.outboxRed.encolar('SUSPENDER', id, contrato.routerId, {
                ipAsignada:   contrato.ipAsignada,
                usuarioPppoe: contrato.usuarioPppoe,
                clienteId:    contrato.clienteId,
                deudaTotal:   Number(contrato.deudaTotal),
              }).catch(() => void 0);
            }
          }
        });
      }

      // ── Notificación WhatsApp ────────────────────────────────
      this.dataSource.query(
        `SELECT cl.whatsapp, cl.telefono, cl.nombre_completo, em.razon_social AS empresa_nombre
         FROM clientes cl JOIN empresas em ON em.id = $2
         WHERE cl.id = $1 AND cl.deleted_at IS NULL`,
        [contrato.clienteId, user.empresaId],
      ).then(([cl]: any[]) => {
        const tel = cl?.whatsapp || cl?.telefono;
        if (!tel) return;
        this.events.emit(NOTIFICATION_EVENTS.SERVICIO_SUSPENDIDO, {
          telefono:         tel,
          clienteNombre:    cl.nombre_completo,
          deudaTotal:       String(contrato.deudaTotal ?? 0),
          nombreEmpresa:    cl.empresa_nombre,
          empresaId:        user.empresaId,
          contratoId:       id,
          clienteId:        contrato.clienteId,
          aggregateVersion: contrato.version,
        });
      }).catch((e: any) => this.logger.warn(`cambiarEstado: no se pudo emitir notif suspensión: ${e?.message}`));
    }

    if (dto.estado === EstadoContrato.BAJA_DEFINITIVA) {
      await this.contratoRepo.softDelete(id, user.empresaId);
      // El registro ya tiene deleted_at, devolvemos el estado final calculado
      return Object.assign(contrato, upd) as Contrato;
    }
    return this.findOne(id, user.empresaId);
  }

  async otorgarProrroga(id: string, dto: OtorgarProrrogaDto, user: JwtPayload, req?: any): Promise<Contrato> {
    // Delega a PromesasPagoService: persiste promesa, actualiza contrato y aplica en MikroTik
    await this.promesasSvc.crear(
      { contratoId: id, fechaVencimiento: dto.prorrogaHasta, motivo: dto.motivo },
      user,
    );
    return this.findOne(id, user.empresaId);
  }

  // Limpia prórroga en BD y quita la IP de ADDRESS_LIST_PRORROGA en MikroTik.
  // Llamado cuando se registra un pago que salda la deuda y el contrato sigue activo.
  async limpiarProrroga(id: string, empresaId: string): Promise<void> {
    const contrato = await this.findOne(id, empresaId);
    if (!contrato.enProrroga) return;

    await this.dataSource.query(`
      UPDATE contratos
      SET en_prorroga = false, prorroga_hasta = NULL, updated_at = NOW()
      WHERE id = $1
    `, [id]);

    if (contrato.routerId && contrato.ipAsignada) {
      setImmediate(async () => {
        try {
          const [router] = await this.dataSource.query<any[]>(`
            SELECT vpn_ip AS "vpnIp", ip_gestion AS "ipGestion",
                   usuario, password_cifrado AS "passwordCifrado",
                   usar_ssl AS "usarSsl", puerto_api AS "puertoApi",
                   puerto_api_ssl AS "puertoApiSsl", version_ros AS "versionRos",
                   timeout_conexion AS "timeoutConexion"
            FROM routers WHERE id = $1
          `, [contrato.routerId]);

          if (router) {
            const creds = {
              id:              contrato.routerId,
              ip:              router.vpnIp || router.ipGestion,
              port:            router.usarSsl ? (router.puertoApiSsl ?? 8729) : (router.puertoApi ?? 8728),
              user:            router.usuario ?? 'admin',
              passwordCifrado: router.passwordCifrado ?? '',
              useSsl:          router.usarSsl ?? false,
              timeoutSec:      router.timeoutConexion ?? 15,
              version:         (router.versionRos === 'v7' ? 'v7' : 'v6') as 'v6' | 'v7',
            };
            await this.firewallSvc.reactivarCliente(creds, contrato.ipAsignada);
            this.logger.log(`limpiarProrroga → IP ${contrato.ipAsignada} removida de address-list | contrato ${id}`);
          }
        } catch (err: any) {
          this.logger.warn(`limpiarProrroga → fallo MikroTik contrato ${id}: ${err?.message}`);
          await this.outboxRed.encolar('REACTIVAR', id, contrato.routerId!, {
            ipAsignada: contrato.ipAsignada,
          }).catch(() => void 0);
        }
      });
    }
  }

  async activar(id: string, user: JwtPayload, req?: any): Promise<ActivarResultado> {
    const c = await this.findOne(id, user.empresaId);
    if (c.estado !== EstadoContrato.PENDIENTE_ACTIVACION)
      throw new BadRequestException(`Solo se activan contratos PENDIENTE_ACTIVACION. Estado: ${c.estado}`);

    const sagaId = await this.sagaLog.iniciar(
      SagaTipo.ACTIVAR_CONTRATO, id, user.empresaId, user.sub, 5,
    );

    // ── S1: Provisionar MikroTik ANTES de activar en BD ──────────────────────
    // Si falla → fallar saga, el contrato permanece en PENDIENTE_ACTIVACION.
    let provisionadoOk = false;
    let provisionMotivoFallo: string | undefined;
    const t1 = Date.now();
    try {
      const provResult = await this.provisionarMikrotik(id);
      provisionadoOk    = provResult.ok;
      provisionMotivoFallo = provResult.motivo;
      await this.sagaLog.registrarPaso(sagaId, 1, 'provision_mikrotik',
        provisionadoOk ? 'OK' : 'SKIPPED', provisionMotivoFallo, Date.now() - t1);
    } catch (err: any) {
      this.logger.error(`activar → ${id} | fallo MikroTik: ${err?.message}`);
      await this.sagaLog.registrarPaso(sagaId, 1, 'provision_mikrotik', 'FAIL', err?.message, Date.now() - t1);
      await this.sagaLog.fallar(sagaId, `Provisión MikroTik fallida: ${err?.message}`);
      await this.contratoRepo.guardarHistorial({
        contratoId: id, empresaId: user.empresaId,
        estadoAnterior: EstadoContrato.PENDIENTE_ACTIVACION,
        estadoNuevo:    EstadoContrato.PENDIENTE_ACTIVACION,
        motivo: `Intento fallido — MikroTik: ${err?.message} | sagaId: ${sagaId}`,
        usuarioId: user.sub,
      }).catch(he => this.logger.error(`activar → historial fallido: ${he?.message}`));
      throw new BadRequestException(
        `No se pudo configurar el router MikroTik: ${err?.message}. ` +
        `El contrato permanece en PENDIENTE_ACTIVACION.`,
      );
    }

    // ── S2: Registrar en antena AP (soft — no bloquea la activación) ─────────
    const t2 = Date.now();
    const antenaResult = await this.registrarEnAccessListAntena(id);
    await this.sagaLog.registrarPaso(sagaId, 2, 'registro_antena_ap',
      antenaResult.ok ? 'OK' : 'SKIPPED', antenaResult.advertencia, Date.now() - t2);

    // ── S3: Activar en BD ─────────────────────────────────────────────────────
    const t3 = Date.now();
    await this.contratoRepo.update(id, {
      estado:           EstadoContrato.ACTIVO,
      fechaEstado:      new Date(),
      fechaInstalacion: new Date(),
      updatedBy:        user.sub,
    });
    await this.sagaLog.registrarPaso(sagaId, 3, 'marcar_activo_bd', 'OK', undefined, Date.now() - t3);

    // ── S3b: Verify-after-write — confirmar que hardware aplicó provisión ─────
    const advertencias: string[] = [];
    const tV = Date.now();
    const verificado = await this.verificarProvisionHardware(id);
    await this.contratoRepo.update(id, {
      hardwareVerificado:   verificado,
      hardwareVerificadoEn: new Date(),
      hardwareEstado:       verificado ? 'ok' : 'inconsistente',
    } as any);
    await this.sagaLog.registrarPaso(sagaId, 4, 'verify_after_write',
      verificado ? 'OK' : 'FAIL',
      verificado ? undefined : 'Verificación post-provisión no confirmada',
      Date.now() - tV,
    );
    if (!verificado) advertencias.push('Hardware: provisión no verificada — el reconciliador reintentará en 15 min');

    if (!provisionadoOk && provisionMotivoFallo) advertencias.push(`MikroTik sin provisión: ${provisionMotivoFallo}`);
    if (antenaResult.advertencia) advertencias.push(antenaResult.advertencia);

    const motivo = [
      'Instalación completada',
      `MikroTik: ${provisionadoOk ? 'OK' : 'sin provisión'}`,
      antenaResult.ok ? 'Antena AP: OK' : (antenaResult.advertencia ? 'Antena AP: ERROR' : null),
      `sagaId: ${sagaId}`,
    ].filter(Boolean).join(' | ');

    await this.contratoRepo.guardarHistorial({
      contratoId: id, empresaId: user.empresaId,
      estadoAnterior: EstadoContrato.PENDIENTE_ACTIVACION,
      estadoNuevo:    EstadoContrato.ACTIVO,
      motivo, usuarioId: user.sub,
    }).catch(he => this.logger.error(`activar → historial: ${he?.message}`));

    // ── S5: Promover cliente → ACTIVO ─────────────────────────────────────────
    const t5 = Date.now();
    try {
      await this.dataSource.query(
        `UPDATE clientes SET estado = 'activo', updated_at = NOW(), updated_by = $3
         WHERE id = $1 AND empresa_id = $2 AND estado = 'pendiente_activacion'`,
        [c.clienteId, user.empresaId, user.sub],
      );
      await this.sagaLog.registrarPaso(sagaId, 5, 'promover_cliente_activo', 'OK', undefined, Date.now() - t5);
    } catch (e: any) {
      this.logger.error(`activar → cliente ${c.clienteId} | fallo promover estado: ${e?.message}`);
      await this.sagaLog.registrarPaso(sagaId, 5, 'promover_cliente_activo', 'FAIL', e?.message, Date.now() - t5);
      advertencias.push(`Estado del abonado no pudo actualizarse a "activo" — actualízalo manualmente.`);
    }

    await this.sagaLog.completar(sagaId);

    return {
      contrato:   await this.findOne(id, user.empresaId),
      mikrotikOk: provisionadoOk,
      antenaOk:   antenaResult.ok,
      advertencias,
    };
  }

  async actualizarDeuda(id: string, deudaTotal: number, mesesDeuda: number, empresaId: string): Promise<void> {
    await this.contratoRepo.update(id, { deudaTotal, mesesDeuda });
  }

  async registrarPago(id: string, fechaPago: string, empresaId: string): Promise<void> {
    await this.contratoRepo.update(id, { fechaUltimoPago:fechaPago });
  }

  async reactivarPorPago(contratoId: string, empresaId: string, operadorId: string): Promise<Contrato> {
    const c = await this.findOne(contratoId, empresaId);
    if (c.estado !== EstadoContrato.SUSPENDIDO)
      throw new BadRequestException(`Solo se reactivan contratos en SUSPENDIDO. Estado: ${c.estado}`);

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
      WHERE id = $1 AND empresa_id = $4
    `, [contratoId, nuevaFechaStr, operadorId, empresaId]);

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

  // ── Verify-after-write: confirma que el hardware tiene la config esperada ──
  // Intenta verificar hasta 3 veces con 2s de espera entre intentos.
  // Retorna true si el hardware confirmó el estado, false si no se pudo verificar.
  // El timeout por intento es 10s para no bloquear el flujo de activación.
  protected async verificarProvisionHardware(contratoId: string): Promise<boolean> {
    const MAX_INTENTOS = 3;
    const ESPERA_MS    = 2000;

    for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
      try {
        const [row] = await this.dataSource.query<any[]>(`
          SELECT
            co.tipo_auth        AS "tipoAuth",
            co.usuario_pppoe    AS "usuarioPppoe",
            co.ip_asignada      AS "ipAsignada",
            co.mac_address      AS "macAddress",
            ro.tipo_control     AS "tipoControl",
            ro.vpn_ip           AS "vpnIp",
            ro.ip_gestion       AS "ipGestion",
            ro.puerto_api       AS "puertoApi",
            ro.puerto_api_ssl   AS "puertoApiSsl",
            ro.usuario          AS "routerUsuario",
            ro.password_cifrado AS "routerPassword",
            ro.usar_ssl         AS "usarSsl",
            ro.version_ros      AS "versionRos",
            pl.crear_reglas_en_router AS "crearReglas"
          FROM contratos co
          LEFT JOIN routers ro ON ro.id = co.router_id
          LEFT JOIN planes  pl ON pl.id = co.plan_id
          WHERE co.id = $1
        `, [contratoId]);

        if (!row?.crearReglas || (!row.vpnIp && !row.ipGestion)) return true; // sin hardware que verificar

        const rawTipo: string = row.tipoAuth ?? row.tipoControl ?? 'ninguna';
        const tipoControl     = rawTipo === 'pppoe_addresslist' ? 'pppoe' : rawTipo;

        const creds = {
          id:              contratoId,
          ip:              row.vpnIp || row.ipGestion,
          port:            row.usarSsl ? (row.puertoApiSsl ?? 8729) : (row.puertoApi ?? 8728),
          user:            row.routerUsuario ?? 'admin',
          passwordCifrado: row.routerPassword ?? '',
          useSsl:          row.usarSsl ?? false,
          timeoutSec:      10,
          version:         (row.versionRos ?? 'v6') as 'v6' | 'v7',
        };

        const existe = await this.pool.execute(creds, async (api) => {
          if (tipoControl === 'pppoe' && row.usuarioPppoe) {
            const secrets = await api.write('/ppp/secret/print', [`?name=${row.usuarioPppoe}`]);
            return secrets.length > 0;
          }
          if ((tipoControl === 'amarre_ip_mac' || tipoControl === 'amarre_ip_mac_dhcp') && row.ipAsignada) {
            const arps = await api.write('/ip/arp/print', [`?address=${row.ipAsignada}`]);
            return arps.length > 0;
          }
          return true; // tipo no verificable directamente
        });

        if (existe) return true;
        if (intento < MAX_INTENTOS) await new Promise(r => setTimeout(r, ESPERA_MS));

      } catch (err: any) {
        this.logger.warn(`verificarProvisionHardware → ${contratoId} intento ${intento}/${MAX_INTENTOS}: ${err?.message}`);
        if (intento < MAX_INTENTOS) await new Promise(r => setTimeout(r, ESPERA_MS));
      }
    }
    return false;
  }

  protected async provisionarMikrotik(contratoId: string): Promise<{ ok: boolean; motivo?: string }> {
    let row: any;
    try {
      const [r] = await this.dataSource.query<any[]>(`
        SELECT
          co.router_id           AS "routerId",
          co.usuario_pppoe       AS "usuarioPppoe",
          co.password_pppoe      AS "passwordPppoe",
          co.ip_asignada         AS "ipAsignada",
          co.mac_address         AS "macAddress",
          co.tipo_auth           AS "tipoAuth",
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
          ro.version_ros         AS "versionRos",
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
      return { ok: false, motivo: `Error leyendo datos del contrato: ${err?.message}` };
    }

    if (!row) {
      this.logger.warn(`provisionarMikrotik → ${contratoId} | contrato no encontrado`);
      return { ok: false, motivo: 'Contrato no encontrado en la base de datos' };
    }

    if (!row.vpnIp && !row.ipGestion) {
      this.logger.warn(`provisionarMikrotik → ${contratoId} | router sin IP configurada`);
      return { ok: false, motivo: `El router "${row.routerNombre ?? 'sin nombre'}" no tiene IP VPN ni IP de gestión configurada — configúrala en Red → Routers` };
    }

    // Fix 2: respetar el flag del plan (igual que desaprovisionarMikrotik)
    if (!row.crearReglas) {
      this.logger.warn(`provisionarMikrotik → ${contratoId} | plan sin crear_reglas_en_router=true — omitiendo provisión MikroTik`);
      return { ok: false, motivo: 'El plan del abonado tiene "Crear reglas en router" desactivado — actívalo en Configuración → Planes' };
    }

    const creds: RouterCredentials = {
      id:              row.routerId ?? contratoId,
      ip:              row.vpnIp || row.ipGestion,
      port:            row.usarSsl ? (row.puertoApiSsl ?? 8729) : (row.puertoApi ?? 8728),
      user:            row.routerUsuario ?? 'admin',
      passwordCifrado: row.routerPassword ?? '',
      useSsl:          row.usarSsl ?? false,
      timeoutSec:      15,
      version:         (row.versionRos ?? 'v6') as any,
    };

    // co.tipo_auth tiene prioridad sobre ro.tipo_control (auth por abonado desde Task 2)
    const _rawTipo: string = row.tipoAuth ?? row.tipoControl ?? 'ninguna';
    const tipoControl: string = _rawTipo === 'pppoe_addresslist' ? 'pppoe' : _rawTipo;

    // Fix 1: tipo efectivo NINGUNA → error explícito, no fallo silencioso
    if (tipoControl === 'ninguna') {
      throw new BadRequestException(
        `El contrato no tiene tipo de autenticación configurado. ` +
        `Selecciona PPPoE, Amarre IP/MAC o Amarre IP/MAC+DHCP al editar el servicio.`,
      );
    }

    // Fix 3: validaciones con error claro en lugar de return silencioso
    if (tipoControl === 'pppoe' && !row.usuarioPppoe) {
      throw new BadRequestException(
        `El contrato no tiene usuario PPPoE asignado. Asígnalo antes de activar.`,
      );
    }
    if ((tipoControl === 'amarre_ip_mac' || tipoControl === 'amarre_ip_mac_dhcp') && (!row.ipAsignada || !row.macAddress)) {
      throw new BadRequestException(
        `Amarre IP/MAC requiere IP (${row.ipAsignada ?? 'sin asignar'}) y MAC (${row.macAddress ?? 'sin asignar'}) configuradas en el contrato.`,
      );
    }

    try {
      await this.mikrotikSvc.crearReglasControl(creds, row, tipoControl);
      this.logger.log(`provisionarMikrotik → ${contratoId} | tipo_control=${tipoControl} completado en ${creds.ip}`);
    } catch (err) {
      this.logger.warn(`provisionarMikrotik → ${contratoId} | error en router ${creds.ip}: ${err?.message}`);
      throw err;
    }

    // Marcar contrato como aprovisionado en la BD
    await this.contratoRepo.update(contratoId, { aprovisionado: true, aprovisionadoEn: new Date() } as any)
      .catch(e => this.logger.error(`provisionarMikrotik → aprovisionado flag: ${e?.message}`));

    return { ok: true };
  }

  async desaprovisionarMikrotik(contratoId: string, tipoAuthAnterior?: string): Promise<boolean> {
    let row: any;
    try {
      const [r] = await this.dataSource.query<any[]>(`
        SELECT
          co.router_id           AS "routerId",
          co.usuario_pppoe       AS "usuarioPppoe",
          co.ip_asignada         AS "ipAsignada",
          co.mac_address         AS "macAddress",
          co.tipo_auth           AS "tipoAuth",
          ro.tipo_control        AS "tipoControl",
          ro.vpn_ip              AS "vpnIp",
          ro.ip_gestion          AS "ipGestion",
          ro.puerto_api          AS "puertoApi",
          ro.puerto_api_ssl      AS "puertoApiSsl",
          ro.usuario             AS "routerUsuario",
          ro.password_cifrado    AS "routerPassword",
          ro.usar_ssl            AS "usarSsl",
          ro.nombre              AS "routerNombre",
          ro.version_ros         AS "versionRos",
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
      id:              row.routerId ?? contratoId,
      ip:              row.vpnIp || row.ipGestion,
      port:            row.usarSsl ? (row.puertoApiSsl ?? 8729) : (row.puertoApi ?? 8728),
      user:            row.routerUsuario ?? 'admin',
      passwordCifrado: row.routerPassword ?? '',
      useSsl:          row.usarSsl ?? false,
      timeoutSec:      15,
      version:         (row.versionRos ?? 'v6') as any,
    };

    // tipoAuthAnterior tiene prioridad: evita usar el tipo ya actualizado en BD
    const _rawTipo2: string = tipoAuthAnterior ?? row.tipoAuth ?? row.tipoControl ?? 'ninguna';
    const tipoControl: string = _rawTipo2 === 'pppoe_addresslist' ? 'pppoe' : _rawTipo2;

    try {
      // ── S0: Limpiar address-lists morosos/prorroga antes de eliminar reglas ──
      // La IP puede estar en morosos_datafast (suspendido) o prorroga_datafast (prórroga).
      // Si no se limpia aquí, la IP queda huérfana en el router cuando se elimina el cliente.
      if (row.ipAsignada) {
        try {
          await this.firewallSvc.reactivarCliente(creds, row.ipAsignada);
          this.logger.log(`desaprovisionarMikrotik → ${contratoId} | address-lists limpiadas: ${row.ipAsignada}`);
        } catch (e: any) {
          this.logger.warn(`desaprovisionarMikrotik → ${contratoId} | error limpiando address-lists: ${e?.message}`);
        }
      }

      if (tipoControl === 'pppoe' && row.usuarioPppoe) {
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
            const macFmt = row.macAddress.toUpperCase().replace(/[^A-F0-9]/g, '').match(/.{2}/g)?.join(':') ?? row.macAddress.toUpperCase();
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

  // ─── Eliminar ONU de la OLT (SmartOLT o nativo) ─────────────
  // Se llama ANTES de limpiar MikroTik para respetar el orden inverso
  // al aprovisionamiento: OLT → MikroTik → IP.
  // Nunca lanza excepción: un fallo de OLT no debe bloquear la baja.
  async desaprovisionarOlt(contratoId: string): Promise<void> {
    let row: any;
    try {
      const [r] = await this.dataSource.query<any[]>(`
        SELECT
          co.aprovisionado        AS aprovisionado,
          onu.id                  AS "onuId",
          onu.smartolt_onu_id     AS "smartoltOnuId",
          olt.smartolt_id         AS "smartoltId"
        FROM contratos co
        LEFT JOIN onus onu ON onu.id = co.onu_id
        LEFT JOIN olts olt ON olt.id = onu.olt_id
        WHERE co.id = $1
      `, [contratoId]);
      row = r;
    } catch (err) {
      this.logger.warn(`desaprovisionarOlt → ${contratoId} | error leyendo datos: ${err?.message}`);
      return;
    }

    if (!row?.aprovisionado || !row?.onuId) return;

    // SmartOLT: eliminar provisión via API
    if (row.smartoltOnuId && row.smartoltId) {
      try {
        await this.smartoltApi.eliminarProvision(row.smartoltId, row.smartoltOnuId);
        this.logger.log(`desaprovisionarOlt → ${contratoId} | ONU eliminada de SmartOLT: ${row.smartoltOnuId}`);
      } catch (err) {
        this.logger.warn(`desaprovisionarOlt → ${contratoId} | Error eliminando ONU de SmartOLT: ${err?.message}`);
      }
    } else {
      // OLT nativo (SSH): el deprovisioning se delega al microservicio Python.
      // El técnico debe confirmar manualmente en la OLT si el Python no está disponible.
      this.logger.warn(`desaprovisionarOlt → ${contratoId} | ONU ${row.onuId} sin SmartOLT ID — deprovision nativo requiere confirmación manual.`);
    }

    // Actualizar estado de la ONU en BD (independientemente del resultado de la OLT)
    try {
      await this.dataSource.query(`
        UPDATE onus
        SET estado            = 'sin_aprovisionar',
            smartolt_onu_id   = NULL,
            aprovisionada_en  = NULL
        WHERE id = $1
      `, [row.onuId]);
    } catch (err) {
      this.logger.warn(`desaprovisionarOlt → ${contratoId} | Error actualizando ONU en BD: ${err?.message}`);
    }
  }

  protected async registrarEnAccessListAntena(contratoId: string): Promise<{ ok: boolean; advertencia?: string }> {
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

    // Fix 4: siempre retornar advertencia con detalle del campo faltante
    if (!row?.macAddress)  return { ok: false, advertencia: `Contrato sin MAC address — no se puede registrar en Access List de la antena` };
    if (!row?.antenaApId)  return { ok: false, advertencia: `Contrato sin antena_ap_id asignado — selecciona la antena AP del cliente` };
    if (!row?.ipAddress)   return { ok: false, advertencia: `El dispositivo de monitoreo antena_ap_id=${row.antenaApId} no tiene IP configurada` };

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
      return { ok: true };
    } catch (err) {
      this.logger.warn(`registrarEnAccessListAntena → ${contratoId} | error al registrar MAC en AP: ${err?.message}`);
      return { ok: false, advertencia: `MAC ${row.macAddress} no registrada en AP ${row.ipAddress}: ${err?.message}` };
    }
  }

  async eliminarDeAccessListAntena(contratoId: string): Promise<void> {
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

    // Si no hay MAC address, no hay nada que limpiar en ninguna antena
    if (!row?.macAddress) return;

    // Hay MAC pero no antena_ap_id → el cliente fue dado de baja sin antena asignada
    if (!row?.antenaApId) {
      this.logger.warn(
        `eliminarDeAccessListAntena → ${contratoId} | MAC ${row.macAddress} no tiene antena_ap_id asignado — no se puede limpiar Access List`,
      );
      return;
    }

    // Hay antena_ap_id pero el dispositivo de monitoreo no existe (fue eliminado)
    if (!row?.ipAddress) {
      this.logger.warn(
        `eliminarDeAccessListAntena → ${contratoId} | antena_ap_id ${row.antenaApId} no tiene dispositivo de monitoreo (ipAddress) — posiblemente fue eliminado de la base de datos`,
      );
      return;
    }

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
      const removed = await this.wirelessSvc.eliminarMacAccessList(creds, row.macAddress);
      if (removed > 0) {
        this.logger.log(
          `eliminarDeAccessListAntena → ${contratoId} | MAC ${row.macAddress} removida de AP ${row.ipAddress} (${removed} entrada(s))`,
        );
      } else {
        this.logger.warn(
          `eliminarDeAccessListAntena → ${contratoId} | MAC ${row.macAddress} no encontrada en Access List del AP ${row.ipAddress} — posiblemente ya fue removida o nunca existió`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `eliminarDeAccessListAntena → ${contratoId} | error al remover MAC ${row.macAddress} del AP ${row.ipAddress}: ${err?.message}`,
      );
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
      // Error de conectividad: el segmento podría estar bien configurado pero el router
      // no es accesible en este momento. No bloquear la creación del contrato.
      this.logger.warn(
        `verificarSubredEnRouter → router "${r.nombre}" inaccesible, validación omitida: ${err?.message ?? 'Error de conexión'}`,
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
