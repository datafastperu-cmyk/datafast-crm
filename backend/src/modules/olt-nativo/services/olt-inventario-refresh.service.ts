import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { OnEvent } from '@nestjs/event-emitter';

import { OltOnuInventario } from '../entities/olt-onu-inventario.entity';
import { OltAutomationClient } from '../olt-automation.client';
import { decrypt } from '../../../common/utils/encryption.util';

// ═══════════════════════════════════════════════════════════════════════════
// OltInventarioRefreshService — re-observa UN puerto PON tras una transición.
//
// El problema que resuelve (reportado 2026-07-28): `/red/olt` mostraba la ONU de un
// cliente como `online` con su contrato, cuando el contrato estaba dado de baja y la ONU
// ya no existía en la OLT. Los tres planos decían cosas distintas. La causa no era falta
// de sincronía entre módulos: `olt_onu_inventario` es un SNAPSHOT que solo se refresca
// cuando un operador pulsa "Sincronizar" — no había cron ni invalidación. El que se
// estaba mirando tenía 3 días.
//
// DECISIÓN DE DISEÑO — por qué se RE-OBSERVA en vez de escribir la fila directamente:
//
// `olt_onu_inventario` es la tabla del estado OBSERVADO; el estado DESEADO vive en
// `contratos` + `ftth_onu_registro`. Todo el valor del inventario está en ser
// independiente: comparar ambos es lo que detecta el drift. Si al aprovisionar
// escribiéramos ahí la fila que ACABAMOS de pedir, estaríamos guardando nuestro deseo
// disfrazado de observación — el inventario diría siempre exactamente lo que el ERP
// espera, y el drift se volvería indetectable por construcción. Sería "aceptado ≠
// materializado" otra vez, esta vez incrustado en el modelo de datos.
//
// Por eso la primitiva es una sola y siempre observa: leer ese puerto de la OLT y
// reemplazar sus filas con lo que la OLT realmente reporta. Sirve igual para el alta
// (aparece) y para la baja (desaparece), y no puede mentir.
//
// Acotado a UN puerto a propósito: el MA5800 admite pocas sesiones VTY concurrentes y un
// sync completo recorre todos los slots y puertos. Best-effort: un fallo aquí nunca
// rompe la operación de negocio que lo disparó — solo deja el snapshot viejo, que el
// cron periódico corregirá y que la UI muestra con su antigüedad.
// ═══════════════════════════════════════════════════════════════════════════
@Injectable()
export class OltInventarioRefreshService {
  private readonly logger = new Logger(OltInventarioRefreshService.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(OltOnuInventario)
    private readonly inventarioRepo: Repository<OltOnuInventario>,
    private readonly automation: OltAutomationClient,
  ) {}

  /** SN normalizado (sufijo 8 hex) — la OLT y la BD usan formas distintas del mismo serial. */
  private _norm(sn?: string | null): string {
    return (sn ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(-8);
  }

  /**
   * Disparado tras cualquier transición que cambie lo que la OLT reporta en un puerto:
   * aprovisionar, desaprovisionar, suspender, rehabilitar.
   */
  @OnEvent('ftth.inventario.reobservar', { async: true })
  async onReobservar(ev: { oltId: string; empresaId: string; slot: number; port: number }): Promise<void> {
    if (!ev?.oltId || !ev?.empresaId || ev.slot == null || ev.port == null) return;
    await this.reobservarPuerto(ev.oltId, ev.empresaId, ev.slot, ev.port);
  }

  async reobservarPuerto(
    oltId:     string,
    empresaId: string,
    slot:      number,
    port:      number,
  ): Promise<{ observadas: number } | null> {
    const conn = await this._fetchConn(oltId);
    if (!conn) return null;

    let clasif;
    try {
      clasif = await this.automation.clasificarOnus({ connection: conn, slot, port });
    } catch (e) {
      // Sin lectura no hay observación. Se deja el snapshot anterior tal cual: viejo pero
      // honesto (la UI muestra su antigüedad). Inventar el estado sería peor que no saberlo.
      this.logger.warn(
        `reobservarPuerto | olt=${oltId} ${slot}/${port}: no se pudo leer — snapshot sin cambios ` +
        `(${e instanceof Error ? e.message : String(e)})`,
      );
      return null;
    }
    if (!clasif.success) return null;

    // Vínculo con el estado deseado, para poblar contrato/cliente igual que el sync completo.
    const rows: Array<{ sn: string; contrato_id: string; numero_contrato: string; cliente: string }> =
      await this.ds.query(
        `SELECT r.sn, r.contrato_id, c.numero_contrato,
                COALESCE(cl.nombre_completo, TRIM(CONCAT(cl.nombres,' ',cl.apellido_paterno,' ',cl.apellido_materno))) AS cliente
           FROM ftth_onu_registro r
           JOIN servicios c ON c.id = r.contrato_id
           LEFT JOIN clientes cl ON cl.id = c.cliente_id
          WHERE r.deleted_at IS NULL AND r.olt_id = $1`,
        [oltId],
      );
    const contratoPorSn = new Map(rows.map((r) => [this._norm(r.sn), r]));

    const snapshotAt = new Date();
    const filas: Array<Partial<OltOnuInventario>> = [];

    for (const o of clasif.onus) {
      if (!o.sn) continue;
      const match = contratoPorSn.get(this._norm(o.sn));
      filas.push({
        empresaId, oltId, slot, port,
        onuId: o.onu_id, sn: o.sn,
        estadoOperativo: o.estado_operativo ?? 'offline',
        controlFlag: o.control_flag, runState: o.run_state,
        rxPowerDbm: o.rx_power_dbm,
        sinContrato: !match,
        contratoId: match?.contrato_id ?? null,
        numeroContrato: match?.numero_contrato ?? null,
        cliente: match?.cliente ?? null,
        origen: 'configurada',
        snapshotAt,
      });
    }
    for (const a of clasif.autofind) {
      if (!a.sn) continue;
      filas.push({
        empresaId, oltId, slot: a.slot ?? slot, port: a.port ?? port,
        onuId: null, sn: a.sn,
        estadoOperativo: 'no_aprovisionada',
        controlFlag: null, runState: null, rxPowerDbm: null,
        sinContrato: true, contratoId: null, numeroContrato: null,
        cliente: a.model ?? null,
        origen: 'autofind',
        snapshotAt,
      });
    }

    // Reemplazo atómico SOLO de este puerto: el resto del inventario de la OLT no se toca.
    // Una ONU retirada desaparece porque la OLT ya no la reporta — no porque la borremos
    // "porque deberíamos": la ausencia es observada, igual que la presencia.
    await this.ds.transaction(async (tx) => {
      await tx.getRepository(OltOnuInventario).delete({ oltId, slot, port });
      if (filas.length) await tx.getRepository(OltOnuInventario).insert(filas);
    });

    this.logger.log(`reobservarPuerto | olt=${oltId} ${slot}/${port} → ${filas.length} ONU(s) observadas`);
    return { observadas: filas.length };
  }

  private async _fetchConn(oltId: string): Promise<any | null> {
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
      ip: o.ip_gestion, port: o.puerto ?? 22,
      username: o.usuario_anclado, password, brand: o.marca ?? 'huawei',
    };
  }
}
