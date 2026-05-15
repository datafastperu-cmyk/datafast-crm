import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LicenciaService } from './licencia.service';

@Injectable()
export class LicenciaCron {
  private readonly logger = new Logger(LicenciaCron.name);

  constructor(private readonly licenciaSvc: LicenciaService) {}

  // Valida online cada 24 horas
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async validacionDiaria() {
    this.logger.log('Ejecutando validación diaria de licencia...');
    await this.licenciaSvc.validarOnline().catch((e) => {
      this.logger.warn(`Validación online falló: ${e.message}`);
    });
  }

  // Re-carga y verifica la licencia cada 6 horas (por si se actualizó el .env)
  @Cron('0 */6 * * *')
  async recargaPeriodica() {
    await this.licenciaSvc.cargarYVerificar().catch(() => {});
  }
}
