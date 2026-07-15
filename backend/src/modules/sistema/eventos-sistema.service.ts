import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';

export type NivelEvento  = 'critical' | 'error' | 'warn';
export type OrigenEvento =
  | 'api' | 'db' | 'olt' | 'mikrotik' | 'whatsapp'
  | 'scheduler' | 'vpn' | 'update' | 'integracion';

export interface RegistrarEventoDto {
  nivel?:    NivelEvento;
  origen?:   OrigenEvento;
  codigo?:   string | null;
  mensaje:   string;
  stack?:    string | null;
  contexto?: Record<string, unknown> | null;
}

export interface EventoSistema {
  id:           string;
  nivel:        NivelEvento;
  origen:       string;
  codigo:       string | null;
  mensaje:      string;
  stack:        string | null;
  contexto:     Record<string, unknown> | null;
  sincronizado: boolean;
  createdAt:    string;
}

const RETENCION_DIAS = 30;

// Registro persistente de errores de producción. `registrar()` es
// best-effort: nunca lanza — un fallo al guardar un evento jamás debe
// tumbar la operación que lo reporta.
@Injectable()
export class EventosSistemaService implements OnModuleInit {
  private readonly logger = new Logger(EventosSistemaService.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    if (process.env.RUN_CRONS !== 'true') return;
    const job = new CronJob('30 3 * * *', () => void this.purgarAntiguos(), null, true, 'America/Lima');
    this.schedulerRegistry.addCronJob('eventos-sistema-purga', job);
  }

  async registrar(dto: RegistrarEventoDto): Promise<void> {
    try {
      await this.ds.query(
        `INSERT INTO eventos_sistema (nivel, origen, codigo, mensaje, stack, contexto)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          dto.nivel ?? 'error',
          dto.origen ?? 'api',
          dto.codigo ?? null,
          (dto.mensaje || '(sin mensaje)').slice(0, 4000),
          dto.stack?.slice(0, 8000) ?? null,
          dto.contexto ? JSON.stringify(dto.contexto) : null,
        ],
      );
    } catch (err) {
      this.logger.warn(`No se pudo persistir evento: ${(err as Error).message}`);
    }
  }

  async listar(opts: {
    nivel?: string; origen?: string; page?: number; limit?: number;
  }): Promise<{ items: EventoSistema[]; total: number }> {
    const page  = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, Math.max(1, opts.limit ?? 25));
    const where: string[] = [];
    const params: unknown[] = [];

    if (opts.nivel)  { params.push(opts.nivel);  where.push(`nivel = $${params.length}`); }
    if (opts.origen) { params.push(opts.origen); where.push(`origen = $${params.length}`); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const totalRows: Array<{ total: string }> = await this.ds.query(
      `SELECT COUNT(*)::text AS total FROM eventos_sistema ${whereSql}`, params,
    );

    params.push(limit, (page - 1) * limit);
    const items: Array<Record<string, unknown>> = await this.ds.query(
      `SELECT id, nivel, origen, codigo, mensaje, stack, contexto, sincronizado,
              created_at AS "createdAt"
         FROM eventos_sistema ${whereSql}
        ORDER BY created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    return { items: items as unknown as EventoSistema[], total: parseInt(totalRows[0]?.total ?? '0', 10) };
  }

  // Tasa de errores desde una fecha — usada por la ventana de observación post-update.
  async contarDesde(desde: Date, niveles: NivelEvento[] = ['critical', 'error']): Promise<number> {
    try {
      const rows: Array<{ total: string }> = await this.ds.query(
        `SELECT COUNT(*)::text AS total FROM eventos_sistema
          WHERE created_at >= $1 AND nivel = ANY($2)`,
        [desde.toISOString(), niveles],
      );
      return parseInt(rows[0]?.total ?? '0', 10);
    } catch {
      return 0;
    }
  }

  async purgarAntiguos(): Promise<void> {
    try {
      const res = await this.ds.query(
        `DELETE FROM eventos_sistema WHERE created_at < now() - ($1 || ' days')::interval`,
        [String(RETENCION_DIAS)],
      );
      this.logger.log(`Purga de eventos_sistema completada (retención ${RETENCION_DIAS} días): ${JSON.stringify(res?.[1] ?? res)}`);
    } catch (err) {
      this.logger.warn(`Purga de eventos falló: ${(err as Error).message}`);
    }
  }
}
