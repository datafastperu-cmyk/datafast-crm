import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Exclusión mutua por contrato para las operaciones FTTH.
 *
 * Una desaprovisión y una provisión en vuelo a la vez sobre el mismo contrato fueron causa
 * directa de una ONU huérfana el 2026-07-21. Este lock lo impide: quien no lo consigue
 * recibe un 409, que es **reintentable, no un veredicto** (ADR-004 — leerlo como definitivo
 * hizo que el outbox descartara trabajo válido).
 *
 * **Cubre UNA operación, no la sesión del wizard.** Tomarlo mientras el operador tiene la
 * pantalla abierta bloquearía el contrato frente a los watchers durante minutos; se adquiere
 * solo mientras se ejecuta cada paso.
 *
 * La clave primaria es `contrato_id`: un contrato, un lock. El `token` identifica al dueño
 * —solo quien lo tomó puede liberarlo— y `expira_en` evita que un proceso muerto lo retenga
 * para siempre.
 *
 * Entidad para que el compilador vigile las columnas (R7 / B-2). El acceso sigue siendo por
 * SQL crudo: la adquisición es un `INSERT … ON CONFLICT DO UPDATE … WHERE expira_en < NOW()
 * RETURNING`, una sola sentencia atómica cuya sustitución por el repositorio reintroduciría
 * la carrera que el lock existe para cerrar.
 */
@Entity('ftth_operacion_lock')
export class FtthOperacionLock {
  @PrimaryColumn({ name: 'contrato_id', type: 'uuid' })
  contratoId: string;

  @Column({ name: 'operacion', type: 'varchar', length: 24 })
  operacion: string;

  /** Dueño del lock. Solo quien lo tomó puede liberarlo. */
  @Column({ name: 'token', type: 'uuid' })
  token: string;

  @Column({ name: 'adquirido_en', type: 'timestamptz', default: () => 'NOW()' })
  adquiridoEn: Date;

  /** TTL corto: un proceso que muere no puede dejar el contrato bloqueado indefinidamente. */
  @Column({ name: 'expira_en', type: 'timestamptz' })
  expiraEn: Date;
}
