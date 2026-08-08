import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { WatcherHeartbeatService, WatcherRancio } from './watcher-heartbeat.service';
import { EventosSistemaService } from '../../modules/sistema/eventos-sistema.service';

export interface DiagnosticoPlano {
  /** El plano automático lleva más del umbral sin dar señales de vida. */
  mudo: boolean;
  segundosDesdeUltimoLatido: number | null;
  ultimoLatido: string | null;
  totalWatchers: number;
  rancios: WatcherRancio[];
  vigilado: boolean;
}

// El worker más lento del ERP late cada 10 minutos; el más rápido, cada 30 segundos. Un
// cuarto de hora sin UN SOLO latido de ningún cron no es una pasada que se retrasó: es que
// no hay nadie ejecutándolos.
const UMBRAL_MUDO_SEG = Number(process.env.LATIDO_UMBRAL_MUDO_SEG ?? 900);

// Un despliegue reinicia los dos procesos. El que responde arranca antes que el que
// trabaja, y durante unos minutos la tabla está legítimamente fría. Sin esta gracia, cada
// despliegue generaría una alarma falsa — y una alarma que grita cuando todo va bien deja
// de leerse, que es la forma más rápida de perder la que sí importa.
const GRACIA_ARRANQUE_SEG = Number(process.env.LATIDO_GRACIA_ARRANQUE_SEG ?? 600);

// Cada cuánto vigila. No hace falta más: el umbral es de 15 minutos.
const CRON_VIGILANCIA = '*/5 * * * *';

// Ventana de deduplicación. Sin ella, un worker muerto un fin de semana genera 576
// eventos idénticos y entierra todo lo demás.
const DEDUPE_MIN = 60;

// ═══════════════════════════════════════════════════════════════════════════
// LatidoVigilanteService — el proceso que responde denuncia al que no late.
//
// Origen (desviación A-3). El latido existía y se exponía en
// `GET /admin/sistema/watchers`, pero ese endpoint es CONSULTABLE, no VIGILANTE: informa a
// quien pregunta, y nadie pregunta por algo que parece funcionar. El ERP puede pasar días
// respondiendo con total normalidad mientras nadie se corta, nadie se reactiva y ningún
// pago se reconcilia, sin una sola señal.
//
// Este servicio corre donde RUN_CRONS !== 'true' —api-core, el proceso que atiende al
// frontend— por la razón que hace que el problema exista: un vigilante alojado en el
// worker muere con él. El testigo tiene que estar fuera.
//
// No notifica por su cuenta: escribe en `eventos_sistema`, que ya es el registro
// persistente de errores de producción y ya lo lee el panel. Se descartó `alertas_sistema`
// porque exige un `dispositivo_id` (FK a `dispositivos_monitoreo`): es el canal de las
// averías de red, y el worker del ERP no es un dispositivo.
// ═══════════════════════════════════════════════════════════════════════════
@Injectable()
export class LatidoVigilanteService implements OnModuleInit {
  private readonly logger = new Logger(LatidoVigilanteService.name);

  constructor(
    private readonly heartbeat: WatcherHeartbeatService,
    private readonly eventos: EventosSistemaService,
    private readonly registry: SchedulerRegistry,
  ) {}

  /** Vigila el proceso que NO ejecuta crons; si él los ejecutara, moriría con ellos. */
  private get vigila(): boolean {
    return process.env.RUN_CRONS !== 'true';
  }

  onModuleInit(): void {
    if (!this.vigila) return;
    const job = new CronJob(CRON_VIGILANCIA, () => void this.vigilar(), null, true, 'America/Lima');
    this.registry.addCronJob('latido-vigilante', job);
    this.logger.log(`Vigilancia del plano automático activa (umbral ${UMBRAL_MUDO_SEG}s).`);
  }

  /**
   * Una pasada de vigilancia. Nunca lanza: un vigilante que tumba el proceso que lo aloja
   * es peor que ninguno.
   */
  async vigilar(): Promise<DiagnosticoPlano | null> {
    try {
      const diag = await this.diagnosticar();

      if (diag.mudo) {
        // El plano entero está callado. Se denuncia ESTO y no los watchers uno a uno: con
        // el worker muerto todos están rancios, y 40 eventos que dicen lo mismo esconden
        // el único que hay que leer. Una causa, un evento.
        await this.eventos.registrarSiNoExiste(
          'PLANO_AUTOMATICO_MUDO',
          DEDUPE_MIN,
          {
            nivel:   'critical',
            origen:  'scheduler',
            mensaje:
              `Ningún cron ha latido en ${diag.segundosDesdeUltimoLatido ?? '∞'}s ` +
              `(umbral ${UMBRAL_MUDO_SEG}s). El proceso de trabajo no está ejecutando nada: ` +
              `no hay cortes, ni reactivaciones, ni reconciliación de pagos, ni drenado del outbox.`,
            contexto: {
              ultimoLatido:  diag.ultimoLatido,
              totalWatchers: diag.totalWatchers,
              umbralSeg:     UMBRAL_MUDO_SEG,
            },
          },
        );
        this.logger.error(`PLANO AUTOMÁTICO MUDO — último latido: ${diag.ultimoLatido ?? 'nunca'}`);
        return diag;
      }

      // El worker vive, pero algún watcher concreto se quedó atrás.
      for (const r of diag.rancios) {
        await this.eventos.registrarSiNoExiste(
          `WATCHER_RANCIO:${r.nombre}`,
          DEDUPE_MIN,
          {
            nivel:   'error',
            origen:  'scheduler',
            mensaje:
              `El watcher "${r.nombre}" lleva ${r.segundosSinLatir}s sin latir ` +
              `(debería hacerlo cada ${r.intervaloEsperadoSeg}s). El resto del plano automático sí corre.`,
            contexto: {
              ultimaEjecucion: r.ultimaEjecucion,
              ultimoError:     r.ultimoError,
              exito:           r.exito,
            },
          },
        );
        this.logger.warn(`Watcher rancio: ${r.nombre} (${r.segundosSinLatir}s sin latir)`);
      }

      return diag;
    } catch (e) {
      this.logger.warn(`La pasada de vigilancia falló: ${(e as Error)?.message}`);
      return null;
    }
  }

  /** Estado del plano automático. Lo consume la vigilancia y también el panel. */
  async diagnosticar(): Promise<DiagnosticoPlano> {
    const [plano, rancios] = await Promise.all([
      this.heartbeat.estadoDelPlano(),
      this.heartbeat.rancios(),
    ]);

    const arrancandoTodavia = process.uptime() < GRACIA_ARRANQUE_SEG;
    const sinLatidoUtil =
      plano.segundosDesdeUltimoLatido === null ||
      plano.segundosDesdeUltimoLatido > UMBRAL_MUDO_SEG;

    return {
      // La gracia de arranque solo suprime la alarma, nunca la autoriza: pasado ese
      // margen el veredicto depende solo del latido, no de cuánto lleve vivo este proceso.
      mudo:                      sinLatidoUtil && !arrancandoTodavia,
      segundosDesdeUltimoLatido: plano.segundosDesdeUltimoLatido,
      ultimoLatido:              plano.ultimoLatido,
      totalWatchers:             plano.totalWatchers,
      rancios,
      vigilado:                  this.vigila,
    };
  }
}
