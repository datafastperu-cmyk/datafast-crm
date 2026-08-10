import { PoliticaFacturacionService, PoliticaFacturacion } from './politica-facturacion.service';
import { cargoDelPeriodo, diasFacturables } from './domain/prorrateo';

/**
 * H-9 — «el tramo del alta en prepago no lo factura nadie» (2026-08-09).
 *
 * Apareció al cerrar H-6, revisando qué eventos de prorrateo quedaban cableados. En postpago el
 * tramo del alta se cobra solo, porque su ciclo se emite por detrás y la generación cuenta los
 * días entregados. En prepago no: el comprobante del alta ampara el ciclo SIGUIENTE, y los días
 * que el abonado empieza a consumir el mismo día de la instalación pertenecen al ciclo en curso,
 * emitido cuando el abonado todavía no existía.
 */
describe('H-9 · El ciclo en curso y el tramo del alta (2026-08-09)', () => {
  const svc = new PoliticaFacturacionService(null as never);

  const BASE: PoliticaFacturacion = {
    tipo: 'prepago', diaPago: 30, diasAntesEmision: 5, diasGracia: 7,
    mesesVencidosParaCorte: 3, origen: 'cliente',
  };
  const ALTA = new Date(Date.UTC(2026, 7, 22)); // 22 de agosto

  describe('cicloEnCurso — el que se está usando, no el que se compra', () => {
    it('en prepago devuelve el ciclo EN CURSO, distinto del que ampara su comprobante', () => {
      // El comprobante del alta cubre el siguiente; el abonado está usando este.
      expect(svc.cicloEnCurso(BASE, ALTA)).toMatchObject({ inicio: '2026-07-31', fin: '2026-08-30' });
      expect(svc.periodoServicio(BASE, svc.proximoVencimiento(BASE, ALTA)))
        .toMatchObject({ inicio: '2026-08-31', fin: '2026-09-30' });
    });

    it('en postpago coincide con periodoServicio — postpago paga el que termina', () => {
      const post = { ...BASE, tipo: 'postpago' as const };
      expect(svc.cicloEnCurso(post, ALTA))
        .toEqual(svc.periodoServicio(post, svc.proximoVencimiento(post, ALTA)));
    });

    it('respeta el recorte a fin de mes', () => {
      // Anclaje 30 en febrero se materializa el 28.
      expect(svc.cicloEnCurso({ ...BASE, diaPago: 30 }, new Date(Date.UTC(2026, 1, 10))))
        .toMatchObject({ inicio: '2026-01-31', fin: '2026-02-28' });
    });
  });

  describe('el importe del tramo', () => {
    const tramo = (alta: Date, politica = BASE) => {
      const ciclo    = svc.cicloEnCurso(politica, alta);
      const inicio   = new Date(`${ciclo.inicio}T00:00:00.000Z`);
      const cierre   = new Date(`${ciclo.fin}T00:00:00.000Z`);
      const arranque = alta < inicio ? inicio : alta;
      return cargoDelPeriodo(80, diasFacturables(inicio, cierre), diasFacturables(arranque, cierre));
    };

    it('alta el 22/08 con anclaje 30: 9 días, S/ 24,00 — antes eran S/ 0', () => {
      const c = tramo(ALTA);
      expect(c.dias).toBe(9);          // 22 al 30 inclusive: el día de instalación cuenta
      expect(c.importe).toBe(24);      // 80 × 9 / 30
      expect(c.tipo).toBe('prorrateado');
    });

    it('activado el primer día del ciclo: NO es un tramo parcial, es el ciclo entero', () => {
      // Y también estaba sin cobrar: el comprobante del alta ampara el siguiente. Un mes entero.
      const c = tramo(new Date(Date.UTC(2026, 6, 31)));
      expect(c.tipo).toBe('completo');
      expect(c.importe).toBe(80);
    });

    it('activado el último día del ciclo: se cobra ese día', () => {
      expect(tramo(new Date(Date.UTC(2026, 7, 30))).dias).toBe(1);
    });

    it('nunca supera la mensualidad, sea cual sea el día del alta', () => {
      for (let dia = 31; dia <= 30 + 31; dia++) {
        const alta = new Date(Date.UTC(2026, 6, dia)); // recorre todo el ciclo
        const c = tramo(alta);
        expect(c.importe).toBeLessThanOrEqual(80);
      }
    });
  });
});
