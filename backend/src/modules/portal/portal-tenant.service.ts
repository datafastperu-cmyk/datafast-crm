import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';

import { PortalConfig } from './entities/portal-config.entity';

// Resolución del tenant en el portal.
//
// El host decide la empresa, NUNCA el usuario que escribe el abonado. Si el tenant se
// dedujera del usuario, dos empresas de la misma instalación compartirían espacio de
// nombres de credenciales y el índice único por (empresa_id, usuario) dejaría de
// proteger nada: bastaría conocer el usuario de un abonado de otra empresa.
@Injectable()
export class PortalTenantService {
  private readonly logger = new Logger(PortalTenantService.name);

  constructor(
    @InjectRepository(PortalConfig)
    private readonly configRepo: Repository<PortalConfig>,
    private readonly dataSource: DataSource,
  ) {}

  async resolverEmpresaId(host: string | undefined): Promise<string> {
    const hostLimpio = (host ?? '').split(':')[0].trim().toLowerCase();

    // 1) Empresa cuya URL de portal configurada coincide con el host servido.
    if (hostLimpio) {
      const configs = await this.configRepo.find({
        select: ['empresaId', 'urlPortal'],
        where: {},
      });
      for (const c of configs) {
        if (!c.urlPortal) continue;
        try {
          if (new URL(c.urlPortal).host.split(':')[0].toLowerCase() === hostLimpio) {
            return c.empresaId;
          }
        } catch {
          // URL mal escrita en el panel: se ignora aquí y el panel ya lo advierte.
        }
      }
    }

    // 2) Instalación de una sola empresa — el caso normal. Con el host sin coincidencia
    //    todavía es determinista a qué tenant pertenece el portal.
    const empresas: Array<{ id: string }> = await this.dataSource.query(
      `SELECT id FROM empresas LIMIT 2`,
    );
    if (empresas.length === 1) return empresas[0].id;

    // 3) Varias empresas y ningún host que las distinga: elegir una sería servirle a un
    //    abonado los datos de otra empresa. Se rechaza.
    this.logger.error(
      `Portal sin tenant resoluble para host "${hostLimpio}". ` +
        'Configura la URL del portal de cada empresa en /configuracion/portal-cliente.',
    );
    throw new UnauthorizedException(
      'Este portal no está configurado correctamente. Contacta a tu proveedor.',
    );
  }
}
