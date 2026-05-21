import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { QUEUES } from '../workers/workers.constants';

interface CleanupResult {
  tarea:    string;
  eliminados: number;
  duracionMs: number;
}

@Injectable()
export class MantenimientoService {
  private readonly logger = new Logger(MantenimientoService.name);

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    @InjectQueue(QUEUES.COBRANZA)       private readonly qCobranza:      Queue,
    @InjectQueue(QUEUES.FACTURACION)    private readonly qFacturacion:    Queue,
    @InjectQueue(QUEUES.NOTIFICACIONES) private readonly qNotificaciones: Queue,
    @InjectQueue(QUEUES.MIKROTIK)       private readonly qMikrotik:       Queue,
    @InjectQueue(QUEUES.GOOGLE_SYNC)    private readonly qGoogle:         Queue,
  ) {}

  // Ejecuta todos los días a las 03:00 AM hora del servidor
  @Cron('0 3 * * *', { name: 'mantenimiento-diario', timeZone: 'America/Lima' })
  async ejecutarMantenimientoDiario(): Promise<void> {
    const inicio = Date.now();
    this.logger.log('━━━ Inicio mantenimiento diario ━━━');

    const resultados: CleanupResult[] = await Promise.all([
      this.limpiarAuditoriaLogs(),
      this.limpiarEntityVersions(),
      this.limpiarNodosMediciones(),
      this.limpiarGoogleSyncLogs(),
      this.limpiarBackupsResiduals(),
      this.limpiarNotificacionesLeidas(),
      this.limpiarVpnTokensExpirados(),
      this.limpiarGoogleAccountsHuerfanas(),
      this.limpiarBullQueues(),
    ]);

    const totalEliminados = resultados.reduce((s, r) => s + r.eliminados, 0);
    const duracionTotal   = Date.now() - inicio;

    resultados.forEach(r => {
      if (r.eliminados > 0) {
        this.logger.log(`  ✓ ${r.tarea}: ${r.eliminados} registros (${r.duracionMs}ms)`);
      }
    });

    this.logger.log(`━━━ Fin mantenimiento: ${totalEliminados} registros depurados en ${duracionTotal}ms ━━━`);
  }

  // ── Limpieza individual (también llamables manualmente) ────

  async limpiarAuditoriaLogs(): Promise<CleanupResult> {
    const t = Date.now();
    const r = await this.db.query(
      `DELETE FROM auditoria_logs WHERE created_at < NOW() - INTERVAL '90 days'`,
    );
    return { tarea: 'auditoria_logs >90d', eliminados: r[1] ?? 0, duracionMs: Date.now() - t };
  }

  async limpiarEntityVersions(): Promise<CleanupResult> {
    const t = Date.now();
    const r = await this.db.query(
      `DELETE FROM entity_versions WHERE created_at < NOW() - INTERVAL '90 days'`,
    );
    return { tarea: 'entity_versions >90d', eliminados: r[1] ?? 0, duracionMs: Date.now() - t };
  }

  async limpiarNodosMediciones(): Promise<CleanupResult> {
    const t = Date.now();
    // Preserva 7 días raw. Para histórico de largo plazo se puede agregar por hora en una tabla separada.
    const r = await this.db.query(
      `DELETE FROM nodos_mediciones WHERE timestamp < NOW() - INTERVAL '7 days'`,
    );
    return { tarea: 'nodos_mediciones >7d', eliminados: r[1] ?? 0, duracionMs: Date.now() - t };
  }

  async limpiarGoogleSyncLogs(): Promise<CleanupResult> {
    const t = Date.now();
    const r = await this.db.query(
      `DELETE FROM google_sync_logs WHERE created_at < NOW() - INTERVAL '30 days'`,
    );
    return { tarea: 'google_sync_logs >30d', eliminados: r[1] ?? 0, duracionMs: Date.now() - t };
  }

  async limpiarBackupsResiduals(): Promise<CleanupResult> {
    const t = Date.now();
    // Marcar como error los backups que llevan >2h en progreso (proceso murió)
    await this.db.query(`
      UPDATE backups
      SET estado = 'error', error_mensaje = 'Proceso interrumpido — detectado por mantenimiento'
      WHERE estado = 'en_progreso' AND created_at < NOW() - INTERVAL '2 hours'
    `);
    // Eliminar registros de error con >7 días (no hay archivo útil asociado)
    const r = await this.db.query(
      `DELETE FROM backups WHERE estado = 'error' AND created_at < NOW() - INTERVAL '7 days'`,
    );
    return { tarea: 'backups residuales', eliminados: r[1] ?? 0, duracionMs: Date.now() - t };
  }

  async limpiarNotificacionesLeidas(): Promise<CleanupResult> {
    const t = Date.now();
    const r = await this.db.query(`
      DELETE FROM notificaciones
      WHERE estado IN ('leida', 'entregada')
        AND leida_en IS NOT NULL
        AND created_at < NOW() - INTERVAL '30 days'
    `);
    return { tarea: 'notificaciones leídas >30d', eliminados: r[1] ?? 0, duracionMs: Date.now() - t };
  }

  async limpiarVpnTokensExpirados(): Promise<CleanupResult> {
    const t = Date.now();
    // Limpiar tokens de descarga vencidos (la config ya se descargó o el link expiró)
    await this.db.query(`
      UPDATE vpn_clientes
      SET token_descarga = NULL, token_expires_at = NULL
      WHERE token_expires_at IS NOT NULL AND token_expires_at < NOW()
    `);
    // Marcar como revocados los clientes VPN en pendiente por más de 24h (wizard abandonado)
    const r = await this.db.query(`
      UPDATE vpn_clientes
      SET estado = 'revocado'
      WHERE estado = 'pendiente' AND created_at < NOW() - INTERVAL '24 hours'
      RETURNING id
    `);
    const revocados = Array.isArray(r) ? r[0]?.length ?? 0 : 0;
    return { tarea: 'vpn tokens/pendientes', eliminados: revocados, duracionMs: Date.now() - t };
  }

  async limpiarGoogleAccountsHuerfanas(): Promise<CleanupResult> {
    const t = Date.now();
    // Filas con status DISCONNECTED y sin tokens — son de wizards cancelados sin cleanup
    const r = await this.db.query(`
      DELETE FROM google_accounts
      WHERE status = 'disconnected'
        AND (tokens_encrypted IS NULL OR tokens_encrypted = '')
        AND updated_at < NOW() - INTERVAL '1 hour'
    `);
    return { tarea: 'google_accounts huérfanas', eliminados: r[1] ?? 0, duracionMs: Date.now() - t };
  }

  async limpiarBullQueues(): Promise<CleanupResult> {
    const t = Date.now();
    const queues = [
      this.qCobranza, this.qFacturacion,
      this.qNotificaciones, this.qMikrotik, this.qGoogle,
    ];

    let total = 0;
    for (const q of queues) {
      try {
        // Jobs fallidos >24h: no tienen sentido reintentar, son datos de diagnóstico ya logueados
        const failed    = await q.clean(24 * 60 * 60 * 1000, 'failed');
        // Jobs completados >1h: ya procesados, no necesitan quedar en Redis
        const completed = await q.clean(60 * 60 * 1000, 'completed');
        // Jobs activos >30min: proceso murió sin liberar el job
        const active    = await q.clean(30 * 60 * 1000, 'active');
        total += (failed.length + completed.length + active.length);
      } catch { /* queue vacía o Redis no disponible — no crítico */ }
    }

    return { tarea: 'bull queues', eliminados: total, duracionMs: Date.now() - t };
  }
}
