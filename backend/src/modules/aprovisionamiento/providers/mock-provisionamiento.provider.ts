import { Injectable, Logger } from '@nestjs/common';
import { IProvisionamientoProvider } from '../interfaces/provisionamiento-provider.interface';

@Injectable()
export class MockProvisionamientoProvider implements IProvisionamientoProvider {
  private readonly logger = new Logger(MockProvisionamientoProvider.name);

  async suspenderServicio(contratoId: string, detallesTecnicos: any): Promise<boolean> {
    this.logger.log(`[MOCK] Suspendiendo servicio para contrato ${contratoId}`);
    this.logger.debug(`[MOCK] Detalles técnicos: ${JSON.stringify(detallesTecnicos)}`);
    return true;
  }

  async reactivarServicio(contratoId: string, detallesTecnicos: any): Promise<boolean> {
    this.logger.log(`[MOCK] Iniciando proceso simulado de reactivación de ancho de banda para contrato ${contratoId}`);
    return true;
  }
}
