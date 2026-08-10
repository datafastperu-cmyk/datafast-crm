import { diasEntregados, diasFacturables, cargoDelPeriodo } from './prorrateo';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const t = (iso: string, estadoNuevo: string) => ({ fecha: d(iso), estadoNuevo });

/**
 * H-6 — «el tramo entregado hasta el corte no se factura nunca» (2026-08-09).
 *
 * La generación filtraba `co.estado = 'activo'`, así que un contrato suspendido no entraba y con
 * él se perdía el tramo del ciclo que SÍ se le había entregado antes del corte. No se recuperaba
 * después: el comprobante siguiente ya cubría el mes siguiente.
 *
 * El escenario que lo destapó es el que planteó el propietario: emisión 23/08, vence 30/08, cinco
 * días de gracia, prórroga hasta el 07/09, se suspende el 07/09 y paga el 25/09.
 */
describe('H-6 · Días entregados en el ciclo (2026-08-09)', () => {
  // Ciclo postpago de un abonado con anclaje 30: del día siguiente a su fecha de pago hasta la
  // siguiente. 31 días.
  const INICIO = d('2026-08-31');
  const FIN    = d('2026-09-30');

  it('el ciclo del escenario dura 31 días', () => {
    expect(diasFacturables(INICIO, FIN)).toBe(31);
  });

  it('suspendido el 07/09: son 8 días entregados, y el día del corte cuenta', () => {
    // Del 31/08 al 07/09 ambos incluidos. El 07 cuenta porque hubo servicio hasta que se cortó.
    expect(diasEntregados('activo', [t('2026-09-07', 'suspendido')], INICIO, FIN)).toBe(8);
  });

  it('esos 8 días son S/ 17,07 de una mensualidad de S/ 64 — antes eran S/ 0', () => {
    const dias = diasEntregados('activo', [t('2026-09-07', 'suspendido')], INICIO, FIN);
    // Base ACTUAL_360 (PD-14): 64 × 8 / 30.
    expect(cargoDelPeriodo(64, 31, dias).importe).toBe(17.07);
  });

  it('activo todo el ciclo: 31 días, y eso es cargo COMPLETO, no prorrateado', () => {
    const dias = diasEntregados('activo', [], INICIO, FIN);
    expect(dias).toBe(31);
    expect(cargoDelPeriodo(64, 31, dias).tipo).toBe('completo');
  });

  it('suspendido desde antes del ciclo y sin volver: cero días, no se emite nada', () => {
    expect(diasEntregados('suspendido', [], INICIO, FIN)).toBe(0);
  });

  it('reactivado a mitad de ciclo: cuenta desde el día de la reactivación, incluido', () => {
    // Del 25/09 al 30/09 ambos incluidos = 6.
    expect(diasEntregados('suspendido', [t('2026-09-25', 'activo')], INICIO, FIN)).toBe(6);
  });

  it('suspendido y reactivado dentro del mismo ciclo: suma los dos tramos', () => {
    // [31/08–07/09] = 8  +  [25/09–30/09] = 6.
    const dias = diasEntregados(
      'activo',
      [t('2026-09-07', 'suspendido'), t('2026-09-25', 'activo')],
      INICIO, FIN,
    );
    expect(dias).toBe(14);
  });

  it('suspender y reactivar el MISMO día cuenta ese día una vez, no cero', () => {
    // Hubo servicio parte del día. Contarlo cero sería regalar un día por una operación
    // administrativa; contarlo dos veces, cobrarlo dos veces.
    const dias = diasEntregados(
      'activo',
      [t('2026-09-07', 'suspendido'), t('2026-09-07', 'activo')],
      INICIO, FIN,
    );
    expect(dias).toBe(31);
  });

  it('un contrato que nace a mitad de ciclo solo cuenta desde su activación', () => {
    // Sin historial previo se parte de un estado sin servicio: es el alta.
    const dias = diasEntregados(
      'pendiente_activacion',
      [t('2026-09-20', 'activo')],
      INICIO, FIN,
    );
    expect(dias).toBe(11); // 20 a 30 inclusive
  });

  it('el último estado se extiende hasta el fin del ciclo — el postpago se emite ANTES de que acabe', () => {
    // Emitiendo el 23/09 un ciclo que cierra el 30/09, un abonado activo debe pagar los 31 días,
    // no los 24 transcurridos. Si cambia después, lo recoge el ciclo siguiente.
    expect(diasEntregados('activo', [], INICIO, FIN)).toBe(31);
  });

  it('baja definitiva a mitad de ciclo: se cobra lo entregado hasta ese día', () => {
    // Esto es la liquidación final del tramo, y sale de la misma regla sin código aparte.
    expect(diasEntregados('activo', [t('2026-09-10', 'baja_definitiva')], INICIO, FIN)).toBe(11);
  });

  it('febrero: el ciclo es más corto y el conteo lo respeta', () => {
    // Anclaje 30 recortado: [31/01 → 28/02] son 29 días.
    expect(diasFacturables(d('2026-01-31'), d('2026-02-28'))).toBe(29);
    expect(diasEntregados('activo', [t('2026-02-10', 'suspendido')], d('2026-01-31'), d('2026-02-28')))
      .toBe(11);
  });
});
