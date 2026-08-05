import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

import {
  PoliticaFacturacionService,
  PoliticaFacturacion,
} from '../facturacion/politica-facturacion.service';

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

// Estado del equipo del abonado, leído del último snapshot que el ERP tomó de la OLT.
// NO se consulta la OLT en cada carga del portal: 200 abonados abriendo el dashboard
// serían 200 sesiones SSH contra un MA5800 que admite muy pocas VTY concurrentes.
// El precio de esa decisión es que el dato puede estar viejo, y por eso `observadoEn`
// viaja siempre: presentar un snapshot de ayer como estado actual es exactamente la
// ilusión que VIO prohíbe.
// Los estados salen de `olt_onu_inventario.estado_operativo`, la MISMA columna que pinta
// /red/olt en el ERP. La clasificación la hace el colector Python (`_map_estado_operativo`)
// cruzando control-flag, run-state, causa de caída y dying-gasp; aquí solo se traduce al
// vocabulario del abonado. Leer `run_state` crudo —como se hacía— colapsaba "apagada",
// "desactivada" y "ruptura_fibra" en un único "offline": el operador veía un diagnóstico
// y el abonado otro distinto sobre el mismo equipo.
export type EstadoRouterOnu =
  | 'encendido'
  | 'apagado'
  | 'fibra_cortada'
  | 'sin_conexion'
  | 'suspendido'
  | 'sin_datos';

export interface PortalEstadoRouter {
  estado:       EstadoRouterOnu;
  // Texto ya resuelto para el abonado: la UI no debe inventar el matiz.
  detalle:      string;
  // Última vez que el ERP observó la ONU en la OLT. null = nunca se observó.
  observadoEn:  string | null;
  // Solo se envía si el equipo está conectado; un dBm de un equipo caído es basura.
  senalDbm:     number | null;
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

  constructor(
    private readonly dataSource: DataSource,
    private readonly politicaSvc: PoliticaFacturacionService,
  ) {}

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

    const politica = await this.politicaSvc.resolver(clienteId, empresaId);

    // El vencimiento GRABADO en la factura impaga más antigua: el mismo dato con el que el
    // cron decide el corte. Recalcularlo aquí sería volver a tener dos fuentes.
    const [impaga] = await this.dataSource.query<Array<{ fecha_vencimiento: string }>>(
      `SELECT MIN(fecha_vencimiento) AS fecha_vencimiento
         FROM facturas
        WHERE cliente_id = $1 AND empresa_id = $2
          AND deleted_at IS NULL
          AND estado IN ('emitida', 'pagada_parcial', 'vencida', 'en_cobranza')
          AND COALESCE(saldo, total - monto_pagado) > 0`,
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
      fechaCorte:      this.calcularFechaCorte(f, politica, impaga?.fecha_vencimiento ?? null),
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

  async estadoRouter(
    clienteId: string,
    empresaId: string,
    contratoId: string,
  ): Promise<PortalEstadoRouter> {
    // La pertenencia del contrato al abonado se valida en la MISMA consulta: separarlo
    // en dos pasos es como aparecen los IDOR.
    const [fila] = await this.dataSource.query<
      Array<{
        contrato_estado: string;
        estado_operativo: string | null;
        rx_power_dbm: number | null;
        observado_en: string | null;
      }>
    >(
      // LEFT JOIN: un contrato sin ONU observada debe responder "sin datos", no 404 —
      // el 404 lo reserva la ausencia del contrato, que sí es un intento de acceso ajeno.
      `SELECT c.estado::text AS contrato_estado,
              i.estado_operativo,
              i.rx_power_dbm,
              i.updated_at   AS observado_en
         FROM contratos c
         LEFT JOIN olt_onu_inventario i
                ON i.contrato_id = c.id AND i.empresa_id = c.empresa_id
        WHERE c.id = $1 AND c.cliente_id = $2 AND c.empresa_id = $3
          AND c.deleted_at IS NULL
        ORDER BY i.updated_at DESC NULLS LAST
        LIMIT 1`,
      [contratoId, clienteId, empresaId],
    );

    if (!fila) throw new NotFoundException('Servicio no encontrado');

    const observadoEn = fila.observado_en
      ? new Date(fila.observado_en).toISOString()
      : null;

    // El corte administrativo manda sobre la lectura del hardware: una ONU suspendida
    // puede seguir figurando `online` en la OLT, y decirle "encendido" a quien no tiene
    // servicio por falta de pago es la contradicción que genera la llamada a soporte.
    if (fila.contrato_estado === 'suspendido' || fila.contrato_estado === 'cortado') {
      return {
        estado:      'suspendido',
        detalle:     'Tu servicio está suspendido. Regulariza tu pago para reactivarlo.',
        observadoEn,
        senalDbm:    null,
      };
    }

    // Traducción 1 a 1 de lo que /red/olt muestra al operador. Si el ERP dice "ONU
    // Apagada", el abonado lee "Apagado" — nunca un diagnóstico distinto del mismo equipo.
    switch (fila.estado_operativo) {
      case 'online':
        return {
          estado:      'encendido',
          detalle:     'Tu equipo está encendido y conectado a nuestra red.',
          observadoEn,
          // El dBm solo tiene sentido con el enlace arriba; en un equipo caído es basura.
          senalDbm:    fila.rx_power_dbm != null ? Number(fila.rx_power_dbm) : null,
        };

      case 'apagada':
        // La OLT lo distingue por dying-gasp: la ONU avisó al perder la alimentación.
        return {
          estado:      'apagado',
          detalle:     'Tu equipo está apagado o sin corriente. Revisa que esté enchufado '
                     + 'y que tenga luz encendida.',
          observadoEn,
          senalDbm:    null,
        };

      case 'ruptura_fibra':
        // Pérdida de señal óptica (LOS/LOF) con el equipo alimentado: el corte está en
        // la fibra, no en casa del abonado. Se le dice para que no pierda tiempo
        // reiniciando un equipo que funciona.
        return {
          estado:      'fibra_cortada',
          detalle:     'Detectamos un corte en la fibra que llega a tu domicilio. '
                     + 'No es un problema de tu equipo; ya podemos verlo desde aquí.',
          observadoEn,
          senalDbm:    null,
        };

      case 'desactivada':
        // Desactivada en la propia OLT: es el corte administrativo materializado.
        return {
          estado:      'suspendido',
          detalle:     'Tu servicio está suspendido. Regulariza tu pago para reactivarlo.',
          observadoEn,
          senalDbm:    null,
        };

      case 'offline':
        // Caída sin causa concluyente en la lectura. No se inventa cuál de las dos es.
        return {
          estado:      'sin_conexion',
          detalle:     'No vemos tu equipo en la red. Revisa que esté enchufado y encendido; '
                     + 'si lo está, puede ser un corte en la fibra y conviene avisarnos.',
          observadoEn,
          senalDbm:    null,
        };

      default:
        // null (nunca observada) o 'no_aprovisionada'.
        return {
          estado:      'sin_datos',
          detalle:     'Aún no tenemos lectura de tu equipo.',
          observadoEn,
          senalDbm:    null,
        };
    }
  }

  // Fecha de corte visible para el abonado. Una prórroga vigente manda sobre el cálculo
  // ordinario: es justamente la fecha que le prometieron por teléfono.
  /**
   * Fecha de corte que se le anuncia al abonado. Sale de la MISMA política y del MISMO
   * vencimiento que usa el cron para cortar de verdad.
   *
   * Antes se calculaba aquí con `contratos.dias_prorroga` mientras la factura se emitía
   * con `empresas.dias_gracia`: al abonado se le anunciaba el corte para el día 4 cuando
   * su factura vencía el 6 — una fecha de corte anterior al vencimiento de la deuda que
   * la motiva (incidente 2026-08-05).
   */
  private calcularFechaCorte(
    f: FilaServicio,
    politica: PoliticaFacturacion,
    vencimientoImpago: string | null,
  ): string | null {
    // Una prórroga concedida manda sobre el ciclo: es la fecha que el operador pactó.
    if (f.en_prorroga && f.prorroga_hasta) return f.prorroga_hasta;

    // Con deuda vencida, la fecha que le importa es el corte de ESA factura. Sin deuda,
    // la del próximo ciclo, que es informativa.
    const vencimiento = vencimientoImpago
      ? new Date(`${vencimientoImpago}T00:00:00Z`)
      : this.politicaSvc.proximoVencimiento(politica, new Date());

    const corte = this.politicaSvc.fechaCorte(politica, vencimiento);
    return corte ? this.politicaSvc.aIso(corte) : null; // sin gracia = sin corte automático
  }
}
