import {
  Process, Processor,
  OnQueueFailed, OnQueueCompleted, OnQueueStalled,
} from '@nestjs/bull';
import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectQueue }         from '@nestjs/bull';
import { Job, Queue }          from 'bull';
import { Cron }                from '@nestjs/schedule';
import { InjectDataSource }    from '@nestjs/typeorm';
import { DataSource }          from 'typeorm';
import { CACHE_MANAGER }       from '@nestjs/cache-manager';
import { Cache }               from 'cache-manager';
import { EventEmitter2 as EventEmitter } from '@nestjs/event-emitter';

import { FirewallService }     from '../mikrotik/services/firewall.service';
import { PppoeService }        from '../mikrotik/services/pppoe.service';
import { WhatsAppService }     from '../notificaciones/services/whatsapp.service';
import { FacturacionService }  from '../facturacion/facturacion.service';
import { AuditoriaService }    from '../auth/auditoria.service';

import {
  QUEUES, JOBS, JOB_OPTIONS,
  PayloadSuspenderContrato,
  PayloadReactivarContrato,
  PayloadEvaluarProrroga,
  PayloadProcesarPago,
} from './workers.constants';
import { decrypt } from '../../common/utils/encryption.util';

// ─────────────────────────────────────────────────────────────
// CobranzaScheduler — Encola los jobs en los momentos correctos
// ─────────────────────────────────────────────────────────────
@Injectable()
export class CobranzaScheduler {
  private readonly logger = new Logger(CobranzaScheduler.name);

  constructor(
    @InjectQueue(QUEUES.COBRANZA) private readonly queue: Queue,
    @InjectDataSource()           private readonly ds: DataSource,
    private readonly facturacionSvc: FacturacionService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  // Lee el horario configurado para un job; devuelve [hora, minuto]
  private async getHoraConf(key: string, defaultHora = '05:00'): Promise<[number, number]> {
    const cacheKey = `cron:horario:${key}`;
    let valor = await this.cache.get<string>(cacheKey);

    if (!valor) {
      const [emp] = await this.ds.query(
        `SELECT cron_horarios->>'${key}' AS hora FROM empresas LIMIT 1`,
      ).catch(() => [null]);
      valor = emp?.hora ?? defaultHora;
      await this.cache.set(cacheKey, valor, 5 * 60 * 1000); // cache 5 min
    }

    const [h, m] = (valor as string).split(':').map(Number);
    return [h || 0, m || 0];
  }

  // Retorna true si es el momento de ejecutar y adquiere un lock diario
  private async debeEjecutar(jobKey: string, hora: number, minuto: number): Promise<boolean> {
    const now = new Date();
    if (now.getHours() !== hora || now.getMinutes() !== minuto) return false;

    const lockKey = `cron:ran:${jobKey}:${now.toISOString().split('T')[0]}`;
    const yaCorrio = await this.cache.get(lockKey);
    if (yaCorrio) return false;

    await this.cache.set(lockKey, '1', 23 * 60 * 60 * 1000); // lock 23h
    return true;
  }

  // ─── GENERACIÓN AUTOMÁTICA DE FACTURAS ───────────────────
  // Corre cada minuto; ejecuta cuando la hora coincide con la
  // hora configurada en empresas.cron_horarios.facturacion
  @Cron('* * * * *', { timeZone: 'America/Lima', name: 'auto-facturacion-diaria' })
  async generarFacturasDiarias(): Promise<void> {
    const [hora, min] = await this.getHoraConf('facturacion', '05:00');
    if (!await this.debeEjecutar('facturacion', hora, min)) return;

    const hoy  = new Date();
    const dia  = hoy.getDate();
    const mes  = hoy.getMonth() + 1;
    const anio = hoy.getFullYear();

    this.logger.log(`[CRON] Auto-facturación día ${dia}/${mes}/${anio}`);

    const empresas: { id: string }[] = await this.ds.query(
      `SELECT id FROM empresas WHERE deleted_at IS NULL`,
    );

    let totalExitosas = 0;
    let totalErrores  = 0;

    for (const emp of empresas) {
      try {
        const r = await this.facturacionSvc.generarFacturasDelDia(emp.id, dia, mes, anio);
        totalExitosas += r.exitosas;
        totalErrores  += r.errores;
      } catch (err) {
        totalErrores++;
        this.logger.error(`[CRON] Error auto-facturación empresa ${emp.id}: ${err.message}`);
      }
    }

    this.logger.log(
      `[CRON] Auto-facturación completada: ${totalExitosas} facturas | ${totalErrores} errores | ${empresas.length} empresas`,
    );
  }

  // ─── DETECCIÓN DIARIA DE MOROSOS ──────────────────────────
  // Busca contratos activos con deuda y los suspende si superan
  // los días de gracia configurados por la empresa.
  @Cron('* * * * *', { timeZone: 'America/Lima', name: 'deteccion-morosos' })
  async detectarMorosos(): Promise<void> {
    const [hora, min] = await this.getHoraConf('corte', '06:00');
    if (!await this.debeEjecutar('corte', hora, min)) return;

    this.logger.log('[CRON] Iniciando detección diaria de morosos');

    const morosos = await this.ds.query(`
      SELECT
        co.id              AS contrato_id,
        co.empresa_id,
        co.cliente_id,
        co.router_id,
        co.ip_asignada,
        co.usuario_pppoe,
        co.deuda_total,
        co.meses_deuda,
        co.en_prorroga,
        co.prorroga_hasta,
        co.estado,
        em.dias_gracia_corte,
        em.notif_whatsapp_corte,
        EXTRACT(DAY FROM (NOW() - COALESCE(co.fecha_ultimo_pago, co.fecha_inicio)::timestamptz))::int
          AS dias_sin_pago
      FROM contratos co
      JOIN empresas em ON em.id = co.empresa_id
      WHERE co.estado IN ('activo', 'prorroga')
        AND co.deuda_total > 0
        AND co.deleted_at IS NULL
        AND co.router_id IS NOT NULL
        AND co.ip_asignada IS NOT NULL
        AND co.usuario_pppoe IS NOT NULL
      ORDER BY co.deuda_total DESC
    `);

    let suspender = 0;
    let omitidos  = 0;

    for (const c of morosos) {
      const diasGracia = parseInt(c.dias_gracia_corte || '5', 10);

      // Si está en prórroga y la prórroga no ha vencido → omitir
      if (c.en_prorroga && c.prorroga_hasta) {
        const venceProrroga = new Date(c.prorroga_hasta);
        if (venceProrroga > new Date()) {
          omitidos++;
          continue;
        }
        // Prórroga vencida → encolar job de vencimiento de prórroga
        await this.queue.add(JOBS.VENCER_PRORROGA, {
          contratoId: c.contrato_id,
          empresaId:  c.empresa_id,
          clienteId:  c.cliente_id,
          prorrogaHasta: c.prorroga_hasta,
        } as PayloadEvaluarProrroga, JOB_OPTIONS.CRITICO);
      }

      // Solo suspender si superó los días de gracia
      if (parseInt(c.dias_sin_pago, 10) > diasGracia) {
        await this.queue.add(
          JOBS.SUSPENDER_CONTRATO,
          {
            contratoId:   c.contrato_id,
            empresaId:    c.empresa_id,
            clienteId:    c.cliente_id,
            routerId:     c.router_id,
            ipAsignada:   c.ip_asignada,
            usuarioPppoe: c.usuario_pppoe,
            deudaTotal:   parseFloat(c.deuda_total),
            mesesDeuda:   parseInt(c.meses_deuda, 10),
            notificar:    c.notif_whatsapp_corte,
          } as PayloadSuspenderContrato,
          {
            ...JOB_OPTIONS.CRITICO,
            // Escalonar suspensiones: 1 seg entre cada una
            delay: suspender * 1000,
          },
        );
        suspender++;
      }
    }

    this.logger.log(
      `[CRON] Detección morosos: ${morosos.length} encontrados | ` +
      `${suspender} a suspender | ${omitidos} en prórroga vigente`,
    );
  }

  // ─── PRÓRROGAS VENCIDAS (verificar cada 2h) ───────────────
  @Cron('0 */2 * * *', { timeZone: 'America/Lima', name: 'prorrogas-vencidas' })
  async verificarProrrogasVencidas(): Promise<void> {
    const hoy = new Date().toISOString().split('T')[0];

    const prorrogasVencidas = await this.ds.query(`
      SELECT co.id, co.empresa_id, co.cliente_id, co.router_id,
             co.ip_asignada, co.usuario_pppoe, co.deuda_total,
             co.meses_deuda, co.prorroga_hasta
      FROM contratos co
      WHERE co.en_prorroga = true
        AND co.prorroga_hasta < $1
        AND co.estado = 'prorroga'
        AND co.deleted_at IS NULL
    `, [hoy]);

    for (const c of prorrogasVencidas) {
      await this.queue.add(JOBS.VENCER_PRORROGA, {
        contratoId:   c.id,
        empresaId:    c.empresa_id,
        clienteId:    c.cliente_id,
        prorrogaHasta: c.prorroga_hasta,
      } as PayloadEvaluarProrroga, JOB_OPTIONS.CRITICO);
    }

    if (prorrogasVencidas.length) {
      this.logger.log(
        `[CRON] ${prorrogasVencidas.length} prórrogas vencidas encoladas para suspensión`,
      );
    }
  }

  // ─── NOTIFICACIONES PREVENTIVAS ───────────────────────────
  // Avisa a clientes que vencen en 3 días y en el día.
  // Corre cada minuto; ejecuta en hora configurada (recordatorio1).
  @Cron('* * * * *', { timeZone: 'America/Lima', name: 'notif-preventivas' })
  async notificacionesPreventivas(): Promise<void> {
    const [hora1, min1] = await this.getHoraConf('recordatorio1', '09:00');
    const [hora2, min2] = await this.getHoraConf('recordatorio2', '12:00');
    const [hora3, min3] = await this.getHoraConf('recordatorio3', '19:00');

    const now = new Date();
    const h   = now.getHours();
    const m   = now.getMinutes();

    const esR1 = h === hora1 && m === min1;
    const esR2 = h === hora2 && m === min2;
    const esR3 = h === hora3 && m === min3;

    // Ejecutar en el primer recordatorio que coincida y no haya corrido
    let lockKey: string | null = null;
    if      (esR1 && !await this.cache.get(`cron:ran:rec1:${now.toISOString().split('T')[0]}`)) lockKey = 'rec1';
    else if (esR2 && !await this.cache.get(`cron:ran:rec2:${now.toISOString().split('T')[0]}`)) lockKey = 'rec2';
    else if (esR3 && !await this.cache.get(`cron:ran:rec3:${now.toISOString().split('T')[0]}`)) lockKey = 'rec3';

    if (!lockKey) return;
    await this.cache.set(`cron:ran:${lockKey}:${now.toISOString().split('T')[0]}`, '1', 23 * 60 * 60 * 1000);

    for (const diasAntes of [3, 1]) {
      const fecha = new Date();
      fecha.setDate(fecha.getDate() + diasAntes);
      const fechaStr = fecha.toISOString().split('T')[0];

      const porVencer = await this.ds.query(`
        SELECT co.id, co.empresa_id, co.cliente_id,
               cl.nombre_completo, cl.whatsapp, cl.telefono,
               co.deuda_total
        FROM contratos co
        JOIN clientes cl ON cl.id = co.cliente_id
        JOIN empresas em ON em.id = co.empresa_id
        WHERE co.estado = 'activo'
          AND co.deuda_total > 0
          AND co.deleted_at IS NULL
          AND em.notif_whatsapp_vencimiento = true
          AND (cl.whatsapp IS NOT NULL OR cl.telefono IS NOT NULL)
        LIMIT 1000
      `);

      for (const c of porVencer) {
        await this.queue.add(
          JOBS.NOTIF_COBRO_PREVIO,
          {
            clienteId: c.cliente_id,
            empresaId: c.empresa_id,
            telefono:  c.whatsapp || c.telefono,
            nombre:    c.nombre_completo,
            montoDeuda: parseFloat(c.deuda_total),
            diasAntes,
            facturaIds: [],
          },
          JOB_OPTIONS.NOTIFICACION,
        );
      }
    }
  }

  // ─── Método público para encolar reactivación desde PagosService ─
  async enqueueReactivacion(payload: PayloadReactivarContrato): Promise<void> {
    await this.queue.add(JOBS.REACTIVAR_CONTRATO, payload, JOB_OPTIONS.CRITICO);
    this.logger.log(`Reactivación encolada: contrato ${payload.contratoId}`);
  }

  async enqueueProcesarPago(payload: PayloadProcesarPago): Promise<void> {
    await this.queue.add(JOBS.PROCESAR_PAGO, payload, {
      ...JOB_OPTIONS.CRITICO,
      priority: 1, // Alta prioridad
    });
  }
}

// ─────────────────────────────────────────────────────────────
// CobranzaWorker — Ejecuta los jobs de cobranza
// ─────────────────────────────────────────────────────────────
@Processor(QUEUES.COBRANZA)
export class CobranzaWorker {
  private readonly logger = new Logger(CobranzaWorker.name);

  constructor(
    private readonly firewallSvc:    FirewallService,
    private readonly pppoeSvc:       PppoeService,
    private readonly whatsappSvc:    WhatsAppService,
    private readonly facturacionSvc: FacturacionService,
    private readonly auditoria:      AuditoriaService,
    private readonly events:         EventEmitter,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  // ────────────────────────────────────────────────────────────
  // JOB: SUSPENDER CONTRATO
  // 1. Agrega IP a Address List "morosos" en Mikrotik
  // 2. Desconecta sesión PPPoE activa
  // 3. Actualiza estado en BD
  // 4. Notifica al cliente por WhatsApp
  // ────────────────────────────────────────────────────────────
  @Process({ name: JOBS.SUSPENDER_CONTRATO, concurrency: 5 })
  async processSuspenderContrato(job: Job<PayloadSuspenderContrato>): Promise<any> {
    const { contratoId, empresaId, clienteId, routerId, ipAsignada, usuarioPppoe, deudaTotal, notificar } = job.data;

    this.logger.log(
      `[SUSPENDER] Contrato ${contratoId} | IP: ${ipAsignada} | Deuda: S/ ${deudaTotal}`,
    );

    const errores: string[] = [];

    // ── 1. Obtener credenciales del router ────────────────────
    const [router] = await this.ds.query(`
      SELECT ip_gestion, usuario, password_cifrado, usar_ssl,
             puerto_api, puerto_api_ssl, version_ros, timeout_conexion
      FROM routers WHERE id = $1
    `, [routerId]).catch(() => [null]);

    if (router) {
      const creds = this.buildCreds(routerId, router);

      // ── 2. Agregar a Address List morosos ─────────────────
      await job.progress(20);
      try {
        await this.firewallSvc.suspenderCliente(
          creds, ipAsignada, clienteId,
          `Mora S/ ${deudaTotal} — ${new Date().toLocaleDateString('es-PE')}`,
        );
        this.logger.log(`✓ IP ${ipAsignada} en lista morosos | router: ${router.ip_gestion}`);
      } catch (err) {
        errores.push(`Firewall: ${err.message}`);
        this.logger.error(`✗ Error Address List ${ipAsignada}: ${err.message}`);
      }

      // ── 3. Desconectar sesión PPPoE ────────────────────────
      await job.progress(40);
      try {
        await this.pppoeSvc.desconectarSesion(creds, usuarioPppoe);
        this.logger.log(`✓ Sesión PPPoE desconectada: ${usuarioPppoe}`);
      } catch (err) {
        errores.push(`PPPoE disconnect: ${err.message}`);
        this.logger.warn(`✗ No se pudo desconectar sesión ${usuarioPppoe}: ${err.message}`);
      }
    } else {
      errores.push(`Router ${routerId} no encontrado`);
    }

    // ── 4. Actualizar estado en BD ─────────────────────────
    await job.progress(60);
    await this.ds.query(`
      UPDATE contratos SET
        estado = 'suspendido_mora',
        fecha_estado = NOW(),
        motivo_estado = $1
      WHERE id = $2 AND estado IN ('activo', 'prorroga')
    `, [
      `Suspensión automática: S/ ${deudaTotal} de deuda | ${new Date().toLocaleDateString('es-PE')}`,
      contratoId,
    ]);

    await this.ds.query(`
      INSERT INTO contratos_historial
        (contrato_id, empresa_id, estado_anterior, estado_nuevo, motivo, usuario_id, automatico)
      VALUES ($1, $2, 'activo', 'suspendido_mora', $3, 'sistema', true)
    `, [contratoId, empresaId, `Corte automático: deuda S/ ${deudaTotal}`]);

    // ── 5. Notificar al cliente ────────────────────────────
    await job.progress(80);
    if (notificar) {
      const [cliente] = await this.ds.query(`
        SELECT cl.nombre_completo, cl.whatsapp, cl.telefono,
               em.razon_social AS empresa_nombre
        FROM contratos co
        JOIN clientes cl ON cl.id = co.cliente_id
        JOIN empresas em ON em.id = co.empresa_id
        WHERE co.id = $1
      `, [contratoId]).catch(() => [null]);

      if (cliente) {
        const tel = cliente.whatsapp || cliente.telefono;
        if (tel) {
          await this.whatsappSvc.notificarServicioSuspendido({
            telefono:      tel,
            clienteNombre: cliente.nombre_completo,
            deudaTotal,
            nombreEmpresa: cliente.empresa_nombre,
          }).catch((err) =>
            this.logger.warn(`WhatsApp suspensión falló: ${err.message}`),
          );
        }
      }
    }

    // ── 6. Auditoría ───────────────────────────────────────
    await job.progress(100);
    await this.auditoria.log({
      empresaId,
      accion:      'AUTO_SUSPEND',
      modulo:      'cobranza',
      entidadId:   contratoId,
      descripcion: `Suspensión automática: IP ${ipAsignada} | Deuda: S/ ${deudaTotal} | Errores: ${errores.length}`,
    });

    // Emitir evento para WebSocket
    this.events.emit('mikrotik.cliente.suspendido', {
      clienteId, empresaId, ip: ipAsignada, routerId, contratoId,
    });

    this.logger.log(
      `[SUSPENDER] ✅ Contrato ${contratoId} suspendido | ` +
      `${errores.length ? `ERRORES: ${errores.join(', ')}` : 'sin errores'}`,
    );

    return { contratoId, ipAsignada, errores };
  }

  // ────────────────────────────────────────────────────────────
  // JOB: REACTIVAR CONTRATO
  // 1. Quita IP de Address Lists (morosos, prorroga)
  // 2. Activa el usuario PPPoE
  // 3. Actualiza estado en BD
  // 4. Notifica al cliente
  // ────────────────────────────────────────────────────────────
  @Process({ name: JOBS.REACTIVAR_CONTRATO, concurrency: 5 })
  async processReactivarContrato(job: Job<PayloadReactivarContrato>): Promise<any> {
    const { contratoId, empresaId, clienteId, routerId, ipAsignada, planNombre, notificar } = job.data;

    this.logger.log(`[REACTIVAR] Contrato ${contratoId} | IP: ${ipAsignada}`);
    const errores: string[] = [];

    // ── 1. Credenciales del router ─────────────────────────
    const [router] = await this.ds.query(
      'SELECT ip_gestion, usuario, password_cifrado, usar_ssl, puerto_api, puerto_api_ssl, version_ros, timeout_conexion FROM routers WHERE id = $1',
      [routerId],
    ).catch(() => [null]);

    if (router) {
      const creds = this.buildCreds(routerId, router);

      await job.progress(25);

      // ── 2. Quitar de Address Lists ─────────────────────
      try {
        await this.firewallSvc.reactivarCliente(creds, ipAsignada);
        this.logger.log(`✓ IP ${ipAsignada} removida de listas de control`);
      } catch (err) {
        errores.push(`Firewall: ${err.message}`);
        this.logger.error(`✗ Error removiendo ${ipAsignada} de Address List: ${err.message}`);
      }

      await job.progress(50);
    } else {
      errores.push(`Router ${routerId} no encontrado`);
      this.logger.warn(`Router ${routerId} no encontrado para reactivar ${contratoId}`);
    }

    // ── 3. Actualizar estado en BD ─────────────────────────
    await job.progress(70);
    await this.ds.query(`
      UPDATE contratos SET
        estado = 'activo',
        fecha_estado = NOW(),
        motivo_estado = 'Reactivación automática por pago registrado',
        en_prorroga = false
      WHERE id = $1 AND estado IN ('suspendido_mora', 'prorroga')
    `, [contratoId]);

    await this.ds.query(`
      INSERT INTO contratos_historial
        (contrato_id, empresa_id, estado_anterior, estado_nuevo, motivo, usuario_id, automatico)
      VALUES ($1, $2, 'suspendido_mora', 'activo', 'Reactivación automática por pago', 'sistema', true)
    `, [contratoId, empresaId]);

    // ── 4. Notificar ───────────────────────────────────────
    await job.progress(85);
    if (notificar !== false) {
      const [cliente] = await this.ds.query(`
        SELECT cl.nombre_completo, cl.whatsapp, cl.telefono
        FROM contratos co JOIN clientes cl ON cl.id = co.cliente_id
        WHERE co.id = $1
      `, [contratoId]).catch(() => [null]);

      if (cliente) {
        const tel = cliente.whatsapp || cliente.telefono;
        if (tel) {
          await this.whatsappSvc.notificarServicioReactivado({
            telefono:      tel,
            clienteNombre: cliente.nombre_completo,
            planNombre:    planNombre || 'tu plan',
          }).catch((err) =>
            this.logger.warn(`WhatsApp reactivación fallido: ${err.message}`),
          );
        }
      }
    }

    await job.progress(100);

    // Emitir evento WebSocket
    this.events.emit('mikrotik.cliente.reactivado', {
      clienteId, empresaId, ip: ipAsignada, routerId, contratoId,
    });

    await this.auditoria.log({
      empresaId,
      accion:      'AUTO_REACTIVATE',
      modulo:      'cobranza',
      entidadId:   contratoId,
      descripcion: `Reactivación automática: IP ${ipAsignada} | Errores: ${errores.length}`,
    });

    this.logger.log(
      `[REACTIVAR] ✅ Contrato ${contratoId} reactivado | ` +
      `${errores.length ? `ERRORES: ${errores.join(', ')}` : 'sin errores'}`,
    );

    return { contratoId, ipAsignada, errores };
  }

  // ────────────────────────────────────────────────────────────
  // JOB: VENCER PRÓRROGA
  // Cuando vence la prórroga y sigue sin pagar → suspender
  // ────────────────────────────────────────────────────────────
  @Process({ name: JOBS.VENCER_PRORROGA, concurrency: 3 })
  async processVencerProrroga(job: Job<PayloadEvaluarProrroga>): Promise<any> {
    const { contratoId, empresaId, clienteId, prorrogaHasta } = job.data;

    this.logger.log(`[PRORROGA] Verificando vencimiento: contrato ${contratoId} | hasta: ${prorrogaHasta}`);

    // Obtener datos completos del contrato
    const [contrato] = await this.ds.query(`
      SELECT co.id, co.deuda_total, co.router_id,
             co.ip_asignada, co.usuario_pppoe, co.meses_deuda, co.estado
      FROM contratos co
      WHERE co.id = $1 AND co.deleted_at IS NULL
    `, [contratoId]);

    if (!contrato) {
      this.logger.warn(`Contrato ${contratoId} no encontrado para evaluar prórroga`);
      return { omitido: true };
    }

    // Verificar que sigue en prórroga y tiene deuda
    if (contrato.estado !== 'prorroga' || parseFloat(contrato.deuda_total) <= 0) {
      this.logger.log(`Contrato ${contratoId}: prórroga ya resuelta o sin deuda`);
      return { omitido: true };
    }

    // La prórroga venció y sigue debiendo → suspender
    await this.enqueueCobranza(JOBS.SUSPENDER_CONTRATO, {
      contratoId,
      empresaId,
      clienteId,
      routerId:     contrato.router_id,
      ipAsignada:   contrato.ip_asignada,
      usuarioPppoe: contrato.usuario_pppoe,
      deudaTotal:   parseFloat(contrato.deuda_total),
      mesesDeuda:   contrato.meses_deuda,
      notificar:    true,
    } as PayloadSuspenderContrato);

    this.logger.log(
      `[PRORROGA] ✅ Prórroga vencida el ${prorrogaHasta} — suspensión encolada para ${contratoId}`,
    );

    return { contratoId, prorrogaHasta, accion: 'suspendido' };
  }

  // ────────────────────────────────────────────────────────────
  // JOB: PROCESAR PAGO Y REACTIVAR SI APLICA
  // Cuando se registra un pago verificado, aplica a la factura
  // y evalúa si el contrato puede reactivarse.
  // ────────────────────────────────────────────────────────────
  @Process({ name: JOBS.PROCESAR_PAGO, concurrency: 10 })
  async processPago(job: Job<PayloadProcesarPago>): Promise<any> {
    const { pagoId, facturaId, contratoId, empresaId, montoPago, fechaPago } = job.data;

    this.logger.log(`[PAGO] Procesando: pago=${pagoId} | factura=${facturaId} | monto=S/${montoPago}`);

    // ── 1. Aplicar pago a la factura ──────────────────────
    await job.progress(25);
    const facturaActualizada = await this.facturacionSvc.aplicarPago(
      facturaId, montoPago, empresaId, fechaPago,
    );

    // ── 2. Recalcular deuda total del contrato ─────────────
    await job.progress(50);
    const [deudaRow] = await this.ds.query(`
      SELECT
        COALESCE(SUM(saldo), 0)::DECIMAL AS deuda,
        COUNT(*) FILTER (WHERE estado IN ('emitida','pagada_parcial','vencida','en_cobranza'))::INT AS meses
      FROM facturas
      WHERE contrato_id = $1 AND estado != 'anulada' AND deleted_at IS NULL
    `, [contratoId]);

    const nuevaDeuda  = parseFloat(deudaRow?.deuda || '0');
    const nuevosMeses = parseInt(deudaRow?.meses || '0', 10);

    // Actualizar deuda en el contrato
    await this.ds.query(`
      UPDATE contratos SET deuda_total = $1, meses_deuda = $2, fecha_ultimo_pago = $3
      WHERE id = $4
    `, [nuevaDeuda, nuevosMeses, fechaPago, contratoId]);

    await job.progress(75);

    // ── 3. Si la deuda quedó en cero y el contrato estaba suspendido → reactivar ─
    if (nuevaDeuda <= 0) {
      const [contrato] = await this.ds.query(`
        SELECT co.estado, co.router_id, co.ip_asignada,
               pl.nombre AS plan_nombre, cl.whatsapp, cl.telefono
        FROM contratos co
        JOIN planes  pl ON pl.id = co.plan_id
        JOIN clientes cl ON cl.id = co.cliente_id
        WHERE co.id = $1
      `, [contratoId]);

      if (contrato && ['suspendido_mora', 'prorroga'].includes(contrato.estado)) {
        // Encolar reactivación con alta prioridad
        await this.enqueueCobranza(JOBS.REACTIVAR_CONTRATO, {
          contratoId,
          empresaId,
          clienteId:   job.data.facturaId,   // placeholder
          routerId:    contrato.router_id,
          ipAsignada:  contrato.ip_asignada,
          planNombre:  contrato.plan_nombre,
          notificar:   true,
        } as PayloadReactivarContrato, { priority: 1 });

        this.logger.log(
          `[PAGO] 💰 Deuda saldada → reactivación encolada para contrato ${contratoId}`,
        );
      }
    }

    await job.progress(100);

    this.logger.log(
      `[PAGO] ✅ Pago ${pagoId} procesado | ` +
      `nueva deuda: S/ ${nuevaDeuda} | ${nuevosMeses} facturas pendientes`,
    );

    return { pagoId, contratoId, nuevaDeuda, reactivar: nuevaDeuda <= 0 };
  }

  // ── Notificaciones preventivas ────────────────────────────
  @Process({ name: JOBS.NOTIF_COBRO_PREVIO, concurrency: 20 })
  async processNotifCobro(job: Job): Promise<any> {
    const { telefono, nombre, montoDeuda, diasAntes } = job.data;

    if (!telefono || !montoDeuda) return { omitido: true };

    await this.whatsappSvc.notificarPagoRecibido({
      telefono,
      clienteNombre:  nombre,
      montoPago:      0,
      metodoPago:     'pendiente',
      saldoPendiente: montoDeuda,
    }).catch((err) => this.logger.warn(`WhatsApp previo: ${err.message}`));

    return { enviado: true };
  }

  // ────────────────────────────────────────────────────────────
  // HANDLERS DE COLA
  // ────────────────────────────────────────────────────────────

  @OnQueueFailed()
  onFailed(job: Job, error: Error) {
    this.logger.error(
      `[COBRANZA] ❌ Job ${job.name} #${job.id} falló ` +
      `(intento ${job.attemptsMade}/${job.opts.attempts}): ${error.message}`,
      error.stack,
    );
  }

  @OnQueueCompleted()
  onCompleted(job: Job, result: any) {
    if (result?.errores?.length) {
      this.logger.warn(
        `[COBRANZA] ⚠️ Job ${job.name} #${job.id} completado con errores: ` +
        result.errores.join(', '),
      );
    }
  }

  @OnQueueStalled()
  onStalled(job: Job) {
    this.logger.warn(
      `[COBRANZA] ⏸ Job ${job.name} #${job.id} estancado — reencolando`,
    );
  }

  // ── Helpers ───────────────────────────────────────────────
  private buildCreds(routerId: string, router: any) {
    let password = '';
    try { password = decrypt(router.password_cifrado); }
    catch { password = router.password_cifrado; }

    return {
      id:              routerId,
      ip:              router.ip_gestion,
      port:            router.usar_ssl ? router.puerto_api_ssl : router.puerto_api,
      user:            router.usuario,
      passwordCifrado: router.password_cifrado,
      useSsl:          router.usar_ssl || false,
      timeoutSec:      router.timeout_conexion || 10,
      version:         (router.version_ros === 'v7' ? 'v7' : 'v6') as 'v6' | 'v7',
    };
  }

  private async enqueueCobranza(
    jobName: string,
    payload: any,
    opts: any = JOB_OPTIONS.CRITICO,
  ): Promise<void> {
    const queue = this['queue'] as Queue;
    if (queue) await queue.add(jobName, payload, opts);
  }
}
