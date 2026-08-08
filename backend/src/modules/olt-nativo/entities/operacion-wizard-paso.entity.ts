import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Un paso de la saga, con **cómo deshacerlo** y **cómo saber si llegó a aplicarse**.
 *
 * La regla que lo gobierna es write-ahead (ADR-006): la compensación se escribe **ANTES**
 * de ejecutar el paso, nunca después. Si el proceso muere entre «ejecuté `ont add`» y
 * «escribí el paso», el huérfano renace — y ese fue el incidente que motivó todo esto.
 *
 * Orden obligatorio: escribir el paso `en_vuelo` → ejecutar contra el hardware → marcar
 * `aplicado`. Un paso que queda `en_vuelo` pasado el TTL es **sospechoso de haberse
 * ejecutado**, y por eso `verificacion` no es opcional en la práctica: sin la sonda, un
 * paso `en_vuelo` no es resoluble — nadie puede saber si hay algo que compensar.
 *
 * Entidad para que el compilador vigile las columnas (R7 / B-2).
 */
@Entity('operacion_wizard_paso')
@Index(['operacionId', 'orden'])
export class OperacionWizardPaso {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'operacion_id', type: 'uuid' })
  operacionId: string;

  /** Las compensaciones se aplican en LIFO: el último paso dado es el primero que se deshace. */
  @Column({ name: 'orden', type: 'int' })
  orden: number;

  @Column({ name: 'tipo', type: 'varchar', length: 48 })
  tipo: string;

  @Column({ name: 'descripcion', type: 'text' })
  descripcion: string;

  /** Cómo deshacer el paso. Lo interpreta el compensador según `tipo`. */
  @Column({ name: 'compensacion', type: 'jsonb' })
  compensacion: Record<string, unknown>;

  /** La sonda: cómo comprobar contra el hardware si el paso llegó a aplicarse. */
  @Column({ name: 'verificacion', type: 'jsonb', nullable: true })
  verificacion: Record<string, unknown> | null;

  /** `en_vuelo` → `aplicado` | `no_aplicado` → `compensado` | `compensacion_fallida`. */
  @Column({ name: 'estado', type: 'varchar', length: 24, default: 'en_vuelo' })
  estado: string;

  @Column({ name: 'error', type: 'text', nullable: true })
  error: string | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'NOW()' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'NOW()' })
  updatedAt: Date;
}
