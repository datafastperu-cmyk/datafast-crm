import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/** Tipos de paso compensables. Cada uno tiene su handler en CompensadorService. */
export type TipoPaso =
  | 'pool_service_port'   // ID de service-port reservado (canal datos o gestion)
  | 'pool_onu_id'         // ONT-ID reservado en el puerto PON
  | 'pool_mgmt_ip'        // IP del pool de gestión
  | 'registro_ftth'       // fila ftth_onu_registro creada
  | 'olt_gpon';           // `ont add` + service-port(s) en la OLT  ← el único que ensucia hardware

export type EstadoPaso =
  | 'en_vuelo'             // escrito ANTES de ejecutar: sospechoso de haberse aplicado
  | 'aplicado'             // confirmado que se aplicó
  | 'no_aplicado'          // se confirmó que NO llegó a aplicarse: nada que compensar
  | 'compensado'
  | 'compensacion_fallida';

export interface PasoRow {
  id:           string;
  operacion_id: string;
  orden:        number;
  tipo:         TipoPaso;
  descripcion:  string;
  compensacion: Record<string, unknown>;
  verificacion: Record<string, unknown> | null;
  estado:       EstadoPaso;
}

// ─────────────────────────────────────────────────────────────
// OperacionWizardPasoService — bitácora de compensación (Fase 2).
//
// Uso obligatorio (write-ahead), en este orden y no otro:
//
//   const pasoId = await pasos.registrarIntencion(opId, 'olt_gpon', ..., compensacion, sonda);
//   const res    = await automation.ftthProvisionGpon(...);        // toca el hardware
//   await pasos.marcarAplicado(pasoId);                            // o marcarNoAplicado()
//
// Si el proceso muere entre la 1ª y la 3ª línea, el paso queda `en_vuelo` y el compensador
// NO asume nada: ejecuta la sonda de `verificacion` contra el hardware para decidir si hay
// algo que deshacer. Escribir el paso DESPUÉS de ejecutar reintroduce el huérfano.
// ─────────────────────────────────────────────────────────────
@Injectable()
export class OperacionWizardPasoService {
  private readonly logger = new Logger(OperacionWizardPasoService.name);

  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /**
   * Escribe la INTENCIÓN de ejecutar un paso, antes de ejecutarlo. Devuelve el id del paso.
   * `orden` se asigna solo, incremental por operación (la compensación lo recorre al revés).
   */
  async registrarIntencion(
    operacionId:  string,
    tipo:         TipoPaso,
    descripcion:  string,
    compensacion: Record<string, unknown>,
    verificacion?: Record<string, unknown>,
  ): Promise<string> {
    const [row] = await this.ds.query<{ id: string }[]>(
      `INSERT INTO operacion_wizard_paso
         (operacion_id, orden, tipo, descripcion, compensacion, verificacion, estado)
       VALUES ($1,
               (SELECT COALESCE(MAX(orden), 0) + 1 FROM operacion_wizard_paso WHERE operacion_id = $1),
               $2, $3, $4::jsonb, $5::jsonb, 'en_vuelo')
       RETURNING id`,
      [operacionId, tipo, descripcion, JSON.stringify(compensacion),
       verificacion ? JSON.stringify(verificacion) : null],
    );
    return row.id;
  }

  /** El paso se aplicó de verdad → queda pendiente de compensar si hay anulación. */
  async marcarAplicado(pasoId: string): Promise<void> {
    await this.ds.query(
      `UPDATE operacion_wizard_paso SET estado='aplicado', updated_at=NOW() WHERE id=$1`,
      [pasoId],
    );
  }

  /**
   * El paso NO llegó a aplicarse (falló limpio, sin efecto). Nada que compensar.
   * Solo debe usarse cuando eso es CIERTO — ante la duda, dejarlo `en_vuelo` y que la
   * sonda de verificación lo resuelva contra el hardware.
   */
  async marcarNoAplicado(pasoId: string, error?: string): Promise<void> {
    await this.ds.query(
      `UPDATE operacion_wizard_paso SET estado='no_aplicado', error=$2, updated_at=NOW() WHERE id=$1`,
      [pasoId, error ?? null],
    );
  }

  /** Pasos a compensar, en orden INVERSO al de aplicación (LIFO). */
  async pasosACompensar(operacionId: string): Promise<PasoRow[]> {
    return this.ds.query<PasoRow[]>(
      `SELECT id, operacion_id, orden, tipo, descripcion, compensacion, verificacion, estado
       FROM   operacion_wizard_paso
       WHERE  operacion_id = $1
         AND  estado IN ('aplicado', 'en_vuelo', 'compensacion_fallida')
       ORDER  BY orden DESC`,
      [operacionId],
    );
  }

  async marcarCompensado(pasoId: string): Promise<void> {
    await this.ds.query(
      `UPDATE operacion_wizard_paso SET estado='compensado', error=NULL, updated_at=NOW() WHERE id=$1`,
      [pasoId],
    );
  }

  async marcarCompensacionFallida(pasoId: string, error: string): Promise<void> {
    await this.ds.query(
      `UPDATE operacion_wizard_paso SET estado='compensacion_fallida', error=$2, updated_at=NOW() WHERE id=$1`,
      [pasoId, error.slice(0, 2000)],
    );
  }
}
