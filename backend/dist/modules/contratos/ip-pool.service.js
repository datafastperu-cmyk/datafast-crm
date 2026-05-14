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
var IpPoolService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.IpPoolService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const segmento_ipv4_entity_1 = require("./entities/segmento-ipv4.entity");
const ip_util_1 = require("../../common/utils/ip.util");
let IpPoolService = IpPoolService_1 = class IpPoolService {
    constructor(segRepo, ipRepo, ds) {
        this.segRepo = segRepo;
        this.ipRepo = ipRepo;
        this.ds = ds;
        this.logger = new common_1.Logger(IpPoolService_1.name);
    }
    async createSegmento(data) {
        if (!(0, ip_util_1.isValidCidr)(data.redCidr)) {
            throw new common_1.BadRequestException(`CIDR inválido: ${data.redCidr}`);
        }
        const range = (0, ip_util_1.getCidrRange)(data.redCidr);
        const seg = this.segRepo.create({ ...data, totalIps: range.usableHosts });
        return this.segRepo.save(seg);
    }
    async getSegmentos(empresaId, routerId) {
        const qb = this.segRepo.createQueryBuilder('s')
            .where('s.empresa_id = :empresaId', { empresaId })
            .andWhere('s.deleted_at IS NULL')
            .andWhere('s.activo = true');
        if (routerId)
            qb.andWhere('s.router_id = :routerId', { routerId });
        return qb.orderBy('s.nombre', 'ASC').getMany();
    }
    async getSegmento(id, empresaId) {
        const seg = await this.segRepo.findOne({ where: { id, empresaId, deletedAt: null } });
        if (!seg)
            throw new common_1.NotFoundException(`Segmento ${id} no encontrado`);
        return seg;
    }
    async asignarSiguienteIpDisponible(segmentoId, empresaId, contratoId) {
        return this.ds.transaction(async (manager) => {
            const segmento = await manager
                .getRepository(segmento_ipv4_entity_1.SegmentoIpv4)
                .createQueryBuilder('s')
                .setLock('pessimistic_write')
                .where('s.id = :id AND s.empresa_id = :empresaId', { id: segmentoId, empresaId })
                .getOne();
            if (!segmento)
                throw new common_1.NotFoundException('Segmento no encontrado');
            if (!segmento.activo)
                throw new common_1.BadRequestException('Segmento inactivo');
            const range = (0, ip_util_1.getCidrRange)(segmento.redCidr);
            const asignadas = await manager
                .getRepository(segmento_ipv4_entity_1.IpAsignada)
                .createQueryBuilder('ip')
                .select('ip.ip_address')
                .where('ip.segmento_id = :segmentoId', { segmentoId })
                .andWhere('ip.activa = true')
                .getRawMany();
            const ipsEnUso = asignadas.map((r) => r.ip_ip_address || r.ipAddress);
            const ipsReservadas = [
                segmento.gateway,
                range.network,
                range.broadcast,
                ...(segmento.ipsReservadas || []),
            ];
            const siguienteIp = (0, ip_util_1.getNextAvailableIp)(segmento.redCidr, ipsEnUso, ipsReservadas);
            if (!siguienteIp) {
                throw new common_1.ConflictException(`Pool agotado en ${segmento.nombre} (${segmento.redCidr}). ` +
                    `IPs usadas: ${ipsEnUso.length}/${range.usableHosts}`);
            }
            const asignacion = manager.getRepository(segmento_ipv4_entity_1.IpAsignada).create({
                empresaId,
                segmentoId,
                contratoId,
                ipAddress: siguienteIp,
                tipo: 'cliente',
                activa: true,
            });
            const saved = await manager.getRepository(segmento_ipv4_entity_1.IpAsignada).save(asignacion);
            this.logger.log(`IP asignada: ${siguienteIp} → segmento ${segmento.nombre} | contrato: ${contratoId}`);
            return { ip: siguienteIp, asignacionId: saved.id };
        });
    }
    async asignarIpEspecifica(ip, segmentoId, empresaId, contratoId) {
        return this.ds.transaction(async (manager) => {
            const segmento = await manager
                .getRepository(segmento_ipv4_entity_1.SegmentoIpv4)
                .createQueryBuilder('s')
                .setLock('pessimistic_write')
                .where('s.id = :id AND s.empresa_id = :empresaId', { id: segmentoId, empresaId })
                .getOne();
            if (!segmento)
                throw new common_1.NotFoundException('Segmento no encontrado');
            if (!(0, ip_util_1.isIpInCidr)(ip, segmento.redCidr)) {
                throw new common_1.BadRequestException(`La IP ${ip} no pertenece al segmento ${segmento.redCidr}`);
            }
            const enUso = await manager.getRepository(segmento_ipv4_entity_1.IpAsignada).findOne({
                where: { segmentoId, ipAddress: ip, activa: true },
            });
            if (enUso) {
                throw new common_1.ConflictException(`La IP ${ip} ya está asignada${enUso.contratoId ? ` al contrato ${enUso.contratoId}` : ''}`);
            }
            const asignacion = manager.getRepository(segmento_ipv4_entity_1.IpAsignada).create({
                empresaId, segmentoId, contratoId,
                ipAddress: ip, tipo: 'cliente', activa: true,
            });
            const saved = await manager.getRepository(segmento_ipv4_entity_1.IpAsignada).save(asignacion);
            this.logger.log(`IP fija asignada: ${ip} → segmento ${segmento.nombre}`);
            return { ip, asignacionId: saved.id };
        });
    }
    async liberarIp(contratoId, empresaId) {
        const asignaciones = await this.ipRepo.find({
            where: { contratoId, empresaId, activa: true },
        });
        if (!asignaciones.length)
            return;
        for (const a of asignaciones) {
            await this.ipRepo.update(a.id, {
                activa: false,
                liberadaEn: new Date(),
            });
            this.logger.log(`IP liberada: ${a.ipAddress} | contrato: ${contratoId}`);
        }
    }
    async getDisponibilidad(segmentoId, empresaId) {
        const segmento = await this.getSegmento(segmentoId, empresaId);
        const range = (0, ip_util_1.getCidrRange)(segmento.redCidr);
        const asignadas = await this.ipRepo.find({
            where: { segmentoId, activa: true },
        });
        const ipsEnUso = new Set(asignadas.map((a) => a.ipAddress));
        const reservadas = new Set([
            segmento.gateway,
            range.network,
            range.broadcast,
            ...(segmento.ipsReservadas || []),
        ]);
        const firstInt = (0, ip_util_1.ipToInt)(range.firstUsable);
        const lastInt = (0, ip_util_1.ipToInt)(range.lastUsable);
        const ips = [];
        for (let i = firstInt; i <= lastInt && ips.length < 500; i++) {
            const ip = (0, ip_util_1.intToIp)(i);
            ips.push({
                ip,
                estado: reservadas.has(ip)
                    ? 'reservada'
                    : ipsEnUso.has(ip)
                        ? 'asignada'
                        : 'libre',
            });
        }
        return {
            segmento: {
                id: segmento.id,
                nombre: segmento.nombre,
                redCidr: segmento.redCidr,
                gateway: segmento.gateway,
                totalIps: range.usableHosts,
                ipsUsadas: asignadas.length,
                ipsDisponibles: range.usableHosts - asignadas.length,
                porcentajeUso: Math.round((asignadas.length / range.usableHosts) * 100),
            },
            ips: ips.slice(0, 256),
            hayMas: ips.length > 256,
        };
    }
    async getEstadisticasSegmentos(empresaId) {
        return this.segRepo
            .createQueryBuilder('s')
            .select([
            's.id', 's.nombre', 's.red_cidr AS "redCidr"',
            's.total_ips AS "totalIps"', 's.ips_usadas AS "ipsUsadas"',
            's.ips_disponibles AS "ipsDisponibles"',
        ])
            .where('s.empresa_id = :empresaId', { empresaId })
            .andWhere('s.deleted_at IS NULL')
            .andWhere('s.activo = true')
            .getRawMany();
    }
};
exports.IpPoolService = IpPoolService;
exports.IpPoolService = IpPoolService = IpPoolService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(segmento_ipv4_entity_1.SegmentoIpv4)),
    __param(1, (0, typeorm_1.InjectRepository)(segmento_ipv4_entity_1.IpAsignada)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.DataSource])
], IpPoolService);
//# sourceMappingURL=ip-pool.service.js.map