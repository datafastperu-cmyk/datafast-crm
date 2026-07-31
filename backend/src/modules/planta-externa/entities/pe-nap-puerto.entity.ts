import { Entity, Column, Index } from 'typeorm';
import { BaseModel } from '../../../common/entities/base.entity';
import { PuertoEstado } from '../domain/planta-externa-maquina-estados';

// ─── Puerto de caja NAP ─────────────────────────────────────────
// Tabla: pe_nap_puerto — el RECURSO ASIGNABLE, y la única parte del módulo que se
// disputa bajo concurrencia.
//
// El expediente especificaba "Puertos Libres = Capacidad del Splitter − Clientes
// Activos". Eso es una race condition: dos operadores dando de alta a la vez leen
// ambos "puerto 3 libre" y ambos lo asignan. **Contar no es reservar.** Aquí el
// puerto es una FILA que se toma con un UPDATE condicional de una sola sentencia.
@Entity('pe_nap_puerto')
@Index('idx_pe_puerto_nap_estado', ['napId', 'estado'], { where: '"deleted_at" IS NULL' })
export class PeNapPuerto extends BaseModel {

  @Column({ name: 'empresa_id', type: 'uuid' })
  empresaId: string;

  @Column({ name: 'nap_id', type: 'uuid' })
  napId: string;

  @Column({ type: 'int' })
  numero: number;

  @Column({ type: 'varchar', length: 20, default: PuertoEstado.NO_HABILITADO })
  estado: PuertoEstado;

  /**
   * Qué salida de splitter lo alimenta. NULL = `no_habilitado` (no hay splitter
   * detrás). En BD es `ON DELETE RESTRICT`: retirar un splitter cuyas salidas
   * alimentan puertos debe fallar explícitamente, no vaciarlos en cascada — eso
   * borraría la trazabilidad de clientes que siguen navegando.
   */
  @Column({ name: 'splitter_salida_id', type: 'uuid', nullable: true })
  splitterSalidaId: string | null;

  /**
   * Reserva del wizard de alta. El SERVIDOR es la autoridad: `beforeunload` no puede
   * ejecutar trabajo asíncrono fiable, así que el mecanismo real de liberación es la
   * expiración de este TTL barrida por un cron, jamás un aviso best-effort del
   * navegador (directriz de wizards, punto 10). El heartbeat SUPRIME el barrido; no
   * lo autoriza, y tiene techo absoluto.
   */
  @Column({ name: 'reservado_por_usuario_id', type: 'uuid', nullable: true })
  reservadoPorUsuarioId: string | null;

  @Column({ name: 'reservado_hasta', type: 'timestamptz', nullable: true })
  reservadoHasta: Date | null;

  @Column({ type: 'text', nullable: true })
  observacion: string | null;
}
