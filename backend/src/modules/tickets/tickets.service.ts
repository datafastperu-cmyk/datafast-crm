import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { TicketRepository } from './repositories/ticket.repository';
import {
  CreateTicketDto, UpdateTicketDto, CerrarTicketDto,
  CalificarTicketDto, CreateComentarioDto, FilterTicketDto,
} from './dto/ticket.dto';
import { EstadoTicket } from './entities/ticket.entity';
import { JwtPayload } from '../../common/decorators/current-user.decorator';
import { formatPaginatedResponse } from '../../common/utils/pagination.util';

@Injectable()
export class TicketsService {
  constructor(private readonly repo: TicketRepository) {}

  async findAll(empresaId: string, filters: FilterTicketDto) {
    const result = await this.repo.findAllPaginated(empresaId, filters);
    return formatPaginatedResponse(result);
  }

  async findOne(id: string, empresaId: string) {
    const t = await this.repo.findById(id, empresaId);
    if (!t) throw new NotFoundException('Ticket no encontrado');
    return t;
  }

  async getStats(empresaId: string) {
    return this.repo.getStats(empresaId);
  }

  async create(dto: CreateTicketDto, user: JwtPayload) {
    const { empresaId, sub: userId } = user;
    const numeroTicket = await this.repo.generarNumero(empresaId);

    const slaHoras = dto.slaHoras ?? 24;
    const fechaLimiteSla = new Date();
    fechaLimiteSla.setHours(fechaLimiteSla.getHours() + slaHoras);

    const ticket = this.repo.create({
      empresaId,
      clienteId:     dto.clienteId,
      contratoId:    dto.contratoId,
      tecnicoId:     dto.tecnicoId,
      creadoPor:     userId,
      numeroTicket,
      titulo:        dto.titulo,
      descripcion:   dto.descripcion,
      categoria:     dto.categoria,
      prioridad:     dto.prioridad,
      slaHoras,
      fechaLimiteSla,
    });

    return this.repo.save(ticket);
  }

  async update(id: string, dto: UpdateTicketDto, user: JwtPayload) {
    const ticket = await this.repo.findById(id, user.empresaId);
    if (!ticket) throw new NotFoundException('Ticket no encontrado');

    const patch: Record<string, any> = {};
    if (dto.titulo      !== undefined) patch.titulo      = dto.titulo;
    if (dto.descripcion !== undefined) patch.descripcion = dto.descripcion;
    if (dto.categoria   !== undefined) patch.categoria   = dto.categoria;
    if (dto.prioridad   !== undefined) patch.prioridad   = dto.prioridad;
    if (dto.tecnicoId   !== undefined) patch.tecnicoId   = dto.tecnicoId;
    if (dto.supervisorId !== undefined) patch.supervisorId = dto.supervisorId;
    if (dto.solucion    !== undefined) patch.solucion    = dto.solucion;
    if (dto.causaRaiz   !== undefined) patch.causaRaiz   = dto.causaRaiz;
    if (dto.slaHoras    !== undefined) {
      patch.slaHoras = dto.slaHoras;
      const lim = new Date(ticket.createdAt);
      lim.setHours(lim.getHours() + dto.slaHoras);
      patch.fechaLimiteSla = lim;
    }

    if (dto.estado !== undefined && dto.estado !== ticket.estado) {
      patch.estado     = dto.estado;
      patch.fechaEstado = new Date();
      if ([EstadoTicket.CERRADO, EstadoTicket.RESUELTO].includes(dto.estado)) {
        patch.closedAt  = new Date();
        patch.slaCumplido = ticket.fechaLimiteSla
          ? new Date() <= new Date(ticket.fechaLimiteSla)
          : true;
      }
    }

    await this.repo.update(id, patch);
    return this.repo.findById(id, user.empresaId);
  }

  async cerrar(id: string, dto: CerrarTicketDto, user: JwtPayload) {
    const ticket = await this.repo.findById(id, user.empresaId);
    if (!ticket) throw new NotFoundException('Ticket no encontrado');
    if ([EstadoTicket.CERRADO, EstadoTicket.CANCELADO].includes(ticket.estado))
      throw new BadRequestException('El ticket ya está cerrado o cancelado');

    const now = new Date();
    await this.repo.update(id, {
      estado:      EstadoTicket.RESUELTO,
      fechaEstado: now,
      closedAt:    now,
      solucion:    dto.solucion,
      causaRaiz:   dto.causaRaiz,
      slaCumplido: ticket.fechaLimiteSla ? now <= new Date(ticket.fechaLimiteSla) : true,
    });

    return this.repo.findById(id, user.empresaId);
  }

  async asignarTecnico(id: string, tecnicoId: string, user: JwtPayload) {
    const ticket = await this.repo.findById(id, user.empresaId);
    if (!ticket) throw new NotFoundException('Ticket no encontrado');

    const patch: Record<string, any> = { tecnicoId };
    if (ticket.estado === EstadoTicket.ABIERTO) {
      patch.estado     = EstadoTicket.EN_PROGRESO;
      patch.fechaEstado = new Date();
    }
    await this.repo.update(id, patch);
    return this.repo.findById(id, user.empresaId);
  }

  async calificar(id: string, dto: CalificarTicketDto, user: JwtPayload) {
    const ticket = await this.repo.findById(id, user.empresaId);
    if (!ticket) throw new NotFoundException('Ticket no encontrado');
    if (ticket.calificacionCliente)
      throw new BadRequestException('El ticket ya fue calificado');

    await this.repo.update(id, {
      calificacionCliente: dto.calificacion,
      comentarioCliente:   dto.comentario,
      estado:              EstadoTicket.CERRADO,
      fechaEstado:         new Date(),
    });
    return this.repo.findById(id, user.empresaId);
  }

  async softDelete(id: string, user: JwtPayload) {
    const t = await this.repo.findById(id, user.empresaId);
    if (!t) throw new NotFoundException('Ticket no encontrado');
    await this.repo.softDelete(id, user.empresaId);
  }

  // ── Comentarios ────────────────────────────────────────────
  async getComentarios(id: string, empresaId: string) {
    const t = await this.repo.findById(id, empresaId);
    if (!t) throw new NotFoundException('Ticket no encontrado');
    return this.repo.getComentarios(id, empresaId);
  }

  async addComentario(id: string, dto: CreateComentarioDto, user: JwtPayload) {
    const t = await this.repo.findById(id, user.empresaId);
    if (!t) throw new NotFoundException('Ticket no encontrado');
    return this.repo.addComentario({
      ticketId:       id,
      empresaId:      user.empresaId,
      usuarioId:      user.sub,
      contenido:      dto.contenido,
      esPrivado:      dto.esPrivado ?? false,
      esNotaInterna:  dto.esNotaInterna ?? false,
    });
  }
}
