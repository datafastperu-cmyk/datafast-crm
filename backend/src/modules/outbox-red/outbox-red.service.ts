import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource }  from '@nestjs/typeorm';
import { DataSource }        from 'typeorm';
import { Cron }              from '@nestjs/schedule';

import { FirewallService }   from '../mikrotik/services/firewall.service';
import { PppoeService }      from '../mikrotik/services/pppoe.service';
import { decrypt }           from '../../common/utils/encryption.util';

export type AccionRed = 'SUSPENDER' | 'REACTIVAR';

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
  ) {}

  /**
   * Guarda un comando de red en la cola de reintentos.
   * Idempotente: si ya existe PENDIENTE para (contratoId, accion), no duplica.
   */
  async encolar(
    accion:     AccionRed,
    contratoId: string,
    routerId:   string,
    payload:    PayloadSuspenderRed | PayloadReactivarRed,
  ): Promise<void> {
    await this.ds.query(`
      INSERT INTO comandos_red_pendientes (contrato_id, router_id, accion, payload)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (contrato_id, accion) WHERE estado = 'PENDIENTE' DO NOTHING
    `, [contratoId, routerId, accion, JSON.stringify(payload)]);

    this.logger.warn(
      `[OutboxRed] ${accion} encolado → contrato=${contratoId} router=${routerId}`,
    );
  }

  // ────────────────────────────────────────────────────────────
  // CRON — cada 5 minutos procesa hasta 10 comandos pendientes
  // ────────────────────────────────────────────────────────────
  @Cron('0 */5 * * * *')
  async procesarPendientes(): Promise<void> {
    const pendientes = await this.ds.query<any[]>(`
      SELECT id, contrato_id, router_id, accion, payload, intentos, max_intentos
      FROM   comandos_red_pendientes
      WHERE  estado = 'PENDIENTE' AND intentos < max_intentos
      ORDER  BY creado_en
      LIMIT  10
    `);

    if (pendientes.length === 0) return;

    this.logger.log(`[OutboxRed] Procesando ${pendientes.length} comando(s) pendiente(s)`);

    for (const cmd of pendientes) {
      await this.ejecutarComando(cmd);
    }
  }

  // ────────────────────────────────────────────────────────────
  // Ejecución individual
  // ────────────────────────────────────────────────────────────
  private async ejecutarComando(cmd: any): Promise<void> {
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
      const nuevosIntentos = (cmd.intentos as number) + 1;
      const agotado        = nuevosIntentos >= cmd.max_intentos;

      await this.ds.query(`
        UPDATE comandos_red_pendientes
        SET    intentos = $2, ultimo_error = $3, estado = $4
        WHERE  id = $1
      `, [cmd.id, nuevosIntentos, err.message?.slice(0, 500), agotado ? 'AGOTADO' : 'PENDIENTE']);

      if (agotado) {
        this.logger.error(
          `[OutboxRed] ❌ AGOTADO → contrato=${cmd.contrato_id} accion=${cmd.accion} | ${err.message}`,
        );
      } else {
        this.logger.warn(
          `[OutboxRed] Reintento ${nuevosIntentos}/${cmd.max_intentos} → contrato=${cmd.contrato_id}: ${err.message}`,
        );
      }
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
