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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var SmartoltService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SmartoltService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const smartolt_api_service_1 = require("./smartolt-api.service");
const onu_repository_1 = require("./repositories/onu.repository");
const auditoria_service_1 = require("../auth/auditoria.service");
const onu_entity_1 = require("./entities/onu.entity");
const encryption_util_1 = require("../../common/utils/encryption.util");
const pagination_util_1 = require("../../common/utils/pagination.util");
let SmartoltService = SmartoltService_1 = class SmartoltService {
    constructor(api, onuRepo, auditoria, ds) {
        this.api = api;
        this.onuRepo = onuRepo;
        this.auditoria = auditoria;
        this.ds = ds;
        this.logger = new common_1.Logger(SmartoltService_1.name);
    }
    async crearOlt(dto, user) {
        let passwordCifrado;
        if (dto.password) {
            try {
                passwordCifrado = (0, encryption_util_1.encrypt)(dto.password);
            }
            catch {
                passwordCifrado = dto.password;
            }
        }
        const olt = await this.onuRepo.saveOlt({
            ...dto,
            passwordCifrado,
            empresaId: user.empresaId,
        });
        this.logger.log(`OLT creada: ${dto.nombre} | empresa: ${user.empresaId}`);
        return olt;
    }
    async findAllOlts(empresaId) {
        return this.onuRepo.findAllOlts(empresaId);
    }
    async findOneOlt(id, empresaId) {
        const olt = await this.onuRepo.findOltById(id, empresaId);
        if (!olt)
            throw new common_1.NotFoundException(`OLT ${id} no encontrada`);
        return olt;
    }
    async updateOlt(id, dto, user) {
        await this.findOneOlt(id, user.empresaId);
        const updates = { ...dto };
        if (dto.password) {
            try {
                updates.passwordCifrado = (0, encryption_util_1.encrypt)(dto.password);
            }
            catch {
                updates.passwordCifrado = dto.password;
            }
            delete updates.password;
        }
        await this.onuRepo.updateOlt(id, updates);
        return this.findOneOlt(id, user.empresaId);
    }
    async sincronizarOltsDesdeSmartolt(user) {
        const oltsRemototos = await this.api.listarOlts();
        let sincronizados = 0;
        for (const remote of oltsRemototos) {
            const existente = await this.ds.query('SELECT id FROM olts WHERE empresa_id = $1 AND smartolt_id = $2 AND deleted_at IS NULL', [user.empresaId, remote.id]);
            if (!existente.length) {
                await this.onuRepo.saveOlt({
                    empresaId: user.empresaId,
                    nombre: remote.name,
                    smartoltId: remote.id,
                    ipGestion: remote.ip,
                    modelo: remote.model,
                    totalPonPorts: remote.pon_ports,
                    activo: true,
                });
                sincronizados++;
            }
            else {
                await this.onuRepo.updateOlt(existente[0].id, {
                    totalPonPorts: remote.pon_ports,
                    onusActivas: remote.onu_count,
                });
            }
        }
        this.logger.log(`OLTs sincronizados desde SmartOLT: ${sincronizados} nuevos`);
        return { sincronizados };
    }
    async listarNoAprovisionadas(empresaId, oltId) {
        let smartoltId;
        if (oltId) {
            const olt = await this.findOneOlt(oltId, empresaId);
            smartoltId = olt.smartoltId;
        }
        const [desdeSmartolt, local] = await Promise.all([
            this.api.listarOnusNoAprovisionadas(smartoltId).catch(() => []),
            this.onuRepo.findSinAprovisionar(empresaId, oltId),
        ]);
        return { smartolt: desdeSmartolt, local };
    }
    async aprovisionarOnu(dto, user, req) {
        const olt = await this.findOneOlt(dto.oltId, user.empresaId);
        const existente = await this.onuRepo.findBySerial(dto.serialNumber, user.empresaId);
        if (existente && existente.estado !== onu_entity_1.EstadoOnu.SIN_APROVISIONAR) {
            throw new common_1.ConflictException(`La ONU con SN ${dto.serialNumber} ya está aprovisionada (estado: ${existente.estado})`);
        }
        if (!olt.smartoltId) {
            throw new common_1.BadRequestException(`El OLT "${olt.nombre}" no tiene un smartoltId configurado. ` +
                `Sincroniza los OLTs desde SmartOLT primero.`);
        }
        const onuSmartolt = await this.api.aprovisionarOnu({
            serial: dto.serialNumber,
            olt_id: olt.smartoltId,
            pon_port: dto.ponPort,
            profile: dto.perfil,
            vlan: dto.vlanId,
            vlan_mode: dto.vlanModo || 'access',
            description: dto.descripcion || '',
        });
        const { slot, subslot, port, onuIdx } = this.parsePonPort(dto.ponPort);
        let onu;
        if (existente) {
            await this.onuRepo.update(existente.id, {
                estado: onu_entity_1.EstadoOnu.APROVISIONADA,
                ponPort: dto.ponPort,
                ponSlot: slot,
                ponSubslot: subslot,
                ponPortNum: port,
                perfilSmartolt: dto.perfil,
                smartoltOnuId: onuSmartolt.id,
                vlanId: dto.vlanId,
                vlanModo: dto.vlanModo || 'access',
                modelo: dto.modelo,
                descripcion: dto.descripcion,
                aprovisionadaEn: new Date(),
                aprovisionadaPor: user.sub,
            });
            onu = await this.onuRepo.findById(existente.id, user.empresaId);
        }
        else {
            onu = await this.onuRepo.save(this.onuRepo.create({
                empresaId: user.empresaId,
                oltId: dto.oltId,
                serialNumber: dto.serialNumber.toUpperCase(),
                modelo: dto.modelo,
                ponPort: dto.ponPort,
                ponSlot: slot,
                ponSubslot: subslot,
                ponPortNum: port,
                perfilSmartolt: dto.perfil,
                smartoltOnuId: onuSmartolt.id,
                vlanId: dto.vlanId,
                vlanModo: dto.vlanModo || 'access',
                estado: onu_entity_1.EstadoOnu.APROVISIONADA,
                descripcion: dto.descripcion,
                aprovisionadaEn: new Date(),
                aprovisionadaPor: user.sub,
            }));
        }
        if (dto.contratoId) {
            await this.asociarAContrato({ contratoId: dto.contratoId, onuId: onu.id }, user);
        }
        await this.auditoria.logCreate({
            empresaId: user.empresaId,
            usuarioId: user.sub,
            usuarioEmail: user.email,
            modulo: 'smartolt',
            entidadId: onu.id,
            descripcion: `ONU aprovisionada: SN=${dto.serialNumber} | PON=${dto.ponPort} | VLAN=${dto.vlanId}`,
            req,
        });
        this.logger.log(`ONU aprovisionada: ${dto.serialNumber} | ` +
            `OLT: ${olt.nombre} | PON: ${dto.ponPort} | VLAN: ${dto.vlanId}`);
        return onu;
    }
    async eliminarProvision(id, user, req) {
        const onu = await this.findOneOnu(id, user.empresaId);
        const olt = await this.findOneOlt(onu.oltId, user.empresaId);
        if (!onu.smartoltOnuId) {
            throw new common_1.BadRequestException('La ONU no tiene un ID de SmartOLT — ya fue eliminada o nunca fue aprovisionada');
        }
        if (!olt.smartoltId) {
            throw new common_1.BadRequestException('El OLT no tiene SmartOLT ID configurado');
        }
        await this.api.eliminarProvision(olt.smartoltId, onu.smartoltOnuId);
        await this.ds.query('UPDATE contratos SET onu_id = NULL, aprovisionado = false WHERE onu_id = $1', [id]);
        await this.onuRepo.update(id, {
            estado: onu_entity_1.EstadoOnu.SIN_APROVISIONAR,
            smartoltOnuId: null,
            aprovisionadaEn: null,
        });
        await this.auditoria.logDelete({
            empresaId: user.empresaId, usuarioId: user.sub, usuarioEmail: user.email,
            modulo: 'smartolt', entidadId: id,
            descripcion: `Provisión eliminada: SN=${onu.serialNumber}`, req,
        });
        this.logger.log(`Provisión eliminada: ONU ${id} (SN: ${onu.serialNumber})`);
    }
    async asociarAContrato(dto, user) {
        const onu = await this.findOneOnu(dto.onuId, user.empresaId);
        const [contrato] = await this.ds.query('SELECT id, onu_id FROM contratos WHERE id = $1 AND empresa_id = $2 AND deleted_at IS NULL', [dto.contratoId, user.empresaId]);
        if (!contrato)
            throw new common_1.NotFoundException('Contrato no encontrado');
        if (contrato.onu_id && contrato.onu_id !== dto.onuId) {
            throw new common_1.ConflictException('El contrato ya tiene otra ONU asociada');
        }
        await this.ds.query(`UPDATE contratos SET onu_id = $1, aprovisionado = true, aprovisionado_en = NOW()
       WHERE id = $2`, [dto.onuId, dto.contratoId]);
        this.logger.log(`ONU ${dto.onuId} asociada al contrato ${dto.contratoId}`);
    }
    async sincronizarEstadoOnus(empresaId, oltId) {
        const olt = await this.findOneOlt(oltId, empresaId);
        if (!olt.smartoltId)
            throw new common_1.BadRequestException('OLT sin SmartOLT ID');
        const onusSmartolt = await this.api.listarOnusDeOlt(olt.smartoltId);
        let actualizadas = 0;
        let online = 0;
        let offline = 0;
        for (const remote of onusSmartolt) {
            const local = await this.onuRepo.findBySerial(remote.serial, empresaId);
            if (!local)
                continue;
            const nuevoEstado = remote.status === 'online'
                ? onu_entity_1.EstadoOnu.ONLINE
                : onu_entity_1.EstadoOnu.OFFLINE;
            const updates = {
                estado: nuevoEstado,
                rxPowerDbm: remote.rx_power,
                txPowerDbm: remote.tx_power,
                temperaturaC: remote.temperature,
            };
            if (nuevoEstado === onu_entity_1.EstadoOnu.ONLINE) {
                updates.ultimoOnline = new Date();
                online++;
            }
            else {
                offline++;
            }
            await this.onuRepo.update(local.id, updates);
            actualizadas++;
        }
        this.logger.log(`Sync ONUs OLT ${olt.nombre}: ${actualizadas} actualizadas | ` +
            `${online} online | ${offline} offline`);
        await this.onuRepo.updateOlt(oltId, { onusActivas: online });
        return { actualizadas, online, offline };
    }
    async getSeñalOnu(id, empresaId) {
        const onu = await this.findOneOnu(id, empresaId);
        const olt = await this.findOneOlt(onu.oltId, empresaId);
        if (!onu.smartoltOnuId || !olt.smartoltId) {
            throw new common_1.BadRequestException('ONU no aprovisionada en SmartOLT');
        }
        const señal = await this.api.getSeñalOnu(olt.smartoltId, onu.smartoltOnuId);
        await this.onuRepo.update(id, {
            rxPowerDbm: señal.rxPower,
            txPowerDbm: señal.txPower,
            temperaturaC: señal.temperature,
            voltajeV: señal.voltaje,
        });
        return { ...señal, onuId: id, serialNumber: onu.serialNumber };
    }
    async reiniciarOnu(id, user) {
        const onu = await this.findOneOnu(id, user.empresaId);
        const olt = await this.findOneOlt(onu.oltId, user.empresaId);
        if (!onu.smartoltOnuId || !olt.smartoltId) {
            throw new common_1.BadRequestException('ONU no aprovisionada en SmartOLT');
        }
        await this.api.reiniciarOnu(olt.smartoltId, onu.smartoltOnuId);
        this.logger.log(`ONU reiniciada: ${onu.serialNumber} por ${user.email}`);
    }
    async findAll(empresaId, filters) {
        const result = await this.onuRepo.findAllPaginated(empresaId, filters);
        return (0, pagination_util_1.formatPaginatedResponse)(result);
    }
    async findOneOnu(id, empresaId) {
        const onu = await this.onuRepo.findById(id, empresaId);
        if (!onu)
            throw new common_1.NotFoundException(`ONU ${id} no encontrada`);
        return onu;
    }
    async findOnuCompleta(id, empresaId) {
        const data = await this.onuRepo.findCompletaPorId(id, empresaId);
        if (!data)
            throw new common_1.NotFoundException(`ONU ${id} no encontrada`);
        return data;
    }
    async getResumen(empresaId) {
        const [resumen, perfiles] = await Promise.all([
            this.onuRepo.getResumen(empresaId),
            this.api.listarPerfiles().catch(() => []),
        ]);
        return { resumen, perfilesDisponibles: perfiles };
    }
    async listarPerfiles() {
        return this.api.listarPerfiles();
    }
    async verificarSmartolt() {
        return this.api.verificarConectividad();
    }
    parsePonPort(ponPort) {
        const parts = ponPort.split('/').map(Number);
        return {
            slot: parts[0],
            subslot: parts[1],
            port: parts[2],
            onuIdx: parts[3],
        };
    }
};
exports.SmartoltService = SmartoltService;
exports.SmartoltService = SmartoltService = SmartoltService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(3, (0, typeorm_1.InjectDataSource)()),
    __metadata("design:paramtypes", [smartolt_api_service_1.SmartoltApiService,
        onu_repository_1.OnuRepository,
        auditoria_service_1.AuditoriaService,
        typeorm_2.DataSource])
], SmartoltService);
//# sourceMappingURL=smartolt.service.js.map