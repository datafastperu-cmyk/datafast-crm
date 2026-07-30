import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';

// Facturación tal como la ve el abonado: solo lectura y solo lo suyo.
//
// Sin descargas: el portal no expone comprobantes en PDF ni ningún otro archivo
// (decisión de negocio). Todo lo que necesita saber de una factura se muestra en
// pantalla, y esa es también la superficie de ataque más barata de no tener.

export type EstadoVisible = 'pagada' | 'pendiente' | 'vencida';

export interface PortalDetalleFactura {
  descripcion: string;
  importe:     number;
}

export interface PortalFactura {
  id:               string;
  numero:           string;
  concepto:         string;
  // Desglose por servicio. El comprobante es CONSOLIDADO por cliente: con dos servicios,
  // el importe total no le dice al abonado cuánto corresponde a cada uno. Sin esto, la
  // pregunta "¿por qué pago esto?" acaba en soporte.
  detalle:          PortalDetalleFactura[];
  periodoInicio:    string;
  periodoFin:       string;
  fechaEmision:     string;
  fechaVencimiento: string;
  fechaPago:        string | null;
  total:            number;
  montoPagado:      number;
  saldo:            number;
  estado:           EstadoVisible;
}

export interface PortalEstadoCuenta {
  totalPendiente:   number;
  cantidadPendiente: number;
  cantidadVencida:  number;
  facturaMasAntigua: string | null;
  facturas:         PortalFactura[];
}

interface FilaFactura {
  id: string; numero_completo: string | null; serie: string; correlativo: number;
  descripcion: string; periodo_inicio: string; periodo_fin: string;
  fecha_emision: string; fecha_vencimiento: string; fecha_pago: string | null;
  total: string; monto_pagado: string; saldo: string | null; estado: string;
  items: Array<{ descripcion?: string; subtotal?: number; total?: number }> | null;
}

@Injectable()
export class PortalFacturacionService {
  constructor(private readonly dataSource: DataSource) {}

  async estadoCuenta(
    clienteId: string,
    empresaId: string,
    contratoId: string,
  ): Promise<PortalEstadoCuenta> {
    // El contrato se valida contra el cliente del token EN LA MISMA consulta. Filtrar
    // solo por contrato_id convertiría el endpoint en un IDOR sobre todo el parque.
    const [contrato] = await this.dataSource.query<Array<{ id: string }>>(
      `SELECT id FROM contratos
        WHERE id = $1 AND cliente_id = $2 AND empresa_id = $3 AND deleted_at IS NULL`,
      [contratoId, clienteId, empresaId],
    );
    if (!contrato) throw new NotFoundException('Servicio no encontrado');

    // Los nombres son los de la TABLA, no los de la entidad: el correlativo se llama
    // `correlativo` (no `numero`) y `facturas` NO tiene `deleted_at` — filtrar por él
    // hacía fallar la consulta entera con SCHEMA_ERROR y la sección no cargaba nunca.
    // `saldo` ya lo calcula la base de datos: se usa el suyo para que el portal y el ERP
    // no puedan mostrar cifras distintas de la misma factura.
    const filas = await this.dataSource.query<FilaFactura[]>(
      `SELECT id, numero_completo, serie, correlativo, descripcion,
              periodo_inicio, periodo_fin, fecha_emision, fecha_vencimiento, fecha_pago,
              total, monto_pagado, saldo, items, estado::text AS estado
         FROM facturas
        WHERE cliente_id  = $2
          AND empresa_id  = $3
          -- contrato_id es NULLABLE y en la práctica muchas facturas se emiten sin él
          -- (la facturación las ata al CLIENTE). Filtrar solo por contrato dejaba la
          -- sección vacía aunque el abonado tuviera recibos pendientes: veía "no tienes
          -- deudas" debiendo dinero, que es la peor forma de fallar de esta pantalla.
          -- Una factura sin contrato es del abonado y se le muestra siempre; con varios
          -- servicios aparecerá en todos, que es preferible a esconderle una deuda.
          AND (contrato_id = $1 OR contrato_id IS NULL)
          -- Un borrador todavía no es un compromiso de pago y una anulada dejó de
          -- serlo: mostrar cualquiera de las dos genera un reclamo, no información.
          AND estado NOT IN ('borrador', 'anulada')
        ORDER BY fecha_emision DESC, correlativo DESC
        LIMIT 60`,
      [contratoId, clienteId, empresaId],
    );

    const hoy = new Date().toISOString().slice(0, 10);
    const facturas = filas.map((f) => this.mapear(f, hoy));

    const pendientes = facturas.filter((f) => f.estado !== 'pagada');

    return {
      totalPendiente:    Number(pendientes.reduce((s, f) => s + f.saldo, 0).toFixed(2)),
      cantidadPendiente: pendientes.length,
      cantidadVencida:   facturas.filter((f) => f.estado === 'vencida').length,
      facturaMasAntigua: pendientes.length
        ? pendientes[pendientes.length - 1].fechaVencimiento
        : null,
      facturas,
    };
  }

  private mapear(f: FilaFactura, hoy: string): PortalFactura {
    const total       = Number(f.total);
    const montoPagado = Number(f.monto_pagado);
    // El saldo de la BD manda; el cálculo solo cubre el caso de que venga nulo.
    const saldo = f.saldo != null
      ? Number(f.saldo)
      : Number((total - montoPagado).toFixed(2));

    return {
      id:               f.id,
      numero:           f.numero_completo ?? `${f.serie}-${f.correlativo}`,
      concepto:         f.descripcion,
      // Cada línea ya trae plan, contrato y dirección; aquí solo se proyecta lo que el
      // abonado necesita ver. `items` es jsonb: puede venir nulo en facturas antiguas.
      detalle: (f.items ?? [])
        .filter((i) => i?.descripcion)
        .map((i) => ({
          descripcion: String(i.descripcion),
          importe:     Number(i.total ?? i.subtotal ?? 0),
        })),
      periodoInicio:    f.periodo_inicio,
      periodoFin:       f.periodo_fin,
      fechaEmision:     f.fecha_emision,
      fechaVencimiento: f.fecha_vencimiento,
      fechaPago:        f.fecha_pago,
      total,
      montoPagado,
      saldo,
      estado:           this.estadoVisible(f, saldo, hoy),
    };
  }

  // El abonado no distingue entre 'emitida', 'en_cobranza' y 'pagada_parcial': lo que
  // necesita saber es si la debe, si ya venció y si está saldada. El vencimiento se
  // recalcula por fecha en lugar de confiar solo en el enum, porque el estado 'vencida'
  // lo escribe un proceso que puede no haber corrido todavía hoy.
  private estadoVisible(f: FilaFactura, saldo: number, hoy: string): EstadoVisible {
    if (f.estado === 'pagada' || saldo <= 0) return 'pagada';
    return f.fecha_vencimiento < hoy ? 'vencida' : 'pendiente';
  }
}
