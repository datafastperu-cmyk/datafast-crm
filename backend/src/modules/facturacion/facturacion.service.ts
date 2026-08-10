import {
  Injectable, Logger, NotFoundException,
  BadRequestException, ConflictException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { NOTIFICATION_EVENTS } from '../notificaciones/events/notification.events';

import { filasUpdateReturning }       from '../../common/utils/pg-result.util';
import { FacturaRepository }          from './repositories/factura.repository';
import { AplicadorFacturaService }     from './aplicador-factura.service';
import { ComprobantesConfigService }   from './comprobantes-config.service';
import { PdfService, EmpresaPdfData, ClientePdfData } from './pdf.service';
import { AuditoriaService }            from '../auth/auditoria.service';
import { DeudaPorContratoService }      from './deuda-por-contrato.service';
import { PoliticaFacturacionService }   from './politica-facturacion.service';
import { AdelantosService }             from '../pagos/adelantos.service';
import { JwtPayload }                  from '../../common/decorators/current-user.decorator';

import { Factura, EstadoFactura, ItemFactura } from './entities/factura.entity';
import { CargoPendiente }              from './entities/cargo-pendiente.entity';
import { ComprobanteConfig }           from './entities/comprobante-config.entity';
import {
  CreateFacturaDto, GenerarFacturasMensualesDto,
  CreateNotaCreditoDto, AnularFacturaDto, FilterFacturaDto,
  ResumenFinancieroDto, UpdateFacturaDto,
} from './dto/factura.dto';
import { formatPaginatedResponse } from '../../common/utils/pagination.util';
import { cargoDelPeriodo, diasEntregados, diasFacturables, CargoDelPeriodo } from './domain/prorrateo';
import type { PoliticaFacturacion } from './politica-facturacion.service';

export interface ResultadoGeneracion {
  total:    number;
  exitosas: number;
  omitidas: number;
  errores:  number;
  detalles: Array<{ contratoId: string; numeroContrato: string; resultado: string; error?: string }>;
}

const DESCRIPCION_CARGO: Record<string, string> = {
  mora:       'Cargo por mora',
  reconexion: 'Cargo por reconexión',
  servicio:   'Servicio prorrateado',
};

@Injectable()
export class FacturacionService {
  private readonly logger = new Logger(FacturacionService.name);

  constructor(
    private readonly facturaRepo:    FacturaRepository,
    private readonly comprobantesSvc: ComprobantesConfigService,
    private readonly pdfSvc:         PdfService,
    private readonly auditoria:      AuditoriaService,
    private readonly deudaSvc:       DeudaPorContratoService,
    private readonly politicaSvc:    PoliticaFacturacionService,
    private readonly events:         EventEmitter2,
    private readonly adelantosSvc:   AdelantosService,
    private readonly aplicador:      AplicadorFacturaService,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  // ────────────────────────────────────────────────────────────
  // CREAR FACTURA MANUAL
  // ────────────────────────────────────────────────────────────
  async create(dto: CreateFacturaDto, user: JwtPayload, req?: any): Promise<Factura> {
    // Resolver comprobante: si el DTO trae comprobanteConfigId lo usa,
    // sino resuelve por jerarquía (cliente → empresa default → primer activo)
    const comprobanteConfig = dto.comprobanteConfigId
      ? await this.getComprobanteById(dto.comprobanteConfigId, user.empresaId)
      : await this.comprobantesSvc.resolverParaCliente(user.empresaId, dto.clienteId);

    // Configuración global para saber igvRate y moneda
    const configGlobal = await this.comprobantesSvc.getConfiguracion(user.empresaId);

    if (dto.periodoInicio >= dto.periodoFin) {
      throw new BadRequestException('periodoFin debe ser posterior a periodoInicio');
    }

    const { subtotal, descuento, igv, total, items } =
      await this.calcularMontos(dto, comprobanteConfig, configGlobal.igvRate);

    const { correlativo } =
      await this.comprobantesSvc.siguienteCorrelativo(comprobanteConfig.id);
    const serie = comprobanteConfig.serie;

    // El vencimiento es EL DÍA DE PAGO DEL ABONADO. No es negociable por comprobante:
    // «dijimos que las fechas eran las mismas» (propietario, 2026-08-08).
    //
    // Antes esta ruta caía en `hoy + empresas.dias_gracia`, que está mal por dos motivos a
    // la vez: no es el día de pago del cliente, y usa los días de gracia como distancia al
    // VENCIMIENTO cuando son la distancia al CORTE. Es exactamente el defecto del incidente
    // 2026-08-05 —a un abonado se le anunciaba el corte antes de que venciera su factura—
    // reintroducido por la puerta de la emisión manual, que es por donde entra el primer
    // comprobante de todo abonado prepago.
    //
    // Un `fechaVencimiento` explícito solo se acepta si coincide con el ciclo. Se valida en
    // vez de ignorarse en silencio: si el operador pidió otra fecha, tiene que enterarse.
    const politica = await this.politicaSvc.resolver(dto.clienteId, user.empresaId);
    const fechaVencimiento = this.politicaSvc.aIso(
      this.politicaSvc.proximoVencimiento(politica, new Date()),
    );

    if (dto.fechaVencimiento && dto.fechaVencimiento !== fechaVencimiento) {
      throw new BadRequestException(
        `El vencimiento lo fija el día de pago del abonado (${fechaVencimiento}), ` +
        `no se puede establecer otro. Cámbialo en Facturación → Configuración del cliente.`,
      );
    }

    const factura = this.facturaRepo.create({
      empresaId:            user.empresaId,
      clienteId:            dto.clienteId,
      contratoId:           dto.contratoId,
      comprobanteConfigId:  comprobanteConfig.id,
      tipoComprobante:      comprobanteConfig.codigo,
      tipoComprobanteNombre: comprobanteConfig.nombre,
      tieneCargaFiscal:     comprobanteConfig.tieneCargaFiscal,
      serie,
      correlativo,
      periodoInicio:        dto.periodoInicio,
      periodoFin:           dto.periodoFin,
      descripcion:          dto.descripcion || 'Servicio de internet',
      subtotal, descuento, igv, total,
      montoPagado:          0,
      items,
      estado:               EstadoFactura.EMITIDA,
      fechaEmision:         new Date().toISOString().split('T')[0],
      fechaVencimiento,
      moneda:               configGlobal.moneda,
      generadaAutomaticamente: false,
      createdBy:            user.sub,
    });

    const saved = await this.facturaRepo.save(factura);
    this.generarPdfAsync(saved, user.empresaId);

    await this.auditoria.logCreate({
      empresaId: user.empresaId, usuarioId: user.sub, usuarioEmail: user.email,
      modulo: 'facturacion', entidadId: saved.id,
      descripcion: `${comprobanteConfig.nombre} ${serie}-${correlativo} · Cliente: ${dto.clienteId} · Total: ${total}`,
      req,
    });

    return saved;
  }

  /**
   * Cargo que le toca a un contrato en su ciclo, o `null` si no se le factura nada.
   *
   * **H-6 (2026-08-09).** Antes esto no existía: la generación filtraba `estado = 'activo'` y a
   * cada contrato que pasara el filtro se le cobraba el precio entero. Un suspendido no entraba,
   * y con él se perdía el tramo del ciclo que SÍ se le había entregado antes del corte — ocho
   * días de servicio real que no se cobraban nunca, porque el comprobante siguiente ya cubría el
   * mes siguiente.
   *
   * Las dos modalidades no se tratan igual, y no es una excepción sino su definición:
   *
   * · **Postpago** cobra por detrás, así que el ciclo ya transcurrió y se puede contar lo
   *   entregado. Cero días entregados → no se emite nada.
   * · **Prepago** cobra por delante: el ciclo está en el futuro y **no hay días que contar**. Se
   *   emite si el servicio está en pie hoy; si está suspendido no se le cobra por adelantado un
   *   mes que no va a recibir, y al reactivar se le emite lo que falte (H-8).
   */
  private cargoDelContratoEnCiclo(
    contrato: { contrato_id: string; precio: string | number; estado: string },
    politica: PoliticaFacturacion,
    periodo: { inicio: string; fin: string },
    historial: Map<string, Array<{ estado_nuevo: string; fecha: string }>>,
  ): CargoDelPeriodo | null {
    const precio    = parseFloat(String(contrato.precio ?? '0'));
    const inicio    = new Date(`${periodo.inicio}T00:00:00.000Z`);
    const fin       = new Date(`${periodo.fin}T00:00:00.000Z`);
    const diasCiclo = diasFacturables(inicio, fin);

    if (politica.tipo === 'prepago') {
      return contrato.estado === 'activo'
        ? cargoDelPeriodo(precio, diasCiclo, diasCiclo)
        : null;
    }

    // Las fechas son ISO `YYYY-MM-DD`, así que comparar como texto ordena igual que como fecha.
    const transiciones = historial.get(contrato.contrato_id) ?? [];
    const previas      = transiciones.filter((t) => t.fecha <  periodo.inicio);
    const dentro       = transiciones.filter((t) => t.fecha >= periodo.inicio && t.fecha <= periodo.fin);

    // Sin historial previo el contrato aún no había nacido al empezar el ciclo: parte de un
    // estado sin servicio y solo suma si dentro del ciclo llegó a activarse.
    const estadoAlInicio = previas.length
      ? previas[previas.length - 1].estado_nuevo
      : 'pendiente_activacion';

    const dias = diasEntregados(
      estadoAlInicio,
      dentro.map((t) => ({ fecha: new Date(`${t.fecha}T00:00:00.000Z`), estadoNuevo: t.estado_nuevo })),
      inicio, fin,
    );

    return dias === 0 ? null : cargoDelPeriodo(precio, diasCiclo, dias);
  }

  // ────────────────────────────────────────────────────────────
  // GENERACIÓN MASIVA MENSUAL
  // Idempotente: omite clientes ya facturados en el periodo.
  // Resuelve el tipo de comprobante por cliente individualmente.
  //
  // SERIALIZADA POR (empresa, periodo) con un advisory lock de Postgres. La idempotencia
  // se apoyaba solo en `existeFacturaClientePeriodo`, que es un TOCTOU: entre consultar y
  // emitir hay una ventana, y basta que el cron y un operador pulsen "Generar" a la vez
  // —o dos instancias PM2— para que ambos pasen el chequeo y el cliente reciba DOS facturas
  // del mismo mes. Cobrarle dos veces a un abonado es de los daños más difíciles de
  // deshacer: hay que emitir nota de crédito y explicárselo.
  //
  // Se serializa en vez de imponer un índice único (empresa, cliente, periodo) porque ese
  // índice también bloquearía emisiones legítimas —una nota de crédito o un cargo manual
  // extra en el mismo mes—, y el sistema no distingue hoy la factura de ciclo de la manual.
  // El lock ataca exactamente la carrera, sin restringir qué puede facturar el operador.
  // ────────────────────────────────────────────────────────────
  async generarMensual(
    dto: GenerarFacturasMensualesDto,
    user: JwtPayload,
    req?: any,
  ): Promise<ResultadoGeneracion> {
    const hoy  = new Date();
    const mes  = dto.mes  ?? hoy.getMonth() + 1;
    const anio = dto.anio ?? hoy.getFullYear();

    // Lock de SESIÓN (no de transacción): esta generación no corre dentro de una, emite
    // factura por factura. Se libera siempre en el `finally` de _generarMensualInterno.
    const claveLock = `facturacion:${user.empresaId}:${anio}-${mes}`;
    const [{ obtenido }] = await this.ds.query<Array<{ obtenido: boolean }>>(
      `SELECT pg_try_advisory_lock(hashtext($1)) AS obtenido`, [claveLock],
    );
    if (!obtenido) {
      this.logger.warn(`Generación mensual ${anio}/${mes} ya en curso — se omite este disparo.`);
      return { total: 0, exitosas: 0, omitidas: 0, errores: 0, detalles: [
        { contratoId: '', numeroContrato: '', resultado: 'omitida — ya hay una generación en curso para este periodo' },
      ] };
    }

    try {
      return await this._generarMensualInterno(dto, user, mes, anio, req);
    } finally {
      await this.ds.query(`SELECT pg_advisory_unlock(hashtext($1))`, [claveLock])
        .catch((e) => this.logger.error(`No se pudo liberar el lock de facturación: ${e?.message}`));
    }
  }

  private async _generarMensualInterno(
    dto:  GenerarFacturasMensualesDto,
    user: JwtPayload,
    mes:  number,
    anio: number,
    req?: any,
  ): Promise<ResultadoGeneracion> {

    this.logger.log(`Generación mensual: ${anio}/${mes} | empresa: ${user.empresaId}`);

    const configGlobal = await this.comprobantesSvc.getConfiguracion(user.empresaId);
    // H-6: se traen también los NO activos cuyo estado cambió dentro de la ventana que puede
    // solapar el ciclo — su tramo entregado antes del corte también se factura. Un contrato
    // suspendido desde antes tiene cero días y ni siquiera hace falta traerlo.
    const desdeActividad = mes === 1
      ? `${anio - 1}-12-01`
      : `${anio}-${String(mes - 1).padStart(2, '0')}-01`;
    const contratos    = await this.facturaRepo.findContratosParaFacturar(
      user.empresaId, mes, anio, dto.contratoId, undefined, desdeActividad,
    );

    if (!contratos.length) {
      return { total: 0, exitosas: 0, omitidas: 0, errores: 0, detalles: [] };
    }

    // Agrupar por cliente
    const porCliente = new Map<string, typeof contratos>();
    for (const c of contratos) {
      if (!porCliente.has(c.cliente_id)) porCliente.set(c.cliente_id, []);
      porCliente.get(c.cliente_id)!.push(c);
    }

    const resultado: ResultadoGeneracion = {
      total: porCliente.size, exitosas: 0, omitidas: 0, errores: 0, detalles: [],
    };

    // El periodo YA NO es el mes de calendario ni es común a todo el parque: cada abonado
    // tiene su ciclo, del día siguiente a su fecha de pago hasta la siguiente. Se calcula
    // dentro del bucle, junto a su vencimiento.
    //
    // La deduplicación, en consecuencia, se hace por **vencimiento**: un comprobante vivo
    // por abonado y fecha de pago. La ventana cubre el mes solicitado con un día de margen
    // a cada lado, porque el vencimiento de un abonado del mes `mes` cae siempre dentro de
    // él (`diaPago` va de 1 a 28).
    const ventanaDesde = `${anio}-${String(mes).padStart(2, '0')}-01`;
    const ventanaHasta = this.ultimoDiaMes(anio, mes);

    // Los ya facturados se resuelven en UNA consulta, no una por abonado. Preguntarlo dentro
    // del bucle costaba un roundtrip por cliente: con los 5000+ abonados que se está
    // dimensionando, 5000 consultas secuenciales antes de emitir la primera factura.
    // Es seguro leerlo una vez porque la generación está serializada por (empresa, periodo):
    // nadie más puede estar emitiendo facturas de este periodo mientras corremos.
    const yaFacturados = await this.facturaRepo.clientesYaFacturados(
      user.empresaId, ventanaDesde, ventanaHasta,
    );

    // La política de cada abonado en UNA consulta, por la misma razón que `yaFacturados`:
    // resolverla dentro del bucle es un roundtrip por cliente.
    const politicas = await this.politicaSvc.resolverLote(
      [...porCliente.keys()], user.empresaId,
    );

    // Historial de estados de TODO el lote en una consulta, por la misma razón. Se pide con
    // holgura —hasta el final del mes siguiente— porque el ciclo de cada abonado termina en su
    // propio día de pago; el recorte exacto se hace después, ya con el periodo de cada uno.
    const finHistorial = mes === 12
      ? this.ultimoDiaMes(anio + 1, 1)
      : this.ultimoDiaMes(anio, mes + 1);
    const historialPorContrato = new Map<string, Array<{ estado_nuevo: string; fecha: string }>>();
    for (const fila of await this.facturaRepo.historialParaCiclo(
      contratos.map((c) => c.contrato_id), finHistorial,
    )) {
      const previas = historialPorContrato.get(fila.contrato_id) ?? [];
      previas.push({ estado_nuevo: fila.estado_nuevo, fecha: fila.fecha });
      historialPorContrato.set(fila.contrato_id, previas);
    }

    for (const [clienteId, grupo] of porCliente) {
      const primer = grupo[0];
      try {
        // El ciclo del abonado se resuelve ANTES de deduplicar, porque la clave es su
        // vencimiento. El vencimiento es su DÍA DE PAGO, no "día de facturación + gracia":
        // los días de gracia son la distancia hasta el CORTE. Sumarlos aquí producía una
        // factura que vencía después de la fecha de corte que se le anunciaba al cliente
        // (incidente 2026-08-05). Ver `PoliticaFacturacionService`.
        const politica = politicas.get(clienteId)
          ?? await this.politicaSvc.resolver(clienteId, user.empresaId);
        const vencimiento = this.politicaSvc.proximoVencimiento(
          politica, new Date(Date.UTC(anio, mes - 1, 1)),
        );
        const fechaVencimiento = this.politicaSvc.aIso(vencimiento);
        // Periodo del CICLO del abonado, no del calendario: del día siguiente a una fecha
        // de pago hasta la siguiente. Prepago va por delante del vencimiento; postpago,
        // por detrás.
        const periodo       = this.politicaSvc.periodoServicio(politica, vencimiento);
        const periodoInicio = periodo.inicio;
        const periodoFin    = periodo.fin;

        if (yaFacturados.has(`${clienteId}|${fechaVencimiento}`)) {
          resultado.omitidas++;
          grupo.forEach(c => resultado.detalles.push({
            contratoId: c.contrato_id, numeroContrato: c.numero_contrato,
            resultado:  'omitida — ya facturado este periodo',
          }));
          continue;
        }

        // Resolver comprobante por jerarquía para este cliente específico
        const comprobante = await this.comprobantesSvc.resolverParaCliente(user.empresaId, clienteId);

        // Leer IGV por contrato (no del primer elemento del lote)
        const aplicaIgv  = comprobante.tieneCargaFiscal;
        const igvRate    = Number(configGlobal.igvRate);

        let totalSubtotal = 0, totalIgv = 0, totalTotal = 0;
        const items: ItemFactura[] = [];

        for (const contrato of grupo) {
          // Lo que se cobra ya no es el precio del plan sin más: es lo ENTREGADO en este ciclo.
          const cargo = this.cargoDelContratoEnCiclo(contrato, politica, periodo, historialPorContrato);
          if (!cargo) continue; // cero días entregados, o prepago sin servicio en pie

          // El IGV es propiedad del DOCUMENTO, no del producto: lo decide la carga fiscal del
          // comprobante, no una bandera del plan. Antes se exigían ambas y bastaba con que el plan
          // tuviera aplica_igv = false para emitir una factura fiscal sin IGV.
          const contratoAplicaIgv = comprobante.tieneCargaFiscal;

          const { subtotal: sub, igv: igvItem, total: tot } =
            this.calcularMontosDesdeBase(cargo.importe, 0, contratoAplicaIgv, igvRate);

          items.push({
            // Con el comprobante consolidado, la línea es lo único que ata un importe a un
            // servicio concreto. Y si el tramo es parcial hay que decirlo, o el abonado ve un
            // importe que no cuadra con su mensualidad y reclama con razón.
            descripcion:    cargo.tipo === 'prorrateado'
              ? `${this.descripcionItem(contrato, mes, anio)} · ${cargo.dias} días`
              : this.descripcionItem(contrato, mes, anio),
            cantidad:       1,
            precioUnitario: sub,
            descuento:      0,
            subtotal:       sub,
            tipoItem:       'servicio',
            // La descripción es para el cliente; esto es para el sistema. Sin el id, la deuda de
            // un consolidado no se puede imputar a ningún servicio.
            contratoId:     contrato.contrato_id,
            // PD-14: la base viaja con el cargo. Solo en los parciales — en un ciclo completo no
            // hubo prorrateo que explicar, y guardarlo insinuaría que sí.
            prorrateo:      cargo.tipo === 'prorrateado'
              ? { base: cargo.base, denominador: cargo.denominador, dias: cargo.dias, tarifaDiaria: cargo.tarifaDiaria }
              : null,
          });
          totalSubtotal += sub;
          totalIgv      += igvItem;
          totalTotal    += tot;
        }

        // Agregar cargos pendientes (mora/reconexión de ciclos anteriores)
        const cargosPendientes = await this.consumirCargosPendientes(clienteId, user.empresaId, igvRate);
        for (const cargo of cargosPendientes.items) {
          items.push(cargo);
          totalSubtotal += cargo.subtotal;
          totalIgv      += cargo.igvItem ?? 0;
          totalTotal    += cargo.total;
        }

        // Nadie entregó nada en este ciclo y no hay cargos que arrastrar: no hay comprobante.
        // Antes no podía ocurrir —todo contrato que pasaba el filtro cobraba el mes entero—; que
        // ahora un abonado suspendido todo el ciclo no reciba factura es la otra mitad de H-6:
        // no se cobra lo que no se entregó.
        //
        // Va DESPUÉS de los cargos pendientes a propósito: un abonado sin servicio pero con una
        // reconexión pendiente sí debe recibir su comprobante. `consumirCargosPendientes` no
        // marca nada hasta que la factura se guarda, así que salir aquí no los pierde.
        if (!items.length) {
          resultado.omitidas++;
          grupo.forEach((c) => resultado.detalles.push({
            contratoId: c.contrato_id, numeroContrato: c.numero_contrato,
            resultado:  'omitida — sin días entregados en el ciclo',
          }));
          continue;
        }

        totalSubtotal = Math.round(totalSubtotal * 100) / 100;
        totalIgv      = Math.round(totalIgv      * 100) / 100;
        totalTotal    = Math.round(totalTotal     * 100) / 100;

        const { correlativo } = await this.comprobantesSvc.siguienteCorrelativo(comprobante.id);
        const serie = comprobante.serie;

        const descripcion = this.descripcionConsolidada(comprobante.nombre, grupo, mes, anio);

        const factura = this.facturaRepo.create({
          empresaId:               user.empresaId,
          clienteId,
          contratoId:              null,
          comprobanteConfigId:     comprobante.id,
          tipoComprobante:         comprobante.codigo,
          tipoComprobanteNombre:   comprobante.nombre,
          tieneCargaFiscal:        comprobante.tieneCargaFiscal,
          serie, correlativo,
          periodoInicio, periodoFin,
          descripcion,
          subtotal: totalSubtotal, descuento: 0, igv: totalIgv, total: totalTotal,
          montoPagado: 0,
          items,
          estado:                  EstadoFactura.EMITIDA,
          fechaEmision:            new Date().toISOString().split('T')[0],
          fechaVencimiento,
          moneda:                  configGlobal.moneda,
          generadaAutomaticamente: true,
          createdBy:               user.sub,
        });

        const saved = await this.ds.transaction(async (manager) => {
          const f = await manager.save(factura);
          if (cargosPendientes.ids.length) {
            await manager.query(
              `UPDATE cargos_pendientes SET incluido_en_factura_id = $1, incluido_en = NOW() WHERE id = ANY($2)`,
              [f.id, cargosPendientes.ids],
            );
          }
          // Mismo criterio que en la generación diaria: el saldo a favor del abonado se
          // consume aquí, para que su comprobante nazca pagado si ya adelantó el dinero.
          await this.adelantosSvc.aplicarSaldoAFactura(manager, f.id, clienteId, user.empresaId);
          return f;
        });

        // La deuda del contrato se recalcula desde las facturas: es una proyeccion, no un
        // valor propio. Fuera de la transaccion a proposito — un fallo al refrescar la
        // caché no puede deshacer una factura ya emitida.
        await this.deudaSvc.recalcularPorCliente(clienteId, user.empresaId);

        this.generarPdfAsync(saved, user.empresaId, {
          razonSocial: primer.empresa_nombre, ruc: primer.empresa_ruc,
          direccionFiscal: primer.empresa_direccion,
        }, {
          nombreCompleto: primer.cliente_nombre, tipoDocumento: primer.tipo_documento,
          numeroDocumento: primer.cliente_documento, direccion: primer.cliente_direccion,
          email: primer.cliente_email, telefono: primer.cliente_telefono,
        });

        resultado.exitosas++;
        grupo.forEach(c => resultado.detalles.push({
          contratoId: c.contrato_id, numeroContrato: c.numero_contrato,
          resultado:  `generada: ${serie}-${correlativo} (${comprobante.nombre}) | total: ${configGlobal.moneda} ${totalTotal.toFixed(2)}`,
        }));

      } catch (err) {
        resultado.errores++;
        grupo.forEach(c => resultado.detalles.push({
          contratoId: c.contrato_id, numeroContrato: c.numero_contrato,
          resultado: 'error', error: err.message,
        }));
        this.logger.error(`Error generando factura cliente ${primer.cliente_id}: ${err.message}`);
      }
    }

    await this.auditoria.log({
      empresaId: user.empresaId, usuarioId: user.sub, usuarioEmail: user.email,
      accion: 'GENERATE_MONTHLY', modulo: 'facturacion',
      descripcion: `Generación mensual ${mes}/${anio}: ${resultado.exitosas} exitosas, ${resultado.omitidas} omitidas, ${resultado.errores} errores`,
      req,
    });

    return resultado;
  }

  // ────────────────────────────────────────────────────────────
  // GENERACIÓN AUTOMÁTICA DIARIA (desde FacturacionScheduler)
  //
  // Corre todos los días y emite solo a los abonados cuyo día de emisión es HOY, según la
  // configuración de SU pestaña Facturación (`diaPago − crearFactura`). Antes el disparo
  // era por `empresas.dia_facturacion`: un único día al mes para todo el parque, con lo
  // que la configuración por cliente no llegaba a usarse nunca.
  // ────────────────────────────────────────────────────────────
  async generarFacturasDelDia(
    empresaId: string, hoy: Date,
  ): Promise<ResultadoGeneracion> {
    const mes  = hoy.getUTCMonth() + 1;
    const anio = hoy.getUTCFullYear();

    // H-6: entran también los no activos con actividad reciente — su tramo entregado antes del
    // corte se factura igual.
    const desdeActividad = mes === 1
      ? `${anio - 1}-12-01`
      : `${anio}-${String(mes - 1).padStart(2, '0')}-01`;
    const contratos = await this.facturaRepo.findContratosParaFacturar(
      empresaId, mes, anio, undefined, undefined, desdeActividad,
    );
    if (!contratos.length) {
      return { total: 0, exitosas: 0, omitidas: 0, errores: 0, detalles: [] };
    }

    const configGlobal = await this.comprobantesSvc.getConfiguracion(empresaId);

    const porCliente = new Map<string, typeof contratos>();
    for (const c of contratos) {
      if (!porCliente.has(c.cliente_id)) porCliente.set(c.cliente_id, []);
      porCliente.get(c.cliente_id)!.push(c);
    }

    // Cada abonado tiene su propio ciclo: se emite a quien le toca hoy y a nadie más.
    const politicas = await this.politicaSvc.resolverLote([...porCliente.keys()], empresaId);
    const hoyIso    = this.politicaSvc.aIso(hoy);

    for (const clienteId of [...porCliente.keys()]) {
      const politica = politicas.get(clienteId);
      const vence    = politica && this.politicaSvc.proximoVencimiento(politica, hoy);
      const emite    = politica && vence && this.politicaSvc.fechaEmision(politica, vence);
      // Sin fecha de emisión la factura se crea a mano: no es un error, es la opción
      // "Desactivado" de `crearFactura`.
      // `<=`, no `===`. H-8 (2026-08-09): con igualdad estricta, el ciclo de un abonado que no
      // estaba activo el día de su emisión NO lo emitía nadie nunca más. Un prepago suspendido el
      // 07/09 y reactivado el 25/09 se quedaba sin comprobante del ciclo que sí iba a recibir —un
      // mes entero gratis— porque su día de emisión, el 23, ya había pasado.
      //
      // Con `<=` el generador se auto-repara: cualquier ciclo cuya emisión ya venció y que aún no
      // tenga comprobante se emite en la siguiente pasada. La deduplicación por periodo
      // (`existeFacturaClientePeriodo`, abajo) es lo que lo hace seguro — y de paso cubre el día
      // en que el cron no llegó a correr.
      if (!emite || this.politicaSvc.aIso(emite) > hoyIso) porCliente.delete(clienteId);
    }

    if (!porCliente.size) {
      return { total: 0, exitosas: 0, omitidas: 0, errores: 0, detalles: [] };
    }

    const resultado: ResultadoGeneracion = {
      total: porCliente.size, exitosas: 0, omitidas: 0, errores: 0, detalles: [],
    };

    // Historial de estados del lote en una consulta (H-6). Se pide con holgura hasta el final
    // del mes siguiente; el recorte al ciclo de cada abonado se hace después.
    const historialDiario = new Map<string, Array<{ estado_nuevo: string; fecha: string }>>();
    for (const fila of await this.facturaRepo.historialParaCiclo(
      contratos.map((c) => c.contrato_id),
      mes === 12 ? this.ultimoDiaMes(anio + 1, 1) : this.ultimoDiaMes(anio, mes + 1),
    )) {
      const previas = historialDiario.get(fila.contrato_id) ?? [];
      previas.push({ estado_nuevo: fila.estado_nuevo, fecha: fila.fecha });
      historialDiario.set(fila.contrato_id, previas);
    }

    for (const [clienteId, grupo] of porCliente) {
      const primer = grupo[0];
      // El periodo es el del VENCIMIENTO, no el de hoy: a un abonado que vence el día 1 se
      // le emite a fines del mes anterior, y esa factura pertenece al mes que vence.
      const politica     = politicas.get(clienteId)!;
      const vencimiento  = this.politicaSvc.proximoVencimiento(politica, hoy);
      // Prepago ampara el mes que empieza; postpago, el que ya se consumió.
      const periodo       = this.politicaSvc.periodoServicio(politica, vencimiento);
      const periodoInicio = periodo.inicio;
      const periodoFin    = periodo.fin;
      try {
        if (await this.facturaRepo.existeFacturaClientePeriodo(clienteId, periodoInicio, periodoFin)) {
          resultado.omitidas++;
          grupo.forEach(c => resultado.detalles.push({
            contratoId: c.contrato_id, numeroContrato: c.numero_contrato,
            resultado: 'omitida — ya facturado',
          }));
          continue;
        }

        const comprobante = await this.comprobantesSvc.resolverParaCliente(empresaId, clienteId);
        const igvRate     = Number(configGlobal.igvRate);

        let totalSubtotal = 0, totalIgv = 0, totalTotal = 0;
        const items: ItemFactura[] = [];

        for (const contrato of grupo) {
          // Se cobra lo ENTREGADO en el ciclo, no el precio del plan sin más (H-6).
          const cargo = this.cargoDelContratoEnCiclo(contrato, politica, periodo, historialDiario);
          if (!cargo) continue;

          // El IGV es propiedad del DOCUMENTO, no del producto: lo decide la carga fiscal del
          // comprobante, no una bandera del plan.
          const contratoAplicaIgv = comprobante.tieneCargaFiscal;

          const { subtotal: sub, igv: igvItem, total: tot } =
            this.calcularMontosDesdeBase(cargo.importe, 0, contratoAplicaIgv, igvRate);

          items.push({
            descripcion: cargo.tipo === 'prorrateado'
              ? `${this.descripcionItem(contrato, periodo.mes, periodo.anio)} · ${cargo.dias} días`
              : this.descripcionItem(contrato, periodo.mes, periodo.anio),
            cantidad: 1, precioUnitario: sub, descuento: 0, subtotal: sub, tipoItem: 'servicio',
            contratoId: contrato.contrato_id,
            prorrateo: cargo.tipo === 'prorrateado'
              ? { base: cargo.base, denominador: cargo.denominador, dias: cargo.dias, tarifaDiaria: cargo.tarifaDiaria }
              : null,
          });
          totalSubtotal += sub; totalIgv += igvItem; totalTotal += tot;
        }

        const cargosPendientes = await this.consumirCargosPendientes(clienteId, empresaId, igvRate);
        for (const cargo of cargosPendientes.items) {
          items.push(cargo);
          totalSubtotal += cargo.subtotal;
          totalIgv      += cargo.igvItem ?? 0;
          totalTotal    += cargo.total;
        }

        // Cero días entregados y sin cargos que arrastrar: no hay comprobante que emitir.
        if (!items.length) {
          resultado.omitidas++;
          grupo.forEach((c) => resultado.detalles.push({
            contratoId: c.contrato_id, numeroContrato: c.numero_contrato,
            resultado:  'omitida — sin días entregados en el ciclo',
          }));
          continue;
        }

        totalSubtotal = Math.round(totalSubtotal * 100) / 100;
        totalIgv      = Math.round(totalIgv      * 100) / 100;
        totalTotal    = Math.round(totalTotal     * 100) / 100;

        const { correlativo } = await this.comprobantesSvc.siguienteCorrelativo(comprobante.id);
        const serie = comprobante.serie;
        const fechaVencimiento = this.politicaSvc.aIso(vencimiento);
        const descripcion = this.descripcionConsolidada(comprobante.nombre, grupo, periodo.mes, periodo.anio);

        const factura = this.facturaRepo.create({
          empresaId, clienteId, contratoId: null,
          comprobanteConfigId: comprobante.id, tipoComprobante: comprobante.codigo,
          tipoComprobanteNombre: comprobante.nombre, tieneCargaFiscal: comprobante.tieneCargaFiscal,
          serie, correlativo, periodoInicio, periodoFin, descripcion,
          subtotal: totalSubtotal, descuento: 0, igv: totalIgv, total: totalTotal, montoPagado: 0,
          items, estado: EstadoFactura.EMITIDA,
          fechaEmision: new Date().toISOString().split('T')[0],
          fechaVencimiento, moneda: configGlobal.moneda, generadaAutomaticamente: true,
        });

        const saved = await this.ds.transaction(async (manager) => {
          const f = await manager.save(factura);
          if (cargosPendientes.ids.length) {
            await manager.query(
              `UPDATE cargos_pendientes SET incluido_en_factura_id = $1, incluido_en = NOW() WHERE id = ANY($2)`,
              [f.id, cargosPendientes.ids],
            );
          }
          // Si el abonado adelantó dinero, su comprobante nace pagado: es lo que esperaba
          // al adelantar, y evita que el cron lo persiga por una deuda que ya cubrió.
          // Dentro de la TX: factura emitida y saldo consumido son el mismo hecho.
          await this.adelantosSvc.aplicarSaldoAFactura(manager, f.id, clienteId, empresaId);
          return f;
        });

        await this.deudaSvc.recalcularPorCliente(clienteId, empresaId);

        this.generarPdfAsync(saved, empresaId, {
          razonSocial: primer.empresa_nombre, ruc: primer.empresa_ruc,
          direccionFiscal: primer.empresa_direccion,
        }, {
          nombreCompleto: primer.cliente_nombre, tipoDocumento: primer.tipo_documento,
          numeroDocumento: primer.cliente_documento, direccion: primer.cliente_direccion,
          email: primer.cliente_email, telefono: primer.cliente_telefono,
        });

        // Aviso de comprobante disponible, si el abonado lo tiene activado en su pestaña
        // de Notificaciones. Nadie emitía este evento: el listener existía sin disparador,
        // así que la opción "Aviso nueva factura" no enviaba nada.
        this.avisarFacturaEmitida(saved, {
          clienteId, empresaId,
          contratoId: grupo[0].contrato_id,
          nombre:     primer.cliente_nombre,
          telefono:   primer.cliente_telefono,
        });

        resultado.exitosas++;
        grupo.forEach(c => resultado.detalles.push({
          contratoId: c.contrato_id, numeroContrato: c.numero_contrato,
          resultado: `generada: ${serie}-${correlativo} (${comprobante.nombre}) | ${configGlobal.moneda} ${totalTotal.toFixed(2)}`,
        }));

      } catch (err) {
        resultado.errores++;
        grupo.forEach(c => resultado.detalles.push({
          contratoId: c.contrato_id, numeroContrato: c.numero_contrato,
          resultado: 'error', error: err.message,
        }));
        this.logger.error(`[AUTO] Error cliente ${primer.cliente_id}: ${err.message}`);
      }
    }

    await this.auditoria.log({
      empresaId, accion: 'AUTO_GENERATE_DAILY', modulo: 'facturacion',
      descripcion: `Auto-generación ${this.politicaSvc.aIso(hoy)}: ${resultado.exitosas} exitosas, ${resultado.omitidas} omitidas, ${resultado.errores} errores`,
    });

    return resultado;
  }

  /**
   * Emite el aviso de comprobante disponible SI el abonado lo tiene activado.
   *
   * Fire-and-forget a propósito: un fallo del gateway de mensajería no puede tumbar una
   * generación de facturas ya confirmada en BD. El envío tiene su propia bitácora en
   * `notificaciones_logs` y sus reintentos en Bull.
   */
  private avisarFacturaEmitida(
    factura: Factura,
    destino: {
      clienteId: string; empresaId: string; contratoId?: string;
      nombre?: string; telefono?: string;
    },
  ): void {
    void (async () => {
      try {
        const prefs = await this.politicaSvc.resolverNotificaciones(
          destino.clienteId, destino.empresaId,
        );
        // 'desactivado' → el operador decidió que este abonado no recibe el aviso.
        if (!prefs.avisoNuevaFactura) return;
        if (!destino.telefono) {
          this.logger.warn(
            `[AVISO] Cliente ${destino.clienteId} tiene aviso de factura activo pero no tiene teléfono`,
          );
          return;
        }

        this.events.emit(NOTIFICATION_EVENTS.FACTURA_EMITIDA, {
          empresaId:        destino.empresaId,
          clienteId:        destino.clienteId,
          contratoId:       destino.contratoId,
          telefono:         destino.telefono,
          clienteNombre:    destino.nombre ?? '',
          numeroFactura:    factura.numeroCompleto ?? `${factura.serie}-${factura.correlativo}`,
          montoTotal:       String(factura.total),
          fechaVencimiento: factura.fechaVencimiento,
          // La plantilla elegida en la pestaña del cliente; sin ella, la genérica del tipo.
          plantilla:        prefs.plantillaAvisoFactura ?? undefined,
        });
      } catch (err) {
        this.logger.warn(
          `[AVISO] No se pudo emitir el aviso de factura para ${destino.clienteId}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
        );
      }
    })();
  }

  // ────────────────────────────────────────────────────────────
  // REGISTRAR CARGO PENDIENTE (mora o reconexión)
  // El CobranzaWorker llama esto cuando ocurre un evento de
  // suspensión/reactivación y la config dice "acumular".
  // ────────────────────────────────────────────────────────────
  async registrarCargoPendiente(params: {
    empresaId: string;
    clienteId: string;
    contratoId: string | null;
    tipo: 'mora' | 'reconexion' | 'servicio';
    monto: number;
    descripcion?: string;
    generadoPor?: string;
  }): Promise<CargoPendiente> {
    const configGlobal = await this.comprobantesSvc.getConfiguracion(params.empresaId);

    // Verificar que la config dice acumular para este tipo
    if (params.tipo === 'mora' && !configGlobal.moraAcumulaSiguienteCiclo) {
      throw new BadRequestException('La mora está configurada para no acumularse');
    }
    if (params.tipo === 'reconexion' && !configGlobal.reconexionAcumulaSiguienteCiclo) {
      throw new BadRequestException('La reconexión está configurada para no acumularse');
    }
    // 'servicio' NO tiene interruptor, y es deliberado: mora y reconexión son cargos que el
    // operador decide aplicar o no, mientras que un tramo de servicio entregado se debe siempre.
    // Dejarlo configurable sería ofrecer la opción de regalar días ya prestados.

    const repo = this.ds.getRepository(CargoPendiente);
    const cargo = repo.create({
      empresaId:   params.empresaId,
      clienteId:   params.clienteId,
      contratoId:  params.contratoId,
      tipo:        params.tipo,
      monto:       params.monto,
      // mora = NUNCA IGV | reconexion = SIEMPRE IGV | servicio = lo que diga su comprobante.
      //
      // En los dos primeros la carga fiscal es una propiedad del cargo. En un tramo de servicio
      // no: es exactamente el mismo producto que la mensualidad, así que tributa igual que ella.
      // Se resuelve AQUÍ y se congela, como los otros dos, porque el generador no recalcula
      // (ver el comentario de la columna) — y porque el comprobante del abonado puede cambiar
      // entre que se genera el cargo y se emite la factura que lo recoge.
      aplicaIgv:   params.tipo === 'servicio'
        ? (await this.comprobantesSvc.resolverParaCliente(params.empresaId, params.clienteId)).tieneCargaFiscal
        : params.tipo === 'reconexion',
      descripcion: params.descripcion ?? null,
      incluidoEnFacturaId: null,
      incluidoEn:  null,
      generadoPor: params.generadoPor ?? null,
    });

    return repo.save(cargo);
  }

  // ────────────────────────────────────────────────────────────
  // MARCAR VENCIDAS — batch UPDATE en lugar de N+1 queries
  //
  // EXCEPCIÓN DECLARADA a la frontera del dinero (F3): esto escribe `facturas.estado`
  // sin pasar por `AplicadorFacturaService`, y es correcto — no es una entrada de dinero.
  // El paso del tiempo no mueve `monto_pagado` ni imputa nada; solo constata que una
  // fecha ya pasó.
  //
  // Se deja escrito para que nadie lo "corrija" en la próxima limpieza, y para que el
  // test de frontera pueda distinguir esta excepción de un escritor clandestino.
  // ────────────────────────────────────────────────────────────
  async marcarVencidas(): Promise<number> {
    const { affected } = await this.ds.createQueryBuilder()
      .update(Factura)
      .set({ estado: EstadoFactura.VENCIDA })
      .where("estado IN ('emitida', 'pagada_parcial')")
      .andWhere('fecha_vencimiento < CURRENT_DATE')
      .andWhere('deleted_at IS NULL')
      .execute();

    if (affected) this.logger.log(`Facturas marcadas como vencidas: ${affected}`);
    return affected ?? 0;
  }

  // ────────────────────────────────────────────────────────────
  // APLICAR PAGO
  // ────────────────────────────────────────────────────────────
  async aplicarPago(
    facturaId: string, montoPago: number, empresaId: string, fechaPago: string,
    manager?: EntityManager,
  ): Promise<Factura> {
    // El movimiento del saldo vive en `AplicadorFacturaService` — el único escritor. Este
    // método se conserva por sus efectos propios (el PDF) y por los llamadores que ya lo
    // usaban; lo que NO puede volver a tener es su propia copia del UPDATE.
    const { estado } = await this.aplicador.aplicar(
      facturaId, montoPago, empresaId, fechaPago, manager,
    );

    // Dentro de una transacción ajena, el estado definitivo aún no existe: leerlo por fuera
    // devolvería la fila previa al UPDATE, y generar el PDF aquí lo produciría a partir de
    // datos que el commit todavía puede deshacer. Se lee por el mismo manager y el PDF lo
    // dispara quien cierra la transacción.
    if (manager) {
      return manager.findOneOrFail(Factura, { where: { id: facturaId, empresaId } });
    }

    const actualizada = await this.findOne(facturaId, empresaId);
    if (estado === EstadoFactura.PAGADA) {
      this.generarPdfAsync(actualizada, empresaId);
    }
    return actualizada;
  }

  // ────────────────────────────────────────────────────────────
  // ANULAR
  // ────────────────────────────────────────────────────────────
  async anular(
    id: string, dto: AnularFacturaDto, user: JwtPayload, req?: any,
  ): Promise<{ factura: Factura; notaCredito?: Factura }> {
    const factura = await this.findOne(id, user.empresaId);

    if (factura.estado === EstadoFactura.ANULADA)
      throw new BadRequestException('La factura ya está anulada');
    if (factura.estado === EstadoFactura.PAGADA)
      throw new BadRequestException('No se puede anular una factura pagada. Emite una nota de crédito.');

    await this.facturaRepo.update(id, {
      estado: EstadoFactura.ANULADA, motivoAnulacion: dto.motivo,
      anuladaEn: new Date(), anuladaPor: user.sub,
    });

    const facturaAnulada = await this.findOne(id, user.empresaId);
    this.generarPdfAsync(facturaAnulada, user.empresaId);

    await this.auditoria.logUpdate({
      empresaId: user.empresaId, usuarioId: user.sub, usuarioEmail: user.email,
      modulo: 'facturacion', entidadId: id,
      descripcion: `${facturaAnulada.tipoComprobanteNombre} ${facturaAnulada.numeroCompleto} anulada: ${dto.motivo}`,
      req,
    });

    let notaCredito: Factura | undefined;
    if (dto.crearNotaCredito !== false) {
      notaCredito = await this.crearNotaCredito({ facturaOriginalId: id, motivo: dto.motivo }, user, req);
    }

    return { factura: facturaAnulada, notaCredito };
  }

  // ────────────────────────────────────────────────────────────
  // NOTA DE CRÉDITO
  // ────────────────────────────────────────────────────────────
  async crearNotaCredito(
    dto: CreateNotaCreditoDto, user: JwtPayload, req?: any,
  ): Promise<Factura> {
    const original = await this.findOne(dto.facturaOriginalId, user.empresaId);
    const configGlobal = await this.comprobantesSvc.getConfiguracion(user.empresaId);

    const montoAcreditar = dto.montoAcreditar ?? Number(original.total);
    const { subtotal, igv, total } = this.calcularMontosDesdeBase(
      montoAcreditar, 0, original.tieneCargaFiscal, Number(configGlobal.igvRate),
    );

    // Serie nota de crédito: 'NC-' + serie original
    const serieNc = `NC-${original.serie}`;
    // Advisory lock por empresa+serie para garantizar correlativos únicos
    // incluso bajo creación concurrente de notas de crédito.
    const [correlativoRow] = await this.ds.transaction(async manager => {
      await manager.query(
        `SELECT pg_advisory_xact_lock(hashtext($1))`,
        [`nc_correlativo_${user.empresaId}_${serieNc}`],
      );
      return manager.query<{ siguiente: string }[]>(`
        SELECT COALESCE(MAX(correlativo), 0) + 1 AS siguiente
        FROM facturas WHERE empresa_id = $1 AND serie = $2 AND deleted_at IS NULL
      `, [user.empresaId, serieNc]);
    });
    const correlativoNc = parseInt(correlativoRow.siguiente, 10);

    const nc = this.facturaRepo.create({
      empresaId:            user.empresaId,
      clienteId:            original.clienteId,
      contratoId:           original.contratoId,
      comprobanteConfigId:  original.comprobanteConfigId,
      tipoComprobante:      `nc_${original.tipoComprobante}`,
      tipoComprobanteNombre: `Nota de Crédito — ${original.tipoComprobanteNombre}`,
      tieneCargaFiscal:     original.tieneCargaFiscal,
      serie:                serieNc,
      correlativo:          correlativoNc,
      periodoInicio:        original.periodoInicio,
      periodoFin:           original.periodoFin,
      descripcion:          `Nota de crédito: ${dto.motivo} — Ref: ${original.numeroCompleto}`,
      subtotal, descuento: 0, igv, total, montoPagado: 0,
      items: [{
        descripcion:    `Anulación/rectificación de ${original.numeroCompleto}: ${dto.motivo}`,
        cantidad:       1, precioUnitario: subtotal, subtotal, tipoItem: 'servicio',
      }],
      estado:               EstadoFactura.EMITIDA,
      fechaEmision:         new Date().toISOString().split('T')[0],
      fechaVencimiento:     new Date().toISOString().split('T')[0],
      moneda:               original.moneda,
      facturaOriginalId:    original.id,
      generadaAutomaticamente: false,
      createdBy:            user.sub,
    });

    const saved = await this.facturaRepo.save(nc);
    this.generarPdfAsync(saved, user.empresaId);
    return saved;
  }

  // ────────────────────────────────────────────────────────────
  // CRUD / CONSULTAS
  // ────────────────────────────────────────────────────────────
  async findAll(empresaId: string, filters: FilterFacturaDto) {
    return formatPaginatedResponse(await this.facturaRepo.findAllPaginated(empresaId, filters));
  }

  async findOne(id: string, empresaId: string): Promise<Factura> {
    const f = await this.facturaRepo.findById(id, empresaId);
    if (!f) throw new NotFoundException(`Factura ${id} no encontrada`);
    return f;
  }

  async findByContrato(contratoId: string, empresaId: string) {
    return this.facturaRepo.findByContrato(contratoId, empresaId);
  }

  async findByCliente(clienteId: string, empresaId: string) {
    return this.facturaRepo.findByCliente(clienteId, empresaId);
  }

  async update(id: string, empresaId: string, dto: UpdateFacturaDto): Promise<Factura> {
    const factura = await this.findOne(id, empresaId);
    if (factura.estado === EstadoFactura.ANULADA)
      throw new BadRequestException('No se puede editar una factura anulada');

    const estadoConMontosBloqueados = [EstadoFactura.PAGADA, EstadoFactura.PAGADA_PARCIAL];
    if (dto.items !== undefined && estadoConMontosBloqueados.includes(factura.estado))
      throw new BadRequestException('No se pueden modificar los montos de una factura pagada');

    if (dto.version !== undefined && factura.version !== dto.version) {
      throw new ConflictException({
        code: 'CONCURRENCY_CONFLICT',
        message: 'Los datos fueron modificados por otro usuario. Por favor, recargue la página.',
      });
    }

    const patch: Partial<Factura> = {};
    if (dto.contratoId       !== undefined) patch.contratoId      = dto.contratoId;
    if (dto.periodoInicio    !== undefined) patch.periodoInicio    = dto.periodoInicio;
    if (dto.periodoFin       !== undefined) patch.periodoFin       = dto.periodoFin;
    if (dto.descripcion      !== undefined) patch.descripcion      = dto.descripcion;

    // El vencimiento NO se edita: se congela al emitir. Dos razones, y la segunda es la
    // grave.
    //
    // 1. Es el día de pago del abonado, y ese se cambia en su configuración —donde afecta
    //    a los comprobantes futuros—, no comprobante a comprobante.
    // 2. `cobranza.worker` decide el corte contra el `fecha_vencimiento` GRABADO en cada
    //    factura, precisamente para que un cambio de configuración no mueva una deuda ya
    //    notificada al abonado. Dejarlo editable aquí abría por detrás la puerta que ese
    //    invariante cierra por delante: mover el vencimiento de una factura viva
    //    adelanta o retrasa un corte de servicio sin que nadie lo vea venir.
    if (dto.fechaVencimiento !== undefined && dto.fechaVencimiento !== factura.fechaVencimiento) {
      throw new BadRequestException(
        'El vencimiento de un comprobante emitido no se modifica: es la fecha con la que ' +
        'se le notificó la deuda al abonado y contra la que se decide su corte. ' +
        'Para cambiar el ciclo, edita el día de pago en Facturación → Configuración.',
      );
    }

    if (dto.comprobanteConfigId !== undefined) {
      const cfg = await this.ds.getRepository(ComprobanteConfig).findOne({
        where: { id: dto.comprobanteConfigId, empresaId, deletedAt: null as any },
      });
      if (!cfg) throw new NotFoundException('Tipo de comprobante no encontrado');
      patch.comprobanteConfigId   = cfg.id;
      patch.tipoComprobante       = cfg.codigo;
      patch.tipoComprobanteNombre = cfg.nombre;
      patch.tieneCargaFiscal      = cfg.tieneCargaFiscal;
    }

    if (dto.items !== undefined) {
      const configGlobal = await this.comprobantesSvc.getConfiguracion(empresaId);
      const igvRate      = Number(configGlobal.igvRate);
      const aplicaIgv    = patch.tieneCargaFiscal ?? factura.tieneCargaFiscal;

      const mappedItems: ItemFactura[] = dto.items.map(it => {
        const base = it.cantidad * it.precioUnitario;
        const desc = it.descuento ?? 0;
        return {
          descripcion: it.descripcion, cantidad: it.cantidad,
          precioUnitario: it.precioUnitario, descuento: desc,
          subtotal: +(base - base * (desc / 100)).toFixed(2),
          tipoItem: 'servicio',
        };
      });
      const subtotal = mappedItems.reduce((acc, it) => acc + it.subtotal, 0);
      const igv      = aplicaIgv ? subtotal * igvRate : 0;
      patch.items    = mappedItems;
      patch.subtotal = +subtotal.toFixed(2);
      patch.igv      = +igv.toFixed(2);
      patch.total    = +(subtotal + igv).toFixed(2);
    }

    await this.facturaRepo.update(id, patch);
    return this.findOne(id, empresaId);
  }

  async remove(id: string, empresaId: string): Promise<void> {
    const factura = await this.findOne(id, empresaId);
    if (factura.estado === EstadoFactura.PAGADA)
      throw new BadRequestException('No se puede eliminar una factura pagada');
    await this.facturaRepo.delete(id);
  }

  async regenerarPdf(id: string, empresaId: string): Promise<Factura> {
    const factura = await this.findOne(id, empresaId);
    await this.generarPdfAsync(factura, empresaId);
    return this.findOne(id, empresaId);
  }

  async getResumenFinanciero(empresaId: string): Promise<ResumenFinancieroDto> {
    const raw = await this.facturaRepo.getResumenFinanciero(empresaId);
    const facturadoMes = parseFloat(raw.facturado_mes || '0');
    const cobradoMes   = parseFloat(raw.cobrado_mes   || '0');
    return {
      facturadoMes, cobradoMes,
      cobradoHoy:          parseFloat(raw.cobrado_hoy          || '0'),
      cobradoMesAnterior:  parseFloat(raw.cobrado_mes_anterior  || '0'),
      cuentasPorCobrar:    parseFloat(raw.cuentas_por_cobrar    || '0'),
      facturasVencidas:    parseInt(raw.facturas_vencidas        || '0', 10),
      totalEmitidas:       parseInt(raw.total_emitidas           || '0', 10),
      totalPagadas:        parseInt(raw.total_pagadas            || '0', 10),
      totalAnuladas:       parseInt(raw.total_anuladas           || '0', 10),
      tasaCobranza: facturadoMes > 0 ? Math.round((cobradoMes / facturadoMes) * 100) : 0,
    };
  }

  async getPendientesPorContrato(contratoId: string) {
    return this.facturaRepo.findPendientesPorContrato(contratoId);
  }

  // ────────────────────────────────────────────────────────────
  // HELPERS PRIVADOS
  // ────────────────────────────────────────────────────────────

  private async getComprobanteById(id: string, empresaId: string): Promise<ComprobanteConfig> {
    const config = await this.ds.getRepository(ComprobanteConfig).findOne({
      where: { id, empresaId, activo: true, deletedAt: null as any },
    });
    if (!config) throw new NotFoundException(`Tipo de comprobante ${id} no encontrado`);
    return config;
  }

  // Consume cargos pendientes (mora/reconexión) de un cliente
  // Retorna los items calculados + los IDs para marcar como incluidos post-save
  private async consumirCargosPendientes(
    clienteId: string,
    empresaId: string,
    igvRate: number,
  ): Promise<{ items: Array<ItemFactura & { igvItem: number; total: number }>; ids: string[] }> {
    const pendientes = await this.ds.getRepository(CargoPendiente).find({
      where: { clienteId, empresaId, incluidoEnFacturaId: null as any, deletedAt: null as any },
    });

    if (!pendientes.length) return { items: [], ids: [] };

    const items: Array<ItemFactura & { igvItem: number; total: number }> = [];
    const ids: string[] = [];

    for (const cargo of pendientes) {
      const { subtotal, igv: igvItem, total } = this.calcularMontosDesdeBase(
        cargo.monto, 0, cargo.aplicaIgv, igvRate,
      );
      items.push({
        // El texto por defecto se resuelve por tipo. Con un ternario, 'servicio' habría salido
        // rotulado como reconexión en la factura del abonado.
        descripcion:    cargo.descripcion ?? DESCRIPCION_CARGO[cargo.tipo] ?? 'Cargo',
        cantidad:       1,
        precioUnitario: subtotal,
        descuento:      0,
        subtotal,
        tipoItem:       cargo.tipo,
        aplicaIgvOverride: cargo.aplicaIgv,
        igvItem,
        total,
      });
      ids.push(cargo.id);
    }

    return { items, ids };
  }

  private async calcularMontos(
    dto: CreateFacturaDto,
    comprobante: ComprobanteConfig,
    igvRate: number,
  ): Promise<{ subtotal: number; descuento: number; igv: number; total: number; items: ItemFactura[] }> {
    const aplicaIgv = comprobante.tieneCargaFiscal;
    let subtotal = 0;
    let items: ItemFactura[] = [];

    if (dto.items?.length) {
      items = dto.items.map(item => {
        const sub = item.cantidad * item.precioUnitario - (item.descuento || 0);
        return { ...item, subtotal: Math.round(sub * 100) / 100, tipoItem: 'servicio' as const };
      });
      subtotal = items.reduce((acc, i) => acc + i.subtotal, 0);
    } else if (dto.subtotal !== undefined) {
      subtotal = dto.subtotal;
    } else {
      throw new BadRequestException('Debe proporcionar items o subtotal');
    }

    const descuento = dto.descuento || 0;
    return this.calcularMontosDesdeBase(subtotal, descuento, aplicaIgv, igvRate, items);
  }

  private calcularMontosDesdeBase(
    subtotal: number, descuento: number, aplicaIgv: boolean, igvRate: number,
    items: ItemFactura[] = [],
  ): { subtotal: number; descuento: number; igv: number; total: number; items: ItemFactura[] } {
    const baseImponible = Math.max(0, subtotal - descuento);
    const rate = Number(igvRate) || 0.18;
    const igv   = aplicaIgv ? Math.round(baseImponible * rate * 100) / 100 : 0;
    const total = Math.round((baseImponible + igv) * 100) / 100;
    return {
      subtotal: Math.round(subtotal  * 100) / 100,
      descuento: Math.round(descuento * 100) / 100,
      igv, total, items,
    };
  }

  private calcularFechaVencimiento(diasGracia: number): string {
    const fecha = new Date();
    fecha.setDate(fecha.getDate() + diasGracia);
    return fecha.toISOString().split('T')[0];
  }

  private ultimoDiaMes(anio: number, mes: number): string {
    const ultimo = new Date(anio, mes, 0).getDate();
    return `${anio}-${String(mes).padStart(2, '0')}-${ultimo}`;
  }

  // Línea de detalle de un servicio dentro del comprobante. Lleva el contrato porque en
  // un consolidado es lo único que identifica de forma inequívoca a qué servicio
  // corresponde el importe — dos servicios pueden tener el mismo plan.
  private descripcionItem(
    contrato: { numero_contrato?: string; plan_nombre?: string; direccion_instalacion?: string },
    mes: number,
    anio: number,
  ): string {
    const partes = [contrato.plan_nombre ?? 'Servicio de internet'];
    if (contrato.numero_contrato) partes.push(`Contrato ${contrato.numero_contrato}`);
    if (contrato.direccion_instalacion) partes.push(contrato.direccion_instalacion);
    return `${partes.join(' · ')} — ${this.mesNombre(mes)} ${anio}`;
  }

  // ── Descripción de un comprobante consolidado ────────────────────────────
  //
  // El comprobante se emite a nombre del CLIENTE, no del contrato: un abonado con dos
  // servicios recibe uno solo (por eso `contrato_id` va en null, es diseño, no un hueco).
  // La contrapartida es que "Servicios contratados" no le dice al cliente por qué paga
  // ese importe: no puede reconocer qué servicio corresponde a qué monto ni a qué
  // contrato, y esa es justo la pregunta que llega a soporte.
  //
  // Así que la descripción enumera cada servicio con su contrato y su importe. Un solo
  // servicio conserva la forma corta: repetir el contrato en una línea que ya es
  // inequívoca solo añade ruido.
  private descripcionConsolidada(
    nombreComprobante: string,
    grupo: Array<{ numero_contrato?: string; plan_nombre?: string; precio?: string }>,
    mes: number,
    anio: number,
    simbolo = 'S/',
  ): string {
    const periodo = `${this.mesNombre(mes)} ${anio}`;

    if (grupo.length === 1) {
      const c = grupo[0];
      const contrato = c.numero_contrato ? ` (${c.numero_contrato})` : '';
      return `${nombreComprobante} — ${c.plan_nombre ?? 'Servicio'}${contrato} · ${periodo}`;
    }

    const detalle = grupo
      .map((c) => {
        const contrato = c.numero_contrato ? `${c.numero_contrato}: ` : '';
        const monto = `${simbolo} ${Number(c.precio ?? 0).toFixed(2)}`;
        return `${contrato}${c.plan_nombre ?? 'Servicio'} ${monto}`;
      })
      .join(' | ');

    return `${nombreComprobante} — ${periodo} · ${detalle}`;
  }

  private mesNombre(mes: number): string {
    const nombres = ['','Enero','Febrero','Marzo','Abril','Mayo','Junio',
                     'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    return nombres[mes] || '';
  }

  private generarPdfAsync(
    factura: Factura, empresaId: string,
    empresaOverride?: Partial<EmpresaPdfData>,
    clienteOverride?: Partial<ClientePdfData>,
  ): void {
    this.ds.query(
      // `empresas.telefono` no existe: la columna es `telefono_informativo`. Sin el
      // alias la query fallaba entera y el PDF de la factura no se generaba.
      `SELECT em.razon_social, em.ruc, em.direccion_fiscal,
              em.telefono_informativo AS telefono, em.email,
              cl.nombre_completo, cl.tipo_documento, cl.numero_documento,
              cl.direccion, cl.email AS cl_email, cl.telefono AS cl_telefono,
              cl.es_empresa, cl.ruc_empresa, cl.razon_social AS cl_razon_social
       FROM facturas f
       JOIN empresas em ON em.id = f.empresa_id
       JOIN clientes cl ON cl.id = f.cliente_id
       WHERE f.id = $1`,
      [factura.id],
    ).then(([row]) => {
      if (!row) return;
      const empresa: EmpresaPdfData = {
        razonSocial:     empresaOverride?.razonSocial  || row.razon_social,
        ruc:             empresaOverride?.ruc           || row.ruc,
        direccionFiscal: empresaOverride?.direccionFiscal || row.direccion_fiscal,
        telefono:        row.telefono,
        email:           row.email,
      };
      const cliente: ClientePdfData = {
        nombreCompleto:  clienteOverride?.nombreCompleto  || row.nombre_completo,
        tipoDocumento:   clienteOverride?.tipoDocumento   || row.tipo_documento,
        numeroDocumento: clienteOverride?.numeroDocumento || row.numero_documento,
        direccion:       clienteOverride?.direccion       || row.direccion,
        email:           clienteOverride?.email           || row.cl_email,
        telefono:        clienteOverride?.telefono        || row.cl_telefono,
        esEmpresa:       row.es_empresa,
        rucEmpresa:      row.ruc_empresa,
        razonSocial:     row.cl_razon_social,
      };
      return this.pdfSvc.generarFacturaPdf(factura, empresa, cliente);
    })
    .then(pdfUrl => {
      if (pdfUrl) {
        return this.facturaRepo.update(factura.id, { pdfUrl, pdfGeneradoEn: new Date() });
      }
    })
    .catch(err => this.logger.error(`Error generando PDF para factura ${factura.id}: ${err.message}`));
  }
}
