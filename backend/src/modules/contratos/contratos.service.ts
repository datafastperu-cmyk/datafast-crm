import { Injectable, NotFoundException, ConflictException, BadRequestException, Logger, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import * as crypto from 'crypto';
import { ContratoRepository } from './repositories/contrato.repository';
import { PlanesService } from '../planes/planes.service';
import { AuditoriaService } from '../auth/auditoria.service';
import { JwtPayload } from '../../common/decorators/current-user.decorator';
import { Contrato, EstadoContrato, ContratoHistorial } from './entities/contrato.entity';
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
    let plan: any = null;
    if (dto.planId) {
      plan = await this.planesSvc.findOne(dto.planId, user.empresaId);
      if (!plan.activo) throw new BadRequestException(`Plan "${plan.nombre}" inactivo`);

      const contratosCliente = await this.contratoRepo.findByClienteId(dto.clienteId, user.empresaId);
      const duplicate = contratosCliente.find(c =>
        c.planId === dto.planId &&
        [EstadoContrato.ACTIVO, EstadoContrato.PENDIENTE_INSTALACION, EstadoContrato.PRORROGA].includes(c.estado)
      );
      if (duplicate) throw new ConflictException(`Cliente ya tiene contrato activo con plan "${plan.nombre}" (${duplicate.numeroContrato})`);
    }

    const numeroContrato = await this.contratoRepo.generarNumeroContrato(user.empresaId);

    let ipAsignada: string | null = null;
    if (dto.ipManual) {
      if (!isValidIp(dto.ipManual)) throw new BadRequestException(`IP inválida: ${dto.ipManual}`);
      if (dto.segmentoId) {
        const ocupada = await this.contratoRepo.ipYaAsignada(dto.ipManual, dto.segmentoId);
        if (ocupada) {
          // Race condition: la IP sugerida fue tomada por otro operador — asignar la siguiente disponible
          this.logger.warn(`Race condition: IP ${dto.ipManual} ya ocupada, asignando siguiente disponible del pool ${dto.segmentoId}`);
          ipAsignada = await this.asignarIpDesdePool(dto.segmentoId, user.empresaId);
        } else {
          ipAsignada = dto.ipManual;
        }
      } else {
        ipAsignada = dto.ipManual;
      }
    } else if (dto.segmentoId) {
      ipAsignada = await this.asignarIpDesdePool(dto.segmentoId, user.empresaId);
    }

    const usuarioPppoe = dto.usuarioPppoe || `cli_${dto.clienteId.replace(/-/g,'').substring(0,8)}`;
    const passwordPlain = dto.passwordPppoePlain || this.generarPassword(12);
    let passwordCifrado: string;
    try { passwordCifrado = encrypt(passwordPlain); }
    catch { passwordCifrado = passwordPlain; }

    const contrato = this.contratoRepo.create({
      ...dto,
      empresaId: user.empresaId,
      numeroContrato,
      estado: EstadoContrato.PENDIENTE_INSTALACION,
      fechaEstado: new Date(),
      usuarioPppoe,
      passwordPppoe: passwordCifrado,
      ipAsignada,
      precioMensual: dto.precioMensual ?? (plan ? Number(plan.precio) : 0),
      diaFacturacion: dto.diaFacturacion ?? this.config.get('app.billing.day', 1),
      deudaTotal: 0, mesesDeuda: 0, aprovisionado: false,
      createdBy: user.sub, updatedBy: user.sub,
    });

    const saved = await this.contratoRepo.save(contrato);

    if (ipAsignada && dto.segmentoId) {
      await this.contratoRepo.asignarIp({ empresaId:user.empresaId, segmentoId:dto.segmentoId, contratoId:saved.id, ipAddress:ipAsignada, tipo:'cliente', activa:true });
    }

    await this.contratoRepo.guardarHistorial({ contratoId:saved.id, empresaId:user.empresaId, estadoNuevo:EstadoContrato.PENDIENTE_INSTALACION, motivo:`Plan: ${plan?.nombre ?? 'sin plan'} | IP: ${ipAsignada||'sin asignar'}`, usuarioId:user.sub });
    await this.auditoria.logCreate({ empresaId:user.empresaId, usuarioId:user.sub, usuarioEmail:user.email, modulo:'contratos', entidadId:saved.id, descripcion:`Contrato ${saved.numeroContrato}`, req });
    this.logger.log(`Contrato creado: ${saved.numeroContrato} | ip: ${ipAsignada}`);

    return saved;
  }

  private async asignarIpDesdePool(segmentoId: string, empresaId: string): Promise<string> {
    const segmento = await this.contratoRepo.findSegmento(segmentoId, empresaId);
    if (!segmento) throw new NotFoundException(`Segmento ${segmentoId} no encontrado`);
    const [ipsUsadas, ipsReservadas] = await Promise.all([this.contratoRepo.getIpsUsadas(segmentoId), this.contratoRepo.getIpsReservadas(segmentoId)]);
    const ip = getNextAvailableIp(segmento.redCidr, ipsUsadas, ipsReservadas);
    if (!ip) {
      const range = getCidrRange(segmento.redCidr);
      throw new UnprocessableEntityException(`Pool "${segmento.nombre}" (${segmento.redCidr}) exhausto. Usadas: ${ipsUsadas.length}/${range.usableHosts}`);
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
      upd.fechaBaja = new Date().toISOString().split('T')[0];
      upd.motivoBaja = dto.motivo;
      if (contrato.segmentoId) await this.contratoRepo.liberarIp(id);
    }
    await this.contratoRepo.update(id, upd);
    await this.contratoRepo.guardarHistorial({ contratoId:id, empresaId:user.empresaId, estadoAnterior:anterior, estadoNuevo:dto.estado, motivo:dto.motivo, usuarioId:user.sub, automatico });
    await this.auditoria.logUpdate({ empresaId:user.empresaId, usuarioId:user.sub, usuarioEmail:user.email, modulo:'contratos', entidadId:id, descripcion:`Estado: ${anterior} → ${dto.estado}`, req });
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

  async getHistorial(id: string, empresaId: string) {
    await this.findOne(id, empresaId);
    return this.contratoRepo.getHistorial(id);
  }

  async getResumen(empresaId: string) {
    const rows = await this.contratoRepo.getResumen(empresaId);
    return rows.reduce((acc, r) => { acc[r.estado] = { total:parseInt(r.total), deuda:parseFloat(r.deuda||'0') }; return acc; }, {});
  }

  async remove(id: string, user: JwtPayload): Promise<void> {
    const c = await this.findOne(id, user.empresaId);
    if (c.estado !== EstadoContrato.BAJA_DEFINITIVA) throw new BadRequestException('Solo se eliminan contratos en BAJA_DEFINITIVA');
    await this.contratoRepo.softDelete(id, user.empresaId);
  }

  async getMorososParaCorte(graceDays: number) { return this.contratoRepo.findMorososParaCorte(graceDays); }
  async getParaReactivar() { return this.contratoRepo.findParaReactivar(); }
  async getProrrogasVencidas() { return this.contratoRepo.findProrrogasVencidas(); }
}
