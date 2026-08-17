import { Entity, Column, Index } from 'typeorm';
import { BaseModel } from '../../../common/entities/base.entity';

/**
 * Confianza del dato de última milla.
 *
 * Que un técnico haya escrito "NAP-12, puerto 3" no significa que el cliente esté ahí:
 * es una afirmación SIN VERIFICAR. Es el patrón del incidente CNT-2026-000004 aplicado
 * hacia adentro — accepted ≠ materialized. El puente verificable es
 * `olt_onu_inventario` (olt_id, slot, port, sn) más la potencia óptica.
 */
export enum AcometidaConfianza {
  /** Lo escribió un humano, nadie lo comprobó. Estado de alta. */
  DECLARADO = 'declarado',
  /** El puerto PON derivado del grafo coincide con el real de la ONU. */
  VERIFICADO = 'verificado',
  /** NO coinciden. No se autocorrige: no se sabe cuál de los dos planos miente. */
  DISCREPANTE = 'discrepante',
}

/** Evidencia observable que sostiene un `VERIFICADO`. Sin esto sería un `success:true` sin comprobar. */
export interface EvidenciaAcometida {
  oltId: string;
  slot: number;
  port: number;
  sn: string;
  rxDbm: number | null;
}

// ─── Acometida (última milla) ───────────────────────────────────
// Tabla: pe_acometida
//
// Los índices únicos parciales `uq_pe_acometida_puerto` y `uq_pe_acometida_servicio`
// son la garantía REAL de exclusividad: un puerto, un servicio. El UPDATE condicional
// del servicio es la primera defensa; los índices son la que no depende de que ese
// UPDATE esté bien escrito hoy y siga estándolo dentro de dos años.
@Entity('pe_acometida')
@Index('idx_pe_acometida_empresa', ['empresaId', 'confianza'], { where: '"deleted_at" IS NULL' })
export class PeAcometida extends BaseModel {

  @Column({ name: 'empresa_id', type: 'uuid' })
  empresaId: string;

  /** El Servicio Contratado (tabla `servicios`), nunca el acuerdo — Ola 2. */
  @Column({ name: 'servicio_id', type: 'uuid' })
  servicioId: string;

  @Column({ name: 'nap_puerto_id', type: 'uuid' })
  napPuertoId: string;

  @Column({ name: 'longitud_m', type: 'numeric', precision: 6, scale: 2, nullable: true })
  longitudM: number | null;

  @Column({ type: 'varchar', length: 20, default: AcometidaConfianza.DECLARADO })
  confianza: AcometidaConfianza;

  @Column({ name: 'verificado_at', type: 'timestamptz', nullable: true })
  verificadoAt: Date | null;

  @Column({ name: 'verificado_evidencia', type: 'jsonb', nullable: true })
  verificadoEvidencia: EvidenciaAcometida | null;

  /**
   * Pérdida acumulada calculada por el grafo (Fase 3). Se contrasta contra el
   * `rx_power_dbm` real de la ONU: una desviación > 3 dB es alerta de planta — fusión
   * sucia, curvatura, o documentación incorrecta. Es lo que convierte el módulo de un
   * plano a un sistema de diagnóstico.
   */
  @Column({ name: 'presupuesto_optico_db', type: 'numeric', precision: 5, scale: 2, nullable: true })
  presupuestoOpticoDb: number | null;
}
