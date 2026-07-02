import {
  Injectable, Logger, NotFoundException,
  ConflictException, BadRequestException,
  ForbiddenException, UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { PagoRepository }       from './repositories/pago.repository';
import { MercadoPagoService }   from './mercadopago.service';
import { FacturacionService }   from '../facturacion/facturacion.service';
import { ContratosService }     from '../contratos/contratos.service';
import { AuditoriaService }     from '../auth/auditoria.service';
import { JwtPayload }           from '../../common/decorators/current-user.decorator';

import { Pago, EstadoPago, MetodoPago, CuentaBancaria } from './entities/pago.entity';
import { Contrato, EstadoContrato } from '../contratos/entities/contrato.entity';
import { Factura, EstadoFactura }   from '../facturacion/entities/factura.entity';
import { RegistrarPagoDto } from './dto/registrar-pago.dto';
import {
  VerificarPagoDto, ConciliarPagoDto, ActualizarPagoDto,
  FilterPagoDto, CrearPreferenciaDto,
  CreateCuentaBancariaDto, ResumenCobranzaDto,
} from './dto/pago.dto';
import { QUEUES, JOBS, PayloadReactivarContrato } from '../workers/workers.constants';
import { formatPaginatedResponse } from '../../common/utils/pagination.util';

@Injectable()
export class PagosService {
  private readonly logger = new Logger(PagosService.name);

  constructor(
    private readonly pagoRepo:     PagoRepository,
    private readonly mpSvc:        MercadoPagoService,
    private readonly facturacionSvc: FacturacionService,
    private readonly contratosSvc: ContratosService,
    private readonly auditoria:    AuditoriaService,
    private readonly config:       ConfigService,
    private readonly events:       EventEmitter2,
    @InjectDataSource() private readonly ds: DataSource,
    @InjectQueue(QUEUES.COBRANZA) private readonly cobranzaQueue: Queue,
  ) {}

  // ────────────────────────────────────────────────────────────
  // REGISTRAR PAGO — Fase 2: Transacción ACID completa
  // 1. Idempotencia por (empresaId, metodoPago, numeroOperacion)
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
    // El DTO ya usa los mismos valores lowercase que la entidad gracias al @Transform
    const metodoPagoEntity = dto.metodoPago as unknown as MetodoPago;
    const contratosParaReactivar: Contrato[] = [];
    const contratosEnProrroga:    string[]   = [];

    // ── TRANSACCIÓN ACID ──────────────────────────────────────
    const savedPago = await this.ds.transaction(async (manager) => {

      // PASO 1 — Idempotencia
      const duplicado = await manager.findOne(Pago, {
        where: { empresaId, metodoPago: metodoPagoEntity, numeroOperacion: dto.numeroOperacion },
      });
      if (duplicado) {
        throw new ConflictException(
          `Ya existe un pago con el número de operación '${dto.numeroOperacion}' ` +
          `(${metodoPagoEntity}). ID existente: ${duplicado.id}`,
        );
      }

      // PASO 2 — Validar factura y cargar contrato
      const factura = await manager.findOne(Factura, {
        where: { id: dto.facturaId, empresaId },
      });
      if (!factura) {
        throw new NotFoundException(`Factura ${dto.facturaId} no encontrada`);
      }
      if (factura.estado === EstadoFactura.PAGADA) {
        throw new BadRequestException('La factura ya está completamente pagada');
      }

      let contrato: Contrato | null = null;
      if (factura.contratoId) {
        contrato = await manager.findOne(Contrato, {
          where: { id: factura.contratoId },
        });
      }
      // Fallback: facturas sin contratoId directo (mora generada sin vínculo explícito)
      // → busca el contrato suspendido del cliente para poder reactivarlo al pagar
      if (!contrato && factura.clienteId) {
        contrato = await manager.findOne(Contrato, {
          where: { clienteId: factura.clienteId, empresaId, estado: EstadoContrato.SUSPENDIDO },
          order: { fechaEstado: 'DESC' },
        });
      }

      // PASO 3 — Determinar estado inicial del pago
      // Auto-verificado si: MercadoPago (confirmación automática), Yape con OTP,
      // o el cajero marca autoVerificar: true (pagos presenciales inmediatos).
      const esYapeConOtp   = metodoPagoEntity === MetodoPago.YAPE && !!dto.otpYape;
      const puedeAutoverificar = user.roles.includes('Administrador')
                              || user.permisos.includes('pagos:autoverificar');
      const autoVerificado = metodoPagoEntity === MetodoPago.MERCADOPAGO
                          || esYapeConOtp
                          || (dto.autoVerificar === true && puedeAutoverificar);
      const estadoInicial  = autoVerificado ? EstadoPago.VERIFICADO : EstadoPago.PENDIENTE_VERIFICACION;

      const pago = manager.create(Pago, {
        empresaId,
        clienteId:       factura.clienteId,
        facturaId:       dto.facturaId,
        contratoId:      factura.contratoId ?? null,
        monto:           dto.monto,
        moneda:          'PEN',
        metodoPago:      metodoPagoEntity,
        numeroOperacion: dto.numeroOperacion,
        fechaPago:       dto.fechaPago ?? new Date().toISOString().split('T')[0],
        estado:          estadoInicial,
        cajeroId:        user.sub,
        verificadoPor:   autoVerificado ? user.sub : null,
        verificadoEn:    autoVerificado ? new Date() : null,
        comprobanteUrl: dto.voucherUrl ?? null,
        // Metadatos Yape en mpDetail hasta que se añadan columnas dedicadas
        mpDetail: (dto.celularYape || dto.otpYape)
          ? { celularYape: dto.celularYape ?? null, otpYape: dto.otpYape ?? null }
          : null,
      });

      const saved = await manager.save(Pago, pago);

      // PASO 4 — Si auto-verificado: actualizar factura y contrato dentro de la TX
      if (autoVerificado) {
        // UPDATE atómico: evita la race condition leer-calcular-escribir.
        // Si el monto excede el saldo, el WHERE lo rechaza y lanzamos error.
        const result = await manager.query<{ id: string }[]>(`
          UPDATE facturas
          SET
            monto_pagado = monto_pagado::numeric + $1::numeric,
            estado = CASE
              WHEN monto_pagado::numeric + $1::numeric >= total::numeric THEN 'pagada'::estado_factura
              ELSE 'pagada_parcial'::estado_factura
            END,
            fecha_pago = CASE
              WHEN monto_pagado::numeric + $1::numeric >= total::numeric THEN CURRENT_DATE
              ELSE fecha_pago
            END
          WHERE id = $2 AND deleted_at IS NULL
            AND estado NOT IN ('pagada', 'anulada')
            AND $1::numeric <= (total::numeric - monto_pagado::numeric + 0.01)
          RETURNING id
        `, [dto.monto, factura.id]);

        if (!result.length) {
          throw new BadRequestException(
            `No se pudo aplicar el pago: la factura ya está pagada o el monto S/ ${dto.monto} excede el saldo`,
          );
        }

        // Marcar para reactivación vía worker (el worker hace el UPDATE completo:
        // deuda_total=0, meses_deuda=0, en_prorroga=false, fecha_vencimiento, historial).
        // Solo encolar si la deuda total quedó en cero tras este pago.
        // Cubre facturas con contrato_id directo y las sin vínculo (por cliente_id).
        const estadosReactivables = [
          EstadoContrato.SUSPENDIDO,
          EstadoContrato.CORTADO,
          EstadoContrato.MOROSO,
        ];
        if (contrato && estadosReactivables.includes(contrato.estado)) {
          const [deudaRow] = await manager.query<{ deuda: string }[]>(`
            SELECT COALESCE(SUM(f.saldo), 0)::DECIMAL AS deuda
            FROM facturas f
            WHERE (f.contrato_id = $1 OR (f.contrato_id IS NULL AND f.cliente_id = $2))
              AND f.estado IN ('emitida', 'pagada_parcial', 'vencida', 'en_cobranza')
              AND f.deleted_at IS NULL
          `, [contrato.id, factura.clienteId]);
          if (parseFloat(deudaRow?.deuda ?? '0') <= 0) {
            if (factura.contratoId) {
              // Factura vinculada a un contrato específico → solo ese
              contratosParaReactivar.push(contrato);
            } else {
              // Factura unificada (contrato_id null) → reactivar TODOS los contratos bloqueados
              const todos = await manager.find(Contrato, {
                where: [
                  { clienteId: factura.clienteId, empresaId, estado: EstadoContrato.SUSPENDIDO },
                  { clienteId: factura.clienteId, empresaId, estado: EstadoContrato.CORTADO },
                  { clienteId: factura.clienteId, empresaId, estado: EstadoContrato.MOROSO },
                ],
              });
              contratosParaReactivar.push(...todos);
            }
          }
        } else if (contrato && contrato.estado === EstadoContrato.ACTIVO && contrato.enProrroga) {
          // Contrato activo en prórroga: si la deuda queda en cero al pagar, marcar promesa cumplida
          // y limpiar address-list prorroga en MikroTik. No reprovisionamos porque el servicio ya está activo.
          const [deudaRow] = await manager.query<{ deuda: string }[]>(`
            SELECT COALESCE(SUM(f.saldo), 0)::DECIMAL AS deuda
            FROM facturas f
            WHERE (f.contrato_id = $1 OR (f.contrato_id IS NULL AND f.cliente_id = $2))
              AND f.estado IN ('emitida', 'pagada_parcial', 'vencida', 'en_cobranza')
              AND f.deleted_at IS NULL
          `, [contrato.id, factura.clienteId]);
          if (parseFloat(deudaRow?.deuda ?? '0') <= 0) {
            contratosEnProrroga.push(contrato.id);
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
      descripcion:  `Pago ${dto.metodoPago} S/ ${dto.monto} | factura: ${dto.facturaId} | ${savedPago.estado}`,
      req,
    });

    // ── Emitir evento de notificación si el pago fue auto-verificado ─
    if (savedPago.estado === EstadoPago.VERIFICADO) {
      this.emitirEventoPagoRecibido(savedPago);
    }

    this.logger.log(
      `Pago registrado: ${savedPago.id} | ${metodoPagoEntity} | S/ ${dto.monto} | ${savedPago.estado}`,
    );

    return savedPago;
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
      'SELECT empresa_id, cliente_id, contrato_id, total, saldo FROM facturas WHERE id = $1',
      [facturaId],
    );

    if (!facturaRow) {
      this.logger.warn(`Webhook MP: factura ${facturaId} no encontrada`);
      return;
    }

    const { empresa_id: empresaId, cliente_id: clienteId, contrato_id: contratoId } = facturaRow;

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
          contratoId,
          monto:           mpPayment.transaction_amount,
          moneda:          mpPayment.currency_id || 'PEN',
          metodoPago:      MetodoPago.MERCADOPAGO,
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
      let contratoId  = pago.contratoId;
      const empresaId = pago.empresaId;

      // ── A. Aplicar a factura específica ──────────────────
      if (facturaId) {
        await this.facturacionSvc.aplicarPago(
          facturaId,
          Number(pago.monto),
          empresaId,
          pago.fechaPago,
        );
        this.logger.log(`Pago ${pago.id} aplicado a factura ${facturaId}`);

        // Obtener contratoId de la factura si no vino en el pago
        if (!contratoId) {
          const [row] = await this.ds.query(
            'SELECT contrato_id FROM facturas WHERE id = $1',
            [facturaId],
          );
          contratoId = row?.contrato_id;
        }
      }

      // ── B. Si hay contrato, verificar si se saldó la deuda ─
      if (contratoId) {
        await this.verificarYReactivarContrato(contratoId, empresaId, user, pago.id);
      } else if (pago.clienteId) {
        // Factura unificada (contrato_id null): verificar deuda total del cliente
        // y reactivar TODOS los contratos suspendidos si quedaron en cero
        const [deudaRow] = await this.ds.query(
          `SELECT COALESCE(SUM(f.saldo), 0)::DECIMAL AS deuda
           FROM facturas f
           WHERE f.cliente_id = $1
             AND f.estado IN ('emitida', 'pagada_parcial', 'vencida', 'en_cobranza')
             AND f.deleted_at IS NULL`,
          [pago.clienteId],
        );
        if (parseFloat(deudaRow?.deuda ?? '0') <= 0) {
          // Incluir contratos suspendidos/morosos/cortados (reactivación) Y contratos
          // activos con prorroga vigente (cumplimiento de promesa sin cambio de estado).
          const afectados: { id: string }[] = await this.ds.query(
            `SELECT id FROM contratos
             WHERE cliente_id = $1 AND empresa_id = $2 AND deleted_at IS NULL
               AND (
                 estado IN ('suspendido', 'moroso', 'cortado')
                 OR (estado = 'activo' AND en_prorroga = TRUE)
               )`,
            [pago.clienteId, empresaId],
          );
          for (const { id: cId } of afectados) {
            await this.verificarYReactivarContrato(cId, empresaId, user, pago.id);
          }
        }
      }

    } catch (err) {
      // Loggear pero no fallar — el pago ya quedó registrado
      this.logger.error(
        `Error aplicando pago ${pago.id} a factura/contrato: ${err.message}`,
        err.stack,
      );
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
    // Recalcular deuda total del contrato
    const { deuda, meses } = await this.pagoRepo.calcularDeudaContrato(contratoId);

    // Actualizar deuda en el contrato
    await this.contratosSvc.actualizarDeuda(contratoId, deuda, meses, empresaId);

    this.logger.debug(
      `Contrato ${contratoId}: deuda recalculada = S/ ${deuda} (${meses} meses)`,
    );

    // Si la deuda quedó en cero, verificar si el contrato está suspendido
    if (deuda <= 0) {
      // Notificar a PromesasPagoService para marcar cumplimiento si hay una activa.
      // emitAsync garantiza que la promesa quede 'cumplida' antes de cambiarEstado
      // y que cualquier fallo del handler suba en lugar de perderse silenciosamente.
      await this.events.emitAsync('promesa.verificar_cumplimiento', {
        contratoId,
        pagoId: pagoId ?? '',
        deuda,
      }).catch((err: any) =>
        this.logger.error(
          `[PAGO] Error al notificar cumplimiento de promesa para contrato ${contratoId}: ${err.message}`,
          err.stack,
        ),
      );
      let contrato: any;
      try {
        contrato = await this.contratosSvc.findOne(contratoId, empresaId);
      } catch {
        return; // Contrato no encontrado, ignorar
      }

      const estadosReactivables = [
        EstadoContrato.SUSPENDIDO,
        EstadoContrato.CORTADO,  // post-prorroga: MikroTik ya cortó pero deuda saldada → reactivar
        EstadoContrato.MOROSO,   // deuda saldada antes del corte → normalizar a activo
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
        contratoId:     pago.contratoId ?? undefined,
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
    if (dto.metodoPago      !== undefined) updates.metodoPago      = dto.metodoPago;
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
  // ELIMINAR PAGO — revierte el monto de la factura si verificado
  // ────────────────────────────────────────────────────────────
  async eliminar(
    id:        string,
    empresaId: string,
    user:      JwtPayload,
    req?:      any,
  ): Promise<void> {
    const pago = await this.findOne(id, empresaId);
    if (pago.conciliado) throw new BadRequestException('No se puede eliminar un pago conciliado');

    await this.ds.transaction(async (manager) => {
      if (pago.facturaId) {
        await manager.query(
          `UPDATE facturas
              SET monto_pagado = GREATEST(0, monto_pagado - $1),
                  updated_at   = NOW(),
                  estado = CASE
                    WHEN estado = 'anulada'::estado_factura THEN 'anulada'::estado_factura
                    WHEN GREATEST(0, monto_pagado - $1) >= total THEN 'pagada'::estado_factura
                    WHEN GREATEST(0, monto_pagado - $1) > 0     THEN 'pagada_parcial'::estado_factura
                    WHEN fecha_vencimiento < CURRENT_DATE        THEN 'vencida'::estado_factura
                    ELSE 'emitida'::estado_factura
                  END
            WHERE id = $2 AND empresa_id = $3`,
          [pago.monto, pago.facturaId, empresaId],
        );
      }
      await manager.delete(Pago, id);
    });

    await this.auditoria.logDelete({
      empresaId, usuarioId: user.sub, usuarioEmail: user.email,
      modulo: 'pagos', entidadId: id,
      descripcion: `Pago eliminado: S/ ${pago.monto} | ${pago.metodoPago}`, req,
    });
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
  async getCuentasBancarias(empresaId: string): Promise<CuentaBancaria[]> {
    return this.pagoRepo.findCuentas(empresaId);
  }

  async createCuentaBancaria(
    dto:  CreateCuentaBancariaDto,
    user: JwtPayload,
  ): Promise<CuentaBancaria> {
    if (dto.esPrincipal) {
      // Desmarcar la cuenta principal anterior
      await this.ds.query(
        'UPDATE cuentas_bancarias SET es_principal = false WHERE empresa_id = $1',
        [user.empresaId],
      );
    }
    return this.pagoRepo.createCuenta({ ...dto, empresaId: user.empresaId });
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
        AND estado      IN ('emitida', 'vencida', 'en_cobranza', 'pagada_parcial')
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
