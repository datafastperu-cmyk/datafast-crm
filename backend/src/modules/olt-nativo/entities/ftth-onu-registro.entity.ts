import { Entity, Column, Index } from 'typeorm';
import { BaseModel } from '../../../common/entities/base.entity';

export enum FtthOnuEstado {
  PENDIENTE              = 'pendiente',
  GPON_REGISTRADO        = 'gpon_registrado',
  WAN_INYECTADO          = 'wan_inyectado',
  ACTIVO                 = 'activo',
  FALLIDO_GPON           = 'fallido_gpon',
  FALLIDO_WAN            = 'fallido_wan',
  DESAPROVISIONANDO      = 'desaprovisionando',
  TIMEOUT_ONLINE         = 'timeout_online',
  FALLIDO_SERVICE_PORT   = 'fallido_service_port',
  SUSPENDIDO             = 'suspendido',
  // Rollback en la OLT falló: la ONU sigue configurada en la OLT (dirty). El registro
  // se conserva (NUNCA se borra con la OLT sucia — evita el `ont` huérfano sin contrato)
  // y un watcher reintenta la limpieza hasta confirmarla.
  FALLIDO_ROLLBACK       = 'fallido_rollback',
}

// ── Estado del carril de gestión TR-069 (bajo demanda) ──────────────
// Máquina de estados del carril, gobernada por VIO (nunca se infiere del eco del comando).
// Reemplaza al flag booleano `tr069_bootstrap_aplicado`, que queda de solo lectura hasta
// retirarse. Solo aplica al proveedor NATIVO (SmartOLT/AdminOLT gestionan el ACS por su API).
export enum FtthCarrilEstado {
  INACTIVO              = 'inactivo',                // sin interface, sin identidad reservada
  ACTIVANDO             = 'activando',               // bootstrap en vuelo (write-ahead)
  ACTIVO                = 'activo',                   // interface arriba + ONU informando (VIO)
  ACTIVACION_FALLIDA    = 'activacion_fallida',       // aceptado sin converger → watcher reintenta
  DESACTIVANDO          = 'desactivando',            // teardown en vuelo
  // Interface removida pero se CONSERVA la identidad (IP + service-port de gestión) y los
  // datos ACS del CPE — reactivar reusa la misma identidad. Estado del apagado por TTL/botón.
  INACTIVO_RESERVADO    = 'inactivo_reservado',
  DESACTIVACION_FALLIDA = 'desactivacion_fallida',    // teardown no confirmado → watcher reintenta
}

export const FTTH_CARRIL_ACTIVOS: FtthCarrilEstado[] = [
  FtthCarrilEstado.ACTIVANDO,
  FtthCarrilEstado.ACTIVO,
];

export const FTTH_ESTADOS_ACTIVOS: FtthOnuEstado[] = [
  FtthOnuEstado.PENDIENTE,
  FtthOnuEstado.GPON_REGISTRADO,
  FtthOnuEstado.WAN_INYECTADO,
  FtthOnuEstado.ACTIVO,
  FtthOnuEstado.DESAPROVISIONANDO,
  FtthOnuEstado.SUSPENDIDO,
];

export const FTTH_ESTADOS_FALLIDOS: FtthOnuEstado[] = [
  FtthOnuEstado.FALLIDO_GPON,
  FtthOnuEstado.FALLIDO_WAN,
  FtthOnuEstado.TIMEOUT_ONLINE,
  FtthOnuEstado.FALLIDO_SERVICE_PORT,
  FtthOnuEstado.FALLIDO_ROLLBACK,
];

@Entity('ftth_onu_registro')
@Index('idx_ftth_empresa', ['empresaId'])
@Index('idx_ftth_olt',     ['oltId'])
@Index('idx_ftth_estado',  ['estado'])
export class FtthOnuRegistro extends BaseModel {

  @Column({ name: 'empresa_id' })
  empresaId: string;

  @Column({ name: 'contrato_id', unique: true })
  contratoId: string;

  @Column({ name: 'olt_id' })
  oltId: string;

  // ── Posición física en la OLT ─────────────────────────────
  @Column({ type: 'smallint', default: 0 })
  frame: number;

  @Column({ type: 'smallint' })
  slot: number;

  @Column({ type: 'smallint' })
  port: number;

  @Column({ name: 'onu_id', type: 'smallint' })
  onuId: number;

  @Column({ length: 16 })
  sn: string;

  @Column({ name: 'service_port_id', type: 'int', nullable: true })
  servicePortId: number | null;

  @Column({ type: 'smallint' })
  vlan: number;

  @Column({ name: 'lineprofile_id', type: 'int', nullable: true })
  lineprofileId: number | null;

  @Column({ name: 'srvprofile_id', type: 'int', nullable: true })
  srvprofileId: number | null;

  @Column({ name: 'traffic_index_down', type: 'int', nullable: true })
  trafficIndexDown: number | null;

  @Column({ name: 'traffic_index_up', type: 'int', nullable: true })
  trafficIndexUp: number | null;

  @Column({ name: 'description', type: 'varchar', length: 64, nullable: true })
  description: string | null;

  // Modo WAN: 'bridge' (PPPoE en router cliente, sin inyección OMCI) o
  // 'routing' (PPPoE inyectado en la ONU vía OMCI). Default 'bridge'.
  @Column({ name: 'wan_mode', type: 'varchar', length: 10, default: 'bridge' })
  wanMode: string;

  // ── Máquina de estados ────────────────────────────────────
  @Column({
    type: 'enum',
    enum: FtthOnuEstado,
    enumName: 'ftth_onu_estado',
    default: FtthOnuEstado.PENDIENTE,
  })
  estado: FtthOnuEstado;

  // Centinela del lock — si != null este registro está siendo procesado
  @Column({ name: 'locked_at', type: 'timestamptz', nullable: true })
  lockedAt: Date | null;

  @Column({ name: 'intentos_gpon', type: 'smallint', default: 0 })
  intentosGpon: number;

  @Column({ name: 'intentos_wan', type: 'smallint', default: 0 })
  intentosWan: number;

  @Column({ name: 'ultimo_error', type: 'text', nullable: true })
  ultimoError: string | null;

  // ── Datos de salud/monitoreo (actualizados por cron batch-status) ──
  @Column({ name: 'run_state', type: 'varchar', length: 20, nullable: true })
  runState: string | null;

  @Column({ name: 'last_online', type: 'timestamptz', nullable: true })
  lastOnline: Date | null;

  @Column({ name: 'firmware_version', type: 'varchar', length: 100, nullable: true })
  firmwareVersion: string | null;

  @Column({ name: 'equipment_id', type: 'varchar', length: 100, nullable: true })
  equipmentId: string | null;

  @Column({ name: 'uptime_seconds', type: 'bigint', nullable: true })
  uptimeSeconds: number | null;

  @Column({ name: 'traffic_table_id', type: 'int', nullable: true })
  trafficTableId: number | null;

  // ── Carril de gestión TR-069 (ZTP) ──────────────────────────────
  // Persiste que la ONU tuvo aplicado el plano de gestión (bootstrapTr069) y con qué
  // parámetros, para restaurarlo automáticamente tras un re-aprovisionamiento (la OLT
  // borra TODOS los service-ports de la ONU al re-registrarla, incluido el carril).
  @Column({ name: 'tr069_bootstrap_aplicado', type: 'boolean', default: false })
  tr069BootstrapAplicado: boolean;

  // Estado del carril bajo demanda (Fase 0). Se pobla por migración desde
  // `tr069_bootstrap_aplicado`; a partir de la Fase 2 es la fuente de verdad del carril.
  @Column({
    name: 'carril_estado',
    type: 'enum',
    enum: FtthCarrilEstado,
    enumName: 'ftth_carril_estado',
    default: FtthCarrilEstado.INACTIVO,
  })
  carrilEstado: FtthCarrilEstado;

  // Última interacción del operador con el TR-069 de esta ONU (abrir el detalle o cualquier
  // acción). Lo usa el barrido TTL de 3 días — NUNCA el lastInform (que es cada 300s).
  @Column({ name: 'tr069_ultimo_uso_at', type: 'timestamptz', nullable: true })
  tr069UltimoUsoAt: Date | null;

  @Column({ name: 'mgmt_service_port_id', type: 'int', nullable: true })
  mgmtServicePortId: number | null;

  @Column({ name: 'mgmt_vlan', type: 'smallint', nullable: true })
  mgmtVlan: number | null;

  @Column({ name: 'mgmt_traffic_index', type: 'int', nullable: true })
  mgmtTrafficIndex: number | null;

  @Column({ name: 'mgmt_priority', type: 'smallint', nullable: true })
  mgmtPriority: number | null;

  // IP de gestión TR-069 asignada a esta ONU. FUENTE DE VERDAD del ERP (causa raíz
  // 2026-07-24): el pool guardaba la asignación pero el registro no, así el modal, el
  // reconciliador VIO y el ConnectionRequest perdían el rastro de la IP. Sticky por
  // contrato (regla IP-VPN): se persiste al aplicar el carril y solo se limpia al
  // desaprovisionar. `null` = carril no aplicado o modo inactivo.
  @Column({ name: 'mgmt_ip', type: 'varchar', length: 45, nullable: true })
  mgmtIp: string | null;

  // Modo con que se materializó la IP de gestión: 'static' (canónico EG8145V5, único que
  // materializa tráfico — ver CreateOltMgmtIpPool) | 'dhcp' (legacy) | 'inactive'.
  @Column({ name: 'mgmt_ip_mode', type: 'varchar', length: 12, nullable: true })
  mgmtIpMode: string | null;

}

// ── Helpers (fuera de la clase para evitar get/set con SWC) ──────────
export function ftthEstaActivo(r: FtthOnuRegistro): boolean {
  return r.estado === FtthOnuEstado.ACTIVO;
}

export function ftthEstaFallido(r: FtthOnuRegistro): boolean {
  return r.estado === FtthOnuEstado.FALLIDO_GPON ||
         r.estado === FtthOnuEstado.FALLIDO_WAN;
}

export function ftthNecesitaRecovery(r: FtthOnuRegistro): boolean {
  if (!r.lockedAt) return false;
  const minutos = (Date.now() - r.lockedAt.getTime()) / 60_000;
  return minutos > 10;
}
