import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { GenieAcsDriver } from '../ztp/genieacs.driver';
import { OltAutomationClient } from '../olt-automation.client';
import { decrypt } from '../../../common/utils/encryption.util';

// ═══════════════════════════════════════════════════════════════════════════
// Tr069StalenessService (B4) — detecta ONUs con gestión TR-069 muerta.
//
// El agujero que cierra: un factory reset por BOTÓN FÍSICO no genera ningún evento en
// el ERP. La ONU pierde su configuración de gestión y deja de informar, pero el servicio
// del cliente puede seguir funcionando, así que nadie se entera — ni el cliente, que
// navega bien, ni el operador, que no tiene motivo para mirar. La ONU queda
// administrativamente muerta por tiempo indefinido. (Caso real: device
// 00259E-EG8145V5-4857544316A6BAAC, 13 días sin informar y detectado por casualidad.)
//
// La señal NO puede ser un evento —no existe— así que es la AUSENCIA de señal:
// `lastInform` rancio en GenieACS. Y la ausencia de señal es ambigua por naturaleza:
// una ONU muda puede estar apagada, sin luz, con el cliente de viaje, o con la gestión
// realmente muerta. Actuar sobre la ambigüedad es cómo un watcher se convierte en una
// fábrica de trabajo inútil contra la OLT.
//
// De ahí las tres defensas del diseño:
//
//  1. GRACIA — no se actúa en la primera detección. Un microcorte deja la ONU muda unos
//     minutos; el umbral de 2h (≈24 informs perdidos con PeriodicInform=300s) más la
//     ventana de gracia distinguen "se cayó un momento" de "está muerta".
//
//  2. DISCRIMINACIÓN POR DOS PLANOS — la decisión no sale del ACS solo. Se contrasta con
//     el estado ÓPTICO real en la OLT:
//       · ONU offline en la OLT  → está apagada o sin fibra. NO es asunto del ERP.
//       · ONU ONLINE en la OLT pero muda en el ACS → el plano de datos vive y el de
//         gestión no: eso sí es gestión muerta, y es accionable.
//     Sin este contraste, cada cliente que apaga la ONU de noche generaría una
//     re-inyección de carril al día siguiente.
//
//  3. SUPRESIÓN ZONAL — si una fracción alta de las ONUs de una OLT está rancia, no hay
//     N averías simultáneas: hay un corte de infraestructura. El watcher se abstiene por
//     completo. Sin esto, la vuelta de un corte zonal dispararía una tormenta de
//     re-inyecciones contra un MA5800 que admite pocas sesiones VTY concurrentes —
//     convertiría una avería en una caída.
// ═══════════════════════════════════════════════════════════════════════════
@Injectable()
export class Tr069StalenessService {
  private readonly logger = new Logger(Tr069StalenessService.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly genie: GenieAcsDriver,
    private readonly automation: OltAutomationClient,
    private readonly events: EventEmitter2,
  ) {}

  /** Sin Inform en este tiempo, la sesión se considera rancia. */
  private static readonly UMBRAL_RANCIO_MS = 2 * 60 * 60_000; // 2h

  /**
   * Espera adicional tras la detección antes de accionar. El jitter evita que toda la
   * flota detectada en la misma pasada venza a la vez y genere un pico contra la OLT.
   */
  private static readonly GRACIA_BASE_MS   = 30 * 60_000; // 30 min
  private static readonly GRACIA_JITTER_MS = 60 * 60_000; // + hasta 60 min

  /** Techo de ONUs accionadas por corrida. El MA5800 admite pocas VTY concurrentes. */
  private static readonly MAX_POR_CORRIDA = 5;

  /** Si más de esta fracción de una OLT está rancia, es corte de infraestructura. */
  private static readonly UMBRAL_SUPRESION_ZONAL = 0.30;

  async revisar(): Promise<{
    revisadas: number; rancias: number; recuperadas: number;
    accionadas: number; suprimidasZonal: number; apagadas: number;
  }> {
    const candidatos = await this.ds.query<Array<{
      id: string; contrato_id: string; empresa_id: string; sn: string;
      olt_id: string; slot: number; port: number; onu_id: number;
      tr069_stale_desde: Date | null;
    }>>(`
      SELECT r.id, r.contrato_id, r.empresa_id, r.sn,
             r.olt_id, r.slot, r.port, r.onu_id, r.tr069_stale_desde
      FROM   ftth_onu_registro r
      JOIN   contratos c ON c.id = r.contrato_id
      WHERE  r.deleted_at IS NULL
        AND  r.estado       = 'activo'
        AND  r.carril_estado = 'activo'
        AND  c.deleted_at IS NULL
        AND  c.estado NOT IN ('baja_definitiva', 'suspendido', 'cortado')
    `);

    if (candidatos.length === 0) {
      return { revisadas: 0, rancias: 0, recuperadas: 0, accionadas: 0, suprimidasZonal: 0, apagadas: 0 };
    }

    const ahora = Date.now();
    const rancias: typeof candidatos = [];
    let recuperadas = 0;

    for (const c of candidatos) {
      const li = await this.genie.getLastInformBySerial(c.sn).catch(() => null);
      const esRancia = li == null || (ahora - li.getTime()) > Tr069StalenessService.UMBRAL_RANCIO_MS;

      if (!esRancia) {
        // Volvió (o nunca se fue). Limpiar la marca es lo que hace que la gracia sea una
        // ventana y no un contador que solo sube.
        if (c.tr069_stale_desde) {
          await this._limpiarMarca(c.id, true);
          recuperadas++;
          this.logger.log(`staleness | sn=${c.sn} volvió a informar — marca de rancio limpiada`);
        }
        continue;
      }
      rancias.push(c);
      if (!c.tr069_stale_desde) {
        await this.ds.query(
          `UPDATE ftth_onu_registro SET tr069_stale_desde = NOW() WHERE id = $1`, [c.id],
        );
        this.logger.warn(`staleness | sn=${c.sn} sesión TR-069 rancia detectada — en gracia`);
      }
    }

    // ── Defensa 3: supresión zonal, ANTES de accionar nada ────────────────
    const porOlt = new Map<string, { total: number; rancias: number }>();
    for (const c of candidatos) {
      const e = porOlt.get(c.olt_id) ?? { total: 0, rancias: 0 };
      e.total++;
      porOlt.set(c.olt_id, e);
    }
    for (const c of rancias) porOlt.get(c.olt_id)!.rancias++;

    const oltsSuprimidas = new Set<string>();
    for (const [oltId, e] of porOlt) {
      const frac = e.rancias / e.total;
      if (frac > Tr069StalenessService.UMBRAL_SUPRESION_ZONAL && e.rancias > 1) {
        oltsSuprimidas.add(oltId);
        this.logger.error(
          `staleness | OLT=${oltId}: ${e.rancias}/${e.total} ONUs rancias (${Math.round(frac * 100)}%) — ` +
          `patrón de CORTE ZONAL, watcher suprimido para esta OLT (no son N averías simultáneas)`,
        );
        this.events.emit('tr069.staleness.corte_zonal', {
          oltId, rancias: e.rancias, total: e.total,
        });
      }
    }

    // ── Accionar solo lo que salió de la gracia y no está suprimido ───────
    let accionadas = 0, apagadas = 0, suprimidasZonal = 0;
    for (const c of rancias) {
      if (accionadas >= Tr069StalenessService.MAX_POR_CORRIDA) break;
      if (oltsSuprimidas.has(c.olt_id)) { suprimidasZonal++; continue; }

      const desde = c.tr069_stale_desde?.getTime();
      if (!desde) continue;                       // recién marcada en esta pasada
      if (ahora - desde < this._graciaPara(c.id)) continue; // aún en gracia

      const resultado = await this._discriminarYActuar(c);
      if (resultado === 'accionada') accionadas++;
      else if (resultado === 'apagada') apagadas++;
    }

    return {
      revisadas: candidatos.length, rancias: rancias.length,
      recuperadas, accionadas, suprimidasZonal, apagadas,
    };
  }

  /**
   * Gracia determinista por registro: mismo id → misma espera. Un valor aleatorio en
   * cada corrida haría que una ONU venciera o no según la suerte del tick.
   */
  private _graciaPara(registroId: string): number {
    let h = 0;
    for (let i = 0; i < registroId.length; i++) h = (h * 31 + registroId.charCodeAt(i)) >>> 0;
    return Tr069StalenessService.GRACIA_BASE_MS + (h % Tr069StalenessService.GRACIA_JITTER_MS);
  }

  /**
   * Defensa 2: contrastar el plano de gestión (mudo) con el plano óptico real (OLT).
   * Es VIO aplicado a un diagnóstico: la conclusión no se infiere de una sola fuente.
   */
  private async _discriminarYActuar(c: {
    id: string; contrato_id: string; empresa_id: string; sn: string;
    olt_id: string; slot: number; port: number; onu_id: number;
  }): Promise<'accionada' | 'apagada' | 'indeterminado'> {
    const olt = await this._fetchOlt(c.olt_id);
    if (!olt) return 'indeterminado';

    let online: boolean;
    try {
      const poll = await this.automation.ftthPollOnline({
        connection: olt, slot: c.slot, port: c.port, onu_id: c.onu_id, max_wait: 5,
      });
      online = poll.run_state === 'online';
    } catch (e) {
      // Sin lectura de la OLT no hay dos planos que contrastar: no se decide nada.
      // Preferir no actuar sobre un diagnóstico incompleto es el punto del ejercicio.
      this.logger.warn(`staleness | sn=${c.sn} no se pudo leer el estado óptico: ${e instanceof Error ? e.message : String(e)}`);
      return 'indeterminado';
    }

    if (!online) {
      // Apagada o sin fibra: no es gestión muerta, es un equipo sin energía. No se toca
      // y NO se limpia la marca — cuando vuelva se evaluará de nuevo.
      this.logger.log(`staleness | sn=${c.sn} muda en el ACS pero OFFLINE en la OLT — equipo apagado, sin acción`);
      return 'apagada';
    }

    // Online ópticamente y muda en el ACS: el plano de datos vive, el de gestión no.
    // Esto es lo que deja un factory reset por botón físico. Se re-inyecta el carril
    // vía outbox (T3): hereda reintento, auditoría y lock por contrato.
    this.logger.error(
      `staleness | sn=${c.sn} ONLINE en la OLT pero sin Inform hace horas — GESTIÓN MUERTA ` +
      `(patrón de factory-reset físico). Re-inyectando el carril TR-069.`,
    );
    this.events.emit('ftth.carril.activar', { contratoId: c.contrato_id, empresaId: c.empresa_id });
    this.events.emit('tr069.staleness.gestion_muerta', {
      contratoId: c.contrato_id, sn: c.sn, oltId: c.olt_id,
    });
    // La marca NO se limpia aquí: la limpia la recuperación real (un Inform fresco),
    // que es la única evidencia de que la re-inyección sirvió. Marcarla ahora sería
    // dar por materializado lo que solo fue aceptado.
    return 'accionada';
  }

  private async _limpiarMarca(id: string, recuperada: boolean): Promise<void> {
    await this.ds.query(
      `UPDATE ftth_onu_registro
       SET tr069_stale_desde = NULL${recuperada ? ', tr069_recuperado_en = NOW()' : ''}
       WHERE id = $1`,
      [id],
    );
  }

  /** Misma forma de conexión que `ProvisionFtthService._buildConn` (ip/port/username/password/brand). */
  private async _fetchOlt(oltId: string): Promise<any | null> {
    const [o] = await this.ds.query<any[]>(
      `SELECT ip_gestion, puerto, usuario_anclado, contrasena_cifrada, marca
       FROM   olt_dispositivos
       WHERE  id = $1 AND deleted_at IS NULL`,
      [oltId],
    ).catch(() => [null]);
    if (!o) return null;
    let password = '';
    try { password = decrypt(o.contrasena_cifrada); } catch { password = o.contrasena_cifrada ?? ''; }
    return {
      ip:       o.ip_gestion,
      port:     o.puerto ?? 22,
      username: o.usuario_anclado,
      password,
      brand:    o.marca ?? 'huawei',
    };
  }
}
