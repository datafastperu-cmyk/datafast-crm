import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository }  from '@nestjs/typeorm';
import { Repository }        from 'typeorm';
import { EventEmitter2 }     from '@nestjs/event-emitter';

import { OltDispositivo }    from '../entities/olt-dispositivo.entity';
import { OltProveedorConfig } from '../entities/olt-proveedor-config.entity';
import { OltBoard }          from '../entities/olt-board.entity';
import { OltLineProfile }    from '../entities/olt-line-profile.entity';
import { OltServiceProfile } from '../entities/olt-service-profile.entity';
import { OltSyncJob, SyncJobEstado } from '../entities/olt-sync-job.entity';
import { OltVlan }           from '../entities/olt-vlan.entity';
import { OltTrafficTable }   from '../entities/olt-traffic-table.entity';
import { OltAutomationClient } from '../olt-automation.client';
import { ModuleHealthService } from '../../../common/services/module-health.service';
import { decrypt }           from '../../../common/utils/encryption.util';

// ─── Eventos WebSocket (emitidos por EventEmitter2, escuchados por OltGateway) ──
export const OLT_SYNC_PROGRESS  = 'olt.sync.progress';
export const OLT_SYNC_COMPLETED = 'olt.sync.completed';
export const OLT_SYNC_ERROR     = 'olt.sync.error';

export interface OltSyncProgressPayload {
  oltId:    string;
  jobId:    string;
  progreso: number;
  etapa:    string;
}

export interface OltSyncResultPayload {
  oltId:     string;
  jobId:     string;
  resultado: Record<string, unknown>;
}

export interface OltSyncErrorPayload {
  oltId:  string;
  jobId:  string;
  error:  string;
}

// ─────────────────────────────────────────────────────────────
// OltSyncService — Sincronización asíncrona OLT → ERP
//
// Llama a Python (wizardTopologia) y persiste boards, vlans,
// line_profiles, service_profiles y traffic_tables con upserts
// idempotentes. Emite eventos EventEmitter2 que OltGateway
// reenvía por WebSocket a la sala olt:{id}.
//
// Peor caso:
// - SSH timeout a mitad del sync → el job queda en 'failed', el
//   frontend recibe olt.sync.error, puede reintentar.
// - La OLT no tiene proveedor SSH → job falla inmediatamente.
// - Sync concurrente del mismo OLT → el segundo start() detecta
//   un job 'running' y retorna el jobId existente sin duplicar.
// ─────────────────────────────────────────────────────────────
@Injectable()
export class OltSyncService implements OnModuleInit {
  private readonly logger = new Logger(OltSyncService.name);

  constructor(
    @InjectRepository(OltDispositivo)
    private readonly oltRepo: Repository<OltDispositivo>,

    @InjectRepository(OltProveedorConfig)
    private readonly provRepo: Repository<OltProveedorConfig>,

    @InjectRepository(OltBoard)
    private readonly boardRepo: Repository<OltBoard>,

    @InjectRepository(OltLineProfile)
    private readonly lineProfileRepo: Repository<OltLineProfile>,

    @InjectRepository(OltServiceProfile)
    private readonly srvProfileRepo: Repository<OltServiceProfile>,

    @InjectRepository(OltSyncJob)
    private readonly syncJobRepo: Repository<OltSyncJob>,

    @InjectRepository(OltVlan)
    private readonly vlanRepo: Repository<OltVlan>,

    @InjectRepository(OltTrafficTable)
    private readonly trafficRepo: Repository<OltTrafficTable>,

    private readonly automation:   OltAutomationClient,
    private readonly moduleHealth: ModuleHealthService,
    private readonly events:       EventEmitter2,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      const health = await this.automation.health();
      if (health && (health as any).status === 'ok') {
        this.moduleHealth.registrar('olt-sync', 'ok');
      } else {
        this.moduleHealth.registrar('olt-sync', 'degraded', 'Python automation no reporta ok');
      }
    } catch {
      this.moduleHealth.registrar('olt-sync', 'degraded', 'Python automation no disponible');
    }
  }

  // ── API pública ───────────────────────────────────────────────

  /** Inicia un job de sincronización. Si ya hay uno 'running', retorna su id. */
  async iniciarSync(oltId: string, empresaId: string): Promise<{ jobId: string }> {
    const running = await this.syncJobRepo.findOne({
      where: { oltId, empresaId, estado: 'running' as SyncJobEstado },
    });
    if (running) return { jobId: running.id };

    const job = this.syncJobRepo.create({ oltId, empresaId, estado: 'running', progreso: 0 });
    await this.syncJobRepo.save(job);

    // Lanzar en background — no awaiteamos para responder rápido al cliente
    this._ejecutarSync(job.id, oltId, empresaId).catch(e => {
      this.logger.error(`[sync:${job.id}] Error no capturado: ${e?.message}`);
    });

    return { jobId: job.id };
  }

  /** Estado actual del último job para un OLT. */
  async estadoSync(oltId: string, empresaId: string): Promise<OltSyncJob | null> {
    return this.syncJobRepo.findOne({
      where: { oltId, empresaId },
      order: { iniciadoEn: 'DESC' },
    });
  }

  // ── Ejecución interna ─────────────────────────────────────────

  private async _ejecutarSync(jobId: string, oltId: string, empresaId: string): Promise<void> {
    const emit = (progreso: number, etapa: string) => {
      this.events.emit(OLT_SYNC_PROGRESS, { oltId, jobId, progreso, etapa } satisfies OltSyncProgressPayload);
      this.syncJobRepo.update(jobId, { progreso });
    };

    try {
      // 1. Obtener OLT y conexión SSH
      emit(5, 'Obteniendo credenciales…');
      const olt  = await this.oltRepo.findOneOrFail({ where: { id: oltId, empresaId } });
      const conn = await this._buildConn(oltId, empresaId, olt);

      // 2. Llamar a Python: topología completa
      emit(15, 'Conectando a la OLT…');
      const topo = await this.automation.wizardTopologia({ connection: conn });

      if (!topo.success) {
        throw new Error(topo.error ?? 'La OLT no devolvió topología');
      }

      // 3. Persistir boards
      emit(35, 'Guardando tarjetas…');
      await this._upsertBoards(oltId, empresaId, topo.boards ?? []);

      // 4. Persistir VLANs
      emit(50, 'Guardando VLANs…');
      await this._upsertVlans(oltId, empresaId, topo.vlans ?? []);

      // 5. Persistir line profiles
      emit(65, 'Guardando line-profiles…');
      await this._upsertLineProfiles(oltId, empresaId, topo.line_profiles ?? []);

      // 6. Persistir service profiles
      emit(78, 'Guardando service-profiles…');
      await this._upsertServiceProfiles(oltId, empresaId, topo.service_profiles ?? []);

      // 7. Persistir traffic tables
      emit(90, 'Guardando traffic-tables…');
      await this._upsertTrafficTables(oltId, empresaId, topo.traffic_tables ?? []);

      // 8. Completar job
      const resultado: Record<string, unknown> = {
        boards:           (topo.boards ?? []).length,
        vlans:            (topo.vlans  ?? []).length,
        lineProfiles:     (topo.line_profiles    ?? []).length,
        serviceProfiles:  (topo.service_profiles ?? []).length,
        trafficTables:    (topo.traffic_tables   ?? []).length,
        firmware:         topo.firmware_version ?? null,
        modelo:           topo.model ?? null,
      };

      await this.syncJobRepo.update(jobId, {
        estado: 'completed', progreso: 100, resultado, completadoEn: new Date(),
      });

      this.events.emit(OLT_SYNC_COMPLETED, { oltId, jobId, resultado } satisfies OltSyncResultPayload);
      this.logger.log(`[sync:${jobId}] OLT ${olt.nombre} sincronizada OK`);

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[sync:${jobId}] Error: ${msg}`);
      await this.syncJobRepo.update(jobId, {
        estado: 'failed', error: msg, completadoEn: new Date(),
      });
      this.events.emit(OLT_SYNC_ERROR, { oltId, jobId, error: msg } satisfies OltSyncErrorPayload);
    }
  }

  // ── Upserts idempotentes (TypeORM repo.upsert — ON CONFLICT DO UPDATE) ──

  private async _upsertBoards(
    oltId: string, empresaId: string,
    boards: { slot: number; board_type: string; state: string; onu_count: number }[],
  ): Promise<void> {
    if (!boards.length) return;
    await this.boardRepo.upsert(
      boards.map(b => ({ oltId, empresaId, slot: b.slot, boardType: b.board_type, estado: b.state, onuCount: b.onu_count })),
      { conflictPaths: ['oltId', 'slot'], skipUpdateIfNoValuesChanged: true },
    );
  }

  private async _upsertVlans(
    oltId: string, empresaId: string,
    vlans: { vlan_id: number; name: string }[],
  ): Promise<void> {
    if (!vlans.length) return;
    await this.vlanRepo.upsert(
      vlans.map(v => ({ oltId, empresaId, vlanId: v.vlan_id, nombre: v.name })),
      { conflictPaths: ['oltId', 'vlanId'], skipUpdateIfNoValuesChanged: true },
    );
  }

  private async _upsertLineProfiles(
    oltId: string, empresaId: string,
    profiles: { profile_id: number; name: string }[],
  ): Promise<void> {
    if (!profiles.length) return;
    await this.lineProfileRepo.upsert(
      profiles.map(p => ({ oltId, empresaId, profileId: p.profile_id, nombre: p.name })),
      { conflictPaths: ['oltId', 'profileId'], skipUpdateIfNoValuesChanged: true },
    );
  }

  private async _upsertServiceProfiles(
    oltId: string, empresaId: string,
    profiles: { profile_id: number; name: string }[],
  ): Promise<void> {
    if (!profiles.length) return;
    await this.srvProfileRepo.upsert(
      profiles.map(p => ({ oltId, empresaId, profileId: p.profile_id, nombre: p.name })),
      { conflictPaths: ['oltId', 'profileId'], skipUpdateIfNoValuesChanged: true },
    );
  }

  private async _upsertTrafficTables(
    oltId: string, empresaId: string,
    tables: { index: number; name: string; cir_kbps: number | null; pir_kbps: number | null }[],
  ): Promise<void> {
    if (!tables.length) return;
    await this.trafficRepo.upsert(
      tables.map(t => ({ oltId, empresaId, trafficId: t.index, nombre: t.name, cirKbps: t.cir_kbps, pirKbps: t.pir_kbps })),
      { conflictPaths: ['oltId', 'trafficId'], skipUpdateIfNoValuesChanged: true },
    );
  }

  // ── Credenciales SSH ──────────────────────────────────────────

  private async _buildConn(
    oltId: string, empresaId: string, olt: OltDispositivo,
  ): Promise<{ ip: string; port: number; username: string; password: string; brand: string }> {
    const config = await this.provRepo.findOne({
      where: { oltId, empresaId, tipo: 'nativo_ssh' as any, activo: true },
    });
    if (!config) throw new Error('OLT sin proveedor nativo_ssh activo');

    const c        = config.credenciales as Record<string, unknown>;
    const rawIp    = (c.ip as string) || olt.ipGestion;
    const ip       = rawIp.includes('/') ? rawIp.split('/')[0] : rawIp;
    const password = decrypt(
      c.password_cifrado ? (c.password_cifrado as string) : olt.contrasenaCifrada,
    );

    return {
      ip,
      port:     ((c.port     as number) || olt.puerto) ?? 22,
      username: (c.username  as string) || olt.usuarioAnclado,
      password,
      brand:    ((c.brand    as string) || olt.marca).toLowerCase(),
    };
  }
}
