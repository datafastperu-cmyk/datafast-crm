import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { XuiLine, EstadoSyncXuiLine } from './entities/xui-line.entity';
import { XuiApiService, XuiChannelStatus } from './xui-api.service';
import { XuiLinesService } from './xui-lines.service';

@Injectable()
export class XuiMonitorService {
  private readonly logger = new Logger(XuiMonitorService.name);

  // Snapshot en memoria del estado de canales, servido a todos los
  // clientes del frontend sin volver a golpear XUI en cada request.
  private channelsSnapshot: XuiChannelStatus[] = [];
  private channelsSnapshotEn: Date | null = null;
  private tickCount = 0;

  constructor(
    @InjectRepository(XuiLine)
    private readonly repo: Repository<XuiLine>,
    private readonly xuiApi: XuiApiService,
    private readonly linesSvc: XuiLinesService,
  ) {}

  getChannelsSnapshot(): { canales: XuiChannelStatus[]; actualizadoEn: Date | null } {
    return { canales: this.channelsSnapshot, actualizadoEn: this.channelsSnapshotEn };
  }

  @Cron('*/30 * * * * *', { name: 'xui-monitor' })
  async tick(): Promise<void> {
    if (this.xuiApi.isDegraded()) {
      this.logger.debug('XUI degradado — omitiendo ciclo de polling');
      return;
    }

    await this.actualizarStreamsYCanales().catch((err) =>
      this.logger.warn(`Ciclo de polling XUI falló: ${err.message}`),
    );

    await this.linesSvc.reconciliarPendientes().catch((err) =>
      this.logger.warn(`Reconciliación de lines pendientes falló: ${err.message}`),
    );
  }

  private async actualizarStreamsYCanales(): Promise<void> {
    // Una sola llamada batch por ciclo — el número de lines no multiplica
    // la carga sobre el panel externo (punto 9 de resiliencia del plan).
    const [streams, canales] = await Promise.all([
      this.xuiApi.getActiveStreams(),
      this.xuiApi.getChannelsStatus(),
    ]);

    this.channelsSnapshot   = canales;
    this.channelsSnapshotEn = new Date();

    const streamsPorLine = new Map(streams.map((s) => [s.lineId, s.channel]));

    const lines = await this.repo.find({ where: { activo: true } });
    for (const line of lines) {
      if (!line.xuiLineId) continue;
      const canalActual = streamsPorLine.get(line.xuiLineId) ?? null;
      const conectado    = canalActual !== null;

      if (line.estadoSync === EstadoSyncXuiLine.SINCRONIZADO) {
        await this.repo.update(line.id, {
          canalActual,
          conectado,
          ultimaActividadEn: conectado ? new Date() : line.ultimaActividadEn,
        });
      }
    }

    // Desfase de estado: lines que el ERP cree sincronizados pero XUI ya
    // no reporta (borrados fuera del ERP) — se marcan en error, nunca se
    // asume silenciosamente que siguen activos. Verificación por-línea es
    // costosa (1 request por line), así que corre cada ~10 min, no en
    // cada tick de 30s, para no convertir el polling en N+1 sobre XUI.
    this.tickCount++;
    if (this.tickCount % 20 !== 0) return;

    for (const line of lines) {
      if (line.estadoSync !== EstadoSyncXuiLine.SINCRONIZADO || !line.xuiLineId) continue;
      const remoto = await this.xuiApi.getLine(line.xuiLineId);
      if (!remoto) {
        await this.repo.update(line.id, {
          estadoSync:      EstadoSyncXuiLine.ERROR,
          ultimoErrorSync: 'no existe en XUI',
        });
      }
    }
  }
}
