import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { OltDispositivo }             from '../entities/olt-dispositivo.entity';
import { FtthOnuRegistro }            from '../entities/ftth-onu-registro.entity';
import { OltAutomationClient }        from '../olt-automation.client';
import { decrypt }                    from '../../../common/utils/encryption.util';
import { OltServicePortPoolService }  from './olt-service-port-pool.service';
import { OltOnuIdPoolService }        from './olt-onu-id-pool.service';
import { OltMgmtIpPoolService }       from './olt-mgmt-ip-pool.service';
import { OperacionWizardPasoService, PasoRow } from './operacion-wizard-paso.service';

// ─────────────────────────────────────────────────────────────
// CompensadorWizardService — ejecuta las compensaciones de la bitácora (Fase 2).
//
// Invariantes que respeta, y por qué:
//
//  1. ORDEN LIFO. Se deshace en orden inverso al de aplicación. No es estética: el paso de
//     hardware (`olt_gpon`) se registra DESPUÉS del registro y los pools, así que al
//     invertir se limpia la OLT ANTES de soltar el registro y los IDs. Es el invariante de
//     atomicidad expresado como orden.
//
//  2. SE DETIENE AL PRIMER FALLO. Si una compensación no se puede confirmar, NO se sigue con
//     las siguientes. Continuar sería borrar el registro y liberar los pools con la OLT
//     todavía sucia — exactamente la receta del ONT huérfano. La operación queda en
//     `anulacion_fallida` y la hereda el watcher.
//
//  3. IDEMPOTENCIA. Toda compensación puede ejecutarse dos veces sin daño: una anulación
//     interrumpida se reintenta desde el principio. "Ya no existe" al deshacer cuenta como
//     ÉXITO, no como error.
//
//  4. VIO AL DESHACER. Una compensación no confirmada no se reporta como hecha. Para
//     `olt_gpon` la confirmación la aporta `rollback_gpon`, que verifica con
//     `display ont info` que el ONT ya no está — por eso sirve además como sonda para los
//     pasos que quedaron `en_vuelo`: ejecutarlo es a la vez comprobar y deshacer.
// ─────────────────────────────────────────────────────────────
@Injectable()
export class CompensadorWizardService {
  private readonly logger = new Logger(CompensadorWizardService.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(OltDispositivo) private readonly oltRepo: Repository<OltDispositivo>,
    @InjectRepository(FtthOnuRegistro) private readonly ftthRepo: Repository<FtthOnuRegistro>,
    private readonly automation:  OltAutomationClient,
    private readonly poolService: OltServicePortPoolService,
    private readonly onuIdPool:   OltOnuIdPoolService,
    private readonly mgmtIpPool:  OltMgmtIpPoolService,
    private readonly pasos:       OperacionWizardPasoService,
  ) {}

  /**
   * Anula una operación completa: compensa sus pasos en LIFO hasta terminar o hasta el
   * primer fallo. Devuelve si la anulación quedó COMPLETA.
   */
  async anular(operacionId: string): Promise<{ completa: boolean; compensados: number; fallo?: string }> {
    const pendientes = await this.pasos.pasosACompensar(operacionId);
    let compensados = 0;

    for (const paso of pendientes) {
      try {
        await this._compensar(paso);
        await this.pasos.marcarCompensado(paso.id);
        compensados++;
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        await this.pasos.marcarCompensacionFallida(paso.id, msg);
        this.logger.error(
          `Compensación FALLIDA | operacion=${operacionId} paso=${paso.tipo} (#${paso.orden}): ${msg}`,
        );
        // Invariante 2: no se sigue deshaciendo con el hardware sin confirmar.
        await this._marcarOperacion(operacionId, 'anulacion_fallida', msg);
        return { completa: false, compensados, fallo: msg };
      }
    }

    await this._marcarOperacion(operacionId, 'anulado', null);
    this.logger.log(`Operación anulada | id=${operacionId} pasos_compensados=${compensados}`);
    return { completa: true, compensados };
  }

  private async _compensar(paso: PasoRow): Promise<void> {
    const c = paso.compensacion as any;

    switch (paso.tipo) {
      // ── Hardware ─────────────────────────────────────────────
      // rollback_gpon deshace service-ports (datos y gestión) y hace `ont delete`,
      // verificando con `display ont info` que el ONT ya no exista. Es idempotente:
      // si no hay nada, "does not exist" cuenta como limpio. Por eso vale igual para
      // un paso `aplicado` que para uno `en_vuelo` (que quizá nunca se ejecutó).
      case 'olt_gpon': {
        const olt = await this.oltRepo.findOne({ where: { id: c.oltId, activo: true } });
        if (!olt) {
          throw new Error(`OLT ${c.oltId} no disponible — no se puede confirmar la limpieza del hardware`);
        }

        // El payload se congeló ANTES de ejecutar (write-ahead), así que puede haber
        // quedado obsoleto en dos casos reales:
        //   · El carril TR-069 asigna el service-port de GESTIÓN DESPUÉS de este paso. Sin
        //     él, `ont delete` falla con "has some service virtual ports" — el mismo defecto
        //     que arrastraba FtthRecoveryCron (incidente 2026-07-17).
        //   · El auto-sanado de colisión REASIGNA el service-port de datos tras el registro.
        // Por eso los IDs se toman del registro VIVO, que es la verdad actual; el payload
        // solo sirve de respaldo si el registro ya no existe. El orden LIFO garantiza que
        // aquí el registro todavía está (se borra en el último paso).
        const reg = await this.ftthRepo.findOne({
          where: { contratoId: c.contratoId ?? undefined },
          select: ['servicePortId', 'mgmtServicePortId', 'onuId', 'slot', 'port'],
        }).catch(() => null);

        const res = await this.automation.ftthRollbackGpon({
          connection: {
            ip: olt.ipGestion, port: olt.puerto,
            username: olt.usuarioAnclado, password: decrypt(olt.contrasenaCifrada),
            brand: olt.marca,
          },
          slot:                 reg?.slot  ?? c.slot,
          port:                 reg?.port  ?? c.port,
          onu_id:               reg?.onuId ?? c.onuId,
          service_port_id:      reg?.servicePortId     ?? c.servicePortId     ?? null,
          mgmt_service_port_id: reg?.mgmtServicePortId ?? c.mgmtServicePortId ?? null,
        });
        if (!res.success) {
          throw new Error(`Limpieza de la OLT NO confirmada: ${res.error ?? 'sin detalle'}`);
        }
        return;
      }

      // ── Recursos reservados (solo BD) ────────────────────────
      // Todas idempotentes: si ya están libres, el UPDATE afecta 0 filas y no es un error.
      // Libera AMBOS canales del contrato, no solo el que se anotó. El service-port de
      // GESTIÓN lo asigna el carril TR-069 en una tarea asíncrona posterior que no pasa por
      // la bitácora; sin esto el ID de gestión quedaba 'ocupado' para siempre aunque su
      // service-port ya no existiera en la OLT. `liberar` es idempotente: si un canal no
      // tenía nada asignado, el UPDATE afecta 0 filas y no es un error.
      case 'pool_service_port':
        await this.poolService.liberar(c.oltId, c.contratoId, 'datos');
        await this.poolService.liberar(c.oltId, c.contratoId, 'gestion');
        await this.mgmtIpPool.liberar(c.oltId, c.contratoId).catch(() => { /* puede no haberse asignado */ });
        return;

      case 'pool_onu_id':
        await this.onuIdPool.liberar(c.oltId, c.contratoId);
        return;

      case 'pool_mgmt_ip':
        await this.mgmtIpPool.liberar(c.oltId, c.contratoId);
        return;

      // Se compensa DESPUÉS del hardware por el orden LIFO: si `olt_gpon` no se pudo
      // confirmar, el bucle ya se detuvo y este paso nunca llega a ejecutarse — el
      // registro jamás se borra con la OLT sucia.
      case 'registro_ftth':
        await this.ftthRepo.delete({ contratoId: c.contratoId });
        return;

      default:
        throw new Error(`Tipo de paso sin compensador: ${paso.tipo}`);
    }
  }

  private async _marcarOperacion(id: string, estado: string, error: string | null): Promise<void> {
    await this.ds.query(
      `UPDATE operacion_wizard
       SET estado = $2, motivo_cierre = COALESCE($3, motivo_cierre), updated_at = NOW()
       WHERE id = $1`,
      [id, estado, error],
    );
  }

  /**
   * Toma las operaciones marcadas para anular y las procesa. Una sola pasada ordenada por
   * ciclo: nada de reintentos agresivos — el MA5800 tiene un límite bajo de sesiones VTY
   * concurrentes y martillarlo es lo que provoca los timeouts. Las que fallen se reintentan
   * en el siguiente ciclo del cron.
   */
  async procesarPendientes(limite = 5): Promise<{ procesadas: number; completas: number }> {
    const ops = await this.ds.query<{ id: string }[]>(
      `SELECT id FROM operacion_wizard
       WHERE estado IN ('anulando', 'anulacion_fallida')
       ORDER BY updated_at ASC
       LIMIT $1`,
      [limite],
    );

    let completas = 0;
    for (const op of ops) {
      const r = await this.anular(op.id).catch((e) => {
        this.logger.error(`anular() lanzó | operacion=${op.id}: ${e?.message}`);
        return { completa: false, compensados: 0 };
      });
      if (r.completa) completas++;
    }

    if (ops.length > 0) {
      this.logger.log(`Anulaciones procesadas: ${ops.length}, completas: ${completas}`);
    }
    return { procesadas: ops.length, completas };
  }
}
