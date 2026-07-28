import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  ResultadoOperacion,
  clasificarError,
  esExito,
} from '../../common/domain/resultado-operacion';
import { InjectDataSource }  from '@nestjs/typeorm';
import { DataSource }        from 'typeorm';
import { Cron }              from '@nestjs/schedule';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';

import { FirewallService }   from '../mikrotik/services/firewall.service';
import { PppoeService }      from '../mikrotik/services/pppoe.service';
import { QueueService }      from '../mikrotik/services/queue.service';
import { ProvisionFtthService } from '../olt-nativo/services/provision-ftth.service';
import { decrypt }           from '../../common/utils/encryption.util';
import { EventosSistemaService } from '../sistema/eventos-sistema.service';
import {
  NOTIFICATION_EVENTS,
  EventOutboxRedAgotado,
  EventNotificacionServicioSuspendido,
  EventNotificacionServicioReactivado,
} from '../notificaciones/events/notification.events';

export type AccionRed =
  | 'SUSPENDER' | 'REACTIVAR' | 'DESPROVISIONAR' | 'PROVISIONAR'
  | 'APLICAR_PRORROGA' | 'REVOCAR_PRORROGA'
  // Ciclo de vida ONU (FTTH) — comandos independientes del corte MikroTik,
  // cada uno con su propio reintento resiliente.
  | 'SUSPENDER_ONU' | 'REACTIVAR_ONU' | 'DESAPROVISIONAR_ONU' | 'ACTUALIZAR_WAN_ONU'
  | 'REAPROVISIONAR_ONU' | 'ACTIVAR_CARRIL_TR069';

/**
 * Acciones que se resuelven por CONTRATO contra la OLT (no usan router MikroTik).
 * Fuente única: agregar una acción ONU aquí es lo que la enruta correctamente. El
 * tipo `AccionOnu` se deriva de esta lista, así que el compilador obliga a mantener
 * ambas cosas en sintonía.
 */
export const ACCIONES_ONU = [
  'SUSPENDER_ONU',
  'REACTIVAR_ONU',
  'DESAPROVISIONAR_ONU',
  'ACTUALIZAR_WAN_ONU',
  'REAPROVISIONAR_ONU',
  'ACTIVAR_CARRIL_TR069',
] as const satisfies readonly AccionRed[];

export type AccionOnu = (typeof ACCIONES_ONU)[number];

export interface PayloadSuspenderRed {
  ipAsignada:  string;
  usuarioPppoe?: string;
  clienteId:   string;
  deudaTotal?: number;
}

export interface PayloadReactivarRed {
  ipAsignada:  string;
  usuarioPppoe?: string;
}

export interface PayloadDesprovisionarRed {
  contratoId:   string;
  motivo:       string;
}

export interface PayloadProvisionarRed {
  contratoId:    string;
  clienteId:     string;
  usuarioPppoe:  string;
  passwordPppoe: string;
  ipAsignada:    string;
  perfilPppoe:   string;
  downloadMbps:  number;
  uploadMbps:    number;
  tipoQueue:     string;
}

export interface PayloadAplicarProrroga {
  promesaId:         string;
  ipAsignada:        string;
  usuarioPppoe?:     string;
  contratoEstadoPrevio: string; // para saber si re-habilitar PPPoE
  nombreCliente?:    string;
}

export interface PayloadRevocarProrroga {
  promesaId:     string;
  ipAsignada:    string;
  usuarioPppoe?: string;
}

// ─────────────────────────────────────────────────────────────
// OutboxRedService — Reintentos automáticos de comandos MikroTik
// cuando el router estaba inalcanzable en el momento del evento.
// Cron cada 5 minutos, hasta 12 intentos (~1 hora).
// ─────────────────────────────────────────────────────────────
@Injectable()
export class OutboxRedService {
  private readonly logger = new Logger(OutboxRedService.name);

  constructor(
    @InjectDataSource()    private readonly ds:          DataSource,
    private readonly firewallSvc: FirewallService,
    private readonly pppoeSvc:    PppoeService,
    private readonly queueSvc:    QueueService,
    private readonly ftthSvc:     ProvisionFtthService,
    private readonly events:      EventEmitter2,
    @Optional() private readonly eventos?: EventosSistemaService,
  ) {}

  /**
   * Guarda un comando de red en la cola de reintentos.
   * Idempotente: si ya existe PENDIENTE para (contratoId, accion), no duplica.
   */
  async encolar(
    accion:     AccionRed,
    contratoId: string,
    routerId:   string,
    payload:    PayloadSuspenderRed | PayloadReactivarRed | PayloadDesprovisionarRed | PayloadProvisionarRed,
  ): Promise<void> {
    // 'none' = sentinela de acciones ONU (la OLT se resuelve en ejecución desde el
    // registro, no hay router MikroTik). router_id es uuid → se persiste NULL.
    const routerIdVal = routerId && routerId !== 'none' ? routerId : null;
    await this.ds.query(`
      INSERT INTO comandos_red_pendientes (contrato_id, router_id, accion, payload)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (contrato_id, accion) WHERE estado IN ('PENDIENTE', 'EN_PROCESO') DO NOTHING
    `, [contratoId, routerIdVal, accion, JSON.stringify(payload)]);

    this.logger.warn(
      `[OutboxRed] ${accion} encolado → contrato=${contratoId} router=${routerId}`,
    );
  }

  /**
   * Encola desprovisión cuando la baja definitiva falla en hardware.
   * Usa router_id = 'none' porque se re-consulta en ejecución.
   */
  async encolarDesprovisionar(contratoId: string, motivo: string): Promise<void> {
    await this.encolar('DESPROVISIONAR', contratoId, 'none', { contratoId, motivo });
  }

  async encolarProvisionar(
    contratoId: string,
    routerId:   string,
    payload:    PayloadProvisionarRed,
  ): Promise<void> {
    await this.encolar('PROVISIONAR', contratoId, routerId, payload);
  }

  async encolarAplicarProrroga(
    contratoId: string,
    routerId:   string,
    payload:    PayloadAplicarProrroga,
  ): Promise<void> {
    await this.encolar('APLICAR_PRORROGA', contratoId, routerId, payload);
  }

  async encolarRevocarProrroga(
    contratoId: string,
    routerId:   string,
    payload:    PayloadRevocarProrroga,
  ): Promise<void> {
    await this.encolar('REVOCAR_PRORROGA', contratoId, routerId, payload);
  }

  // ── Ciclo de vida ONU (FTTH) ──────────────────────────────────
  // Encola una acción sobre la ONU SOLO si el contrato tiene registro FTTH.
  // router_id = 'none' (la OLT se resuelve en ejecución desde el registro).
  // Público: además del listener de eventos, lo usa la re-sincronización de
  // estado del tab Drift (ONU suspendida con contrato con servicio o viceversa).
  async encolarOnu(
    accion:     AccionOnu,
    contratoId: string,
    empresaId:  string,
  ): Promise<void> {
    const [existe] = await this.ds.query(
      `SELECT 1 FROM ftth_onu_registro WHERE contrato_id = $1 AND empresa_id = $2 LIMIT 1`,
      [contratoId, empresaId],
    ).catch(() => [null]);
    if (!existe) return; // Contrato WISP o sin ONU — nada que hacer en la OLT.

    await this.encolar(accion, contratoId, 'none', { empresaId } as any);
    this.logger.warn(`[OutboxRed] ${accion} encolado → contrato=${contratoId}`);
  }

  // Escucha las transiciones de servicio que ya emiten cobranza y contratos,
  // y encola el comando ONU independiente (reintento resiliente propio).
  @OnEvent(NOTIFICATION_EVENTS.SERVICIO_SUSPENDIDO, { async: true })
  async onServicioSuspendido(ev: EventNotificacionServicioSuspendido): Promise<void> {
    if (ev.contratoId && ev.empresaId) {
      await this.encolarOnu('SUSPENDER_ONU', ev.contratoId, ev.empresaId);
    }
  }

  @OnEvent(NOTIFICATION_EVENTS.SERVICIO_REACTIVADO, { async: true })
  async onServicioReactivado(ev: EventNotificacionServicioReactivado): Promise<void> {
    if (ev.contratoId && ev.empresaId) {
      await this.encolarOnu('REACTIVAR_ONU', ev.contratoId, ev.empresaId);
    }
  }

  // Baja definitiva: se invoca desde contratos.service (no hay evento de baja).
  async encolarDesaprovisionarOnu(contratoId: string, empresaId: string): Promise<void> {
    await this.encolarOnu('DESAPROVISIONAR_ONU', contratoId, empresaId);
  }

  // Cambio de credenciales PPPoE del contrato → re-inyectar la WAN en la ONU (routing).
  // Se invoca desde contratos.service.update. Resiliente: reintenta hasta que la OLT
  // esté disponible; omite si el contrato no tiene ONU FTTH o está en modo bridge.
  async encolarReaprovisionarOnu(contratoId: string, empresaId: string): Promise<void> {
    await this.encolarOnu('REAPROVISIONAR_ONU', contratoId, empresaId);
  }

  // Carril TR-069 (T3). Antes era un `void bootstrapTr069(...)` fire-and-forget dentro
  // del servicio FTTH: la única operación de hardware del ciclo de servicio fuera del
  // outbox, sin reintento ni auditoría, y capaz de sobrevivir al wizard que la creó
  // (incidente 2026-07-21). Desacoplado por evento porque OutboxRedModule ya importa
  // OltNativoModule — inyectar el outbox allá sería una dependencia circular.
  @OnEvent('ftth.carril.activar', { async: true })
  async onCarrilActivar(ev: { contratoId: string; empresaId: string }): Promise<void> {
    if (ev?.contratoId && ev?.empresaId) {
      await this.encolarOnu('ACTIVAR_CARRIL_TR069', ev.contratoId, ev.empresaId);
    }
  }

  // Solicitud desde el panel de drift (olt-nativo) — desacoplado por evento para
  // no crear dependencia de módulo circular (OutboxRedModule ya importa OltNativoModule).
  @OnEvent('ftth.drift.reaplicar', { async: true })
  async onDriftReaplicar(ev: { contratoId: string; empresaId: string }): Promise<void> {
    if (ev?.contratoId && ev?.empresaId) {
      await this.encolarReaprovisionarOnu(ev.contratoId, ev.empresaId);
    }
  }

  // Re-sincronización de estado desde el tab Drift: la ONU debe seguir al
  // contrato (suspendido/activo cruzados → re-encolar el comando correcto).
  @OnEvent('ftth.drift.resincronizar-estado', { async: true })
  async onDriftResincronizarEstado(
    ev: { contratoId: string; empresaId: string; accion: 'SUSPENDER_ONU' | 'REACTIVAR_ONU' },
  ): Promise<void> {
    if (ev?.contratoId && ev?.empresaId && (ev.accion === 'SUSPENDER_ONU' || ev.accion === 'REACTIVAR_ONU')) {
      await this.encolarOnu(ev.accion, ev.contratoId, ev.empresaId);
    }
  }

  async encolarActualizarWanOnu(contratoId: string, empresaId: string): Promise<void> {
    await this.encolarOnu('ACTUALIZAR_WAN_ONU', contratoId, empresaId);
  }

  async getStatus(): Promise<{
    pendientes: number;
    enProceso: number;
    agotados: number;
    ejecutadosUltima1h: number;
    ultimoEjecutadoEn: string | null;
  }> {
    const [row] = await this.ds.query<any[]>(`
      SELECT
        -- 'EN_PROCESO' cuenta como pendiente hacia afuera: es trabajo sin aplicar.
        -- Excluirlo haría desaparecer de la vista del operador justo los comandos que
        -- están tocando el hardware ahora mismo.
        COUNT(*) FILTER (WHERE estado IN ('PENDIENTE', 'EN_PROCESO'))               AS pendientes,
        COUNT(*) FILTER (WHERE estado = 'EN_PROCESO')                               AS en_proceso,
        COUNT(*) FILTER (WHERE estado = 'AGOTADO')                                 AS agotados,
        COUNT(*) FILTER (WHERE estado = 'EJECUTADO' AND ejecutado_en > NOW() - INTERVAL '1 hour') AS ejecutados_ultima_1h,
        MAX(ejecutado_en)                                                           AS ultimo_ejecutado_en
      FROM comandos_red_pendientes
    `);
    return {
      pendientes:          Number(row.pendientes),
      enProceso:           Number(row.en_proceso),
      agotados:            Number(row.agotados),
      ejecutadosUltima1h:  Number(row.ejecutados_ultima_1h),
      ultimoEjecutadoEn:   row.ultimo_ejecutado_en ?? null,
    };
  }

  // Guard anti-solapamiento: coalesce cron + eventos de reconexión concurrentes.
  private _procesando = false;

  // Identidad del proceso que reclama. Sirve para diagnosticar qué instancia PM2 tomó
  // cada comando cuando algo queda a medias.
  private readonly _dueño = `${process.env.PM2_INSTANCE_ID ?? process.env.NODE_APP_INSTANCE ?? 'solo'}:${process.pid}`;

  // TTL del reclamo. Techo generoso: el rollback GPON del MA5800 tarda ~60s y el
  // cliente HTTP del microservicio admite hasta 150s. Un comando reclamado por más
  // tiempo que esto es un proceso muerto, no una OLT lenta.
  private static readonly CLAIM_TTL_SEGUNDOS = 600;

  /**
   * Normaliza el retorno de un `UPDATE ... RETURNING` de TypeORM/Postgres.
   *
   * El driver devuelve `[filas, rowCount]` para UPDATE y DELETE, pero `filas` a secas
   * para SELECT. Confundirlos no lanza ningún error: se itera sobre dos elementos
   * basura y el trabajo real nunca se ejecuta. Pasó en producción el 2026-07-28 —
   * el outbox dejó de drenar durante ~20 min sin una sola línea de error.
   */
  private _filasDe(resultado: any): any[] {
    if (!Array.isArray(resultado)) return [];
    // Forma [filas, rowCount] del driver para sentencias mutantes.
    if (resultado.length === 2 && Array.isArray(resultado[0]) && typeof resultado[1] === 'number') {
      return resultado[0];
    }
    return resultado;
  }

  // ────────────────────────────────────────────────────────────
  // CRON — cada 5 minutos: red de seguridad que barre la cola.
  // Guard RUN_CRONS como HIGIENE, no como fix: evita que api-core y el worker hagan
  // el mismo barrido: la exclusión real la da el reclamo atómico. El trigger por
  // evento (onRouterReconectado) sigue activo en todos los procesos a propósito —
  // el router reconecta contra api-core y la latencia de segundos es el objetivo.
  // ────────────────────────────────────────────────────────────
  @Cron('0 */5 * * * *')
  async barridoProgramado(): Promise<void> {
    if (process.env.RUN_CRONS !== 'true') return;
    await this.procesarPendientes();
  }

  async procesarPendientes(): Promise<void> {
    if (this._procesando) return;
    this._procesando = true;
    try {
      // RECLAMO ATÓMICO. El esquema anterior (SELECT ... FOR UPDATE SKIP LOCKED dentro
      // de una transacción, y ejecución FUERA de ella) no daba la exclusión que su
      // comentario prometía: la transacción se cerraba al devolver el lote, el lock de
      // fila se soltaba y la otra instancia PM2 tomaba el mismo comando. Verificado en
      // producción el 2026-07-28 — api-core y worker procesaron el id=26 en el mismo
      // tick. El reclamo debe ser un HECHO PERSISTIDO (estado + dueño + TTL), no una
      // propiedad efímera de una transacción que ya terminó.
      let lote: any[];
      do {
        // OJO con la forma del resultado: el driver Postgres de TypeORM devuelve
        // `[filas, rowCount]` para UPDATE/DELETE, no las filas directamente (sí lo hace
        // para SELECT). Tratar el retorno como un array de filas hace que el bucle itere
        // sobre [arrayDeFilas, número] y procese basura en silencio — el outbox deja de
        // drenar sin un solo error en el log. Ver `_filasDe`.
        lote = this._filasDe(await this.ds.query(`
          UPDATE comandos_red_pendientes
          SET    estado          = 'EN_PROCESO',
                 reclamado_por   = $1,
                 reclamado_en    = NOW(),
                 claim_expira_en = NOW() + ($2 || ' seconds')::interval
          WHERE  id IN (
                   SELECT id
                   FROM   comandos_red_pendientes
                   WHERE  estado = 'PENDIENTE'
                   ORDER  BY creado_en
                   LIMIT  10
                   FOR UPDATE SKIP LOCKED
                 )
          RETURNING id, contrato_id, router_id, accion, payload, intentos, max_intentos
        `, [this._dueño, String(OutboxRedService.CLAIM_TTL_SEGUNDOS)]));

        if (lote.length > 0) {
          this.logger.log(`[OutboxRed] Procesando ${lote.length} comando(s) reclamado(s)`);
          for (const cmd of lote) {
            // Cada comando libera su propio reclamo al terminar (EJECUTADO / AGOTADO /
            // vuelta a PENDIENTE). Si el proceso muere aquí, lo recupera barrerClaimsExpirados.
            await this.ejecutarComando(cmd);
          }
        }
      } while (lote.length === 10);
    } finally {
      this._procesando = false;
    }
  }

  // ────────────────────────────────────────────────────────────
  // CRON — recupera comandos cuyo reclamo expiró: el proceso que los tomó murió
  // (deploy, OOM, kill) sin dejarlos en un estado terminal. Sin esto, un comando
  // reclamado se queda EN_PROCESO para siempre y nadie vuelve a mirarlo — el
  // mismo trabajo abandonado que el reclamo vino a evitar.
  //
  // Volver a PENDIENTE es correcto porque los comandos son idempotentes por
  // contrato. Pero se AUDITA: un reclamo expirado es indeterminado — la operación
  // pudo haberse aplicado en el hardware antes de morir el proceso.
  // ────────────────────────────────────────────────────────────
  @Cron('30 */5 * * * *')
  async barrerClaimsExpirados(): Promise<void> {
    if (process.env.RUN_CRONS !== 'true') return;
    const huerfanos = this._filasDe(await this.ds.query(`
      UPDATE comandos_red_pendientes
      SET    estado          = 'PENDIENTE',
             reclamado_por   = NULL,
             reclamado_en    = NULL,
             claim_expira_en = NULL,
             ultimo_error    = COALESCE(ultimo_error, '') ||
                               ' | reclamo expirado (dueño=' || COALESCE(reclamado_por, '?') ||
                               '): estado indeterminado, reencolado'
      WHERE  estado = 'EN_PROCESO' AND claim_expira_en < NOW()
      RETURNING id, accion, contrato_id, reclamado_por
    `).catch((e) => {
      this.logger.warn(`[OutboxRed] barrerClaimsExpirados falló: ${e?.message}`);
      return [] as any[];
    }));

    for (const h of huerfanos) {
      this.logger.error(
        `[OutboxRed] Reclamo expirado → comando=${h.id} ${h.accion} contrato=${h.contrato_id} ` +
        `dueño=${h.reclamado_por} — reencolado (pudo haberse aplicado en hardware)`,
      );
      void this.eventos?.registrar({
        nivel:    'warn',
        origen:   'mikrotik',
        codigo:   'OUTBOX_CLAIM_EXPIRADO',
        mensaje:  `Comando ${h.accion} quedó reclamado sin terminar (contrato ${h.contrato_id}, dueño ${h.reclamado_por}) — reencolado. Estado en hardware indeterminado.`,
        contexto: { comandoId: h.id, accion: h.accion, contratoId: h.contrato_id, dueño: h.reclamado_por },
      });
    }
  }

  // ────────────────────────────────────────────────────────────
  // Trigger por evento — cuando un router recupera conectividad,
  // aplica de inmediato sus comandos pendientes (latencia de segundos
  // en vez de esperar al próximo cron). Cualquier router sirve de disparo:
  // los comandos son idempotentes y cada uno re-consulta su propio router;
  // los de routers aún caídos simplemente vuelven a quedar PENDIENTE.
  // ────────────────────────────────────────────────────────────
  @OnEvent(NOTIFICATION_EVENTS.ROUTER_CONECTADO, { async: true })
  async onRouterReconectado(): Promise<void> {
    await this.procesarPendientes();
  }

  // ────────────────────────────────────────────────────────────
  // Ejecución individual
  // ────────────────────────────────────────────────────────────
  private async ejecutarComando(cmd: any): Promise<void> {
    // Ciclo de vida ONU (FTTH): no usa router MikroTik, se resuelve por contrato.
    // La pertenencia se declara UNA vez (ACCIONES_ONU): repetir la lista en cada `if`
    // es cómo una acción nueva termina cayendo por error en la rama MikroTik y
    // muriendo con "Router eliminado de BD".
    if (ACCIONES_ONU.includes(cmd.accion)) {
      await this.ejecutarComandoOnu(cmd);
      return;
    }

    const [router] = await this.ds.query<any[]>(
      `SELECT ip_gestion, vpn_ip, usuario, password_cifrado,
              usar_ssl, puerto_api, puerto_api_ssl, version_ros, timeout_conexion
       FROM   routers WHERE id = $1`,
      [cmd.router_id],
    ).catch(() => [null]);

    if (!router) {
      await this.ds.query(`
        UPDATE comandos_red_pendientes
        SET    estado = 'AGOTADO', ultimo_error = 'Router eliminado de BD'
        WHERE  id = $1
      `, [cmd.id]);
      this.logger.error(`[OutboxRed] Router ${cmd.router_id} no existe — comando ${cmd.id} descartado`);
      return;
    }

    const creds = this.buildCreds(cmd.router_id, router);
    const payload = cmd.payload as any;

    try {
      if (cmd.accion === 'SUSPENDER') {
        await this.firewallSvc.suspenderCliente(
          creds,
          payload.ipAsignada,
          payload.clienteId,
          `Mora reintento outbox — intento ${cmd.intentos + 1}`,
        );
        if (payload.usuarioPppoe) {
          await this.pppoeSvc.desconectarSesion(creds, payload.usuarioPppoe);
          await this.pppoeSvc.setEstado(creds, payload.usuarioPppoe, true);
        }
      } else if (cmd.accion === 'REACTIVAR') {
        await this.firewallSvc.reactivarCliente(creds, payload.ipAsignada);
        if (payload.usuarioPppoe) {
          await this.pppoeSvc.setEstado(creds, payload.usuarioPppoe, false);
        }
      } else if (cmd.accion === 'DESPROVISIONAR') {
        // Para DESPROVISIONAR: eliminar PPPoE secret o regla ARP del router
        const [contratoRow] = await this.ds.query<any[]>(`
          SELECT co.usuario_pppoe AS "usuarioPppoe",
                 co.ip_asignada   AS "ipAsignada",
                 co.mac_address   AS "macAddress",
                 co.tipo_auth     AS "tipoAuth",
                 ro.tipo_control  AS "tipoControl"
          FROM contratos co
          LEFT JOIN routers ro ON ro.id = co.router_id
          WHERE co.id = $1
        `, [cmd.contrato_id]).catch(() => [null]);

        if (contratoRow) {
          // Limpiar address-lists morosos/prorroga (evita IPs huérfanas en el router)
          if (contratoRow.ipAsignada) {
            try {
              await this.firewallSvc.reactivarCliente(creds, contratoRow.ipAsignada);
            } catch (e: any) {
              this.logger.warn(`[OutboxRed] DESPROVISIONAR address-list error: ${e?.message}`);
            }
          }

          const rawTipo = contratoRow.tipoAuth ?? contratoRow.tipoControl ?? 'ninguna';
          const tipo    = rawTipo === 'pppoe_addresslist' ? 'pppoe' : rawTipo;
          if (tipo === 'pppoe' && contratoRow.usuarioPppoe) {
            await this.pppoeSvc.eliminar(creds, contratoRow.usuarioPppoe);
          }
        }
      } else if (cmd.accion === 'APLICAR_PRORROGA') {
        const p = payload as PayloadAplicarProrroga;
        await this.firewallSvc.aplicarProrroga(
          creds,
          p.ipAsignada,
          `Promesa: ${p.nombreCliente ?? p.promesaId} | ${new Date().toLocaleDateString('es-PE')}`,
        );
        // Si el contrato estaba cortado, re-habilitar el secret PPPoE
        if (p.usuarioPppoe && p.contratoEstadoPrevio === 'cortado') {
          await this.pppoeSvc.setEstado(creds, p.usuarioPppoe, false);
        }
        // Marcar mikrotik_aplicado en la promesa
        await this.ds.query(
          `UPDATE promesas_pago SET mikrotik_aplicado = TRUE, mikrotik_aplicado_en = NOW()
           WHERE id = $1`,
          [p.promesaId],
        ).catch(() => {});

      } else if (cmd.accion === 'REVOCAR_PRORROGA') {
        const p = payload as PayloadRevocarProrroga;
        await this.firewallSvc.suspenderCliente(
          creds,
          p.ipAsignada,
          cmd.contrato_id,
          `Prorroga vencida — promesa:${p.promesaId}`,
        );
        if (p.usuarioPppoe) {
          await this.pppoeSvc.desconectarSesion(creds, p.usuarioPppoe);
          await this.pppoeSvc.setEstado(creds, p.usuarioPppoe, true);
        }
        // Marcar promesa como VENCIDA y contrato como CORTADO
        await this.ds.query(
          `UPDATE promesas_pago SET estado = 'vencida', mikrotik_aplicado = TRUE, mikrotik_aplicado_en = NOW()
           WHERE id = $1`,
          [p.promesaId],
        ).catch(() => {});
        await this.ds.query(
          `UPDATE contratos SET estado = 'cortado', en_prorroga = FALSE, prorroga_hasta = NULL, fecha_estado = NOW()
           WHERE id = $1`,
          [cmd.contrato_id],
        ).catch(() => {});

      } else if (cmd.accion === 'PROVISIONAR') {
        const p = payload as PayloadProvisionarRed;

        // Paso A: PPPoE (upsert — idempotente si ya existía de un intento previo)
        await this.pppoeSvc.crear(creds, {
          name:          p.usuarioPppoe,
          password:      p.passwordPppoe,
          profile:       p.perfilPppoe || 'default',
          service:       'pppoe',
          remoteAddress: p.ipAsignada,
          comment:       `DATAFAST:ClienteID:${p.clienteId}`,
          disabled:      false,
        });

        // Paso B: Simple Queue (upsert — idempotente)
        if (!p.tipoQueue || p.tipoQueue === 'simple_queue') {
          await this.queueSvc.crearSimpleQueue(creds, {
            name:         p.usuarioPppoe,
            target:       `${p.ipAsignada}/32`,
            maxLimitDown: p.downloadMbps,
            maxLimitUp:   p.uploadMbps,
            comment:      `DATAFAST:ClienteID:${p.clienteId}`,
          });
        }
      }

      await this.ds.query(`
        UPDATE comandos_red_pendientes
        SET    estado = 'EJECUTADO', ejecutado_en = NOW()
        WHERE  id = $1
      `, [cmd.id]);

      this.logger.log(
        `[OutboxRed] ✅ ${cmd.accion} ejecutado → contrato=${cmd.contrato_id} intento=${cmd.intentos + 1}`,
      );
    } catch (err: any) {
      // Nunca se descarta: el comando queda PENDIENTE y se reintenta (cron cada 5 min
      // + trigger inmediato al reconectar el router) hasta que se aplique en hardware.
      // Un corte/reactivación es una obligación, no un "mejor esfuerzo": aunque el túnel
      // VPN esté caído días, al volver el router los cambios se aplican automáticamente.
      const nuevosIntentos = (cmd.intentos as number) + 1;

      // Vuelve a PENDIENTE: libera el reclamo para que el próximo ciclo lo reintente.
      // Omitirlo dejaría el comando EN_PROCESO hasta que expire el TTL — 10 min de
      // latencia extra en cada fallo transitorio.
      await this.ds.query(`
        UPDATE comandos_red_pendientes
        SET    estado = 'PENDIENTE', intentos = $2, ultimo_error = $3,
               reclamado_por = NULL, reclamado_en = NULL, claim_expira_en = NULL
        WHERE  id = $1
      `, [cmd.id, nuevosIntentos, err.message?.slice(0, 500)]);

      // Notificación de visibilidad tras muchos reintentos (sigue reintentando).
      if (nuevosIntentos === cmd.max_intentos) {
        this.logger.error(
          `[OutboxRed] ⚠️ ${cmd.accion} sin aplicar tras ${nuevosIntentos} intentos → ` +
          `contrato=${cmd.contrato_id} router=${cmd.router_id} (sigue reintentando) | ${err.message}`,
        );
        const [row] = await this.ds.query<any[]>(
          `SELECT empresa_id FROM contratos WHERE id = $1 LIMIT 1`,
          [cmd.contrato_id],
        ).catch(() => [null]);

        this.events.emit(NOTIFICATION_EVENTS.OUTBOX_RED_AGOTADO, {
          contratoId:  cmd.contrato_id,
          routerId:    cmd.router_id,
          accion:      cmd.accion,
          ultimoError: (err.message ?? 'Error desconocido').slice(0, 200),
          empresaId:   row?.empresa_id ?? undefined,
        } satisfies EventOutboxRedAgotado);

        void this.eventos?.registrar({
          origen:   'mikrotik',
          codigo:   'OUTBOX_RED_AGOTADO',
          mensaje:  `Comando ${cmd.accion} sin aplicar tras ${nuevosIntentos} intentos (contrato ${cmd.contrato_id}, router ${cmd.router_id}): ${err.message}`,
          contexto: { contratoId: cmd.contrato_id, routerId: cmd.router_id, accion: cmd.accion, intentos: nuevosIntentos },
        });
      } else {
        this.logger.warn(
          `[OutboxRed] Reintento ${nuevosIntentos} → contrato=${cmd.contrato_id}: ${err.message}`,
        );
      }
    }
  }

  // ── Ejecución de comandos de ciclo de vida ONU (FTTH) ─────────
  // Mismo modelo de resiliencia que el resto del outbox: nunca se descarta;
  // si la OLT está caída, queda PENDIENTE y reintenta (cron + trigger reconexión)
  // hasta aplicarse. Si el contrato no tiene ONU, el wrapper omite → EJECUTADO.
  private async ejecutarComandoOnu(cmd: any): Promise<void> {
    const empresaId = (cmd.payload as any)?.empresaId as string;

    // El resultado llega ya clasificado por el DOMINIO. El outbox no vuelve a inferir
    // reintentabilidad de un status code: esa inferencia fue la causa raíz de los dos
    // incidentes del 24 y el 28/07 (un no-op leído como fallo → 1788 reintentos; un 409
    // de lock leído como veredicto → trabajo descartado).
    let res: ResultadoOperacion;
    try {
      if (cmd.accion === 'SUSPENDER_ONU') {
        res = await this.ftthSvc.suspenderPorContrato(cmd.contrato_id, empresaId);
      } else if (cmd.accion === 'REACTIVAR_ONU') {
        res = await this.ftthSvc.rehabilitarPorContrato(cmd.contrato_id, empresaId);
      } else if (cmd.accion === 'ACTUALIZAR_WAN_ONU') {
        const r = await this.ftthSvc.actualizarWan(cmd.contrato_id, empresaId);
        // 'skipped' (bridge / sin ONU): no hay nada que aplicar → éxito vacío.
        res = r.skipped      ? { clase: 'no_aplica',    mensaje: r.mensaje }
            : r.actualizado  ? { clase: 'aplicado',     mensaje: r.mensaje }
                             : { clase: 'reintentable', motivo:  r.error ?? r.mensaje };
      } else if (cmd.accion === 'ACTIVAR_CARRIL_TR069') {
        res = await this.ftthSvc.activarCarrilPorContrato(cmd.contrato_id, empresaId);
      } else if (cmd.accion === 'REAPROVISIONAR_ONU') {
        // Push ERP→OLT de drift: re-aplica la ONU con los datos guardados del registro.
        const r = await this.ftthSvc.reaplicar(cmd.contrato_id, empresaId);
        res = r.estado === 'activo'
          ? { clase: 'aplicado',     mensaje: r.mensaje ?? 'ONU reaplicada.' }
          : { clase: 'reintentable', motivo:  r.mensaje ?? `Estado: ${r.estado}` };
      } else {
        res = await this.ftthSvc.desaprovisionarPorContrato(cmd.contrato_id, empresaId);
      }
    } catch (err) {
      // Red de seguridad: cualquier método que todavía lance en vez de devolver.
      res = clasificarError(err);
    }

    const nuevosIntentos = (cmd.intentos as number) + 1;

    // ── Éxito: aplicado, ya_en_destino o no_aplica ──────────────────
    if (esExito(res)) {
      await this.ds.query(
        `UPDATE comandos_red_pendientes SET estado = 'EJECUTADO', ejecutado_en = NOW(), ultimo_error = NULL WHERE id = $1`,
        [cmd.id],
      );
      const detalle = res.clase === 'aplicado' ? '' : ` (${res.clase})`;
      this.logger.log(`[OutboxRed] ✅ ${cmd.accion} → contrato=${cmd.contrato_id}${detalle}`);
      return;
    }

    // ── Rechazo definitivo: reintentar produce el mismo veredicto ───
    if (res.clase === 'rechazado_definitivo') {
      await this.ds.query(
        `UPDATE comandos_red_pendientes
         SET estado = 'AGOTADO', intentos = $2, ultimo_error = $3
         WHERE id = $1`,
        [cmd.id, nuevosIntentos, res.motivo.slice(0, 500)],
      );
      this.logger.error(
        `[OutboxRed] ${cmd.accion} rechazado de forma permanente → contrato=${cmd.contrato_id}: ${res.motivo}`,
      );
      void this.eventos?.registrar({
        nivel:    'error',
        origen:   'olt',
        codigo:   'OUTBOX_ONU_RECHAZO_PERMANENTE',
        mensaje:  `Comando ONU ${cmd.accion} rechazado de forma permanente (contrato ${cmd.contrato_id}): ${res.motivo}`,
        contexto: { contratoId: cmd.contrato_id, accion: cmd.accion, intentos: nuevosIntentos },
      });
      return;
    }

    // ── Indeterminado: pudo haberse aplicado ────────────────────────
    // No se reintenta a ciegas. Reintentar un rollback que SÍ se ejecutó es
    // exactamente cómo se ensucia el plano físico. Se deja PENDIENTE —el trabajo no
    // se abandona— pero se AUDITA para que el operador verifique el estado real, y
    // el reintento queda a cargo del ciclo normal, no de un bucle inmediato.
    if (res.clase === 'indeterminado') {
      await this.ds.query(
        `UPDATE comandos_red_pendientes
         SET estado = 'PENDIENTE', intentos = $2, ultimo_error = $3,
             reclamado_por = NULL, reclamado_en = NULL, claim_expira_en = NULL
         WHERE id = $1`,
        [cmd.id, nuevosIntentos, `INDETERMINADO: ${res.motivo}`.slice(0, 500)],
      );
      this.logger.error(
        `[OutboxRed] ${cmd.accion} INDETERMINADO → contrato=${cmd.contrato_id}: ${res.motivo} ` +
        `— pudo haberse aplicado en el hardware; verificar estado real`,
      );
      void this.eventos?.registrar({
        nivel:    'error',
        origen:   'olt',
        codigo:   'OUTBOX_ONU_INDETERMINADO',
        mensaje:  `Comando ONU ${cmd.accion} con resultado indeterminado (contrato ${cmd.contrato_id}): ${res.motivo}. La operación PUDO aplicarse — verificar el estado real en la OLT antes de asumir que no pasó nada.`,
        contexto: { contratoId: cmd.contrato_id, accion: cmd.accion, intentos: nuevosIntentos },
      });
      return;
    }

    // ── Reintentable: obligación de volver a intentar ───────────────
    // Vuelve a PENDIENTE y libera el reclamo (ver rama MikroTik).
    await this.ds.query(
      `UPDATE comandos_red_pendientes
       SET estado = 'PENDIENTE', intentos = $2, ultimo_error = $3,
           reclamado_por = NULL, reclamado_en = NULL, claim_expira_en = NULL
       WHERE id = $1`,
      [cmd.id, nuevosIntentos, res.motivo.slice(0, 500)],
    );
    this.logger.warn(
      `[OutboxRed] Reintento ONU ${nuevosIntentos} → contrato=${cmd.contrato_id}: ${res.motivo}`,
    );
    if (nuevosIntentos === cmd.max_intentos) {
      void this.eventos?.registrar({
        origen:   'olt',
        codigo:   'OUTBOX_ONU_AGOTADO',
        mensaje:  `Comando ONU ${cmd.accion} sin aplicar tras ${nuevosIntentos} intentos (contrato ${cmd.contrato_id}): ${res.motivo}`,
        contexto: { contratoId: cmd.contrato_id, accion: cmd.accion, intentos: nuevosIntentos },
      });
    }
  }

  private buildCreds(routerId: string, router: any) {
    let password = '';
    try { password = decrypt(router.password_cifrado); }
    catch { password = router.password_cifrado ?? ''; }

    return {
      id:              routerId,
      ip:              router.vpn_ip || router.ip_gestion,
      port:            router.usar_ssl
                         ? (router.puerto_api_ssl ?? 8729)
                         : (router.puerto_api    ?? 8728),
      user:            router.usuario ?? 'admin',
      passwordCifrado: router.password_cifrado ?? '',
      useSsl:          router.usar_ssl ?? false,
      timeoutSec:      router.timeout_conexion ?? 10,
      version:         (router.version_ros === 'v7' ? 'v7' : 'v6') as 'v6' | 'v7',
    };
  }
}
