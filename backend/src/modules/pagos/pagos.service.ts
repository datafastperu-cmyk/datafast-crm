import {
  Injectable, Logger, NotFoundException,
  ConflictException, BadRequestException,
  ForbiddenException, UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { PagoRepository }       from './repositories/pago.repository';
import { MercadoPagoService }   from './mercadopago.service';
import { FacturacionService }   from '../facturacion/facturacion.service';
import { DeudaPorContratoService } from '../facturacion/deuda-por-contrato.service';
import { ContratosService }     from '../contratos/contratos.service';
import { AuditoriaService }     from '../auth/auditoria.service';
import { JwtPayload }           from '../../common/decorators/current-user.decorator';

import { Pago, EstadoPago, CuentaBancaria } from './entities/pago.entity';
import { PagoAplicacion } from './entities/pago-aplicacion.entity';
import { AdelantosService } from './adelantos.service';
import { CanalPagoService } from './canal-pago.service';
import { AplicadorFacturaService } from '../facturacion/aplicador-factura.service';
import { Contrato, EstadoContrato } from '../contratos/entities/contrato.entity';
import { Factura, EstadoFactura }   from '../facturacion/entities/factura.entity';
import { RegistrarPagoDto, ExtornarPagoDto } from './dto/registrar-pago.dto';
import { filasUpdateReturning } from '../../common/utils/pg-result.util';
import {
  VerificarPagoDto, ConciliarPagoDto, ActualizarPagoDto,
  FilterPagoDto, CrearPreferenciaDto,
  CreateCuentaBancariaDto, ResumenCobranzaDto,
} from './dto/pago.dto';
import { QUEUES, JOBS, PayloadReactivarContrato } from '../workers/workers.constants';
import { Cron } from '@nestjs/schedule';
import { formatPaginatedResponse } from '../../common/utils/pagination.util';
import { WatcherHeartbeatService } from '../../common/services/watcher-heartbeat.service';
import { sqlDeudaExigible } from '../facturacion/domain/estados-con-saldo';

@Injectable()
export class PagosService {
  private readonly logger = new Logger(PagosService.name);

  constructor(
    private readonly pagoRepo:     PagoRepository,
    private readonly mpSvc:        MercadoPagoService,
    private readonly facturacionSvc: FacturacionService,
    private readonly deudaSvc:     DeudaPorContratoService,
    private readonly contratosSvc: ContratosService,
    private readonly auditoria:    AuditoriaService,
    private readonly config:       ConfigService,
    private readonly events:       EventEmitter2,
    @InjectDataSource() private readonly ds: DataSource,
    private readonly heartbeat: WatcherHeartbeatService,
    private readonly adelantosSvc: AdelantosService,
    private readonly canalSvc:     CanalPagoService,
    private readonly aplicador:    AplicadorFacturaService,
    @InjectQueue(QUEUES.COBRANZA) private readonly cobranzaQueue: Queue,
  ) {}

  // ────────────────────────────────────────────────────────────
  // REGISTRAR PAGO — Fase 2: Transacción ACID completa
  // 1. Idempotencia por (empresaId, numeroOperacion)
  // 2. Validar factura + cargar contrato asociado
  // 3. Normalizar casing DTO→entity + determinar auto-verificación
  // 4. Persistir pago, actualizar factura y contrato dentro de la TX
  // 5. Encolar job de reactivación fuera de la TX (post-commit)
  // ────────────────────────────────────────────────────────────
  async registrar(
    dto:  RegistrarPagoDto,
    user: JwtPayload,
    req?: any,
  ): Promise<Pago> {
    // Siempre usar la empresa del JWT — nunca confiar en el body para esto
    const empresaId = user.empresaId;
    const contratosParaReactivar: Contrato[] = [];
    const contratosEnProrroga:    string[]   = [];

    // ── TRANSACCIÓN ACID ──────────────────────────────────────
    const savedPago = await this.ds.transaction(async (manager) => {

      // PASO 1 — Idempotencia por número de operación.
      // La comprobación NO incluye el método de pago: un código de operación no se repite
      // aunque uno sea Yape y otro transferencia. Un consolidado no necesita excepción a
      // esta regla porque es UN pago —una fila— aplicado a varios comprobantes.
      // PASO 0 — Idempotencia por clave de request.
      //
      // Cierra el hueco del efectivo: un cobro en efectivo no tiene número de operación,
      // así que hasta F5 nada impedía que un doble clic —o un reintento del navegador con
      // la red lenta— creara dos filas de S/ 85 para el mismo abonado.
      //
      // Reenviar NO es un error del cajero: es la red o el ratón. Se devuelve el pago que
      // ya existe con éxito, en vez de un rechazo que empujaría a registrar otro a mano.
      if (dto.idempotencyKey) {
        const yaRegistrado = await manager.findOne(Pago, {
          where: { empresaId, idempotencyKey: dto.idempotencyKey },
        });
        if (yaRegistrado) {
          this.logger.warn(
            `[PAGO] Reenvío detectado (idempotencyKey ${dto.idempotencyKey}) — se devuelve ` +
            `el pago ${yaRegistrado.id} en vez de crear un duplicado.`,
          );
          return yaRegistrado;
        }
      }

      const duplicado = dto.numeroOperacion
        ? await manager.findOne(Pago, {
            where: { empresaId, numeroOperacion: dto.numeroOperacion },
          })
        : null;
      if (duplicado) {
        throw new ConflictException(
          `Ya existe un pago con el número de operación '${dto.numeroOperacion}' ` +
          `(${duplicado.metodoPago}). ID existente: ${duplicado.id}`,
        );
      }

      // PASO 2 — Validar comprobante(s) y cargar contrato
      const idsSolicitados = dto.facturaIds?.length
        ? [...new Set(dto.facturaIds)]
        : (dto.facturaId ? [dto.facturaId] : []);

      // ── ADELANTO: pago sin comprobante ──────────────────────
      // Dinero cobrado que aún no pertenece a ninguna factura. Se guarda como pago sin
      // imputar y el saldo a favor se DERIVA de ahí (ver AdelantosService). Se consume
      // solo al emitir el siguiente comprobante.
      if (!idsSolicitados.length) {
        if (!dto.esAdelanto) {
          throw new BadRequestException(
            'Indica el comprobante a pagar, o marca el cobro como adelanto',
          );
        }
        if (!dto.clienteId) {
          throw new BadRequestException('Un adelanto necesita el cliente al que pertenece');
        }
        // Un adelanto no puede convivir con deuda: entregar dinero con comprobantes
        // impagos no es adelantar, es pagar. Registrarlo como adelanto dejaría al abonado
        // con saldo a favor y en mora a la vez, y el cron lo cortaría con su dinero en caja.
        await this.adelantosSvc.assertSinDeuda(dto.clienteId, empresaId);

        return this.registrarAdelanto(manager, dto, user, empresaId);
      }

      const facturas = await manager.find(Factura, {
        where: idsSolicitados.map((id) => ({ id, empresaId })),
        order: { fechaVencimiento: 'ASC' },
      });

      const faltante = idsSolicitados.find((id) => !facturas.some((f) => f.id === id));
      if (faltante) throw new NotFoundException(`Factura ${faltante} no encontrada`);

      const yaPagada = facturas.find((f) => f.estado === EstadoFactura.PAGADA);
      if (yaPagada) {
        throw new BadRequestException(
          facturas.length === 1
            ? 'La factura ya está completamente pagada'
            : `El comprobante ${yaPagada.numeroCompleto ?? yaPagada.id} ya está pagado — actualiza la lista de deudas`,
        );
      }
      const anulada = facturas.find((f) => f.estado === EstadoFactura.ANULADA);
      if (anulada) {
        throw new BadRequestException(
          `El comprobante ${anulada.numeroCompleto ?? anulada.id} está anulado`,
        );
      }

      // Un pago pertenece a UN abonado: mezclar clientes haría imposible imputar la deuda
      // y reactivaría contratos ajenos.
      const clientesDistintos = new Set(facturas.map((f) => f.clienteId));
      if (clientesDistintos.size > 1) {
        throw new BadRequestException(
          'Un mismo pago no puede saldar comprobantes de clientes distintos',
        );
      }

      // Saldo pendiente de cada comprobante, con el mismo criterio que el resto del
      // módulo: `saldo` si existe, y si no, total − pagado.
      const saldoDe = (f: Factura): number => Number(
        (Number(f.saldo ?? (Number(f.total) - Number(f.montoPagado)))).toFixed(2),
      );
      const saldoTotal = Number(
        facturas.reduce((s, f) => s + saldoDe(f), 0).toFixed(2),
      );

      // El consolidado es TODO O NADA. Con un importe menor habría que repartirlo entre
      // comprobantes con un criterio que nadie decidió; para pagar de menos está el pago
      // individual del más antiguo, que sí admite parcial.
      if (facturas.length > 1 && Math.abs(dto.monto - saldoTotal) > 0.01) {
        throw new BadRequestException(
          `Un pago consolidado debe cubrir el total de los ${facturas.length} comprobantes ` +
          `(S/ ${saldoTotal.toFixed(2)}). Recibido: S/ ${dto.monto.toFixed(2)}. ` +
          `Para un importe menor, registra el pago del comprobante más antiguo.`,
        );
      }

      // El más antiguo representa al pago cuando se necesita un único comprobante
      // (contrato asociado, PDF, histórico).
      const factura = facturas[0];

      let contrato: Contrato | null = null;
      if (factura.servicioId) {
        contrato = await manager.findOne(Contrato, {
          where: { id: factura.servicioId },
        });
      }
      // Fallback para facturas CONSOLIDADAS (contrato_id nulo, el caso normal cuando un
      // cliente tiene varios servicios en un solo comprobante).
      //
      // Incidente 2026-08-04, reproducido en producción con CNT-2026-000007: aquí solo se
      // buscaba `SUSPENDIDO`. Pero otorgar una prórroga devuelve el contrato a `ACTIVO`
      // —correcto, la prórroga ES permiso para seguir navegando— y la rama que cancela la
      // prórroga exige `ACTIVO && enProrroga`. Las dos condiciones no se cruzaban jamás:
      // el contrato quedaba en `null`, no se cancelaba la promesa ni se sacaba la IP de
      // `prorroga_datafast`, y el cron de vencidas cortaba días después a un cliente que
      // ya había pagado.
      //
      // Mismo agujero, otro sabor: un contrato `cortado` o `moroso` pagando una factura
      // consolidada tampoco se encontraba, así que tampoco se reactivaba.
      if (!contrato && factura.clienteId) {
        // Prioridad a los que están sin servicio: es lo urgente.
        contrato = await manager.findOne(Contrato, {
          where: [EstadoContrato.SUSPENDIDO]
            .map((estado) => ({ clienteId: factura.clienteId, empresaId, estado })),
          order: { fechaEstado: 'DESC' },
        });
        // Si ninguno está bloqueado, puede haber uno con el servicio activo por una
        // prórroga que este pago acaba de saldar.
        if (!contrato) {
          contrato = await manager.findOne(Contrato, {
            where: {
              clienteId: factura.clienteId, empresaId,
              estado: EstadoContrato.ACTIVO, enProrroga: true,
            },
            order: { fechaEstado: 'DESC' },
          });
        }
      }

      // PASO 3 — Determinar estado inicial del pago
      //
      // La fecha del cobro se calcula UNA vez y se usa tanto en la fila del pago como al
      // volcar sobre los comprobantes. Antes el volcado inline escribía `CURRENT_DATE` y
      // el pago guardaba `dto.fechaPago`: un cobro registrado con fecha de ayer dejaba la
      // factura diciendo que se pagó hoy.
      const fechaPagoEfectiva = dto.fechaPago ?? new Date().toISOString().split('T')[0];
      const autoVerificado = this.esAutoVerificado(dto, user);
      const estadoInicial  = autoVerificado ? EstadoPago.VERIFICADO : EstadoPago.PENDIENTE_VERIFICACION;

      // ── Los tres ejes: forma, canal y cuenta receptora ──────────────────────
      // Si el formulario ya manda el canal, manda el canal. Si no —los dos formularios
      // vivos todavía envían `metodoPago` + `banco`—, se resuelve por compatibilidad.
      // No se rechaza el cobro si no se reconoce: un pago sin clasificar es mejor que un
      // abonado que no puede pagar porque el ERP no supo etiquetar su método.
      const canal = dto.canalPagoId
        ? await this.canalSvc.porId(dto.canalPagoId, empresaId, manager)
        : await this.canalSvc.resolverDesdeLegacy(empresaId, dto.metodoPago, dto.banco, manager);

      // La cuenta explícita gana sobre la del canal: el operador con permiso puede
      // corregirla en el mostrador (un cobro de campo que acaba en la caja de oficina).
      const cuentaReceptoraId = dto.cuentaReceptoraId ?? canal?.cuentaReceptoraDefaultId ?? null;

      // `monto` es el BRUTO y es lo único que salda la factura. El neto es lo que llega a
      // la cuenta, y por tanto lo que hay que buscar en el extracto al conciliar.
      const { comision, neto } = this.canalSvc.calcularComision(canal, dto.monto);

      const pago = manager.create(Pago, {
        empresaId,
        clienteId:       factura.clienteId,
        // En un consolidado apunta al comprobante más antiguo: el reparto completo vive en
        // `pago_aplicaciones`, esta columna es la referencia principal para el histórico.
        facturaId:       factura.id,
        // BUG CORREGIDO 2026-08-18 (commit b793cfcf): la fase 4.1 (commit 3c94c55b) había
        // renombrado esta clave a `servicioId` cuando `Pago` todavía no tenía esa
        // propiedad -- create() la descartaba en silencio. Ola 2, Paso B le dio nombre
        // real a la columna: ahora sí existe `Pago.servicioId`.
        servicioId:      factura.servicioId ?? null,
        monto:           dto.monto,
        moneda:          'PEN',
        // Modelo antiguo: se sigue escribiendo. El histórico se lee tal como se registró,
        // y conservarlo es lo que hace reversible la migración de catálogos.
        metodoPago:      dto.metodoPago,
        banco:           dto.banco ?? null,
        // Modelo vivo.
        idempotencyKey:  dto.idempotencyKey ?? null,
        canalPagoId:       canal?.id ?? null,
        cuentaReceptoraId,
        comision,
        montoNeto:         neto,
        numeroOperacion: dto.numeroOperacion ?? null,
        fechaPago:       fechaPagoEfectiva,
        estado:          estadoInicial,
        cajeroId:        user.sub,
        verificadoPor:   autoVerificado ? user.sub : null,
        verificadoEn:    autoVerificado ? new Date() : null,
        comprobanteUrl: dto.voucherUrl ?? null,
        // Se guarda en la fila porque la reactivación puede ocurrir mucho después, al
        // verificar el pago: quien lo apruebe días más tarde tiene que saber qué se
        // decidió en el mostrador.
        reactivarServicio: dto.reactivarServicio !== false,
        // Metadatos Yape en mpDetail hasta que se añadan columnas dedicadas
        mpDetail: (dto.celularYape || dto.otpYape)
          ? { celularYape: dto.celularYape ?? null, otpYape: dto.otpYape ?? null }
          : null,
      });

      const saved = await manager.save(Pago, pago);

      // Reparto: en un consolidado cada comprobante recibe su saldo íntegro (por eso es
      // todo o nada). Con uno solo, lo que el cajero haya cobrado — que puede ser parcial.
      const imputaciones = facturas.length > 1
        ? facturas.map((f) => ({ factura: f, monto: saldoDe(f) }))
        : [{ factura, monto: dto.monto }];

      // La imputación se registra SIEMPRE —también si el pago queda pendiente de
      // verificación y también con un solo comprobante—, porque es la DECLARACIÓN de qué
      // comprobantes cubre este dinero. El efecto sobre las facturas es otra cosa y ocurre
      // al verificar. Sin esto, aprobar un consolidado pendiente aplicaría el importe
      // entero al primer comprobante y dejaría el resto impago.
      for (const { factura: f, monto } of imputaciones) {
        await manager.insert(PagoAplicacion, {
          empresaId,
          pagoId:        saved.id,
          facturaId:     f.id,
          montoAplicado: monto,
        });
      }

      // PASO 4 — Si auto-verificado: actualizar comprobantes y contrato dentro de la TX
      if (autoVerificado) {
        const facturasVolcadas: string[] = [];
        for (const { factura: f, monto } of imputaciones) {
          // El aplicador es UNO SOLO (`FacturacionService.aplicarPago`) y vive en el
          // módulo dueño de la factura. Aquí había una copia del mismo UPDATE, y ese es
          // el problema de fondo: cada copia envejece por su lado y nadie puede afirmar
          // qué mueve el saldo de un comprobante. La copia de `adelantos` había perdido ya
          // el guard de estado, así que aplicaba saldo a favor a facturas anuladas.
          //
          // Se le pasa el `manager` para que el volcado siga dentro de ESTA transacción:
          // si un comprobante del consolidado no admite su parte, se deshace el pago
          // entero. Un consolidado a medias dejaría dinero cobrado sin imputar y al
          // abonado creyendo que pagó todo.
          try {
            await this.aplicador.aplicar(f.id, monto, empresaId, fechaPagoEfectiva, manager);
          } catch (err: any) {
            throw new BadRequestException(
              `No se pudo aplicar el pago a ${f.numeroCompleto ?? f.id}: ${err.message}`,
            );
          }
          facturasVolcadas.push(f.id);
        }

        // El dinero ya está en los comprobantes: marcarlo aquí, en la MISMA transacción que
        // lo volcó, es lo que impide que estos dos hechos se separen.
        //
        // Este camino —el auto-verificado, que es el normal en caja— aplicaba el dinero sin
        // dejar constancia: `aplicado_en` solo se escribía en `aplicarPagoAFacturaYContrato`,
        // que es el camino de `verificar()`. Resultado medido en producción: el 100% de los
        // pagos nacía marcado como trabajo pendiente y lo seguía estando para siempre, con
        // el reconciliador reintentándolos en bucle (F0, 2026-08-06).
        await manager.query(
          `UPDATE pago_aplicaciones SET aplicado_en = NOW()
            WHERE pago_id = $1 AND factura_id = ANY($2::uuid[])`,
          [saved.id, facturasVolcadas],
        );
        saved.aplicadoEn = new Date();
        await manager.update(Pago, saved.id, { aplicadoEn: saved.aplicadoEn });

        // Marcar para reactivación vía worker (el worker hace el UPDATE completo:
        // deuda_total=0, meses_deuda=0, en_prorroga=false, fecha_vencimiento, historial).
        // Solo encolar si la deuda total quedó en cero tras este pago.
        // Cubre facturas con contrato_id directo y las sin vínculo (por cliente_id).
        //
        // `reactivarServicio: false` ("Solo registrar") se salta todo esto: es la baja
        // voluntaria que salda su último comprobante. Sin esta salida, saldar la deuda le
        // devolvía el servicio a un abonado que se está yendo.
        const estadosReactivables = [EstadoContrato.SUSPENDIDO];
        if (dto.reactivarServicio === false) {
          this.logger.log(
            `[PAGO] Cobro sin reactivación (Solo registrar) — contrato ${contrato?.id ?? 'sin contrato'} ` +
            `queda en ${contrato?.estado ?? 'n/a'} por decisión del operador`,
          );
        } else if (contrato && estadosReactivables.includes(contrato.estado)) {
          // H-7 (2026-08-09): la reactivación mira la deuda VENCIDA, no la total. Antes esta
          // consulta sumaba `sqlDeudaExigible` sin filtro de fecha, así que una factura emitida y
          // aún no vencida impedía devolver el servicio a quien acababa de pagar lo que debía.
          // No se notaba porque H-6 lo tapaba: a un suspendido no se le facturaba nada.
          const { monto: deudaVencida } = await this.deudaSvc.vencidaQueBloquea(
            contrato.id, factura.clienteId, manager,
          );
          if (deudaVencida <= 0) {
            if (factura.servicioId) {
              // Factura vinculada a un contrato específico → solo ese
              contratosParaReactivar.push(contrato);
            } else {
              // Factura unificada (contrato_id null) → reactivar TODOS los contratos bloqueados
              const todos = await manager.find(Contrato, {
                where: [
                  { clienteId: factura.clienteId, empresaId, estado: EstadoContrato.SUSPENDIDO },
                ],
              });
              contratosParaReactivar.push(...todos);
            }
          }
        } else if (contrato && contrato.estado === EstadoContrato.ACTIVO && contrato.enProrroga) {
          // Contrato activo en prórroga: si la deuda queda en cero al pagar, marcar promesa cumplida
          // y limpiar address-list prorroga en MikroTik. No reprovisionamos porque el servicio ya está activo.
          // H-7: la promesa se cumple saldando lo VENCIDO. Medirlo con la deuda total dejaba
          // la promesa sin cumplir —y el address-list de prórroga puesto— por un comprobante
          // que todavía no había vencido.
          const prorrogaSaldada = await this.deudaSvc.vencidaQueBloquea(
            contrato.id, factura.clienteId, manager,
          );
          if (prorrogaSaldada.monto <= 0) {
            if (factura.servicioId) {
              contratosEnProrroga.push(contrato.id);
            } else {
              // Consolidada: el pago salda la deuda de TODO el cliente, así que cancela
              // todas sus prórrogas. Simétrico a `contratosParaReactivar` de más arriba;
              // sin esto, un cliente con dos servicios en prórroga solo veía limpiarse uno
              // y el otro lo cortaba el cron días después.
              const enProrroga = await manager.find(Contrato, {
                where: {
                  clienteId: factura.clienteId, empresaId,
                  estado: EstadoContrato.ACTIVO, enProrroga: true,
                },
              });
              contratosEnProrroga.push(...enProrroga.map((c) => c.id));
            }
          }
        } else if (contrato && contrato.estado === EstadoContrato.PENDIENTE_ACTIVACION) {
          this.logger.warn(
            `[PAGO] Contrato ${contrato.id} en pendiente_activacion — pago S/${dto.monto} registrado, requiere activación manual`,
          );
        } else if (contrato && contrato.estado === EstadoContrato.BAJA_DEFINITIVA) {
          this.logger.warn(
            `[PAGO] Contrato ${contrato.id} en baja_definitiva — pago S/${dto.monto} registrado como solo registro contable`,
          );
        }
      }

      return saved;
    });
    // ── FIN TRANSACCIÓN ───────────────────────────────────────

    // Un pago cambia el saldo de las facturas, y `contratos.deuda_total` es una
    // proyección de esos saldos: hay que refrescarla o el ERP y el portal muestran una
    // deuda que el abonado ya pagó. Fuera de la transacción a propósito — el pago está
    // registrado y no puede deshacerse por no poder actualizar una caché.
    if (savedPago?.clienteId) {
      await this.deudaSvc.recalcularPorCliente(savedPago.clienteId, empresaId);
    }

    // PASO 5 — Encolar jobs de MikroTik fuera de la TX (solo si commit fue exitoso)
    for (const c of contratosParaReactivar) {
      const payload: PayloadReactivarContrato = {
        contratoId: c.id,
        empresaId:  c.empresaId,
        clienteId:  c.clienteId,
        routerId:   c.routerId,
        ipAsignada: c.ipAsignada,
        planNombre: c.planId, // resuelto en el worker
        notificar:  true,
      };
      await this.cobranzaQueue.add(JOBS.REACTIVAR_CONTRATO, payload, {
        jobId:    `reactivar:${c.id}`, // deduplicación: evita doble provisioning MikroTik
        attempts: 3,
        backoff:  { type: 'exponential', delay: 10_000 },
        removeOnComplete: 200,
        removeOnFail:     500,
      });
      this.logger.log(`Job reactivar-contrato encolado para contrato ${c.id}`);
    }

    // Contratos activos en prórroga que saldaron su deuda: cumplir promesa + limpiar MikroTik
    for (const contratoId of contratosEnProrroga) {
      this.verificarYReactivarContrato(contratoId, empresaId, user, savedPago.id)
        .catch((err: any) =>
          this.logger.error(
            `[PAGO] Error al cumplir promesa de contrato en prorroga ${contratoId}: ${err.message}`,
          ),
        );
    }

    // Auditoría
    await this.auditoria.logCreate({
      empresaId,
      usuarioId:    user.sub,
      usuarioEmail: user.email,
      modulo:       'pagos',
      entidadId:    savedPago.id,
      // El detalle de qué se cobró y si se decidió NO devolver el servicio: sin esto,
      // mañana nadie sabe por qué un abonado sin deuda sigue cortado.
      descripcion:
        `Pago ${dto.metodoPago} S/ ${dto.monto} | ` +
        (dto.esAdelanto
          ? 'ADELANTO (sin comprobante)'
          : `comprobantes: ${(dto.facturaIds?.length ? dto.facturaIds : [dto.facturaId]).join(', ')}`) +
        ` | ${savedPago.estado}` +
        (dto.reactivarServicio === false ? ' | SIN reactivar servicio (Solo registrar)' : ''),
      req,
    });

    // ── Emitir evento de notificación si el pago fue auto-verificado ─
    if (savedPago.estado === EstadoPago.VERIFICADO) {
      this.emitirEventoPagoRecibido(savedPago);
    }

    this.logger.log(
      `Pago registrado: ${savedPago.id} | ${dto.metodoPago} | S/ ${dto.monto} | ${savedPago.estado}`,
    );

    return savedPago;
  }

  /**
   * Auto-verificado si: MercadoPago (confirmación automática), Yape con OTP, o el cajero
   * marca `autoVerificar` teniendo permiso (pagos presenciales inmediatos).
   */
  private esAutoVerificado(dto: RegistrarPagoDto, user: JwtPayload): boolean {
    const metodoLower  = dto.metodoPago?.toLowerCase() ?? '';
    const esYapeConOtp = metodoLower === 'yape' && !!dto.otpYape;
    const puedeAutoverificar = user.roles.includes('Administrador')
                            || user.permisos.includes('pagos:autoverificar');
    return metodoLower === 'mercadopago'
        || esYapeConOtp
        || (dto.autoVerificar === true && puedeAutoverificar);
  }

  /**
   * Adelanto: cobro sin comprobante asignado.
   *
   * Se guarda como un pago con `factura_id` NULL y SIN aplicaciones — eso es exactamente
   * lo que significa "dinero que todavía no pertenece a ninguna factura". El saldo a favor
   * se deriva de ahí y se consume al emitir el siguiente comprobante
   * (`AdelantosService.aplicarSaldoAFactura`), sin contadores que mantener.
   */
  private async registrarAdelanto(
    manager: EntityManager,
    dto: RegistrarPagoDto,
    user: JwtPayload,
    empresaId: string,
  ): Promise<Pago> {
    const autoVerificado = this.esAutoVerificado(dto, user);

    // Un adelanto es dinero que entró igual que cualquier otro: tiene canal y tiene cuenta
    // receptora. Omitirlos aquí lo dejaría fuera del arqueo de caja, que es justo donde
    // más se nota un cobro sin imputar.
    const canal = dto.canalPagoId
      ? await this.canalSvc.porId(dto.canalPagoId, empresaId, manager)
      : await this.canalSvc.resolverDesdeLegacy(empresaId, dto.metodoPago, dto.banco, manager);
    const { comision, neto } = this.canalSvc.calcularComision(canal, dto.monto);

    const pago = manager.create(Pago, {
      empresaId,
      clienteId:       dto.clienteId!,
      facturaId:       null,
      servicioId:      null,
      monto:           dto.monto,
      moneda:          'PEN',
      metodoPago:      dto.metodoPago,
      banco:           dto.banco ?? null,
      canalPagoId:       canal?.id ?? null,
      cuentaReceptoraId: dto.cuentaReceptoraId ?? canal?.cuentaReceptoraDefaultId ?? null,
      comision,
      montoNeto:         neto,
      numeroOperacion: dto.numeroOperacion ?? null,
      fechaPago:       dto.fechaPago ?? new Date().toISOString().split('T')[0],
      estado:          autoVerificado ? EstadoPago.VERIFICADO : EstadoPago.PENDIENTE_VERIFICACION,
      cajeroId:        user.sub,
      verificadoPor:   autoVerificado ? user.sub : null,
      verificadoEn:    autoVerificado ? new Date() : null,
      // Un adelanto verificado YA surtió efecto: el dinero está en caja y el saldo a favor
      // se deriva de esta fila. No hay nada que aplicar después. Sin esto entraría en la
      // cola del reconciliador y se quedaría ahí dando vueltas sin trabajo que hacer.
      aplicadoEn:      autoVerificado ? new Date() : null,
      comprobanteUrl:  dto.voucherUrl ?? null,
      notas:           dto.notas ?? 'Adelanto de pago',
      mpDetail: (dto.celularYape || dto.otpYape)
        ? { celularYape: dto.celularYape ?? null, otpYape: dto.otpYape ?? null }
        : null,
    });

    const saved = await manager.save(Pago, pago);
    this.logger.log(
      `Adelanto registrado: ${saved.id} | cliente ${dto.clienteId} | S/ ${dto.monto} | ${saved.estado}`,
    );
    return saved;
  }

  // ────────────────────────────────────────────────────────────
  // VERIFICAR / APROBAR PAGO
  // El cajero/supervisor revisa el voucher y aprueba o rechaza.
  // Si aprueba → aplicar pago a la factura + trigger reactivación.
  // ────────────────────────────────────────────────────────────
  async verificar(
    id:   string,
    dto:  VerificarPagoDto,
    user: JwtPayload,
    req?: any,
  ): Promise<Pago> {
    const pago = await this.findOne(id, user.empresaId);

    if (pago.estado !== EstadoPago.PENDIENTE_VERIFICACION) {
      throw new BadRequestException(
        `El pago ya fue ${pago.estado === EstadoPago.VERIFICADO ? 'verificado' : pago.estado}`,
      );
    }

    if (dto.aprobado) {
      // ── APROBAR ──────────────────────────────────────────
      await this.pagoRepo.update(id, {
        estado:          EstadoPago.VERIFICADO,
        verificadoPor:   user.sub,
        verificadoEn:    new Date(),
        extractoBancoRef: dto.extractoBancoRef,
      });

      const pagoVerificado = await this.findOne(id, user.empresaId);
      await this.aplicarPagoAFacturaYContrato(pagoVerificado, user);

      await this.auditoria.logUpdate({
        empresaId: user.empresaId, usuarioId: user.sub, usuarioEmail: user.email,
        modulo: 'pagos', entidadId: id,
        descripcion: `Pago verificado/aprobado S/ ${pago.monto} | ${pago.metodoPago}`, req,
      });

      this.logger.log(`Pago aprobado: ${id} | S/ ${pago.monto} | por: ${user.email}`);

      // Emitir notificación de pago recibido
      this.emitirEventoPagoRecibido(pagoVerificado);

      return pagoVerificado;

    } else {
      // ── RECHAZAR ─────────────────────────────────────────
      if (!dto.motivoRechazo?.trim()) {
        throw new BadRequestException('Debes indicar el motivo del rechazo');
      }

      await this.pagoRepo.update(id, {
        estado:        EstadoPago.RECHAZADO,
        motivoRechazo: dto.motivoRechazo,
        verificadoPor: user.sub,
        verificadoEn:  new Date(),
      });

      this.logger.log(`Pago rechazado: ${id} | motivo: ${dto.motivoRechazo} | por: ${user.email}`);

      await this.auditoria.logUpdate({
        empresaId: user.empresaId, usuarioId: user.sub, usuarioEmail: user.email,
        modulo: 'pagos', entidadId: id,
        descripcion: `Pago rechazado: ${dto.motivoRechazo}`, req,
      });

      return this.findOne(id, user.empresaId);
    }
  }

  // ────────────────────────────────────────────────────────────
  // CONCILIAR PAGO
  // Marcar un pago como conciliado con el extracto bancario.
  // ────────────────────────────────────────────────────────────
  async conciliar(
    id:   string,
    dto:  ConciliarPagoDto,
    user: JwtPayload,
    req?: any,
  ): Promise<Pago> {
    const pago = await this.findOne(id, user.empresaId);

    if (pago.estado !== EstadoPago.VERIFICADO) {
      throw new BadRequestException('Solo se pueden conciliar pagos verificados');
    }
    if (pago.conciliado) {
      throw new BadRequestException('El pago ya está conciliado');
    }

    await this.pagoRepo.update(id, {
      conciliado:      true,
      conciliadoEn:    new Date(),
      conciliadoPor:   user.sub,
      extractoBancoRef: dto.extractoBancoRef,
      notas:           dto.notas ? `${pago.notas || ''}\n[Conciliación]: ${dto.notas}`.trim() : pago.notas,
    });

    return this.findOne(id, user.empresaId);
  }

  // ────────────────────────────────────────────────────────────
  // WEBHOOK MERCADOPAGO
  // MercadoPago notifica cuando un pago es procesado.
  // Verificamos la firma, consultamos el pago, y lo procesamos.
  // ────────────────────────────────────────────────────────────
  async procesarWebhookMercadoPago(
    body:       any,
    rawBody:    Buffer,
    xSignature: string,
    xRequestId: string,
  ): Promise<void> {

    // ── 1. Validar firma ───────────────────────────────────
    const firmaValida = this.mpSvc.validarWebhookSignature(rawBody, xSignature, xRequestId);
    if (!firmaValida) {
      this.logger.warn(`Webhook MP rechazado: firma inválida | requestId: ${xRequestId}`);
      throw new ForbiddenException('Firma de webhook inválida');
    }

    // Solo procesar notificaciones de pagos
    if (body.type !== 'payment') {
      this.logger.debug(`Webhook MP ignorado: tipo=${body.type}`);
      return;
    }

    const mpPaymentId = String(body.data?.id);
    if (!mpPaymentId) {
      this.logger.warn('Webhook MP sin payment ID');
      return;
    }

    this.logger.log(`Webhook MP recibido: payment ${mpPaymentId} | acción: ${body.action}`);

    // ── 2. Verificar si ya procesamos este pago ────────────
    const pagoExistente = await this.pagoRepo.findByMpPaymentId(mpPaymentId);
    if (pagoExistente?.estado === EstadoPago.VERIFICADO) {
      this.logger.debug(`Webhook MP: pago ${mpPaymentId} ya procesado`);
      return;
    }

    // ── 3. Consultar detalles en la API de MP ──────────────
    let mpPayment: any;
    try {
      mpPayment = await this.mpSvc.consultarPago(mpPaymentId);
    } catch (err) {
      this.logger.error(`Error consultando pago MP ${mpPaymentId}: ${err.message}`);
      return; // No fallar el webhook — MP reintentará
    }

    this.logger.log(
      `MP Payment ${mpPaymentId}: status=${mpPayment.status} | ` +
      `monto=${mpPayment.transaction_amount} | external_ref=${mpPayment.external_reference}`,
    );

    // ── 4. Identificar la factura por external_reference ───
    const facturaId = mpPayment.external_reference;
    if (!facturaId) {
      this.logger.warn(`Webhook MP: sin external_reference en pago ${mpPaymentId}`);
      return;
    }

    // Buscar empresa de la factura
    const [facturaRow] = await this.ds.query(
      'SELECT empresa_id, cliente_id, servicio_id, total, saldo FROM facturas WHERE id = $1',
      [facturaId],
    );

    if (!facturaRow) {
      this.logger.warn(`Webhook MP: factura ${facturaId} no encontrada`);
      return;
    }

    // Pago.servicioId == servicios.id. BUG CORREGIDO 2026-08-18: leía facturas.contrato_id
    // (el ACUERDO real desde la fase 4.2a), no facturas.servicio_id -- mismo defecto que
    // el path de registrar().
    const { empresa_id: empresaId, cliente_id: clienteId, servicio_id: contratoId } = facturaRow;

    // ── 5. Procesar según el status del pago ──────────────
    if (this.mpSvc.esAprobado(mpPayment)) {
      // Crear o actualizar el pago en nuestro sistema
      let pago: Pago;

      if (pagoExistente) {
        // Actualizar pago existente (era pendiente → ahora verificado)
        await this.pagoRepo.update(pagoExistente.id, {
          mpStatus:  mpPayment.status,
          mpDetail:  mpPayment,
          estado:    EstadoPago.VERIFICADO,
          verificadoEn: new Date(),
        });
        pago = await this.pagoRepo.findById(pagoExistente.id, empresaId);

      } else {
        // Crear nuevo pago registrado automáticamente por webhook
        pago = await this.pagoRepo.save(this.pagoRepo.create({
          empresaId,
          clienteId,
          facturaId,
          servicioId: contratoId,
          monto:           mpPayment.transaction_amount,
          moneda:          mpPayment.currency_id || 'PEN',
          metodoPago:      'mercadopago',
          mpPaymentId:     String(mpPayment.id),
          mpStatus:        mpPayment.status,
          mpPreferenceId:  mpPayment.preference_id,
          mpDetail:        mpPayment,
          numeroOperacion: String(mpPayment.id),
          fechaPago:       new Date().toISOString().split('T')[0],
          estado:          EstadoPago.VERIFICADO,
          verificadoEn:    new Date(),
          cajeroId:        'sistema-mp',
          notas:           `Pago automático via MercadoPago | ${mpPayment.payment_method_id}`,
        }));
      }

      // Aplicar el pago a la factura y verificar reactivación
      const userSistema = {
        sub: 'sistema-mp', email: 'webhook@mercadopago.com',
        empresaId, roles: ['Administrador'], permisos: [], nombreCompleto: 'MercadoPago', tema: 'dark',
      } as any;

      await this.aplicarPagoAFacturaYContrato(pago, userSistema);
      this.logger.log(`Pago MP aprobado aplicado: factura ${facturaId} | S/ ${pago.monto}`);

      // Emitir notificación de pago recibido
      this.emitirEventoPagoRecibido(pago);

    } else if (this.mpSvc.esPendiente(mpPayment)) {
      this.logger.log(`Pago MP ${mpPaymentId} pendiente — esperando confirmación`);

    } else {
      // Rechazado / cancelado
      if (pagoExistente) {
        await this.pagoRepo.update(pagoExistente.id, {
          estado:    EstadoPago.RECHAZADO,
          mpStatus:  mpPayment.status,
          mpDetail:  mpPayment,
          motivoRechazo: `MercadoPago: ${mpPayment.status_detail}`,
        });
      }
      this.logger.log(`Pago MP ${mpPaymentId} rechazado: ${mpPayment.status_detail}`);
    }
  }

  // ────────────────────────────────────────────────────────────
  // CREAR PREFERENCIA MERCADOPAGO (para el link de pago)
  // ────────────────────────────────────────────────────────────
  async crearPreferenciaMp(
    dto:  CrearPreferenciaDto,
    user: JwtPayload,
  ) {
    const factura = await this.facturacionSvc.findOne(dto.facturaId, user.empresaId);

    if (factura.estado === EstadoFactura.PAGADA) {
      throw new BadRequestException('La factura ya está pagada');
    }
    if (factura.estado === EstadoFactura.ANULADA) {
      throw new BadRequestException('La factura está anulada');
    }

    // Datos del cliente para la preferencia
    const [cliente] = await this.ds.query(
      'SELECT nombre_completo, email FROM clientes WHERE id = $1',
      [factura.clienteId],
    );

    return this.mpSvc.crearPreferencia({
      facturaId:   factura.id,
      titulo:      `${factura.numeroCompleto} — CRM ISP DATAFAST`,
      descripcion: factura.descripcion || 'Servicio de internet',
      monto:       Number(factura.saldo || factura.total),
      clienteEmail: cliente?.email || `cliente-${factura.clienteId}@datafast.pe`,
      urlExito:    dto.urlExito,
      urlFallo:    dto.urlFallo,
      urlPendiente: dto.urlPendiente,
    });
  }

  // ────────────────────────────────────────────────────────────
  // APLICAR PAGO A FACTURA + TRIGGER DE REACTIVACIÓN
  // Este es el corazón del módulo: cuando un pago se verifica,
  // aplica el monto a la factura y, si el contrato tiene deuda
  // cero después del pago, lo reactiva automáticamente.
  // ────────────────────────────────────────────────────────────
  private async aplicarPagoAFacturaYContrato(pago: Pago, user: JwtPayload): Promise<void> {
    try {
      let facturaId   = pago.facturaId;
      let contratoId  = pago.servicioId;
      const empresaId = pago.empresaId;

      // ── A. Aplicar a los comprobantes imputados ──────────
      // Un pago consolidado cubre varios: hay que aplicar a cada uno SU parte. Aplicar
      // `pago.monto` entero a `pago.facturaId` —lo que se hacía antes— dejaría el resto
      // de comprobantes impagos y al abonado creyendo que salió de deuda.
      // Solo las que NO se han volcado todavía. La idempotencia se DERIVA del estado de
      // cada imputación en vez de implementarse en este método: si ya están todas marcadas
      // no hay nada que hacer y eso es ÉXITO (`ya_en_destino`), no un fallo.
      //
      // Antes se releían todas y se reaplicaban siempre. Con el pago ya aplicado,
      // `aplicarPago` respondía "La factura ya está completamente pagada", el catch de
      // abajo se lo tragaba, `aplicado_en` seguía NULL y el reconciliador volvía a
      // intentarlo diez minutos después — 1123 pasadas medidas en producción (F0,
      // 2026-08-06). Es el mismo patrón de los 1788 reintentos contra el MA5800: una
      // transición no idempotente en manos de un watcher.
      const aplicaciones: Array<{ id: string; factura_id: string; monto_aplicado: string }> =
        await this.ds.query(
          `SELECT id, factura_id, monto_aplicado FROM pago_aplicaciones
            WHERE pago_id = $1 AND aplicado_en IS NULL`,
          [pago.id],
        );

      // Sin NINGUNA imputación registrada es un pago anterior a esa tabla: se conserva el
      // comportamiento de entonces (todo el importe a su única factura). Se distingue de
      // "todas ya aplicadas" preguntando por el total, no por las pendientes — si no, un
      // pago ya volcado se reaplicaría entero por este camino.
      const [{ total }] = await this.ds.query<Array<{ total: string }>>(
        `SELECT COUNT(*)::text AS total FROM pago_aplicaciones WHERE pago_id = $1`,
        [pago.id],
      );
      const sinImputacionesJamas = Number(total) === 0;

      const aImputar = sinImputacionesJamas
        ? (facturaId ? [{ id: null, facturaId, monto: Number(pago.monto) }] : [])
        : aplicaciones.map((a) => ({
            id: a.id, facturaId: a.factura_id, monto: parseFloat(a.monto_aplicado),
          }));

      for (const { id: aplicacionId, facturaId: fId, monto } of aImputar) {
        // El volcado y su marca, en la MISMA transacción: una caída entre ambos volvería a
        // aplicar el dinero en el siguiente reintento. Es la única forma de que la marca
        // signifique de verdad lo que dice.
        await this.ds.transaction(async (manager) => {
          await this.aplicador.aplicar(fId, monto, empresaId, pago.fechaPago, manager);
          if (aplicacionId) {
            await manager.query(
              `UPDATE pago_aplicaciones SET aplicado_en = NOW() WHERE id = $1`,
              [aplicacionId],
            );
          }
        });
        this.logger.log(`Pago ${pago.id} aplicado a factura ${fId} por S/ ${monto}`);
      }

      if (facturaId) {

        // Obtener contratoId (== servicios.id, ver comentario en el create() de arriba) de
        // la factura si no vino en el pago. BUG CORREGIDO 2026-08-18: leía
        // `facturas.contrato_id`, que desde la fase 4.2a es el ACUERDO real, no el
        // servicio -- ese id se pasaba tal cual a verificarYReactivarContrato() más abajo,
        // que consulta `servicios` y no lo encontraba. El catch de esa función atrapa el
        // NotFound y sale en silencio (línea ~1147): la reactivación nunca corría, sin log.
        if (!contratoId) {
          const [row] = await this.ds.query(
            'SELECT servicio_id FROM facturas WHERE id = $1',
            [facturaId],
          );
          contratoId = row?.servicio_id;
        }
      }

      // ── B. Si hay contrato, verificar si se saldó la deuda ─
      //
      // La decisión de NO reactivar se tomó al registrar el pago y viaja en la fila: este
      // camino corre cuando un supervisor verifica días después, y tiene que respetar lo
      // que se acordó en el mostrador con el abonado que se daba de baja.
      if (pago.reactivarServicio === false) {
        this.logger.log(
          `[PAGO] ${pago.id} verificado sin reactivar servicio (registrado como "Solo registrar")`,
        );
      } else if (contratoId) {
        await this.verificarYReactivarContrato(contratoId, empresaId, user, pago.id);
      } else if (pago.clienteId) {
        // Factura unificada (contrato_id null): verificar deuda total del cliente
        // y reactivar TODOS los contratos suspendidos si quedaron en cero
        // H-7: vencida, no total. Esta puerta decide si merece la pena recorrer los contratos
        // del abonado; con el criterio viejo, un comprobante emitido y sin vencer la cerraba.
        if (await this.deudaSvc.vencidaDelCliente(pago.clienteId) <= 0) {
          // Incluir contratos suspendidos/morosos/cortados (reactivación) Y contratos
          // activos con prorroga vigente (cumplimiento de promesa sin cambio de estado).
          const afectados: { id: string }[] = await this.ds.query(
            `SELECT id FROM servicios
             WHERE cliente_id = $1 AND empresa_id = $2 AND deleted_at IS NULL
               AND (
                 estado = 'suspendido'
                 OR (estado = 'activo' AND en_prorroga = TRUE)
               )`,
            [pago.clienteId, empresaId],
          );
          for (const { id: cId } of afectados) {
            await this.verificarYReactivarContrato(cId, empresaId, user, pago.id);
          }
        }
      }

      // El pago SURTIÓ EFECTO. Marcarlo es lo que lo saca de la cola del watcher; mientras
      // `aplicado_en` siga NULL, el pago se considera trabajo pendiente y se reintenta.
      await this.pagoRepo.update(pago.id, { aplicadoEn: new Date() });
    } catch (err) {
      // No se relanza —el pago YA está cobrado y registrado, y tumbar la request no lo
      // desharía—, pero tampoco se traga: `aplicado_en` queda NULL y el watcher
      // `reconciliarPagosNoAplicados` lo reintenta hasta que surta efecto.
      //
      // Antes esto era solo un log. Si fallaba, el abonado quedaba CORTADO con su pago
      // cobrado y nadie se enteraba: el reconciliador compara ERP contra hardware, así que
      // confirmaba que el corte estaba bien aplicado — reafirmaba el error en vez de
      // corregirlo. Se descubría cuando el cliente reclamaba.
      this.logger.error(
        `Error aplicando pago ${pago.id} a factura/contrato — queda PENDIENTE de aplicar, ` +
        `el watcher lo reintentará: ${err.message}`,
        err.stack,
      );
    }
  }

  // ────────────────────────────────────────────────────────────
  // reconciliarPagosNoAplicados — red de seguridad del cobro
  //
  // Dos defensas distintas, porque los modos de fallo son distintos:
  //
  //  A) Pagos verificados que nunca surtieron efecto (`aplicado_en` NULL). Ataca la CAUSA:
  //     la aplicación murió a mitad. Se reintenta, y es idempotente porque `aplicarPago`
  //     recalcula el saldo real de la factura.
  //
  //  B) Contratos suspendidos/morosos/cortados SIN deuda. Ataca el SÍNTOMA, venga de donde
  //     venga: un ajuste manual, una nota de crédito que saldó la cuenta, un camino que
  //     todavía no conocemos. Un abonado sin deuda no puede estar cortado, y esa afirmación
  //     es verdadera con independencia de por qué llegó ahí.
  //
  // Solo la instancia con RUN_CRONS ejecuta esto (igual que el resto de watchers).
  // ────────────────────────────────────────────────────────────
  @Cron('0 */10 * * * *', { name: 'pagos-reconciliacion' })
  async reconciliarPagosNoAplicados(): Promise<void> {
    if (process.env.RUN_CRONS !== 'true') return;
    // ── A. Pagos cobrados que no llegaron a aplicarse ──────────────
    // Margen de 2 minutos: un pago recién verificado puede estar aplicándose ahora mismo
    // en otro proceso. Reintentarlo en paralelo no lo cuenta dos veces porque cada
    // imputación se marca en la misma transacción que la vuelca, y solo se tocan las que
    // siguen en NULL — lo sostiene `pagos.reconciliacion.spec.ts`, no este comentario.
    //
    // Aquí decía "aplicarPago es idempotente". Era falso, y nadie lo comprobó nunca: lo
    // comprobó producción con 1123 reintentos sobre dos pagos ya aplicados.
    const pendientes = await this.ds.query<Array<{ id: string }>>(
      `SELECT id FROM pagos
        WHERE estado = 'verificado' AND aplicado_en IS NULL
          AND verificado_en < NOW() - INTERVAL '2 minutes'
        ORDER BY verificado_en
        LIMIT 25`,
    );

    for (const { id } of pendientes) {
      try {
        const pago = await this.ds.getRepository(Pago).findOne({ where: { id } });
        if (!pago) continue;
        const userSistema = {
          sub: 'sistema', empresaId: pago.empresaId, email: 'sistema@erp',
        } as JwtPayload;
        await this.aplicarPagoAFacturaYContrato(pago, userSistema);

        // El log describe lo que OCURRIÓ, no lo que se intentó. Antes cantaba
        // "aplicado por reconciliación" siempre, incluso en el mismo milisegundo en que
        // el catch interno acababa de tragarse el fallo: los logs de producción tenían
        // el error y el éxito del mismo pago con el mismo timestamp. Ahora se relee el
        // estado, que es la única fuente que puede confirmarlo.
        const confirmacion = await this.ds.query<Array<{ aplicado_en: Date | null }>>(
          `SELECT aplicado_en FROM pagos WHERE id = $1`, [id],
        );
        if (confirmacion?.[0]?.aplicado_en) {
          this.logger.warn(`Pago ${id} aplicado por reconciliación — su aplicación original falló.`);
        } else {
          this.logger.error(
            `Reconciliación: el pago ${id} sigue SIN aplicarse tras el reintento. ` +
            `Requiere revisión manual — el abonado puede estar cortado habiendo pagado.`,
          );
        }
      } catch (e: any) {
        this.logger.error(`Reconciliación: el pago ${id} sigue sin aplicarse: ${e?.message}`);
      }
    }

    // ── A2. Invariante de contabilidad ─────────────────────────────
    //
    // `facturas.monto_pagado` tiene que ser exactamente la suma de lo que los pagos le
    // imputaron. Es lo que convierte la frontera del dinero en algo comprobable en vez
    // de una intención escrita en un comentario.
    //
    // Cualquier divergencia posterior a la fecha de corte significa que hay un escritor
    // de dinero fuera de `AplicadorFacturaService`. No se intenta reparar aquí: reparar
    // a ciegas un descuadre contable puede empeorarlo, y quién lo causó es justo la
    // información que hace falta. Se grita y se deja constancia.
    const descuadres = await this.aplicador.divergencias(10);
    if (descuadres.length) {
      this.logger.error(
        `[CONTABILIDAD] ${descuadres.length} comprobante(s) con monto_pagado distinto de ` +
        `la suma de sus imputaciones. Hay un escritor de dinero fuera del aplicador. ` +
        `Muestra: ${descuadres.map((d) => `${d.numero ?? d.id} (${d.monto_pagado} vs ${d.aplicado})`).join(', ')}`,
      );
    }

    // ── B. Cortados sin deuda ──────────────────────────────────────
    const cortadosSinDeuda = await this.ds.query<Array<{ id: string; empresa_id: string; numero: string }>>(
      `SELECT co.id, co.empresa_id, co.numero_contrato AS numero
         FROM servicios co
        WHERE co.estado = 'suspendido'
          AND co.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM facturas f
             WHERE f.servicio_id = co.id
               AND ${sqlDeudaExigible('f')}
               AND f.deleted_at IS NULL
          )
          AND NOT EXISTS (
            SELECT 1 FROM facturas f
             WHERE f.cliente_id = co.cliente_id AND f.servicio_id IS NULL
               AND ${sqlDeudaExigible('f')}
               AND f.deleted_at IS NULL
          )
        LIMIT 25`,
    );

    for (const c of cortadosSinDeuda) {
      try {
        const userSistema = { sub: 'sistema', empresaId: c.empresa_id, email: 'sistema@erp' } as JwtPayload;
        await this.verificarYReactivarContrato(c.id, c.empresa_id, userSistema);
        this.logger.warn(
          `Contrato ${c.numero} estaba cortado SIN deuda — reactivado por reconciliación.`,
        );
      } catch (e: any) {
        this.logger.error(`Reconciliación: no se pudo reactivar ${c.numero}: ${e?.message}`);
      }
    }
  }

  // ────────────────────────────────────────────────────────────
  // TRIGGER DE REACTIVACIÓN AUTOMÁTICA
  // Si el contrato está suspendido por mora y ya no tiene deuda,
  // se reactiva automáticamente sin intervención humana.
  // ────────────────────────────────────────────────────────────
  private async verificarYReactivarContrato(
    contratoId: string,
    empresaId:  string,
    user:       JwtPayload,
    pagoId?:    string,
  ): Promise<void> {
    // ── Deuda: UNA sola definición, la de `DeudaPorContratoService` ─────────────
    //
    // Aquí había un cálculo propio (`pagoRepo.calcularDeudaContrato`) que sumaba solo
    // `WHERE f.contrato_id = $1`. El comprobante de este ERP es CONSOLIDADO por cliente
    // —`contrato_id` en NULL—, así que ese SUM daba **cero** para un abonado que sí debía,
    // y esta puerta reactivaba el servicio de un moroso. Es el mecanismo del incidente
    // 2026-08-04 (ficha S/64, deuda real S/128): se corrigió en `cobranza.worker`, que
    // añadió el `OR contrato_id IS NULL AND cliente_id = ...`, y esta ruta se quedó atrás.
    // Dos puertas al mismo sitio, una arreglada (desviación A-4).
    //
    // `recalcularPorCliente` es la definición canónica: parte de las facturas, imputa el
    // consolidado en proporción a las líneas de cada contrato y refresca la proyección de
    // TODOS los contratos del cliente — no solo del que originó el pago.
    //
    // El contrato se lee UNA vez y sirve para las dos cosas: obtener el `clienteId` que
    // necesita el recálculo y decidir después si su estado admite reactivación. Antes se
    // leía más abajo; adelantarlo evita una consulta extra solo para el identificador.
    let contrato: any;
    try {
      contrato = await this.contratosSvc.findOne(contratoId, empresaId);
    } catch {
      return; // Contrato no encontrado: no hay nada que recalcular ni que reactivar.
    }

    await this.deudaSvc.recalcularPorCliente(contrato.clienteId, empresaId);

    // La proyección se refresca con la definición canónica (imputación del consolidado), pero
    // QUIEN DECIDE es la deuda vencida: H-7. `calcular` devuelve la deuda TOTAL imputada, así
    // que un comprobante emitido y aún sin vencer bloqueaba la reactivación de alguien que
    // acababa de pagar todo lo exigible. Esta puerta es de las peligrosas: reactiva con
    // `automatico = true`, que se salta las guardas de `cambiarEstado`.
    const imputada      = await this.deudaSvc.calcular(contrato.clienteId, empresaId);
    const deudaImputada = imputada.get(contratoId)?.monto ?? 0;
    const deuda         = (await this.deudaSvc.vencidaQueBloquea(contratoId, contrato.clienteId)).monto;

    this.logger.debug(
      `Contrato ${contratoId}: vencida = S/ ${deuda} | imputada total = S/ ${deudaImputada}`,
    );

    // Si la deuda quedó en cero, verificar si el contrato está suspendido
    if (deuda <= 0) {
      // Notificar a PromesasPagoService para marcar cumplimiento si hay una activa.
      // emitAsync garantiza que la promesa quede 'cumplida' antes de cambiarEstado
      // y que cualquier fallo del handler suba en lugar de perderse silenciosamente.
      await this.events.emitAsync('promesa.verificar_cumplimiento', {
        // El evento y ambas entidades (Pago, PromesaPago) usan servicioId desde el Paso B
        // de Ola 2 (2026-08-18) -- `contratoId` local aquí es solo el nombre de la
        // variable, no el campo de la entidad.
        servicioId: contratoId,
        pagoId: pagoId ?? '',
        deuda,
      }).catch((err: any) =>
        this.logger.error(
          `[PAGO] Error al notificar cumplimiento de promesa para contrato ${contratoId}: ${err.message}`,
          err.stack,
        ),
      );
      const estadosReactivables = [
        EstadoContrato.SUSPENDIDO,  // post-prorroga: MikroTik ya cortó pero deuda saldada → reactivar
      ];
      if (estadosReactivables.includes(contrato.estado)) {
        // ── REACTIVAR AUTOMÁTICAMENTE ─────────────────────
        await this.contratosSvc.cambiarEstado(
          contratoId,
          {
            estado: EstadoContrato.ACTIVO,
            motivo: `Reactivación automática — pago S/ ${contrato.deudaTotal} registrado`,
          },
          user,
          true, // automatico = true (saltea validación de transición)
        );

        this.logger.log(
          `🟢 Contrato REACTIVADO automáticamente: ${contratoId} (${contrato.estado}) | ` +
          `deuda saldada: S/ ${contrato.deudaTotal}`,
        );
      } else if (contrato.estado === EstadoContrato.PENDIENTE_ACTIVACION) {
        this.logger.warn(
          `[REACTIVAR] Contrato ${contratoId} en pendiente_activacion — deuda saldada, ` +
          `pago aplicado pero requiere activación manual por el operador`,
        );
        this.events.emit('contrato.pago_en_pendiente_activacion', {
          contratoId, pagoId: pagoId ?? '', empresaId,
        });
      } else if (contrato.estado === EstadoContrato.ACTIVO && contrato.enProrroga) {
        // Contrato activo con prórroga pagada → limpiar prórroga en BD y MikroTik
        await this.contratosSvc.limpiarProrroga(contratoId, empresaId);
        this.logger.log(
          `🟢 Prórroga saldada: contrato ${contratoId} | IP removida de address-list prorroga`,
        );
      } else if (contrato.estado === EstadoContrato.BAJA_DEFINITIVA) {
        this.logger.warn(
          `[REACTIVAR] Contrato ${contratoId} en baja_definitiva — pago registrado, ` +
          `sin reactivación (solo registro contable)`,
        );
      }
    }
  }


  // ── Helper: emitir evento pago_recibido con datos del cliente ─
  private async emitirEventoPagoRecibido(pago: Pago): Promise<void> {
    try {
      // Obtener telefono y nombre del cliente
      const [cliente] = await this.ds.query(
        'SELECT nombre_completo, whatsapp, telefono FROM clientes WHERE id = $1',
        [pago.clienteId],
      );
      const tel = cliente?.whatsapp || cliente?.telefono || '';
      this.events.emit('notification.pago.recibido', {
        telefono:       tel,
        clienteNombre:  cliente?.nombre_completo ?? '',
        montoPago:      `S/ ${Number(pago.monto).toFixed(2)}`,
        metodoPago:     pago.metodoPago,
        saldoPendiente: 'S/ 0.00',
        empresaId:      pago.empresaId,
        // Campo del evento sigue llamándose contratoId a propósito: alimenta
        // notificaciones_logs.contrato_id, tabla fuera de esta ola (censo §3.2, sin FK).
        contratoId:     pago.servicioId ?? undefined,
        clienteId:      pago.clienteId ?? undefined,
        pagoId:         pago.id,
      });
      this.logger.log(`[PAGOS] Evento pago_recibido emitido para pago ${pago.id}`);
    } catch (err) {
      this.logger.warn(`[PAGOS] Error emitiendo pago_recibido: ${err.message}`);
    }
  }

  // ────────────────────────────────────────────────────────────
  // LISTAR / OBTENER
  // ────────────────────────────────────────────────────────────
  async findAll(empresaId: string, filters: FilterPagoDto) {
    const result = await this.pagoRepo.findAllPaginated(empresaId, filters);
    return formatPaginatedResponse(result);
  }

  async findOne(id: string, empresaId: string): Promise<Pago> {
    const p = await this.pagoRepo.findById(id, empresaId);
    if (!p) throw new NotFoundException(`Pago ${id} no encontrado`);
    return p;
  }

  async findByCliente(clienteId: string, empresaId: string): Promise<Pago[]> {
    return this.pagoRepo.findByCliente(clienteId, empresaId);
  }

  async findByFactura(facturaId: string, empresaId: string): Promise<Pago[]> {
    return this.pagoRepo.findByFactura(facturaId, empresaId);
  }

  async findByContrato(contratoId: string, empresaId: string): Promise<Pago[]> {
    return this.pagoRepo.findByContrato(contratoId, empresaId);
  }

  // ────────────────────────────────────────────────────────────
  // EDITAR METADATOS DE UN PAGO (no cambia monto ni estado)
  // ────────────────────────────────────────────────────────────
  async actualizar(
    id:        string,
    dto:       ActualizarPagoDto,
    empresaId: string,
    user:      JwtPayload,
    req?:      any,
  ): Promise<Pago> {
    const pago = await this.findOne(id, empresaId);
    if (pago.conciliado) throw new BadRequestException('No se puede editar un pago conciliado');

    const updates: Record<string, any> = {};

    // Corregir por dónde entró un cobro se hace cambiando el CANAL, y entonces
    // `metodo_pago` se deriva de él. Dejar que se edite el texto libre por su cuenta
    // desincronizaría los dos modelos: el reporte por canal diría una cosa y la columna
    // histórica otra, sin que nada avisara.
    if (dto.canalPagoId !== undefined) {
      const canal = await this.canalSvc.porId(dto.canalPagoId, empresaId);
      updates.canalPagoId = canal.id;
      updates.metodoPago  = canal.codigo;
      // La cuenta explícita manda; si no viene, se hereda la del canal nuevo. Corregir el
      // canal sin mover la cuenta dejaría el dinero contabilizado donde ya no entró.
      updates.cuentaReceptoraId = dto.cuentaReceptoraId ?? canal.cuentaReceptoraDefaultId ?? null;
      const { comision, neto } = this.canalSvc.calcularComision(canal, Number(pago.monto));
      updates.comision  = comision;
      updates.montoNeto = neto;
    } else if (dto.cuentaReceptoraId !== undefined) {
      // Mover solo la cuenta es legítimo: el canal era correcto y el dinero acabó en otra
      // caja. Es un movimiento de tesorería y queda auditado como el resto.
      updates.cuentaReceptoraId = dto.cuentaReceptoraId;
    }

    if (dto.metodoPago      !== undefined && dto.canalPagoId === undefined) {
      updates.metodoPago    = dto.metodoPago;
    }
    if (dto.banco           !== undefined) updates.banco           = dto.banco;
    if (dto.fechaPago       !== undefined) updates.fechaPago       = dto.fechaPago;
    if (dto.numeroOperacion !== undefined) updates.numeroOperacion = dto.numeroOperacion;
    if (dto.notas           !== undefined) updates.notas           = dto.notas;
    if (dto.registradoEn   !== undefined) {
      const dt = new Date(dto.registradoEn);
      if (!isNaN(dt.getTime())) {
        updates.registradoEn = dt;
        // Sincronizar fechaPago con la fecha del nuevo timestamp si no se envió por separado
        if (dto.fechaPago === undefined) {
          updates.fechaPago = dt.toISOString().slice(0, 10);
        }
      }
    }

    if (Object.keys(updates).length === 0) return pago;

    await this.pagoRepo.update(id, updates);

    await this.auditoria.logUpdate({
      empresaId, usuarioId: user.sub, usuarioEmail: user.email,
      modulo: 'pagos', entidadId: id,
      descripcion: `Pago editado: S/ ${pago.monto} | ${pago.metodoPago}`, req,
    });

    return this.findOne(id, empresaId);
  }

  // ────────────────────────────────────────────────────────────
  // EXTORNAR PAGO
  //
  // Sustituye a `eliminar()`. Un pago registrado es un HECHO HISTÓRICO: lo que se
  // registra es que fue anulado, por quién y por qué. Borrar la fila era perder el único
  // rastro de que ese dinero existió — y de que alguien lo cobró.
  //
  // Es el flujo con más potencial de daño del módulo: un extorno mal hecho corta a un
  // abonado que pagó, o deja pagada una factura que nunca se cobró.
  // ────────────────────────────────────────────────────────────
  async extornar(
    id:        string,
    dto:       ExtornarPagoDto,
    user:      JwtPayload,
    req?:      any,
  ): Promise<Pago> {
    const empresaId = user.empresaId;
    const pago = await this.findOne(id, empresaId);

    if (pago.estado === EstadoPago.EXTORNADO) {
      throw new BadRequestException('El pago ya está extornado');
    }

    // Extornar un pago ya conciliado rompe un cierre contable que alguien dio por cerrado
    // contra el extracto del banco. Se permite —a veces es justo lo que hay que hacer, un
    // contracargo llega después de conciliar— pero exige permiso aparte y nota obligatoria.
    if (pago.conciliado) {
      const puede = user.roles?.includes('Administrador')
                 || user.permisos?.includes('pagos:extornar_conciliado');
      if (!puede) {
        throw new ForbiddenException(
          'Este pago ya está conciliado con el extracto bancario. Extornarlo rompe un ' +
          'cierre contable y requiere permiso de supervisor.',
        );
      }
      if (!dto.nota?.trim()) {
        throw new BadRequestException(
          'Extornar un pago conciliado exige una nota explicando por qué',
        );
      }
    }

    const aplicaciones = await this.ds.query<Array<{ factura_id: string; monto_aplicado: string }>>(
      `SELECT factura_id, monto_aplicado FROM pago_aplicaciones WHERE pago_id = $1`,
      [id],
    );

    await this.ds.transaction(async (manager) => {
      // La bitácora ANTES de tocar nada: si el proceso muere a mitad, queda constancia de
      // que se intentó y de qué había. Al revés, un extorno a medias sería invisible.
      await manager.query(
        `INSERT INTO pago_extorno (empresa_id, pago_id, motivo, nota, monto_revertido,
                                   facturas_afectadas, estaba_conciliado,
                                   usuario_id, usuario_email)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
         ON CONFLICT (pago_id) DO NOTHING`,
        [
          empresaId, id, dto.motivo, dto.nota ?? null, pago.monto,
          JSON.stringify(aplicaciones.map((a) => ({
            facturaId: a.factura_id, monto: parseFloat(a.monto_aplicado),
          }))),
          pago.conciliado, user.sub, user.email,
        ],
      );

      // Se retiran las imputaciones y DESPUÉS se recalcula: el aplicador reconstruye
      // `monto_pagado` desde lo que queda, así que reintentar un extorno interrumpido da
      // el mismo resultado. Restar habría descuadrado en el segundo intento.
      await manager.query(`DELETE FROM pago_aplicaciones WHERE pago_id = $1`, [id]);

      const facturas = [...new Set(aplicaciones.map((a) => a.factura_id))];
      for (const facturaId of facturas) {
        await this.aplicador.revertir(facturaId, empresaId, manager);
      }

      await manager.update(Pago, id, {
        estado:     EstadoPago.EXTORNADO,
        aplicadoEn: null,
        notas: [pago.notas, `EXTORNADO (${dto.motivo}): ${dto.nota ?? 'sin nota'}`]
          .filter(Boolean).join(' | '),
      });
    });

    // La deuda del abonado vuelve a existir: hay que refrescar la proyección o el portal
    // seguiría mostrando una deuda saldada que ya no lo está.
    if (pago.clienteId) {
      await this.deudaSvc.recalcularPorCliente(pago.clienteId, empresaId).catch((e) =>
        this.logger.error(`[EXTORNO] No se pudo recalcular la deuda de ${pago.clienteId}: ${e.message}`),
      );
    }

    await this.auditoria.logUpdate({
      empresaId, usuarioId: user.sub, usuarioEmail: user.email,
      modulo: 'pagos', entidadId: id,
      descripcion:
        `Pago EXTORNADO S/ ${pago.monto} | motivo: ${dto.motivo} | ` +
        `comprobantes afectados: ${aplicaciones.length}` +
        (pago.conciliado ? ' | ESTABA CONCILIADO' : '') +
        (dto.nota ? ` | ${dto.nota}` : ''),
      req,
    });

    // El corte del servicio NO se decide aquí, y es deliberado.
    //
    // El motivo más frecuente de extorno es `error_registro` —una equivocación del
    // cajero—, y cortarle el servicio al abonado en el mismo request significaría que el
    // ERP corta a un cliente al día por errores propios, en segundos, sin que nadie lo
    // revise. El corte lo decide el ciclo de cobranza normal, con su periodo de gracia,
    // exactamente igual que con cualquier otra deuda.
    this.logger.warn(
      `[EXTORNO] Pago ${id} extornado por ${user.email} (${dto.motivo}). ` +
      `La deuda del abonado ${pago.clienteId} vuelve a existir; el corte, si procede, lo ` +
      `decidirá el ciclo de cobranza con su periodo de gracia.`,
    );

    return this.findOne(id, empresaId);
  }

  /**
   * @deprecated Borrar un pago perdía el rastro de que ese dinero existió, y restaba el
   * importe en vez de recalcularlo (un reintento tras un fallo a mitad descuadraba el
   * saldo). Usa `extornar`, que además exige un motivo tipificado.
   */
  async eliminar(id: string, _empresaId: string, _user: JwtPayload): Promise<void> {
    throw new BadRequestException(
      `Un pago no se elimina: se extorna, indicando el motivo. Un pago registrado es un ` +
      `hecho histórico y borrarlo deja sin rastro dinero que alguien cobró. ` +
      `Usa POST /pagos/${id}/extornar.`,
    );
  }

  async findPendientes(empresaId: string): Promise<Pago[]> {
    return this.pagoRepo.findPendientesVerificar(empresaId);
  }

  // ────────────────────────────────────────────────────────────
  // RESUMEN DE COBRANZA
  // ────────────────────────────────────────────────────────────
  async getResumen(empresaId: string): Promise<ResumenCobranzaDto> {
    const [raw, ultimos] = await Promise.all([
      this.pagoRepo.getResumenCobranza(empresaId),
      this.pagoRepo.findUltimos(empresaId, 10),
    ]);

    const porMetodo: Record<string, { total: number; monto: number }> = {};
    for (const r of (raw.porMetodo || [])) {
      porMetodo[r.metodo_pago] = {
        total: parseInt(r.total, 10),
        monto: parseFloat(r.monto || '0'),
      };
    }

    return {
      cobradoHoy:          parseFloat(raw.cobrado_hoy         || '0'),
      cobradoSemana:       parseFloat(raw.cobrado_semana       || '0'),
      cobradoMes:          parseFloat(raw.cobrado_mes          || '0'),
      cobradoMesAnterior:  parseFloat(raw.cobrado_mes_anterior || '0'),
      pagosHoy:            parseInt(raw.pagos_hoy              || '0', 10),
      pagosSemana:         parseInt(raw.pagos_semana           || '0', 10),
      pagosMes:            parseInt(raw.pagos_mes              || '0', 10),
      pendientesVerificar: parseInt(raw.pendientes_verificar   || '0', 10),
      porMetodo,
      ultimosPagos:        ultimos,
    };
  }

  // ────────────────────────────────────────────────────────────
  // CUENTAS BANCARIAS
  // ────────────────────────────────────────────────────────────
  async getCuentasBancarias(empresaId: string, incluirInactivas = false): Promise<CuentaBancaria[]> {
    return this.pagoRepo.findCuentas(empresaId, incluirInactivas);
  }

  async createCuentaBancaria(
    dto:  CreateCuentaBancariaDto,
    user: JwtPayload,
  ): Promise<CuentaBancaria> {
    const tipo = dto.tipo ?? 'banco';

    // Una cuenta de banco sin número no sirve para conciliar: el extracto se cruza por
    // ahí. Se exige aquí y no en el DTO porque depende del tipo — una caja no lo tiene.
    if (tipo === 'banco' && !dto.numeroCuenta?.trim()) {
      throw new BadRequestException(
        'Una cuenta bancaria necesita su número: es lo que permite cruzarla con el extracto.',
      );
    }
    if (tipo === 'banco' && !dto.banco?.trim()) {
      throw new BadRequestException('Indica a qué banco pertenece la cuenta');
    }

    const duplicada = await this.ds.query(
      `SELECT id FROM cuentas_bancarias
        WHERE empresa_id = $1 AND LOWER(COALESCE(nombre, banco)) = LOWER($2) LIMIT 1`,
      [user.empresaId, dto.nombre.trim()],
    );
    if (duplicada.length) {
      throw new BadRequestException(
        `Ya existe una cuenta llamada "${dto.nombre}". Dos cuentas con el mismo rótulo ` +
        `hacen que el cajero no sepa cuál elegir y el arqueo deje de significar nada.`,
      );
    }

    if (dto.esPrincipal) {
      // Desmarcar la cuenta principal anterior
      await this.ds.query(
        'UPDATE cuentas_bancarias SET es_principal = false WHERE empresa_id = $1',
        [user.empresaId],
      );
    }

    return this.pagoRepo.createCuenta({
      ...dto,
      tipo,
      // Una caja se arquea siempre: es dinero físico que alguien tiene en la mano y el
      // ERP solo sabe lo que le dijeron.
      requiereArqueo: dto.requiereArqueo ?? tipo === 'caja',
      banco:         dto.banco?.trim()        || null,
      numeroCuenta:  dto.numeroCuenta?.trim() || null,
      empresaId:     user.empresaId,
    } as never);
  }

  /**
   * Edición y baja de una cuenta receptora.
   *
   * La baja es LÓGICA (`activa = false`), como los canales: una cuenta con pagos
   * históricos no se puede borrar sin dejar esos cobros sin explicación de dónde entraron.
   */
  async actualizarCuentaBancaria(
    id: string,
    dto: Partial<CreateCuentaBancariaDto> & { activa?: boolean },
    user: JwtPayload,
  ): Promise<CuentaBancaria> {
    const [cuenta] = await this.ds.query(
      `SELECT * FROM cuentas_bancarias WHERE id = $1 AND empresa_id = $2`,
      [id, user.empresaId],
    );
    if (!cuenta) throw new NotFoundException('Cuenta no encontrada');

    if (dto.esPrincipal) {
      await this.ds.query(
        'UPDATE cuentas_bancarias SET es_principal = false WHERE empresa_id = $1',
        [user.empresaId],
      );
    }

    const campos: Array<[string, unknown]> = [];
    if (dto.nombre         !== undefined) campos.push(['nombre', dto.nombre.trim()]);
    if (dto.banco          !== undefined) campos.push(['banco', dto.banco?.trim() || null]);
    if (dto.numeroCuenta   !== undefined) campos.push(['numero_cuenta', dto.numeroCuenta?.trim() || null]);
    if (dto.cci            !== undefined) campos.push(['cci', dto.cci || null]);
    if (dto.titular        !== undefined) campos.push(['titular', dto.titular || null]);
    if (dto.moneda         !== undefined) campos.push(['moneda', dto.moneda]);
    if (dto.requiereArqueo !== undefined) campos.push(['requiere_arqueo', dto.requiereArqueo]);
    if (dto.esPrincipal    !== undefined) campos.push(['es_principal', dto.esPrincipal]);
    if (dto.activa         !== undefined) campos.push(['activa', dto.activa]);
    // `tipo` NO se puede cambiar: mover una cuenta de caja a banco reescribiría el
    // significado de todos los arqueos que ya se cerraron sobre ella.

    if (!campos.length) return cuenta;

    const sets = campos.map(([c], i) => `${c} = $${i + 3}`).join(', ');
    const [fila] = filasUpdateReturning<CuentaBancaria>(await this.ds.query(
      `UPDATE cuentas_bancarias SET ${sets} WHERE id = $1 AND empresa_id = $2 RETURNING *`,
      [id, user.empresaId, ...campos.map(([, v]) => v)],
    ));
    return fila;
  }

  // ────────────────────────────────────────────────────────────
  // VERIFICAR DEUDA PENDIENTE DE CLIENTE
  // Usado por el frontend antes de mostrar el formulario de pago.
  // Cuenta facturas en estados cobrables para el cliente dado.
  // ────────────────────────────────────────────────────────────
  async verificarDeudaCliente(
    clienteId: string,
    empresaId: string,
  ): Promise<{ tieneDeuda: boolean; count: number; totalPendiente: number }> {
    const [row] = await this.ds.query(`
      SELECT
        COUNT(*)::int                                                     AS count,
        COALESCE(SUM(CASE WHEN saldo > 0 THEN saldo ELSE total END), 0)  AS total
      FROM facturas
      WHERE cliente_id  = $1
        AND empresa_id  = $2
        AND ${sqlDeudaExigible()}
        AND deleted_at IS NULL
    `, [clienteId, empresaId]);

    const count = parseInt(row?.count ?? '0', 10);
    return {
      tieneDeuda:      count > 0,
      count,
      totalPendiente:  parseFloat(row?.total ?? '0'),
    };
  }
}
