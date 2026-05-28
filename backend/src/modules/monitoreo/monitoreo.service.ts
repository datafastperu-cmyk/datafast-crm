// Ruta: /opt/datafast/backend/src/modules/monitoreo/monitoreo.service.ts

import {
  BadRequestException, Injectable,
  Logger, NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository }     from 'typeorm';

import { DispositivoMonitoreo }  from './entities/dispositivo-monitoreo.entity';
import { MetricasMonitoreo }     from './entities/metricas-monitoreo.entity';
import { AlertaSistema }         from './entities/alerta-sistema.entity';
import { UmbralAlerta }           from './entities/umbral-alerta.entity';
import { Fabricante, NivelAlerta, StatusAlerta, StatusDispositivo, TipoEquipo } from './enums/monitoreo.enums';
import {
  MonitoreoWorkerService,
  WirelessClient,
}                                from './services/monitoreo-worker.service';
import { RouterConnectionPool }  from '../mikrotik/services/connection-pool.service';
import { ApiResponse as StdResponse } from '../../common/dto/response.dto';
import { encrypt }               from '../../common/utils/encryption.util';

// ─── DTOs / respuestas ────────────────────────────────────────────

export interface ResumenTiempoReal {
  totales: {
    online:        number;
    offline:       number;
    reverificando: number;
    degradado:     number;
    alertasActivas: number;
  };
  traficoBps: {
    totalDown: number;
    totalUp:   number;
  };
  dispositivos: DispositivoConMetrica[];
}

export interface DispositivoConMetrica {
  id:              string;
  nombreEmisor:    string;
  ipAddress:       string;
  tipoEquipo:      string;
  fabricante:      string;
  status:          string;
  lastSeenAt:      Date | null;
  pingLatenciaMs:  number | null;
  pingLossPct:     number | null;
  cpuUsagePct:     number | null;
  memoryUsagePct:  number | null;
  trafficDownBps:  string | null;
  trafficUpBps:    string | null;
  ultimaMetricaAt: Date | null;
  alertasActivas:  number;
}

export class ProbarConexionDto {
  ipAddress:       string;
  usuario:         string;
  contrasena:      string;
  puertoApi?:      number;
  useSsl?:         boolean;
  routerAccesoId?: string;
}


// ─── DTO crear dispositivo ────────────────────────────────────
export class CreateDispositivoDto {
  nombreEmisor:        string;
  ipAddress:           string;
  routerAccesoId?:     string;
  tipoEquipo:          TipoEquipo;
  fabricante:          Fabricante;
  modeloNombre?:       string;
  usuario?:            string;
  contrasena?:         string;
  puertoApi?:          number;
  useSsl?:             boolean;
  monitoreoSnmp?:      boolean;
  intervaloChequeoSeg?: number;
}


export class FiltroAlertaQuery {
  status?: string;
  nivel?:  string;
  page?:   number;
  limit?:  number;
}

export class ResolverAlertaDto {
  motivo?: string;
}

export class CreateUmbralDto {
  dispositivoId?:           string;
  tipoEquipo?:              TipoEquipo;
  nombre?:                  string;
  latenciaMaxMs?:           number;
  lossMaxPct?:              number;
  cpuMaxPct?:               number;
  memoryMaxPct?:            number;
  trafficDownMaxBps?:       string;
  trafficUpMaxBps?:         string;
  nivelAlerta?:             string;
  confirmacionesRequeridas?: number;
}

@Injectable()
export class MonitoreoService {
  private readonly logger = new Logger(MonitoreoService.name);

  constructor(
    @InjectRepository(DispositivoMonitoreo)
    private readonly dispoRepo: Repository<DispositivoMonitoreo>,

    @InjectRepository(MetricasMonitoreo)
    private readonly metricasRepo: Repository<MetricasMonitoreo>,

    @InjectRepository(AlertaSistema)
    private readonly alertaRepo: Repository<AlertaSistema>,

    @InjectDataSource()
    private readonly ds: DataSource,

    private readonly worker: MonitoreoWorkerService,
    private readonly pool: RouterConnectionPool,

    @InjectRepository(UmbralAlerta)
    private readonly umbralRepo: Repository<UmbralAlerta>,
  ) {}

  // ═══════════════════════════════════════════════════════════════
  // GET /monitoreo/tiempo-real
  // Retorna resumen global + lista de dispositivos con su última métrica
  // ═══════════════════════════════════════════════════════════════
  async getTiempoReal(empresaId: string): Promise<StdResponse<ResumenTiempoReal>> {
    // La vista v_estado_dispositivos ya hace el LATERAL JOIN con la última métrica
    const filas: any[] = await this.ds.query(
      `SELECT * FROM v_estado_dispositivos
       WHERE empresa_id = $1
       ORDER BY
         CASE status
           WHEN 'OFFLINE'       THEN 1
           WHEN 'REVERIFICANDO' THEN 2
           WHEN 'DEGRADADO'     THEN 3
           ELSE 4
         END,
         nombre_emisor ASC`,
      [empresaId],
    );

    const totales = {
      online:        0,
      offline:       0,
      reverificando: 0,
      degradado:     0,
      alertasActivas: 0,
    };

    let totalDown = 0;
    let totalUp   = 0;

    const dispositivos: DispositivoConMetrica[] = filas.map(r => {
      switch (r.status) {
        case StatusDispositivo.ONLINE:        totales.online++;        break;
        case StatusDispositivo.OFFLINE:       totales.offline++;       break;
        case StatusDispositivo.REVERIFICANDO: totales.reverificando++; break;
        case StatusDispositivo.DEGRADADO:     totales.degradado++;     break;
      }
      totales.alertasActivas += Number(r.alertas_activas ?? 0);
      totalDown += Number(r.traffic_down_bps ?? 0);
      totalUp   += Number(r.traffic_up_bps   ?? 0);

      return {
        id:              r.id,
        nombreEmisor:    r.nombre_emisor,
        ipAddress:       r.ip_address,
        tipoEquipo:      r.tipo_equipo,
        fabricante:      r.fabricante,
        status:          r.status,
        lastSeenAt:      r.last_seen_at,
        pingLatenciaMs:  r.ping_latencia_ms  !== null ? Number(r.ping_latencia_ms)  : null,
        pingLossPct:     r.ping_loss_pct     !== null ? Number(r.ping_loss_pct)     : null,
        cpuUsagePct:     r.cpu_usage_pct     !== null ? Number(r.cpu_usage_pct)     : null,
        memoryUsagePct:  r.memory_usage_pct  !== null ? Number(r.memory_usage_pct)  : null,
        trafficDownBps:  r.traffic_down_bps  ?? null,
        trafficUpBps:    r.traffic_up_bps    ?? null,
        ultimaMetricaAt: r.ultima_metrica_at ?? null,
        alertasActivas:  Number(r.alertas_activas ?? 0),
      };
    });

    return StdResponse.ok({
      totales,
      traficoBps: { totalDown, totalUp },
      dispositivos,
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // GET /monitoreo/dispositivos/:id/clientes
  // Consulta en vivo la tabla de registro inalámbrico del AP
  // ═══════════════════════════════════════════════════════════════
  async getClientesConectados(
    id:        string,
    empresaId: string,
  ): Promise<StdResponse<WirelessClient[]>> {
    const d = await this.dispoRepo.findOne({
      where: { id, empresaId, deletedAt: IsNull() },
    });
    if (!d) throw new NotFoundException(`Dispositivo ${id} no encontrado`);

    if (d.fabricante !== Fabricante.MIKROTIK) {
      throw new BadRequestException(
        'La consulta de clientes inalámbricos solo está disponible para dispositivos MikroTik',
      );
    }
    if (d.tipoEquipo !== TipoEquipo.ANTENA_AP) {
      throw new BadRequestException(
        'Este dispositivo no es una Antena AP. Solo las ANTENA_AP tienen tabla de registro inalámbrico',
      );
    }

    const clientes = await this.worker.getClientesWireless(d);
    return StdResponse.ok(clientes);
  }

  // ═══════════════════════════════════════════════════════════════
  // POST /monitoreo/dispositivos/probar-conexion
  // Valida credenciales MikroTik antes de guardar un dispositivo
  // ═══════════════════════════════════════════════════════════════
  async probarConexion(
    dto: ProbarConexionDto,
  ): Promise<StdResponse<ProbarConexionResult>> {
    if (!dto.ipAddress?.trim()) {
      return StdResponse.ok({ conectado: false, error: 'La dirección IP es requerida. Completa el campo antes de probar.' });
    }
    const port = dto.useSsl ? 8729 : (dto.puertoApi ?? 8728);

    // Construimos creds temporales: encrypt la contraseña en caliente
    const tempCreds = {
      id:              'test',
      ip:              dto.ipAddress,
      port,
      user:            dto.usuario,
      passwordCifrado: encrypt(dto.contrasena),
      useSsl:          dto.useSsl ?? false,
      timeoutSec:      8,
      version:         'v6' as const,
    };

    try {
      const info = await this.pool.execute(tempCreds, async (api: any) => {
        const [res]  = await api.write('/system/resource/print');
        const [ident] = await api.write('/system/identity/print');

        return {
          identidad:    ident?.name          ?? '',
          plataforma:   res?.platform        ?? '',
          version:      res?.version         ?? '',
          arquitectura: res?.['architecture-name'] ?? '',
          cpuLoad:      parseInt(res?.['cpu-load'] ?? '0', 10),
          uptime:       res?.uptime          ?? '',
          totalMemMb:   Math.round(parseInt(res?.['total-memory'] ?? '0', 10) / 1024 / 1024),
        };
      });

      return StdResponse.ok({ conectado: true, info });

    } catch (err: any) {
      // No lanzamos excepción — retornamos el error descriptivo al frontend
      this.logger.warn(
        `probarConexion ${dto.ipAddress}:${port} → ${err.message}`,
      );
      return StdResponse.ok({
        conectado: false,
        error:     this.mapearErrorConexion(err.message),
      });
    }
  }

  // ─── Mapeo de errores RouterOS a mensajes amigables ───────────
  private mapearErrorConexion(msg: string): string {
    if (msg.includes('ECONNREFUSED'))
      return `Conexión rechazada en ${msg.match(/\d+\.\d+\.\d+\.\d+/)?.[0] ?? 'la IP'}. Verifica el puerto y que la API esté habilitada en RouterOS.`;
    if (msg.includes('ETIMEDOUT') || msg.includes('timeout'))
      return 'Tiempo de espera agotado. Verifica que la IP sea accesible y que el firewall permita el puerto de la API.';
    if (msg.includes('ENOTFOUND'))
      return 'Host no encontrado. Verifica la dirección IP.';
    if (msg.includes('invalid user') || msg.includes('login failure'))
      return 'Credenciales incorrectas. Verifica usuario y contraseña.';
    return `Error de conexión: ${msg}`;
  }
  // POST /monitoreo/dispositivos
  async createDispositivo(
    dto:       CreateDispositivoDto,
    empresaId: string,
  ): Promise<StdResponse<DispositivoMonitoreo>> {
    const existe = await this.dispoRepo.findOne({
      where: { ipAddress: dto.ipAddress, empresaId, deletedAt: IsNull() },
    });
    if (existe)
      throw new BadRequestException(
        'Ya existe un dispositivo con la IP ' + dto.ipAddress + ' en esta empresa',
      );
    const d = this.dispoRepo.create({
      empresaId,
      nombreEmisor:        dto.nombreEmisor,
      ipAddress:           dto.ipAddress,
      routerAccesoId:      dto.routerAccesoId  || undefined,
      tipoEquipo:          dto.tipoEquipo,
      fabricante:          dto.fabricante,
      modeloNombre:        dto.modeloNombre    || undefined,
      usuario:             dto.usuario         || undefined,
      contrasenaCifrada:   dto.contrasena ? encrypt(dto.contrasena) : undefined,
      puertoApi:           dto.puertoApi       ?? 8728,
      useSsl:              dto.useSsl          ?? false,
      monitoreoSnmp:       dto.monitoreoSnmp   ?? false,
      intervaloChequeoSeg: dto.intervaloChequeoSeg ?? 60,
      status:              StatusDispositivo.ONLINE,
    });
    await this.dispoRepo.save(d);
    return StdResponse.ok(d);
  }
  // ═══════════════════════════════════════════════════════════════
  // GET /monitoreo/dispositivos
  // ═══════════════════════════════════════════════════════════════
  async getDispositivos(empresaId: string) {
    const list = await this.dispoRepo.find({
      where: { empresaId, deletedAt: IsNull() },
      order: { nombreEmisor: 'ASC' },
    });
    return StdResponse.ok(list);
  }

  // ═══════════════════════════════════════════════════════════════
  // GET /monitoreo/alertas
  // ═══════════════════════════════════════════════════════════════
  async getAlertas(empresaId: string, filtro: FiltroAlertaQuery) {
    const qb = this.alertaRepo.createQueryBuilder('a')
      .leftJoinAndSelect('a.dispositivo', 'd')
      .where('a.empresa_id = :eid', { eid: empresaId });

    if (filtro.status) qb.andWhere('a.status = :status', { status: filtro.status });
    if (filtro.nivel)  qb.andWhere('a.nivel  = :nivel',  { nivel:  filtro.nivel  });

    const page  = filtro.page  ?? 1;
    const limit = filtro.limit ?? 50;
    qb.orderBy('a.created_at', 'DESC').skip((page - 1) * limit).take(limit);

    const [items, total] = await qb.getManyAndCount();
    return StdResponse.ok({ items, total, page, limit });
  }

  // ═══════════════════════════════════════════════════════════════
  // PATCH /monitoreo/alertas/:id/resolver
  // ═══════════════════════════════════════════════════════════════
  async resolverAlerta(
    id: string, empresaId: string, userId: string, dto: ResolverAlertaDto,
  ) {
    const alerta = await this.alertaRepo.findOne({ where: { id, empresaId } });
    if (!alerta) throw new NotFoundException('Alerta no encontrada');
    if (alerta.status === StatusAlerta.RESUELTA)
      throw new BadRequestException('La alerta ya fue resuelta');
    alerta.status        = StatusAlerta.RESUELTA;
    alerta.resueltoAt    = new Date();
    alerta.resueltoPorId = userId;
    await this.alertaRepo.save(alerta);
    return StdResponse.ok(alerta);
  }

  // ═══════════════════════════════════════════════════════════════
  // GET /monitoreo/umbrales
  // ═══════════════════════════════════════════════════════════════
  async getUmbrales(empresaId: string, dispositivoId?: string) {
    const where: any = { empresaId, deletedAt: IsNull() };
    if (dispositivoId) where.dispositivoId = dispositivoId;
    const list = await this.umbralRepo.find({ where, order: { createdAt: 'ASC' } });
    return StdResponse.ok(list);
  }

  // ═══════════════════════════════════════════════════════════════
  // POST /monitoreo/umbrales
  // ═══════════════════════════════════════════════════════════════
  async createUmbral(dto: CreateUmbralDto, empresaId: string) {
    const u = this.umbralRepo.create({ ...dto, empresaId });
    await this.umbralRepo.save(u);
    return StdResponse.ok(u);
  }

  // ═══════════════════════════════════════════════════════════════
  // PATCH /monitoreo/umbrales/:id
  // ═══════════════════════════════════════════════════════════════
  async updateUmbral(id: string, empresaId: string, dto: Partial<CreateUmbralDto>) {
    const u = await this.umbralRepo.findOne({ where: { id, empresaId, deletedAt: IsNull() } });
    if (!u) throw new NotFoundException('Umbral no encontrado');
    Object.assign(u, dto);
    await this.umbralRepo.save(u);
    return StdResponse.ok(u);
  }

  // ═══════════════════════════════════════════════════════════════
  // DELETE /monitoreo/umbrales/:id
  // ═══════════════════════════════════════════════════════════════
  async deleteUmbral(id: string, empresaId: string) {
    const u = await this.umbralRepo.findOne({ where: { id, empresaId, deletedAt: IsNull() } });
    if (!u) throw new NotFoundException('Umbral no encontrado');
    await this.umbralRepo.softDelete(id);
    return StdResponse.ok({ deleted: true });
  }


}



export interface ProbarConexionResult {
  conectado: boolean;
  info?: {
    identidad:    string;
    plataforma:   string;
    version:      string;
    arquitectura: string;
    cpuLoad:      number;
    uptime:       string;
    totalMemMb:   number;
  };
  error?: string;
}
