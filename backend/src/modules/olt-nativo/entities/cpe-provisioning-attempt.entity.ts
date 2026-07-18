import { Column, Entity, Index } from 'typeorm';
import { BaseModel } from '../../../common/entities/base.entity';
import { NombreCanal } from '../capability/cpe-provisioning-catalog';

export type EstadoCircuito = 'closed' | 'open';
export type ResultadoIntento = 'exitoso' | 'fallido_red' | 'fallido_auth' | 'fallido_no_soportado';

// Circuit breaker POR ONT + POR CANAL. Independiente del CircuitBreakerService
// genérico (ese es por OLT/proveedor, con umbrales pensados para SSH/REST de
// infraestructura). Este es deliberadamente más estricto para el canal
// http_web: el propio CPE se autobloquea a los 3 intentos de login fallidos
// (confirmado en vivo, incidente CNT-2026-000004) — un umbral de 3 fallos +
// 2 min de recuperación como el genérico sería IMPRUDENTE aquí, porque
// coincide exactamente con el umbral de lockout del equipo. Ver
// CpeProvisioningAttemptService para los valores reales usados (más
// conservadores: 1 intento, cooldown largo).
@Entity('cpe_provisioning_attempt')
@Index(['ftthRegistroId', 'canal'], { unique: true })
export class CpeProvisioningAttempt extends BaseModel {
  @Column({ name: 'empresa_id', type: 'uuid' })
  empresaId: string;

  @Column({ name: 'ftth_registro_id', type: 'uuid' })
  ftthRegistroId: string;

  @Column({ name: 'canal', type: 'varchar', length: 32 })
  canal: NombreCanal;

  @Column({ name: 'estado_circuito', type: 'varchar', length: 10, default: 'closed' })
  estadoCircuito: EstadoCircuito;

  @Column({ name: 'intentos_consecutivos', type: 'smallint', default: 0 })
  intentosConsecutivos: number;

  @Column({ name: 'bloqueado_hasta', type: 'timestamptz', nullable: true })
  bloqueadoHasta: Date | null;

  @Column({ name: 'ultimo_intento_en', type: 'timestamptz', nullable: true })
  ultimoIntentoEn: Date | null;

  @Column({ name: 'ultimo_resultado', type: 'varchar', length: 24, nullable: true })
  ultimoResultado: ResultadoIntento | null;

  @Column({ name: 'ultimo_error', type: 'text', nullable: true })
  ultimoError: string | null;
}
