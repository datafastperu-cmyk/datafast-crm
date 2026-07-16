import {
  BadRequestException, ConflictException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';

import { OltDispositivo } from '../entities/olt-dispositivo.entity';
import { OltBaseline } from '../entities/olt-baseline.entity';
import { InfrastructureSnapshot } from '../types/infrastructure-snapshot';
import { InfrastructureSnapshotService } from './infrastructure-snapshot.service';
import { OltVlanService } from './olt-vlan.service';
import { OltTrafficTableService } from './olt-traffic-table.service';
import { OltConnService } from './olt-conn.service';
import { OltAutomationClient } from '../olt-automation.client';

// ─── Tipos del plan ───────────────────────────────────────────────

export type PlanOperacionTipo =
  | 'crear_vlan'
  | 'crear_traffic_table'
  | 'taguear_uplink'
  | 'declarar_tr069_vlan';   // solo BD del ERP — no toca la OLT

export interface PlanOperacion {
  orden:   number;
  tipo:    PlanOperacionTipo;
  detalle: string;
  params:  Record<string, unknown>;
  // Transparencia total: los comandos CLI EXACTOS que el ERP inyectará a la
  // OLT al ejecutar esta operación (vacío = operación solo en BD del ERP).
  // El operador los ve en el dry-run antes de aprobar.
  comandos: string[];
}

// Diferencia que el ERP detecta pero NO va a ejecutar automáticamente —
// requiere decisión humana (ej. una traffic table externa con CIR distinto).
export interface PlanBloqueo {
  recurso: string;
  motivo:  string;
}

export interface BaselinePlan {
  oltId:           string;
  baselineId:      string;
  baselineNombre:  string;
  baselineVersion: number;
  generadoEn:      Date;
  operaciones:     PlanOperacion[];
  bloqueos:        PlanBloqueo[];
  planHash:        string;   // el apply exige este hash — si el estado cambió, 409
  yaConverge:      boolean;
}

export interface ResultadoOperacion extends PlanOperacion {
  exitoso: boolean;
  mensaje: string;
}

export interface ResultadoAplicacion {
  oltId:       string;
  planHash:    string;
  ejecutadas:  number;
  fallidas:    number;
  resultados:  ResultadoOperacion[];
  completado:  boolean;   // false si se detuvo en una operación fallida
}

// ─────────────────────────────────────────────────────────────
// OltBaselinePlanService — Incremento 9 (DISP: Planning + Execution)
//
// Convergencia del baseline en dos fases separadas a propósito:
//   1. generarPlan (GET, dry-run puro): diff baseline vs snapshot →
//      lista ordenada de operaciones + hash. NUNCA toca la OLT.
//   2. aplicarPlan (POST con planHash): regenera el plan; si el hash no
//      coincide, el estado cambió desde que el operador lo aprobó → 409.
//      Ejecuta secuencialmente reutilizando los servicios atómicos
//      existentes (BD+CLI con rollback, ownership origen='erp').
//      Se detiene en el primer fallo — nunca continúa a ciegas.
//
// Peor escenario cubierto:
// - Dos operadores aplican a la vez → el segundo regenera un plan sin
//   operaciones pendientes (o distinto hash) y no duplica nada; el CLI
//   de la OLT además rechaza recursos ya existentes.
// - SSH cae a mitad → la operación en curso hace su propio rollback BD
//   (agregarConCli), el plan se corta y reporta qué quedó pendiente.
// - Recurso externo en conflicto (misma traffic table, otro CIR) →
//   bloqueo informativo, jamás se muta un recurso origen != 'erp'.
// ─────────────────────────────────────────────────────────────
@Injectable()
export class OltBaselinePlanService {
  private readonly logger = new Logger(OltBaselinePlanService.name);

  constructor(
    @InjectRepository(OltDispositivo)
    private readonly oltRepo: Repository<OltDispositivo>,

    @InjectRepository(OltBaseline)
    private readonly baselineRepo: Repository<OltBaseline>,

    private readonly snapshotService: InfrastructureSnapshotService,
    private readonly vlanService:     OltVlanService,
    private readonly ttService:       OltTrafficTableService,
    private readonly connService:     OltConnService,
    private readonly automation:      OltAutomationClient,
  ) {}

  // ── Dry-run: qué haría el ERP para converger la OLT al baseline ──
  async generarPlan(oltId: string, empresaId: string): Promise<BaselinePlan> {
    const { olt, baseline } = await this._cargar(oltId, empresaId);
    const snapshot = await this.snapshotService.obtener(oltId, empresaId);
    return this._construirPlan(olt, baseline, snapshot);
  }

  // ── Ejecución aprobada por el operador ────────────────────────
  async aplicarPlan(oltId: string, empresaId: string, planHash: string): Promise<ResultadoAplicacion> {
    if (!planHash) {
      throw new BadRequestException('planHash es obligatorio: genera el plan (dry-run) y apruébalo primero.');
    }

    const { olt, baseline } = await this._cargar(oltId, empresaId);
    const snapshot = await this.snapshotService.obtener(oltId, empresaId);
    const plan     = this._construirPlan(olt, baseline, snapshot);

    if (plan.planHash !== planHash) {
      throw new ConflictException(
        'El estado de la OLT o el baseline cambió desde que se generó el plan. ' +
        'Vuelve a generar el plan y revísalo antes de aplicar.',
      );
    }
    if (plan.operaciones.length === 0) {
      return {
        oltId, planHash, ejecutadas: 0, fallidas: 0, resultados: [], completado: true,
      };
    }

    this.logger.log(
      `Aplicando plan baseline "${baseline.nombre}" v${baseline.version} | ` +
      `OLT=${olt.nombre} ops=${plan.operaciones.length} hash=${planHash.slice(0, 12)}`,
    );

    const resultados: ResultadoOperacion[] = [];
    let fallidas = 0;

    for (const op of plan.operaciones) {
      try {
        const mensaje = await this._ejecutar(oltId, empresaId, op, olt);
        resultados.push({ ...op, exitoso: true, mensaje });
      } catch (err) {
        fallidas = 1;
        const mensaje = (err as Error).message;
        resultados.push({ ...op, exitoso: false, mensaje });
        this.logger.warn(`Plan detenido en op #${op.orden} (${op.tipo}): ${mensaje}`);
        break; // nunca continuar a ciegas tras un fallo contra hardware
      }
    }

    return {
      oltId,
      planHash,
      ejecutadas:  resultados.filter(r => r.exitoso).length,
      fallidas,
      resultados,
      completado:  fallidas === 0,
    };
  }

  // ── Privados ──────────────────────────────────────────────────

  private async _cargar(oltId: string, empresaId: string): Promise<{ olt: OltDispositivo; baseline: OltBaseline }> {
    const olt = await this.oltRepo.findOne({ where: { id: oltId, empresaId } });
    if (!olt) throw new NotFoundException(`OLT ${oltId} no encontrada.`);
    if (!olt.baselineId) {
      throw new BadRequestException(`La OLT "${olt.nombre}" no tiene baseline asignado.`);
    }
    const baseline = await this.baselineRepo.findOne({ where: { id: olt.baselineId, empresaId } });
    if (!baseline) throw new NotFoundException(`Baseline ${olt.baselineId} no encontrado.`);
    return { olt, baseline };
  }

  // Mismo saneo de nombres que el driver Python (re.sub + límite 64) — los
  // comandos mostrados deben ser EXACTAMENTE los que se inyectarán.
  private _safeName(nombre: string): string {
    return nombre.replace(/[^A-Za-z0-9_\-]/g, '_').slice(0, 64);
  }

  private _construirPlan(
    olt: OltDispositivo, baseline: OltBaseline, snapshot: InfrastructureSnapshot,
  ): BaselinePlan {
    const operaciones: PlanOperacion[] = [];
    const bloqueos:    PlanBloqueo[]   = [];

    // VLANs primero: las traffic tables no dependen de ellas, pero el orden
    // estable hace el hash determinista y el plan legible (red antes que QoS).
    const vlansEnOlt = new Set(snapshot.vlans.map(v => v.vlanId));
    for (const v of baseline.spec.vlans) {
      if (!vlansEnOlt.has(v.vlanId)) {
        const safe = this._safeName(v.nombre);
        operaciones.push({
          orden:   operaciones.length + 1,
          tipo:    'crear_vlan',
          detalle: `Crear VLAN ${v.vlanId} ("${v.nombre}")${v.proposito === 'tr069' ? ' — VLAN exclusiva de gestión TR-069' : ''}`,
          params:  { vlanId: v.vlanId, nombre: v.nombre },
          comandos: ['config', `vlan ${v.vlanId} smart`, `vlan desc ${v.vlanId} ${safe}`, 'quit'],
        });
      }
    }

    const ttPorNombre = new Map(snapshot.trafficTables.map(t => [t.nombre, t]));
    for (const t of baseline.spec.trafficTables) {
      const real = ttPorNombre.get(t.nombre);
      if (!real) {
        const safe = this._safeName(t.nombre);
        operaciones.push({
          orden:   operaciones.length + 1,
          tipo:    'crear_traffic_table',
          detalle: `Crear traffic table "${t.nombre}" (CIR=${t.cirKbps} PIR=${t.pirKbps} kbps)`,
          params:  { nombre: t.nombre, cirKbps: t.cirKbps, pirKbps: t.pirKbps },
          comandos: [
            'display traffic table ip from-index 0',
            'config',
            `traffic table ip name ${safe} cir ${t.cirKbps} pir ${t.pirKbps} priority 0 priority-policy local-setting`,
            'quit',
            'display traffic table ip from-index 0',
          ],
        });
      } else if (real.cirKbps !== t.cirKbps || real.pirKbps !== t.pirKbps) {
        // Existe con otros valores: no se auto-corrige. Si es externa, el ERP
        // no la toca (ownership); si es del ERP, editar puede afectar ONUs en
        // uso — ambas requieren decisión humana desde el panel.
        bloqueos.push({
          recurso: `traffic table "${t.nombre}"`,
          motivo:  `Existe en la OLT con CIR=${real.cirKbps}/PIR=${real.pirKbps}, el baseline declara ` +
                   `CIR=${t.cirKbps}/PIR=${t.pirKbps}. Corrígela manualmente o versiona el baseline.`,
        });
      }
    }

    // Uplink tagging (9b): VLANs con uplink:true deben estar taggeadas en
    // spec.uplinkPort. Comando ADITIVO — el destagueo nunca se automatiza.
    const uplinkPort = baseline.spec.uplinkPort;
    const vlansUplink = baseline.spec.vlans.filter(v => v.uplink);
    if (vlansUplink.length > 0) {
      if (!uplinkPort) {
        bloqueos.push({
          recurso: 'uplink',
          motivo:  `${vlansUplink.length} VLAN(s) declaran uplink:true pero el baseline no define uplinkPort.`,
        });
      } else {
        const observadas = snapshot.uplinkVlans?.[uplinkPort];
        for (const v of vlansUplink) {
          const seCreaEnEstePlan = operaciones.some(o => o.tipo === 'crear_vlan' && o.params.vlanId === v.vlanId);
          if (observadas == null && !seCreaEnEstePlan) {
            // Sin observed state no se puede saber si ya está taggeada; retaguear
            // a ciegas no es aceptable en un uplink con clientes en producción.
            bloqueos.push({
              recurso: `uplink ${uplinkPort} / VLAN ${v.vlanId}`,
              motivo:  'El estado del uplink aún no se ha observado — ejecuta una sincronización primero.',
            });
            continue;
          }
          if (seCreaEnEstePlan || !observadas!.includes(v.vlanId)) {
            const [f, s, p] = uplinkPort.split('/');
            operaciones.push({
              orden:   operaciones.length + 1,
              tipo:    'taguear_uplink',
              detalle: `Taguear VLAN ${v.vlanId} ("${v.nombre}") en el uplink ${uplinkPort}`,
              params:  { vlanId: v.vlanId, portPath: uplinkPort },
              comandos: ['config', `port vlan ${v.vlanId} ${f}/${s} ${p}`, 'quit', `display port vlan ${uplinkPort}`],
            });
          }
        }
      }
    }

    // TR-069: si el baseline declara una VLAN con propósito tr069, el ERP
    // debe registrarla como VLAN de gestión TR-069 de esta OLT (la usa el
    // bootstrap DHCP Option 43 y la regla de compliance tr069_vlan_coherente).
    // El lado PON no se pre-configura: en el MA5800 el enlace PON↔VLAN se crea
    // POR ONU vía service-port durante el bootstrap TR-069 / provisión.
    const vlanTr069 = baseline.spec.vlans.find(v => v.proposito === 'tr069');
    if (vlanTr069 && olt.tr069MgmtVlan !== vlanTr069.vlanId) {
      operaciones.push({
        orden:   operaciones.length + 1,
        tipo:    'declarar_tr069_vlan',
        detalle: `Registrar VLAN ${vlanTr069.vlanId} como VLAN de gestión TR-069 en el ERP ` +
                 `(hoy: ${olt.tr069MgmtVlan ?? 'sin declarar'}). Solo BD — no toca la OLT.`,
        params:  { vlanId: vlanTr069.vlanId },
        comandos: [],
      });
    }

    const planHash = createHash('sha256')
      .update(JSON.stringify({
        baselineId: baseline.id,
        ops: operaciones.map(o => ({ tipo: o.tipo, params: o.params })),
      }))
      .digest('hex');

    return {
      oltId:           olt.id,
      baselineId:      baseline.id,
      baselineNombre:  baseline.nombre,
      baselineVersion: baseline.version,
      generadoEn:      new Date(),
      operaciones,
      bloqueos,
      planHash,
      yaConverge:      operaciones.length === 0 && bloqueos.length === 0,
    };
  }

  private async _ejecutar(
    oltId: string, empresaId: string, op: PlanOperacion, olt: OltDispositivo,
  ): Promise<string> {
    switch (op.tipo) {
      case 'crear_vlan': {
        const vlan = await this.vlanService.agregarConCli(oltId, empresaId, {
          vlanId: op.params.vlanId as number,
          nombre: op.params.nombre as string,
        });
        return `VLAN ${vlan.vlanId} creada en la OLT y registrada (origen=erp)`;
      }
      case 'crear_traffic_table': {
        const tt = await this.ttService.agregarConCli(oltId, empresaId, {
          nombre:  op.params.nombre  as string,
          cirKbps: op.params.cirKbps as number,
          pirKbps: op.params.pirKbps as number,
        });
        return `Traffic table "${tt.nombre}" creada con índice ${tt.trafficId} (origen=erp)`;
      }
      case 'taguear_uplink': {
        const vlanId   = op.params.vlanId   as number;
        const portPath = op.params.portPath as string;
        const conn = await this.connService.buildConn(olt);
        const res  = await this.automation.uplinkVlanTag({
          connection: conn, vlan_id: vlanId, port_path: portPath,
        });
        if (!res.success) {
          throw new Error(res.error ?? `La OLT no confirmó el tag de la VLAN ${vlanId} en ${portPath}`);
        }
        // Persistir el observed state releído por el driver — el siguiente
        // dry-run ya no propone esta operación sin necesidad de otro sync.
        await this.oltRepo.update(oltId, {
          uplinkVlans: { ...(olt.uplinkVlans ?? {}), [portPath]: res.vlan_ids },
        });
        olt.uplinkVlans = { ...(olt.uplinkVlans ?? {}), [portPath]: res.vlan_ids };
        return `VLAN ${vlanId} taggeada en uplink ${portPath} — puerto ahora: [${res.vlan_ids.join(', ')}]`;
      }
      case 'declarar_tr069_vlan': {
        const vlanId = op.params.vlanId as number;
        await this.oltRepo.update(oltId, { tr069MgmtVlan: vlanId });
        olt.tr069MgmtVlan = vlanId;
        return `VLAN ${vlanId} registrada como VLAN de gestión TR-069 de esta OLT (solo BD del ERP)`;
      }
    }
  }
}
