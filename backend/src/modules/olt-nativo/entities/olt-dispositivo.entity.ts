import { Entity, Column, Index } from 'typeorm';
import { BaseModel } from '../../../common/entities/base.entity';
import { EstadoOlt } from '../../smartolt/entities/onu.entity';

// ─── Enums nuevos ─────────────────────────────────────────────
export enum OltMarca {
  HUAWEI = 'huawei',
  ZTE    = 'zte',
  VSOL   = 'vsol',
  CDATA  = 'cdata',
}

export enum OltMetodoConexion {
  SMARTOLT_API = 'smartolt_api',  // Proxy vía plataforma SmartOLT
  NATIVO_SSH   = 'nativo_ssh',   // Conexión SSH directa a la OLT
  NATIVO_SNMP  = 'nativo_snmp',  // Monitoreo SNMP (solo lectura)
}

// ─── Re-export para consumidores de este módulo ───────────────
// EstadoOnu ya existe en smartolt con los 6 valores requeridos:
// sin_aprovisionar | aprovisionada | online | offline | error | reemplazada
export { EstadoOnu as OnuEstado } from '../../smartolt/entities/onu.entity';

// ─── OltDispositivo ───────────────────────────────────────────
// Tabla: olt_dispositivos
// Registra OLTs multimarca con acceso nativo (SSH/SNMP) o vía SmartOLT API.
// Cada OLT vive detrás de un Router MikroTik de cabecera (routerId).
@Entity('olt_dispositivos')
@Index('idx_olt_disp_empresa_activo', ['empresaId', 'activo'])
@Index('idx_olt_disp_empresa_marca',  ['empresaId', 'marca'])
@Index('idx_olt_disp_router',         ['routerId'])
@Index('idx_olt_disp_ip',             ['ipGestion'])
export class OltDispositivo extends BaseModel {

  @Column({ name: 'empresa_id' })
  empresaId: string;

  // ── Identificación ────────────────────────────────────────
  @Column({ length: 150 })
  nombre: string;   // Ej: "Cabecera Norte - OLT Principal"

  @Column({ type: 'text', nullable: true })
  descripcion: string;

  @Column({ type: 'enum', enum: OltMarca })
  marca: OltMarca;

  @Column({ length: 100, nullable: true })
  modelo: string;   // MA5800-X7, ZXA10 C300, VS-OLT1601GE, C-DATA FD1104S...

  // ── Conexión ──────────────────────────────────────────────
  @Column({
    name: 'metodo_conexion',
    type: 'enum',
    enum: OltMetodoConexion,
    default: OltMetodoConexion.NATIVO_SSH,
  })
  metodoConexion: OltMetodoConexion;

  @Column({ name: 'ip_gestion', type: 'inet' })
  ipGestion: string;   // IP privada dentro de la red VPN, ej: "10.0.50.2"

  @Column({ type: 'int', default: 22 })
  puerto: number;   // 22 para SSH | 161 para SNMP

  @Column({ name: 'usuario_anclado', length: 100 })
  usuarioAnclado: string;

  // Almacenado cifrado con AES-256-GCM (encryption.util.ts)
  // Formato en BD: iv:authTag:ciphertext (todo hexadecimal)
  @Column({ name: 'contrasena_cifrada', type: 'text' })
  contrasenaCifrada: string;

  // ── Capacidad física ──────────────────────────────────────
  @Column({ name: 'slots_totales', type: 'smallint', default: 1 })
  slotsTotales: number;   // Tarjetas físicas en el chasis

  @Column({ name: 'puertos_por_slot', type: 'smallint', default: 8 })
  puertosPorSlot: number;   // Puertos PON por tarjeta de línea

  @Column({
    name: 'vlan_gestion_defecto',
    type: 'smallint',
    nullable: true,
    comment: 'VLAN de gestión/tráfico por defecto. Ej: 201',
  })
  vlanGestionDefecto: number | null;

  // ── SNMP (complementa monitoreo pasivo) ───────────────────
  @Column({ name: 'snmp_community', length: 100, nullable: true, default: 'public' })
  snmpCommunity: string;

  @Column({ name: 'snmp_version', type: 'smallint', default: 2 })
  snmpVersion: number;   // 1 | 2 | 3

  // ── Relaciones (FK almacenadas como UUID string) ──────────

  // Router MikroTik detrás del cual reside físicamente la OLT.
  // ON DELETE RESTRICT — no se puede borrar el router si tiene OLTs.
  @Column({ name: 'router_id' })
  routerId: string;

  // Enlace opcional al módulo de telemetría pasiva.
  // ON DELETE SET NULL — si se borra el dispositivo de monitoreo, la OLT persiste.
  @Column({ name: 'dispositivo_monitoreo_id', nullable: true })
  dispositivoMonitoreoId: string | null;

  // ── Estado operativo ──────────────────────────────────────
  // Reutiliza el enum EstadoOlt existente (online|offline|mantenimiento|desconocido)
  @Column({ type: 'enum', enum: EstadoOlt, default: EstadoOlt.DESCONOCIDO })
  estado: EstadoOlt;

  @Column({ name: 'ultimo_ping', type: 'timestamptz', nullable: true })
  ultimoPing: Date;

  @Column({ name: 'total_pon_ports', type: 'smallint', nullable: true })
  totalPonPorts: number;   // slots_totales × puertos_por_slot (calculable, caché)

  @Column({ name: 'onus_activas', type: 'int', default: 0 })
  onusActivas: number;

  // ── Ubicación geográfica ──────────────────────────────────
  @Column({ length: 200, nullable: true })
  ubicacion: string;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  latitud: number;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  longitud: number;

  @Column({ default: true })
  activo: boolean;
}
