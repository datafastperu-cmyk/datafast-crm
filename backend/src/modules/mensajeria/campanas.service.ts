import {
  Injectable, Logger, Inject, BadRequestException, OnModuleInit,
} from '@nestjs/common';
import { InjectDataSource }    from '@nestjs/typeorm';
import { InjectQueue }         from '@nestjs/bull';
import { DataSource }          from 'typeorm';
import { Queue }               from 'bull';
import { CACHE_MANAGER }       from '@nestjs/cache-manager';
import { Cache }               from 'cache-manager';
import { ModuleHealthService } from '../../common/services/module-health.service';

import {
  QUEUES, JOBS, JOB_OPTIONS, JOB_PRIORITIES,
  calcularDelayGoteo,
  PayloadCampanaItem,
} from '../workers/workers.constants';
import { CrearCampanaDto } from './dto/crear-campana.dto';

interface Destinatario {
  id:              string;
  whatsapp:        string;
  nombre_completo: string;
}

@Injectable()
export class CampanasService implements OnModuleInit {
  private readonly logger = new Logger(CampanasService.name);

  private degraded      = false;
  private degradedReason: string | null = null;

  constructor(
    @InjectDataSource()                    private readonly ds:    DataSource,
    @Inject(CACHE_MANAGER)                 private readonly cache: Cache,
    @InjectQueue(QUEUES.CAMPANAS)          private readonly queue: Queue,
    private readonly moduleHealth: ModuleHealthService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.ds.query(`SELECT 1 FROM clientes LIMIT 0`);
      this.moduleHealth.registrar('mensajeria', 'ok');
    } catch (err: any) {
      this.degraded       = true;
      this.degradedReason = err.message;
      this.moduleHealth.registrar('mensajeria', 'degraded', err.message);
    }
  }

  async iniciar(dto: CrearCampanaDto, empresaId: string) {
    if (this.degraded) {
      throw new BadRequestException(
        `Módulo de mensajería no disponible: ${this.degradedReason ?? 'error de esquema'}`,
      );
    }
    // 1. Segmentar destinatarios activos con WhatsApp
    const destinatarios = await this.segmentar(empresaId, dto.sectorId, dto.routerId);

    if (destinatarios.length === 0) {
      return { total: 0, encolados: 0, cuotaRestante: 0 };
    }

    // 2. Validar cuota diaria Redis
    const hoy      = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const cuotaKey = `cuota:whatsapp:nativo:${empresaId}:${hoy}`;

    const limiteDiario = await this.obtenerLimiteDiario(empresaId);
    const cuotaActual  = (await this.cache.get<number>(cuotaKey)) ?? 0;
    const restantes    = limiteDiario - cuotaActual;

    if (destinatarios.length > restantes) {
      throw new BadRequestException(
        `Cuota diaria superada. Disponibles hoy: ${restantes} de ${limiteDiario}. ` +
        `Lote solicitado: ${destinatarios.length} mensajes.`,
      );
    }

    // 3. Reservar cuota en Redis con TTL 24 h
    await this.cache.set(cuotaKey, cuotaActual + destinatarios.length, 24 * 60 * 60 * 1000);

    // 4. Inyectar un job por destinatario con goteo dinámico + jitter
    let encolados = 0;
    for (let i = 0; i < destinatarios.length; i++) {
      const d = destinatarios[i];
      const payload: PayloadCampanaItem = {
        empresaId,
        tipo:      dto.tipo,
        telefono:  d.whatsapp,
        variables: {
          clienteNombre: d.nombre_completo ?? '',
          ...(dto.variables ?? {}),
        },
        plantillaId: dto.templateId,
      };
      await this.queue.add(JOBS.CAMPANA_MASIVA, payload, {
        delay:    calcularDelayGoteo(i),
        priority: JOB_PRIORITIES.CAMPANA_MASIVA,
        ...JOB_OPTIONS.MASIVO,
      });
      encolados++;
    }

    const cuotaRestante = limiteDiario - (cuotaActual + encolados);
    this.logger.log(
      `[Campanas] ${encolados} jobs encolados | empresa=${empresaId} ` +
      `| sector=${dto.sectorId ?? '*'} | router=${dto.routerId ?? '*'} ` +
      `| cuotaRestante=${cuotaRestante}`,
    );
    return { total: destinatarios.length, encolados, cuotaRestante };
  }

  // ── Cuota diaria actual ─────────────────────────────────────
  async consultarCuota(empresaId: string) {
    const hoy          = new Date().toISOString().split('T')[0];
    const cuotaKey     = `cuota:whatsapp:nativo:${empresaId}:${hoy}`;
    const limiteDiario = await this.obtenerLimiteDiario(empresaId);
    const usado        = (await this.cache.get<number>(cuotaKey)) ?? 0;
    return { limiteDiario, usado, restante: limiteDiario - usado };
  }

  // ── Monitor: stats de logs de hoy ───────────────────────────
  async consultarMonitor(empresaId: string) {
    const hoy = new Date().toISOString().split('T')[0];
    const rows = await this.ds.query<{ estado: string; total: string }[]>(`
      SELECT estado_entrega AS estado, COUNT(*) AS total
      FROM notificaciones_logs
      WHERE created_at::date = $1::date
        AND canal = 'WHATSAPP'
      GROUP BY estado_entrega
    `, [hoy]);

    const stats: Record<string, number> = {};
    for (const r of rows) stats[r.estado] = parseInt(r.total, 10);

    return {
      encolados: stats['ENCOLADO']     ?? 0,
      enviados:  stats['ENVIADO'] ?? 0,
      fallidos:  stats['FALLIDO']      ?? 0,
      entregados: stats['ENTREGADO']   ?? 0,
    };
  }

  // ── Vaciar cola BullMQ ───────────────────────────────────────
  async vaciarCola(_empresaId: string) {
    const [waiting, delayed] = await Promise.all([
      this.queue.getWaiting(),
      this.queue.getDelayed(),
    ]);
    const jobs = [...waiting, ...delayed].filter(
      j => j.name === JOBS.CAMPANA_MASIVA,
    );
    await Promise.all(jobs.map(j => j.remove()));
    return { eliminados: jobs.length };
  }

  // ── QueryBuilder: abonados activos con WhatsApp, filtrados ──
  private async segmentar(
    empresaId: string,
    sectorId?: string,
    routerId?:  string,
  ): Promise<Destinatario[]> {
    const params: unknown[] = [empresaId];
    let sectorFilter = '';
    let routerFilter = '';

    if (sectorId) {
      params.push(sectorId);
      sectorFilter = `AND cl.zona_id = $${params.length}`;
    }
    if (routerId) {
      params.push(routerId);
      routerFilter = `AND co.router_id = $${params.length}`;
    }

    return this.ds.query<Destinatario[]>(`
      SELECT DISTINCT ON (cl.id)
        cl.id,
        cl.whatsapp,
        cl.nombre_completo
      FROM clientes cl
      INNER JOIN contratos co
        ON  co.cliente_id  = cl.id
        AND co.empresa_id  = $1
        AND co.estado      = 'activo'
      WHERE cl.empresa_id  = $1
        AND cl.whatsapp   IS NOT NULL
        AND cl.whatsapp   != ''
        ${sectorFilter}
        ${routerFilter}
      ORDER BY cl.id, cl.nombres
    `, params);
  }

  // ── Límite diario configurado en empresas (default 500) ────
  private async obtenerLimiteDiario(empresaId: string): Promise<number> {
    try {
      const [row] = await this.ds.query(
        `SELECT COALESCE(gateway_masivo_limite_diario, 500) AS limite FROM empresas WHERE id = $1`,
        [empresaId],
      );
      const limite = parseInt(row?.limite ?? '500', 10);
      return isNaN(limite) || limite <= 0 ? 500 : limite;
    } catch {
      return 500;
    }
  }
}
