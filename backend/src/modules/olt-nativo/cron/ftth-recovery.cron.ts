import { Injectable, Logger } from '@nestjs/common';
import { Cron }               from '@nestjs/schedule';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository }             from 'typeorm';

import { FtthOnuEstado, FtthOnuRegistro } from '../entities/ftth-onu-registro.entity';
import { OltDispositivo }                  from '../entities/olt-dispositivo.entity';
import { OltAutomationClient }             from '../olt-automation.client';
import { decrypt }                         from '../../../common/utils/encryption.util';
import { filasUpdateReturning }            from '../../../common/utils/pg-result.util';

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
    }>(await this.ds.query(
      `UPDATE ftth_onu_registro
       SET locked_at = NOW()
       WHERE locked_at IS NOT NULL
         AND locked_at < NOW() - INTERVAL '10 minutes'
         AND estado IN ('pendiente', 'gpon_registrado', 'wan_inyectado', 'desaprovisionando')
         AND deleted_at IS NULL
       RETURNING id, estado, olt_id, slot, port, onu_id, service_port_id`,
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
      }
    }
  }

  private async _procesarBloqueado(rec: {
    id: string; estado: string; olt_id: string;
    slot: number; port: number; onu_id: number; service_port_id: number | null;
  }): Promise<void> {

    const necesitaRollback =
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
          this.logger.error(
            `FTTH Recovery: no se puede descifrar password OLT ${olt.ipGestion} — solo liberando lock`,
          );
          await this._marcarFallido(rec.id, 'Recovery: lock expirado (password OLT indescifrable)');
          return;
        }

        this.logger.warn(
          `FTTH Recovery rollback GPON | registroId=${rec.id} ` +
          `OLT=${olt.ipGestion} slot=${rec.slot} port=${rec.port} onu_id=${rec.onu_id}`,
        );

        try {
          await this.automation.ftthRollbackGpon({
            connection:      { ip: olt.ipGestion, port: olt.puerto, username: olt.usuarioAnclado, password, brand: olt.marca },
            slot:            rec.slot,
            port:            rec.port,
            onu_id:          rec.onu_id,
            service_port_id: rec.service_port_id,
          });
        } catch (err: any) {
          this.logger.error(
            `FTTH Recovery rollback GPON falló | registroId=${rec.id}: ${err.message}`,
          );
          // Marcamos fallido de todos modos para liberar el lock
        }
      } else {
        this.logger.warn(
          `FTTH Recovery: OLT ${rec.olt_id} no encontrada — liberando lock sin rollback`,
        );
      }
    }

    await this._marcarFallido(rec.id, `Recovery automático: lock expirado > 10 min (estado previo: ${rec.estado})`);
    this.logger.log(`FTTH Recovery: registro ${rec.id} liberado → fallido_gpon`);
  }

  private async _marcarFallido(id: string, motivo: string): Promise<void> {
    await this.ftthRepo.update(id, {
      estado:      FtthOnuEstado.FALLIDO_GPON,
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

    const svcLiberados = (svcRes as any)?.rowCount ?? 0;
    const onuLiberados = (onuRes as any)?.rowCount ?? 0;

    if (svcLiberados > 0 || onuLiberados > 0) {
      this.logger.warn(
        `Cleanup IDs huérfanos: ${svcLiberados} service-ports liberados, ${onuLiberados} onu-ids liberados`,
      );
    }
  }
}
