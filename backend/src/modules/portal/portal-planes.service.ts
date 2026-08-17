import {
  Injectable, BadRequestException, NotFoundException, ConflictException, Logger,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

// Catálogo de planes y solicitudes de cambio.
//
// El abonado SOLICITA; nunca cambia nada por sí mismo. La aplicación real del cambio la
// hace el operador por el flujo de negocio existente (queue del MikroTik, precio del
// contrato, prorrateo de la factura en curso). Aquí solo se registra la intención.

export interface PortalPlan {
  id:              string;
  nombre:          string;
  descripcion:     string | null;
  velocidadBajada: number;
  velocidadSubida: number;
  precio:          number;
  esActual:        boolean;
  // Por qué NO se puede solicitar este plan, en lenguaje del abonado. `null` = se puede.
  bloqueo:         string | null;
}

export interface PortalSolicitudPlan {
  id:              string;
  estado:          string;
  planOrigen:      string;
  planDestino:     string;
  precioOrigen:    number;
  precioDestino:   number;
  notaCliente:     string | null;
  motivoResolucion: string | null;
  creadaEn:        string;
  resueltaEn:      string | null;
}

interface FilaContrato {
  id: string;
  plan_id: string;
  plan_nombre: string;
  precio_final: string | null;
  precio_mensual: string;
  tipo_pago: string | null;
  deuda_total: string;
  estado: string;
}

@Injectable()
export class PortalPlanesService {
  private readonly logger = new Logger(PortalPlanesService.name);

  constructor(private readonly dataSource: DataSource) {}

  async catalogo(
    clienteId: string,
    empresaId: string,
    contratoId: string,
  ): Promise<{ planes: PortalPlan[]; solicitudPendiente: PortalSolicitudPlan | null }> {
    const contrato = await this.contrato(clienteId, empresaId, contratoId);

    // Solo los planes que el operador marcó visibles en el portal (`visible_en_portal`,
    // que ya existía en el esquema). El catálogo se administra desde la UI interna de
    // Planes: el portal no tiene su propia lista que pueda quedar desincronizada.
    const filas = await this.dataSource.query<
      Array<{
        id: string; nombre: string; descripcion: string | null;
        velocidad_bajada: number; velocidad_subida: number; precio: string;
      }>
    >(
      `SELECT id, nombre, descripcion, velocidad_bajada, velocidad_subida, precio
         FROM planes
        WHERE empresa_id = $1 AND visible_en_portal = true AND activo = true
          AND deleted_at IS NULL
        ORDER BY precio ASC`,
      [empresaId],
    );

    const pendiente = await this.solicitudPendiente(empresaId, contratoId);
    const precioActual = Number(contrato.precio_final ?? contrato.precio_mensual);

    return {
      planes: filas.map((p) => ({
        id:              p.id,
        nombre:          p.nombre,
        descripcion:     p.descripcion,
        velocidadBajada: Number(p.velocidad_bajada),
        velocidadSubida: Number(p.velocidad_subida),
        precio:          Number(p.precio),
        esActual:        p.id === contrato.plan_id,
        bloqueo:         p.id === contrato.plan_id
          ? null
          : this.motivoBloqueo(contrato, Number(p.precio), precioActual, Boolean(pendiente)),
      })),
      solicitudPendiente: pendiente,
    };
  }

  async solicitar(
    clienteId: string,
    empresaId: string,
    contratoId: string,
    planDestinoId: string,
    nota?: string,
  ): Promise<PortalSolicitudPlan> {
    const contrato = await this.contrato(clienteId, empresaId, contratoId);

    if (planDestinoId === contrato.plan_id) {
      throw new BadRequestException('Ese ya es tu plan actual.');
    }

    const [destino] = await this.dataSource.query<
      Array<{ id: string; nombre: string; precio: string }>
    >(
      `SELECT id, nombre, precio FROM planes
        WHERE id = $1 AND empresa_id = $2 AND visible_en_portal = true
          AND activo = true AND deleted_at IS NULL`,
      [planDestinoId, empresaId],
    );
    if (!destino) throw new NotFoundException('Ese plan no está disponible.');

    const precioActual = Number(contrato.precio_final ?? contrato.precio_mensual);
    const pendiente = await this.solicitudPendiente(empresaId, contratoId);

    // El guard vive AQUÍ, no solo en la UI. El portal deshabilita el botón y explica el
    // motivo, pero un cliente que llame la API directamente recibe el mismo rechazo: un
    // botón deshabilitado no es un control de acceso.
    const bloqueo = this.motivoBloqueo(
      contrato, Number(destino.precio), precioActual, Boolean(pendiente),
    );
    if (bloqueo) throw new ConflictException(bloqueo);

    const [creada] = await this.dataSource.query<
      Array<{ id: string; created_at: string }>
    >(
      `INSERT INTO portal_solicitud_plan
         (empresa_id, cliente_id, servicio_id, plan_origen_id, plan_destino_id,
          precio_origen, precio_destino, nota_cliente)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, created_at`,
      [
        empresaId, clienteId, contratoId, contrato.plan_id, destino.id,
        precioActual, Number(destino.precio), nota?.trim() ?? null,
      ],
    );

    this.logger.log(
      `Portal: abonado ${clienteId} solicitó cambio de plan en ${contratoId} ` +
        `(${contrato.plan_nombre} → ${destino.nombre})`,
    );

    return {
      id:               creada.id,
      estado:           'pendiente',
      planOrigen:       contrato.plan_nombre,
      planDestino:      destino.nombre,
      precioOrigen:     precioActual,
      precioDestino:    Number(destino.precio),
      notaCliente:      nota?.trim() ?? null,
      motivoResolucion: null,
      creadaEn:         new Date(creada.created_at).toISOString(),
      resueltaEn:       null,
    };
  }

  // ── Bandeja del operador (lado ERP) ─────────────────────────
  async bandeja(empresaId: string, estado?: string): Promise<Array<Record<string, unknown>>> {
    const params: unknown[] = [empresaId];
    let filtro = '';
    if (estado) {
      params.push(estado);
      filtro = `AND s.estado = $${params.length}`;
    }

    return this.dataSource.query(
      `SELECT s.id, s.estado, s.precio_origen, s.precio_destino,
              s.nota_cliente, s.motivo_resolucion, s.created_at, s.resuelta_en,
              c.numero_contrato        AS "numeroContrato",
              cl.nombre_completo       AS "clienteNombre",
              cl.whatsapp              AS "clienteWhatsapp",
              po.nombre                AS "planOrigen",
              pd.nombre                AS "planDestino",
              c.deuda_total            AS "deudaTotal",
              c.tipo_pago::text        AS "tipoPago"
         FROM portal_solicitud_plan s
         JOIN servicios c  ON c.id  = s.servicio_id
         JOIN clientes  cl ON cl.id = s.cliente_id
         JOIN planes    po ON po.id = s.plan_origen_id
         JOIN planes    pd ON pd.id = s.plan_destino_id
        WHERE s.empresa_id = $1 ${filtro}
        ORDER BY CASE WHEN s.estado = 'pendiente' THEN 0 ELSE 1 END, s.created_at DESC
        LIMIT 200`,
      params,
    );
  }

  // Resolver NO aplica el cambio: registra el veredicto. El cambio de plan se ejecuta por
  // el flujo de negocio existente (un UPDATE directo se saltaría las cascadas: queue del
  // MikroTik, precio del contrato, prorrateo de la factura en curso).
  async resolver(
    empresaId: string,
    solicitudId: string,
    usuarioId: string,
    decision: 'aprobada' | 'rechazada' | 'aplicada',
    motivo?: string,
  ): Promise<void> {
    const [solicitud] = await this.dataSource.query<Array<{ estado: string }>>(
      `SELECT estado FROM portal_solicitud_plan WHERE id = $1 AND empresa_id = $2`,
      [solicitudId, empresaId],
    );
    if (!solicitud) throw new NotFoundException('Solicitud no encontrada');

    const legales: Record<string, string[]> = {
      aprobada:  ['pendiente'],
      rechazada: ['pendiente'],
      // "Aplicada" se marca DESPUÉS de ejecutar el cambio por el flujo normal: es el
      // acuse de que el trabajo se hizo, no el disparador.
      aplicada:  ['aprobada'],
    };
    if (!legales[decision].includes(solicitud.estado)) {
      throw new ConflictException(
        `Una solicitud "${solicitud.estado}" no puede pasar a "${decision}".`,
      );
    }

    await this.dataSource.query(
      `UPDATE portal_solicitud_plan
          SET estado = $1, motivo_resolucion = $2, resuelta_por = $3,
              resuelta_en = now(), updated_at = now()
        WHERE id = $4 AND empresa_id = $5`,
      [decision, motivo?.trim() ?? null, usuarioId, solicitudId, empresaId],
    );
  }

  // ── Internos ────────────────────────────────────────────────
  private async contrato(
    clienteId: string,
    empresaId: string,
    contratoId: string,
  ): Promise<FilaContrato> {
    const [fila] = await this.dataSource.query<FilaContrato[]>(
      `SELECT c.id, c.plan_id, p.nombre AS plan_nombre,
              c.precio_final, c.precio_mensual, c.tipo_pago::text AS tipo_pago,
              c.deuda_total, c.estado::text AS estado
         FROM servicios c
         JOIN planes p ON p.id = c.plan_id
        WHERE c.id = $1 AND c.cliente_id = $2 AND c.empresa_id = $3
          AND c.deleted_at IS NULL`,
      [contratoId, clienteId, empresaId],
    );
    if (!fila) throw new NotFoundException('Servicio no encontrado');
    return fila;
  }

  private async solicitudPendiente(
    empresaId: string,
    contratoId: string,
  ): Promise<PortalSolicitudPlan | null> {
    const [fila] = await this.dataSource.query<Array<Record<string, unknown>>>(
      `SELECT s.id, s.estado, s.precio_origen, s.precio_destino, s.nota_cliente,
              s.motivo_resolucion, s.created_at, s.resuelta_en,
              po.nombre AS plan_origen, pd.nombre AS plan_destino
         FROM portal_solicitud_plan s
         JOIN planes po ON po.id = s.plan_origen_id
         JOIN planes pd ON pd.id = s.plan_destino_id
        WHERE s.servicio_id = $1 AND s.empresa_id = $2
          AND s.estado IN ('pendiente', 'aprobada')
        ORDER BY s.created_at DESC
        LIMIT 1`,
      [contratoId, empresaId],
    );
    if (!fila) return null;

    return {
      id:               String(fila.id),
      estado:           String(fila.estado),
      planOrigen:       String(fila.plan_origen),
      planDestino:      String(fila.plan_destino),
      precioOrigen:     Number(fila.precio_origen),
      precioDestino:    Number(fila.precio_destino),
      notaCliente:      (fila.nota_cliente as string) ?? null,
      motivoResolucion: (fila.motivo_resolucion as string) ?? null,
      creadaEn:         new Date(fila.created_at as string).toISOString(),
      resueltaEn:       fila.resuelta_en ? new Date(fila.resuelta_en as string).toISOString() : null,
    };
  }

  // Regla de negocio decidida con el operador:
  //
  // La BAJADA de plan con deuda pendiente se permite SOLO en prepago. En prepago el
  // abonado ya pagó el período en curso, así que bajar no deja saldo impago detrás: la
  // deuda visible corresponde al período siguiente, que todavía no compró. En postpago la
  // deuda es servicio YA CONSUMIDO al precio del plan actual; permitir bajar antes de
  // pagarla convertiría el portal en un mecanismo de descuento retroactivo unilateral.
  //
  // La comparación se hace por PRECIO y no por velocidad: es el precio lo que determina el
  // impacto económico de la operación.
  private motivoBloqueo(
    contrato: FilaContrato,
    precioDestino: number,
    precioActual: number,
    hayPendiente: boolean,
  ): string | null {
    if (hayPendiente) {
      return 'Ya tienes una solicitud de cambio de plan en curso.';
    }
    if (contrato.estado === 'baja_definitiva') {
      return 'Este servicio ya no está activo.';
    }

    const deuda = Number(contrato.deuda_total);
    if (deuda <= 0) return null;

    // `tipo_pago` es nullable: sin valor se trata como postpago. Criterio conservador —
    // ante la duda, el camino que no regala servicio.
    const esPrepago = contrato.tipo_pago === 'prepago';
    if (esPrepago) return null;

    const soles = `S/ ${deuda.toFixed(2)}`;
    return precioDestino < precioActual
      ? `Para cambiar a un plan de menor precio primero debes regularizar tu deuda de ${soles}.`
      : `Para cambiar de plan primero debes regularizar tu deuda de ${soles}.`;
  }
}
