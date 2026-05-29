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
    await this.findOne(id, user.empresaId);
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
    try {
      const [row] = await this.dataSource.query<{ crearReglas: boolean; pppProfile: string }[]>(`
        SELECT pl.crear_reglas_en_router AS "crearReglas", pl.ppp_profile AS "pppProfile"
        FROM contratos co JOIN planes pl ON pl.id = co.plan_id
        WHERE co.id = $1
      `, [contratoId]);
      if (row?.crearReglas) {
        this.logger.log(`[SIM] provisionarMikrotik → ${contratoId} | profile: ${row.pppProfile} | creando PPPoE secret + queue + ARP`);
      } else {
        this.logger.log(`[SIM] provisionarMikrotik → ${contratoId} | modo heredado: usando perfil existente en router`);
      }
    } catch {
      this.logger.warn(`[SIM] provisionarMikrotik → ${contratoId} | no se pudo leer plan (contrato sin plan asignado)`);
    }
    return true;
  }

  protected async desaprovisionarMikrotik(contratoId: string): Promise<boolean> {
    this.logger.log(`[SIM] desaprovisionarMikrotik → ${contratoId} | eliminando PPPoE secret + queue + ARP lease`);
    return true;
  }

  protected async registrarEnAccessListAntena(contratoId: string): Promise<boolean> {
    this.logger.log(`[SIM] registrarEnAccessListAntena → ${contratoId} | registrando MAC + nombre cliente en AP de monitoreo`);
    return true;
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
}
