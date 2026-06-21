import { Injectable, Logger } from '@nestjs/common';
import { Cron }               from '@nestjs/schedule';
import { InjectDataSource }   from '@nestjs/typeorm';
import { DataSource }         from 'typeorm';

import { RouterConnectionPool, RouterCredentials } from './services/connection-pool.service';
import { PppoeService }       from './services/pppoe.service';
import { FirewallService }    from './services/firewall.service';
import { decrypt }            from '../../common/utils/encryption.util';

// Corre cada 30 minutos, solo en instancia PM2 #0.
// Detecta contratos PPPoE activos en BD cuyo secret no existe en el router
// y los encola en outbox para reprovisioning automático.
@Injectable()
export class ReconciliacionWorker {
  private readonly logger = new Logger(ReconciliacionWorker.name);
  private _running = false;

  constructor(
    @InjectDataSource() private readonly ds:          DataSource,
    private readonly pool:         RouterConnectionPool,
    private readonly pppoeSvc:    PppoeService,
    private readonly firewallSvc: FirewallService,
  ) {}

  @Cron('0 */30 * * * *', { timeZone: 'America/Lima' })
  async reconciliar(): Promise<void> {
    if (
      process.env.NODE_APP_INSTANCE !== undefined &&
      process.env.NODE_APP_INSTANCE !== '0'
    ) return;

    if (this._running) {
      this.logger.warn('[RECONCIL] Ciclo anterior aún en ejecución — saltando');
      return;
    }
    this._running = true;

    try {
      await this._run();
    } catch (err: any) {
      this.logger.error(`[RECONCIL] Error inesperado en ciclo: ${err.message}`);
    } finally {
      this._running = false;
    }
  }

  private async _run(): Promise<void> {
    const routers = await this.ds.query<any[]>(`
      SELECT DISTINCT
        ro.id,
        ro.nombre,
        ro.ip_gestion        AS "ipGestion",
        ro.vpn_ip            AS "vpnIp",
        ro.usuario,
        ro.password_cifrado  AS "passwordCifrado",
        ro.usar_ssl          AS "usarSsl",
        ro.puerto_api        AS "puertoApi",
        ro.puerto_api_ssl    AS "puertoApiSsl",
        ro.version_ros       AS "versionRos",
        ro.timeout_conexion  AS "timeoutConexion"
      FROM routers ro
      WHERE ro.estado      = 'online'
        AND ro.deleted_at  IS NULL
        AND ro.tipo_control = 'pppoe'
        AND EXISTS (
          SELECT 1 FROM contratos co
          WHERE  co.router_id    = ro.id
            AND  co.estado       IN ('activo', 'suspendido')
            AND  co.deleted_at   IS NULL
            AND  co.usuario_pppoe IS NOT NULL
        )
    `);

    if (!routers.length) {
      this.logger.debug('[RECONCIL] Sin routers PPPoE online con contratos activos');
      return;
    }

    this.logger.log(`[RECONCIL] Verificando ${routers.length} router(es)`);

    for (const router of routers) {
      await this._reconciliarRouter(router).catch((err: any) =>
        this.logger.warn(`[RECONCIL] Error en router ${router.nombre}: ${err.message}`),
      );
    }
  }

  private async _reconciliarRouter(router: any): Promise<void> {
    const creds: RouterCredentials = {
      id:              router.id,
      ip:              router.vpnIp || router.ipGestion,
      port:            router.usarSsl
                         ? (router.puertoApiSsl ?? 8729)
                         : (router.puertoApi    ?? 8728),
      user:            router.usuario ?? 'admin',
      passwordCifrado: router.passwordCifrado ?? '',
      useSsl:          router.usarSsl ?? false,
      timeoutSec:      Math.min(router.timeoutConexion ?? 10, 15),
      version:         router.versionRos === 'v7' ? 'v7' : 'v6',
    };

    // Leer todos los PPPoE secrets que existen actualmente en el router
    let secretsEnRouter: Set<string>;
    try {
      const secrets = await this.pppoeSvc.listarSecrets(creds);
      secretsEnRouter = new Set(secrets.map((s: any) => s.name));
    } catch (err: any) {
      // Si no podemos leer el router, no reportar drift falso
      this.logger.warn(
        `[RECONCIL] No se pudo leer PPPoE secrets de ${router.nombre} (${creds.ip}): ${err.message}`,
      );
      return;
    }

    // Obtener contratos PPPoE activos/suspendidos en BD para este router
    const contratos = await this.ds.query<any[]>(`
      SELECT
        co.id,
        co.usuario_pppoe   AS "usuarioPppoe",
        co.password_pppoe  AS "passwordPppoe",
        co.ip_asignada     AS "ipAsignada",
        co.empresa_id      AS "empresaId",
        co.cliente_id      AS "clienteId",
        pl.ppp_profile     AS "perfilPppoe",
        pl.velocidad_bajada AS "downloadMbps",
        pl.velocidad_subida AS "uploadMbps",
        pl.tipo_queue      AS "tipoQueue"
      FROM contratos co
      LEFT JOIN planes pl ON pl.id = co.plan_id
      WHERE co.router_id     = $1
        AND co.estado        IN ('activo', 'suspendido')
        AND co.deleted_at    IS NULL
        AND co.usuario_pppoe IS NOT NULL
    `, [router.id]);

    const faltantes = contratos.filter((c) => !secretsEnRouter.has(c.usuarioPppoe));

    if (!faltantes.length) {
      this.logger.debug(
        `[RECONCIL] ${router.nombre}: sin drift (${contratos.length} contratos verificados OK)`,
      );
      return;
    }

    this.logger.warn(
      `[RECONCIL] ${router.nombre}: ${faltantes.length} contrato(s) con PPPoE ausente en router — encolando`,
    );

    for (const co of faltantes) {
      // No encolar si ya existe un PROVISIONAR PENDIENTE para este contrato
      const [yaEncolado] = await this.ds.query<any[]>(`
        SELECT id FROM comandos_red_pendientes
        WHERE  contrato_id = $1
          AND  accion      = 'PROVISIONAR'
          AND  estado      = 'PENDIENTE'
        LIMIT 1
      `, [co.id]);

      if (yaEncolado) {
        this.logger.debug(
          `[RECONCIL] ${co.usuarioPppoe}: ya tiene PROVISIONAR pendiente — omitido`,
        );
        continue;
      }

      let password = '';
      try { password = decrypt(co.passwordPppoe ?? ''); } catch { /* sin password */ }

      // Insertar directamente en outbox para evitar dependencia circular
      // con OutboxRedModule (que ya importa MikrotikModule).
      const payload = JSON.stringify({
        contratoId:    co.id,
        clienteId:     co.clienteId,
        usuarioPppoe:  co.usuarioPppoe,
        passwordPppoe: password,
        ipAsignada:    co.ipAsignada    ?? '',
        perfilPppoe:   co.perfilPppoe   ?? 'default',
        downloadMbps:  Number(co.downloadMbps) || 10,
        uploadMbps:    Number(co.uploadMbps)   || 5,
        tipoQueue:     co.tipoQueue     ?? 'simple_queue',
      });

      await this.ds.query(`
        INSERT INTO comandos_red_pendientes (contrato_id, router_id, accion, payload)
        VALUES ($1, $2, 'PROVISIONAR', $3)
        ON CONFLICT (contrato_id, accion) WHERE estado = 'PENDIENTE' DO NOTHING
      `, [co.id, router.id, payload]);

      this.logger.warn(
        `[RECONCIL] ${router.nombre} → encolado PROVISIONAR para ${co.usuarioPppoe} (contrato ${co.id})`,
      );
    }

    // Segunda verificación: drift de address-list firewall
    await this._reconciliarFirewall(router, creds);
  }

  // Detecta clientes suspendidos en BD que no están en morosos_datafast del router.
  // Sucede cuando el router se reinicia y pierde sus address-lists.
  private async _reconciliarFirewall(router: any, creds: RouterCredentials): Promise<void> {
    let morososEnRouter: Set<string>;
    try {
      const entries = await this.firewallSvc.listarMorosos(creds);
      morososEnRouter = new Set(entries.map((e) => e.ip));
    } catch (err: any) {
      this.logger.warn(
        `[RECONCIL] No se pudo leer address-list de ${router.nombre}: ${err.message}`,
      );
      return;
    }

    // Contratos suspendidos con IP asignada en este router
    const suspendidos = await this.ds.query<any[]>(`
      SELECT id, ip_asignada AS "ipAsignada", usuario_pppoe AS "usuarioPppoe",
             cliente_id AS "clienteId"
      FROM contratos
      WHERE router_id   = $1
        AND estado      = 'suspendido'
        AND deleted_at  IS NULL
        AND ip_asignada IS NOT NULL
    `, [router.id]);

    const faltantesFirewall = suspendidos.filter((c) => !morososEnRouter.has(c.ipAsignada));

    if (!faltantesFirewall.length) {
      this.logger.debug(
        `[RECONCIL] ${router.nombre}: sin drift firewall (${suspendidos.length} suspendidos verificados OK)`,
      );
      return;
    }

    this.logger.warn(
      `[RECONCIL] ${router.nombre}: ${faltantesFirewall.length} cliente(s) suspendido(s) sin bloqueo en firewall — encolando SUSPENDER`,
    );

    for (const co of faltantesFirewall) {
      const [yaEncolado] = await this.ds.query<any[]>(`
        SELECT id FROM comandos_red_pendientes
        WHERE  contrato_id = $1
          AND  accion      = 'SUSPENDER'
          AND  estado      = 'PENDIENTE'
        LIMIT 1
      `, [co.id]);

      if (yaEncolado) {
        this.logger.debug(`[RECONCIL] ${co.ipAsignada}: ya tiene SUSPENDER pendiente — omitido`);
        continue;
      }

      const payload = JSON.stringify({
        ipAsignada:   co.ipAsignada,
        usuarioPppoe: co.usuarioPppoe ?? undefined,
        clienteId:    co.clienteId,
      });

      await this.ds.query(`
        INSERT INTO comandos_red_pendientes (contrato_id, router_id, accion, payload)
        VALUES ($1, $2, 'SUSPENDER', $3)
        ON CONFLICT (contrato_id, accion) WHERE estado = 'PENDIENTE' DO NOTHING
      `, [co.id, router.id, payload]);

      this.logger.warn(
        `[RECONCIL] ${router.nombre} → encolado SUSPENDER para IP ${co.ipAsignada} (contrato ${co.id})`,
      );
    }
  }
}
