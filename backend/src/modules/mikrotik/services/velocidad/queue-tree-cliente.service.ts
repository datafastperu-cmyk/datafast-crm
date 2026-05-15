import { Injectable, Logger } from '@nestjs/common';
import { RouterConnectionPool, RouterCredentials } from '../../services/connection-pool.service';
import { MangleService }                           from './mangle.service';
import { ConfigVelocidad }                         from './velocidad.service';

// ─── Nombres de queues para un cliente ───────────────────────
export interface NombresQueueTree {
  padre:    string;   // 'fn-qt-{shortId}'       — Queue padre del cliente
  download: string;   // 'fn-qt-{shortId}-down'  — Bajada
  upload:   string;   // 'fn-qt-{shortId}-up'    — Subida
}

@Injectable()
export class QueueTreeClienteService {
  private readonly logger = new Logger(QueueTreeClienteService.name);
  private readonly PREFIX = 'fn-qt';

  constructor(
    private readonly pool:       RouterConnectionPool,
    private readonly mangleSvc:  MangleService,
  ) {}

  // ────────────────────────────────────────────────────────────
  // CREAR QUEUE TREE INDIVIDUAL POR CLIENTE
  //
  // Estructura:
  //   global
  //   └── fn-global-down  (límite total bajada del router)
  //       └── fn-qt-{id}-down  (límite individual cliente)
  //   └── fn-global-up    (límite total subida)
  //       └── fn-qt-{id}-up   (límite individual cliente)
  //
  // El marcado de paquetes (Mangle) debe existir antes.
  // ────────────────────────────────────────────────────────────
  async crearQueueTreeCliente(
    creds:     RouterCredentials,
    clienteId: string,
    config:    ConfigVelocidad,
    wanIface?: string,
  ): Promise<{ nombres: NombresQueueTree; reglasCreadas: number }> {
    // Paso 1: crear las reglas de Mangle primero
    const mangleResult = await this.mangleSvc.crearMangleCliente(
      creds, clienteId, config.targetIp, wanIface,
    );

    // Paso 2: asegurar queues padre globales
    await this.asegurarQueuesPadreGlobales(creds);

    // Paso 3: crear queue tree del cliente
    const nombres = this.generarNombres(clienteId);

    return this.pool.execute(creds, async (api) => {
      let creadas = mangleResult.reglasCreadas;

      // ── Queue padre del cliente (agrupa down + up) ──────────
      const padreExiste = await api.write('/queue/tree/print', [
        `?name=${nombres.padre}`,
      ]).then((r: any[]) => r.length > 0).catch(() => false);

      if (!padreExiste) {
        await api.write('/queue/tree/add', [
          `=name=${nombres.padre}`,
          `=parent=global`,
          `=max-limit=${Math.max(config.downloadMbps, config.uploadMbps)}M`,
          `=queue=default`,
          `=priority=${config.prioridad}`,
          `=comment=fn:cli:${clienteId}:padre`,
        ]);
        creadas++;
      }

      // ── Queue download del cliente ───────────────────────────
      const downExiste = await api.write('/queue/tree/print', [
        `?name=${nombres.download}`,
      ]).then((r: any[]) => r.length > 0).catch(() => false);

      if (!downExiste) {
        const downArgs = [
          `=name=${nombres.download}`,
          `=parent=${nombres.padre}`,
          `=packet-mark=${mangleResult.marcas.packetMarkDown}`,
          `=max-limit=${config.downloadMbps}M`,
          `=queue=default`,
          `=priority=${config.prioridad}`,
          `=comment=fn:cli:${clienteId}:down`,
        ];

        // Burst en la queue de bajada si está configurado
        if (config.burstDownMbps && config.burstDownMbps > config.downloadMbps) {
          downArgs.push(
            `=burst-limit=${config.burstDownMbps}M`,
            `=burst-threshold=${config.burstThreshDown || config.downloadMbps}M`,
            `=burst-time=${config.burstTiempoSeg || 8}`,
          );
        }

        await api.write('/queue/tree/add', downArgs);
        creadas++;
      } else {
        // Actualizar si ya existe
        const existing = await api.write('/queue/tree/print', [`?name=${nombres.download}`]);
        if (existing.length) {
          await api.write('/queue/tree/set', [
            `=.id=${existing[0]['.id']}`,
            `=max-limit=${config.downloadMbps}M`,
            `=priority=${config.prioridad}`,
          ]);
        }
      }

      // ── Queue upload del cliente ─────────────────────────────
      const upExiste = await api.write('/queue/tree/print', [
        `?name=${nombres.upload}`,
      ]).then((r: any[]) => r.length > 0).catch(() => false);

      if (!upExiste) {
        const upArgs = [
          `=name=${nombres.upload}`,
          `=parent=${nombres.padre}`,
          `=packet-mark=${mangleResult.marcas.packetMarkUp}`,
          `=max-limit=${config.uploadMbps}M`,
          `=queue=default`,
          `=priority=${config.prioridad}`,
          `=comment=fn:cli:${clienteId}:up`,
        ];

        if (config.burstUpMbps && config.burstUpMbps > config.uploadMbps) {
          upArgs.push(
            `=burst-limit=${config.burstUpMbps}M`,
            `=burst-threshold=${config.burstThreshUp || config.uploadMbps}M`,
            `=burst-time=${config.burstTiempoSeg || 8}`,
          );
        }

        await api.write('/queue/tree/add', upArgs);
        creadas++;
      } else {
        const existing = await api.write('/queue/tree/print', [`?name=${nombres.upload}`]);
        if (existing.length) {
          await api.write('/queue/tree/set', [
            `=.id=${existing[0]['.id']}`,
            `=max-limit=${config.uploadMbps}M`,
            `=priority=${config.prioridad}`,
          ]);
        }
      }

      this.logger.log(
        `Queue Tree cliente ${clienteId}: ` +
        `${config.downloadMbps}/${config.uploadMbps} Mbps | ` +
        `prioridad: ${config.prioridad} | ${creadas} items creados`,
      );

      return { nombres, reglasCreadas: creadas };
    });
  }

  // ────────────────────────────────────────────────────────────
  // ACTUALIZAR VELOCIDAD SIN REPROVISIONAR
  // Modifica max-limit en las queues existentes en caliente.
  // ────────────────────────────────────────────────────────────
  async actualizarVelocidad(
    creds:        RouterCredentials,
    clienteId:    string,
    downloadMbps: number,
    uploadMbps:   number,
    prioridad?:   number,
  ): Promise<{ actualizado: boolean; metodo: string }> {
    const nombres = this.generarNombres(clienteId);

    // Intentar actualizar Queue Tree primero
    const qtActualizado = await this.actualizarQueueTree(
      creds, nombres, downloadMbps, uploadMbps, prioridad,
    );

    if (qtActualizado) {
      return { actualizado: true, metodo: 'queue_tree' };
    }

    // Intentar Simple Queue como fallback
    const sqActualizado = await this.actualizarSimpleQueue(
      creds, clienteId, downloadMbps, uploadMbps,
    );

    return { actualizado: sqActualizado, metodo: sqActualizado ? 'simple_queue' : 'no_encontrado' };
  }

  private async actualizarQueueTree(
    creds:        RouterCredentials,
    nombres:      NombresQueueTree,
    downloadMbps: number,
    uploadMbps:   number,
    prioridad?:   number,
  ): Promise<boolean> {
    return this.pool.execute(creds, async (api) => {
      const downQ = await api.write('/queue/tree/print', [`?name=${nombres.download}`]);
      const upQ   = await api.write('/queue/tree/print', [`?name=${nombres.upload}`]);

      if (!downQ.length && !upQ.length) return false;

      if (downQ.length) {
        await api.write('/queue/tree/set', [
          `=.id=${downQ[0]['.id']}`,
          `=max-limit=${downloadMbps}M`,
          ...(prioridad ? [`=priority=${prioridad}`] : []),
        ]);
      }
      if (upQ.length) {
        await api.write('/queue/tree/set', [
          `=.id=${upQ[0]['.id']}`,
          `=max-limit=${uploadMbps}M`,
          ...(prioridad ? [`=priority=${prioridad}`] : []),
        ]);
      }

      // Actualizar también el padre
      const padreQ = await api.write('/queue/tree/print', [`?name=${nombres.padre}`]);
      if (padreQ.length) {
        await api.write('/queue/tree/set', [
          `=.id=${padreQ[0]['.id']}`,
          `=max-limit=${Math.max(downloadMbps, uploadMbps)}M`,
        ]);
      }

      this.logger.log(
        `Queue Tree actualizada: ${nombres.download} | ` +
        `${downloadMbps}/${uploadMbps} Mbps`,
      );
      return true;
    });
  }

  private async actualizarSimpleQueue(
    creds:        RouterCredentials,
    clienteId:    string,
    downloadMbps: number,
    uploadMbps:   number,
  ): Promise<boolean> {
    // Intentar por nombre del usuario PPPoE (convención de nombres)
    return this.pool.execute(creds, async (api) => {
      // Buscar por comentario que contenga el clienteId
      const queues = await api.write('/queue/simple/print', [
        `?comment~DATAFAST:ClienteID:${clienteId}`,
      ]).catch(() => []);

      if (!queues.length) return false;

      for (const q of queues) {
        await api.write('/queue/simple/set', [
          `=.id=${q['.id']}`,
          `=max-limit=${uploadMbps}M/${downloadMbps}M`,
        ]);
      }

      this.logger.log(
        `Simple Queue actualizada para cliente ${clienteId}: ${uploadMbps}/${downloadMbps} Mbps`,
      );
      return true;
    });
  }

  // ────────────────────────────────────────────────────────────
  // ELIMINAR QUEUE TREE Y MANGLE DE UN CLIENTE
  // ────────────────────────────────────────────────────────────
  async eliminarQueueTreeCliente(
    creds:     RouterCredentials,
    clienteId: string,
  ): Promise<void> {
    const nombres = this.generarNombres(clienteId);

    await this.pool.execute(creds, async (api) => {
      for (const nombre of [nombres.download, nombres.upload, nombres.padre]) {
        const q = await api.write('/queue/tree/print', [`?name=${nombre}`]).catch(() => []);
        if (q.length) {
          await api.write('/queue/tree/remove', [`=.id=${q[0]['.id']}`]);
        }
      }
      this.logger.log(`Queue Tree eliminada: cliente ${clienteId}`);
    });

    // Eliminar también las reglas Mangle
    await this.mangleSvc.eliminarMangleCliente(creds, clienteId);
  }

  // ────────────────────────────────────────────────────────────
  // ASEGURAR QUEUES PADRE GLOBALES
  // Crea el árbol global si no existe: fn-global-down / fn-global-up
  // ────────────────────────────────────────────────────────────
  private async asegurarQueuesPadreGlobales(creds: RouterCredentials): Promise<void> {
    await this.pool.execute(creds, async (api) => {
      const globalDown = await api.write('/queue/tree/print', [`?name=fn-global-down`]).catch(() => []);
      if (!globalDown.length) {
        await api.write('/queue/tree/add', [
          `=name=fn-global-down`,
          `=parent=global`,
          `=max-limit=1000M`,  // Límite total del enlace — ajustar por router
          `=queue=default`,
          `=comment=fn:global:download`,
        ]);
      }

      const globalUp = await api.write('/queue/tree/print', [`?name=fn-global-up`]).catch(() => []);
      if (!globalUp.length) {
        await api.write('/queue/tree/add', [
          `=name=fn-global-up`,
          `=parent=global`,
          `=max-limit=500M`,
          `=queue=default`,
          `=comment=fn:global:upload`,
        ]);
      }
    });
  }

  // ── Generar nombres de queues para un cliente ─────────────
  generarNombres(clienteId: string): NombresQueueTree {
    const shortId = clienteId.replace(/-/g, '').substring(0, 12);
    return {
      padre:    `${this.PREFIX}-${shortId}`,
      download: `${this.PREFIX}-${shortId}-down`,
      upload:   `${this.PREFIX}-${shortId}-up`,
    };
  }

  // ── Listar todos los Queue Trees de DATAFAST ─────────────
  async listarQueueTreesFibranet(creds: RouterCredentials): Promise<any[]> {
    return this.pool.execute(creds, async (api) => {
      const all = await api.write('/queue/tree/print');
      return all.filter((q: any) => q.comment?.startsWith('fn:cli:'));
    });
  }
}
