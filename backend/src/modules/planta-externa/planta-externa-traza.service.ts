import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import {
  ComponentePerdida, Presupuesto, VeredictoMedicion,
  CONECTORES_POR_ENLACE, PERDIDA_CONECTOR_DB,
  consolidar, contrastarConMedicion, perdidaFibra,
} from './domain/presupuesto-optico';

/**
 * Tope de saltos del recorrido.
 *
 * Una matriz de fusiones mal documentada puede formar un ciclo, y sin tope el recorrido no
 * termina. 20 saltos cubren con holgura cualquier topología real —troncal, dos niveles de
 * mufa y distribución son 4 o 5—, así que agotarlo significa que los datos están mal, no
 * que la red sea grande.
 */
const MAX_SALTOS = 20;

export interface PasoTraza {
  tipo: 'acometida' | 'nap' | 'splitter' | 'fibra' | 'mufa' | 'fusion' | 'site';
  descripcion: string;
  perdidaDb?: number;
}

/**
 * Ambas variantes declaran los cuatro campos (los ausentes como `undefined`) en vez de ser
 * un union discriminado puro: el `tsconfig` de este backend tiene `strict: false`, y sin
 * `strictNullChecks` el compilador no estrecha por `completa`. Declararlos así mantiene el
 * tipado útil sin obligar a cada lector a entender por qué hace falta un cast.
 */
export type ResultadoTraza =
  | { completa: true;  pasos: PasoTraza[]; presupuesto: Presupuesto; veredicto: VeredictoMedicion; motivo?: undefined }
  | { completa: false; pasos: PasoTraza[]; presupuesto?: undefined; veredicto?: undefined; motivo: string };

/** Grafo de la empresa cargado en memoria para recorrerlo sin N+1. */
interface Grafo {
  segmentos: Map<string, any>;
  hilos:     Map<string, any>;
  fusiones:  any[];
  splitters: Map<string, any>;
  salidas:   Map<string, any>;
  naps:      Map<string, any>;
  mufas:     Map<string, any>;
  puertos:   Map<string, any>;
}

/**
 * Traza el camino óptico desde el abonado hasta la cabecera y calcula su presupuesto.
 *
 * Es lo que convierte el módulo de documental a diagnóstico: permite responder "¿por qué
 * este cliente ve poca señal?" y "¿qué clientes caen si se corta este hilo?" sin subir a
 * un poste.
 *
 * **Por qué se recorre en memoria y no con una CTE recursiva**, como decía el diseño
 * original: el grafo completo de una operadora son unos pocos miles de filas —cabe de
 * sobra en memoria— y el recorrido alterna entre fusiones y splitters con reglas que en
 * SQL quedan ilegibles. Un bucle acotado se lee, se prueba con dobles y se depura; la CTE
 * habría sido más "elegante" y nadie podría revisarla en un PR. No es N+1: el grafo se
 * carga de una vez y se reutiliza para todas las acometidas de una misma corrida.
 */
@Injectable()
export class PlantaExternaTrazaService {
  private readonly logger = new Logger(PlantaExternaTrazaService.name);

  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /** Carga el grafo entero de la empresa. Una sola vez por corrida. */
  async cargarGrafo(empresaId: string): Promise<Grafo> {
    const q = (sql: string) => this.ds.query(sql, [empresaId]);

    const [segmentos, hilos, fusiones, splitters, salidas, naps, mufas, puertos] =
      await Promise.all([
        q(`SELECT * FROM pe_fibra_segmento WHERE empresa_id = $1 AND deleted_at IS NULL`),
        q(`SELECT * FROM pe_fibra_hilo     WHERE empresa_id = $1 AND deleted_at IS NULL`),
        q(`SELECT * FROM pe_fusion         WHERE empresa_id = $1 AND deleted_at IS NULL`),
        q(`SELECT * FROM pe_splitter       WHERE empresa_id = $1 AND deleted_at IS NULL`),
        q(`SELECT * FROM pe_splitter_salida WHERE empresa_id = $1 AND deleted_at IS NULL`),
        q(`SELECT * FROM pe_nap            WHERE empresa_id = $1 AND deleted_at IS NULL`),
        q(`SELECT * FROM pe_mufa           WHERE empresa_id = $1 AND deleted_at IS NULL`),
        q(`SELECT * FROM pe_nap_puerto     WHERE empresa_id = $1 AND deleted_at IS NULL`),
      ]);

    const porId = (filas: any[]) => new Map(filas.map((f) => [f.id, f]));

    return {
      segmentos: porId(segmentos), hilos: porId(hilos), fusiones,
      splitters: porId(splitters), salidas: porId(salidas),
      naps: porId(naps), mufas: porId(mufas), puertos: porId(puertos),
    };
  }

  /**
   * Recorre desde la acometida del contrato hasta la cabecera.
   *
   * Devuelve `completa: false` con los pasos recorridos hasta donde llegó, en vez de fallar
   * en seco. Una traza interrumpida es EXACTAMENTE lo que el operador necesita ver: le dice
   * dónde se rompe la documentación —qué hilo no está fusionado, qué cable no llega a
   * ningún lado— que es el trabajo pendiente de campo.
   */
  async trazarContrato(
    empresaId: string,
    servicioId: string,
    rxPowerDbm?: number | null,
    grafoPrecargado?: Grafo,
  ): Promise<ResultadoTraza> {
    const grafo = grafoPrecargado ?? await this.cargarGrafo(empresaId);

    const [acometida] = await this.ds.query(
      `SELECT * FROM pe_acometida
        WHERE servicio_id = $1 AND empresa_id = $2 AND deleted_at IS NULL`,
      [servicioId, empresaId],
    );

    if (!acometida) {
      return { completa: false, pasos: [], motivo: 'El contrato no tiene acometida asignada.' };
    }

    const pasos: PasoTraza[] = [];
    const componentes: ComponentePerdida[] = [];

    const puerto = grafo.puertos.get(acometida.nap_puerto_id);
    const nap = puerto ? grafo.naps.get(puerto.nap_id) : null;

    if (!puerto || !nap) {
      return { completa: false, pasos, motivo: 'El puerto de la acometida ya no existe.' };
    }

    pasos.push({ tipo: 'acometida', descripcion: `Acometida del cliente` });
    pasos.push({ tipo: 'nap', descripcion: `${nap.codigo}, puerto ${puerto.numero}` });

    // Conectores de los extremos (caja y roseta). Los intermedios no se cuentan: en una
    // mufa hay fusiones, no conectores.
    componentes.push({
      tipo: 'conector',
      descripcion: `${CONECTORES_POR_ENLACE} conectores (caja y roseta)`,
      perdidaDb: CONECTORES_POR_ENLACE * PERDIDA_CONECTOR_DB,
    });

    if (!puerto.splitter_salida_id) {
      return {
        completa: false, pasos,
        motivo: `El puerto ${puerto.numero} de ${nap.codigo} no tiene splitter detrás. ` +
                `Instálalo desde Planta Externa.`,
      };
    }

    const salida = grafo.salidas.get(puerto.splitter_salida_id);
    const splitter = salida ? grafo.splitters.get(salida.splitter_id) : null;
    if (!splitter) {
      return { completa: false, pasos, motivo: 'La salida de splitter del puerto no existe.' };
    }

    pasos.push({
      tipo: 'splitter',
      descripcion: `Splitter ${splitter.relacion} en ${nap.codigo}`,
      perdidaDb: Number(splitter.perdida_db),
    });
    componentes.push({
      tipo: 'splitter',
      descripcion: `Splitter ${splitter.relacion} (${nap.codigo})`,
      perdidaDb: Number(splitter.perdida_db),
    });

    // ── Recorrido hacia la cabecera ──────────────────────────────
    let hiloActual: any = splitter.hilo_entrada_id
      ? grafo.hilos.get(splitter.hilo_entrada_id)
      : null;

    if (!hiloActual) {
      return {
        completa: false, pasos,
        motivo: `El splitter de ${nap.codigo} no tiene hilo de entrada declarado: la traza ` +
                `no puede continuar hacia la cabecera.`,
      };
    }

    // Detección de ciclos: una matriz de fusiones mal documentada puede cerrar un lazo, y
    // un `Set` de visitados lo corta en el primer reencuentro en vez de agotar el tope.
    const visitados = new Set<string>();

    for (let salto = 0; salto < MAX_SALTOS; salto++) {
      if (visitados.has(hiloActual.id)) {
        return {
          completa: false, pasos,
          motivo: 'Las fusiones documentadas forman un ciclo: el camino vuelve sobre sí mismo.',
        };
      }
      visitados.add(hiloActual.id);

      const segmento = grafo.segmentos.get(hiloActual.segmento_id);
      if (!segmento) {
        return { completa: false, pasos, motivo: 'Un hilo del camino apunta a un cable inexistente.' };
      }

      const perdida = perdidaFibra(Number(segmento.longitud_m), Number(segmento.atenuacion_db_km));
      pasos.push({
        tipo: 'fibra',
        descripcion: `${segmento.codigo} — hilo ${hiloActual.numero} (${Number(segmento.longitud_m).toFixed(0)} m)`,
        perdidaDb: Number(perdida.toFixed(2)),
      });
      componentes.push({
        tipo: 'fibra',
        descripcion: `${segmento.codigo} (${Number(segmento.longitud_m).toFixed(0)} m)`,
        perdidaDb: Number(perdida.toFixed(2)),
      });

      // ¿A qué nodo llega este cable, viniendo desde donde estamos?
      const llegaASite = segmento.origen_site_id || segmento.destino_site_id;
      if (llegaASite) {
        pasos.push({ tipo: 'site', descripcion: 'Cabecera (site)' });
        const presupuesto = consolidar(componentes);
        return {
          completa: true, pasos, presupuesto,
          veredicto: contrastarConMedicion(presupuesto.potenciaEsperadaDbm, rxPowerDbm),
        };
      }

      const mufaId = segmento.origen_mufa_id ?? segmento.destino_mufa_id;
      const mufa = mufaId ? grafo.mufas.get(mufaId) : null;
      if (!mufa) {
        return {
          completa: false, pasos,
          motivo: `El cable ${segmento.codigo} no llega a ninguna mufa ni cabecera documentada.`,
        };
      }

      pasos.push({ tipo: 'mufa', descripcion: mufa.codigo });

      // Dentro de la mufa el hilo continúa por una fusión, o entra a un splitter en
      // cascada. Se comprueban ambas: una mufa de derivación no tiene splitter, y una de
      // división sí.
      const fusion = grafo.fusiones.find(
        (f) => f.mufa_id === mufa.id &&
               (f.hilo_a_id === hiloActual.id || f.hilo_b_id === hiloActual.id),
      );

      if (fusion) {
        const siguienteId = fusion.hilo_a_id === hiloActual.id ? fusion.hilo_b_id : fusion.hilo_a_id;
        const siguiente = grafo.hilos.get(siguienteId);
        if (!siguiente) {
          return { completa: false, pasos, motivo: 'Una fusión apunta a un hilo inexistente.' };
        }
        pasos.push({
          tipo: 'fusion',
          descripcion: `Fusión en ${mufa.codigo}`,
          perdidaDb: Number(fusion.perdida_db),
        });
        componentes.push({
          tipo: 'fusion',
          descripcion: `Fusión en ${mufa.codigo}`,
          perdidaDb: Number(fusion.perdida_db),
        });
        hiloActual = siguiente;
        continue;
      }

      const splitterCascada = [...grafo.splitters.values()].find(
        (s) => s.alojado_en_mufa_id === mufa.id && s.hilo_entrada_id === hiloActual.id,
      );

      if (splitterCascada) {
        pasos.push({
          tipo: 'splitter',
          descripcion: `Splitter ${splitterCascada.relacion} en ${mufa.codigo}`,
          perdidaDb: Number(splitterCascada.perdida_db),
        });
        componentes.push({
          tipo: 'splitter',
          descripcion: `Splitter ${splitterCascada.relacion} (${mufa.codigo})`,
          perdidaDb: Number(splitterCascada.perdida_db),
        });
        const entrada = splitterCascada.hilo_entrada_id
          ? grafo.hilos.get(splitterCascada.hilo_entrada_id) : null;
        if (!entrada) {
          return { completa: false, pasos, motivo: 'El splitter en cascada no declara hilo de entrada.' };
        }
        hiloActual = entrada;
        continue;
      }

      return {
        completa: false, pasos,
        motivo: `El hilo ${hiloActual.numero} llega a ${mufa.codigo} pero no está fusionado ` +
                `ni conectado a un splitter. Documenta el empalme para completar la traza.`,
      };
    }

    return {
      completa: false, pasos,
      motivo: `El camino supera los ${MAX_SALTOS} saltos. Revisa las fusiones: es más ` +
              `probable un error de documentación que una topología tan profunda.`,
    };
  }
}
