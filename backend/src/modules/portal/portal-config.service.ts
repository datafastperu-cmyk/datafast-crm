import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { PortalConfig } from './entities/portal-config.entity';
import { PortalBanner } from './entities/portal-banner.entity';
import { UpdatePortalConfigDto, UpsertPortalBannerDto } from './dto/portal-config.dto';

// El dominio que SIRVE el portal es infraestructura (server_name + certificado TLS) y
// vive en el .env de cada VPS. Lazy getter: una constante de módulo se evaluaría antes
// de que ConfigModule cargue el .env y quedaría vacía para siempre.
const getPortalDomain = (): string => (process.env.PORTAL_DOMAIN || '').trim().toLowerCase();

export interface PortalConfigResultado {
  config: PortalConfig;
  // Problemas que no impiden guardar pero que dejarían el portal mal configurado.
  // Se devuelven para que el panel los muestre; callar aquí significa descubrirlos
  // cuando un abonado reporte que el enlace del aviso no abre.
  advertencias: string[];
}

@Injectable()
export class PortalConfigService {
  private readonly logger = new Logger(PortalConfigService.name);

  constructor(
    @InjectRepository(PortalConfig)
    private readonly configRepo: Repository<PortalConfig>,
    @InjectRepository(PortalBanner)
    private readonly bannerRepo: Repository<PortalBanner>,
  ) {}

  // ── Configuración ───────────────────────────────────────────
  async obtener(empresaId: string): Promise<PortalConfigResultado> {
    const config = await this.obtenerOCrear(empresaId);
    return { config, advertencias: this.advertencias(config) };
  }

  async actualizar(empresaId: string, dto: UpdatePortalConfigDto): Promise<PortalConfigResultado> {
    const config = await this.obtenerOCrear(empresaId);

    if (dto.contenidoMenuPersonalizado !== undefined) {
      this.rechazarHtml(dto.contenidoMenuPersonalizado);
    }

    Object.assign(config, dto);
    const guardado = await this.configRepo.save(config);

    return { config: guardado, advertencias: this.advertencias(guardado) };
  }

  // La empresa pudo crearse después de la migración que sembró las filas por defecto.
  // Sin esto, el panel de una empresa nueva abriría vacío y sin explicación.
  private async obtenerOCrear(empresaId: string): Promise<PortalConfig> {
    const existente = await this.configRepo.findOne({ where: { empresaId } });
    if (existente) return existente;
    return this.configRepo.save(this.configRepo.create({ empresaId }));
  }

  // El contenido del menú se sirve a TODO el parque de abonados. Aceptar HTML sería
  // XSS almacenado de distribución masiva. Se rechaza de forma explícita en vez de
  // sanear en silencio: el operador debe saber que su etiqueta no se va a renderizar.
  private rechazarHtml(texto: string): void {
    if (/<[^>]+>/.test(texto)) {
      throw new BadRequestException(
        'El menú personalizado admite solo texto plano. Quita las etiquetas HTML.',
      );
    }
  }

  private advertencias(config: PortalConfig): string[] {
    const avisos: string[] = [];
    const dominioServido = getPortalDomain();

    if (!config.urlPortal) {
      avisos.push(
        'Falta la URL del portal. Los avisos que se envían al cliente saldrán sin enlace.',
      );
    } else if (dominioServido) {
      let host = '';
      try {
        host = new URL(config.urlPortal).host.toLowerCase();
      } catch {
        avisos.push('La URL del portal no es una dirección válida.');
      }
      if (host && host !== dominioServido) {
        avisos.push(
          `La URL del portal (${host}) no coincide con el dominio que sirve el portal ` +
            `en este servidor (${dominioServido}). Los enlaces enviados al cliente no abrirán.`,
        );
      }
    } else {
      avisos.push(
        'PORTAL_DOMAIN no está definido en el .env de este servidor: no se puede verificar ' +
          'que la URL configurada apunte al portal real.',
      );
    }

    if (config.mostrarConsumo) {
      avisos.push(
        'La sección de consumo está habilitada, pero todavía no existe colector de datos: ' +
          'el cliente verá la tarjeta vacía.',
      );
    }

    if (config.mostrarMenuPersonalizado && !config.contenidoMenuPersonalizado?.trim()) {
      avisos.push('El menú personalizado está habilitado pero no tiene contenido.');
    }

    if (config.mostrarBanner) {
      // Conteo diferido: el panel lo resuelve al listar banners. Aquí solo se avisa
      // de la combinación que deja un espacio vacío en el portal.
      avisos.push('Verifica que haya al menos un banner activo y vigente.');
    }

    return avisos;
  }

  // ── Banners ─────────────────────────────────────────────────
  async listarBanners(empresaId: string): Promise<PortalBanner[]> {
    return this.bannerRepo.find({
      where: { empresaId },
      order: { orden: 'ASC', createdAt: 'ASC' },
    });
  }

  async crearBanner(empresaId: string, dto: UpsertPortalBannerDto): Promise<PortalBanner> {
    this.validarVigencia(dto);
    return this.bannerRepo.save(this.bannerRepo.create({ ...dto, empresaId }));
  }

  async actualizarBanner(
    empresaId: string,
    id: string,
    dto: UpsertPortalBannerDto,
  ): Promise<PortalBanner> {
    const banner = await this.bannerRepo.findOne({ where: { id, empresaId } });
    if (!banner) throw new NotFoundException('Banner no encontrado');
    this.validarVigencia({ ...banner, ...dto } as UpsertPortalBannerDto);
    Object.assign(banner, dto);
    return this.bannerRepo.save(banner);
  }

  async eliminarBanner(empresaId: string, id: string): Promise<void> {
    const res = await this.bannerRepo.delete({ id, empresaId });
    if (!res.affected) throw new NotFoundException('Banner no encontrado');
  }

  // Una vigencia invertida deja el banner invisible para siempre sin que nadie entienda
  // por qué. El CHECK de la tabla lo garantiza; aquí se traduce a un mensaje legible.
  private validarVigencia(dto: UpsertPortalBannerDto): void {
    if (dto.vigenteDesde && dto.vigenteHasta && dto.vigenteHasta < dto.vigenteDesde) {
      throw new BadRequestException(
        'La fecha de fin de vigencia no puede ser anterior a la de inicio.',
      );
    }
  }
}
