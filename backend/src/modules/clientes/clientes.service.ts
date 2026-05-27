import {
  Injectable, NotFoundException, ConflictException,
  BadRequestException, Logger, ForbiddenException, HttpException,
} from '@nestjs/common';
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
  [EstadoCliente.PROSPECTO]:       [EstadoCliente.ACTIVO, EstadoCliente.BAJA_DEFINITIVA],
  [EstadoCliente.ACTIVO]:          [EstadoCliente.SUSPENDIDO, EstadoCliente.MOROSO, EstadoCliente.BAJA_TEMPORAL, EstadoCliente.BAJA_DEFINITIVA],
  [EstadoCliente.SUSPENDIDO]:      [EstadoCliente.ACTIVO, EstadoCliente.MOROSO, EstadoCliente.BAJA_DEFINITIVA],
  [EstadoCliente.MOROSO]:          [EstadoCliente.ACTIVO, EstadoCliente.SUSPENDIDO, EstadoCliente.BAJA_DEFINITIVA],
  [EstadoCliente.BAJA_TEMPORAL]:   [EstadoCliente.ACTIVO, EstadoCliente.BAJA_DEFINITIVA],
  [EstadoCliente.BAJA_DEFINITIVA]: [], // Estado terminal
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

    // Generar código de cliente automático si no se proveyó
    if (!dto.codigoCliente) {
      dto.codigoCliente = await this.generarCodigoCliente(user.empresaId);
    }

    const cliente = this.clienteRepo.create({
      ...dto,
      empresaId:  user.empresaId,
      createdBy:  user.sub,
      updatedBy:  user.sub,
      estado:     EstadoCliente.PROSPECTO,
      fechaEstado: new Date(),
    });

    const saved = await this.clienteRepo.save(cliente);

    // Registrar primer estado en el historial
    await this.clienteRepo.guardarHistorial({
      clienteId:   saved.id,
      empresaId:   user.empresaId,
      estadoNuevo: EstadoCliente.PROSPECTO,
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

    const anterior = { ...cliente };

    await this.clienteRepo.update(id, { ...dto, updatedBy: user.sub });
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

    await this.clienteRepo.update(id, {
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

  // ── Eliminar (soft delete) ────────────────────────────────
  async remove(id: string, user: JwtPayload, req?: any): Promise<void> {
    const cliente = await this.findOne(id, user.empresaId);

    if (cliente.estado !== EstadoCliente.BAJA_DEFINITIVA) {
      throw new BadRequestException(
        'Solo se puede eliminar un abonado en estado Baja Definitiva.',
      );
    }

    await this.clienteRepo.softDelete(id, user.empresaId);

    await this.auditoria.logDelete({
      empresaId:    user.empresaId,
      usuarioId:    user.sub,
      usuarioEmail: user.email,
      modulo:       'clientes',
      entidadId:    id,
      descripcion:  `Eliminación de cliente: ${cliente.nombreCompleto}`,
      req,
    });
  }

  // ── Terminar contratos al dar de baja definitiva ──────────
  private async terminarContratosCliente(clienteId: string, user: JwtPayload, motivo?: string): Promise<void> {
    const contratos = await this.contratosSvc.findByCliente(clienteId, user.empresaId);
    if (!contratos.length) return;

    const estadosTerminales = new Set<EstadoContrato>([EstadoContrato.BAJA_DEFINITIVA, EstadoContrato.MIGRADO]);
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

  async getHistorial(id: string, empresaId: string) {
    await this.findOne(id, empresaId); // verifica existencia
    return this.clienteRepo.getHistorialEstados(id);
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
    const clientes = await this.clienteRepo.findAllForExport(empresaId, filters);
    const formato = filters.formato || 'csv';

    if (formato === 'csv') {
      await this.exportarCsv(clientes, res);
    } else {
      await this.exportarXlsx(clientes, res);
    }
  }

  private async exportarCsv(clientes: Cliente[], res: Response): Promise<void> {
    const fecha = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="clientes_${fecha}.csv"`);

    // BOM para Excel en español
    res.write('\uFEFF');

    // Cabecera
    const headers = [
      'Código','Tipo Doc','Documento','Nombres','Apellido Paterno','Apellido Materno',
      'Nombre Completo','Email','Teléfono','WhatsApp','Dirección','Referencia',
      'Departamento','Provincia','Distrito','Ubigeo',
      'Latitud','Longitud','Estado','Tipo Servicio',
      'Es Empresa','RUC Empresa','Razón Social',
      'Etiquetas','Notas','Fecha Alta',
    ];
    res.write(headers.join(';') + '\r\n');

    // Filas
    for (const c of clientes) {
      const row = [
        this.escapeCsv(c.codigoCliente),
        c.tipoDocumento?.toUpperCase(),
        this.escapeCsv(c.numeroDocumento),
        this.escapeCsv(c.nombres),
        this.escapeCsv(c.apellidoPaterno),
        this.escapeCsv(c.apellidoMaterno),
        this.escapeCsv(c.nombreCompleto),
        this.escapeCsv(c.email),
        this.escapeCsv(c.telefono),
        this.escapeCsv(c.whatsapp),
        this.escapeCsv(c.direccion),
        this.escapeCsv(c.referencia),
        this.escapeCsv(c.departamento),
        this.escapeCsv(c.provincia),
        this.escapeCsv(c.distrito),
        this.escapeCsv(c.ubigeo),
        c.latitud ?? '',
        c.longitud ?? '',
        c.estado,
        c.tipoServicio,
        c.esEmpresa ? 'Sí' : 'No',
        this.escapeCsv(c.rucEmpresa),
        this.escapeCsv(c.razonSocial),
        this.escapeCsv(c.etiquetas?.join(', ')),
        this.escapeCsv(c.notasInternas),
        c.createdAt?.toISOString().split('T')[0],
      ];
      res.write(row.join(';') + '\r\n');
    }

    res.end();
  }

  private async exportarXlsx(clientes: Cliente[], res: Response): Promise<void> {
    // Importación dinámica para no cargar xlsx en toda la app
    const XLSX = await import('xlsx');
    const fecha = new Date().toISOString().split('T')[0];

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

    // Ancho de columnas
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
      suspender:      EstadoCliente.SUSPENDIDO,
      reactivar:      EstadoCliente.ACTIVO,
      baja_temporal:  EstadoCliente.BAJA_TEMPORAL,
      marcar_moroso:  EstadoCliente.MOROSO,
    };
    const nuevoEstado = estadoMap[dto.action];
    const results = await Promise.allSettled(
      dto.ids.map((id) =>
        this.cambiarEstado(id, { estado: nuevoEstado, motivo: dto.motivo }, user, false, req),
      ),
    );
    const ok     = results.filter((r) => r.status === 'fulfilled').length;
    const errors = results.filter((r) => r.status === 'rejected').length;
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
    await this.clienteRepo.update(id, { facturacionConfig: facturacion, notificacionesConfig: notificaciones });
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
        // Promover cliente de PROSPECTO → ACTIVO
        await this.clienteRepo.update(cliente.id, {
          estado: EstadoCliente.ACTIVO,
          fechaEstado: new Date(),
        } as any);
        await this.clienteRepo.guardarHistorial({
          clienteId: cliente.id,
          empresaId: user.empresaId,
          estadoAnterior: EstadoCliente.PROSPECTO,
          estadoNuevo: EstadoCliente.ACTIVO,
          motivo: `Alta con plan: ${contrato.numeroContrato}`,
          usuarioId: user.sub,
          automatico: true,
        });
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

    const clienteFinal = await this.findOne(cliente.id, user.empresaId);
    return { cliente: clienteFinal, contrato };
  }

  private async generarCodigoCliente(empresaId: string): Promise<string> {
    // Formato: CLI-YYYYMMDD-XXXX (4 dígitos aleatorios para colisiones mínimas)
    const hoy = new Date();
    const fecha = hoy.toISOString().slice(0, 10).replace(/-/g, '');
    const aleatorio = Math.floor(1000 + Math.random() * 9000);
    return `CLI-${fecha}-${aleatorio}`;
  }
}
