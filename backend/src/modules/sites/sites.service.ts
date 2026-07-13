import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { Site } from './entities/site.entity';
import { Router } from '../mikrotik/entities/router.entity';
import { OltDispositivo } from '../olt-nativo/entities/olt-dispositivo.entity';
import { VpnCliente } from '../openvpn/entities/vpn-cliente.entity';
import { CreateSiteDto, UpdateSiteDto } from './dto/site.dto';

// ─────────────────────────────────────────────────────────────
// SitesService — Incremento 1 de la arquitectura de infraestructura
//
// Un Site agrupa Router + VPN + OLT bajo un mismo nodo. La relación
// con VPN y OLT es indirecta (vía Router.id → routerId de cada uno);
// este servicio solo persiste el nodo Site y resuelve sus hijos
// en tiempo de lectura para el detalle.
// ─────────────────────────────────────────────────────────────
@Injectable()
export class SitesService {
  constructor(
    @InjectRepository(Site)
    private readonly siteRepo: Repository<Site>,

    @InjectRepository(Router)
    private readonly routerRepo: Repository<Router>,

    @InjectRepository(OltDispositivo)
    private readonly oltRepo: Repository<OltDispositivo>,

    @InjectRepository(VpnCliente)
    private readonly vpnRepo: Repository<VpnCliente>,
  ) {}

  async listar(empresaId: string): Promise<Site[]> {
    return this.siteRepo.find({
      where: { empresaId, activo: true },
      order: { nombre: 'ASC' },
    });
  }

  async detalle(empresaId: string, siteId: string) {
    const site = await this._cargar(empresaId, siteId);

    const [router, olts, vpn] = await Promise.all([
      site.routerId
        ? this.routerRepo.findOne({ where: { id: site.routerId } })
        : Promise.resolve(null),
      site.routerId
        ? this.oltRepo.find({ where: { routerId: site.routerId, deletedAt: IsNull() as any } })
        : Promise.resolve([]),
      site.routerId
        ? this.vpnRepo.findOne({ where: { routerId: site.routerId } })
        : Promise.resolve(null),
    ]);

    return { site, router, vpn, olts };
  }

  async crear(empresaId: string, dto: CreateSiteDto): Promise<Site> {
    if (dto.routerId) {
      await this._validarRouterLibre(dto.routerId);
    }

    const site = this.siteRepo.create({
      empresaId,
      nombre: dto.nombre,
      descripcion: dto.descripcion ?? null,
      ubicacion: dto.ubicacion ?? null,
      latitud: dto.latitud ?? null,
      longitud: dto.longitud ?? null,
      zonaId: dto.zonaId ?? null,
      routerId: dto.routerId ?? null,
      activo: true,
    });

    return this.siteRepo.save(site);
  }

  async actualizar(
    empresaId: string,
    siteId: string,
    dto: UpdateSiteDto,
  ): Promise<Site> {
    const site = await this._cargar(empresaId, siteId);

    if (dto.routerId && dto.routerId !== site.routerId) {
      await this._validarRouterLibre(dto.routerId, siteId);
    }

    Object.assign(site, {
      nombre: dto.nombre ?? site.nombre,
      descripcion: dto.descripcion ?? site.descripcion,
      ubicacion: dto.ubicacion ?? site.ubicacion,
      latitud: dto.latitud ?? site.latitud,
      longitud: dto.longitud ?? site.longitud,
      zonaId: dto.zonaId ?? site.zonaId,
      routerId: dto.routerId ?? site.routerId,
    });

    return this.siteRepo.save(site);
  }

  async eliminar(empresaId: string, siteId: string): Promise<void> {
    const site = await this._cargar(empresaId, siteId);
    await this.siteRepo.softRemove(site);
  }

  // ── Privados ──────────────────────────────────────────────

  private async _cargar(empresaId: string, siteId: string): Promise<Site> {
    const site = await this.siteRepo.findOne({ where: { id: siteId, empresaId } });
    if (!site) throw new NotFoundException(`Site ${siteId} no encontrado`);
    return site;
  }

  // Un Router de cabecera pertenece a un solo Site activo — refleja
  // el índice único parcial de la migración (idx_sites_router).
  private async _validarRouterLibre(routerId: string, excluirSiteId?: string): Promise<void> {
    const existente = await this.siteRepo.findOne({ where: { routerId, activo: true } });
    if (existente && existente.id !== excluirSiteId) {
      throw new ConflictException(
        `El router ${routerId} ya pertenece al Site "${existente.nombre}"`,
      );
    }
  }
}
