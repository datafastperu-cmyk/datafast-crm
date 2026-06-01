import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as fs   from 'fs';
import * as path from 'path';
import { CrmNativoService } from './crm-nativo.service';

const MEDIA_DIR        = process.env.MEDIA_DIR || '/opt/datafast/backend/public/crm_whatsapp';
const DIAS_RETENCION   = 90;
const RETENCION_MS     = DIAS_RETENCION * 24 * 60 * 60 * 1000;

@Injectable()
export class PurgaMediaCron {
  private readonly logger = new Logger(PurgaMediaCron.name);

  constructor(private readonly crmSvc: CrmNativoService) {}

  @Cron('0 2 * * *', { name: 'purga-media-crm', timeZone: 'America/Lima' })
  async ejecutar(): Promise<void> {
    // Solo instancia principal del clúster PM2
    if (process.env.NODE_APP_INSTANCE !== '0') return;

    this.logger.log('━━━ Purga CRM media — inicio ━━━');
    const inicio = Date.now();

    // 1. Purga en PostgreSQL
    const eliminadosDb = await this.crmSvc.purgarMensajesAntiguos(DIAS_RETENCION);
    this.logger.log(`DB: ${eliminadosDb} mensajes eliminados (>${DIAS_RETENCION} días)`);

    // 2. Purga física en disco
    let eliminadosDisco = 0;
    try {
      if (!fs.existsSync(MEDIA_DIR)) return;

      const ahora   = Date.now();
      const archivos = fs.readdirSync(MEDIA_DIR);

      for (const archivo of archivos) {
        const filePath = path.join(MEDIA_DIR, archivo);
        try {
          const stat = fs.statSync(filePath);
          if (ahora - stat.mtimeMs > RETENCION_MS) {
            fs.unlinkSync(filePath);
            eliminadosDisco++;
          }
        } catch {
          // archivo ya eliminado o sin permisos — continuar
        }
      }
    } catch (err) {
      this.logger.error(`Error al leer directorio de media: ${(err as Error).message}`);
    }

    const duracion = Date.now() - inicio;
    this.logger.log(
      `━━━ Purga CRM media — fin: ${eliminadosDb} msgs DB, ${eliminadosDisco} archivos disco (${duracion}ms) ━━━`,
    );
  }
}
