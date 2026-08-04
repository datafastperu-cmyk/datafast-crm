import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';

import { PlantaExternaTrazaService } from './planta-externa-traza.service';

/**
 * Recorrido del grafo óptico, del abonado a la cabecera.
 *
 * Lo que se prueba aquí no es el cálculo —eso vive en `presupuesto-optico.spec`— sino la
 * NAVEGACIÓN: que el camino avance por fusiones y splitters, que termine, y sobre todo que
 * una traza rota diga DÓNDE se rompe. Ese mensaje es el entregable real para el operador:
 * le señala qué empalme falta documentar.
 */
describe('PlantaExternaTrazaService', () => {
  let service: PlantaExternaTrazaService;
  let query: jest.Mock;

  const EMPRESA = 'emp-1';
  const CONTRATO = 'cnt-1';

  /** Planta mínima: cliente → NAP con 1x8 → cable de distribución → mufa → troncal → site. */
  function grafoBase() {
    return {
      segmentos: new Map<string, any>([
        ['seg-dist', {
          id: 'seg-dist', codigo: 'DIST-01', longitud_m: 500, atenuacion_db_km: 0.35,
          destino_mufa_id: 'mufa-1', origen_nap_id: 'nap-1',
        }],
        ['seg-tron', {
          id: 'seg-tron', codigo: 'TR-01', longitud_m: 2000, atenuacion_db_km: 0.35,
          origen_site_id: 'site-1', destino_mufa_id: 'mufa-1',
        }],
      ]),
      hilos: new Map<string, any>([
        ['hilo-d1', { id: 'hilo-d1', numero: 1, segmento_id: 'seg-dist' }],
        ['hilo-t1', { id: 'hilo-t1', numero: 1, segmento_id: 'seg-tron' }],
      ]),
      fusiones: [
        { id: 'f1', mufa_id: 'mufa-1', hilo_a_id: 'hilo-d1', hilo_b_id: 'hilo-t1', perdida_db: 0.1 },
      ],
      splitters: new Map<string, any>([
        ['spl-1', {
          id: 'spl-1', relacion: '1x8', perdida_db: 10.5,
          alojado_en_nap_id: 'nap-1', hilo_entrada_id: 'hilo-d1',
        }],
      ]),
      salidas: new Map<string, any>([['sal-1', { id: 'sal-1', splitter_id: 'spl-1', numero: 1 }]]),
      naps:    new Map<string, any>([['nap-1', { id: 'nap-1', codigo: 'NAP-01' }]]),
      mufas:   new Map<string, any>([['mufa-1', { id: 'mufa-1', codigo: 'MUFA-01' }]]),
      puertos: new Map<string, any>([
        ['pto-1', { id: 'pto-1', nap_id: 'nap-1', numero: 3, splitter_salida_id: 'sal-1' }],
      ]),
    };
  }

  beforeEach(async () => {
    // Sólo la acometida se consulta por SQL; el resto llega precargado en el grafo.
    query = jest.fn().mockResolvedValue([
      { id: 'aco-1', contrato_id: CONTRATO, nap_puerto_id: 'pto-1' },
    ]);

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        PlantaExternaTrazaService,
        { provide: getDataSourceToken(), useValue: { query } },
      ],
    }).compile();

    service = mod.get(PlantaExternaTrazaService);
  });

  const trazar = (grafo: any, rx?: number | null) =>
    service.trazarContrato(EMPRESA, CONTRATO, rx, grafo);

  // ───────────────────────────────────────────────────────────────
  describe('camino completo', () => {

    it('llega desde el cliente hasta la cabecera', async () => {
      const r = await trazar(grafoBase());

      expect(r.completa).toBe(true);
      expect(r.pasos.map((p) => p.tipo)).toEqual([
        'acometida', 'nap', 'splitter', 'fibra', 'mufa', 'fusion', 'fibra', 'site',
      ]);
    });

    it('acumula las pérdidas de todo el camino', async () => {
      const r = await trazar(grafoBase());
      if (!r.completa) throw new Error('debía completar');

      // 2 conectores (0.6) + splitter 1x8 (10.5) + 500 m (0.175) + fusión (0.1) + 2 km (0.7)
      expect(r.presupuesto.perdidaTotalDb).toBeCloseTo(12.08, 1);
      expect(r.presupuesto.dentroDePresupuesto).toBe(true);
    });

    it('contrasta con la lectura de la ONU cuando existe', async () => {
      // La planta de prueba pierde 12.08 dB, así que con TX +3 dBm la ONU debería leer
      // ≈ −9.1 dBm. Es alto para un enlace real —ahí habría un segundo nivel de splitteo
      // que aquí no existe— pero es la aritmética correcta de ESTA topología.
      const r = await trazar(grafoBase(), -9.1);
      if (!r.completa) throw new Error('debía completar');
      expect(r.veredicto.clase).toBe('coherente');
    });

    it('una ONU muy por debajo de lo calculado se marca como anomalía', async () => {
      // −22 dBm con sólo 12 dB de pérdida documentada: sobran ~13 dB sin explicar. Es
      // justo el hallazgo que este módulo existe para producir —fusión sucia, curvatura o
      // conector— y que antes sólo se descubría enviando a alguien al poste.
      const r = await trazar(grafoBase(), -22.0);
      if (!r.completa) throw new Error('debía completar');
      expect(r.veredicto.clase).toBe('anomalia');
      expect(r.veredicto.mensaje).toContain('MENOS');
    });

    it('sin lectura de la ONU el veredicto lo dice, no lo da por bueno', async () => {
      const r = await trazar(grafoBase(), null);
      if (!r.completa) throw new Error('debía completar');
      expect(r.veredicto.clase).toBe('sin_medicion');
    });
  });

  // ───────────────────────────────────────────────────────────────
  describe('una traza rota dice DÓNDE se rompe', () => {
    // Es el entregable real para el operador: no "no se pudo trazar", sino qué empalme
    // falta documentar. Sin eso, la funcionalidad no sirve para trabajar.

    it('contrato sin acometida', async () => {
      query.mockResolvedValue([]);
      const r = await trazar(grafoBase());
      expect(r.completa).toBe(false);
      if (r.completa) throw new Error('no debía completar');
      expect(r.motivo).toContain('no tiene acometida');
    });

    it('puerto sin splitter detrás: nombra la caja y el puerto', async () => {
      const g = grafoBase();
      g.puertos.set('pto-1', { id: 'pto-1', nap_id: 'nap-1', numero: 3, splitter_salida_id: null });

      const r = await trazar(g);
      expect(r.completa).toBe(false);
      if (r.completa) throw new Error('no debía completar');
      expect(r.motivo).toContain('NAP-01');
      expect(r.motivo).toContain('3');
    });

    it('hilo que llega a una mufa SIN fusionar: nombra la mufa y el hilo', async () => {
      const g = grafoBase();
      g.fusiones = []; // nadie documentó el empalme

      const r = await trazar(g);
      expect(r.completa).toBe(false);
      if (r.completa) throw new Error('no debía completar');
      expect(r.motivo).toContain('MUFA-01');
      expect(r.motivo).toContain('no está fusionado');
      // Conserva lo recorrido hasta el corte: el operador ve hasta dónde llegó.
      expect(r.pasos.some((p) => p.tipo === 'mufa')).toBe(true);
    });

    it('splitter sin hilo de entrada declarado', async () => {
      const g = grafoBase();
      g.splitters.set('spl-1', { ...g.splitters.get('spl-1'), hilo_entrada_id: null });

      const r = await trazar(g);
      expect(r.completa).toBe(false);
      if (r.completa) throw new Error('no debía completar');
      expect(r.motivo).toContain('hilo de entrada');
    });
  });

  // ───────────────────────────────────────────────────────────────
  describe('el recorrido siempre termina', () => {

    it('un ciclo de fusiones se detecta y no cuelga el backend', async () => {
      // Una matriz mal documentada puede cerrar un lazo. Sin detección, el bucle agotaría
      // el tope de saltos; con ella se corta en el primer reencuentro y se explica.
      const g = grafoBase();
      g.segmentos.set('seg-tron', {
        id: 'seg-tron', codigo: 'TR-01', longitud_m: 2000, atenuacion_db_km: 0.35,
        destino_mufa_id: 'mufa-1', origen_mufa_id: 'mufa-1', // vuelve a la misma mufa
      });
      g.fusiones = [
        { id: 'f1', mufa_id: 'mufa-1', hilo_a_id: 'hilo-d1', hilo_b_id: 'hilo-t1', perdida_db: 0.1 },
        { id: 'f2', mufa_id: 'mufa-1', hilo_a_id: 'hilo-t1', hilo_b_id: 'hilo-d1', perdida_db: 0.1 },
      ];

      const r = await trazar(g);
      expect(r.completa).toBe(false);
      if (r.completa) throw new Error('no debía completar');
      expect(r.motivo).toContain('ciclo');
    });

    it('termina aunque el grafo esté corrupto: nunca se cuelga', async () => {
      const g = grafoBase();
      g.hilos.delete('hilo-t1'); // la fusión apunta a un hilo que no existe

      const r = await trazar(g);
      expect(r.completa).toBe(false);
      if (r.completa) throw new Error('no debía completar');
      expect(r.motivo).toBeTruthy();
    });
  });
});
