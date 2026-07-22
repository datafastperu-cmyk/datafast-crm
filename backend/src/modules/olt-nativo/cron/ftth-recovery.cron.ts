import { Injectable, Logger } from '@nestjs/common';
import { Cron }               from '@nestjs/schedule';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository }             from 'typeorm';

import { FtthOnuEstado, FtthOnuRegistro } from '../entities/ftth-onu-registro.entity';
import { OltDispositivo }                  from '../entities/olt-dispositivo.entity';
import { OltAutomationClient }             from '../olt-automation.client';
import { decrypt }                         from '../../../common/utils/encryption.util';
import { filasUpdateReturning }            from '../../../common/utils/pg-result.util';
import { EventosSistemaService }           from '../../sistema/eventos-sistema.service';

// ─────────────────────────────────────────────────────────────
// FtthRecoveryCron
//
// Cada 5 minutos busca registros FTTH con locked_at > 10 min
// y los libera, haciendo rollback GPON si ya estaban en la OLT.
//
// Escenarios:
//   pendiente          → ninguna acción en OLT, solo marcar fallido_gpon
//   gpon_registrado    → rollback GPON en OLT, marcar fallido_gpon
//   wan_inyectado      → rollback GPON en OLT (WAN OMCI no tiene undo clean),
//                        marcar fallido_gpon
//   desaprovisionando  → marcar fallido_gpon (proceso de baja abortado)
// ─────────────────────────────────────────────────────────────
@Injectable()
export class FtthRecoveryCron {
  private readonly logger = new Logger(FtthRecoveryCron.name);

  constructor(
    @InjectDataSource()
    private readonly ds: DataSource,

    @InjectRepository(FtthOnuRegistro)
    private readonly ftthRepo: Repository<FtthOnuRegistro>,

    @InjectRepository(OltDispositivo)
    private readonly oltRepo: Repository<OltDispositivo>,

    private readonly automation: OltAutomationClient,

    private readonly eventos: EventosSistemaService,
  ) {}

  // Minutos 4,9,…,59 — disjuntos del health-poller (x0) y del monitoreo (2,7,…)
  // para no colisionar sesiones SSH sobre la misma OLT.
  @Cron('4-59/5 * * * *')
  async liberarBloqueados(): Promise<void> {
    // UPDATE atómico: solo la instancia que gana el race obtiene las filas.
    // locked_at se renueva a NOW() para que la condición `< NOW() - 10min`
    // sea falsa para cualquier otra instancia que corra en paralelo.
    const bloqueados = filasUpdateReturning<{
      id: string; estado: string; olt_id: string;
      slot: number; port: number; onu_id: number; service_port_id: number | null;
      mgmt_service_port_id: number | null;
    }>(await this.ds.query(
      `UPDATE ftth_onu_registro
       SET locked_at = NOW()
       WHERE locked_at IS NOT NULL
         AND locked_at < NOW() - INTERVAL '10 minutes'
         AND estado IN ('pendiente', 'gpon_registrado', 'wan_inyectado', 'desaprovisionando')
         AND deleted_at IS NULL
       RETURNING id, estado, olt_id, slot, port, onu_id, service_port_id, mgmt_service_port_id`,
    ));

    if (!bloqueados.length) return;

    this.logger.warn(`FTTH Recovery: ${bloqueados.length} registros bloqueados detectados`);

    for (const rec of bloqueados) {
      try {
        await this._procesarBloqueado(rec);
      } catch (err: any) {
        this.logger.error(
          `FTTH Recovery error | registroId=${rec.id} estado=${rec.estado}: ${err.message}`,
        );
        await this.eventos.registrar({
          origen:   'olt',
          codigo:   'FTTH_RECOVERY_ERROR',
          mensaje:  `FTTH Recovery falló para registro ${rec.id} (estado ${rec.estado}): ${err.message}`,
          stack:    err.stack ?? null,
          contexto: { registroId: rec.id, estado: rec.estado, oltId: rec.olt_id, slot: rec.slot, port: rec.port },
        });
      }
    }
  }

  private async _procesarBloqueado(rec: {
    id: string; estado: string; olt_id: string;
    slot: number; port: number; onu_id: number; service_port_id: number | null;
    mgmt_service_port_id: number | null;
  }): Promise<void> {

    // DEFECTO 4 (corregido 2026-07-22): `pendiente` TAMBIÉN necesita rollback. El registro se
    // inserta como 'pendiente' ANTES de tocar la OLT; si el proceso muere entre el `ont add`
    // exitoso y el UPDATE a 'gpon_registrado', el ONT queda en la OLT y el estado dice
    // 'pendiente'. Excluirlo dejaba un huérfano exactamente en esa ventana. El rollback es
    // idempotente (si la OLT no tiene nada, "does not exist" cuenta como limpio), así que
    // intentarlo de más es barato; NO intentarlo es lo que cuesta caro.
    const necesitaRollback =
      rec.estado === FtthOnuEstado.PENDIENTE ||
      rec.estado === FtthOnuEstado.GPON_REGISTRADO ||
      rec.estado === FtthOnuEstado.WAN_INYECTADO;

    if (necesitaRollback) {
      const olt = await this.oltRepo.findOne({
        where: { id: rec.olt_id, activo: true },
      });

      if (olt) {
        let password: string;
        try {
          password = decrypt(olt.contrasenaCifrada);
        } catch {
          // No se puede tocar la OLT → NO se puede afirmar que esté limpia. Mismo criterio
          // que un rollback no confirmado: fallido_rollback, nunca fallido_gpon.
          this.logger.error(
            `FTTH Recovery: no se puede descifrar password OLT ${olt.ipGestion} — la OLT queda sin verificar`,
          );
          await this._marcarNoConfirmado(
            rec.id, 'Recovery: lock expirado y la OLT NO se pudo limpiar (password indescifrable)',
          );
          return;
        }

        this.logger.warn(
          `FTTH Recovery rollback GPON | registroId=${rec.id} ` +
          `OLT=${olt.ipGestion} slot=${rec.slot} port=${rec.port} onu_id=${rec.onu_id}`,
        );

        // DEFECTOS 1 y 2 (corregidos 2026-07-22):
        //  · `ftthRollbackGpon` devuelve {success:false} SIN lanzar (así está documentado en
        //    el driver Python). Capturar solo excepciones hacía que un rollback fallido se
        //    tomara como exitoso → se marcaba el registro y el ONT quedaba vivo en la OLT.
        //  · Sin `mgmt_service_port_id` el `ont delete` falla con "has some service virtual
        //    ports" (incidente 2026-07-17). Como HOY toda provisión crea carril TR-069, ese
        //    era el modo de fallo probable, no el raro.
        let rbOk = false;
        let rbErr: string | null = null;
        try {
          const res = await this.automation.ftthRollbackGpon({
            connection:           { ip: olt.ipGestion, port: olt.puerto, username: olt.usuarioAnclado, password, brand: olt.marca },
            slot:                 rec.slot,
            port:                 rec.port,
            onu_id:               rec.onu_id,
            service_port_id:      rec.service_port_id,
            mgmt_service_port_id: rec.mgmt_service_port_id,
          });
          rbOk  = res.success === true;
          rbErr = res.error ?? null;
        } catch (err: any) {
          rbErr = err?.message ?? String(err);
        }

        // DEFECTO 3 (corregido): si la OLT NO quedó confirmadamente limpia, el registro NO se
        // marca como fallido_gpon "para liberar el lock" — eso es exactamente lo que produce
        // un ONT huérfano. Se conserva en `fallido_rollback`, con los pools retenidos, y lo
        // hereda el watcher `reintentarRollbacksFallidos` hasta confirmar la limpieza real.
        if (!rbOk) {
          this.logger.error(
            `FTTH Recovery rollback GPON NO confirmado | registroId=${rec.id}: ${rbErr ?? 'sin detalle'}`,
          );
          await this.eventos.registrar({
            origen:   'olt',
            codigo:   'FTTH_ROLLBACK_GPON_ERROR',
            mensaje:  `Rollback GPON no confirmado en OLT ${olt.ipGestion} (registro ${rec.id}): ${rbErr ?? 'sin detalle'} — ONU sigue en slot ${rec.slot}/${rec.port} onu_id ${rec.onu_id}; queda en fallido_rollback para reintento`,
            stack:    null,
            contexto: { registroId: rec.id, olt: olt.ipGestion, slot: rec.slot, port: rec.port, onuId: rec.onu_id },
          });
          await this.ftthRepo.update(rec.id, {
            estado:      FtthOnuEstado.FALLIDO_ROLLBACK,
            lockedAt:    null,
            ultimoError: `Recovery: lock expirado pero la limpieza de la OLT NO se confirmó — ${rbErr ?? 'sin detalle'}`,
          });
          this.logger.warn(`FTTH Recovery: registro ${rec.id} → fallido_rollback (OLT sucia, watcher reintentará)`);
          return;
        }
      } else {
        // OLT inexistente o inactiva: tampoco podemos confirmar que quedó limpia.
        this.logger.warn(
          `FTTH Recovery: OLT ${rec.olt_id} no encontrada/inactiva — la OLT queda sin verificar`,
        );
        await this._marcarNoConfirmado(
          rec.id, `Recovery: lock expirado y la OLT ${rec.olt_id} no está disponible para limpiarla`,
        );
        return;
      }
    }

    await this._marcarFallido(rec.id, `Recovery automático: lock expirado > 10 min (estado previo: ${rec.estado})`);
    this.logger.log(`FTTH Recovery: registro ${rec.id} liberado → fallido_gpon`);
  }

  // Camino LIMPIO: la OLT quedó confirmadamente sin la ONU (o nunca hubo nada que borrar).
  private async _marcarFallido(id: string, motivo: string): Promise<void> {
    await this.ftthRepo.update(id, {
      estado:      FtthOnuEstado.FALLIDO_GPON,
      lockedAt:    null,
      ultimoError: motivo,
    });
  }

  // Camino SUCIO: no se pudo CONFIRMAR que la OLT quedó limpia. El registro se conserva
  // vinculado al contrato (nunca huérfano) con los pools retenidos, y el watcher
  // `reintentarRollbacksFallidos` reintenta hasta confirmar la limpieza real.
  private async _marcarNoConfirmado(id: string, motivo: string): Promise<void> {
    await this.ftthRepo.update(id, {
      estado:      FtthOnuEstado.FALLIDO_ROLLBACK,
      lockedAt:    null,
      ultimoError: motivo,
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Cada 30 min: libera IDs de pool que quedaron 'ocupado' sin
  // registro FTTH asociado (crash entre allocar() e INSERT).
  // ─────────────────────────────────────────────────────────────
  @Cron('*/30 * * * *')
  async limpiarIdsHuerfanos(): Promise<void> {
    const [svcRes, onuRes] = await Promise.all([
      this.ds.query<{ rowCount: number }>(
        `UPDATE olt_service_port_pool
         SET estado = 'libre', contrato_id = NULL, locked_at = NULL, updated_at = NOW()
         WHERE estado = 'ocupado'
           AND contrato_id IS NOT NULL
           AND contrato_id NOT IN (
             SELECT contrato_id FROM ftth_onu_registro WHERE deleted_at IS NULL
           )`,
      ),
      this.ds.query<{ rowCount: number }>(
        `UPDATE olt_onu_id_pool
         SET estado = 'libre', contrato_id = NULL, updated_at = NOW()
         WHERE estado = 'ocupado'
           AND contrato_id IS NOT NULL
           AND contrato_id NOT IN (
             SELECT contrato_id FROM ftth_onu_registro WHERE deleted_at IS NULL
           )
           AND deleted_at IS NULL`,
      ),
    ]);

    // Locks de operación ya vencidos: no afectan la exclusión (un lock expirado es
    // sobrescribible por diseño), pero sin barrer la tabla crece indefinidamente.
    await this.ds.query(
      `DELETE FROM ftth_operacion_lock WHERE expira_en < NOW() - INTERVAL '1 hour'`,
    ).catch(() => { /* best-effort: no es crítico para la correctitud */ });

    const svcLiberados = (svcRes as any)?.rowCount ?? 0;
    const onuLiberados = (onuRes as any)?.rowCount ?? 0;

    if (svcLiberados > 0 || onuLiberados > 0) {
      this.logger.warn(
        `Cleanup IDs huérfanos: ${svcLiberados} service-ports liberados, ${onuLiberados} onu-ids liberados`,
      );
    }
  }
}
