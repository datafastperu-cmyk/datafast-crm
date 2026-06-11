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
import { RouterConnectionPool, RouterCredentials }  from '../mikrotik/services/connection-pool.service';
import { WirelessService }       from '../mikrotik/services/wireless.service';
import { ApiResponse as StdResponse } from '../../common/dto/response.dto';
import { IsBoolean, IsEnum, IsIP, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { encrypt, decrypt }      from '../../common/utils/encryption.util';

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
  @IsIP() @IsNotEmpty()
  ipAddress:       string;
  @IsString() @IsNotEmpty()
  usuario:         string;
  @IsString() @IsNotEmpty()
  contrasena:      string;
  @IsOptional() @IsNumber()
  puertoApi?:      number;
  @IsOptional() @IsBoolean()
  useSsl?:         boolean;
  @IsOptional() @IsString()
  routerAccesoId?: string;
}


// ─── DTO crear dispositivo ────────────────────────────────────
export class CreateDispositivoDto {
  @IsString() @IsNotEmpty()
  nombreEmisor:        string;
  @IsIP() @IsNotEmpty()
  ipAddress:           string;
  @IsOptional() @IsString()
  routerAccesoId?:     string;
  @IsString() @IsNotEmpty()
  tipoEquipo:          TipoEquipo;
  @IsString() @IsNotEmpty()
  fabricante:          Fabricante;
  @IsOptional() @IsString()
  modeloNombre?:       string;
  @IsOptional() @IsString()
  usuario?:            string;
  @IsOptional() @IsString()
  contrasena?:         string;
  @IsOptional() @IsNumber()
  puertoApi?:          number;
  @IsOptional() @IsBoolean()
  useSsl?:             boolean;
  @IsOptional() @IsBoolean()
  monitoreoSnmp?:      boolean;
  @IsOptional() @IsNumber() @Min(30)
  intervaloChequeoSeg?: number;
}


export class UpdateDispositivoDto {
  @IsOptional() @IsString()
  nombreEmisor?:        string;
  @IsOptional() @IsIP()
  ipAddress?:           string;
  @IsOptional() @IsString()
  routerAccesoId?:      string | null;
  @IsOptional() @IsString()
  tipoEquipo?:          TipoEquipo;
  @IsOptional() @IsString()
  fabricante?:          Fabricante;
  @IsOptional() @IsString()
  modeloNombre?:        string | null;
  @IsOptional() @IsString()
  usuario?:             string | null;
  @IsOptional() @IsString()
  contrasena?:          string;
  @IsOptional() @IsNumber()
  puertoApi?:           number;
  @IsOptional() @IsBoolean()
  useSsl?:              boolean;
  @IsOptional() @IsBoolean()
  monitoreoSnmp?:       boolean;
  @IsOptional() @IsNumber() @Min(30)
  intervaloChequeoSeg?: number;
}

export class FiltroAlertaQuery {
  @IsOptional() @IsEnum(StatusAlerta)
  status?: StatusAlerta;
  @IsOptional() @IsEnum(NivelAlerta)
  nivel?:  NivelAlerta;
  @IsOptional() @IsNumber()
  page?:   number;
  @IsOptional() @IsNumber()
  limit?:  number;
}

export class ResolverAlertaDto {
  @IsOptional() @IsString()
  motivo?: string;
}

export class CreateUmbralDto {
  @IsOptional() @IsString()
  dispositivoId?:           string;
  @IsOptional() @IsString()
  tipoEquipo?:              TipoEquipo;
  @IsOptional() @IsString()
  nombre?:                  string;
  @IsOptional() @IsNumber()
  latenciaMaxMs?:           number;
  @IsOptional() @IsNumber()
  lossMaxPct?:              number;
  @IsOptional() @IsNumber()
  cpuMaxPct?:               number;
  @IsOptional() @IsNumber()
  memoryMaxPct?:            number;
  @IsOptional() @IsString()
  trafficDownMaxBps?:       string;
  @IsOptional() @IsString()
  trafficUpMaxBps?:         string;
  @IsOptional() @IsString()
  nivelAlerta?:             string;
  @IsOptional() @IsNumber()
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
    private readonly wirelessSvc: WirelessService,

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
      // C5: iniciar como REVERIFICANDO; el worker determina el estado real en el primer ciclo
      status:              StatusDispositivo.REVERIFICANDO,
    });
    await this.dispoRepo.save(d);
    const { contrasenaCifrada: _pw, ...safeCreate } = d;
    return StdResponse.ok(safeCreate as unknown as DispositivoMonitoreo);
  }
  // ═══════════════════════════════════════════════════════════════
  // GET /monitoreo/dispositivos
  // ═══════════════════════════════════════════════════════════════
  async getDispositivos(empresaId: string) {
    const list = await this.dispoRepo.find({
      where: { empresaId, deletedAt: IsNull() },
      order: { nombreEmisor: 'ASC' },
    });
    // S1: no exponer contrasenaCifrada en la respuesta
    const safe = list.map(({ contrasenaCifrada: _pw, ...d }) => d);
    return StdResponse.ok(safe);
  }

  // ═══════════════════════════════════════════════════════════════
  // GET /monitoreo/dispositivos/:id
  // ═══════════════════════════════════════════════════════════════
  async findDispositivo(id: string, empresaId: string) {
    const d = await this.dispoRepo.findOne({ where: { id, empresaId, deletedAt: IsNull() } });
    if (!d) throw new NotFoundException(`Dispositivo ${id} no encontrado`);
    // S1: no exponer contrasenaCifrada en la respuesta
    const { contrasenaCifrada: _pw, ...safe } = d;
    return StdResponse.ok(safe);
  }

  // ═══════════════════════════════════════════════════════════════
  // PATCH /monitoreo/dispositivos/:id
  // ═══════════════════════════════════════════════════════════════
  async updateDispositivo(id: string, empresaId: string, dto: UpdateDispositivoDto) {
    const d = await this.dispoRepo.findOne({ where: { id, empresaId, deletedAt: IsNull() } });
    if (!d) throw new NotFoundException(`Dispositivo ${id} no encontrado`);

    const { contrasena, ...rest } = dto;

    if (rest.nombreEmisor  !== undefined) d.nombreEmisor  = rest.nombreEmisor;
    if (rest.ipAddress     !== undefined) d.ipAddress     = rest.ipAddress;
    if ('routerAccesoId'   in  rest)      d.routerAccesoId = rest.routerAccesoId ?? null;
    if (rest.tipoEquipo    !== undefined) d.tipoEquipo    = rest.tipoEquipo;
    if (rest.fabricante    !== undefined) d.fabricante    = rest.fabricante;
    if ('modeloNombre'     in  rest)      d.modeloNombre  = rest.modeloNombre ?? null;
    if ('usuario'          in  rest)      d.usuario       = rest.usuario ?? null;
    if (rest.puertoApi     !== undefined) d.puertoApi     = rest.puertoApi;
    if (rest.useSsl        !== undefined) d.useSsl        = rest.useSsl;
    if (rest.monitoreoSnmp !== undefined) d.monitoreoSnmp = rest.monitoreoSnmp;
    if (rest.intervaloChequeoSeg !== undefined) d.intervaloChequeoSeg = rest.intervaloChequeoSeg;

    if (contrasena && contrasena !== '***stored***') {
      d.contrasenaCifrada = encrypt(contrasena);
    }

    await this.dispoRepo.save(d);
    // S1: no exponer contrasenaCifrada en la respuesta
    const { contrasenaCifrada: _pw, ...safe } = d;
    return StdResponse.ok(safe);
  }

  // ═══════════════════════════════════════════════════════════════
  // DELETE /monitoreo/dispositivos/:id
  // ═══════════════════════════════════════════════════════════════
  async deleteDispositivo(id: string, empresaId: string) {
    const d = await this.dispoRepo.findOne({ where: { id, empresaId, deletedAt: IsNull() } });
    if (!d) throw new NotFoundException(`Dispositivo ${id} no encontrado`);

    const [{ count }] = await this.ds.query(
      `SELECT COUNT(*) as count FROM contratos
       WHERE antena_ap_id = $1 AND deleted_at IS NULL
         AND estado IN ('activo','suspendido_mora','suspendido_manual','prorroga','pendiente_instalacion')`,
      [id],
    );
    if (Number(count) > 0) {
      throw new BadRequestException(
        `No es posible eliminar "${d.nombreEmisor}" porque tiene ${count} abonado(s) vinculado(s). ` +
        `Reasigna o elimina los abonados antes de continuar.`,
      );
    }

    await this.dispoRepo.softDelete(id);
    return StdResponse.ok({ deleted: true });
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
    // U1: verificar que dispositivoId pertenece a la misma empresa
    if (dto.dispositivoId) {
      const dispo = await this.dispoRepo.findOne({
        where: { id: dto.dispositivoId, empresaId, deletedAt: IsNull() },
      });
      if (!dispo) {
        throw new BadRequestException(
          `Dispositivo ${dto.dispositivoId} no encontrado en esta empresa`,
        );
      }
    }
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

    // U3: asignación explícita para evitar sobreescritura de campos protegidos (empresaId, etc.)
    if (dto.dispositivoId  !== undefined) u.dispositivoId  = dto.dispositivoId  ?? null;
    if (dto.tipoEquipo     !== undefined) u.tipoEquipo     = dto.tipoEquipo     ?? null;
    if (dto.nombre         !== undefined) u.nombre         = dto.nombre         ?? null;
    if (dto.latenciaMaxMs  !== undefined) u.latenciaMaxMs  = dto.latenciaMaxMs  ?? null;
    if (dto.lossMaxPct     !== undefined) u.lossMaxPct     = dto.lossMaxPct     ?? null;
    if (dto.cpuMaxPct      !== undefined) u.cpuMaxPct      = dto.cpuMaxPct      ?? null;
    if (dto.memoryMaxPct   !== undefined) u.memoryMaxPct   = dto.memoryMaxPct   ?? null;
    if (dto.trafficDownMaxBps !== undefined) u.trafficDownMaxBps = dto.trafficDownMaxBps ?? null;
    if (dto.trafficUpMaxBps   !== undefined) u.trafficUpMaxBps   = dto.trafficUpMaxBps   ?? null;
    if (dto.nivelAlerta    !== undefined) u.nivelAlerta    = dto.nivelAlerta;
    if (dto.confirmacionesRequeridas !== undefined) u.confirmacionesRequeridas = dto.confirmacionesRequeridas;

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

  // ═══════════════════════════════════════════════════════════════
  // POST /monitoreo/dispositivos/:id/reparar
  // Re-registra MACs y comentarios de todos los abonados activos
  // vinculados a una Antena AP en su Access List inalámbrica.
  // ═══════════════════════════════════════════════════════════════
  async repararAntenaAP(
    id:        string,
    empresaId: string,
  ): Promise<StdResponse<{ total: number; ok: number; errores: { contrato: string; mac: string; error: string }[] }>> {
    const d = await this.dispoRepo.findOne({
      where: { id, empresaId, deletedAt: IsNull() },
    });
    if (!d) throw new NotFoundException(`Dispositivo ${id} no encontrado`);
    if (d.tipoEquipo !== TipoEquipo.ANTENA_AP) {
      throw new BadRequestException('Solo se puede reparar dispositivos de tipo ANTENA_AP');
    }
    if (d.status !== StatusDispositivo.ONLINE) {
      throw new BadRequestException(`La antena "${d.nombreEmisor}" está offline — no se puede reparar`);
    }
    if (!d.contrasenaCifrada) {
      throw new BadRequestException(`La antena "${d.nombreEmisor}" no tiene credenciales configuradas`);
    }

    const creds: RouterCredentials = {
      id:              d.id,
      ip:              d.ipAddress,
      port:            d.useSsl ? 8729 : d.puertoApi,
      user:            d.usuario ?? 'admin',
      passwordCifrado: d.contrasenaCifrada,
      useSsl:          d.useSsl,
      timeoutSec:      10,
      version:         'v6',
    };

    // Obtener todos los contratos activos vinculados a esta antena con MAC
    const contratos: { numeroContrato: string; mac: string; nombre: string }[] = await this.ds.query(
      `SELECT co.numero_contrato AS "numeroContrato",
              co.mac_address     AS "mac",
              cl.nombre_completo AS "nombre"
       FROM   contratos co
       JOIN   clientes cl ON cl.id = co.cliente_id
       WHERE  co.antena_ap_id = $1
         AND  co.mac_address IS NOT NULL
         AND  co.mac_address != ''
         AND  co.deleted_at IS NULL
         AND  co.estado IN ('activo','suspendido_mora','suspendido_manual','prorroga','pendiente_instalacion')`,
      [id],
    );

    let ok = 0;
    const errores: { contrato: string; mac: string; error: string }[] = [];

    for (const c of contratos) {
      try {
        await this.wirelessSvc.agregarMacAccessList(creds, c.mac, `DATAFAST:${c.nombre}`);
        ok++;
        this.logger.log(`[repararAntenaAP] ${d.nombreEmisor} | MAC ${c.mac} → ${c.nombre} ✓`);
      } catch (err: any) {
        errores.push({ contrato: c.numeroContrato, mac: c.mac, error: err.message });
        this.logger.warn(`[repararAntenaAP] ${d.nombreEmisor} | MAC ${c.mac} error: ${err.message}`);
      }
    }

    return StdResponse.ok(
      { total: contratos.length, ok, errores },
      `Reparación completada: ${ok}/${contratos.length} MACs registradas`,
    );
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
