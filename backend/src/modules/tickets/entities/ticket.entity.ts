import { Entity, Column, Index } from 'typeorm';

// ─── Enums ────────────────────────────────────────────────────
export enum CategoriaTicket {
  SIN_INTERNET      = 'sin_internet',
  LENTITUD          = 'lentitud',
  INTERMITENCIA     = 'intermitencia',
  CORTE_DE_LUZ      = 'corte_de_luz',
  EQUIPO_DANADO     = 'equipo_danado',
  CAMBIO_PLAN       = 'cambio_plan',
  CAMBIO_DATOS      = 'cambio_datos',
  FACTURACION       = 'facturacion',
  INSTALACION       = 'instalacion',
  TRASLADO          = 'traslado',
  OTRO              = 'otro',
}

export enum PrioridadTicket {
  BAJA    = 'baja',
  MEDIA   = 'media',
  ALTA    = 'alta',
  CRITICA = 'critica',
}

export enum EstadoTicket {
  ABIERTO            = 'abierto',
  EN_PROGRESO        = 'en_progreso',
  PENDIENTE_CLIENTE  = 'pendiente_cliente',
  PENDIENTE_TECNICO  = 'pendiente_tecnico',
  RESUELTO           = 'resuelto',
  CERRADO            = 'cerrado',
  CANCELADO          = 'cancelado',
}

// ─── Ticket principal ────────────────────────────────────────
@Entity('tickets')
@Index(['empresaId', 'estado', 'prioridad'], { where: "deleted_at IS NULL" })
@Index(['empresaId'], { where: "deleted_at IS NULL" })
export class Ticket {
  @Column({ primary: true, generated: 'uuid' })
  id: string;

  @Column({ name: 'empresa_id' })
  empresaId: string;

  @Column({ name: 'cliente_id' })
  clienteId: string;

  @Column({ name: 'contrato_id', nullable: true })
  contratoId: string;

  @Column({ name: 'tecnico_id', nullable: true })
  tecnicoId: string;

  @Column({ name: 'supervisor_id', nullable: true })
  supervisorId: string;

  @Column({ name: 'creado_por', nullable: true })
  creadoPor: string;

  @Column({ name: 'numero_ticket', length: 20 })
  numeroTicket: string;

  @Column({ length: 250 })
  titulo: string;

  @Column({ type: 'text' })
  descripcion: string;

  @Column({ type: 'enum', enum: CategoriaTicket, default: CategoriaTicket.OTRO })
  categoria: CategoriaTicket;

  @Column({ type: 'enum', enum: PrioridadTicket, default: PrioridadTicket.MEDIA })
  prioridad: PrioridadTicket;

  @Column({ type: 'enum', enum: EstadoTicket, default: EstadoTicket.ABIERTO })
  estado: EstadoTicket;

  @Column({ name: 'fecha_estado', type: 'timestamptz', default: () => 'now()' })
  fechaEstado: Date;

  @Column({ name: 'sla_horas', type: 'smallint', nullable: true, default: 24 })
  slaHoras: number;

  @Column({ name: 'fecha_limite_sla', type: 'timestamptz', nullable: true })
  fechaLimiteSla: Date;

  @Column({ name: 'sla_cumplido', nullable: true })
  slaCumplido: boolean;

  @Column({ type: 'text', nullable: true })
  solucion: string;

  @Column({ name: 'causa_raiz', type: 'text', nullable: true })
  causaRaiz: string;

  @Column({ name: 'imagenes_url', type: 'text', array: true, nullable: true })
  imagenesUrl: string[];

  @Column({ name: 'calificacion_cliente', type: 'smallint', nullable: true })
  calificacionCliente: number;

  @Column({ name: 'comentario_cliente', type: 'text', nullable: true })
  comentarioCliente: string;

  @Column({ name: 'encuesta_enviada_en', type: 'timestamptz', nullable: true })
  encuestaEnviadaEn: Date;

  @Column({ name: 'abierto_por_portal', default: false })
  abiertoPorPortal: boolean;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt: Date;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt: Date;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date;
}

// ─── Comentario de ticket ────────────────────────────────────
@Entity('tickets_comentarios')
@Index(['ticketId', 'createdAt'])
export class TicketComentario {
  @Column({ primary: true, generated: 'increment', type: 'bigint' })
  id: number;

  @Column({ name: 'ticket_id' })
  ticketId: string;

  @Column({ name: 'empresa_id' })
  empresaId: string;

  @Column({ name: 'usuario_id', nullable: true })
  usuarioId: string;

  @Column({ type: 'text' })
  contenido: string;

  @Column({ name: 'es_privado', default: false })
  esPrivado: boolean;

  @Column({ name: 'es_nota_interna', default: false })
  esNotaInterna: boolean;

  @Column({ name: 'imagenes_url', type: 'text', array: true, nullable: true })
  imagenesUrl: string[];

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;
}
