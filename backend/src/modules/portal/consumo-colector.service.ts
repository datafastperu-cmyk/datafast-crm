import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { QueueService } from '../mikrotik/services/queue.service';
import { ModuleHealthService } from '../../common/services/module-health.service';

// Colector de consumo: convierte los contadores acumulados de las simple queues de
// RouterOS en consumo por hora y contrato (`consumo_datos`).
//
// Decisiones que este colector NO puede tomar a la ligera:
//
// 1. Los contadores de RouterOS son ACUMULADOS desde que la queue se creó. El consumo es
//    la diferencia con la lectura anterior, que vive en `consumo_snapshot`.
// 2. Un delta NEGATIVO no es consumo negativo: es un reinicio del contador (reboot del
//    router, queue recreada al cambiar de plan). Se toma la lectura actual como consumo
//    del período y se sigue — nunca se resta.
// 3. La primera lectura de un contrato NO produce consumo: no hay con qué comparar.
//    Escribir el acumulado histórico como si fuera de esta hora le mostraría al abonado
//    un número gigante que nadie puede explicar.
// 4. Una API call por ROUTER, no por contrato: `/queue/simple/print` devuelve todas.
//    Con 200 abonados en un router, lo contrario serían 200 conexiones cada 15 minutos.
//
// Apagado por defecto (`CONSUMO_COLECTOR_ENABLED`). Encender un poller contra los routers
// de producción es una decisión de operación, no un efecto secundario de actualizar.

const getColectorHabilitado = (): boolean =>
  (process.env.CONSUMO_COLECTOR_ENABLED ?? 'false').toLowerCase() === 'true';

// Tope de routers por corrida: una instalación grande no debe intentar hablar con todos
// sus routers a la vez. Lo que no entra en una corrida entra en la siguiente.
const MAX_ROUTERS_POR_CORRIDA = 10;

interface FilaRouter {
  id: string; empresa_id: string; ip: string | null;
  usuario: string; password_cifrado: string;
  usar_ssl: boolean; puerto_api: number; puerto_api_ssl: number;
  timeout_conexion: number | null;
}

interface FilaContrato {
  contrato_id: string; cliente_id: string; empresa_id: string; nombre_queue: string;
}

interface Snapshot { rx: number; tx: number }

@Injectable()
export class ConsumoColectorService implements OnModuleInit {
  private readonly logger = new Logger(ConsumoColectorService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly queues: QueueService,
    private readonly moduleHealth: ModuleHealthService,
  ) {}

  // El colector apagado NO es una avería, pero sí explica un síntoma visible: el abonado
  // ve "Sin datos" en su consumo. Publicarlo en /health/modules con el motivo evita que
  // alguien lo diagnostique como un bug del portal. Se registra como `degraded` porque
  // la función no está entregando datos — con la razón dejando claro que es deliberado.
  onModuleInit(): void {
    if (this.habilitado()) {
      this.moduleHealth.registrar('portal-consumo', 'ok');
      return;
    }
    this.moduleHealth.registrar(
      'portal-consumo', 'degraded',
      'Colector apagado por configuración (CONSUMO_COLECTOR_ENABLED=false). El portal ' +
      'declara el consumo como "sin datos" en vez de mostrar 0 GB.',
    );
  }

  habilitado(): boolean {
    return getColectorHabilitado();
  }

  async recolectar(): Promise<{ routers: number; contratos: number; omitidos: number }> {
    if (!this.habilitado()) return { routers: 0, contratos: 0, omitidos: 0 };

    const routers = await this.dataSource.query<FilaRouter[]>(
      `SELECT r.id, r.empresa_id,
              COALESCE(r.vpn_ip, r.ip_gestion) AS ip,
              r.usuario, r.password_cifrado, r.usar_ssl,
              r.puerto_api, r.puerto_api_ssl, r.timeout_conexion
         FROM routers r
        WHERE r.activo = true AND r.deleted_at IS NULL
          AND EXISTS (
            SELECT 1 FROM servicios c
             WHERE c.router_id = r.id AND c.deleted_at IS NULL
               AND c.nombre_queue IS NOT NULL
          )
        ORDER BY r.created_at ASC
        LIMIT $1`,
      [MAX_ROUTERS_POR_CORRIDA],
    );

    let contratos = 0;
    let omitidos  = 0;

    for (const router of routers) {
      try {
        const resultado = await this.recolectarRouter(router);
        contratos += resultado.escritos;
        omitidos  += resultado.omitidos;
      } catch (e) {
        // Un router inalcanzable no puede detener la recolección de los demás. Se registra
        // y se sigue: el consumo es información, no una operación crítica.
        this.logger.warn(
          `Consumo: router ${router.id} inalcanzable — ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    if (contratos || omitidos) {
      this.logger.log(
        `Consumo: ${contratos} contrato(s) actualizados, ${omitidos} sin lectura previa, ` +
          `${routers.length} router(s).`,
      );
    }
    return { routers: routers.length, contratos, omitidos };
  }

  private async recolectarRouter(
    router: FilaRouter,
  ): Promise<{ escritos: number; omitidos: number }> {
    if (!router.ip) return { escritos: 0, omitidos: 0 };

    const contratos = await this.dataSource.query<FilaContrato[]>(
      `SELECT id AS contrato_id, cliente_id, empresa_id, nombre_queue
         FROM servicios
        WHERE router_id = $1 AND deleted_at IS NULL AND nombre_queue IS NOT NULL`,
      [router.id],
    );
    if (!contratos.length) return { escritos: 0, omitidos: 0 };

    const creds = {
      id:              router.id,
      ip:              router.ip,
      port:            router.usar_ssl ? router.puerto_api_ssl : router.puerto_api,
      user:            router.usuario,
      passwordCifrado: router.password_cifrado,
      useSsl:          router.usar_ssl,
      timeoutSec:      router.timeout_conexion ?? 10,
      version:         'v7' as const,
    };

    // Una sola llamada para todo el router.
    const queues = await this.queues.listarSimpleQueues(creds);
    const porNombre = new Map<string, Record<string, string>>();
    for (const q of queues) {
      if (q?.name) porNombre.set(String(q.name), q as Record<string, string>);
    }

    const previos = await this.snapshots(contratos.map((c) => c.contrato_id));
    const ahora = new Date();
    const fecha = ahora.toISOString().slice(0, 10);
    const hora  = ahora.getUTCHours();

    let escritos = 0;
    let omitidos = 0;

    for (const contrato of contratos) {
      const queue = porNombre.get(contrato.nombre_queue);
      if (!queue) continue;

      const actual = this.parsearBytes(queue.bytes);
      if (!actual) continue;

      const previo = previos.get(contrato.contrato_id);
      await this.guardarSnapshot(contrato, actual);

      if (!previo) {
        // Primera lectura: se guarda la referencia y se espera a la siguiente corrida.
        omitidos++;
        continue;
      }

      const delta = {
        rx: this.delta(previo.rx, actual.rx),
        tx: this.delta(previo.tx, actual.tx),
      };
      if (delta.rx === 0 && delta.tx === 0) continue;

      await this.acumular(contrato, fecha, hora, delta);
      escritos++;
    }

    return { escritos, omitidos };
  }

  // RouterOS reporta `bytes` como "entrada/salida". Desde la perspectiva de la queue, la
  // ENTRADA es lo que sube el abonado y la SALIDA lo que baja: se invierten para que
  // `rx` sea siempre la bajada del cliente, que es como lo lee el resto del sistema.
  private parsearBytes(valor: string | undefined): Snapshot | null {
    if (!valor) return null;
    const [entrada, salida] = String(valor).split('/');
    const subida = Number.parseInt(entrada ?? '0', 10);
    const bajada = Number.parseInt(salida ?? '0', 10);
    if (!Number.isFinite(subida) || !Number.isFinite(bajada)) return null;
    return { rx: bajada, tx: subida };
  }

  // Un contador que baja significa que se reinició (reboot, queue recreada). El consumo
  // del período es lo acumulado desde el reinicio; restar daría un negativo que
  // contaminaría el total del mes.
  private delta(previo: number, actual: number): number {
    return actual >= previo ? actual - previo : actual;
  }

  private async snapshots(contratoIds: string[]): Promise<Map<string, Snapshot>> {
    const filas = await this.dataSource.query<
      Array<{ contrato_id: string; rx_bytes: string; tx_bytes: string }>
    >(
      `SELECT contrato_id, rx_bytes, tx_bytes FROM consumo_snapshot
        WHERE contrato_id = ANY($1::uuid[])`,
      [contratoIds],
    );
    return new Map(
      filas.map((f) => [f.contrato_id, { rx: Number(f.rx_bytes), tx: Number(f.tx_bytes) }]),
    );
  }

  private async guardarSnapshot(contrato: FilaContrato, valores: Snapshot): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO consumo_snapshot (contrato_id, empresa_id, rx_bytes, tx_bytes, leido_en)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (contrato_id) DO UPDATE
         SET rx_bytes = EXCLUDED.rx_bytes,
             tx_bytes = EXCLUDED.tx_bytes,
             leido_en = EXCLUDED.leido_en`,
      [contrato.contrato_id, contrato.empresa_id, valores.rx, valores.tx],
    );
  }

  // Idempotente por (contrato, fecha, hora): dos corridas en la misma hora SUMAN sus
  // deltas en la misma fila en vez de duplicarla. La unicidad ya existía en el esquema.
  private async acumular(
    contrato: FilaContrato,
    fecha: string,
    hora: number,
    delta: Snapshot,
  ): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO consumo_datos
         (empresa_id, contrato_id, cliente_id, fecha, hora, rx_bytes, tx_bytes, fuente)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'mikrotik')
       ON CONFLICT (contrato_id, fecha, hora) DO UPDATE
         SET rx_bytes = consumo_datos.rx_bytes + EXCLUDED.rx_bytes,
             tx_bytes = consumo_datos.tx_bytes + EXCLUDED.tx_bytes`,
      [
        contrato.empresa_id, contrato.contrato_id, contrato.cliente_id,
        fecha, hora, delta.rx, delta.tx,
      ],
    );
  }
}
