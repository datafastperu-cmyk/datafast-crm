import { Injectable, Logger, OnApplicationBootstrap, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import type { CronJob } from 'cron';
import { WatcherHeartbeatService } from './watcher-heartbeat.service';

// Marca de "ya envuelto". Symbol y no una propiedad normal para no chocar nunca con un
// campo del CronJob ni aparecer en un JSON.stringify del job.
const YA_ENVUELTO = Symbol('datafast:latido');

// `@Cron()` sin `name:` recibe un UUID v4 como clave de registro (ver
// `scheduler.orchestrator.js`, `addCron`: `options.name || uuid.v4()`). Ese UUID cambia en
// cada arranque, así que usarlo como nombre de latido dejaría una fila huérfana por cron y
// por despliegue, y `rancios()` gritaría por todas ellas cada vez que se reinicia el
// backend. Un cron sin nombre no se envuelve: se denuncia.
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const INTERVALO_DESCONOCIDO_SEG = 86_400;

interface CronJobInterno {
  _callbacks?: Array<(...args: unknown[]) => unknown>;
  nextDates(cantidad: number): Array<{ toMillis?: () => number }>;
  [YA_ENVUELTO]?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// CronLatidoService — el latido deja de ser algo que hay que acordarse de llamar.
//
// Origen (2026-08-07, desviación A-3). `WatcherHeartbeatService` existe desde el 28/07 y
// está bien construido: envuelve la ejecución, registra en el `finally`, no lanza nunca.
// Su módulo es `@Global()` con un comentario que dice, literalmente, que se hizo así
// porque "obligar a cada módulo a importar este sería fricción que termina en watchers sin
// latido — justo lo que se quiere evitar".
//
// Al medirlo: **de 47 jobs programados en el ERP, exactamente 1 latía.**
//
// El @Global() quitó la fricción de IMPORTAR y dejó intacta la de LLAMAR, que era la que
// importaba. Es el mismo error que la máquina de estados declarativa vino a corregir en
// otro terreno: una garantía que cada autor debe recordar implementar no es una garantía,
// es una estadística. La idempotencia se DERIVA del estado destino; aquí el latido se
// DERIVA de estar registrado en el SchedulerRegistry.
//
// Un cron nuevo no puede olvidarse de latir porque no es él quien lo implementa.
//
// SOLO se activa donde RUN_CRONS === 'true'. Es la mitad crítica del diseño: en api-core
// todos los crons arrancan con un guard que retorna al instante, así que envolverlos ahí
// registraría latidos de trabajo que nadie hizo — la tabla se vería sana justo mientras el
// worker está muerto, que es exactamente el fallo que A-3 existe para detectar.
// El que trabaja late; el que responde vigila (LatidoVigilanteService).
// ═══════════════════════════════════════════════════════════════════════════
@Injectable()
export class CronLatidoService implements OnModuleInit, OnApplicationBootstrap {
  private readonly logger = new Logger(CronLatidoService.name);

  /** Nombres envueltos, para el diagnóstico y para los tests. */
  private readonly envueltos = new Set<string>();
  /** Claves UUID que se rechazaron: crons sin `name:` en su decorador. */
  private readonly sinNombre: string[] = [];

  constructor(
    private readonly registry: SchedulerRegistry,
    private readonly heartbeat: WatcherHeartbeatService,
  ) {}

  private get activo(): boolean {
    return process.env.RUN_CRONS === 'true';
  }

  // Se parchea `addCronJob` en onModuleInit —el hook más temprano disponible— para
  // capturar todo lo que se registre después, incluido el SchedulerOrchestrator de
  // NestJS, que monta los `@Cron` en onApplicationBootstrap.
  onModuleInit(): void {
    if (!this.activo) return;

    const original = this.registry.addCronJob.bind(this.registry) as (n: string, j: CronJob) => void;
    this.registry.addCronJob = ((nombre: string, job: CronJob) => {
      this.envolver(nombre, job);
      return original(nombre, job);
    }) as typeof this.registry.addCronJob;
  }

  // Barrido de cierre: cualquier job registrado ANTES de que el parche estuviera puesto
  // (el orden de onModuleInit entre módulos depende del grafo de dependencias y no es algo
  // sobre lo que se deba apostar). `envolver` es idempotente, así que pasar dos veces por
  // el mismo job no hace nada.
  onApplicationBootstrap(): void {
    if (!this.activo) return;

    for (const [nombre, job] of this.registry.getCronJobs()) {
      this.envolver(nombre, job as unknown as CronJob);
    }

    if (this.sinNombre.length > 0) {
      this.logger.error(
        `${this.sinNombre.length} cron(s) sin \`name:\` en su decorador @Cron: su clave es un ` +
        `UUID que cambia en cada arranque, así que NO pueden latir. Añade { name: '...' }.`,
      );
    }
    this.logger.log(`Latido automático activo en ${this.envueltos.size} cron(s).`);
  }

  /**
   * Envuelve los callbacks del job para que cada ejecución quede registrada.
   *
   * Se envuelven los CALLBACKS y no `fireOnTick()` a propósito: en cron 3.2.1 `fireOnTick`
   * hace `void callback.call(...)` — no espera. Envolviéndolo por fuera se mediría el
   * tiempo hasta el primer `await` del cron, no su duración real, y un cron que revienta a
   * mitad quedaría registrado como exitoso. Envolviendo el callback, el `finally` del
   * heartbeat ocurre cuando el trabajo termina de verdad.
   *
   * `_callbacks` es interno de la librería. Lo sostiene un test que construye un CronJob
   * real y comprueba que el latido se registra: si una futura versión de `cron` renombra el
   * campo, el test cae, que es justo lo que debe pasar.
   */
  private envolver(nombre: string, job: CronJob): void {
    const interno = job as unknown as CronJobInterno;

    if (interno[YA_ENVUELTO]) return;

    if (UUID_V4.test(nombre)) {
      this.sinNombre.push(nombre);
      return;
    }

    const callbacks = interno._callbacks;
    if (!Array.isArray(callbacks) || callbacks.length === 0) {
      this.logger.warn(`El cron "${nombre}" no expone callbacks envolvibles; se queda sin latido.`);
      return;
    }

    const intervaloSeg = this.intervaloDe(job);
    const heartbeat = this.heartbeat;

    interno._callbacks = callbacks.map((original) =>
      // `function` y no flecha: cron invoca con `callback.call(this.context, onComplete)` y
      // el callback de NestJS depende de ese `this`.
      function envuelto(this: unknown, ...args: unknown[]): Promise<unknown> {
        return heartbeat.ejecutar(nombre, intervaloSeg, async () => original.apply(this, args));
      },
    );

    interno[YA_ENVUELTO] = true;
    this.envueltos.add(nombre);
  }

  /**
   * Cada cuánto debería latir, deducido de la propia expresión cron.
   *
   * Se calcula con las dos próximas ejecuciones en vez de parsear la expresión a mano:
   * es la misma fuente que decide cuándo corre el job, así que no puede divergir de ella.
   * Un cron diario da 86400; uno cada dos minutos, 120. `rancios()` aplica su margen de 3×.
   */
  private intervaloDe(job: CronJob): number {
    try {
      const [a, b] = (job as unknown as CronJobInterno).nextDates(2);
      const ms = (d: { toMillis?: () => number }) =>
        typeof d?.toMillis === 'function' ? d.toMillis() : new Date(d as unknown as string).getTime();
      const seg = Math.round((ms(b) - ms(a)) / 1000);
      return seg > 0 ? seg : INTERVALO_DESCONOCIDO_SEG;
    } catch {
      return INTERVALO_DESCONOCIDO_SEG;
    }
  }

  /** Para el panel de sistema y los tests. */
  diagnostico(): { activo: boolean; envueltos: string[]; sinNombre: number } {
    return {
      activo:    this.activo,
      envueltos: [...this.envueltos].sort(),
      sinNombre: this.sinNombre.length,
    };
  }
}
