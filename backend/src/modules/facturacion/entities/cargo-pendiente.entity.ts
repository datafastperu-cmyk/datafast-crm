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

  @Column({ name: 'contrato_id', type: 'uuid', nullable: true })
  contratoId: string | null;

  /**
   * Paso A del lote de dinero (Ola 2): qué SERVICIO motivó el cargo -- solo para
   * tipo IN ('servicio', 'reconexion'); NULL en mora, que es del acuerdo, no de un
   * servicio concreto. Aditiva -- ningún servicio la lee todavía.
   */
  @Column({ name: 'servicio_id', type: 'uuid', nullable: true })
  servicioId: string | null;

  /**
   * Paso A del lote de dinero (Ola 2): el ACUERDO real, traducido desde `contratoId` vía
   * `servicios.contrato_id`. Aditiva -- ningún servicio la lee todavía; `contratoId` sigue
   * siendo la fuente de verdad hasta el Paso B.
   */
  @Column({ name: 'contrato_id_real', type: 'uuid', nullable: true })
  contratoIdReal: string | null;

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
