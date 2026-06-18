import {
  Injectable, NotFoundException, ConflictException,
  BadRequestException, InternalServerErrorException,
  Logger, ForbiddenException, HttpException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import * as sharp from 'sharp';
import * as fs from 'fs/promises';
import * as path from 'path';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { LicenciaService } from '../licencia/licencia.service';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';

import { ClienteRepository } from './repositories/cliente.repository';
import { ReniecService } from './reniec.service';
import { AuditoriaService } from '../auth/auditoria.service';
import { JwtPayload } from '../../common/decorators/current-user.decorator';

import { Cliente, EstadoCliente, TipoDocumento } from './entities/cliente.entity';
import {
  CreateClienteDto, UpdateClienteDto, FilterClienteDto,
  CambiarEstadoDto, ReniecResponseDto, ExportClientesDto, BulkActionClienteDto,
  OnboardingDto,
} from './dto/cliente.dto';
import { ContratosService } from '../contratos/contratos.service';
import { EstadoContrato } from '../contratos/entities/contrato.entity';
import { ApiResponse, PaginationDto } from '../../common/dto/response.dto';
import { formatPaginatedResponse } from '../../common/utils/pagination.util';

// ─── Transiciones de estado válidas ───────────────────────────
// Define qué estados pueden cambiar a cuáles.
// Protege la integridad del ciclo de vida del cliente.
const TRANSICIONES_VALIDAS: Record<EstadoCliente, EstadoCliente[]> = {
  [EstadoCliente.PENDIENTE_ACTIVACION]: [EstadoCliente.ACTIVO, EstadoCliente.BAJA_DEFINITIVA],
  [EstadoCliente.ACTIVO]:               [EstadoCliente.SUSPENDIDO, EstadoCliente.BAJA_DEFINITIVA],
  [EstadoCliente.SUSPENDIDO]:           [EstadoCliente.ACTIVO, EstadoCliente.BAJA_DEFINITIVA],
  [EstadoCliente.BAJA_DEFINITIVA]:      [],
};

@Injectable()
export class ClientesService {
  private readonly logger = new Logger(ClientesService.name);

  constructor(
    private readonly clienteRepo: ClienteRepository,
    private readonly reniecSvc: ReniecService,
    private readonly auditoria: AuditoriaService,
    private readonly config: ConfigService,
    private readonly licenciaSvc: LicenciaService,
    private readonly contratosSvc: ContratosService,
    private readonly events: EventEmitter2,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  // ── Crear cliente ─────────────────────────────────────────
  async create(dto: CreateClienteDto, user: JwtPayload, req?: any): Promise<Cliente> {
    // Verificar límite de clientes según plan de licencia
    await this.licenciaSvc.verificarLimiteClientes(user.empresaId).catch((e) => {
      throw new HttpException(
        { statusCode: 402, error: e.error || 'LICENSE_LIMIT', message: e.message },
        402,
      );
    });

    // Verificar duplicado de documento
    const tipoDoc = dto.tipoDocumento || TipoDocumento.DNI;
    const existe = await this.clienteRepo.existeDocumento(
      tipoDoc, dto.numeroDocumento, user.empresaId,
    );
    if (existe) {
      throw new ConflictException(
        `Ya existe un cliente con ${tipoDoc.toUpperCase()} ${dto.numeroDocumento}`,
      );
    }

    // Verificar unicidad de email y teléfono
    if (dto.email) {
      const [emailExiste] = await this.dataSource.query<any[]>(
        `SELECT id FROM clientes WHERE empresa_id = $1 AND email = $2 AND deleted_at IS NULL LIMIT 1`,
        [user.empresaId, dto.email],
      );
      if (emailExiste) throw new ConflictException(`El email ${dto.email} ya está registrado`);
    }
    if (dto.telefono) {
      const [telExiste] = await this.dataSource.query<any[]>(
        `SELECT id FROM clientes WHERE empresa_id = $1 AND telefono = $2 AND deleted_at IS NULL LIMIT 1`,
        [user.empresaId, dto.telefono],
      );
      if (telExiste) throw new ConflictException(`El teléfono ${dto.telefono} ya está registrado`);
    }

    // Generar código de cliente automático si no se proveyó
    if (!dto.codigoCliente) {
      dto.codigoCliente = await this.generarCodigoCliente(user.empresaId);
    }

    // Hash de contraseña del portal si se provee
    if (dto.passwordPortal) {
      dto.passwordPortal = await bcrypt.hash(dto.passwordPortal, 12);
    }

    const cliente = this.clienteRepo.create({
      ...dto,
      empresaId:  user.empresaId,
      createdBy:  user.sub,
      updatedBy:  user.sub,
      estado:     EstadoCliente.PENDIENTE_ACTIVACION,
      fechaEstado: new Date(),
    });

    const saved = await this.clienteRepo.save(cliente);

    // Registrar primer estado en el historial
    await this.clienteRepo.guardarHistorial({
      clienteId:   saved.id,
      empresaId:   user.empresaId,
      estadoNuevo: EstadoCliente.PENDIENTE_ACTIVACION,
      motivo:      'Alta de cliente',
      usuarioId:   user.sub,
      automatico:  false,
    });

    await this.auditoria.logCreate({
      empresaId:  user.empresaId,
      usuarioId:  user.sub,
      usuarioEmail: user.email,
      modulo:     'clientes',
      entidadId:  saved.id,
      descripcion: `Alta de cliente: ${saved.nombreCompleto} (${tipoDoc} ${dto.numeroDocumento})`,
      req,
    });

    // Emitir bienvenida si el cliente tiene WhatsApp configurado
    this.emitirBienvenidaSiAplica(saved, user.empresaId);

    this.logger.log(`Cliente creado: ${saved.id} | ${saved.nombreCompleto} | empresa: ${user.empresaId}`);
    return saved;
  }

  // ── Listar con filtros y paginación ───────────────────────
  async findAll(empresaId: string, filters: FilterClienteDto) {
    const result = await this.clienteRepo.findAllPaginated(empresaId, filters);
    return formatPaginatedResponse(result);
  }

  // ── Obtener uno por ID ────────────────────────────────────
  async findOne(id: string, empresaId: string): Promise<Cliente> {
    const cliente = await this.clienteRepo.findById(id, empresaId);
    if (!cliente) {
      throw new NotFoundException(`Cliente ${id} no encontrado`);
    }
    return cliente;
  }

  // ── Actualizar ────────────────────────────────────────────
  async update(
    id: string,
    dto: UpdateClienteDto,
    user: JwtPayload,
    req?: any,
  ): Promise<Cliente> {
    const cliente = await this.findOne(id, user.empresaId);

    if (dto.version !== undefined && cliente.version !== dto.version) {
      throw new ConflictException({
        code: 'CONCURRENCY_CONFLICT',
        message: 'Los datos fueron modificados por otro usuario. Por favor, recargue la página e intente nuevamente.',
      });
    }

    // Si cambia el documento, verificar duplicado
    if (dto.numeroDocumento && dto.numeroDocumento !== cliente.numeroDocumento) {
      const tipo = dto.tipoDocumento || cliente.tipoDocumento;
      const existe = await this.clienteRepo.existeDocumento(
        tipo, dto.numeroDocumento, user.empresaId, id,
      );
      if (existe) {
        throw new ConflictException(`Documento ${dto.numeroDocumento} ya está registrado`);
      }
    }

    // Verificar unicidad de email y teléfono al actualizar
    if (dto.email && dto.email !== cliente.email) {
      const [emailExiste] = await this.dataSource.query<any[]>(
        `SELECT id FROM clientes WHERE empresa_id = $1 AND email = $2 AND deleted_at IS NULL AND id != $3 LIMIT 1`,
        [user.empresaId, dto.email, id],
      );
      if (emailExiste) throw new ConflictException(`El email ${dto.email} ya está registrado`);
    }
    if (dto.telefono && dto.telefono !== (cliente as any).telefono) {
      const [telExiste] = await this.dataSource.query<any[]>(
        `SELECT id FROM clientes WHERE empresa_id = $1 AND telefono = $2 AND deleted_at IS NULL AND id != $3 LIMIT 1`,
        [user.empresaId, dto.telefono, id],
      );
      if (telExiste) throw new ConflictException(`El teléfono ${dto.telefono} ya está registrado`);
    }

    const anterior = { ...cliente };

    const { version: _v, ...camposCliente } = dto;

    // Hash de nueva contraseña de portal si se está actualizando
    if (camposCliente.passwordPortal) {
      camposCliente.passwordPortal = await bcrypt.hash(camposCliente.passwordPortal, 12);
    }

    await this.clienteRepo.update(id, user.empresaId, { ...camposCliente, updatedBy: user.sub });
    const actualizado = await this.findOne(id, user.empresaId);

    await this.auditoria.logUpdate({
      empresaId:    user.empresaId,
      usuarioId:    user.sub,
      usuarioEmail: user.email,
      modulo:       'clientes',
      entidadId:    id,
      descripcion:  `Actualización de datos: ${actualizado.nombreCompleto}`,
      datosAnteriores: { nombre: anterior.nombreCompleto, email: anterior.email },
      datosNuevos:     { nombre: actualizado.nombreCompleto, email: actualizado.email },
      req,
    });

    return actualizado;
  }

  // ── Cambiar estado (máquina de estados) ───────────────────
  async cambiarEstado(
    id: string,
    dto: CambiarEstadoDto,
    user: JwtPayload,
    automatico = false,
    req?: any,
  ): Promise<Cliente> {
    const cliente = await this.findOne(id, user.empresaId);

    // Verificar que la transición es válida
    if (!automatico) {
      const transicionesPermitidas = TRANSICIONES_VALIDAS[cliente.estado] || [];
      if (!transicionesPermitidas.includes(dto.estado)) {
        throw new BadRequestException(
          `No se puede cambiar de ${cliente.estado} a ${dto.estado}. ` +
          `Transiciones permitidas: ${transicionesPermitidas.join(', ') || 'ninguna'}`,
        );
      }
    }

    const estadoAnterior = cliente.estado;

    // Cascada: al dar de baja definitiva, terminar y limpiar todos los contratos activos
    if (dto.estado === EstadoCliente.BAJA_DEFINITIVA) {
      await this.terminarContratosCliente(id, user, dto.motivo);
    }

    await this.clienteRepo.update(id, user.empresaId, {
      estado:      dto.estado,
      fechaEstado: new Date(),
      motivoEstado: dto.motivo,
      updatedBy:   user.sub,
    });

    // Guardar en historial
    await this.clienteRepo.guardarHistorial({
      clienteId:     id,
      empresaId:     user.empresaId,
      estadoAnterior,
      estadoNuevo:   dto.estado,
      motivo:        dto.motivo,
      usuarioId:     user.sub,
      automatico,
    });

    await this.auditoria.logUpdate({
      empresaId:    user.empresaId,
      usuarioId:    user.sub,
      usuarioEmail: user.email,
      modulo:       'clientes',
      entidadId:    id,
      descripcion:  `Estado: ${estadoAnterior} → ${dto.estado}${dto.motivo ? ` | ${dto.motivo}` : ''}`,
      req,
    });

    this.logger.log(
      `Estado cliente ${id}: ${estadoAnterior} → ${dto.estado} | ${automatico ? 'automático' : user.email}`,
    );

    return this.findOne(id, user.empresaId);
  }

  // ── Eliminar definitivamente (hard delete) ───────────────
  // Solo ejecutable si el cliente está en BAJA_DEFINITIVA.
  // Limpia todos los datos relacionados en orden para respetar FK constraints:
  //   ordenes_trabajo → tickets (+comentarios CASCADE) → pagos → facturas
  //   → contratos (+historial/consumo CASCADE) → cliente (+historial_estados CASCADE)
  // Las llamadas de red (MikroTik / antena) van ANTES de la transacción DB
  // para no mezclar I/O de red con la atomicidad de la transacción.
  async remove(id: string, user: JwtPayload, req?: any): Promise<void> {
    const cliente = await this.findOne(id, user.empresaId);

    if (cliente.estado !== EstadoCliente.BAJA_DEFINITIVA) {
      throw new BadRequestException(
        'Solo se puede eliminar un abonado en estado Baja Definitiva.',
      );
    }

    // ── Hard delete en transacción atómica ────────────────
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      // 1. Órdenes de trabajo (RESTRICT → clientes, SET NULL → tickets/contratos)
      await qr.query(
        `DELETE FROM ordenes_trabajo WHERE cliente_id = $1`,
        [id],
      );

      // 2. Tickets (RESTRICT → clientes; tickets_comentarios se borra en CASCADE)
      await qr.query(
        `DELETE FROM tickets WHERE cliente_id = $1`,
        [id],
      );

      // 3. Pagos (RESTRICT → clientes; factura_id/contrato_id son SET NULL — no bloquean)
      await qr.query(
        `DELETE FROM pagos WHERE cliente_id = $1`,
        [id],
      );

      // 4. Facturas (RESTRICT → clientes; factura_original_id/contrato_id SET NULL)
      await qr.query(
        `DELETE FROM facturas WHERE cliente_id = $1`,
        [id],
      );

      // 5. Contratos (RESTRICT → clientes)
      //    contratos_historial y consumo_datos se borran en CASCADE.
      //    ips_asignadas.contrato_id queda en SET NULL (no bloquea).
      //    notificaciones_logs.contrato_id queda en SET NULL.
      await qr.query(
        `DELETE FROM contratos WHERE cliente_id = $1`,
        [id],
      );

      // 6. Sincronización Google Contacts (varchar, no hay FK formal)
      await qr.query(
        `DELETE FROM google_client_contacts WHERE cliente_id = $1`,
        [id],
      );

      // 7. Limpiar auto-referencia referido_por antes del DELETE
      await qr.query(
        `UPDATE clientes SET referido_por = NULL WHERE referido_por = $1`,
        [id],
      );

      // 8. Eliminar el cliente
      //    clientes_historial_estados se borra en CASCADE.
      //    notificaciones.cliente_id queda en SET NULL automáticamente.
      await qr.query(
        `DELETE FROM clientes WHERE id = $1 AND empresa_id = $2`,
        [id, user.empresaId],
      );

      await qr.commitTransaction();
    } catch (err) {
      await qr.rollbackTransaction();
      this.logger.error(`Hard-delete cliente ${id} (${cliente.nombreCompleto}): ${err?.message}`);
      throw new InternalServerErrorException(
        'No se pudo eliminar el abonado. La operación fue revertida completamente.',
      );
    } finally {
      await qr.release();
    }

    await this.auditoria.logDelete({
      empresaId:    user.empresaId,
      usuarioId:    user.sub,
      usuarioEmail: user.email,
      modulo:       'clientes',
      entidadId:    id,
      descripcion:  `Eliminación definitiva: ${cliente.nombreCompleto} | DNI/Doc: ${cliente.numeroDocumento}`,
      req,
    });
  }

  // ── Terminar contratos al dar de baja definitiva ──────────
  private async terminarContratosCliente(clienteId: string, user: JwtPayload, motivo?: string): Promise<void> {
    const contratos = await this.contratosSvc.findByCliente(clienteId, user.empresaId);
    if (!contratos.length) return;

    const estadosTerminales = new Set<EstadoContrato>([EstadoContrato.BAJA_DEFINITIVA]);
    const motivoBaja = `Baja definitiva de cliente${motivo ? `: ${motivo}` : ''}`;

    for (const contrato of contratos) {
      try {
        if (!estadosTerminales.has(contrato.estado)) {
          // Transición a BAJA_DEFINITIVA → libera IP automáticamente dentro del servicio
          await this.contratosSvc.cambiarEstado(
            contrato.id,
            { estado: EstadoContrato.BAJA_DEFINITIVA, motivo: motivoBaja },
            user,
            true, // automatico = true, omite validación de transiciones
          );
        }
        // Soft-delete para que desaparezca de la pestaña Servicios
        await this.contratosSvc.remove(contrato.id, user);
      } catch (err) {
        this.logger.error(`Error terminando contrato ${contrato.id} en baja de cliente ${clienteId}: ${err.message}`);
      }
    }

    this.logger.log(`Baja definitiva cliente ${clienteId}: ${contratos.length} contrato(s) terminado(s)`);
  }

  // ── Historial de estados ──────────────────────────────────
  async getContratos(id: string, empresaId: string) {
    await this.findOne(id, empresaId);
    return this.contratosSvc.findByClienteCompleto(id, empresaId);
  }

  async getHistorial(id: string, empresaId: string, limit = 50, offset = 0) {
    await this.findOne(id, empresaId); // verifica existencia
    return this.clienteRepo.getHistorialEstados(id, limit, offset);
  }

  // ── Resumen / estadísticas ────────────────────────────────
  async getResumen(empresaId: string) {
    const [estados, estadisticas] = await Promise.all([
      this.clienteRepo.getResumenEstados(empresaId),
      this.clienteRepo.getEstadisticas(empresaId),
    ]);
    return { estados, ...estadisticas };
  }

  // ── Clientes en mapa ──────────────────────────────────────
  async getMapa(empresaId: string) {
    return this.clienteRepo.findConUbicacion(empresaId);
  }

  // ── Consultar RENIEC ──────────────────────────────────────
  async consultarReniec(dni: string): Promise<ReniecResponseDto> {
    return this.reniecSvc.consultarDni(dni);
  }

  // ── Exportar CSV / XLSX ───────────────────────────────────
  async exportar(
    empresaId: string,
    filters: ExportClientesDto,
    res: Response,
  ): Promise<void> {
    const formato = filters.formato || 'csv';
    if (formato === 'csv') {
      await this.exportarCsvStream(empresaId, filters, res);
    } else {
      await this.exportarXlsx(empresaId, filters, res);
    }
  }

  private async exportarCsvStream(
    empresaId: string,
    filters: ExportClientesDto,
    res: Response,
  ): Promise<void> {
    const fecha = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="clientes_${fecha}.csv"`);
    res.write('﻿'); // BOM para Excel en español
    const headers = [
      'Código','Tipo Doc','Documento','Nombres','Apellido Paterno','Apellido Materno',
      'Nombre Completo','Email','Teléfono','WhatsApp','Dirección','Referencia',
      'Departamento','Provincia','Distrito','Ubigeo',
      'Latitud','Longitud','Estado','Tipo Servicio',
      'Es Empresa','RUC Empresa','Razón Social',
      'Etiquetas','Notas','Fecha Alta',
    ];
    res.write(headers.join(';') + '\r\n');
    const stream = await this.clienteRepo.getExportStream(empresaId, filters);
    await new Promise<void>((resolve, reject) => {
      stream.on('data', (raw: any) => {
        const row = [
          this.escapeCsv(raw.c_codigo_cliente),
          (raw.c_tipo_documento ?? '').toUpperCase(),
          this.escapeCsv(raw.c_numero_documento),
          this.escapeCsv(raw.c_nombres),
          this.escapeCsv(raw.c_apellido_paterno),
          this.escapeCsv(raw.c_apellido_materno),
          this.escapeCsv(raw.c_nombre_completo),
          this.escapeCsv(raw.c_email),
          this.escapeCsv(raw.c_telefono),
          this.escapeCsv(raw.c_whatsapp),
          this.escapeCsv(raw.c_direccion),
          this.escapeCsv(raw.c_referencia),
          this.escapeCsv(raw.c_departamento),
          this.escapeCsv(raw.c_provincia),
          this.escapeCsv(raw.c_distrito),
          this.escapeCsv(raw.c_ubigeo),
          raw.c_latitud ?? '',
          raw.c_longitud ?? '',
          raw.c_estado ?? '',
          raw.c_tipo_servicio ?? '',
          raw.c_es_empresa ? 'Sí' : 'No',
          this.escapeCsv(raw.c_ruc_empresa),
          this.escapeCsv(raw.c_razon_social),
          this.escapeCsv(raw.c_etiquetas ? raw.c_etiquetas.join(', ') : ''),
          this.escapeCsv(raw.c_notas_internas),
          raw.c_created_at ? new Date(raw.c_created_at).toISOString().split('T')[0] : '',
        ];
        res.write(row.join(';') + '\r\n');
      });
      stream.on('end', resolve);
      stream.on('error', reject);
    });
    res.end();
  }

  private async exportarXlsx(
    empresaId: string,
    filters: ExportClientesDto,
    res: Response,
  ): Promise<void> {
    const XLSX = await import('xlsx');
    const fecha = new Date().toISOString().split('T')[0];
    const qb = this.clienteRepo.buildFilterQuery(empresaId, filters);
    const clientes = await qb.orderBy('c.nombre_completo', 'ASC').take(5000).getMany();
    const data = clientes.map((c) => ({
      'Código':          c.codigoCliente,
      'Tipo Documento':  c.tipoDocumento?.toUpperCase(),
      'Documento':       c.numeroDocumento,
      'Nombre Completo': c.nombreCompleto,
      'Email':           c.email,
      'Teléfono':        c.telefono,
      'WhatsApp':        c.whatsapp,
      'Dirección':       c.direccion,
      'Distrito':        c.distrito,
      'Provincia':       c.provincia,
      'Departamento':    c.departamento,
      'Latitud':         c.latitud,
      'Longitud':        c.longitud,
      'Estado':          c.estado,
      'Tipo Servicio':   c.tipoServicio,
      'Es Empresa':      c.esEmpresa ? 'Sí' : 'No',
      'RUC':             c.rucEmpresa,
      'Razón Social':    c.razonSocial,
      'Etiquetas':       c.etiquetas?.join(', '),
      'Fecha Alta':      c.createdAt?.toISOString().split('T')[0],
    }));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = [
      { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 35 },
      { wch: 25 }, { wch: 15 }, { wch: 15 }, { wch: 40 },
      { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 12 },
      { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 8 },
      { wch: 15 }, { wch: 30 }, { wch: 20 }, { wch: 12 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, 'Clientes');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="clientes_${fecha}.xlsx"`);
    res.send(buf);
  }

  private escapeCsv(value?: string | null): string {
    if (value == null) return '';
    const str = String(value);
    if (str.includes(';') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  async bulkAction(
    dto: BulkActionClienteDto,
    user: JwtPayload,
    req?: any,
  ): Promise<{ ok: number; errors: number; total: number }> {
    const estadoMap: Record<string, EstadoCliente> = {
      suspender:  EstadoCliente.SUSPENDIDO,
      reactivar:  EstadoCliente.ACTIVO,
    };
    const nuevoEstado = estadoMap[dto.action];
    const CHUNK = 20;
    let ok = 0, errors = 0;

    for (let i = 0; i < dto.ids.length; i += CHUNK) {
      const chunk = dto.ids.slice(i, i + CHUNK);
      const settled = await Promise.allSettled(
        chunk.map((id) =>
          this.cambiarEstado(id, { estado: nuevoEstado, motivo: dto.motivo }, user, false, req),
        ),
      );
      ok     += settled.filter((r) => r.status === 'fulfilled').length;
      errors += settled.filter((r) => r.status === 'rejected').length;
    }
    return { ok, errors, total: dto.ids.length };
  }

  async getFacturacionConfig(id: string, empresaId: string) {
    const c = await this.clienteRepo.findById(id, empresaId);
    if (!c) throw new NotFoundException('Cliente no encontrado');
    return { facturacion: c.facturacionConfig ?? null, notificaciones: c.notificacionesConfig ?? null };
  }

  async saveFacturacionConfig(
    id: string,
    empresaId: string,
    facturacion: Record<string, any>,
    notificaciones: Record<string, any>,
  ) {
    const c = await this.clienteRepo.findById(id, empresaId);
    if (!c) throw new NotFoundException('Cliente no encontrado');
    await this.clienteRepo.update(id, empresaId, { facturacionConfig: facturacion, notificacionesConfig: notificaciones });
    return { facturacion, notificaciones };
  }

  // ── Onboarding unificado (wizard) ─────────────────────────
  async onboarding(dto: OnboardingDto, user: JwtPayload, req?: any) {
    const cliente = await this.create(dto.cliente, user, req);

    let contrato: any = null;
    if (dto.contrato?.planId) {
      try {
        contrato = await this.contratosSvc.create(
          {
            clienteId: cliente.id,
            ...dto.contrato,
            fechaInicio: dto.contrato.fechaInicio || new Date().toISOString().split('T')[0],
          } as any,
          user,
          req,
        );
        // El cliente permanece en PENDIENTE_ACTIVACION hasta que el técnico active el servicio
      } catch (err: any) {
        this.logger.error(`onboarding: contrato fallido para ${cliente.id}: ${err.message}`);
        // Si el contrato ya fue creado, terminarlo primero para que libere la IP
        if (contrato?.id) {
          await this.contratosSvc.cambiarEstado(
            contrato.id,
            { estado: EstadoContrato.BAJA_DEFINITIVA, motivo: 'Rollback de onboarding' },
            user,
            true,
          ).catch(e => this.logger.error(`onboarding rollback ip: ${e?.message}`));
        }
        await this.clienteRepo.softDelete(cliente.id, user.empresaId).catch(() => {});
        throw err;
      }
    }

    if (dto.facturacion || dto.notificaciones) {
      await this.saveFacturacionConfig(
        cliente.id, user.empresaId,
        dto.facturacion ?? {}, dto.notificaciones ?? {},
      ).catch((err) => this.logger.error(`onboarding: facturacion config save failed for ${cliente.id}: ${err?.message}`));
    }

    // Sincronizar tipo_servicio del cliente según el contrato recién creado
    if (contrato) {
      await this.dataSource
        .query(`SELECT recalc_tipo_servicio_cliente($1)`, [cliente.id])
        .catch((e) => this.logger.error(`onboarding: recalc tipo_servicio failed: ${e?.message}`));
    }

    // Emitir bienvenida si el cliente tiene WhatsApp
    this.emitirBienvenidaSiAplica(cliente, user.empresaId);

    const clienteFinal = await this.findOne(cliente.id, user.empresaId);
    return { cliente: clienteFinal, contrato };
  }

  private emitirBienvenidaSiAplica(cliente: Cliente, empresaId: string): void {
    const tel = cliente.whatsapp || cliente.telefono;
    if (!tel) return;

    const nombreCompleto = cliente.nombreCompleto || `${cliente.nombres ?? ''} ${cliente.apellidoPaterno ?? ''}`.trim();
    if (!nombreCompleto) return;

    this.events.emit('notification.bienvenida', {
      telefono:        tel,
      clienteNombre:   nombreCompleto,
      planNombre:      'Plan registrado',
      velocidadBajada: '--',
      velocidadSubida: '--',
      usuarioPppoe:    '--',
      empresaId,
      clienteId:       cliente.id,
    });
  }

  // ── Procesar y guardar foto del cliente ──────────────────────
  async procesarFoto(
    clienteId: string,
    file: Express.Multer.File,
    empresaId: string,
  ): Promise<string> {
    const uploadDir = this.config.get<string>('app.uploadDir') || '/app/uploads';
    const dir = path.join(uploadDir, 'clientes', empresaId);
    await fs.mkdir(dir, { recursive: true });

    // Eliminar foto anterior si existe
    const clienteActual = await this.clienteRepo.findById(clienteId, empresaId);
    if (clienteActual?.fotoUrl) {
      const oldPath = path.join(uploadDir, clienteActual.fotoUrl.replace('/uploads/', ''));
      await fs.unlink(oldPath).catch(() => {}); // ignorar si ya no existe
    }

    const filename = `${clienteId}_${Date.now()}.webp`;
    const filepath = path.join(dir, filename);

    await (sharp as any)(file.buffer)
      .resize(400, 400, { fit: 'cover', position: 'centre' })
      .webp({ quality: 85 })
      .toFile(filepath);

    return `/uploads/clientes/${empresaId}/${filename}`;
  }

  private async generarCodigoCliente(empresaId: string): Promise<string> {
    // Secuencia atómica: usa un contador de BD para evitar colisiones en concurrencia.
    // nextval garantiza que dos transacciones simultáneas nunca obtengan el mismo número.
    const seqName = `seq_cod_cli_${empresaId.replace(/-/g, '_')}`;
    const fecha = new Date().toISOString().slice(0, 10).replace(/-/g, '');

    await this.dataSource.query(
      `CREATE SEQUENCE IF NOT EXISTS "${seqName}" START 1 INCREMENT 1`,
    );
    const [{ nextval }] = await this.dataSource.query<{ nextval: string }[]>(
      `SELECT nextval('${seqName}')`,
    );
    return `CLI-${fecha}-${String(parseInt(nextval, 10)).padStart(4, '0')}`;
  }
}
