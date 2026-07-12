import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

const TTL_MS = 5 * 60_000;
const DEFAULT_TZ = 'America/Lima';

// Caché mínimo de configuración de empresa reutilizable por todo el ERP
// (crons, formateo de fechas, wizard de servidores externos, etc.).
// La instalación es de un solo tenant por servidor — se resuelve la
// única empresa igual que el patrón ya usado en crm-nativo.service.ts.
@Injectable()
export class EmpresaConfigService {
  private readonly logger = new Logger(EmpresaConfigService.name);
  private cache: { zonaHoraria: string; cachedAt: number } | null = null;

  constructor(
    @InjectDataSource()
    private readonly ds: DataSource,
  ) {}

  async getTimezone(): Promise<string> {
    if (this.cache && Date.now() - this.cache.cachedAt < TTL_MS) {
      return this.cache.zonaHoraria;
    }
    try {
      const [empresa] = await this.ds.query<any[]>(
        `SELECT zona_horaria AS "zonaHoraria" FROM empresas ORDER BY created_at ASC LIMIT 1`,
      );
      const zonaHoraria = empresa?.zonaHoraria || DEFAULT_TZ;
      this.cache = { zonaHoraria, cachedAt: Date.now() };
      return zonaHoraria;
    } catch (err: any) {
      this.logger.warn(`No se pudo resolver zona horaria de empresa, usando default: ${err.message}`);
      return DEFAULT_TZ;
    }
  }

  invalidar(): void {
    this.cache = null;
  }
}
