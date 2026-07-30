import {
  Injectable, BadRequestException, NotFoundException, Logger,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

import { TicketRepository } from '../tickets/repositories/ticket.repository';
import {
  CategoriaTicket, PrioridadTicket, EstadoTicket,
} from '../tickets/entities/ticket.entity';

// Soporte visto por el abonado: abrir un ticket, seguirlo y calificarlo al cerrarse.

// Subconjunto seguro de categorías. `instalacion`, `traslado` y `cambio_plan` quedan
// fuera a propósito: implican trabajo comercial o de campo que se coordina, no se
// solicita por un formulario.
const CATEGORIAS_PORTAL: CategoriaTicket[] = [
  CategoriaTicket.SIN_INTERNET,
  CategoriaTicket.LENTITUD,
  CategoriaTicket.INTERMITENCIA,
  CategoriaTicket.CORTE_DE_LUZ,
  CategoriaTicket.EQUIPO_DANADO,
  CategoriaTicket.FACTURACION,
  CategoriaTicket.CAMBIO_DATOS,
  CategoriaTicket.OTRO,
];

const ABIERTOS: EstadoTicket[] = [
  EstadoTicket.ABIERTO,
  EstadoTicket.EN_PROGRESO,
  EstadoTicket.PENDIENTE_CLIENTE,
  EstadoTicket.PENDIENTE_TECNICO,
];

const MAX_ABIERTOS_POR_CONTRATO = 3;

export interface PortalTicket {
  id:            string;
  numero:        string;
  titulo:        string;
  descripcion:   string;
  categoria:     string;
  estado:        string;
  abierto:       boolean;
  solucion:      string | null;
  calificacion:  number | null;
  creadoEn:      string;
  cerradoEn:     string | null;
}

@Injectable()
export class PortalSoporteService {
  private readonly logger = new Logger(PortalSoporteService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly tickets: TicketRepository,
  ) {}

  categoriasDisponibles(): Array<{ id: string; label: string }> {
    return [
      { id: CategoriaTicket.SIN_INTERNET,   label: 'No tengo internet' },
      { id: CategoriaTicket.LENTITUD,       label: 'Internet lento' },
      { id: CategoriaTicket.INTERMITENCIA,  label: 'Se corta a cada rato' },
      { id: CategoriaTicket.CORTE_DE_LUZ,   label: 'Hubo un corte de luz' },
      { id: CategoriaTicket.EQUIPO_DANADO,  label: 'Mi equipo está dañado' },
      { id: CategoriaTicket.FACTURACION,    label: 'Consulta de facturación' },
      { id: CategoriaTicket.CAMBIO_DATOS,   label: 'Corregir mis datos' },
      { id: CategoriaTicket.OTRO,           label: 'Otro motivo' },
    ];
  }

  async listar(clienteId: string, empresaId: string): Promise<PortalTicket[]> {
    const filas = await this.dataSource.query<Array<Record<string, unknown>>>(
      `SELECT id, numero_ticket, titulo, descripcion, categoria::text AS categoria,
              estado::text AS estado, solucion, calificacion_cliente,
              created_at, closed_at
         FROM tickets
        WHERE cliente_id = $1 AND empresa_id = $2 AND deleted_at IS NULL
        ORDER BY created_at DESC
        LIMIT 40`,
      [clienteId, empresaId],
    );

    return filas.map((f) => ({
      id:           String(f.id),
      numero:       String(f.numero_ticket),
      titulo:       String(f.titulo),
      descripcion:  String(f.descripcion),
      categoria:    String(f.categoria),
      estado:       String(f.estado),
      abierto:      ABIERTOS.includes(f.estado as EstadoTicket),
      solucion:     (f.solucion as string) ?? null,
      calificacion: (f.calificacion_cliente as number) ?? null,
      creadoEn:     new Date(f.created_at as string).toISOString(),
      cerradoEn:    f.closed_at ? new Date(f.closed_at as string).toISOString() : null,
    }));
  }

  async crear(
    clienteId: string,
    empresaId: string,
    dto: { contratoId: string; categoria: string; descripcion: string },
  ): Promise<PortalTicket> {
    if (!CATEGORIAS_PORTAL.includes(dto.categoria as CategoriaTicket)) {
      throw new BadRequestException('Selecciona un motivo válido.');
    }

    const [contrato] = await this.dataSource.query<Array<{ id: string }>>(
      `SELECT id FROM contratos
        WHERE id = $1 AND cliente_id = $2 AND empresa_id = $3 AND deleted_at IS NULL`,
      [dto.contratoId, clienteId, empresaId],
    );
    if (!contrato) throw new NotFoundException('Servicio no encontrado');

    // Un abonado con tres tickets abiertos no necesita un cuarto: necesita que alguien
    // atienda los que ya tiene. Sin este tope, un formulario público es una cola infinita.
    const [{ abiertos }] = await this.dataSource.query<Array<{ abiertos: string }>>(
      `SELECT COUNT(*)::int AS abiertos FROM tickets
        WHERE contrato_id = $1 AND empresa_id = $2 AND deleted_at IS NULL
          AND estado = ANY($3::estado_ticket[])`,
      [dto.contratoId, empresaId, ABIERTOS],
    );
    if (Number(abiertos) >= MAX_ABIERTOS_POR_CONTRATO) {
      throw new BadRequestException(
        'Ya tienes solicitudes de soporte en curso. Te responderemos por ellas antes de abrir otra.',
      );
    }

    const categorias = this.categoriasDisponibles();
    const titulo = categorias.find((c) => c.id === dto.categoria)?.label ?? 'Solicitud del portal';

    const numeroTicket = await this.tickets.generarNumero(empresaId);
    const slaHoras = 24;
    const fechaLimiteSla = new Date(Date.now() + slaHoras * 60 * 60_000);

    // `creado_por` queda NULL: no lo creó un usuario del ERP. `abierto_por_portal`
    // distingue el origen para quien atiende.
    //
    // La PRIORIDAD la fija el ERP, nunca el abonado: si el formulario la ofreciera, todo
    // llegaría marcado como crítico y la cola perdería su único criterio de orden.
    const [creado] = await this.dataSource.query<Array<{ id: string; created_at: string }>>(
      `INSERT INTO tickets
         (empresa_id, cliente_id, contrato_id, numero_ticket, titulo, descripcion,
          categoria, prioridad, estado, sla_horas, fecha_limite_sla, abierto_por_portal)
       VALUES ($1, $2, $3, $4, $5, $6, $7::categoria_ticket, $8::prioridad_ticket,
               $9::estado_ticket, $10, $11, true)
       RETURNING id, created_at`,
      [
        empresaId, clienteId, dto.contratoId, numeroTicket, titulo, dto.descripcion.trim(),
        dto.categoria, PrioridadTicket.MEDIA, EstadoTicket.ABIERTO, slaHoras, fechaLimiteSla,
      ],
    );

    this.logger.log(
      `Portal: ticket ${numeroTicket} abierto por abonado ${clienteId} (${dto.categoria})`,
    );

    return {
      id:           creado.id,
      numero:       numeroTicket,
      titulo,
      descripcion:  dto.descripcion.trim(),
      categoria:    dto.categoria,
      estado:       EstadoTicket.ABIERTO,
      abierto:      true,
      solucion:     null,
      calificacion: null,
      creadoEn:     new Date(creado.created_at).toISOString(),
      cerradoEn:    null,
    };
  }

  async calificar(
    clienteId: string,
    empresaId: string,
    ticketId: string,
    calificacion: number,
    comentario?: string,
  ): Promise<void> {
    if (calificacion < 1 || calificacion > 5) {
      throw new BadRequestException('La calificación debe estar entre 1 y 5.');
    }

    // Solo tickets cerrados/resueltos y solo los propios. Calificar uno en curso
    // presiona al técnico por un trabajo que todavía no terminó.
    const resultado = await this.dataSource.query(
      `UPDATE tickets
          SET calificacion_cliente = $1,
              comentario_cliente   = $2
        WHERE id = $3 AND cliente_id = $4 AND empresa_id = $5
          AND deleted_at IS NULL
          AND estado IN ('resuelto', 'cerrado')`,
      [calificacion, comentario?.trim() ?? null, ticketId, clienteId, empresaId],
    );

    const afectadas = Array.isArray(resultado) ? resultado[1] : 0;
    if (!afectadas) {
      throw new NotFoundException('No encontramos ese ticket o todavía no está cerrado.');
    }
  }
}
