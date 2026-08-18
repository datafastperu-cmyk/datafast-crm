import { Entity, Column, Index } from 'typeorm';
import { BaseModel } from '../../../common/entities/base.entity';
import { TipoItem } from './comprobante-config.entity';

// ─── Cargos pendientes para el siguiente ciclo ────────────────
// Cuando mora o reconexión ocurren y la config dice
// "acumular en siguiente ciclo", se registra aquí.
// El generador de facturas los lee e incluye como items
// antes de emitir el siguiente comprobante del cliente.
@Entity('cargos_pendientes')
@Index(['clienteId', 'incluidoEnFacturaId'])
@Index(['empresaId', 'incluidoEnFacturaId'])
export class CargoPendiente extends BaseModel {

  @Column({ name: 'empresa_id' })
  empresaId: string;

  @Column({ name: 'cliente_id' })
  clienteId: string;

  /**
   * El ACUERDO (tabla `contratos`) del que cuelga el cargo -- Ola 2, Paso B (2026-08-18).
   * Antes de esta migración esta columna guardaba un `servicios.id` bajo un nombre que
   * mentía sobre lo que contenía; ver `servicioId` para esa dimensión, que no se perdió.
   */
  @Column({ name: 'contrato_id', type: 'uuid', nullable: true })
  contratoId: string | null;

  /**
   * Qué SERVICIO motivó el cargo -- solo para tipo IN ('servicio', 'reconexion'); NULL en
   * mora, que es del acuerdo, no de un servicio concreto.
   */
  @Column({ name: 'servicio_id', type: 'uuid', nullable: true })
  servicioId: string | null;

  // 'reconexion' → siempre aplica IGV
  // 'mora'       → nunca aplica IGV
  @Column({ type: 'varchar', length: 20 })
  tipo: TipoItem;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  monto: number;

  // Derivado del tipo: mora=false, reconexion=true
  // Guardado explícitamente para que el generador no recalcule
  @Column({ name: 'aplica_igv' })
  aplicaIgv: boolean;

  @Column({ type: 'text', nullable: true })
  descripcion: string | null;

  // null = pendiente de incluir en próxima factura
  // uuid = ya fue incluido en esa factura
  @Column({ name: 'incluido_en_factura_id', type: 'uuid', nullable: true })
  incluidoEnFacturaId: string | null;

  @Column({ name: 'incluido_en', type: 'timestamptz', nullable: true })
  incluidoEn: Date | null;

  @Column({ name: 'generado_por', type: 'uuid', nullable: true })
  generadoPor: string | null;
}
