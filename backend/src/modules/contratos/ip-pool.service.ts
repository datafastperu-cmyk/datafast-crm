import {
  Injectable, NotFoundException, ConflictException,
  BadRequestException, Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { SegmentoIpv4, IpAsignada } from './entities/red.entity';
import {
  ipToInt, intToIp, getCidrRange,
  getNextAvailableIp, isIpInCidr, isValidCidr,
} from '../../common/utils/ip.util';

@Injectable()
export class IpPoolService {
  private readonly logger = new Logger(IpPoolService.name);

  constructor(
    @InjectRepository(SegmentoIpv4)
    private readonly segRepo: Repository<SegmentoIpv4>,
    @InjectRepository(IpAsignada)
    private readonly ipRepo: Repository<IpAsignada>,
    private readonly ds: DataSource,
  ) {}

  // ── CRUD de segmentos ──────────────────────────────────────

  async createSegmento(data: Partial<SegmentoIpv4>): Promise<SegmentoIpv4> {
    if (!isValidCidr(data.redCidr)) {
      throw new BadRequestException(`CIDR inválido: ${data.redCidr}`);
    }
    const range = getCidrRange(data.redCidr);
    const seg = this.segRepo.create({ ...data, totalIps: range.usableHosts });
    return this.segRepo.save(seg);
  }

  async getSegmentos(empresaId: string, routerId?: string): Promise<SegmentoIpv4[]> {
    const qb = this.segRepo.createQueryBuilder('s')
      .where('s.empresa_id = :empresaId', { empresaId })
      .andWhere('s.deleted_at IS NULL')
      .andWhere('s.activo = true');
    if (routerId) qb.andWhere('s.router_id = :routerId', { routerId });
    return qb.orderBy('s.nombre', 'ASC').getMany();
  }

  async getSegmento(id: string, empresaId: string): Promise<SegmentoIpv4> {
    const seg = await this.segRepo.findOne({ where: { id, empresaId, deletedAt: null } });
    if (!seg) throw new NotFoundException(`Segmento ${id} no encontrado`);
    return seg;
  }

  // ── Asignación automática de IP (núcleo del módulo) ────────
  async asignarSiguienteIpDisponible(
    segmentoId: string,
    empresaId: string,
    contratoId?: string,
  ): Promise<{ ip: string; asignacionId: string }> {
    // Usar transacción para evitar race conditions en asignación concurrente
    return this.ds.transaction(async (manager) => {
      // LOCK del segmento para evitar doble-asignación
      const segmento = await manager
        .getRepository(SegmentoIpv4)
        .createQueryBuilder('s')
        .setLock('pessimistic_write')   // SELECT ... FOR UPDATE
        .where('s.id = :id AND s.empresa_id = :empresaId', { id: segmentoId, empresaId })
        .getOne();

      if (!segmento) throw new NotFoundException('Segmento no encontrado');
      if (!segmento.activo) throw new BadRequestException('Segmento inactivo');

      const range = getCidrRange(segmento.redCidr);

      // Obtener todas las IPs ya asignadas en este segmento
      const asignadas = await manager
        .getRepository(IpAsignada)
        .createQueryBuilder('ip')
        .select('ip.ip_address')
        .where('ip.segmento_id = :segmentoId', { segmentoId })
        .andWhere('ip.activa = true')
        .getRawMany();

      const ipsEnUso = asignadas.map((r) => r.ip_ip_address || r.ipAddress);

      // IPs a excluir: gateway + reservadas + broadcast
      const ipsReservadas = [
        segmento.gateway,
        range.network,
        range.broadcast,
        ...(segmento.ipsReservadas || []),
      ];

      // Calcular siguiente IP disponible
      const siguienteIp = getNextAvailableIp(
        segmento.redCidr,
        ipsEnUso,
        ipsReservadas,
      );

      if (!siguienteIp) {
        throw new ConflictException(
          `Pool agotado en ${segmento.nombre} (${segmento.redCidr}). ` +
          `IPs usadas: ${ipsEnUso.length}/${range.usableHosts}`,
        );
      }

      // Registrar asignación
      const asignacion = manager.getRepository(IpAsignada).create({
        empresaId,
        segmentoId,
        contratoId,
        ipAddress: siguienteIp,
        tipo: 'cliente',
        activa: true,
      });

      const saved = await manager.getRepository(IpAsignada).save(asignacion);

      this.logger.log(
        `IP asignada: ${siguienteIp} → segmento ${segmento.nombre} | contrato: ${contratoId}`,
      );

      return { ip: siguienteIp, asignacionId: saved.id };
    });
  }

  // ── Asignar IP específica ──────────────────────────────────
  async asignarIpEspecifica(
    ip: string,
    segmentoId: string,
    empresaId: string,
    contratoId?: string,
  ): Promise<{ ip: string; asignacionId: string }> {
    return this.ds.transaction(async (manager) => {
      const segmento = await manager
        .getRepository(SegmentoIpv4)
        .createQueryBuilder('s')
        .setLock('pessimistic_write')
        .where('s.id = :id AND s.empresa_id = :empresaId', { id: segmentoId, empresaId })
        .getOne();

      if (!segmento) throw new NotFoundException('Segmento no encontrado');

      // Verificar que la IP pertenece al rango
      if (!isIpInCidr(ip, segmento.redCidr)) {
        throw new BadRequestException(
          `La IP ${ip} no pertenece al segmento ${segmento.redCidr}`,
        );
      }

      // Verificar que no esté ya en uso
      const enUso = await manager.getRepository(IpAsignada).findOne({
        where: { segmentoId, ipAddress: ip, activa: true },
      });

      if (enUso) {
        throw new ConflictException(
          `La IP ${ip} ya está asignada${enUso.contratoId ? ` al contrato ${enUso.contratoId}` : ''}`,
        );
      }

      const asignacion = manager.getRepository(IpAsignada).create({
        empresaId, segmentoId, contratoId,
        ipAddress: ip, tipo: 'cliente', activa: true,
      });
      const saved = await manager.getRepository(IpAsignada).save(asignacion);

      this.logger.log(`IP fija asignada: ${ip} → segmento ${segmento.nombre}`);
      return { ip, asignacionId: saved.id };
    });
  }

  // ── Liberar IP al dar de baja un contrato ──────────────────
  async liberarIp(contratoId: string, empresaId: string): Promise<void> {
    const asignaciones = await this.ipRepo.find({
      where: { contratoId, empresaId, activa: true },
    });

    if (!asignaciones.length) return;

    for (const a of asignaciones) {
      await this.ipRepo.update(a.id, {
        activa: false,
        liberadaEn: new Date(),
      });
      this.logger.log(`IP liberada: ${a.ipAddress} | contrato: ${contratoId}`);
    }
  }

  // ── Vista de disponibilidad del pool ──────────────────────
  async getDisponibilidad(segmentoId: string, empresaId: string) {
    const segmento = await this.getSegmento(segmentoId, empresaId);
    const range    = getCidrRange(segmento.redCidr);

    const asignadas = await this.ipRepo.find({
      where: { segmentoId, activa: true },
    });

    const ipsEnUso  = new Set(asignadas.map((a) => a.ipAddress));
    const reservadas = new Set([
      segmento.gateway,
      range.network,
      range.broadcast,
      ...(segmento.ipsReservadas || []),
    ]);

    // Generar vista de todas las IPs del rango
    const firstInt = ipToInt(range.firstUsable);
    const lastInt  = ipToInt(range.lastUsable);
    const ips: Array<{ ip: string; estado: 'libre' | 'asignada' | 'reservada' }> = [];

    for (let i = firstInt; i <= lastInt && ips.length < 500; i++) {
      const ip = intToIp(i);
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
      ips: ips.slice(0, 256), // Máximo 256 para no saturar respuesta
      hayMas: ips.length > 256,
    };
  }

  async updateSegmento(
    id: string,
    empresaId: string,
    data: Partial<SegmentoIpv4>,
  ): Promise<SegmentoIpv4> {
    const seg = await this.getSegmento(id, empresaId);

    const ipsActivas = await this.ipRepo.count({ where: { segmentoId: id, activa: true } });
    if (ipsActivas > 0) {
      throw new ConflictException(
        `No se puede editar: el segmento tiene ${ipsActivas} IP${ipsActivas > 1 ? 's' : ''} asignada${ipsActivas > 1 ? 's' : ''} a clientes. Libéralas antes de modificar el segmento.`,
      );
    }

    const update: Partial<SegmentoIpv4> = { ...data };
    if (data.redCidr && data.redCidr !== seg.redCidr) {
      if (!isValidCidr(data.redCidr)) {
        throw new BadRequestException(`CIDR inválido: ${data.redCidr}`);
      }
      update.totalIps = getCidrRange(data.redCidr).usableHosts;
    }

    await this.segRepo.update(id, update);
    return this.getSegmento(id, empresaId);
  }

  async desactivarSegmento(id: string, empresaId: string): Promise<void> {
    const seg = await this.getSegmento(id, empresaId);

    const ipsActivas = await this.ipRepo.count({ where: { segmentoId: id, activa: true } });
    if (ipsActivas > 0) {
      throw new ConflictException(
        `No se puede eliminar: el segmento tiene ${ipsActivas} IP${ipsActivas > 1 ? 's' : ''} asignada${ipsActivas > 1 ? 's' : ''} a clientes. Libéralas antes de eliminar el segmento.`,
      );
    }

    await this.segRepo.update(seg.id, { activo: false });
  }

  // ── Estadísticas de todos los segmentos ───────────────────
  async getEstadisticasSegmentos(empresaId: string) {
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
}
