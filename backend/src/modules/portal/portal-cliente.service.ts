import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

// Perfil del abonado y sus servicios. Todo lo que sale de aquí está acotado al
// `clienteId` del token: el portal nunca recibe un identificador de cliente por
// parámetro, porque sería un IDOR sobre todo el parque.

export interface PortalServicio {
  contratoId:      string;
  numeroContrato:  string;
  estado:          string;
  tipoServicio:    string | null;
  tipoPago:        string | null;
  direccion:       string | null;
  planNombre:      string;
  planDescripcion: string | null;
  velocidadBajada: number;
  velocidadSubida: number;
  // Velocidad mínima comprometida. Es lo que el abonado puede exigir; la contratada es
  // el máximo alcanzable.
  velocidadGarantizada: number | null;
  // TV incluida y en cuántos equipos a la vez. `sesiones_iptv` es el límite real del
  // panel: decirlo evita el reclamo de "lo puse en el cuarto y se cayó el del salón".
  incluyeTv:       boolean;
  dispositivosTv:  number | null;
  // Solo si el plan tiene tope de datos; la mayoría no lo tiene.
  limiteDatosGb:   number | null;
  accionAlLimite:  string | null;
  // Lo que paga ESTE contrato, con su descuento aplicado — no el precio de lista.
  precioMensual:   number;
  diaFacturacion:  number | null;
  fechaUltimoPago: string | null;
  fechaCorte:      string | null;
  enProrroga:      boolean;
  prorrogaHasta:   string | null;
  deudaTotal:      number;
  mesesDeuda:      number;
  // Un contrato sin ONU no puede ofrecer WiFi ni dispositivos conectados.
  tieneOnu:        boolean;
}

export interface PortalPerfil {
  clienteId:      string;
  nombreCompleto: string;
  tipoDocumento:  string;
  numeroDocumento: string;
  telefono:       string | null;
  servicios:      PortalServicio[];
}

interface FilaServicio {
  contrato_id: string; numero_contrato: string; estado: string;
  tipo_servicio: string | null; tipo_pago: string | null;
  direccion_instalacion: string | null;
  plan_nombre: string; plan_descripcion: string | null;
  velocidad_bajada: number; velocidad_subida: number;
  velocidad_garantizada: number | null;
  cuenta_iptv: boolean; sesiones_iptv: number | null;
  tiene_limite_datos: boolean; limite_datos_gb: number | null; accion_al_limite: string | null;
  precio_final: string | null; precio_mensual: string;
  dia_facturacion: number | null; fecha_ultimo_pago: string | null;
  dias_prorroga: number | null; en_prorroga: boolean; prorroga_hasta: string | null;
  deuda_total: string; meses_deuda: number; onu_id: string | null;
}

@Injectable()
export class PortalClienteService {
  private readonly logger = new Logger(PortalClienteService.name);

  constructor(private readonly dataSource: DataSource) {}

  async perfil(clienteId: string, empresaId: string): Promise<PortalPerfil> {
    const [cliente] = await this.dataSource.query<
      Array<{
        id: string; nombres: string; apellido_paterno: string | null;
        apellido_materno: string | null; tipo_documento: string;
        numero_documento: string; whatsapp: string | null; telefono: string | null;
      }>
    >(
      `SELECT id, nombres, apellido_paterno, apellido_materno,
              tipo_documento, numero_documento, whatsapp, telefono
         FROM clientes
        WHERE id = $1 AND empresa_id = $2 AND deleted_at IS NULL`,
      [clienteId, empresaId],
    );

    if (!cliente) throw new NotFoundException('Cliente no encontrado');

    return {
      clienteId:       cliente.id,
      nombreCompleto:  [cliente.nombres, cliente.apellido_paterno, cliente.apellido_materno]
        .filter((p) => p && p.trim()).join(' ').trim(),
      tipoDocumento:   cliente.tipo_documento,
      numeroDocumento: cliente.numero_documento,
      // El WhatsApp es el canal real de contacto del ISP; el teléfono fijo es respaldo.
      telefono:        cliente.whatsapp ?? cliente.telefono ?? null,
      servicios:       await this.servicios(clienteId, empresaId),
    };
  }

  async servicios(clienteId: string, empresaId: string): Promise<PortalServicio[]> {
    // El nombre del plan se resuelve por el mismo join que usa el detalle de
    // facturación: si el perfil y la factura leyeran de fuentes distintas, podrían
    // mostrar planes distintos para el mismo mes.
    const filas = await this.dataSource.query<FilaServicio[]>(
      `SELECT c.id                     AS contrato_id,
              c.numero_contrato,
              c.estado::text           AS estado,
              c.tipo_servicio::text    AS tipo_servicio,
              c.tipo_pago::text        AS tipo_pago,
              c.direccion_instalacion,
              p.nombre                 AS plan_nombre,
              p.descripcion            AS plan_descripcion,
              p.velocidad_bajada,
              p.velocidad_subida,
              p.velocidad_garantizada,
              p.cuenta_iptv,
              p.sesiones_iptv,
              p.tiene_limite_datos,
              p.limite_datos_gb,
              p.accion_al_limite::text  AS accion_al_limite,
              c.precio_final,
              c.precio_mensual,
              c.dia_facturacion,
              c.fecha_ultimo_pago,
              c.dias_prorroga,
              c.en_prorroga,
              c.prorroga_hasta,
              c.deuda_total,
              c.meses_deuda,
              c.onu_id
         FROM contratos c
         JOIN planes   p ON p.id = c.plan_id
        WHERE c.cliente_id = $1
          AND c.empresa_id = $2
          AND c.deleted_at IS NULL
          AND c.estado <> 'baja_definitiva'
        ORDER BY c.created_at ASC`,
      [clienteId, empresaId],
    );

    return filas.map((f) => ({
      contratoId:      f.contrato_id,
      numeroContrato:  f.numero_contrato,
      estado:          f.estado,
      tipoServicio:    f.tipo_servicio,
      tipoPago:        f.tipo_pago,
      direccion:       f.direccion_instalacion,
      planNombre:      f.plan_nombre,
      planDescripcion: f.plan_descripcion,
      velocidadBajada: Number(f.velocidad_bajada),
      velocidadSubida: Number(f.velocidad_subida),
      // 0 en la BD significa "no comprometido", no "0 Mbps garantizados".
      velocidadGarantizada: f.velocidad_garantizada ? Number(f.velocidad_garantizada) : null,
      incluyeTv:       Boolean(f.cuenta_iptv),
      dispositivosTv:  f.cuenta_iptv ? (f.sesiones_iptv ?? 1) : null,
      // El tope solo se anuncia si el plan lo tiene activo: un `limite_datos_gb`
      // residual de una edición anterior no debe aparecer como restricción vigente.
      limiteDatosGb:   f.tiene_limite_datos ? f.limite_datos_gb : null,
      accionAlLimite:  f.tiene_limite_datos ? f.accion_al_limite : null,
      // precio_final es columna generada (precio con descuento). Si faltara, se cae a
      // precio_mensual del contrato — nunca al precio de lista del plan, que le
      // cobraría de más en pantalla a todo cliente con descuento.
      precioMensual:   Number(f.precio_final ?? f.precio_mensual),
      diaFacturacion:  f.dia_facturacion,
      fechaUltimoPago: f.fecha_ultimo_pago,
      fechaCorte:      this.calcularFechaCorte(f),
      enProrroga:      f.en_prorroga,
      prorrogaHasta:   f.prorroga_hasta,
      deudaTotal:      Number(f.deuda_total),
      mesesDeuda:      f.meses_deuda,
      tieneOnu:        Boolean(f.onu_id),
    }));
  }

  // Un contrato ajeno devuelve 404, no 403: confirmar que el recurso existe ya es
  // información que el abonado no debería poder sonsacar.
  async servicio(
    clienteId: string,
    empresaId: string,
    contratoId: string,
  ): Promise<PortalServicio> {
    const servicios = await this.servicios(clienteId, empresaId);
    const encontrado = servicios.find((s) => s.contratoId === contratoId);
    if (!encontrado) throw new NotFoundException('Servicio no encontrado');
    return encontrado;
  }

  // Fecha de corte visible para el abonado. Una prórroga vigente manda sobre el cálculo
  // ordinario: es justamente la fecha que le prometieron por teléfono.
  private calcularFechaCorte(f: FilaServicio): string | null {
    if (f.en_prorroga && f.prorroga_hasta) return f.prorroga_hasta;
    if (!f.dia_facturacion) return null;

    const hoy    = new Date();
    const gracia = f.dias_prorroga ?? 0;

    const corte = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1));
    // Día 31 en un mes de 30 cae al 1 del siguiente: se ancla al último día del mes
    // para no anunciar una fecha que no existe en el calendario.
    const ultimoDiaMes = new Date(
      Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() + 1, 0),
    ).getUTCDate();
    corte.setUTCDate(Math.min(f.dia_facturacion, ultimoDiaMes));
    corte.setUTCDate(corte.getUTCDate() + gracia);

    // Si la fecha de este mes ya pasó, la próxima que le interesa es la del mes que viene.
    if (corte < hoy) corte.setUTCMonth(corte.getUTCMonth() + 1);

    return corte.toISOString().slice(0, 10);
  }
}
