import { Injectable, NotFoundException, ConflictException, BadRequestException, Logger, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryRunner } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NOTIFICATION_EVENTS } from '../notificaciones/events/notification.events';
import * as crypto from 'crypto';
import { ContratoRepository } from './repositories/contrato.repository';
import { PlanesService } from '../planes/planes.service';
import { AuditoriaService } from '../auth/auditoria.service';
import { JwtPayload } from '../../common/decorators/current-user.decorator';
import { Contrato, EstadoContrato, ContratoHistorial, TipoPago } from './entities/contrato.entity';
import { SegmentoIpv4, IpAsignada } from './entities/red.entity';
import { CreateContratoDto, UpdateContratoDto, FilterContratoDto, CambiarEstadoContratoDto, OtorgarProrrogaDto } from './dto/contrato.dto';
import { formatPaginatedResponse } from '../../common/utils/pagination.util';
import { filasUpdateReturning } from '../../common/utils/pg-result.util';
import { encrypt, decrypt } from '../../common/utils/encryption.util';
import { getNextAvailableIp, getCidrRange, isValidIp } from '../../common/utils/ip.util';
import { esExito, mensajeDe } from '../../common/domain/resultado-operacion';
import { WirelessService } from '../mikrotik/services/wireless.service';
import { RouterConnectionPool, RouterCredentials } from '../mikrotik/services/connection-pool.service';
import { PppoeService } from '../mikrotik/services/pppoe.service';
import { ArpService } from '../mikrotik/services/arp.service';
import { FirewallService } from '../mikrotik/services/firewall.service';
import { MikrotikService } from '../mikrotik/mikrotik.service';
import { SmartoltApiService } from '../smartolt/smartolt-api.service';
import { XuiLinesService } from '../xui/xui-lines.service';
import { SagaLogService } from '../sagas/saga-log.service';
import { SagaTipo } from '../sagas/entities/saga-log.entity';
import { OutboxRedService }    from '../outbox-red/outbox-red.service';
import { PromesasPagoService } from '../promesas-pago/promesas-pago.service';
import { DeudaPorContratoService } from '../facturacion/deuda-por-contrato.service';
import { FacturacionService } from '../facturacion/facturacion.service';
import { PoliticaFacturacionService } from '../facturacion/politica-facturacion.service';
import { cargoDelPeriodo, diasFacturables } from '../facturacion/domain/prorrateo';

export interface ActivarResultado {
  contrato:     Contrato;
  mikrotikOk:   boolean;
  antenaOk:     boolean;
  advertencias: string[];
}

const withTimeout = <T>(p: Promise<T>, ms: number, label: string): Promise<T> =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`timeout ${ms}ms en ${label}`)), ms))]);

/**
 * `MOROSO` desapareció de aquí el 2026-08-08 junto con el valor del enum: la mora es una
 * **etiqueta derivada** de las facturas (`facturacion/domain/mora.ts`), no un estado.
 * Comprobado antes de borrarlo: cero contratos y cero filas de historial lo usaron nunca.
 */
const TRANSICIONES: Record<EstadoContrato, EstadoContrato[]> = {
  [EstadoContrato.PENDIENTE_ACTIVACION]: [EstadoContrato.ACTIVO, EstadoContrato.BAJA_DEFINITIVA],
  [EstadoContrato.ACTIVO]:               [EstadoContrato.SUSPENDIDO, EstadoContrato.BAJA_DEFINITIVA],
  [EstadoContrato.SUSPENDIDO]:           [EstadoContrato.ACTIVO, EstadoContrato.BAJA_DEFINITIVA],
  // CORTADO se queda sin orígenes y sin destinos: retirado el 2026-08-09 (fase 1). Sin ninguna
  // transición que lleve a él, el estado es inalcanzable aunque el valor siga vivo en el enum
  // de PostgreSQL — el mismo trato que recibió MOROSO.
  [EstadoContrato.CORTADO]:              [],
  [EstadoContrato.BAJA_DEFINITIVA]:      [],
};

// Guardas de negocio por transición — condición que debe cumplirse además de la transición válida.
// Se evalúan solo cuando !automatico && !adminOverride.
//
// H-7 (2026-08-09): las dos guardas de reactivación leían `c.deudaTotal` —la deuda TOTAL— y por
// tanto un comprobante emitido y aún sin vencer impedía devolver el servicio a un abonado que
// acababa de pagar todo lo que debía. Ahora reciben la deuda **vencida**, con la única definición
// que hay (`DeudaPorContratoService.vencidaQueBloquea`), la misma que usa la reactivación
// automática al registrar un pago. Antes eran dos criterios distintos para la misma pregunta, y
// los dos estaban mal.
interface ContextoGuarda {
  contrato: Contrato;
  /** Deuda VENCIDA e impaga. No es `contrato.deudaTotal`, que incluye lo aún no vencido. */
  deudaVencida: number;
}

type GuardaFn = (ctx: ContextoGuarda) => string | null; // null = pasa, string = mensaje de error

const bloqueaReactivacion = ({ deudaVencida }: ContextoGuarda): string | null =>
  deudaVencida > 0
    ? `Deuda vencida S/ ${deudaVencida.toFixed(2)} — use adminOverride para forzar`
    : null;

const GUARDAS: Partial<Record<string, GuardaFn>> = {
  [`${EstadoContrato.SUSPENDIDO}->${EstadoContrato.ACTIVO}`]: bloqueaReactivacion,
  [`${EstadoContrato.ACTIVO}->${EstadoContrato.SUSPENDIDO}`]:
    ({ contrato: c }) => (c.enProrroga && c.prorrogaHasta && new Date(c.prorrogaHasta) > new Date())
      ? `Prórroga activa hasta ${c.prorrogaHasta} — use adminOverride para suspender antes` : null,
};

@Injectable()
export class ContratosService {
  private readonly logger = new Logger(ContratosService.name);

  constructor(
    private readonly contratoRepo: ContratoRepository,
    private readonly planesSvc: PlanesService,
    private readonly auditoria: AuditoriaService,
    private readonly config: ConfigService,
    private readonly wirelessSvc: WirelessService,
    private readonly pool: RouterConnectionPool,
    private readonly pppoeSvc: PppoeService,
    private readonly arpSvc: ArpService,
    private readonly firewallSvc: FirewallService,
    private readonly mikrotikSvc: MikrotikService,
    private readonly smartoltApi: SmartoltApiService,
    private readonly xuiLinesSvc: XuiLinesService,
    private readonly sagaLog: SagaLogService,
    private readonly outboxRed: OutboxRedService,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly events: EventEmitter2,
    private readonly promesasSvc: PromesasPagoService,
    private readonly deudaSvc: DeudaPorContratoService,
    private readonly facturacionSvc: FacturacionService,
    private readonly politicaSvc: PoliticaFacturacionService,
  ) {}

  async create(dto: CreateContratoDto, user: JwtPayload, req?: any): Promise<Contrato> {
    // ── Pre-tx: validaciones read-only ────────────────────────
    let plan: any = null;
    if (dto.planId) {
      plan = await this.planesSvc.findOne(dto.planId, user.empresaId);
      if (!plan.activo) throw new BadRequestException(`Plan "${plan.nombre}" inactivo`);
    }

    if (dto.macAddress?.trim()) {
      const [macExistente] = await this.dataSource.query<any[]>(
        `SELECT numero_contrato FROM servicios WHERE empresa_id = $1 AND mac_address = $2 AND estado != 'baja_definitiva' AND deleted_at IS NULL LIMIT 1`,
        [user.empresaId, dto.macAddress.trim()],
      );
      if (macExistente) throw new ConflictException(`La MAC ${dto.macAddress} ya está registrada en el contrato ${macExistente.numero_contrato}`);
    }

    if (dto.routerId) {
      const [router] = await this.dataSource.query<any[]>(
        `SELECT nombre FROM routers WHERE id = $1 AND empresa_id = $2 AND deleted_at IS NULL`,
        [dto.routerId, user.empresaId],
      );
      if (!router) throw new BadRequestException('Router no encontrado');

      const authEfectivo = dto.tipoAuth ?? 'ninguna';
      const requiereMac  = authEfectivo === 'amarre_ip_mac' || authEfectivo === 'amarre_ip_mac_dhcp';
      if (requiereMac && !dto.macAddress?.trim()) {
        throw new BadRequestException(
          `La autenticación por Amarre IP/MAC requiere dirección MAC.`,
        );
      }

      if (dto.segmentoId) {
        const [seg] = await this.dataSource.query<any[]>(
          `SELECT router_id AS "routerId", nombre FROM segmentos_ipv4 WHERE id = $1 AND empresa_id = $2`,
          [dto.segmentoId, user.empresaId],
        );
        if (!seg) throw new BadRequestException('Segmento de red no encontrado');
        if (seg.routerId !== dto.routerId) {
          throw new BadRequestException(
            `El segmento "${seg.nombre}" no está asignado al router "${router.nombre}". ` +
            `Corrija la asignación en Red → Segmentos o seleccione el segmento correcto.`,
          );
        }
        // PPPoE asigna IPs desde un pool interno del servidor PPPoE, no desde una interfaz LAN.
        // Solo amarre_ip_mac y amarre_ip_mac_dhcp requieren la subred configurada en el router.
        if (authEfectivo !== 'pppoe' && authEfectivo !== 'ninguna') {
          await this.verificarSubredEnRouter(dto.routerId, dto.segmentoId, user.empresaId);
        }
      }
    }

    // El número de contrato NO se genera aquí: se genera DENTRO de la transacción de abajo,
    // porque su serialización depende de un advisory lock de transacción que debe seguir
    // tomado hasta el INSERT. Generarlo antes reabriría la ventana que el lock cierra.

    // El usuario PPPoE tampoco se genera aquí, por la MISMA razón que el número de contrato:
    // se derivaba de un `COUNT(*)` leído fuera de la transacción, así que dos altas
    // simultáneas del mismo cliente calculaban el mismo sufijo y la segunda moría contra
    // `uq_contratos_empresa_pppoe`. Verificado en producción el 2026-07-29 lanzando tres
    // altas concurrentes: el correlativo aguantó y esta colisionó, que es como se encontró.
    const passwordPlain  = dto.passwordPppoePlain || this.generarPassword(12);
    let passwordCifrado: string;
    try { passwordCifrado = encrypt(passwordPlain); }
    catch { passwordCifrado = passwordPlain; }

    // ── Transacción atómica: IP lock + contrato + ips_asignadas ─
    // El bloqueo pesimista sobre segmentos_ipv4 serializa la asignación
    // concurrente entre las instancias PM2 del clúster.
    // Si cualquier paso falla el rollback libera la IP automáticamente.
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    let saved: Contrato;
    let ipAsignada: string | null = null;

    try {
      if (dto.ipManual) {
        if (!isValidIp(dto.ipManual)) throw new BadRequestException(`IP inválida: ${dto.ipManual}`);
        if (dto.segmentoId) {
          // Bloqueo pesimista en el segmento para serializar acceso al pool
          await qr.manager
            .createQueryBuilder(SegmentoIpv4, 's')
            .setLock('pessimistic_write')
            .where('s.id = :id AND s.empresa_id = :eId', { id: dto.segmentoId, eId: user.empresaId })
            .getOne();
          const ocupada = (await qr.manager.count(IpAsignada, {
            where: { ipAddress: dto.ipManual, segmentoId: dto.segmentoId, activa: true },
          })) > 0;
          if (ocupada) {
            this.logger.warn(`Race condition: IP ${dto.ipManual} ya ocupada — asignando siguiente libre del pool ${dto.segmentoId}`);
            ipAsignada = await this.calcularNextIpDesdePool(qr, dto.segmentoId, user.empresaId);
          } else {
            ipAsignada = dto.ipManual;
          }
        } else {
          ipAsignada = dto.ipManual;
        }
      } else if (dto.segmentoId) {
        ipAsignada = await this.calcularNextIpDesdePool(qr, dto.segmentoId, user.empresaId);
      }

      // Serializado por (empresa, año) con advisory lock de transacción: el número queda
      // reservado hasta el commit, así que dos altas simultáneas no pueden proponer el mismo.
      const numeroContrato = await this.contratoRepo.generarNumeroContrato(user.empresaId, qr.manager);

      // Usuario PPPoE — bajo el MISMO lock, ya tomado por la línea anterior. Se calcula aquí
      // y no antes para que el `COUNT` que decide el sufijo y el INSERT que lo consume estén
      // dentro de la misma sección crítica.
      const [{ total: totalContratos }] = await qr.manager.query(
        `SELECT COUNT(*)::int AS total FROM servicios
          WHERE cliente_id = $1 AND empresa_id = $2 AND estado != 'baja_definitiva' AND deleted_at IS NULL`,
        [dto.clienteId, user.empresaId],
      );
      const base      = `cli_${dto.clienteId.replace(/-/g, '').substring(0, 8)}`;
      const pppoeBase = dto.usuarioPppoe || (totalContratos > 0 ? `${base}_${totalContratos + 1}` : base);

      const [pppoeExistente] = await qr.manager.query(
        `SELECT numero_contrato FROM servicios
          WHERE empresa_id = $1 AND usuario_pppoe = $2 AND estado != 'baja_definitiva' AND deleted_at IS NULL
          LIMIT 1`,
        [user.empresaId, pppoeBase],
      );
      if (pppoeExistente) {
        throw new ConflictException(
          `El usuario PPPoE "${pppoeBase}" ya está en uso (contrato ${pppoeExistente.numero_contrato})`,
        );
      }
      const usuarioPppoe = pppoeBase;

      // Guardar contrato (dentro de la tx)
      const entity = qr.manager.create(Contrato, {
        ...dto,
        empresaId:      user.empresaId,
        numeroContrato,
        estado:         EstadoContrato.PENDIENTE_ACTIVACION,
        fechaEstado:    new Date(),
        usuarioPppoe,
        passwordPppoe:  passwordCifrado,
        ipAsignada,
        precioMensual:  dto.precioMensual ?? (plan ? Number(plan.precio) : 0),
        diaFacturacion: dto.diaFacturacion ?? this.config.get('app.billing.day', 1),
        diasProrroga:   dto.diasProrroga ?? 3,
        deudaTotal: 0, mesesDeuda: 0, aprovisionado: false,
        createdBy: user.sub, updatedBy: user.sub,
      });
      saved = await qr.manager.save(entity);

      // Registrar IP en ips_asignadas dentro de la misma tx
      // → rollback automático libera la IP si algo falla después
      if (ipAsignada && dto.segmentoId) {
        await qr.manager.save(
          qr.manager.create(IpAsignada, {
            empresaId: user.empresaId, segmentoId: dto.segmentoId,
            contratoId: saved.id, ipAddress: ipAsignada,
            tipo: 'cliente', activa: true,
          }),
        );
      }

      await qr.commitTransaction();
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }

    // ── Post-commit: historial y auditoría ────────────────────
    await this.contratoRepo.guardarHistorial({ servicioId:saved.id, empresaId:user.empresaId, estadoNuevo:EstadoContrato.PENDIENTE_ACTIVACION, motivo:`Plan: ${plan?.nombre ?? 'sin plan'} | IP: ${ipAsignada||'sin asignar'}`, usuarioId:user.sub });
    await this.auditoria.logCreate({ empresaId:user.empresaId, usuarioId:user.sub, usuarioEmail:user.email, modulo:'contratos', entidadId:saved.id, descripcion:`Contrato ${saved.numeroContrato}`, req });
    this.logger.log(`Contrato creado: ${saved.numeroContrato} | ip: ${ipAsignada}`);

    // Al crear nuevo contrato se elimina la nota de baja del abonado (reactivación)
    await this.dataSource.query(
      `UPDATE clientes SET nota_baja = NULL WHERE id = $1 AND nota_baja IS NOT NULL`,
      [dto.clienteId],
    );

    // ── READMISIÓN del ex-cliente ────────────────────────────────────────────
    // Caso corriente del negocio: el abonado se va, la empresa recoge los equipos y le da
    // baja definitiva conservando su facturación; meses después vuelve y se reutiliza su
    // perfil. Contratarle un servicio ES el acto de readmisión — exigir además que un
    // operador cambie el estado a mano antes de poder activar era un paso invisible que
    // nadie descubría (2026-07-29: el contrato de un ex-cliente no se dejaba activar y el
    // error hablaba del MikroTik, no del estado del cliente).
    //
    // Se readmite a `pendiente_activacion`, NO a `activo`: tener contrato no es tener
    // servicio. La promoción a `activo` la hace `activar()` cuando el aprovisionamiento
    // sale bien, igual que para un cliente nuevo — un solo camino, sin atajos.
    const [readmitido] = filasUpdateReturning<{ id: string }>(
      await this.dataSource.query(
        `UPDATE clientes SET estado = 'pendiente_activacion', fecha_estado = NOW(), updated_by = $2
         WHERE id = $1 AND estado = 'baja_definitiva'
         RETURNING id`,
        [dto.clienteId, user.sub],
      ),
    );
    if (readmitido) {
      await this.dataSource.query(
        `INSERT INTO clientes_historial_estados
           (cliente_id, empresa_id, estado_anterior, estado_nuevo, motivo, usuario_id)
         VALUES ($1, $2, 'baja_definitiva', 'pendiente_activacion', $3, $4)`,
        [dto.clienteId, user.empresaId,
         `Readmisión automática — nuevo contrato ${saved.numeroContrato}`, user.sub],
      ).catch((e) => this.logger.error(`create → historial readmisión: ${e?.message}`));
      this.logger.log(`Cliente ${dto.clienteId} readmitido (baja_definitiva → pendiente_activacion) por contrato ${saved.numeroContrato}`);
    }

    await this.emitirComprobanteDeAlta(saved, plan, dto, user, req);

    // Alta automática de line IPTV si el plan lo trae habilitado — no bloquea
    // ni revierte la creación del contrato si XUI falla (módulo degradable).
    if (plan?.cuentaIptv) {
      setImmediate(() => {
        this.xuiLinesSvc.crearLineParaContrato(saved.id, user.empresaId)
          .then((r) => { if (!esExito(r)) this.logger.warn(`XUI crearLineParaContrato (contrato ${saved.id}): ${mensajeDe(r)}`); })
          .catch((e: any) => this.logger.warn(`XUI crearLineParaContrato (contrato ${saved.id}): ${e?.message}`));
      });
    }

    return saved;
  }

  /**
   * Primer comprobante del alta: la mensualidad adelantada del prepago y/o el cobro único
   * de instalación.
   *
   * **Esto vivía en el navegador** —`ClienteWizard.tsx` y `ClienteDetalle.tsx`, hasta el
   * 2026-08-09— con cuatro defectos encadenados que este método cierra de una vez:
   *
   * - Un alta por API, una pestaña cerrada o la red caída entre las dos llamadas dejaban al
   *   abonado **sin comprobante**. Emitirlo es parte del alta, no un efecto secundario de la
   *   pantalla que la dispara.
   * - El fallo caía en un `catch {}` vacío mientras el toast decía «registrado
   *   correctamente». El operador se enteraba semanas después, al no ver el cobro.
   * - El periodo se calculaba a mano (`hoy` → `hoy + 1 mes`) en vez de con el ciclo real del
   *   abonado, así que el comprobante declaraba un periodo que no era el que amparaba.
   * - No se enviaba `contratoId`: la deuda del segundo servicio de un cliente no se imputaba
   *   a ningún contrato.
   *
   * El vencimiento **no se pasa a propósito**: lo fija `FacturacionService.create` desde el
   * día de pago del abonado y rechaza cualquier otro.
   *
   * **No cubre el prorrateo** del tramo entre la instalación y el cierre del ciclo en curso.
   * Eso es H-6 y va como cargo al siguiente comprobante, no aquí.
   */
  private async emitirComprobanteDeAlta(
    saved: Contrato,
    plan: any,
    dto: CreateContratoDto,
    user: JwtPayload,
    req?: any,
  ): Promise<void> {
    const montoInstalacion = Number(dto.costoInstalacion ?? 0);

    try {
      const politica  = await this.politicaSvc.resolver(dto.clienteId, user.empresaId);
      const esPrepago = politica.tipo === 'prepago';

      // Postpago sin instalación no emite nada al alta: su primer comprobante sale del ciclo
      // mensual, por detrás del servicio ya consumido. Es la definición de postpago.
      if (!esPrepago && montoInstalacion <= 0) return;

      const vencimiento = this.politicaSvc.proximoVencimiento(politica, new Date());
      const periodo     = this.politicaSvc.periodoServicio(politica, vencimiento);

      const items: { descripcion: string; cantidad: number; precioUnitario: number }[] = [];

      if (esPrepago) {
        // El precio sale del CONTRATO, no del plan: es donde vive el precio efectivo una vez
        // aplicado el descuento pactado con este abonado.
        items.push({
          descripcion:    plan?.nombre ?? 'Servicio de internet',
          cantidad:       1,
          precioUnitario: saved.precioConDescuento,
        });
      }

      if (montoInstalacion > 0) {
        items.push({ descripcion: 'Costo de instalación', cantidad: 1, precioUnitario: montoInstalacion });
      }

      const factura = await this.facturacionSvc.create(
        {
          clienteId:     dto.clienteId,
          contratoId:    saved.id,
          periodoInicio: periodo.inicio,
          periodoFin:    periodo.fin,
          items,
        },
        user,
        req,
      );

      this.logger.log(
        `Alta ${saved.numeroContrato}: ${factura.serie}-${factura.correlativo} · ` +
        `${periodo.inicio}→${periodo.fin} · vence ${factura.fechaVencimiento} · total ${factura.total}`,
      );
    } catch (e: any) {
      // NO se relanza. El contrato ya está comprometido en la base: tumbar el alta entera
      // porque falló un correlativo dejaría al abonado sin servicio para arreglar un
      // problema de papeleo, y el operador ya no tiene los datos en pantalla.
      //
      // Pero tampoco se calla, que es exactamente lo que hacía el `catch {}` del navegador.
      // Queda en auditoría —durable y consultable desde el ERP— con lo que hay que hacer.
      this.logger.error(
        `Alta ${saved.numeroContrato}: no se pudo emitir el primer comprobante — ${e?.message}`,
      );
      // El registro del fallo va en su propio try. Un manejador de errores que puede
      // lanzar no es un manejador: haría fallar el alta por la vía que existe justamente
      // para no hacerla fallar. Lo destapó el spec de contratos, cuyo doble de auditoría
      // no devuelve promesa — y en producción basta con que la tabla esté bloqueada.
      try {
        await this.auditoria.logCreate({
          empresaId: user.empresaId, usuarioId: user.sub, usuarioEmail: user.email,
          modulo: 'facturacion', entidadId: saved.id,
          descripcion:
            `FALLÓ el primer comprobante del contrato ${saved.numeroContrato}: ${e?.message}. ` +
            `Emitirlo a mano desde Facturación.`,
          req,
        });
      } catch (err: any) {
        this.logger.error(`auditoría del fallo de emisión: ${err?.message}`);
      }
    }
  }

  // ── Actualizar servicio con re-provisión MikroTik ───────────
  async actualizarServicio(id: string, dto: UpdateContratoDto, user: JwtPayload, req?: any): Promise<Contrato> {
    const existing: any = await this.findOne(id, user.empresaId);

    if (dto.version !== undefined && existing.version !== dto.version) {
      throw new ConflictException({
        code: 'CONCURRENCY_CONFLICT',
        message: 'Los datos fueron modificados por otro usuario. Recargue la página e intente nuevamente.',
      });
    }

    // ── Re-asignación de IP si cambia el segmento ──────────────
    let newIp: string | undefined;
    const segmentoCambio = dto.segmentoId && dto.segmentoId !== existing.segmentoId;

    if (segmentoCambio) {
      const qr = this.dataSource.createQueryRunner();
      await qr.connect();
      await qr.startTransaction();
      try {
        // Liberar IP vieja DENTRO de la TX: si falla el resto, el rollback la reactiva
        if (existing.ipAsignada && existing.segmentoId) {
          await qr.manager.update(IpAsignada, { contratoId: id, activa: true }, { activa: false, liberadaEn: new Date() });
        }
        newIp = dto.ipManual?.trim()
          ? dto.ipManual.trim()
          : await this.calcularNextIpDesdePool(qr, dto.segmentoId!, user.empresaId);

        // Validar IP manual no ocupada si fue provista explícitamente
        if (dto.ipManual?.trim()) {
          const ocupada = await qr.manager.count(IpAsignada, {
            where: { ipAddress: dto.ipManual.trim(), segmentoId: dto.segmentoId!, activa: true },
          });
          if (ocupada > 0) {
            this.logger.warn(`Race condition: IP ${dto.ipManual} ya ocupada — asignando siguiente libre`);
            newIp = await this.calcularNextIpDesdePool(qr, dto.segmentoId!, user.empresaId);
          }
        }

        await qr.manager.save(
          qr.manager.create(IpAsignada, {
            empresaId:   user.empresaId,
            segmentoId:  dto.segmentoId!,
            contratoId:  id,
            ipAddress:   newIp,
            tipo:        'cliente',
            activa:      true,
          }),
        );
        await qr.commitTransaction();
      } catch (err) {
        await qr.rollbackTransaction();
        throw err;
      } finally {
        await qr.release();
      }
    } else if (dto.segmentoId && !existing.ipAsignada) {
      // Mismo segmento pero contrato sin IP asignada → asignación inicial
      const qr = this.dataSource.createQueryRunner();
      await qr.connect();
      await qr.startTransaction();
      try {
        if (dto.ipManual?.trim()) {
          const ocupada = await qr.manager.count(IpAsignada, {
            where: { ipAddress: dto.ipManual.trim(), segmentoId: dto.segmentoId, activa: true },
          });
          newIp = ocupada > 0
            ? await this.calcularNextIpDesdePool(qr, dto.segmentoId, user.empresaId)
            : dto.ipManual.trim();
        } else {
          newIp = await this.calcularNextIpDesdePool(qr, dto.segmentoId, user.empresaId);
        }

        await qr.manager.save(
          qr.manager.create(IpAsignada, {
            empresaId:  user.empresaId,
            segmentoId: dto.segmentoId,
            contratoId: id,
            ipAddress:  newIp,
            tipo:       'cliente',
            activa:     true,
          }),
        );
        await qr.commitTransaction();
      } catch (err) {
        await qr.rollbackTransaction();
        throw err;
      } finally {
        await qr.release();
      }
    }

    // ── Actualizar campos en BD ─────────────────────────────────
    const { version: _v, ...rest } = dto;
    const upd: any = { ...rest, updatedBy: user.sub };
    delete upd.ipManual;
    delete upd.passwordPppoePlain;

    if (dto.usuarioPppoe)       upd.usuarioPppoe  = dto.usuarioPppoe;
    if (dto.passwordPppoePlain) {
      try { upd.passwordPppoe = encrypt(dto.passwordPppoePlain); }
      catch { upd.passwordPppoe = dto.passwordPppoePlain; }
    }
    if (newIp) upd.ipAsignada = newIp;

    await this.contratoRepo.update(id, upd);

    // ── Responder inmediatamente; hardware en background ───────
    // Capturar el tipoAuth ANTERIOR antes de que el update lo sobreescriba en BD,
    // para que desaprovisionarMikrotik sepa qué tipo de regla eliminar del router.
    const tipoAuthAnterior: string | undefined = (existing as any).tipoAuth ?? undefined;

    const contratoActualizado = await this.findOne(id, user.empresaId);
    await this.auditoria.logUpdate({ empresaId: user.empresaId, usuarioId: user.sub, usuarioEmail: user.email, modulo: 'contratos', entidadId: id, descripcion: 'Actualización de servicio con re-provisión', req });

    // ── Alta/baja automática de line IPTV si cambió el plan ────
    // Evalúa siempre a nivel de ESTE contrato — otros servicios del mismo
    // cliente (otros contratos) son independientes y no se tocan.
    if (dto.planId && dto.planId !== existing.planId) {
      const [planViejo] = await this.dataSource.query<any[]>(
        `SELECT cuenta_iptv AS "cuentaIptv" FROM planes WHERE id = $1`, [existing.planId],
      );
      const [planNuevo] = await this.dataSource.query<any[]>(
        `SELECT cuenta_iptv AS "cuentaIptv" FROM planes WHERE id = $1`, [dto.planId],
      );
      if (planViejo?.cuentaIptv && !planNuevo?.cuentaIptv) {
        setImmediate(() => {
          this.xuiLinesSvc.eliminarLineDeContrato(id, user.empresaId)
            .then((r) => { if (!esExito(r)) this.logger.warn(`XUI eliminarLineDeContrato (contrato ${id}): ${mensajeDe(r)}`); })
            .catch((e: any) => this.logger.warn(`XUI eliminarLineDeContrato (contrato ${id}): ${e?.message}`));
        });
      } else if (!planViejo?.cuentaIptv && planNuevo?.cuentaIptv) {
        setImmediate(() => {
          this.xuiLinesSvc.crearLineParaContrato(id, user.empresaId)
            .then((r) => { if (!esExito(r)) this.logger.warn(`XUI crearLineParaContrato (contrato ${id}): ${mensajeDe(r)}`); })
            .catch((e: any) => this.logger.warn(`XUI crearLineParaContrato (contrato ${id}): ${e?.message}`));
        });
      }
    }

    setImmediate(async () => {
      this.logger.log(`actualizarServicio background → iniciando re-provisión contrato ${id} | tipoAuth anterior: ${tipoAuthAnterior ?? 'desconocido'}`);
      await withTimeout(this.desaprovisionarMikrotik(id, tipoAuthAnterior), 25000, 'desaprovision')
        .catch((e: any) => this.logger.warn(`actualizarServicio desaprovision: ${e?.message}`));
      await withTimeout(this.provisionarMikrotik(id), 25000, 'provision')
        .catch((e: any) => this.logger.warn(`actualizarServicio provision: ${e?.message}`));
      await withTimeout(this.eliminarDeAccessListAntena(id), 15000, 'antena-remove')
        .catch((e: any) => this.logger.warn(`actualizarServicio antena remove: ${e?.message}`));
      await withTimeout(this.registrarEnAccessListAntena(id), 15000, 'antena-register')
        .catch((e: any) => this.logger.warn(`actualizarServicio antena register: ${e?.message}`));
      // FTTH: si cambió la config de autenticación (método, credenciales PPPoE, IP o
      // segmento), re-inyectar la WAN en la ONU (modo routing). Resiliente vía outbox;
      // omite si es bridge o el contrato no tiene ONU FTTH.
      if (dto.usuarioPppoe || dto.passwordPppoePlain || (dto as any).tipoAuth ||
          (dto as any).ipManual || (dto as any).segmentoId) {
        await this.outboxRed.encolarActualizarWanOnu(id, user.empresaId)
          .catch((e: any) => this.logger.warn(`actualizarServicio WAN ONU: ${e?.message}`));
      }
      this.logger.log(`actualizarServicio background → re-provisión completada contrato ${id}`);
    });

    return contratoActualizado;
  }

  // Bloqueo pesimista de escritura sobre el segmento — serializa la asignación
  // de IPs entre las 2 instancias PM2 en modo clúster sin race conditions.
  // El lock se libera automáticamente al commitTransaction() / rollbackTransaction().
  private async calcularNextIpDesdePool(
    qr: QueryRunner, segmentoId: string, empresaId: string,
  ): Promise<string> {
    const segmento = await qr.manager
      .createQueryBuilder(SegmentoIpv4, 's')
      .setLock('pessimistic_write')
      .where('s.id = :id AND s.empresa_id = :eId AND s.activo = true', { id: segmentoId, eId: empresaId })
      .getOne();
    if (!segmento) throw new NotFoundException(`Segmento ${segmentoId} no encontrado o inactivo`);

    const rows = await qr.manager.find(IpAsignada, {
      where: { segmentoId, activa: true },
      select: ['ipAddress'] as any,
    });
    const ipsUsadas    = rows.map(r => r.ipAddress);
    const ipsReservadas = await this.contratoRepo.getIpsReservadas(segmentoId);

    const ip = getNextAvailableIp(segmento.redCidr, ipsUsadas, ipsReservadas);
    if (!ip) {
      const range = getCidrRange(segmento.redCidr);
      throw new UnprocessableEntityException(
        `Pool "${segmento.nombre}" (${segmento.redCidr}) exhausto. Usadas: ${ipsUsadas.length}/${range.usableHosts}`,
      );
    }
    return ip;
  }

  private generarPassword(len: number): string {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#';
    return Array.from({ length:len }, () => chars[crypto.randomInt(0, chars.length)]).join('');
  }

  async findAll(empresaId: string, filters: FilterContratoDto) {
    return formatPaginatedResponse(await this.contratoRepo.findAllPaginated(empresaId, filters));
  }

  async findOne(id: string, empresaId: string): Promise<Contrato> {
    const c = await this.contratoRepo.findById(id, empresaId);
    if (!c) throw new NotFoundException(`Contrato ${id} no encontrado`);
    return c;
  }

  async findOneCompleto(id: string, empresaId: string) {
    const data = await this.contratoRepo.findCompleto(id, empresaId);
    if (!data) throw new NotFoundException(`Contrato ${id} no encontrado`);
    delete data.password_pppoe;
    return data;
  }

  async findByCliente(clienteId: string, empresaId: string) {
    return this.contratoRepo.findByClienteId(clienteId, empresaId);
  }

  async findByClienteCompleto(clienteId: string, empresaId: string) {
    return this.contratoRepo.findByClienteCompleto(clienteId, empresaId);
  }

  async update(id: string, dto: UpdateContratoDto, user: JwtPayload, req?: any): Promise<Contrato> {
    const existing = await this.findOne(id, user.empresaId);

    if (dto.version !== undefined && existing.version !== dto.version) {
      throw new ConflictException({
        code: 'CONCURRENCY_CONFLICT',
        message: 'Los datos fueron modificados por otro usuario. Por favor, recargue la página e intente nuevamente.',
      });
    }

    if (dto.routerId !== undefined || dto.segmentoId !== undefined || dto.macAddress !== undefined) {
      const effectiveRouterId  = dto.routerId    !== undefined ? dto.routerId    : (existing as any).routerId;
      const effectiveMac       = dto.macAddress  !== undefined ? dto.macAddress  : (existing as any).macAddress;
      const effectiveSegmentoId = dto.segmentoId !== undefined ? dto.segmentoId  : (existing as any).segmentoId;

      if (effectiveRouterId) {
        const [router] = await this.dataSource.query<any[]>(
          `SELECT nombre FROM routers WHERE id = $1 AND empresa_id = $2 AND deleted_at IS NULL`,
          [effectiveRouterId, user.empresaId],
        );
        if (router) {
          const effectiveTipoAuth = dto.tipoAuth ?? (existing as any).tipoAuth ?? 'ninguna';
          const requiereMac = effectiveTipoAuth === 'amarre_ip_mac' || effectiveTipoAuth === 'amarre_ip_mac_dhcp';
          if (requiereMac && !effectiveMac?.trim()) {
            throw new BadRequestException(
              `El tipo de autenticación Amarre IP/MAC requiere dirección MAC.`,
            );
          }
          if (effectiveSegmentoId) {
            const [seg] = await this.dataSource.query<any[]>(
              `SELECT router_id AS "routerId", nombre FROM segmentos_ipv4 WHERE id = $1 AND empresa_id = $2`,
              [effectiveSegmentoId, user.empresaId],
            );
            if (!seg) throw new BadRequestException('Segmento de red no encontrado');
            if (seg.routerId !== effectiveRouterId) {
              throw new BadRequestException(
                `El segmento "${seg.nombre}" no está asignado al router "${router.nombre}". ` +
                `Corrija la asignación en Red → Segmentos o seleccione el segmento correcto.`,
              );
            }
            await this.verificarSubredEnRouter(effectiveRouterId, effectiveSegmentoId, user.empresaId);
          }
        }
      }
    }

    // Validar unicidad de MAC si cambia
    if (dto.macAddress?.trim() && dto.macAddress.trim() !== (existing as any).macAddress) {
      const [macExistente] = await this.dataSource.query<any[]>(
        `SELECT numero_contrato FROM servicios WHERE empresa_id = $1 AND mac_address = $2 AND estado != 'baja_definitiva' AND deleted_at IS NULL AND id != $3 LIMIT 1`,
        [user.empresaId, dto.macAddress.trim(), id],
      );
      if (macExistente) throw new ConflictException(`La MAC ${dto.macAddress} ya está registrada en el contrato ${macExistente.numero_contrato}`);
    }

    const { version: _v, ...dtoSinVersion } = dto;
    const upd: any = { ...dtoSinVersion, updatedBy:user.sub };
    delete upd.ipManual; delete upd.usuarioPppoe; delete upd.passwordPppoePlain;
    await this.contratoRepo.update(id, upd);
    return this.findOne(id, user.empresaId);
  }

  async cambiarEstado(id: string, dto: CambiarEstadoContratoDto, user: JwtPayload, automatico = false, req?: any): Promise<Contrato> {
    const contrato = await this.findOne(id, user.empresaId);
    const anterior = contrato.estado;

    if (!automatico) {
      // Validar transición permitida
      const permitidos = TRANSICIONES[contrato.estado] ?? [];
      if (!permitidos.includes(dto.estado))
        throw new BadRequestException(`Transición ${anterior} → ${dto.estado} no permitida. Válidas: ${permitidos.join(', ') || 'ninguna'}`);

      // Aplicar guarda de negocio (omitir si adminOverride = true)
      if (!dto.adminOverride) {
        const guardaKey = `${contrato.estado}->${dto.estado}`;
        const guarda = GUARDAS[guardaKey];
        if (guarda) {
          const { monto: deudaVencida } = await this.deudaSvc.vencidaQueBloquea(contrato.id, contrato.clienteId);
          const error = guarda({ contrato, deudaVencida });
          if (error) throw new BadRequestException(error);
        }
      }
    }
    const upd: Partial<Contrato> = { estado:dto.estado, fechaEstado:new Date(), motivoEstado:dto.motivo, updatedBy:user.sub };
    if (dto.estado === EstadoContrato.ACTIVO && [EstadoContrato.SUSPENDIDO].includes(anterior as EstadoContrato)) {
      // ── Revertir suspensión en MikroTik (quitar de address-list + habilitar PPPoE) ──
      // Requiere solo routerId: el firewall necesita ipAsignada pero el secret PPPoE no.
      if (contrato.routerId && (contrato.ipAsignada || contrato.usuarioPppoe)) {
        setImmediate(async () => {
          try {
            const [router] = await this.dataSource.query<any[]>(`
              SELECT vpn_ip AS "vpnIp", ip_gestion AS "ipGestion",
                     usuario, password_cifrado AS "passwordCifrado",
                     usar_ssl AS "usarSsl", puerto_api AS "puertoApi",
                     puerto_api_ssl AS "puertoApiSsl", version_ros AS "versionRos",
                     timeout_conexion AS "timeoutConexion"
              FROM routers WHERE id = $1
            `, [contrato.routerId]);

            if (router) {
              const creds = {
                id:              contrato.routerId,
                ip:              router.vpnIp || router.ipGestion,
                port:            router.usarSsl ? (router.puertoApiSsl ?? 8729) : (router.puertoApi ?? 8728),
                user:            router.usuario ?? 'admin',
                passwordCifrado: router.passwordCifrado ?? '',
                useSsl:          router.usarSsl ?? false,
                timeoutSec:      router.timeoutConexion ?? 15,
                version:         (router.versionRos === 'v7' ? 'v7' : 'v6') as 'v6' | 'v7',
              };

              // 1. Quitar IP de address-list morosos (solo si tiene IP asignada)
              if (contrato.ipAsignada) {
                await this.firewallSvc.reactivarCliente(creds, contrato.ipAsignada);
              }

              // 2. Habilitar secreto PPPoE (requiere solo usuarioPppoe, no IP)
              if (contrato.usuarioPppoe) {
                await this.pppoeSvc.setEstado(creds, contrato.usuarioPppoe, false);
              }

              this.logger.log(`cambiarEstado → MikroTik reactivado: contrato ${id} | IP: ${contrato.ipAsignada ?? 'dinámica'}`);
            }
          } catch (err: any) {
            this.logger.warn(`cambiarEstado → fallo MikroTik al reactivar contrato ${id}: ${err?.message}`);
            if (contrato.routerId) {
              await this.outboxRed.encolar('REACTIVAR', id, contrato.routerId, {
                ipAsignada:   contrato.ipAsignada,
                usuarioPppoe: contrato.usuarioPppoe,
                clienteId:    contrato.clienteId,
                deudaTotal:   Number(contrato.deudaTotal),
              }).catch(() => void 0);
            }
          }
        });
      }

      // ── Re-habilitar line IPTV (XUI ONE), simétrico a MikroTik ──
      this.xuiLinesSvc.habilitarLineDeContrato(id, user.empresaId)
        .then((r) => { if (!esExito(r)) this.logger.warn(`cambiarEstado → XUI habilitarLine: ${mensajeDe(r)}`); })
        .catch((e: any) => this.logger.warn(`cambiarEstado → XUI habilitarLine: ${e?.message}`));

      // ── Notificación de reactivación ──────────────────────────
      this.dataSource.query(
        `SELECT cl.whatsapp, cl.telefono, cl.nombre_completo
         FROM clientes cl WHERE cl.id = $1 AND cl.deleted_at IS NULL`,
        [contrato.clienteId],
      ).then(([cl]: any[]) => {
        const tel = cl?.whatsapp || cl?.telefono;
        if (!tel) return;
        this.events.emit(NOTIFICATION_EVENTS.SERVICIO_REACTIVADO, {
          telefono:      tel,
          clienteNombre: cl.nombre_completo,
          planNombre:    '',
          empresaId:     user.empresaId,
          contratoId:    id,
          clienteId:     contrato.clienteId,
        });
      }).catch((e: any) => this.logger.warn(`cambiarEstado: no se pudo emitir notif reactivación: ${e?.message}`));
    }

    if (dto.estado === EstadoContrato.BAJA_DEFINITIVA) {
      const sagaBajaId = await this.sagaLog.iniciar(
        SagaTipo.BAJA_DEFINITIVA, id, user.empresaId, user.sub, 5,
      );

      upd.fechaBaja  = new Date().toISOString().split('T')[0];
      upd.motivoBaja = dto.motivo;
      upd.onuId      = null as any;
      upd.routerId   = null as any;
      upd.segmentoId = null as any;
      upd.ipAsignada = null as any;
      // Un contrato dado de baja no puede seguir "en prórroga": la prórroga es un permiso
      // para seguir navegando unos días más, y aquí ya no hay servicio que prorrogar.
      // Sin esto el flag quedaba pegado, y `findProrrogasVencidas` —que no mira el
      // estado— lo devolvería como prórroga viva. La limpieza en el router la hace S3
      // (`desaprovisionarMikrotik` quita la IP de morosos y prorroga_datafast).
      upd.enProrroga    = false;
      upd.prorrogaHasta = null as any;

      // S1: Liberar IP
      const t1 = Date.now();
      if (contrato.segmentoId) {
        try { await this.contratoRepo.liberarIp(id); await this.sagaLog.registrarPaso(sagaBajaId, 1, 'liberar_ip', 'OK', undefined, Date.now() - t1); }
        catch (e: any) { await this.sagaLog.registrarPaso(sagaBajaId, 1, 'liberar_ip', 'FAIL', e?.message, Date.now() - t1); }
      } else { await this.sagaLog.registrarPaso(sagaBajaId, 1, 'liberar_ip', 'SKIPPED'); }

      // S2: Desprovisionar OLT (soft — no bloquea baja)
      const t2 = Date.now();
      await withTimeout(this.desaprovisionarOlt(id), 20000, 'desaprovision-olt')
        .then(() => this.sagaLog.registrarPaso(sagaBajaId, 2, 'desprovisionar_olt', 'OK', undefined, Date.now() - t2))
        .catch((e: any) => { this.logger.warn(`cambiarEstado baja OLT: ${e?.message}`); return this.sagaLog.registrarPaso(sagaBajaId, 2, 'desprovisionar_olt', 'FAIL', e?.message, Date.now() - t2); });

      // S2b: Desaprovisionar ONU nativa (FTTH/Path B) de forma resiliente vía outbox.
      // Cubre el caso que desaprovisionarOlt() no maneja (ONU nativa sin SmartOLT ID):
      // el outbox reintenta hasta que la OLT esté disponible; omite si no hay ONU FTTH.
      await this.outboxRed.encolarDesaprovisionarOnu(id, user.empresaId).catch(() => void 0);

      // S3: Desprovisionar MikroTik (soft — no bloquea baja; reintento via outbox si falla)
      const t3 = Date.now();
      await withTimeout(this.desaprovisionarMikrotik(id), 25000, 'desaprovision-mikrotik')
        .then(() => this.sagaLog.registrarPaso(sagaBajaId, 3, 'desprovisionar_mikrotik', 'OK', undefined, Date.now() - t3))
        .catch(async (e: any) => {
          this.logger.warn(`cambiarEstado baja MikroTik: ${e?.message}`);
          await this.sagaLog.registrarPaso(sagaBajaId, 3, 'desprovisionar_mikrotik', 'FAIL', e?.message, Date.now() - t3);
          // Encolar para reintento automático — el outbox reintenta cada 5 min hasta 12 veces
          // Router e IP se toman del contrato ANTES de que el `update` de más abajo los
          // ponga a NULL. Si el reintento los buscara luego, no encontraría ninguno.
          //
          // El `.catch` no se traga el error en silencio: así estuvo meses el encolado
          // roto (routerId 'none' contra una columna uuid) sin que nadie lo notara.
          await this.outboxRed.encolarDesprovisionar(id, contrato.routerId ?? null, {
            ipAsignada:   contrato.ipAsignada,
            usuarioPppoe: contrato.usuarioPppoe,
            motivo:       'baja_definitiva_hardware_fallo',
          }).catch((e2: any) => this.logger.error(
            `cambiarEstado baja: NO se pudo encolar el reintento de limpieza MikroTik `
            + `| contrato ${id} | ${e2?.message}. La IP ${contrato.ipAsignada ?? '(sin IP)'} `
            + 'puede quedar en las address-lists del router.',
          ));
        });

      // S4: Eliminar de access list antena (soft)
      const t4 = Date.now();
      await withTimeout(this.eliminarDeAccessListAntena(id), 15000, 'baja-antena')
        .then(() => this.sagaLog.registrarPaso(sagaBajaId, 4, 'eliminar_antena_ap', 'OK', undefined, Date.now() - t4))
        .catch((e: any) => { this.logger.warn(`cambiarEstado baja antena: ${e?.message}`); return this.sagaLog.registrarPaso(sagaBajaId, 4, 'eliminar_antena_ap', 'FAIL', e?.message, Date.now() - t4); });

      // S5: Eliminar line IPTV (XUI ONE) — soft, no bloquea la baja.
      // eliminarLineDeContrato() habla ResultadoOperacion (Ola 1, grupo 3b) y ya no lanza por
      // un fallo de XUI — el `.then` distingue éxito/fallo por la clase; el `.catch` que
      // queda es para el timeout de `withTimeout` (15s), que sigue siendo un rechazo real.
      const t5 = Date.now();
      await withTimeout(this.xuiLinesSvc.eliminarLineDeContrato(id, user.empresaId), 15000, 'eliminar-line-iptv')
        .then((r) => {
          if (esExito(r)) return this.sagaLog.registrarPaso(sagaBajaId, 5, 'eliminar_line_iptv', 'OK', undefined, Date.now() - t5);
          this.logger.warn(`cambiarEstado baja XUI: ${mensajeDe(r)}`);
          return this.sagaLog.registrarPaso(sagaBajaId, 5, 'eliminar_line_iptv', 'FAIL', mensajeDe(r), Date.now() - t5);
        })
        .catch((e: any) => { this.logger.warn(`cambiarEstado baja XUI: ${e?.message}`); return this.sagaLog.registrarPaso(sagaBajaId, 5, 'eliminar_line_iptv', 'FAIL', e?.message, Date.now() - t5); });

      // Completar saga aunque algunos pasos de hardware hayan fallado
      // El reconciliador detectará hardware huérfano y lo limpiará
      await this.sagaLog.completar(sagaBajaId);

      // Nota informativa con las credenciales de la última conexión
      const partes: string[] = [];
      if (contrato.usuarioPppoe) {
        let passPlain = '';
        try { passPlain = contrato.passwordPppoe ? decrypt(contrato.passwordPppoe) : ''; } catch { /* cifrado desconocido */ }
        partes.push(`PPPoE: ${contrato.usuarioPppoe}${passPlain ? ` / ${passPlain}` : ''}`);
      }
      if (contrato.ipAsignada)  partes.push(`IP: ${contrato.ipAsignada}`);
      if (contrato.macAddress)  partes.push(`MAC: ${contrato.macAddress}`);
      if (partes.length > 0) {
        const fecha = new Date().toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' });
        // La nota es el aviso "este abonado se fue, estas eran sus credenciales" que pinta
        // el banner ámbar del detalle. Solo tiene sentido si el abonado se quedó SIN
        // servicio: antes se escribía al dar de baja cualquier contrato y un cliente con
        // otro servicio activo aparecía rotulado como baja definitiva (2026-07-29).
        // Mismo criterio que la cascada contrato→cliente de más abajo: manda lo que le
        // queda vivo al cliente, no el contrato que se está tocando.
        await this.dataSource.query(
          `UPDATE clientes SET nota_baja = $1
           WHERE id = $2
             AND NOT EXISTS (
               SELECT 1 FROM servicios
               WHERE cliente_id = $2 AND id <> $3
                 AND estado <> 'baja_definitiva' AND deleted_at IS NULL
             )`,
          [`Última conexión (${fecha}): ${partes.join(' | ')}`, contrato.clienteId, id],
        );
      }
    }
    await this.contratoRepo.update(id, upd);
    await this.contratoRepo.guardarHistorial({ servicioId:id, empresaId:user.empresaId, estadoAnterior:anterior, estadoNuevo:dto.estado, motivo:dto.motivo, usuarioId:user.sub, automatico });
    await this.auditoria.logUpdate({ empresaId:user.empresaId, usuarioId:user.sub, usuarioEmail:user.email, modulo:'contratos', entidadId:id, descripcion:`Estado: ${anterior} → ${dto.estado}`, req });

    // Sincronizar clientes.estado cuando se BLOQUEA un contrato.
    //
    // Incidente 2026-08-04 (CNT-2026-000014): la cascada existía solo para la reactivación
    // y para la baja. Al suspender no se tocaba el cliente, así que Piero figuraba
    // «activo» en el listado con su único servicio cortado y su PPPoE deshabilitado en el
    // router. El operador que mira la ficha del cliente ve lo contrario de lo que le pasa
    // al abonado.
    //
    // Espejo exacto de la reactivación de más abajo: el cliente pasa a suspendido solo si
    // NO le queda ningún contrato dando servicio. Con dos servicios y uno cortado, el
    // cliente sigue activo — que es la verdad.
    if (
      [EstadoContrato.SUSPENDIDO]
        .includes(dto.estado as EstadoContrato)
    ) {
      const [clienteBloqueado] = filasUpdateReturning<{ id: string }>(await this.dataSource.query(`
        UPDATE clientes
        SET estado = 'suspendido', fecha_estado = NOW()
        WHERE id = $1
          AND estado = 'activo'
          AND NOT EXISTS (
            SELECT 1 FROM servicios
            WHERE cliente_id = $1
              AND estado IN ('activo', 'pendiente_activacion')
              AND deleted_at IS NULL
              AND id != $2
          )
        RETURNING id
      `, [contrato.clienteId, id]));

      if (clienteBloqueado) {
        await this.dataSource.query(`
          INSERT INTO clientes_historial_estados
            (cliente_id, empresa_id, estado_anterior, estado_nuevo, motivo, usuario_id, automatico)
          VALUES ($1, $2, 'activo', 'suspendido', $3, $4, $5)
        `, [
          contrato.clienteId, user.empresaId,
          `Contrato ${contrato.numeroContrato} → ${dto.estado}`,
          automatico ? null : user.sub, automatico,
        ]).catch((e: any) => this.logger.warn(`cambiarEstado: historial cliente: ${e?.message}`));
      }
    }

    // Sincronizar clientes.estado cuando se reactiva un contrato suspendido.
    // Solo pone 'activo' si el cliente no tiene otros contratos suspendidos.
    if (
      dto.estado === EstadoContrato.ACTIVO &&
      [EstadoContrato.SUSPENDIDO].includes(anterior as EstadoContrato)
    ) {
      const [clienteActualizado] = filasUpdateReturning<{ id: string }>(await this.dataSource.query(`
        UPDATE clientes
        SET estado = 'activo', fecha_estado = NOW()
        WHERE id = $1
          AND estado = 'suspendido'
          AND NOT EXISTS (
            SELECT 1 FROM servicios
            WHERE cliente_id = $1
              AND estado = 'suspendido'
              AND deleted_at IS NULL
              AND id != $2
          )
        RETURNING id
      `, [contrato.clienteId, id]));

      if (clienteActualizado) {
        await this.dataSource.query(`
          INSERT INTO clientes_historial_estados
            (cliente_id, empresa_id, estado_anterior, estado_nuevo, motivo, usuario_id, automatico)
          VALUES ($1, $2, 'suspendido', 'activo', $3, $4, $5)
        `, [
          contrato.clienteId,
          user.empresaId,
          dto.motivo ?? `Reactivación de contrato ${id}`,
          user.sub,
          automatico ?? false,
        ]).catch((e: any) =>
          this.logger.warn?.(`contratos.cambiarEstado historial cliente: ${e.message}`),
        );
      }
    }

    // ── Cliente sin servicio → baja definitiva ────────────────
    // La cascada existía SOLO en el sentido cliente → contratos
    // (`terminarContratosCliente`). Dar de baja el último contrato dejaba al cliente como
    // estuviera: el 2026-07-29 se encontró a un cliente `activo` cuyo único contrato
    // estaba dado de baja y borrado — activo sin servicio, que no es un estado que el
    // negocio admita.
    //
    // `automatico` distingue el origen y evita el bucle: cuando la baja del contrato
    // VIENE de la baja del cliente, no hay nada que propagar hacia arriba.
    if (dto.estado === EstadoContrato.BAJA_DEFINITIVA && !automatico) {
      const [clienteBaja] = filasUpdateReturning<{ id: string; estado_anterior: string }>(
        await this.dataSource.query(`
          UPDATE clientes c
          SET estado = 'baja_definitiva', fecha_estado = NOW()
          FROM (SELECT id, estado FROM clientes WHERE id = $1) AS prev
          WHERE c.id = prev.id
            AND c.estado <> 'baja_definitiva'
            -- Solo si NO le queda ningún contrato vigente. Un cliente con otro servicio
            -- en curso no puede caer de baja porque uno de sus contratos termine.
            AND NOT EXISTS (
              SELECT 1 FROM servicios
              WHERE cliente_id = $1
                AND estado <> 'baja_definitiva'
                AND deleted_at IS NULL
                AND id <> $2
            )
          RETURNING c.id, prev.estado AS estado_anterior
        `, [contrato.clienteId, id]),
      );

      if (clienteBaja) {
        this.logger.warn(
          `Cliente ${contrato.clienteId} → baja_definitiva: se dio de baja su último contrato (${id}).`,
        );
        await this.dataSource.query(`
          INSERT INTO clientes_historial_estados
            (cliente_id, empresa_id, estado_anterior, estado_nuevo, motivo, usuario_id, automatico)
          VALUES ($1, $2, $3, 'baja_definitiva', $4, $5, TRUE)
        `, [
          contrato.clienteId,
          user.empresaId,
          clienteBaja.estado_anterior,
          `Sin contratos vigentes tras la baja del contrato ${id}`,
          user.sub,
        ]).catch((e: any) =>
          this.logger.warn?.(`contratos.cambiarEstado historial baja cliente: ${e.message}`),
        );
      }
    }

    if (dto.estado === EstadoContrato.SUSPENDIDO) {
      // ── Aplicar suspensión en MikroTik (firewall + PPPoE) ──────
      // Requiere solo routerId: firewall necesita ipAsignada pero secret PPPoE no.
      if (contrato.routerId && (contrato.ipAsignada || contrato.usuarioPppoe)) {
        setImmediate(async () => {
          try {
            const [[router], [cliente]] = await Promise.all([
              this.dataSource.query<any[]>(`
                SELECT vpn_ip AS "vpnIp", ip_gestion AS "ipGestion",
                       usuario, password_cifrado AS "passwordCifrado",
                       usar_ssl AS "usarSsl", puerto_api AS "puertoApi",
                       puerto_api_ssl AS "puertoApiSsl", version_ros AS "versionRos",
                       timeout_conexion AS "timeoutConexion"
                FROM routers WHERE id = $1
              `, [contrato.routerId]),
              this.dataSource.query<any[]>(
                `SELECT nombre_completo FROM clientes WHERE id = $1`, [contrato.clienteId],
              ),
            ]);

            if (router) {
              const creds = {
                id:              contrato.routerId,
                ip:              router.vpnIp || router.ipGestion,
                port:            router.usarSsl ? (router.puertoApiSsl ?? 8729) : (router.puertoApi ?? 8728),
                user:            router.usuario ?? 'admin',
                passwordCifrado: router.passwordCifrado ?? '',
                useSsl:          router.usarSsl ?? false,
                timeoutSec:      router.timeoutConexion ?? 15,
                version:         (router.versionRos === 'v7' ? 'v7' : 'v6') as 'v6' | 'v7',
              };

              // 1. Agregar IP a address-list morosos (solo si tiene IP asignada)
              if (contrato.ipAsignada) {
                await this.firewallSvc.suspenderCliente(
                  creds,
                  contrato.ipAsignada,
                  contrato.clienteId,
                  `Suspensión manual: ${cliente?.nombre_completo ?? contrato.clienteId} | ${dto.motivo ?? 'sin motivo'} | ${new Date().toLocaleDateString('es-PE')}`,
                );
              }

              // 2. Desconectar sesión PPPoE y deshabilitar secret (requiere solo usuarioPppoe, no IP)
              if (contrato.usuarioPppoe) {
                await this.pppoeSvc.desconectarSesion(creds, contrato.usuarioPppoe);
                await this.pppoeSvc.setEstado(creds, contrato.usuarioPppoe, true);
              }

              this.logger.log(`cambiarEstado → MikroTik suspendido: contrato ${id} | IP: ${contrato.ipAsignada ?? 'dinámica'}`);
            }
          } catch (err: any) {
            this.logger.warn(`cambiarEstado → fallo MikroTik al suspender contrato ${id}: ${err?.message}`);
            if (contrato.routerId) {
              await this.outboxRed.encolar('SUSPENDER', id, contrato.routerId, {
                ipAsignada:   contrato.ipAsignada,
                usuarioPppoe: contrato.usuarioPppoe,
                clienteId:    contrato.clienteId,
                deudaTotal:   Number(contrato.deudaTotal),
              }).catch(() => void 0);
            }
          }
        });
      }

      // ── Deshabilitar line IPTV (XUI ONE), simétrico a MikroTik ──
      this.xuiLinesSvc.deshabilitarLineDeContrato(id, user.empresaId)
        .then((r) => { if (!esExito(r)) this.logger.warn(`cambiarEstado → XUI deshabilitarLine: ${mensajeDe(r)}`); })
        .catch((e: any) => this.logger.warn(`cambiarEstado → XUI deshabilitarLine: ${e?.message}`));

      // ── Notificación WhatsApp ────────────────────────────────
      this.dataSource.query(
        `SELECT cl.whatsapp, cl.telefono, cl.nombre_completo, em.razon_social AS empresa_nombre
         FROM clientes cl JOIN empresas em ON em.id = $2
         WHERE cl.id = $1 AND cl.deleted_at IS NULL`,
        [contrato.clienteId, user.empresaId],
      ).then(([cl]: any[]) => {
        const tel = cl?.whatsapp || cl?.telefono;
        if (!tel) return;
        this.events.emit(NOTIFICATION_EVENTS.SERVICIO_SUSPENDIDO, {
          telefono:         tel,
          clienteNombre:    cl.nombre_completo,
          deudaTotal:       String(contrato.deudaTotal ?? 0),
          nombreEmpresa:    cl.empresa_nombre,
          empresaId:        user.empresaId,
          contratoId:       id,
          clienteId:        contrato.clienteId,
          aggregateVersion: contrato.version,
        });
      }).catch((e: any) => this.logger.warn(`cambiarEstado: no se pudo emitir notif suspensión: ${e?.message}`));
    }

    if (dto.estado === EstadoContrato.BAJA_DEFINITIVA) {
      await this.contratoRepo.softDelete(id, user.empresaId);
      // El registro ya tiene deleted_at, devolvemos el estado final calculado
      return Object.assign(contrato, upd) as Contrato;
    }
    return this.findOne(id, user.empresaId);
  }

  async otorgarProrroga(id: string, dto: OtorgarProrrogaDto, user: JwtPayload, req?: any): Promise<Contrato> {
    // Delega a PromesasPagoService: persiste promesa, actualiza contrato y aplica en MikroTik
    await this.promesasSvc.crear(
      { contratoId: id, fechaVencimiento: dto.prorrogaHasta, motivo: dto.motivo },
      user,
    );
    return this.findOne(id, user.empresaId);
  }

  // Limpia prórroga en BD y quita la IP de ADDRESS_LIST_PRORROGA en MikroTik.
  // Llamado cuando se registra un pago que salda la deuda y el contrato sigue activo.
  async limpiarProrroga(id: string, empresaId: string): Promise<void> {
    const contrato = await this.findOne(id, empresaId);
    if (!contrato.enProrroga) return;

    await this.dataSource.query(`
      UPDATE servicios
      SET en_prorroga = false, prorroga_hasta = NULL, updated_at = NOW()
      WHERE id = $1
    `, [id]);

    if (contrato.routerId && contrato.ipAsignada) {
      setImmediate(async () => {
        try {
          const [router] = await this.dataSource.query<any[]>(`
            SELECT vpn_ip AS "vpnIp", ip_gestion AS "ipGestion",
                   usuario, password_cifrado AS "passwordCifrado",
                   usar_ssl AS "usarSsl", puerto_api AS "puertoApi",
                   puerto_api_ssl AS "puertoApiSsl", version_ros AS "versionRos",
                   timeout_conexion AS "timeoutConexion"
            FROM routers WHERE id = $1
          `, [contrato.routerId]);

          if (router) {
            const creds = {
              id:              contrato.routerId,
              ip:              router.vpnIp || router.ipGestion,
              port:            router.usarSsl ? (router.puertoApiSsl ?? 8729) : (router.puertoApi ?? 8728),
              user:            router.usuario ?? 'admin',
              passwordCifrado: router.passwordCifrado ?? '',
              useSsl:          router.usarSsl ?? false,
              timeoutSec:      router.timeoutConexion ?? 15,
              version:         (router.versionRos === 'v7' ? 'v7' : 'v6') as 'v6' | 'v7',
            };
            await this.firewallSvc.reactivarCliente(creds, contrato.ipAsignada);
            this.logger.log(`limpiarProrroga → IP ${contrato.ipAsignada} removida de address-list | contrato ${id}`);
          }
        } catch (err: any) {
          this.logger.warn(`limpiarProrroga → fallo MikroTik contrato ${id}: ${err?.message}`);
          await this.outboxRed.encolar('REACTIVAR', id, contrato.routerId!, {
            ipAsignada: contrato.ipAsignada,
          }).catch(() => void 0);
        }
      });
    }
  }

  async activar(id: string, user: JwtPayload, req?: any): Promise<ActivarResultado> {
    const c = await this.findOne(id, user.empresaId);
    if (c.estado !== EstadoContrato.PENDIENTE_ACTIVACION)
      throw new BadRequestException(`Solo se activan contratos PENDIENTE_ACTIVACION. Estado: ${c.estado}`);

    const sagaId = await this.sagaLog.iniciar(
      SagaTipo.ACTIVAR_CONTRATO, id, user.empresaId, user.sub, 5,
    );

    // ── S1: Provisionar MikroTik ANTES de activar en BD ──────────────────────
    // Si falla → fallar saga, el contrato permanece en PENDIENTE_ACTIVACION.
    let provisionadoOk = false;
    let provisionMotivoFallo: string | undefined;
    const t1 = Date.now();
    try {
      const provResult = await this.provisionarMikrotik(id);
      provisionadoOk    = provResult.ok;
      provisionMotivoFallo = provResult.motivo;
      await this.sagaLog.registrarPaso(sagaId, 1, 'provision_mikrotik',
        provisionadoOk ? 'OK' : 'SKIPPED', provisionMotivoFallo, Date.now() - t1);
    } catch (err: any) {
      this.logger.error(`activar → ${id} | fallo MikroTik: ${err?.message}`);
      await this.sagaLog.registrarPaso(sagaId, 1, 'provision_mikrotik', 'FAIL', err?.message, Date.now() - t1);
      await this.sagaLog.fallar(sagaId, `Provisión MikroTik fallida: ${err?.message}`);
      await this.contratoRepo.guardarHistorial({
        servicioId: id, empresaId: user.empresaId,
        estadoAnterior: EstadoContrato.PENDIENTE_ACTIVACION,
        estadoNuevo:    EstadoContrato.PENDIENTE_ACTIVACION,
        motivo: `Intento fallido — MikroTik: ${err?.message} | sagaId: ${sagaId}`,
        usuarioId: user.sub,
      }).catch(he => this.logger.error(`activar → historial fallido: ${he?.message}`));
      throw new BadRequestException(
        `No se pudo configurar el router MikroTik: ${err?.message}. ` +
        `El contrato permanece en PENDIENTE_ACTIVACION.`,
      );
    }

    // ── S2: Registrar en antena AP (soft — no bloquea la activación) ─────────
    const t2 = Date.now();
    const antenaResult = await this.registrarEnAccessListAntena(id);
    await this.sagaLog.registrarPaso(sagaId, 2, 'registro_antena_ap',
      antenaResult.ok ? 'OK' : 'SKIPPED', antenaResult.advertencia, Date.now() - t2);

    // ── S3: Activar en BD ─────────────────────────────────────────────────────
    const t3 = Date.now();
    await this.contratoRepo.update(id, {
      estado:           EstadoContrato.ACTIVO,
      fechaEstado:      new Date(),
      fechaInstalacion: new Date(),
      updatedBy:        user.sub,
    });
    await this.sagaLog.registrarPaso(sagaId, 3, 'marcar_activo_bd', 'OK', undefined, Date.now() - t3);

    // ── S3b: Verify-after-write — confirmar que hardware aplicó provisión ─────
    const advertencias: string[] = [];
    const tV = Date.now();
    const verificado = await this.verificarProvisionHardware(id);
    await this.contratoRepo.update(id, {
      hardwareVerificado:   verificado,
      hardwareVerificadoEn: new Date(),
      hardwareEstado:       verificado ? 'ok' : 'inconsistente',
    } as any);
    await this.sagaLog.registrarPaso(sagaId, 4, 'verify_after_write',
      verificado ? 'OK' : 'FAIL',
      verificado ? undefined : 'Verificación post-provisión no confirmada',
      Date.now() - tV,
    );
    if (!verificado) advertencias.push('Hardware: provisión no verificada — el reconciliador reintentará en 15 min');

    if (!provisionadoOk && provisionMotivoFallo) advertencias.push(`MikroTik sin provisión: ${provisionMotivoFallo}`);
    if (antenaResult.advertencia) advertencias.push(antenaResult.advertencia);

    const motivo = [
      'Instalación completada',
      `MikroTik: ${provisionadoOk ? 'OK' : 'sin provisión'}`,
      antenaResult.ok ? 'Antena AP: OK' : (antenaResult.advertencia ? 'Antena AP: ERROR' : null),
      `sagaId: ${sagaId}`,
    ].filter(Boolean).join(' | ');

    await this.contratoRepo.guardarHistorial({
      servicioId: id, empresaId: user.empresaId,
      estadoAnterior: EstadoContrato.PENDIENTE_ACTIVACION,
      estadoNuevo:    EstadoContrato.ACTIVO,
      motivo, usuarioId: user.sub,
    }).catch(he => this.logger.error(`activar → historial: ${he?.message}`));

    // ── S5: Promover cliente → ACTIVO ─────────────────────────────────────────
    const t5 = Date.now();
    try {
      // Orígenes: además del alta normal, el ex-cliente que vuelve (`baja_definitiva`, si
      // `create` no alcanzó a readmitirlo) y el moroso reconectado (`suspendido`). El
      // criterio es el mismo en los tres: un contrato aprovisionado CON ÉXITO significa
      // servicio en producción, y el estado del abonado tiene que decirlo. Antes el WHERE
      // solo aceptaba `pendiente_activacion` y el resto quedaba en silencio — un cliente
      // navegando cuyo perfil seguía marcado como dado de baja.
      const [promovido] = filasUpdateReturning<{ estado_anterior: string }>(
        await this.dataSource.query(
          // `nota_baja = NULL`: el abonado vuelve a tener servicio, así que el banner de
          // baja definitiva deja de corresponder. Se limpia aquí —en el mismo UPDATE que
          // lo pone activo— y no en una llamada aparte, para que no exista un instante en
          // que el cliente esté activo y siga rotulado como dado de baja.
          `UPDATE clientes c SET estado = 'activo', fecha_estado = NOW(), nota_baja = NULL, updated_at = NOW(), updated_by = $3
           FROM (SELECT id, estado FROM clientes WHERE id = $1) AS prev
           WHERE c.id = prev.id AND c.empresa_id = $2
             AND c.estado IN ('pendiente_activacion', 'suspendido', 'baja_definitiva')
           RETURNING prev.estado AS estado_anterior`,
          [c.clienteId, user.empresaId, user.sub],
        ),
      );
      if (promovido) {
        await this.dataSource.query(
          `INSERT INTO clientes_historial_estados
             (cliente_id, empresa_id, estado_anterior, estado_nuevo, motivo, usuario_id)
           VALUES ($1, $2, $3, 'activo', $4, $5)`,
          [c.clienteId, user.empresaId, promovido.estado_anterior,
           `Servicio activado — contrato ${c.numeroContrato}`, user.sub],
        ).catch((e) => this.logger.error(`activar → historial cliente: ${e?.message}`));
      }
      await this.sagaLog.registrarPaso(sagaId, 5, 'promover_cliente_activo', 'OK', undefined, Date.now() - t5);
    } catch (e: any) {
      this.logger.error(`activar → cliente ${c.clienteId} | fallo promover estado: ${e?.message}`);
      await this.sagaLog.registrarPaso(sagaId, 5, 'promover_cliente_activo', 'FAIL', e?.message, Date.now() - t5);
      advertencias.push(`Estado del abonado no pudo actualizarse a "activo" — actualízalo manualmente.`);
    }

    await this.registrarTramoDeAlta(c, user);

    await this.sagaLog.completar(sagaId);

    return {
      contrato:   await this.findOne(id, user.empresaId),
      mikrotikOk: provisionadoOk,
      antenaOk:   antenaResult.ok,
      advertencias,
    };
  }

  /**
   * H-9 (2026-08-09) — el tramo del ciclo EN CURSO que un prepago empieza a consumir al activarse.
   *
   * Un abonado con anclaje 30 activado el 22/08 usa el servicio del 22 al 30, pero su comprobante
   * del alta ampara el ciclo SIGUIENTE (`[31/08 → 30/09]`) porque prepago cobra por delante. Los
   * nueve días de en medio pertenecen a `[31/07 → 30/08]`, que se emitió el 25/07 —cuando el
   * abonado no existía— y al que nadie vuelve a mirar: `proximoVencimiento` no devuelve fechas
   * pasadas. Eran gratis.
   *
   * **Solo prepago.** En postpago esto no hace falta: su ciclo se emite por detrás, así que la
   * generación cuenta los días entregados y lo prorratea sola (H-6). Cobrarlo aquí además sería
   * cobrarlo dos veces.
   *
   * **Va en la activación, no en el alta.** Al crear el contrato no se sabe cuántos días se van a
   * entregar —nace en `pendiente_activacion` y puede tardar—, así que cobrarlo entonces sería
   * cobrar servicio que quizá no se preste. Aquí ya hay una fecha real de puesta en servicio.
   *
   * **Y va como cargo pendiente, no como comprobante propio.** Es lo que pidió el propietario
   * para el prorrateo del alta: *«en su próxima facturación se prorratea para esos días y se le
   * adiciona el costo»*. Emitir un comprobante de nueve días por separado sería papeleo extra
   * para el abonado y para la caja.
   */
  private async registrarTramoDeAlta(contrato: Contrato, user: JwtPayload): Promise<void> {
    try {
      const politica = await this.politicaSvc.resolver(contrato.clienteId, user.empresaId);
      if (politica.tipo !== 'prepago') return;

      const hoy   = new Date();
      const ciclo = this.politicaSvc.cicloEnCurso(politica, hoy);

      const inicio  = new Date(`${ciclo.inicio}T00:00:00.000Z`);
      const cierre  = new Date(`${ciclo.fin}T00:00:00.000Z`);
      const desdeHoy = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate()));

      // Activado antes de que empiece el ciclo en curso (o después de que cierre): no hay tramo.
      if (desdeHoy > cierre) return;
      const arranque = desdeHoy < inicio ? inicio : desdeHoy;

      const cargo = cargoDelPeriodo(
        contrato.precioConDescuento,
        diasFacturables(inicio, cierre),
        diasFacturables(arranque, cierre),
      );
      if (cargo.importe <= 0) return;

      await this.facturacionSvc.registrarCargoPendiente({
        empresaId:   user.empresaId,
        clienteId:   contrato.clienteId,
        contratoId:  contrato.id,
        tipo:        'servicio',
        monto:       cargo.importe,
        descripcion: `Servicio ${ciclo.inicio} a ${ciclo.fin} · ${cargo.dias} días desde la activación`,
        generadoPor: user.sub,
      });

      this.logger.log(
        `Alta ${contrato.numeroContrato}: tramo prepago de ${cargo.dias} días ` +
        `(${ciclo.inicio}→${ciclo.fin}) = ${cargo.importe} — irá en el próximo comprobante`,
      );
    } catch (e: any) {
      // No tumba la activación: el servicio ya está en producción y el abonado navegando.
      // Pero queda escrito, porque es dinero que si no se registra no lo cobra nadie.
      this.logger.error(
        `Alta ${contrato.numeroContrato}: no se pudo registrar el tramo prepago — ${e?.message}`,
      );
    }
  }

  // `actualizarDeuda(id, deudaTotal, mesesDeuda)` se eliminó el 2026-08-08 (desviación A-4).
  //
  // Era una puerta abierta: aceptaba cualquier cifra de quien la llamara y la escribía en
  // `contratos.deuda_total` sin contrastarla con una sola factura. Su único consumidor le
  // pasaba el resultado de un cálculo que ignoraba los comprobantes consolidados, así que
  // la puerta no solo permitía mentir: se usaba para eso.
  //
  // La proyección tiene ahora **un solo escritor**: `DeudaPorContratoService`. Quien
  // necesite refrescarla llama a `recalcularPorCliente`, que parte de las facturas. No se
  // repone este método ni una variante suya sin un ADR que explique por qué hace falta
  // poder escribir una deuda que las facturas no respaldan.

  async registrarPago(id: string, fechaPago: string, empresaId: string): Promise<void> {
    await this.contratoRepo.update(id, { fechaUltimoPago:fechaPago });
  }

  async reactivarPorPago(contratoId: string, empresaId: string, operadorId: string): Promise<Contrato> {
    const c = await this.findOne(contratoId, empresaId);
    if (c.estado !== EstadoContrato.SUSPENDIDO)
      throw new BadRequestException(`Solo se reactivan contratos en SUSPENDIDO. Estado: ${c.estado}`);

    const CICLO_MESES: Record<string, number> = {
      mensual: 1, bimestral: 2, trimestral: 3, semestral: 6, anual: 12,
    };
    const meses = CICLO_MESES[(c as any).cicloFacturacion ?? 'mensual'] ?? 1;
    const nuevaFechaVenc = new Date();
    nuevaFechaVenc.setMonth(nuevaFechaVenc.getMonth() + meses);
    const nuevaFechaStr = nuevaFechaVenc.toISOString().split('T')[0];

    await this.dataSource.query(`
      UPDATE servicios SET
        estado = 'activo',
        fecha_estado = NOW(),
        motivo_estado = 'Reactivación manual por pago',
        en_prorroga = false,
        prorroga_hasta = NULL,
        fecha_vencimiento = $2,
        updated_at = NOW(),
        updated_by = $3
      WHERE id = $1 AND empresa_id = $4
    `, [contratoId, nuevaFechaStr, operadorId, empresaId]);

    // La deuda NO se pone a cero a mano: se recalcula desde las facturas.
    //
    // Aquí decía `deuda_total = 0, meses_deuda = 0`. Reactivar es una decisión del
    // operador, y puede tomarla legítimamente con deuda viva —una promesa de pago, un
    // gesto comercial—; lo que no puede es que el ERP responda que no debe nada. Escribir
    // el cero convertía la orden "reactiva el servicio" en la afirmación "este abonado
    // está al día", que es otra cosa y puede ser falsa.
    //
    // Con el recálculo, el servicio se levanta igual y la ficha dice la verdad. Si queda
    // deuda, el cobro nocturno volverá a verla — que es exactamente lo que debe pasar.
    // Un solo escritor de la proyección (desviación A-4).
    await this.deudaSvc.recalcularPorCliente(c.clienteId, empresaId);

    await this.contratoRepo.guardarHistorial({
      servicioId: contratoId, empresaId,
      estadoAnterior: c.estado,
      estadoNuevo: EstadoContrato.ACTIVO,
      motivo: `Reactivación por pago | Nuevo vencimiento: ${nuevaFechaStr}`,
      usuarioId: operadorId,
    });

    return this.findOne(contratoId, empresaId);
  }

  async getHistorial(id: string, empresaId: string) {
    await this.findOne(id, empresaId);
    return this.contratoRepo.getHistorial(id);
  }

  async getResumen(empresaId: string) {
    const rows = await this.contratoRepo.getResumen(empresaId);
    return rows.reduce((acc, r) => { acc[r.estado] = { total:parseInt(r.total), deuda:parseFloat(r.deuda||'0') }; return acc; }, {});
  }

  async remove(id: string, user: JwtPayload): Promise<void> {
    // Usa raw query para encontrar también registros ya soft-deleted por cambiarEstado(BAJA_DEFINITIVA)
    const [row] = await this.dataSource.query<{ estado: string }[]>(
      'SELECT estado FROM servicios WHERE id = $1 AND empresa_id = $2',
      [id, user.empresaId],
    );
    if (!row) throw new NotFoundException(`Contrato ${id} no encontrado`);
    if (row.estado !== EstadoContrato.BAJA_DEFINITIVA) throw new BadRequestException('Solo se eliminan contratos en BAJA_DEFINITIVA');
    await this.contratoRepo.softDelete(id, user.empresaId);
  }

  async getMorososParaCorte(graceDays: number) { return this.contratoRepo.findMorososParaCorte(graceDays); }
  async getParaReactivar() { return this.contratoRepo.findParaReactivar(); }
  async getProrrogasVencidas() { return this.contratoRepo.findProrrogasVencidas(); }

  // ── Métodos de red simulados ──────────────────────────────────
  // Cada uno verifica crear_reglas_en_router del plan para decidir
  // si el ERP debe crear el perfil (modo activo) o usar el existente
  // en MikroTik (modo heredado). Listos para inyectar comandos reales.
  // PM2 cluster guard: si se agregan crons aquí usar
  //   if (process.env.NODE_APP_INSTANCE !== '0') return true;

  // ── Verify-after-write: confirma que el hardware tiene la config esperada ──
  // Intenta verificar hasta 3 veces con 2s de espera entre intentos.
  // Retorna true si el hardware confirmó el estado, false si no se pudo verificar.
  // El timeout por intento es 10s para no bloquear el flujo de activación.
  protected async verificarProvisionHardware(contratoId: string): Promise<boolean> {
    const MAX_INTENTOS = 3;
    const ESPERA_MS    = 2000;

    for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
      try {
        const [row] = await this.dataSource.query<any[]>(`
          SELECT
            co.tipo_auth        AS "tipoAuth",
            co.usuario_pppoe    AS "usuarioPppoe",
            co.ip_asignada      AS "ipAsignada",
            co.mac_address      AS "macAddress",
            ro.vpn_ip           AS "vpnIp",
            ro.ip_gestion       AS "ipGestion",
            ro.puerto_api       AS "puertoApi",
            ro.puerto_api_ssl   AS "puertoApiSsl",
            ro.usuario          AS "routerUsuario",
            ro.password_cifrado AS "routerPassword",
            ro.usar_ssl         AS "usarSsl",
            ro.version_ros      AS "versionRos",
            pl.crear_reglas_en_router AS "crearReglas"
          FROM servicios co
          LEFT JOIN routers ro ON ro.id = co.router_id
          LEFT JOIN planes  pl ON pl.id = co.plan_id
          WHERE co.id = $1
        `, [contratoId]);

        if (!row?.crearReglas || (!row.vpnIp && !row.ipGestion)) return true; // sin hardware que verificar

        const rawTipo: string = row.tipoAuth ?? 'ninguna';
        const tipoControl     = rawTipo === 'pppoe_addresslist' ? 'pppoe' : rawTipo;

        const creds = {
          id:              contratoId,
          ip:              row.vpnIp || row.ipGestion,
          port:            row.usarSsl ? (row.puertoApiSsl ?? 8729) : (row.puertoApi ?? 8728),
          user:            row.routerUsuario ?? 'admin',
          passwordCifrado: row.routerPassword ?? '',
          useSsl:          row.usarSsl ?? false,
          timeoutSec:      10,
          version:         (row.versionRos ?? 'v6') as 'v6' | 'v7',
        };

        const existe = await this.pool.execute(creds, async (api) => {
          if (tipoControl === 'pppoe' && row.usuarioPppoe) {
            const secrets = await api.write('/ppp/secret/print', [`?name=${row.usuarioPppoe}`]);
            return secrets.length > 0;
          }
          if ((tipoControl === 'amarre_ip_mac' || tipoControl === 'amarre_ip_mac_dhcp') && row.ipAsignada) {
            const arps = await api.write('/ip/arp/print', [`?address=${row.ipAsignada}`]);
            return arps.length > 0;
          }
          return true; // tipo no verificable directamente
        });

        if (existe) return true;
        if (intento < MAX_INTENTOS) await new Promise(r => setTimeout(r, ESPERA_MS));

      } catch (err: any) {
        this.logger.warn(`verificarProvisionHardware → ${contratoId} intento ${intento}/${MAX_INTENTOS}: ${err?.message}`);
        if (intento < MAX_INTENTOS) await new Promise(r => setTimeout(r, ESPERA_MS));
      }
    }
    return false;
  }

  protected async provisionarMikrotik(contratoId: string): Promise<{ ok: boolean; motivo?: string }> {
    let row: any;
    try {
      const [r] = await this.dataSource.query<any[]>(`
        SELECT
          co.router_id           AS "routerId",
          co.usuario_pppoe       AS "usuarioPppoe",
          co.password_pppoe      AS "passwordPppoe",
          co.ip_asignada         AS "ipAsignada",
          co.mac_address         AS "macAddress",
          co.tipo_auth           AS "tipoAuth",
          cl.nombre_completo     AS "nombreCompleto",
          ro.vpn_ip              AS "vpnIp",
          ro.ip_gestion          AS "ipGestion",
          ro.puerto_api          AS "puertoApi",
          ro.puerto_api_ssl      AS "puertoApiSsl",
          ro.usuario             AS "routerUsuario",
          ro.password_cifrado    AS "routerPassword",
          ro.usar_ssl            AS "usarSsl",
          ro.nombre              AS "routerNombre",
          ro.version_ros         AS "versionRos",
          pl.ppp_profile         AS "pppProfile",
          -- Necesarias para crear el perfil PPPoE en el router con el rate-limit del
          -- plan si aún no existe (ver MikrotikService.crearReglasControl).
          pl.velocidad_bajada    AS "velocidadBajada",
          pl.velocidad_subida    AS "velocidadSubida",
          pl.crear_reglas_en_router AS "crearReglas"
        FROM servicios co
        JOIN clientes cl ON cl.id = co.cliente_id
        LEFT JOIN routers ro ON ro.id = co.router_id
        LEFT JOIN planes pl ON pl.id = co.plan_id
        WHERE co.id = $1
      `, [contratoId]);
      row = r;
    } catch (err) {
      this.logger.warn(`provisionarMikrotik → ${contratoId} | error leyendo contrato: ${err?.message}`);
      return { ok: false, motivo: `Error leyendo datos del contrato: ${err?.message}` };
    }

    if (!row) {
      this.logger.warn(`provisionarMikrotik → ${contratoId} | contrato no encontrado`);
      return { ok: false, motivo: 'Contrato no encontrado en la base de datos' };
    }

    if (!row.vpnIp && !row.ipGestion) {
      this.logger.warn(`provisionarMikrotik → ${contratoId} | router sin IP configurada`);
      return { ok: false, motivo: `El router "${row.routerNombre ?? 'sin nombre'}" no tiene IP VPN ni IP de gestión configurada — configúrala en Red → Routers` };
    }

    // Fix 2: respetar el flag del plan (igual que desaprovisionarMikrotik)
    if (!row.crearReglas) {
      this.logger.warn(`provisionarMikrotik → ${contratoId} | plan sin crear_reglas_en_router=true — omitiendo provisión MikroTik`);
      return { ok: false, motivo: 'El plan del abonado tiene "Crear reglas en router" desactivado — actívalo en Configuración → Planes' };
    }

    const creds: RouterCredentials = {
      id:              row.routerId ?? contratoId,
      ip:              row.vpnIp || row.ipGestion,
      port:            row.usarSsl ? (row.puertoApiSsl ?? 8729) : (row.puertoApi ?? 8728),
      user:            row.routerUsuario ?? 'admin',
      passwordCifrado: row.routerPassword ?? '',
      useSsl:          row.usarSsl ?? false,
      timeoutSec:      15,
      version:         (row.versionRos ?? 'v6') as any,
    };

    const _rawTipo: string = row.tipoAuth ?? 'ninguna';
    const tipoControl: string = _rawTipo === 'pppoe_addresslist' ? 'pppoe' : _rawTipo;

    // Fix 1: tipo efectivo NINGUNA → error explícito, no fallo silencioso
    if (tipoControl === 'ninguna') {
      throw new BadRequestException(
        `El contrato no tiene tipo de autenticación configurado. ` +
        `Selecciona PPPoE, Amarre IP/MAC o Amarre IP/MAC+DHCP al editar el servicio.`,
      );
    }

    // Fix 3: validaciones con error claro en lugar de return silencioso
    if (tipoControl === 'pppoe' && !row.usuarioPppoe) {
      throw new BadRequestException(
        `El contrato no tiene usuario PPPoE asignado. Asígnalo antes de activar.`,
      );
    }
    if ((tipoControl === 'amarre_ip_mac' || tipoControl === 'amarre_ip_mac_dhcp') && (!row.ipAsignada || !row.macAddress)) {
      throw new BadRequestException(
        `Amarre IP/MAC requiere IP (${row.ipAsignada ?? 'sin asignar'}) y MAC (${row.macAddress ?? 'sin asignar'}) configuradas en el contrato.`,
      );
    }

    // Ola 1, grupo 3b: crearReglasControl() habla ResultadoOperacion — se traduce aquí
    // preservando el mismo desenlace de antes (cualquier fallo aborta con throw); un
    // rechazado_definitivo se traduce a BadRequestException, igual que las demás
    // validaciones de este método.
    try {
      const rCrear = await this.mikrotikSvc.crearReglasControl(creds, row, tipoControl);
      if (!esExito(rCrear)) {
        if (rCrear.clase === 'rechazado_definitivo') throw new BadRequestException(rCrear.motivo);
        throw new Error(mensajeDe(rCrear));
      }
      this.logger.log(`provisionarMikrotik → ${contratoId} | tipo_control=${tipoControl} completado en ${creds.ip}`);
    } catch (err) {
      this.logger.warn(`provisionarMikrotik → ${contratoId} | error en router ${creds.ip}: ${err?.message}`);
      throw err;
    }

    // Marcar contrato como aprovisionado en la BD
    await this.contratoRepo.update(contratoId, { aprovisionado: true, aprovisionadoEn: new Date() } as any)
      .catch(e => this.logger.error(`provisionarMikrotik → aprovisionado flag: ${e?.message}`));

    return { ok: true };
  }

  async desaprovisionarMikrotik(contratoId: string, tipoAuthAnterior?: string): Promise<boolean> {
    let row: any;
    try {
      const [r] = await this.dataSource.query<any[]>(`
        SELECT
          co.router_id           AS "routerId",
          co.usuario_pppoe       AS "usuarioPppoe",
          co.ip_asignada         AS "ipAsignada",
          co.mac_address         AS "macAddress",
          co.tipo_auth           AS "tipoAuth",
          ro.vpn_ip              AS "vpnIp",
          ro.ip_gestion          AS "ipGestion",
          ro.puerto_api          AS "puertoApi",
          ro.puerto_api_ssl      AS "puertoApiSsl",
          ro.usuario             AS "routerUsuario",
          ro.password_cifrado    AS "routerPassword",
          ro.usar_ssl            AS "usarSsl",
          ro.nombre              AS "routerNombre",
          ro.version_ros         AS "versionRos",
          pl.crear_reglas_en_router AS "crearReglas"
        FROM servicios co
        LEFT JOIN routers ro ON ro.id = co.router_id
        LEFT JOIN planes pl ON pl.id = co.plan_id
        WHERE co.id = $1
      `, [contratoId]);
      row = r;
    } catch (err) {
      this.logger.warn(`desaprovisionarMikrotik → ${contratoId} | error leyendo contrato: ${err?.message}`);
      return false;
    }

    if (!row?.crearReglas || (!row.vpnIp && !row.ipGestion)) return true;

    const creds: RouterCredentials = {
      id:              row.routerId ?? contratoId,
      ip:              row.vpnIp || row.ipGestion,
      port:            row.usarSsl ? (row.puertoApiSsl ?? 8729) : (row.puertoApi ?? 8728),
      user:            row.routerUsuario ?? 'admin',
      passwordCifrado: row.routerPassword ?? '',
      useSsl:          row.usarSsl ?? false,
      timeoutSec:      15,
      version:         (row.versionRos ?? 'v6') as any,
    };

    // tipoAuthAnterior tiene prioridad: evita usar el tipo ya actualizado en BD
    const _rawTipo2: string = tipoAuthAnterior ?? row.tipoAuth ?? 'ninguna';
    const tipoControl: string = _rawTipo2 === 'pppoe_addresslist' ? 'pppoe' : _rawTipo2;

    try {
      // ── S0: Limpiar address-lists morosos/prorroga antes de eliminar reglas ──
      // La IP puede estar en morosos_datafast (suspendido) o prorroga_datafast (prórroga).
      // Si no se limpia aquí, la IP queda huérfana en el router cuando se elimina el cliente.
      if (row.ipAsignada) {
        try {
          await this.firewallSvc.reactivarCliente(creds, row.ipAsignada);
          this.logger.log(`desaprovisionarMikrotik → ${contratoId} | address-lists limpiadas: ${row.ipAsignada}`);
        } catch (e: any) {
          this.logger.warn(`desaprovisionarMikrotik → ${contratoId} | error limpiando address-lists: ${e?.message}`);
        }
      }

      if (tipoControl === 'pppoe' && row.usuarioPppoe) {
        await this.pppoeSvc.eliminar(creds, row.usuarioPppoe);
        this.logger.log(`desaprovisionarMikrotik → ${contratoId} | PPPoE eliminado: ${row.usuarioPppoe}`);
      } else if ((tipoControl === 'amarre_ip_mac' || tipoControl === 'amarre_ip_mac_dhcp') && row.ipAsignada) {
        await this.pool.execute(creds, async (api) => {
          const arps = await api.write('/ip/arp/print', [`?address=${row.ipAsignada}`]);
          for (const a of arps) {
            await api.write('/ip/arp/remove', [`=.id=${a['.id']}`]);
          }
        });
        this.logger.log(`desaprovisionarMikrotik → ${contratoId} | ARP eliminado: ${row.ipAsignada}`);

        if (tipoControl === 'amarre_ip_mac_dhcp' && row.macAddress) {
          await this.pool.execute(creds, async (api) => {
            const leases = await api.write('/ip/dhcp-server/lease/print');
            const macFmt = row.macAddress.toUpperCase().replace(/[^A-F0-9]/g, '').match(/.{2}/g)?.join(':') ?? row.macAddress.toUpperCase();
            const match = leases.find((l: any) => (l['mac-address'] || '').toUpperCase() === macFmt);
            if (match) await api.write('/ip/dhcp-server/lease/remove', [`=.id=${match['.id']}`]);
          });
          this.logger.log(`desaprovisionarMikrotik → ${contratoId} | DHCP binding eliminado: ${row.macAddress}`);
        }
      }
    } catch (err) {
      this.logger.warn(`desaprovisionarMikrotik → ${contratoId} | error al desprovisionar en router ${creds.ip}: ${err?.message}`);
      return false;
    }

    return true;
  }

  // ─── Eliminar ONU de la OLT (SmartOLT o nativo) ─────────────
  // Se llama ANTES de limpiar MikroTik para respetar el orden inverso
  // al aprovisionamiento: OLT → MikroTik → IP.
  // Nunca lanza excepción: un fallo de OLT no debe bloquear la baja.
  async desaprovisionarOlt(contratoId: string): Promise<void> {
    let row: any;
    try {
      const [r] = await this.dataSource.query<any[]>(`
        SELECT
          co.aprovisionado        AS aprovisionado,
          onu.id                  AS "onuId",
          onu.smartolt_onu_id     AS "smartoltOnuId",
          olt.smartolt_id         AS "smartoltId"
        FROM servicios co
        LEFT JOIN onus onu ON onu.id = co.onu_id
        LEFT JOIN olts olt ON olt.id = onu.olt_id
        WHERE co.id = $1
      `, [contratoId]);
      row = r;
    } catch (err) {
      this.logger.warn(`desaprovisionarOlt → ${contratoId} | error leyendo datos: ${err?.message}`);
      return;
    }

    if (!row?.aprovisionado || !row?.onuId) return;

    // SmartOLT: eliminar provisión via API. Ola 1, grupo 3b: eliminarProvision() habla
    // ResultadoOperacion y ya no lanza — el try/catch se conserva de todas formas, porque
    // el contrato documentado de este método ("Nunca lanza excepción: un fallo de OLT no
    // debe bloquear la baja") no depende de que el dominio cumpla su propia promesa.
    if (row.smartoltOnuId && row.smartoltId) {
      try {
        const r = await this.smartoltApi.eliminarProvision(row.smartoltId, row.smartoltOnuId);
        if (esExito(r)) {
          this.logger.log(`desaprovisionarOlt → ${contratoId} | ONU eliminada de SmartOLT: ${row.smartoltOnuId}`);
        } else {
          this.logger.warn(`desaprovisionarOlt → ${contratoId} | Error eliminando ONU de SmartOLT: ${mensajeDe(r)}`);
        }
      } catch (err: any) {
        this.logger.warn(`desaprovisionarOlt → ${contratoId} | Error eliminando ONU de SmartOLT: ${err?.message}`);
      }
    } else {
      // OLT nativo (SSH): NO se desaprovisiona aquí. La baja ya encoló DESAPROVISIONAR_ONU
      // en el outbox (ver bajaDefinitiva → encolarDesaprovisionarOnu), que ejecuta el
      // rollback GPON contra la OLT con reintento resiliente. Duplicar la llamada aquí
      // crearía dos rutas concurrentes sobre la misma ONU.
      this.logger.log(`desaprovisionarOlt → ${contratoId} | ONU ${row.onuId} es nativa (sin SmartOLT ID) — rollback GPON delegado al outbox.`);
    }

    // Actualizar estado de la ONU en BD (independientemente del resultado de la OLT)
    try {
      await this.dataSource.query(`
        UPDATE onus
        SET estado            = 'sin_aprovisionar',
            smartolt_onu_id   = NULL,
            aprovisionada_en  = NULL
        WHERE id = $1
      `, [row.onuId]);
    } catch (err) {
      this.logger.warn(`desaprovisionarOlt → ${contratoId} | Error actualizando ONU en BD: ${err?.message}`);
    }
  }

  protected async registrarEnAccessListAntena(contratoId: string): Promise<{ ok: boolean; advertencia?: string }> {
    const [row] = await this.dataSource.query<any[]>(`
      SELECT co.mac_address      AS "macAddress",
             co.antena_ap_id     AS "antenaApId",
             cl.nombre_completo  AS "nombreCompleto",
             dm.ip_address       AS "ipAddress",
             dm.usuario,
             dm.contrasena_cifrada AS "contrasenaCifrada",
             dm.puerto_api       AS "puertoApi",
             dm.use_ssl          AS "useSsl"
      FROM servicios co
      JOIN clientes cl ON cl.id = co.cliente_id
      LEFT JOIN dispositivos_monitoreo dm ON dm.id = co.antena_ap_id
      WHERE co.id = $1
    `, [contratoId]);

    // Fix 4: siempre retornar advertencia con detalle del campo faltante
    if (!row?.macAddress)  return { ok: false, advertencia: `Contrato sin MAC address — no se puede registrar en Access List de la antena` };
    if (!row?.antenaApId)  return { ok: false, advertencia: `Contrato sin antena_ap_id asignado — selecciona la antena AP del cliente` };
    if (!row?.ipAddress)   return { ok: false, advertencia: `El dispositivo de monitoreo antena_ap_id=${row.antenaApId} no tiene IP configurada` };

    const creds: RouterCredentials = {
      id:              row.antenaApId,
      ip:              row.ipAddress,
      port:            row.useSsl ? 8729 : (row.puertoApi ?? 8728),
      user:            row.usuario ?? 'admin',
      passwordCifrado: row.contrasenaCifrada ?? '',
      useSsl:          row.useSsl ?? false,
      timeoutSec:      10,
      version:         'v6',
    };

    // Ola 1, grupo 3b: agregarMacAccessList() habla ResultadoOperacion y ya no lanza — se
    // traduce sin try/catch, mismo desenlace de antes (nunca bloquea, siempre informa).
    const rMac = await this.wirelessSvc.agregarMacAccessList(creds, row.macAddress, `DATAFAST:${row.nombreCompleto}`);
    if (esExito(rMac)) {
      this.logger.log(`registrarEnAccessListAntena → ${contratoId} | MAC ${row.macAddress} registrada en AP ${row.ipAddress}`);
      return { ok: true };
    }
    this.logger.warn(`registrarEnAccessListAntena → ${contratoId} | error al registrar MAC en AP: ${mensajeDe(rMac)}`);
    return { ok: false, advertencia: `MAC ${row.macAddress} no registrada en AP ${row.ipAddress}: ${mensajeDe(rMac)}` };
  }

  async eliminarDeAccessListAntena(contratoId: string): Promise<void> {
    const [row] = await this.dataSource.query<any[]>(`
      SELECT co.mac_address      AS "macAddress",
             co.antena_ap_id     AS "antenaApId",
             dm.ip_address       AS "ipAddress",
             dm.usuario,
             dm.contrasena_cifrada AS "contrasenaCifrada",
             dm.puerto_api       AS "puertoApi",
             dm.use_ssl          AS "useSsl"
      FROM servicios co
      LEFT JOIN dispositivos_monitoreo dm ON dm.id = co.antena_ap_id
      WHERE co.id = $1
    `, [contratoId]);

    // Si no hay MAC address, no hay nada que limpiar en ninguna antena
    if (!row?.macAddress) return;

    // Hay MAC pero no antena_ap_id → el cliente fue dado de baja sin antena asignada
    if (!row?.antenaApId) {
      this.logger.warn(
        `eliminarDeAccessListAntena → ${contratoId} | MAC ${row.macAddress} no tiene antena_ap_id asignado — no se puede limpiar Access List`,
      );
      return;
    }

    // Hay antena_ap_id pero el dispositivo de monitoreo no existe (fue eliminado)
    if (!row?.ipAddress) {
      this.logger.warn(
        `eliminarDeAccessListAntena → ${contratoId} | antena_ap_id ${row.antenaApId} no tiene dispositivo de monitoreo (ipAddress) — posiblemente fue eliminado de la base de datos`,
      );
      return;
    }

    const creds: RouterCredentials = {
      id:              row.antenaApId,
      ip:              row.ipAddress,
      port:            row.useSsl ? 8729 : (row.puertoApi ?? 8728),
      user:            row.usuario ?? 'admin',
      passwordCifrado: row.contrasenaCifrada ?? '',
      useSsl:          row.useSsl ?? false,
      timeoutSec:      10,
      version:         'v6',
    };

    // Ola 1, grupo 3b: eliminarMacAccessList() habla ResultadoOperacion y ya no lanza — se
    // traduce sin try/catch. ya_en_destino sustituye al "removed === 0" que antes se leía
    // como advertencia de "no encontrada" con el mismo mensaje.
    const rMac = await this.wirelessSvc.eliminarMacAccessList(creds, row.macAddress);
    if (rMac.clase === 'aplicado') {
      this.logger.log(
        `eliminarDeAccessListAntena → ${contratoId} | MAC ${row.macAddress} removida de AP ${row.ipAddress}`,
      );
    } else if (rMac.clase === 'ya_en_destino') {
      this.logger.warn(
        `eliminarDeAccessListAntena → ${contratoId} | MAC ${row.macAddress} no encontrada en Access List del AP ${row.ipAddress} — posiblemente ya fue removida o nunca existió`,
      );
    } else {
      this.logger.warn(
        `eliminarDeAccessListAntena → ${contratoId} | error al remover MAC ${row.macAddress} del AP ${row.ipAddress}: ${mensajeDe(rMac)}`,
      );
    }
  }

  // Mantiene compatibilidad con el módulo de aprovisionamiento FTTH existente.
  async executeHuaweiOltAprovisionamiento(contratoId: string, onuSn: string): Promise<boolean> {
    this.logger.log(`[SIM] executeHuaweiOltAprovisionamiento → contratoId: ${contratoId}, onuSn: ${onuSn}`);
    return true;
  }

  async getAntenasAP(routerId: string, empresaId: string): Promise<any[]> {
    return this.dataSource.query(
      `SELECT id,
              nombre_emisor AS "nombreEmisor",
              ip_address    AS "ipAddress",
              tipo_equipo   AS "tipoEquipo",
              status
       FROM dispositivos_monitoreo
       WHERE empresa_id        = $1
         AND router_acceso_id  = $2
         AND tipo_equipo       = 'ANTENA_AP'
         AND deleted_at IS NULL
       ORDER BY nombre_emisor ASC`,
      [empresaId, routerId],
    );
  }

  async aprovisionarOnuSimulado(id: string, onuSn: string, user: JwtPayload): Promise<{ ok: boolean; mensaje: string }> {
    const contrato = await this.findOne(id, user.empresaId);
    await this.executeHuaweiOltAprovisionamiento(id, onuSn);
    await this.contratoRepo.update(id, { updatedBy: user.sub });
    await this.auditoria.logUpdate({
      empresaId:    user.empresaId,
      usuarioId:    user.sub,
      usuarioEmail: user.email,
      modulo:       'contratos',
      entidadId:    id,
      descripcion:  `[SIM] ONU aprovisionada SN: ${onuSn} en contrato ${contrato.numeroContrato}`,
    });
    return { ok: true, mensaje: `ONU ${onuSn} aprovisionada correctamente (simulado)` };
  }

  private async verificarSubredEnRouter(routerId: string, segmentoId: string, empresaId: string): Promise<void> {
    const [[r], [s]] = await Promise.all([
      this.dataSource.query<any[]>(`
        SELECT vpn_ip AS "vpnIp", ip_gestion AS "ipGestion",
               puerto_api AS "puertoApi", puerto_api_ssl AS "puertoApiSsl",
               usuario, password_cifrado AS "passwordCifrado", usar_ssl AS "usarSsl",
               nombre
        FROM routers WHERE id = $1 AND empresa_id = $2 AND deleted_at IS NULL`,
        [routerId, empresaId],
      ),
      this.dataSource.query<any[]>(
        `SELECT red_cidr AS "redCidr", nombre FROM segmentos_ipv4 WHERE id = $1 AND empresa_id = $2`,
        [segmentoId, empresaId],
      ),
    ]);
    if (!r || !s) return;

    const creds: RouterCredentials = {
      id:              routerId,
      ip:              r.vpnIp || r.ipGestion,
      port:            r.usarSsl ? r.puertoApiSsl : r.puertoApi,
      user:            r.usuario ?? 'admin',
      passwordCifrado: r.passwordCifrado ?? '',
      useSsl:          r.usarSsl ?? false,
      timeoutSec:      10,
      version:         'v6',
    };

    try {
      await this.pool.execute(creds, async (api) => {
        const addrs: any[] = await api.write('/ip/address/print');
        const encontrado = addrs.some(a => a.address && this.subredCoincide(a.address, s.redCidr));
        if (!encontrado) {
          throw new BadRequestException(
            `El segmento ${s.redCidr} (${s.nombre}) no está configurado en el router "${r.nombre}". ` +
            `Agrégalo en IP → Addresses del router antes de asignar clientes.`,
          );
        }
      });
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      // Error de conectividad: el segmento podría estar bien configurado pero el router
      // no es accesible en este momento. No bloquear la creación del contrato.
      this.logger.warn(
        `verificarSubredEnRouter → router "${r.nombre}" inaccesible, validación omitida: ${err?.message ?? 'Error de conexión'}`,
      );
    }
  }

  private subredCoincide(rosAddr: string, cidr: string): boolean {
    const [rosIp, rosPfxStr] = rosAddr.split('/');
    const [netIp, netPfxStr]  = cidr.split('/');
    if (!rosIp || !rosPfxStr || !netIp || !netPfxStr) return false;
    const pfx = parseInt(netPfxStr, 10);
    if (parseInt(rosPfxStr, 10) !== pfx) return false;
    const mask = pfx === 0 ? 0 : (~0 << (32 - pfx)) >>> 0;
    return (this.ipToInt(rosIp) & mask) === (this.ipToInt(netIp) & mask);
  }

  private ipToInt(ip: string): number {
    return ip.split('.').reduce((acc, oct) => ((acc << 8) + parseInt(oct, 10)) >>> 0, 0);
  }
}
