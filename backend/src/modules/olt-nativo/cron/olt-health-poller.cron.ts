import { Injectable, Logger }   from '@nestjs/common';
import { InjectRepository }      from '@nestjs/typeorm';
import { Repository }            from 'typeorm';
import { Cron }                  from '@nestjs/schedule';
import pLimit                    from 'p-limit';

import { decrypt }               from '../../../common/utils/encryption.util';
import { OltDispositivo }        from '../entities/olt-dispositivo.entity';
import { OltProveedorConfig }    from '../entities/olt-proveedor-config.entity';
import { OltHealthSnapshot }     from '../entities/olt-health-snapshot.entity';
import { OltAutomationClient }   from '../olt-automation.client';
import { OltAlertEngineService } from '../services/olt-alert-engine.service';

// ─────────────────────────────────────────────────────────────
// OltHealthPollerCron
//
// Dos crons:
//   1. pollBoards()  — cada 5 min: obtiene estado de boards + conteo ONUs.
//      Escribe OltHealthSnapshot por slot (port=null).
//      Actualiza OltDispositivo.onusActivas.
//   2. pollPom()     — cada 15 min: obtiene POM de todos los puertos PON.
//      Escribe OltHealthSnapshot por slot+port.
//
// Solo corre en instancia PM2 #0 (evita N workers duplicando polls).
// Concurrencia: pLimit(4) — máx 4 OLTs simultáneas.
// Anti-solapamiento: flags _boardRunning / _pomRunning.
//
// Solo se encuestan OLTs con proveedor nativo_ssh activo.
// ─────────────────────────────────────────────────────────────
@Injectable()
export class OltHealthPollerCron {
  private readonly logger  = new Logger(OltHealthPollerCron.name);
  private _boardRunning    = false;
  private _pomRunning      = false;
  private _ponPortRunning  = false;

  constructor(
    @InjectRepository(OltDispositivo)
    private readonly oltRepo:       Repository<OltDispositivo>,

    @InjectRepository(OltProveedorConfig)
    private readonly configRepo:    Repository<OltProveedorConfig>,

    @InjectRepository(OltHealthSnapshot)
    private readonly snapshotRepo:  Repository<OltHealthSnapshot>,

    private readonly automation:    OltAutomationClient,
    private readonly alertEngine:   OltAlertEngineService,
  ) {}

  // ── Boards: cada 5 minutos ────────────────────────────────────
  @Cron('*/5 * * * *', { timeZone: 'America/Lima' })
  async pollBoards(): Promise<void> {
    if (!this._isPrimaryInstance()) return;
    if (this._boardRunning) {
      this.logger.warn('OltHealthPoller boards: vuelta anterior en curso — omitiendo');
      return;
    }
    this._boardRunning = true;
    const t0 = Date.now();
    try {
      await this._ejecutarBoards();
    } catch (err: any) {
      this.logger.error(`OltHealthPoller boards error: ${err.message}`);
    } finally {
      this._boardRunning = false;
      this.logger.log(`OltHealthPoller boards completado en ${Date.now() - t0}ms`);
    }
  }

  // ── POM: cada 15 minutos, offset +3 min respecto a boards ─────
  // Se dispara en :03, :18, :33, :48 para no coincidir con boards
  @Cron('3-59/15 * * * *', { timeZone: 'America/Lima' })
  async pollPom(): Promise<void> {
    if (!this._isPrimaryInstance()) return;
    if (this._pomRunning) {
      this.logger.warn('OltHealthPoller POM: vuelta anterior en curso — omitiendo');
      return;
    }
    this._pomRunning = true;
    const t0 = Date.now();
    try {
      await this._ejecutarPom();
    } catch (err: any) {
      this.logger.error(`OltHealthPoller POM error: ${err.message}`);
    } finally {
      this._pomRunning = false;
      this.logger.log(`OltHealthPoller POM completado en ${Date.now() - t0}ms`);
    }
  }

  // ── PON Ports: cada 15 min, offset +7 min (:07/:22/:37/:52) ──
  @Cron('7-59/15 * * * *', { timeZone: 'America/Lima' })
  async pollPonPorts(): Promise<void> {
    if (!this._isPrimaryInstance()) return;
    if (this._ponPortRunning) {
      this.logger.warn('OltHealthPoller PON ports: vuelta anterior en curso — omitiendo');
      return;
    }
    this._ponPortRunning = true;
    const t0 = Date.now();
    try {
      await this._ejecutarPonPorts();
    } catch (err: any) {
      this.logger.error(`OltHealthPoller PON ports error: ${err.message}`);
    } finally {
      this._ponPortRunning = false;
      this.logger.log(`OltHealthPoller PON ports completado en ${Date.now() - t0}ms`);
    }
  }

  // ── Retención: diario 02:30 — purga snapshots >7 días ─────────
  @Cron('30 2 * * *', { timeZone: 'America/Lima' })
  async purgeOldSnapshots(): Promise<void> {
    if (!this._isPrimaryInstance()) return;
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1_000);
    const result = await this.snapshotRepo
      .createQueryBuilder()
      .delete()
      .where('captured_at < :cutoff AND granularity = :g', { cutoff, g: 'raw' })
      .execute();
    this.logger.log(`OltHealthPoller purge: ${result.affected ?? 0} snapshots eliminados`);
  }

  // ── Implementación boards ─────────────────────────────────────
  private async _ejecutarBoards(): Promise<void> {
    const targets = await this._loadTargets();
    if (targets.length === 0) return;
    this.logger.log(`OltHealthPoller boards: ${targets.length} OLTs`);

    const limit = pLimit(4);
    await Promise.all(targets.map((t) => limit(() => this._pollOneBoard(t))));
  }

  private async _pollOneBoard(target: OltTarget): Promise<void> {
    try {
      const resp = await this.automation.healthSnapshot({
        connection:  this._buildConnection(target),
        include_pom: false,
      });

      if (!resp.success) {
        this.logger.warn(`Board poll fail ${target.olt.nombre}: ${resp.error}`);
        return;
      }

      const now     = new Date();
      const empresa = target.olt.empresaId;
      const oltId   = target.olt.id;

      // Snapshots por slot
      const rows = resp.boards.map((b) => this.snapshotRepo.create({
        oltId, empresaId: empresa, slot: b.slot, port: null,
        snapshotType: 'board',
        boardType:    b.board_type,
        boardState:   b.state,
        onuCapacity:  b.onu_capacity,
        onusOnline:   b.online_onus,
        onusOffline:  b.offline_onus,
        onusRogue:    null,
        onusTotal:    b.onu_count,
        granularity:  'raw',
        capturedAt:   now,
        rawJson:      b as unknown as Record<string, unknown>,
      }));

      await this.snapshotRepo.save(rows);

      // Actualizar onusActivas en OltDispositivo
      const totalActivas = resp.boards.reduce((sum, b) => sum + b.onu_count, 0);
      await this.oltRepo.update(oltId, { onusActivas: totalActivas });

      // Evaluar alertas de boards (no bloquea el poll si falla)
      this.alertEngine.evalBoardAlerts(oltId, empresa, resp.boards).catch((e: Error) =>
        this.logger.error(`Alert eval boards ${target.olt.nombre}: ${e.message}`),
      );

      this.logger.debug(
        `Board poll OK ${target.olt.nombre}: ${resp.boards.length} slots, ${totalActivas} ONUs`,
      );
    } catch (err: any) {
      this.logger.error(`Board poll error ${target.olt.nombre}: ${err.message}`);
    }
  }

  // ── Implementación POM ────────────────────────────────────────
  private async _ejecutarPom(): Promise<void> {
    const targets = await this._loadTargets();
    if (targets.length === 0) return;
    this.logger.log(`OltHealthPoller POM: ${targets.length} OLTs`);

    const limit = pLimit(4);
    await Promise.all(targets.map((t) => limit(() => this._pollOnePom(t))));
  }

  private async _pollOnePom(target: OltTarget): Promise<void> {
    try {
      const resp = await this.automation.healthSnapshot({
        connection:  this._buildConnection(target),
        include_pom: true,
      });

      if (!resp.success) {
        this.logger.warn(`POM poll fail ${target.olt.nombre}: ${resp.error}`);
        return;
      }

      if (!resp.pom || resp.pom.length === 0) {
        this.logger.debug(`POM poll vacío ${target.olt.nombre}`);
        return;
      }

      const now     = new Date();
      const empresa = target.olt.empresaId;
      const oltId   = target.olt.id;

      const rows = resp.pom.map((p) => this.snapshotRepo.create({
        oltId, empresaId: empresa, slot: p.slot, port: p.port,
        snapshotType: 'pom',
        tempCelsius: p.temp_celsius,
        txDbm:       p.tx_dbm,
        rxDbm:       p.rx_dbm,
        voltageMv:   p.voltage_mv,
        laserMa:     p.laser_ma,
        pomState:    p.state ?? 'ok',
        granularity: 'raw',
        capturedAt:  now,
        rawJson:     p as unknown as Record<string, unknown>,
      }));

      await this.snapshotRepo.save(rows);

      // Evaluar alertas de POM (no bloquea el poll si falla)
      this.alertEngine.evalPomAlerts(oltId, empresa, resp.pom).catch((e: Error) =>
        this.logger.error(`Alert eval POM ${target.olt.nombre}: ${e.message}`),
      );

      this.logger.debug(
        `POM poll OK ${target.olt.nombre}: ${resp.pom.length} puertos`,
      );
    } catch (err: any) {
      this.logger.error(`POM poll error ${target.olt.nombre}: ${err.message}`);
    }
  }

  // ── Implementación PON Ports ──────────────────────────────────
  private async _ejecutarPonPorts(): Promise<void> {
    const targets = await this._loadTargets();
    if (targets.length === 0) return;
    this.logger.log(`OltHealthPoller PON ports: ${targets.length} OLTs`);

    // pLimit(2): cada OLT requiere hasta N sesiones SSH secuenciales (1 por slot)
    const limit = pLimit(2);
    await Promise.all(targets.map((t) => limit(() => this._pollOnePonPorts(t))));
  }

  private async _pollOnePonPorts(target: OltTarget): Promise<void> {
    const gponSlots = await this._getGponSlots(target.olt.id);
    if (gponSlots.length === 0) {
      this.logger.debug(`PON ports: ${target.olt.nombre} sin slots GPON conocidos — omitiendo`);
      return;
    }

    const now     = new Date();
    const empresa = target.olt.empresaId;
    const oltId   = target.olt.id;
    const conn    = this._buildConnection(target);

    for (const slot of gponSlots) {
      try {
        const resp = await this.automation.ponPorts({ connection: conn, slot });
        if (!resp.success || !resp.ports?.length) {
          this.logger.warn(
            `PON ports fail ${target.olt.nombre} slot=${slot}: ${resp.error ?? 'sin puertos'}`,
          );
          continue;
        }

        const rows = resp.ports.map((p) => this.snapshotRepo.create({
          oltId, empresaId: empresa,
          slot:        p.slot,
          port:        p.port,
          snapshotType: 'pon_port',
          portType:    p.port_type,
          adminState:  p.admin_state,
          operState:   p.oper_state,
          autofind:    p.autofind,
          onusOnline:  p.onus_online,
          onusOffline: p.onus_offline,
          onusTotal:   p.onus_total,
          onuCapacity: p.max_capacity,
          granularity: 'raw',
          capturedAt:  now,
          rawJson:     p as unknown as Record<string, unknown>,
        }));

        await this.snapshotRepo.save(rows);
        this.logger.debug(
          `PON ports OK ${target.olt.nombre} slot=${slot}: ${resp.ports.length} puertos`,
        );
      } catch (err: any) {
        this.logger.error(`PON ports error ${target.olt.nombre} slot=${slot}: ${err.message}`);
        // Continuar con el siguiente slot — no abortar la OLT
      }
    }
  }

  // Retorna slots con tarjetas GPON/XGS-PON según snapshots recientes (últimos 30 min)
  private async _getGponSlots(oltId: string): Promise<number[]> {
    const cutoff = new Date(Date.now() - 30 * 60 * 1_000);
    const boards = await this.snapshotRepo
      .createQueryBuilder('s')
      .select(['s.slot', 's.boardType'])
      .where(
        's.olt_id = :oltId AND s.snapshot_type = :type AND s.captured_at > :cutoff',
        { oltId, type: 'board', cutoff },
      )
      .getMany();

    // Detecta tarjetas GPON: prefijo GP/XP (dedicadas) o patrón CG (combo GE+GPON Huawei)
    return [...new Set(
      boards
        .filter((b) => /GP|CG|GPON/i.test(b.boardType ?? ''))
        .map((b) => b.slot!),
    )];
  }

  // ── Helpers ───────────────────────────────────────────────────

  private _isPrimaryInstance(): boolean {
    const inst = process.env.NODE_APP_INSTANCE;
    return inst === undefined || inst === '0';
  }

  private async _loadTargets(): Promise<OltTarget[]> {
    const configs = await this.configRepo.find({
      where: { tipo: 'nativo_ssh', activo: true },
    });
    if (configs.length === 0) return [];

    const oltIds = [...new Set(configs.map((c) => c.oltId))];
    const olts   = await this.oltRepo.findByIds(oltIds);
    const oltMap = new Map(olts.map((o) => [o.id, o]));

    return configs
      .map((c) => ({ config: c, olt: oltMap.get(c.oltId) }))
      .filter((t): t is OltTarget => !!t.olt && t.olt.activo !== false);
  }

  private _buildConnection(t: OltTarget) {
    const c = t.config.credenciales as Record<string, any>;
    let password = '';
    if (c.password_cifrado) {
      try { password = decrypt(c.password_cifrado); } catch { /* corrupta */ }
    }
    return {
      ip:       c.ip || t.olt.ipGestion,
      port:     typeof c.port === 'number' ? c.port : (t.olt.puerto ?? 22),
      username: c.username || t.olt.usuarioAnclado,
      password,
      brand:    (c.brand || t.olt.marca).toLowerCase(),
    };
  }
}

interface OltTarget {
  config: OltProveedorConfig;
  olt:    OltDispositivo;
}
