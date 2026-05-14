"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var ClientesService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClientesService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const cliente_repository_1 = require("./repositories/cliente.repository");
const reniec_service_1 = require("./reniec.service");
const auditoria_service_1 = require("../auth/auditoria.service");
const cliente_entity_1 = require("./entities/cliente.entity");
const pagination_util_1 = require("../../common/utils/pagination.util");
const TRANSICIONES_VALIDAS = {
    [cliente_entity_1.EstadoCliente.PROSPECTO]: [cliente_entity_1.EstadoCliente.ACTIVO, cliente_entity_1.EstadoCliente.BAJA_DEFINITIVA],
    [cliente_entity_1.EstadoCliente.ACTIVO]: [cliente_entity_1.EstadoCliente.SUSPENDIDO, cliente_entity_1.EstadoCliente.MOROSO, cliente_entity_1.EstadoCliente.BAJA_TEMPORAL, cliente_entity_1.EstadoCliente.BAJA_DEFINITIVA],
    [cliente_entity_1.EstadoCliente.SUSPENDIDO]: [cliente_entity_1.EstadoCliente.ACTIVO, cliente_entity_1.EstadoCliente.MOROSO, cliente_entity_1.EstadoCliente.BAJA_DEFINITIVA],
    [cliente_entity_1.EstadoCliente.MOROSO]: [cliente_entity_1.EstadoCliente.ACTIVO, cliente_entity_1.EstadoCliente.SUSPENDIDO, cliente_entity_1.EstadoCliente.BAJA_DEFINITIVA],
    [cliente_entity_1.EstadoCliente.BAJA_TEMPORAL]: [cliente_entity_1.EstadoCliente.ACTIVO, cliente_entity_1.EstadoCliente.BAJA_DEFINITIVA],
    [cliente_entity_1.EstadoCliente.BAJA_DEFINITIVA]: [],
};
let ClientesService = ClientesService_1 = class ClientesService {
    constructor(clienteRepo, reniecSvc, auditoria, config) {
        this.clienteRepo = clienteRepo;
        this.reniecSvc = reniecSvc;
        this.auditoria = auditoria;
        this.config = config;
        this.logger = new common_1.Logger(ClientesService_1.name);
    }
    async create(dto, user, req) {
        const tipoDoc = dto.tipoDocumento || cliente_entity_1.TipoDocumento.DNI;
        const existe = await this.clienteRepo.existeDocumento(tipoDoc, dto.numeroDocumento, user.empresaId);
        if (existe) {
            throw new common_1.ConflictException(`Ya existe un cliente con ${tipoDoc.toUpperCase()} ${dto.numeroDocumento}`);
        }
        if (!dto.codigoCliente) {
            dto.codigoCliente = await this.generarCodigoCliente(user.empresaId);
        }
        const cliente = this.clienteRepo.create({
            ...dto,
            empresaId: user.empresaId,
            createdBy: user.sub,
            updatedBy: user.sub,
            estado: cliente_entity_1.EstadoCliente.PROSPECTO,
            fechaEstado: new Date(),
        });
        const saved = await this.clienteRepo.save(cliente);
        await this.clienteRepo.guardarHistorial({
            clienteId: saved.id,
            empresaId: user.empresaId,
            estadoNuevo: cliente_entity_1.EstadoCliente.PROSPECTO,
            motivo: 'Alta de cliente',
            usuarioId: user.sub,
            automatico: false,
        });
        await this.auditoria.logCreate({
            empresaId: user.empresaId,
            usuarioId: user.sub,
            usuarioEmail: user.email,
            modulo: 'clientes',
            entidadId: saved.id,
            descripcion: `Alta de cliente: ${saved.nombreCompleto} (${tipoDoc} ${dto.numeroDocumento})`,
            req,
        });
        this.logger.log(`Cliente creado: ${saved.id} | ${saved.nombreCompleto} | empresa: ${user.empresaId}`);
        return saved;
    }
    async findAll(empresaId, filters) {
        const result = await this.clienteRepo.findAllPaginated(empresaId, filters);
        return (0, pagination_util_1.formatPaginatedResponse)(result);
    }
    async findOne(id, empresaId) {
        const cliente = await this.clienteRepo.findById(id, empresaId);
        if (!cliente) {
            throw new common_1.NotFoundException(`Cliente ${id} no encontrado`);
        }
        return cliente;
    }
    async update(id, dto, user, req) {
        const cliente = await this.findOne(id, user.empresaId);
        if (dto.numeroDocumento && dto.numeroDocumento !== cliente.numeroDocumento) {
            const tipo = dto.tipoDocumento || cliente.tipoDocumento;
            const existe = await this.clienteRepo.existeDocumento(tipo, dto.numeroDocumento, user.empresaId, id);
            if (existe) {
                throw new common_1.ConflictException(`Documento ${dto.numeroDocumento} ya está registrado`);
            }
        }
        const anterior = { ...cliente };
        await this.clienteRepo.update(id, { ...dto, updatedBy: user.sub });
        const actualizado = await this.findOne(id, user.empresaId);
        await this.auditoria.logUpdate({
            empresaId: user.empresaId,
            usuarioId: user.sub,
            usuarioEmail: user.email,
            modulo: 'clientes',
            entidadId: id,
            descripcion: `Actualización de datos: ${actualizado.nombreCompleto}`,
            datosAnteriores: { nombre: anterior.nombreCompleto, email: anterior.email },
            datosNuevos: { nombre: actualizado.nombreCompleto, email: actualizado.email },
            req,
        });
        return actualizado;
    }
    async cambiarEstado(id, dto, user, automatico = false, req) {
        const cliente = await this.findOne(id, user.empresaId);
        if (!automatico) {
            const transicionesPermitidas = TRANSICIONES_VALIDAS[cliente.estado] || [];
            if (!transicionesPermitidas.includes(dto.estado)) {
                throw new common_1.BadRequestException(`No se puede cambiar de ${cliente.estado} a ${dto.estado}. ` +
                    `Transiciones permitidas: ${transicionesPermitidas.join(', ') || 'ninguna'}`);
            }
        }
        const estadoAnterior = cliente.estado;
        await this.clienteRepo.update(id, {
            estado: dto.estado,
            fechaEstado: new Date(),
            motivoEstado: dto.motivo,
            updatedBy: user.sub,
        });
        await this.clienteRepo.guardarHistorial({
            clienteId: id,
            empresaId: user.empresaId,
            estadoAnterior,
            estadoNuevo: dto.estado,
            motivo: dto.motivo,
            usuarioId: user.sub,
            automatico,
        });
        await this.auditoria.logUpdate({
            empresaId: user.empresaId,
            usuarioId: user.sub,
            usuarioEmail: user.email,
            modulo: 'clientes',
            entidadId: id,
            descripcion: `Estado: ${estadoAnterior} → ${dto.estado}${dto.motivo ? ` | ${dto.motivo}` : ''}`,
            req,
        });
        this.logger.log(`Estado cliente ${id}: ${estadoAnterior} → ${dto.estado} | ${automatico ? 'automático' : user.email}`);
        return this.findOne(id, user.empresaId);
    }
    async remove(id, user, req) {
        const cliente = await this.findOne(id, user.empresaId);
        if (cliente.estado === cliente_entity_1.EstadoCliente.ACTIVO) {
            throw new common_1.BadRequestException('No se puede eliminar un cliente activo. Primero da de baja el servicio.');
        }
        await this.clienteRepo.softDelete(id, user.empresaId);
        await this.auditoria.logDelete({
            empresaId: user.empresaId,
            usuarioId: user.sub,
            usuarioEmail: user.email,
            modulo: 'clientes',
            entidadId: id,
            descripcion: `Eliminación de cliente: ${cliente.nombreCompleto}`,
            req,
        });
    }
    async getHistorial(id, empresaId) {
        await this.findOne(id, empresaId);
        return this.clienteRepo.getHistorialEstados(id);
    }
    async getResumen(empresaId) {
        const [estados, estadisticas] = await Promise.all([
            this.clienteRepo.getResumenEstados(empresaId),
            this.clienteRepo.getEstadisticas(empresaId),
        ]);
        return { estados, ...estadisticas };
    }
    async getMapa(empresaId) {
        return this.clienteRepo.findConUbicacion(empresaId);
    }
    async consultarReniec(dni) {
        return this.reniecSvc.consultarDni(dni);
    }
    async exportar(empresaId, filters, res) {
        const clientes = await this.clienteRepo.findAllForExport(empresaId, filters);
        const formato = filters.formato || 'csv';
        if (formato === 'csv') {
            await this.exportarCsv(clientes, res);
        }
        else {
            await this.exportarXlsx(clientes, res);
        }
    }
    async exportarCsv(clientes, res) {
        const fecha = new Date().toISOString().split('T')[0];
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="clientes_${fecha}.csv"`);
        res.write('\uFEFF');
        const headers = [
            'Código', 'Tipo Doc', 'Documento', 'Nombres', 'Apellido Paterno', 'Apellido Materno',
            'Nombre Completo', 'Email', 'Teléfono', 'WhatsApp', 'Dirección', 'Referencia',
            'Departamento', 'Provincia', 'Distrito', 'Ubigeo',
            'Latitud', 'Longitud', 'Estado', 'Tipo Servicio',
            'Es Empresa', 'RUC Empresa', 'Razón Social',
            'Etiquetas', 'Notas', 'Fecha Alta',
        ];
        res.write(headers.join(';') + '\r\n');
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
    async exportarXlsx(clientes, res) {
        const XLSX = await Promise.resolve().then(() => require('xlsx'));
        const fecha = new Date().toISOString().split('T')[0];
        const data = clientes.map((c) => ({
            'Código': c.codigoCliente,
            'Tipo Documento': c.tipoDocumento?.toUpperCase(),
            'Documento': c.numeroDocumento,
            'Nombre Completo': c.nombreCompleto,
            'Email': c.email,
            'Teléfono': c.telefono,
            'WhatsApp': c.whatsapp,
            'Dirección': c.direccion,
            'Distrito': c.distrito,
            'Provincia': c.provincia,
            'Departamento': c.departamento,
            'Latitud': c.latitud,
            'Longitud': c.longitud,
            'Estado': c.estado,
            'Tipo Servicio': c.tipoServicio,
            'Es Empresa': c.esEmpresa ? 'Sí' : 'No',
            'RUC': c.rucEmpresa,
            'Razón Social': c.razonSocial,
            'Etiquetas': c.etiquetas?.join(', '),
            'Fecha Alta': c.createdAt?.toISOString().split('T')[0],
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
    escapeCsv(value) {
        if (value == null)
            return '';
        const str = String(value);
        if (str.includes(';') || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
    }
    async generarCodigoCliente(empresaId) {
        const hoy = new Date();
        const fecha = hoy.toISOString().slice(0, 10).replace(/-/g, '');
        const aleatorio = Math.floor(1000 + Math.random() * 9000);
        return `CLI-${fecha}-${aleatorio}`;
    }
};
exports.ClientesService = ClientesService;
exports.ClientesService = ClientesService = ClientesService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [cliente_repository_1.ClienteRepository,
        reniec_service_1.ReniecService,
        auditoria_service_1.AuditoriaService,
        config_1.ConfigService])
], ClientesService);
//# sourceMappingURL=clientes.service.js.map