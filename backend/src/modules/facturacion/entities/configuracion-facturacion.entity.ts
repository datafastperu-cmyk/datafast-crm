import { Entity, Column, Index } from 'typeorm';
import { BaseModel } from '../../../common/entities/base.entity';

// ─── Configuración global de facturación por empresa ─────────
// Una fila por empresa. Es la "matriz" que referencia
// /configuracion/facturacion-config en el frontend.
@Entity('configuracion_facturacion')
@Index(['empresaId'], { unique: true })
export class ConfiguracionFacturacion extends BaseModel {

  @Column({ name: 'empresa_id' })
  empresaId: string;

  // Moneda: 'PEN', 'USD', 'COP', etc.
  @Column({ length: 3, default: 'PEN' })
  moneda: string;

  // Tasa IGV/IVA como decimal: 0.18 = 18%
  @Column({ name: 'igv_rate', type: 'decimal', precision: 5, scale: 4, default: 0.18 })
  igvRate: number;

  // Si mora/reconexión ocurren, se acumulan en el SIGUIENTE ciclo de facturación
  // (no generan cargo inmediato separado)
  @Column({ name: 'mora_acumula_siguiente_ciclo', default: true })
  moraAcumulaSiguienteCiclo: boolean;

  @Column({ name: 'reconexion_acumula_siguiente_ciclo', default: true })
  reconexionAcumulaSiguienteCiclo: boolean;

  @Column({ name: 'actualizado_por', nullable: true })
  actualizadoPor: string;
}
