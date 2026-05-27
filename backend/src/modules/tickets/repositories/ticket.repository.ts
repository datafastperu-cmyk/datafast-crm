import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { Ticket, TicketComentario, EstadoTicket } from '../entities/ticket.entity';
import { FilterTicketDto } from '../dto/ticket.dto';
import { PaginatedResult } from '../../../common/utils/pagination.util';

@Injectable()
export class TicketRepository {
  private readonly repo: Repository<Ticket>;
  private readonly comentarioRepo: Repository<TicketComentario>;

  constructor(@InjectDataSource() private readonly ds: DataSource) {
    this.repo          = ds.getRepository(Ticket);
    this.comentarioRepo = ds.getRepository(TicketComentario);
  }

  create(d: Partial<Ticket>): Ticket { return this.repo.create(d); }
  async save(t: Ticket): Promise<Ticket> { return this.repo.save(t); }
  async update(id: string, d: Partial<Ticket>): Promise<void> { await this.repo.update({ id }, d); }

  async findById(id: string, empresaId: string): Promise<any | null> {
    const rows = await this.ds.query(`
      SELECT
        t.*,
        cl.nombre_completo   AS "clienteNombre",
        cl.telefono          AS "clienteTelefono",
        cl.email             AS "clienteEmail",
        CONCAT(u.nombres, ' ', u.apellidos) AS "tecnicoNombre",
        co.numero_contrato   AS "contratoNumero"
      FROM tickets t
      LEFT JOIN clientes  cl ON cl.id = t.cliente_id
      LEFT JOIN usuarios  u  ON u.id  = t.tecnico_id
      LEFT JOIN contratos co ON co.id = t.contrato_id
      WHERE t.id = $1 AND t.empresa_id = $2 AND t.deleted_at IS NULL
    `, [id, empresaId]);
    return rows[0] || null;
  }

  async findAllPaginated(empresaId: string, filters: FilterTicketDto): Promise<PaginatedResult<any>> {
    const page   = filters.page  ?? 1;
    const limit  = filters.limit ?? 20;
    const offset = (page - 1) * limit;

    const allowedSort: Record<string, string> = {
      createdAt:       't.created_at',
      fechaEstado:     't.fecha_estado',
      prioridad:       't.prioridad',
      estado:          't.estado',
      fechaLimiteSla:  't.fecha_limite_sla',
      numeroTicket:    't.numero_ticket',
    };
    const sortCol = allowedSort[filters.sortBy ?? ''] ?? 't.created_at';
    const sortDir = filters.sortOrder === 'ASC' ? 'ASC' : 'DESC';

    const conds: string[] = ['t.empresa_id = $1', 't.deleted_at IS NULL'];
    const params: any[]   = [empresaId];

    if (filters.search) {
      params.push(`%${filters.search}%`);
      conds.push(`(t.numero_ticket ILIKE $${params.length} OR t.titulo ILIKE $${params.length} OR t.descripcion ILIKE $${params.length})`);
    }
    if (filters.estado) {
      params.push(filters.estado);
      conds.push(`t.estado = $${params.length}`);
    }
    if (filters.estados?.length) {
      params.push(filters.estados);
      conds.push(`t.estado = ANY($${params.length})`);
    }
    if (filters.categoria) {
      params.push(filters.categoria);
      conds.push(`t.categoria = $${params.length}`);
    }
    if (filters.prioridad) {
      params.push(filters.prioridad);
      conds.push(`t.prioridad = $${params.length}`);
    }
    if (filters.clienteId) {
      params.push(filters.clienteId);
      conds.push(`t.cliente_id = $${params.length}`);
    }
    if (filters.tecnicoId) {
      params.push(filters.tecnicoId);
      conds.push(`t.tecnico_id = $${params.length}`);
    }
    if (filters.slaPendiente) {
      conds.push(`t.fecha_limite_sla < NOW() AND t.estado NOT IN ('resuelto','cerrado','cancelado')`);
    }
    if (filters.fechaDesde) {
      params.push(filters.fechaDesde);
      conds.push(`t.created_at >= $${params.length}`);
    }
    if (filters.fechaHasta) {
      params.push(filters.fechaHasta);
      conds.push(`t.created_at <= $${params.length}`);
    }

    const where = conds.join(' AND ');

    const [{ total }] = await this.ds.query(
      `SELECT COUNT(*) AS total FROM tickets t WHERE ${where}`,
      params,
    );

    const data = await this.ds.query(`
      SELECT
        t.id,
        t.numero_ticket         AS "numeroTicket",
        t.titulo,
        t.descripcion,
        t.categoria,
        t.prioridad,
        t.estado,
        t.empresa_id            AS "empresaId",
        t.cliente_id            AS "clienteId",
        t.contrato_id           AS "contratoId",
        t.tecnico_id            AS "tecnicoId",
        t.sla_horas             AS "slaHoras",
        t.fecha_limite_sla      AS "fechaLimiteSla",
        t.sla_cumplido          AS "slaCumplido",
        t.abierto_por_portal    AS "abiertoPorPortal",
        t.calificacion_cliente  AS "calificacionCliente",
        t.created_at            AS "createdAt",
        t.updated_at            AS "updatedAt",
        t.closed_at             AS "closedAt",
        cl.nombre_completo      AS "clienteNombre",
        cl.telefono             AS "clienteTelefono",
        CONCAT(u.nombres, ' ', u.apellidos) AS "tecnicoNombre"
      FROM tickets t
      LEFT JOIN clientes cl ON cl.id = t.cliente_id AND cl.deleted_at IS NULL
      LEFT JOIN usuarios u  ON u.id  = t.tecnico_id
      WHERE ${where}
      ORDER BY ${sortCol} ${sortDir}
      LIMIT ${limit} OFFSET ${offset}
    `, params);

    return { data, total: parseInt(total, 10), page, limit };
  }

  async getStats(empresaId: string): Promise<Record<string, any>> {
    const [stats] = await this.ds.query(`
      SELECT
        COUNT(*) FILTER (WHERE estado NOT IN ('cerrado','cancelado')) AS abiertos,
        COUNT(*) FILTER (WHERE estado = 'abierto')                    AS nuevos,
        COUNT(*) FILTER (WHERE estado = 'en_progreso')                AS en_progreso,
        COUNT(*) FILTER (WHERE estado = 'resuelto')                   AS resueltos,
        COUNT(*) FILTER (WHERE estado = 'cerrado')                    AS cerrados,
        COUNT(*) FILTER (WHERE prioridad = 'critica' AND estado NOT IN ('resuelto','cerrado','cancelado')) AS criticos,
        COUNT(*) FILTER (
          WHERE fecha_limite_sla < NOW()
            AND estado NOT IN ('resuelto','cerrado','cancelado')
        ) AS sla_vencidos,
        ROUND(AVG(
          EXTRACT(EPOCH FROM (COALESCE(closed_at, NOW()) - created_at)) / 3600
        )::numeric, 1) AS tiempo_resolucion_horas,
        COUNT(*) FILTER (
          WHERE DATE_TRUNC('month', created_at) = DATE_TRUNC('month', NOW())
        ) AS creados_este_mes
      FROM tickets
      WHERE empresa_id = $1 AND deleted_at IS NULL
    `, [empresaId]);
    return {
      abiertos:              Number(stats.abiertos)              || 0,
      nuevos:                Number(stats.nuevos)                || 0,
      enProgreso:            Number(stats.en_progreso)           || 0,
      resueltos:             Number(stats.resueltos)             || 0,
      cerrados:              Number(stats.cerrados)              || 0,
      criticos:              Number(stats.criticos)              || 0,
      slaVencidos:           Number(stats.sla_vencidos)          || 0,
      tiempoResolucionHoras: Number(stats.tiempo_resolucion_horas) || 0,
      creadosEsteMes:        Number(stats.creados_este_mes)      || 0,
    };
  }

  async generarNumero(empresaId: string): Promise<string> {
    const year   = new Date().getFullYear();
    const prefix = `TK-${year}-`;
    const pos    = prefix.length + 1;
    const rows = await this.ds.query<{ max_num: string }[]>(
      `SELECT COALESCE(MAX(CAST(SUBSTRING(numero_ticket, ${pos}) AS INTEGER)), 0) AS max_num
       FROM tickets WHERE empresa_id = $1 AND numero_ticket LIKE $2`,
      [empresaId, `${prefix}%`],
    );
    const next = (parseInt(rows[0]?.max_num ?? '0') || 0) + 1;
    return `${prefix}${String(next).padStart(5, '0')}`;
  }

  async softDelete(id: string, empresaId: string): Promise<void> {
    await this.repo.update({ id, empresaId }, { deletedAt: new Date() });
  }

  // ── Comentarios ────────────────────────────────────────────
  async getComentarios(ticketId: string, empresaId: string): Promise<any[]> {
    return this.ds.query(`
      SELECT
        c.id, c.contenido, c.es_privado AS "esPrivado",
        c.es_nota_interna AS "esNotaInterna", c.imagenes_url AS "imagenesUrl",
        c.created_at AS "createdAt",
        CONCAT(u.nombres, ' ', u.apellidos) AS "autorNombre",
        u.id AS "autorId"
      FROM tickets_comentarios c
      LEFT JOIN usuarios u ON u.id = c.usuario_id
      WHERE c.ticket_id = $1 AND c.empresa_id = $2
      ORDER BY c.created_at ASC
    `, [ticketId, empresaId]);
  }

  async addComentario(d: Partial<TicketComentario>): Promise<TicketComentario> {
    return this.comentarioRepo.save(this.comentarioRepo.create(d));
  }
}
