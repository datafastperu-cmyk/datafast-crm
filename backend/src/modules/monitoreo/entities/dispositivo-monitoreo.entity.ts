// Ruta: /opt/datafast/backend/src/modules/monitoreo/entities/dispositivo-monitoreo.entity.ts

import {
  Column, CreateDateColumn, DeleteDateColumn,
  Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';
import { Fabricante, StatusDispositivo, TipoEquipo } from '../enums/monitoreo.enums';

@Entity('dispositivos_monitoreo')
@Index('idx_disp_mon_empresa',    ['empresaId'])
@Index('idx_disp_mon_status',     ['status'])
@Index('idx_disp_mon_router',     ['routerAccesoId'])
@Index('idx_disp_mon_ip',         ['ipAddress'])
export class DispositivoMonitoreo {

  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ── Multi-tenancy ────────────────────────────────────────────
  @Column({ name: 'empresa_id' })
  empresaId: string;

  // ── Identificación ───────────────────────────────────────────
  @Column({ name: 'nombre_emisor', length: 120 })
  nombreEmisor: string;

  @Column({ name: 'ip_address', length: 45 })
  ipAddress: string;

  // ── Relación opcional al router padre (tabla existente) ──────
  // Nullable: dispositivos standalone no tienen router padre.
  @Column({ name: 'router_acceso_id', nullable: true })
  routerAccesoId: string | null;

  // ── Clasificación ────────────────────────────────────────────
  @Column({
    name:    'tipo_equipo',
    type:    'enum',
    enum:    TipoEquipo,
    default: TipoEquipo.ROUTER_ACCESO,
  })
  tipoEquipo: TipoEquipo;

  @Column({
    name:    'fabricante',
    type:    'enum',
    enum:    Fabricante,
    default: Fabricante.MIKROTIK,
  })
  fabricante: Fabricante;

  @Column({ name: 'modelo_nombre', length: 100, nullable: true })
  modeloNombre: string | null;

  // ── Credenciales de acceso ────────────────────────────────────
  @Column({ name: 'usuario', length: 64, nullable: true })
  usuario: string | null;

  // Almacenado cifrado mediante encrypt() / decrypt()
  @Column({ name: 'contrasena_cifrada', type: 'text', nullable: true })
  contrasenaCifrada: string | null;

  @Column({ name: 'puerto_api', type: 'int', default: 8728 })
  puertoApi: number;

  @Column({ name: 'use_ssl', default: false })
  useSsl: boolean;

  // ── Capacidades de monitoreo ──────────────────────────────────
  @Column({ name: 'monitoreo_snmp', default: false })
  monitoreoSnmp: boolean;

  // Intervalo de chequeo en segundos (default 60 s)
  @Column({ name: 'intervalo_chequeo_seg', type: 'int', default: 60 })
  intervaloChequeoSeg: number;

  // ── Estado ────────────────────────────────────────────────────
  @Column({
    name:    'status',
    type:    'enum',
    enum:    StatusDispositivo,
    default: StatusDispositivo.ONLINE,
  })
  status: StatusDispositivo;

  // Timestamp del último chequeo exitoso
  @Column({ name: 'last_seen_at', type: 'timestamptz', nullable: true })
  lastSeenAt: Date | null;

  // ── Auditoría ────────────────────────────────────────────────
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
