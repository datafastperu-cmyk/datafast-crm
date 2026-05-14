import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectDataSource }       from '@nestjs/typeorm';
import { DataSource }             from 'typeorm';
import { RouterConnectionPool, RouterCredentials } from '../services/connection-pool.service';
import { VelocidadService, EstrategiaQueue }       from './velocidad/velocidad.service';
import { MangleService }                           from './velocidad/mangle.service';
import { QueueTreeClienteService }                 from './velocidad/queue-tree-cliente.service';
import { QueueService }                            from '../services/queue.service';

// ─── Parámetros de aprovisionamiento de velocidad ────────────
export interface AplicarVelocidadParams {
  routerCreds:  RouterCredentials;
  clienteId:    string;
  usuarioPppoe: string;   // Nombre de la Simple Queue si aplica
  ipAsignada:   string;
  downloadMbps: number;
  uploadMbps:   number;
  burstDownMbps?: number;
  burstUpMbps?:   number;
  burstTiempoSeg?: number;
  tipoQueuePlan:  string;  // Del plan: 'simple_queue' | 'queue_tree' | 'pcq' | 'sin_limite'
  tipoPlan:       string;  // 'residencial' | 'empresarial' | 'dedicado'
  wanIface?:      string;
}

// ─── Resultado de aplicación ──────────────────────────────────
export interface ResultadoVelocidad {
  estrategia:    EstrategiaQueue;
  nombreQueue?:  string;
  reglasCreadas: number;
  exitoso:       boolean;
  detalle:       string;
}

// ─── Resultado de sincronización masiva ──────────────────────
export interface ResultadoSincronizacion {
  routerId:     string;
  procesados:   number;
  actualizados: number;
  errores:      number;
  detalles:     Array<{ clienteId: string; resultado: string; error?: string }>;
}

@Injectable()
export class VelocidadOrquestador {
  private readonly logger = new Logger(VelocidadOrquestador.name);

  constructor(
    private readonly pool:          RouterConnectionPool,
    private readonly velocidadSvc:  VelocidadService,
    private readonly mangleSvc:     MangleService,
    private readonly qtClienteSvc:  QueueTreeClienteService,
    private readonly queueSvc:      QueueService,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  // ────────────────────────────────────────────────────────────
  // APLICAR VELOCIDAD (punto de entrada principal)
  // Detecta la capacidad del router, decide la estrategia
  // y aplica la configuración correcta.
  // ────────────────────────────────────────────────────────────
  async aplicarVelocidad(params: AplicarVelocidadParams): Promise<ResultadoVelocidad> {
    const { routerCreds: creds, clienteId } = params;

    try {
      // ── 1. Detectar capacidad del router ──────────────────
      const capacidad = await this.velocidadSvc.detectarCapacidad(creds);

      // ── 2. Decidir estrategia ─────────────────────────────
      const estrategia = this.velocidadSvc.decidirEstrategia(
        params.tipoQueuePlan,
        capacidad,
        0, // totalClientes — simplificado
      );

      this.logger.log(
        `Aplicando velocidad cliente ${clienteId}: ` +
        `${params.downloadMbps}/${params.uploadMbps} Mbps | ` +
        `estrategia: ${estrategia} | router: ${creds.ip}`,
      );

      // ── 3. Construir configuración ─────────────────────────
      const config = this.velocidadSvc.construirConfig({
        nombreCliente:   params.usuarioPppoe,
        ipAsignada:      params.ipAsignada,
        downloadMbps:    params.downloadMbps,
        uploadMbps:      params.uploadMbps,
        burstDownMbps:   params.burstDownMbps,
        burstUpMbps:     params.burstUpMbps,
        burstTiempoSeg:  params.burstTiempoSeg,
        tipoPlan:        params.tipoPlan,
        estrategia,
      });

      // ── 4. Aplicar según la estrategia ────────────────────
      let resultado: ResultadoVelocidad;

      switch (estrategia) {
        case EstrategiaQueue.QUEUE_TREE: {
          const qt = await this.qtClienteSvc.crearQueueTreeCliente(
            creds, clienteId, config, params.wanIface,
          );
          resultado = {
            estrategia,
            nombreQueue:  qt.nombres.padre,
            reglasCreadas: qt.reglasCreadas,
            exitoso:      true,
            detalle:      `Queue Tree + Mangle: ${qt.reglasCreadas} reglas en ${creds.ip}`,
          };
          break;
        }

        case EstrategiaQueue.PCQ_GLOBAL: {
          // PCQ ya maneja el tráfico por IP automáticamente
          // Solo necesitamos verificar que PCQ esté configurado
          const tienePcq = await this.queueSvc.tienePcqConfigurado(creds);
          if (!tienePcq) {
            await this.queueSvc.configurarPcqCompleto(creds, {
              namePrefix:   'fibranet',
              downloadMbps: params.downloadMbps * 20, // capacidad total estimada del nodo
              uploadMbps:   params.uploadMbps * 20,
            });
          }
          resultado = {
            estrategia,
            reglasCreadas: tienePcq ? 0 : 6,
            exitoso:       true,
            detalle:       `PCQ global activo en ${creds.ip} — cliente controlado por flujo`,
          };
          break;
        }

        case EstrategiaQueue.SIN_LIMITE: {
          // Planes dedicados: no aplicar limitación
          resultado = {
            estrategia,
            reglasCreadas: 0,
            exitoso:       true,
            detalle:       'Plan sin límite de velocidad — sin queue aplicada',
          };
          break;
        }

        default: {
          // SIMPLE_QUEUE (default y más común)
          const queueId = await this.queueSvc.crearSimpleQueue(creds, {
            name:            params.usuarioPppoe,
            target:          `${params.ipAsignada}/32`,
            maxLimitDown:    params.downloadMbps,
            maxLimitUp:      params.uploadMbps,
            burstLimitDown:  params.burstDownMbps,
            burstLimitUp:    params.burstUpMbps,
            burstTimeDown:   params.burstTiempoSeg,
            burstTimeUp:     params.burstTiempoSeg,
            burstThreshDown: params.burstDownMbps
              ? Math.round(params.downloadMbps * 0.8)
              : undefined,
            burstThreshUp:   params.burstUpMbps
              ? Math.round(params.uploadMbps * 0.8)
              : undefined,
            comment: `FibraNet:ClienteID:${clienteId}`,
          });
          resultado = {
            estrategia,
            nombreQueue:   params.usuarioPppoe,
            reglasCreadas: 1,
            exitoso:       true,
            detalle:       `Simple Queue: ${params.usuarioPppoe} | ${params.uploadMbps}M/${params.downloadMbps}M`,
          };
        }
      }

      this.logger.log(`Velocidad aplicada: ${resultado.detalle}`);
      return resultado;

    } catch (error) {
      this.logger.error(
        `Error aplicando velocidad cliente ${clienteId} en ${params.routerCreds.ip}: ${error.message}`,
      );
      return {
        estrategia:    EstrategiaQueue.SIMPLE_QUEUE,
        reglasCreadas: 0,
        exitoso:       false,
        detalle:       `Error: ${error.message}`,
      };
    }
  }

  // ────────────────────────────────────────────────────────────
  // CAMBIO DE PLAN — Actualizar velocidad en caliente
  // Cuando un cliente cambia de plan, actualiza la queue
  // existente sin desconectarlo.
  // ────────────────────────────────────────────────────────────
  async cambiarVelocidadPlan(
    creds:        RouterCredentials,
    clienteId:    string,
    usuarioPppoe: string,
    downloadMbps: number,
    uploadMbps:   number,
    prioridad?:   number,
  ): Promise<{ actualizado: boolean; metodo: string; detalle: string }> {
    this.logger.log(
      `Cambio de velocidad plan: cliente ${clienteId} → ` +
      `${downloadMbps}/${uploadMbps} Mbps en ${creds.ip}`,
    );

    // Intentar actualizar Queue Tree (si existe)
    const qtResult = await this.qtClienteSvc.actualizarVelocidad(
      creds, clienteId, downloadMbps, uploadMbps, prioridad,
    );

    if (qtResult.actualizado) {
      return {
        actualizado: true,
        metodo:      qtResult.metodo,
        detalle:     `Velocidad actualizada vía ${qtResult.metodo}: ${downloadMbps}/${uploadMbps} Mbps`,
      };
    }

    // Fallback: Simple Queue por nombre de usuario PPPoE
    try {
      await this.queueSvc.actualizarLimiteQueue(creds, usuarioPppoe, downloadMbps, uploadMbps);
      return {
        actualizado: true,
        metodo:      'simple_queue',
        detalle:     `Simple Queue ${usuarioPppoe} actualizada: ${downloadMbps}/${uploadMbps} Mbps`,
      };
    } catch (err) {
      return {
        actualizado: false,
        metodo:      'no_encontrado',
        detalle:     `No se encontró queue para el cliente ${clienteId}: ${err.message}`,
      };
    }
  }

  // ────────────────────────────────────────────────────────────
  // SINCRONIZACIÓN MASIVA
  // Compara la velocidad configurada en el router contra la del
  // plan en la base de datos y corrige discrepancias.
  // ────────────────────────────────────────────────────────────
  async sincronizarVelocidades(
    creds:    RouterCredentials,
    routerId: string,
  ): Promise<ResultadoSincronizacion> {
    this.logger.log(`Sincronizando velocidades: router ${routerId} (${creds.ip})`);

    const resultado: ResultadoSincronizacion = {
      routerId,
      procesados:   0,
      actualizados: 0,
      errores:      0,
      detalles:     [],
    };

    try {
      // 1. Obtener todos los contratos activos de este router con sus planes
      const contratos = await this.ds.query(`
        SELECT
          co.id           AS contrato_id,
          co.usuario_pppoe,
          co.ip_asignada,
          co.cliente_id,
          pl.velocidad_bajada  AS download_mbps,
          pl.velocidad_subida  AS upload_mbps,
          pl.tipo_queue,
          pl.tipo             AS tipo_plan,
          pl.nombre           AS plan_nombre
        FROM contratos co
        JOIN planes pl ON pl.id = co.plan_id
        WHERE co.router_id = $1
          AND co.estado IN ('activo', 'prorroga')
          AND co.deleted_at IS NULL
          AND co.usuario_pppoe IS NOT NULL
          AND co.ip_asignada IS NOT NULL
      `, [routerId]);

      resultado.procesados = contratos.length;

      if (!contratos.length) {
        this.logger.log(`Sin contratos activos para router ${routerId}`);
        return resultado;
      }

      // 2. Construir mapa de velocidades esperadas
      const planesPorQueue = new Map<string, { downloadMbps: number; uploadMbps: number }>();
      for (const c of contratos) {
        planesPorQueue.set(c.usuario_pppoe, {
          downloadMbps: c.download_mbps,
          uploadMbps:   c.upload_mbps,
        });
      }

      // 3. Detectar discrepancias en Simple Queues
      const discrepancias = await this.velocidadSvc.listarDiscrepancias(creds, planesPorQueue);

      this.logger.log(
        `Router ${creds.ip}: ${contratos.length} contratos, ` +
        `${discrepancias.length} discrepancias encontradas`,
      );

      // 4. Corregir discrepancias
      for (const disc of discrepancias) {
        const contrato = contratos.find((c: any) => c.usuario_pppoe === disc.nombre);
        if (!contrato) continue;

        try {
          await this.queueSvc.actualizarLimiteQueue(
            creds,
            disc.nombre,
            parseInt(contrato.download_mbps, 10),
            parseInt(contrato.upload_mbps, 10),
          );

          resultado.actualizados++;
          resultado.detalles.push({
            clienteId: contrato.cliente_id,
            resultado: `${disc.nombre}: ${disc.actual} → ${disc.esperado}`,
          });

        } catch (err) {
          resultado.errores++;
          resultado.detalles.push({
            clienteId: contrato.cliente_id,
            resultado: 'error',
            error:     err.message,
          });
        }
      }

      // 5. Verificar Queue Trees (clientes con queue_tree / pcq)
      const contratosQT = contratos.filter((c: any) =>
        c.tipo_queue === 'queue_tree' || c.tipo_queue === 'pcq',
      );

      for (const c of contratosQT) {
        try {
          const qtResult = await this.qtClienteSvc.actualizarVelocidad(
            creds,
            c.cliente_id,
            parseInt(c.download_mbps, 10),
            parseInt(c.upload_mbps, 10),
          );

          if (qtResult.actualizado) {
            resultado.actualizados++;
            resultado.detalles.push({
              clienteId: c.cliente_id,
              resultado: `Queue Tree actualizada: ${c.download_mbps}/${c.upload_mbps} Mbps`,
            });
          }
        } catch (err) {
          resultado.errores++;
          resultado.detalles.push({
            clienteId: c.cliente_id,
            resultado: 'error',
            error:     err.message,
          });
        }
      }

    } catch (err) {
      this.logger.error(`Error en sincronización masiva ${routerId}: ${err.message}`);
      resultado.errores++;
    }

    this.logger.log(
      `Sincronización completada: ${resultado.actualizados} actualizados, ` +
      `${resultado.errores} errores de ${resultado.procesados} contratos`,
    );

    return resultado;
  }

  // ────────────────────────────────────────────────────────────
  // ELIMINAR TODAS LAS QUEUES DE UN CLIENTE
  // ────────────────────────────────────────────────────────────
  async eliminarVelocidadCliente(
    creds:        RouterCredentials,
    clienteId:    string,
    usuarioPppoe: string,
  ): Promise<void> {
    // Eliminar Queue Tree + Mangle
    await this.qtClienteSvc.eliminarQueueTreeCliente(creds, clienteId).catch((err) =>
      this.logger.warn(`No se pudo eliminar Queue Tree ${clienteId}: ${err.message}`),
    );

    // Eliminar Simple Queue (por nombre de usuario)
    await this.queueSvc.eliminarSimpleQueue(creds, usuarioPppoe).catch((err) =>
      this.logger.warn(`No se pudo eliminar Simple Queue ${usuarioPppoe}: ${err.message}`),
    );

    this.logger.log(`Queues eliminadas: cliente ${clienteId} (${usuarioPppoe}) en ${creds.ip}`);
  }
}
