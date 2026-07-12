import { Column, Entity, Index } from 'typeorm';
import { BaseModel } from '../../../common/entities/base.entity';

// ═══════════════════════════════════════════════════════════════════════════
// contrato_onu_config
//
// Config de servicio de la ONU por contrato, en términos de NEGOCIO (WiFi, VoIP…).
// Es el origen de la DesiredConfiguration del pipeline ZTP. NO contiene rutas TR-069.
//
// Los secretos (claves WiFi/VoIP) se guardan CIFRADOS (igual que las credenciales
// PPPoE del contrato); el cifrado/descifrado lo hace la capa de servicio, no la entidad.
//
// `provisioning_enabled` = false por defecto (regla del experto): el aprovisionamiento
// TR-069 solo se activa explícitamente (p.ej. tenant de laboratorio), nunca al revés.
// ═══════════════════════════════════════════════════════════════════════════
@Entity('contrato_onu_config')
@Index('uq_contrato_onu_config_contrato', ['contratoId'], { unique: true, where: 'deleted_at IS NULL' })
export class ContratoOnuConfig extends BaseModel {
  @Column({ name: 'empresa_id', type: 'uuid' })
  empresaId: string;

  @Column({ name: 'contrato_id', type: 'uuid' })
  contratoId: string;

  // ── WiFi 2.4G ──
  @Column({ name: 'wifi_enabled', type: 'boolean', default: true })
  wifiEnabled: boolean;

  @Column({ name: 'wifi_ssid', type: 'varchar', length: 64, nullable: true })
  wifiSsid: string | null;

  /** Cifrado. */
  @Column({ name: 'wifi_password', type: 'text', nullable: true })
  wifiPassword: string | null;

  /** ¿La clave WiFi la generó el sistema (true) o la cambió el cliente (false)? */
  @Column({ name: 'wifi_password_generated', type: 'boolean', default: true })
  wifiPasswordGenerated: boolean;

  @Column({ name: 'last_generated_at', type: 'timestamptz', nullable: true })
  lastGeneratedAt: Date | null;

  // ── WiFi 5G (opcional) ──
  @Column({ name: 'wifi5g_ssid', type: 'varchar', length: 64, nullable: true })
  wifi5gSsid: string | null;

  /** Cifrado. */
  @Column({ name: 'wifi5g_password', type: 'text', nullable: true })
  wifi5gPassword: string | null;

  // ── VoIP (opcional) ──
  @Column({ name: 'voip_enabled', type: 'boolean', default: false })
  voipEnabled: boolean;

  @Column({ name: 'voip_user', type: 'varchar', length: 64, nullable: true })
  voipUser: string | null;

  /** Cifrado. */
  @Column({ name: 'voip_password', type: 'text', nullable: true })
  voipPassword: string | null;

  // ── Control del pipeline ──
  /** Activación del aprovisionamiento TR-069. false por defecto (seguridad). */
  @Column({ name: 'provisioning_enabled', type: 'boolean', default: false })
  provisioningEnabled: boolean;

  /** Revisión de la config de negocio — sube en cada cambio (base de reconciliación). */
  @Column({ name: 'revision', type: 'int', default: 1 })
  revision: number;
}
