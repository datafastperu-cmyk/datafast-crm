import {
  perdidaFibra, consolidar, contrastarConMedicion,
  PERDIDA_CONECTOR_DB, CONECTORES_POR_ENLACE, SENSIBILIDAD_ONU_DBM, POTENCIA_TX_OLT_DBM,
  DESVIACION_ALERTA_DB, type ComponentePerdida,
} from './presupuesto-optico';

/**
 * Presupuesto óptico.
 *
 * Es lo que convierte la planta documentada en diagnóstico: con la pérdida TEÓRICA del
 * camino se contrasta la potencia REAL de la ONU y se detecta una fusión sucia o un
 * conector mal pulido sin subir a un poste.
 *
 * Cálculo puro y determinista a propósito: no toca la BD ni el hardware, así que se puede
 * probar entero sin una OLT delante.
 */
describe('presupuesto óptico', () => {

  describe('pérdida de fibra', () => {
    it('1 km a 0.35 dB/km pierde 0.35 dB', () => {
      expect(perdidaFibra(1000, 0.35)).toBeCloseTo(0.35, 3);
    });

    it('la atenuación es POR KILÓMETRO, no por metro', () => {
      // Confundir la unidad daría 350 dB en un tramo de 1 km — mil veces el presupuesto
      // disponible de todo el enlace. Es el error que este test existe para atrapar.
      expect(perdidaFibra(1000, 0.35)).toBeLessThan(1);
    });

    it('un tramo de 0 m no pierde nada', () => {
      expect(perdidaFibra(0, 0.35)).toBe(0);
    });
  });

  describe('consolidación', () => {
    const enlaceTipico: ComponentePerdida[] = [
      { tipo: 'conector', descripcion: '2 conectores', perdidaDb: CONECTORES_POR_ENLACE * PERDIDA_CONECTOR_DB },
      { tipo: 'fibra',    descripcion: 'troncal 2 km',  perdidaDb: 0.70 },
      { tipo: 'fusion',   descripcion: 'mufa 1',        perdidaDb: 0.10 },
      { tipo: 'fibra',    descripcion: 'distribución',  perdidaDb: 0.18 },
      { tipo: 'splitter', descripcion: '1x8',           perdidaDb: 10.50 },
    ];

    it('suma todas las pérdidas', () => {
      const p = consolidar(enlaceTipico);
      expect(p.perdidaTotalDb).toBeCloseTo(12.08, 2);
    });

    it('la potencia esperada es TX de la OLT menos las pérdidas', () => {
      const p = consolidar(enlaceTipico);
      expect(p.potenciaEsperadaDbm).toBeCloseTo(POTENCIA_TX_OLT_DBM - p.perdidaTotalDb, 2);
    });

    it('un enlace típico con un 1x8 entra holgado en presupuesto', () => {
      // Es el caso normal de la planta: si esto no entrara, el diseño de red estaría mal.
      const p = consolidar(enlaceTipico);
      expect(p.dentroDePresupuesto).toBe(true);
      expect(p.margenRestanteDb).toBeGreaterThan(0);
    });

    it('dos splitters 1x16 en cascada NO entran: el margen se agota', () => {
      // Caso real de mal diseño. El presupuesto lo delata antes de tender un metro de
      // fibra, que es justamente para lo que sirve calcularlo.
      const p = consolidar([
        { tipo: 'splitter', descripcion: '1x16', perdidaDb: 13.5 },
        { tipo: 'splitter', descripcion: '1x16', perdidaDb: 13.5 },
        { tipo: 'fibra',    descripcion: '3 km', perdidaDb: 1.05 },
      ]);
      expect(p.dentroDePresupuesto).toBe(false);
      expect(p.margenRestanteDb).toBeLessThan(0);
    });

    it('el margen restante descuenta el de seguridad, no sólo las pérdidas', () => {
      // Sin margen, un enlace calculado "justo" nace condenado: no deja nada para
      // envejecimiento de la fibra ni para el empalme de la próxima reparación.
      const disponible = POTENCIA_TX_OLT_DBM - SENSIBILIDAD_ONU_DBM;
      const p = consolidar([{ tipo: 'fibra', descripcion: 'x', perdidaDb: disponible }]);
      expect(p.margenRestanteDb).toBeLessThan(0);
    });

    it('sin componentes no lanza', () => {
      expect(() => consolidar([])).not.toThrow();
      expect(consolidar([]).perdidaTotalDb).toBe(0);
    });
  });

  describe('contraste con la medición real', () => {
    const ESPERADA = -22.0;

    it('sin lectura óptica NO se reporta como correcto', () => {
      // Un contrato sin medición no valida nada. Darlo por bueno sería exactamente el
      // `success: true` sin comprobar que la regla VIO existe para impedir.
      const v = contrastarConMedicion(ESPERADA, null);
      expect(v.clase).toBe('sin_medicion');
    });

    it('una desviación pequeña es coherente: las tolerancias son reales', () => {
      // La potencia TX varía entre equipos, la atenuación declarada es nominal y las
      // longitudes se estiman. Alertar por 1 dB generaría ruido que nadie miraría.
      expect(contrastarConMedicion(ESPERADA, -22.5).clase).toBe('coherente');
      expect(contrastarConMedicion(ESPERADA, -20.0).clase).toBe('coherente');
    });

    it('recibir MENOS de lo calculado es anomalía y sugiere dónde mirar', () => {
      const v = contrastarConMedicion(ESPERADA, -28.0);
      expect(v.clase).toBe('anomalia');
      expect(v.mensaje).toContain('fusiones');
    });

    it('recibir MÁS de lo calculado también es anomalía, aunque suene bien', () => {
      // Significa que el camino documentado tiene más pérdidas de las que la fibra
      // realmente atraviesa: casi siempre, que el cliente NO está conectado por donde el
      // ERP dice. Es un hallazgo valioso, no una buena noticia.
      const v = contrastarConMedicion(ESPERADA, -15.0);
      expect(v.clase).toBe('anomalia');
      expect(v.mensaje).toContain('no es el real');
    });

    it('el umbral es simétrico', () => {
      const justo = DESVIACION_ALERTA_DB;
      expect(contrastarConMedicion(ESPERADA, ESPERADA + justo).clase).toBe('coherente');
      expect(contrastarConMedicion(ESPERADA, ESPERADA - justo).clase).toBe('coherente');
      expect(contrastarConMedicion(ESPERADA, ESPERADA + justo + 0.1).clase).toBe('anomalia');
    });

    it('una ONU por debajo de la sensibilidad se detecta como anomalía grave', () => {
      const v = contrastarConMedicion(ESPERADA, SENSIBILIDAD_ONU_DBM - 3);
      expect(v.clase).toBe('anomalia');
    });
  });
});
