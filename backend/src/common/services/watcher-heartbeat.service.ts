import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export interface WatcherRancio {
  nombre: string;
  ultimaEjecucion: Date;
  segundosSinLatir: number;
  intervaloEsperadoSeg: number;
  exito: boolean;
  ultimoError: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// WatcherHeartbeatService — prueba de vida de los procesos de fondo.
//
// Problema que resuelve (2026-07-28): los watchers del ERP están diseñados para no
// loguear cuando no encuentran nada. Es correcto —si no, inundarían la bitácora cada
// pocos minutos— pero deja un punto ciego grave: un watcher que MUERE se ve exactamente
// igual que uno que simplemente no tiene trabajo. Ambos guardan silencio.
//
// Y el silencio de un watcher es peligroso justo en proporción a su utilidad: el de
// staleness TR-069 solo sirve para avisar de ONUs con la gestión muerta; si él mismo se
// muere, deja de avisar y nadie lo nota. La avería se vuelve invisible dos veces.
//
// El latido se registra SIEMPRE, haya trabajo o no. Eso convierte "no dice nada" —que no
// es información— en "latió hace 3 minutos y no encontró nada", que sí lo es.
// ═══════════════════════════════════════════════════════════════════════════
@Injectable()
export class WatcherHeartbeatService {
  private readonly logger = new Logger(WatcherHeartbeatService.name);

  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /**
   * Envuelve la ejecución de un watcher: mide, registra el latido y propaga el resultado.
   *
   * Se usa como envoltorio en vez de exponer un `latir()` suelto a propósito: un método
   * que hay que acordarse de llamar se olvida, y se olvida sobre todo en el camino de
   * error — que es justo cuando el latido más importa. Aquí el registro ocurre en el
   * `finally`, así que un watcher que revienta también deja constancia, con su error.
   *
   * NUNCA lanza por causa del heartbeat: si la tabla no existe o la BD está ocupada, el
   * watcher debe seguir haciendo su trabajo. Un mecanismo de observación que tumba lo
   * observado es peor que no tenerlo.
   */
  async ejecutar<T>(
    nombre: string,
    intervaloEsperadoSeg: number,
    fn: () => Promise<T>,
  ): Promise<T> {
    const inicio = Date.now();
    let exito = true;
    let error: string | null = null;
    let resultado: unknown = null;

    try {
      const r = await fn();
      resultado = r ?? null;
      return r;
    } catch (e) {
      exito = false;
      error = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      void this._registrar(nombre, intervaloEsperadoSeg, Date.now() - inicio, exito, resultado, error);
    }
  }

  private async _registrar(
    nombre: string,
    intervaloEsperadoSeg: number,
    duracionMs: number,
    exito: boolean,
    resultado: unknown,
    error: string | null,
  ): Promise<void> {
    try {
      await this.ds.query(`
        INSERT INTO watcher_heartbeat
          (nombre, intervalo_esperado_seg, ultima_ejecucion, duracion_ms, exito, resultado, ultimo_error, ejecuciones, fallos)
        VALUES ($1, $2, NOW(), $3, $4, $5, $6, 1, $7)
        ON CONFLICT (nombre) DO UPDATE SET
          intervalo_esperado_seg = EXCLUDED.intervalo_esperado_seg,
          ultima_ejecucion       = EXCLUDED.ultima_ejecucion,
          duracion_ms            = EXCLUDED.duracion_ms,
          exito                  = EXCLUDED.exito,
          resultado              = EXCLUDED.resultado,
          -- El último error se CONSERVA si la pasada actual fue bien: sirve para
          -- diagnosticar un watcher intermitente, que es el caso difícil.
          ultimo_error           = COALESCE(EXCLUDED.ultimo_error, watcher_heartbeat.ultimo_error),
          ejecuciones            = watcher_heartbeat.ejecuciones + 1,
          fallos                 = watcher_heartbeat.fallos + $7
      `, [
        nombre,
        intervaloEsperadoSeg,
        duracionMs,
        exito,
        resultado === null || resultado === undefined ? null : JSON.stringify(resultado),
        error,
        exito ? 0 : 1,
      ]);
    } catch (e) {
      this.logger.warn(`No se pudo registrar el latido de "${nombre}": ${(e as Error)?.message}`);
    }
  }

  /** Todos los latidos, para el panel de sistema. */
  async listar(): Promise<any[]> {
    return this.ds.query(`
      SELECT nombre, intervalo_esperado_seg, ultima_ejecucion, duracion_ms, exito,
             resultado, ultimo_error, ejecuciones, fallos,
             EXTRACT(EPOCH FROM (NOW() - ultima_ejecucion))::int AS segundos_sin_latir
      FROM   watcher_heartbeat
      ORDER  BY nombre
    `).catch(() => []);
  }

  /**
   * Watchers que llevan sin latir más de lo que deberían.
   *
   * El margen de 3× el intervalo no es arbitrario: un watcher puede saltarse una pasada
   * por un despliegue o porque la anterior tardó de más, y avisar por eso sería ruido.
   * Tres intervalos seguidos sin latir ya no es una casualidad.
   */
  async rancios(): Promise<WatcherRancio[]> {
    const filas = await this.ds.query(`
      SELECT nombre, ultima_ejecucion, intervalo_esperado_seg, exito, ultimo_error,
             EXTRACT(EPOCH FROM (NOW() - ultima_ejecucion))::int AS segundos_sin_latir
      FROM   watcher_heartbeat
      WHERE  NOW() - ultima_ejecucion > (intervalo_esperado_seg * 3) * INTERVAL '1 second'
      ORDER  BY segundos_sin_latir DESC
    `).catch(() => []);

    return filas.map((f: any) => ({
      nombre:               f.nombre,
      ultimaEjecucion:      f.ultima_ejecucion,
      segundosSinLatir:     Number(f.segundos_sin_latir),
      intervaloEsperadoSeg: Number(f.intervalo_esperado_seg),
      exito:                f.exito,
      ultimoError:          f.ultimo_error,
    }));
  }
}
