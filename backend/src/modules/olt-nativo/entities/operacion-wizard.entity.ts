import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * La bitácora de un procedimiento en vuelo: un wizard abierto que ya tocó hardware o
 * reservó recursos y todavía no ha llegado a su estado terminal.
 *
 * Es la mitad de la saga con bitácora write-ahead (ADR-006). Su razón de existir: un wizard
 * cerrado a medias el 2026-07-21 dejó una ONU registrada en la OLT sin `ftth_onu_registro`
 * — discordancia entre el plano físico y el lógico, que es el fallo que más caro sale en
 * este ERP.
 *
 * `heartbeat_at` **suprime el barrido, nunca autoriza nada**, y `techo_en` es el techo
 * absoluto: pasado ese instante el barrido procede aunque el navegador siga latiendo. Sin
 * techo, una pestaña olvidada bloquearía el recurso para siempre.
 *
 * Se declara como entidad para que el compilador vigile sus columnas (R7 / B-2). El acceso
 * sigue siendo por SQL crudo donde ya lo era: aquí la entidad es contrato de tipos.
 */
@Entity('operacion_wizard')
@Index(['estado', 'expiraEn'])
@Index(['recursoRef'])
export class OperacionWizard {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'empresa_id', type: 'uuid' })
  empresaId: string;

  /** Quién lo abrió. Nulable: un procedimiento puede iniciarlo un proceso automático. */
  @Column({ name: 'usuario_id', type: 'uuid', nullable: true })
  usuarioId: string | null;

  @Column({ name: 'tipo', type: 'varchar', length: 48 })
  tipo: string;

  /** Sobre qué actúa: el contrato, la ONU… Es lo que permite detectar concurrencia. */
  @Column({ name: 'recurso_ref', type: 'varchar', length: 64 })
  recursoRef: string;

  /** `en_curso` → `confirmado` | `anulado` | `anulacion_fallida`. */
  @Column({ name: 'estado', type: 'varchar', length: 24, default: 'en_curso' })
  estado: string;

  @Column({ name: 'heartbeat_at', type: 'timestamptz', default: () => 'NOW()' })
  heartbeatAt: Date;

  /** TTL corriente: se desplaza con cada latido. */
  @Column({ name: 'expira_en', type: 'timestamptz' })
  expiraEn: Date;

  /** Techo absoluto: el latido NO lo desplaza. */
  @Column({ name: 'techo_en', type: 'timestamptz' })
  techoEn: Date;

  @Column({ name: 'cerrado_en', type: 'timestamptz', nullable: true })
  cerradoEn: Date | null;

  @Column({ name: 'motivo_cierre', type: 'text', nullable: true })
  motivoCierre: string | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'NOW()' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'NOW()' })
  updatedAt: Date;
}
