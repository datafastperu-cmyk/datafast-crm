import { Entity, Column, Index } from 'typeorm';
import { BaseModel } from '../../../common/entities/base.entity';

export enum TipoPlan { RESIDENCIAL='residencial', EMPRESARIAL='empresarial', DEDICADO='dedicado', PREPAGO='prepago' }
export enum TipoQueue { SIMPLE_QUEUE='simple_queue', QUEUE_TREE='queue_tree', PCQ='pcq', SIN_LIMITE='sin_limite' }
export enum AccionAlLimite { REDUCIR_VELOCIDAD='reducir_velocidad', BLOQUEAR='bloquear', NOTIFICAR='notificar', SIN_ACCION='sin_accion' }

@Entity('planes')
@Index(['empresaId','activo'])
@Index(['empresaId','tipoServicio'])
export class Plan extends BaseModel {
  @Column({ name:'empresa_id' }) empresaId: string;
  @Column({ length:100 }) nombre: string;
  @Column({ type:'text', nullable:true }) descripcion: string;
  @Column({ type:'enum', enum:TipoPlan, default:TipoPlan.RESIDENCIAL }) tipo: TipoPlan;
  @Column({ name:'color_ui', length:20, default:'#3B82F6' }) colorUi: string;
  @Column({ name:'velocidad_bajada', type:'int' }) velocidadBajada: number;
  @Column({ name:'velocidad_subida', type:'int' }) velocidadSubida: number;
  @Column({ name:'burst_bajada', type:'int', nullable:true }) burstBajada: number;
  @Column({ name:'burst_subida', type:'int', nullable:true }) burstSubida: number;
  @Column({ name:'burst_umbral', type:'smallint', default:0 }) burstUmbral: number;
  @Column({ name:'burst_tiempo', type:'smallint', default:0 }) burstTiempo: number;
  @Column({ name:'velocidad_garantizada', type:'int', nullable:true }) velocidadGarantizada: number;
  @Column({ type:'smallint', default:8 }) prioridad: number;
  @Column({ length:100, nullable:true }) addresslist: string;
  @Column({ type:'decimal', precision:10, scale:2 }) precio: number;
  @Column({ name:'precio_instalacion', type:'decimal', precision:10, scale:2, default:0 }) precioInstalacion: number;
  @Column({ name:'aplica_igv', default:true }) aplicaIgv: boolean;
  @Column({ name:'tipo_queue', type:'enum', enum:TipoQueue, default:TipoQueue.SIMPLE_QUEUE }) tipoQueue: TipoQueue;
  @Column({ name:'ppp_profile', length:100, nullable:true }) pppProfile: string;
  @Column({ name:'ppp_service', length:50, default:'pppoe' }) pppService: string;
  @Column({ name:'pool_ip', length:100, nullable:true }) poolIp: string;
  @Column({ name:'vlan_id', type:'smallint', nullable:true }) vlanId: number;
  @Column({ name:'tipo_servicio', length:20, default:'ftth' }) tipoServicio: string;
  @Column({ name:'ciclo_facturacion', length:20, default:'mensual' }) cicloFacturacion: string;
  @Column({ name:'dias_contrato_minimo', type:'int', default:0 }) diasContratoMinimo: number;
  @Column({ name:'tiene_limite_datos', default:false }) tieneLimiteDatos: boolean;
  @Column({ name:'limite_datos_gb', type:'int', nullable:true }) limiteDatosGb: number;
  @Column({ name:'accion_al_limite', type:'enum', enum:AccionAlLimite, default:AccionAlLimite.REDUCIR_VELOCIDAD }) accionAlLimite: AccionAlLimite;
  @Column({ name:'velocidad_post_limite', type:'int', nullable:true }) velocidadPostLimite: number;
  @Column({ default:true }) activo: boolean;
  @Column({ name:'visible_en_portal', default:false }) visibleEnPortal: boolean;
  @Column({ name:'orden_display', type:'smallint', default:0 }) ordenDisplay: number;

  get maxLimitMikrotik(): string { return `${this.velocidadSubida}M/${this.velocidadBajada}M`; }
  get descripcionVelocidad(): string { return `${this.velocidadBajada}/${this.velocidadSubida} Mbps`; }
}
