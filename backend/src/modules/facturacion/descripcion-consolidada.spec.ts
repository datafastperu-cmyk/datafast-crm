import { FacturacionService } from './facturacion.service';

// El comprobante se emite a nombre del CLIENTE, no del contrato: un abonado con dos
// servicios recibe UNO solo. Es diseño, no un hueco — por eso `contrato_id` va en null.
//
// La contrapartida es que "Servicios contratados" no le dice al cliente por qué paga ese
// importe. Con dos servicios del mismo plan, ni siquiera puede distinguirlos. Estos casos
// fijan que la descripción identifique cada servicio por su CONTRATO y su IMPORTE, que es
// exactamente la pregunta que si no llega a soporte.

type Interno = {
  descripcionConsolidada(
    nombre: string,
    grupo: Array<{ numero_contrato?: string; plan_nombre?: string; precio?: string }>,
    mes: number, anio: number, simbolo?: string,
  ): string;
  descripcionItem(
    contrato: { numero_contrato?: string; plan_nombre?: string; direccion_instalacion?: string },
    mes: number, anio: number,
  ): string;
};

// Solo se ejercitan dos helpers puros: las dependencias no intervienen en ese camino.
const svc = new FacturacionService(
  {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
  {} as never,
) as unknown as Interno;

describe('Descripción del comprobante consolidado', () => {
  it('con UN servicio mantiene la forma corta e incluye el contrato', () => {
    const d = svc.descripcionConsolidada('BOLETA', [
      { numero_contrato: 'CNT-2026-000014', plan_nombre: 'Plan 300 Mbps', precio: '64.00' },
    ], 7, 2026);

    expect(d).toBe('BOLETA — Plan 300 Mbps (CNT-2026-000014) · Julio 2026');
  });

  it('con VARIOS servicios enumera contrato, plan e importe de cada uno', () => {
    const d = svc.descripcionConsolidada('BOLETA', [
      { numero_contrato: 'CNT-2026-000014', plan_nombre: 'Plan 300 Mbps', precio: '64.00' },
      { numero_contrato: 'CNT-2026-000020', plan_nombre: 'Plan 100 Mbps', precio: '35.50' },
    ], 7, 2026);

    expect(d).toContain('CNT-2026-000014: Plan 300 Mbps S/ 64.00');
    expect(d).toContain('CNT-2026-000020: Plan 100 Mbps S/ 35.50');
    // Lo que ya no puede pasar: un consolidado que no diga qué se está pagando.
    expect(d).not.toContain('Servicios contratados');
  });

  it('dos servicios del MISMO plan siguen siendo distinguibles', () => {
    const d = svc.descripcionConsolidada('BOLETA', [
      { numero_contrato: 'CNT-001', plan_nombre: 'Plan 100 Mbps', precio: '35.00' },
      { numero_contrato: 'CNT-002', plan_nombre: 'Plan 100 Mbps', precio: '35.00' },
    ], 7, 2026);

    expect(d).toContain('CNT-001');
    expect(d).toContain('CNT-002');
  });

  it('un contrato sin número no rompe la descripción', () => {
    const d = svc.descripcionConsolidada('RECIBO', [
      { plan_nombre: 'Plan 50 Mbps', precio: '25.00' },
      { numero_contrato: 'CNT-003', plan_nombre: 'Plan 100 Mbps', precio: '35.00' },
    ], 1, 2027);

    expect(d).toContain('Plan 50 Mbps S/ 25.00');
    expect(d).toContain('CNT-003: Plan 100 Mbps S/ 35.00');
  });

  it('la línea de detalle lleva plan, contrato y dirección', () => {
    const d = svc.descripcionItem({
      numero_contrato: 'CNT-2026-000014',
      plan_nombre: 'Plan 300 Mbps',
      direccion_instalacion: 'Av. Los Álamos 452',
    }, 7, 2026);

    expect(d).toBe('Plan 300 Mbps · Contrato CNT-2026-000014 · Av. Los Álamos 452 — Julio 2026');
  });

  it('la línea de detalle tolera que falten contrato y dirección', () => {
    expect(svc.descripcionItem({ plan_nombre: 'Plan 300 Mbps' }, 7, 2026))
      .toBe('Plan 300 Mbps — Julio 2026');
  });
});
