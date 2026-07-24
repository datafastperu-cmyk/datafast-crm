import { Column, Entity, Index } from 'typeorm';
import { BaseModel } from '../../../common/entities/base.entity';

// ═══════════════════════════════════════════════════════════════════════════
// olt_onu_preset
//
// Preset de auto-config por OLT (la "sección TR-069 de la OLT"). Define los valores
// por defecto que se inyectan a CADA ONU nueva al aprovisionar, y se re-inyectan tras
// un factory-reset: SSID/clave WiFi (2.4/5) y credenciales de acceso web admin.
//
// El SSID es una PLANTILLA por cliente — placeholders {cliente}, {contrato}, {sn} — que se
// resuelve al aplicar, para que cada ONU tenga un nombre de red distinto.
//
// Los secretos (claves WiFi, clave admin) se guardan CIFRADOS (la capa de servicio cifra/
// descifra, igual que `contrato_onu_config`). `enabled=false` por defecto (seguridad): la
// auto-config solo se activa cuando el operador la configura explícitamente por OLT.
// ═══════════════════════════════════════════════════════════════════════════
@Entity('olt_onu_preset')
@Index('uq_olt_onu_preset_olt', ['oltId'], { unique: true, where: 'deleted_at IS NULL' })
export class OltOnuPreset extends BaseModel {
  @Column({ name: 'empresa_id', type: 'uuid' })
  empresaId: string;

  @Column({ name: 'olt_id', type: 'uuid' })
  oltId: string;

  /** Activa la auto-inyección del preset al aprovisionar / tras factory-reset. */
  @Column({ name: 'enabled', type: 'boolean', default: false })
  enabled: boolean;

  // ── WiFi 2.4G ──
  /** Plantilla del SSID: admite {cliente}, {contrato}, {sn}. Ej.: "DATAFAST-{cliente}". */
  @Column({ name: 'wifi_ssid_template', type: 'varchar', length: 64, nullable: true })
  wifiSsidTemplate: string | null;

  /** Cifrada. */
  @Column({ name: 'wifi_password', type: 'text', nullable: true })
  wifiPassword: string | null;

  // ── WiFi 5G ──
  /** Plantilla del SSID 5G. Si es null, se deriva de la 2.4 con sufijo "-5G". */
  @Column({ name: 'wifi5g_ssid_template', type: 'varchar', length: 64, nullable: true })
  wifi5gSsidTemplate: string | null;

  /** Cifrada. Si es null, se reutiliza la clave de 2.4G. */
  @Column({ name: 'wifi5g_password', type: 'text', nullable: true })
  wifi5gPassword: string | null;

  // ── Acceso web admin de la ONU ──
  @Column({ name: 'onu_admin_user', type: 'varchar', length: 64, nullable: true })
  onuAdminUser: string | null;

  /** Cifrada. */
  @Column({ name: 'onu_admin_password', type: 'text', nullable: true })
  onuAdminPassword: string | null;
}
