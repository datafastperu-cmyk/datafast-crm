import { ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { PortalPlanesService } from './portal-planes.service';

// Regla de negocio decidida con el operador (documento de arquitectura §3.6):
// la BAJADA de plan con deuda pendiente se permite SOLO en prepago.
//
// En prepago el abonado ya pagó el período en curso, así que bajar no deja saldo impago
// detrás. En postpago la deuda es servicio YA CONSUMIDO al precio del plan actual:
// permitir bajar antes de pagarla convertiría el portal en un mecanismo de descuento
// retroactivo unilateral.
//
// El guard vive en el backend, no en el botón deshabilitado de la UI: un cliente que
// llame la API directamente debe recibir el mismo rechazo.

const CLIENTE  = '11111111-1111-4111-8111-111111111111';
const EMPRESA  = '22222222-2222-4222-8222-222222222222';
const CONTRATO = '33333333-3333-4333-8333-333333333333';
const PLAN_CARO   = '44444444-4444-4444-8444-444444444444';
const PLAN_BARATO = '55555555-5555-4555-8555-555555555555';

interface EscenarioContrato {
  tipoPago: 'prepago' | 'postpago' | null;
  deuda: number;
}

function servicioCon({ tipoPago, deuda }: EscenarioContrato) {
  const query = jest.fn((sql: string) => {
    if (sql.includes('FROM contratos c')) {
      return Promise.resolve([{
        id: CONTRATO,
        plan_id: PLAN_CARO,
        plan_nombre: 'Plan 300 Mbps',
        precio_final: '120.00',
        precio_mensual: '120.00',
        tipo_pago: tipoPago,
        deuda_total: String(deuda),
        estado: 'activo',
      }]);
    }
    if (sql.includes('FROM planes') && sql.includes('visible_en_portal')) {
      return Promise.resolve([{ id: PLAN_BARATO, nombre: 'Plan 100 Mbps', precio: '60.00' }]);
    }
    // Sin solicitud pendiente.
    if (sql.includes('FROM portal_solicitud_plan')) return Promise.resolve([]);
    if (sql.includes('INSERT INTO portal_solicitud_plan')) {
      return Promise.resolve([{ id: 'sol-1', created_at: new Date().toISOString() }]);
    }
    return Promise.resolve([]);
  });

  return {
    svc: new PortalPlanesService({ query } as unknown as DataSource),
    query,
  };
}

describe('PortalPlanesService — bajada de plan con deuda', () => {
  it('PREPAGO con deuda: la bajada se permite (el período en curso ya está pagado)', async () => {
    const { svc } = servicioCon({ tipoPago: 'prepago', deuda: 150 });

    await expect(
      svc.solicitar(CLIENTE, EMPRESA, CONTRATO, PLAN_BARATO),
    ).resolves.toMatchObject({ estado: 'pendiente', planDestino: 'Plan 100 Mbps' });
  });

  it('POSTPAGO con deuda: la bajada se RECHAZA — sería un descuento retroactivo', async () => {
    const { svc } = servicioCon({ tipoPago: 'postpago', deuda: 150 });

    await expect(
      svc.solicitar(CLIENTE, EMPRESA, CONTRATO, PLAN_BARATO),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('POSTPAGO sin deuda: la bajada se permite', async () => {
    const { svc } = servicioCon({ tipoPago: 'postpago', deuda: 0 });

    await expect(
      svc.solicitar(CLIENTE, EMPRESA, CONTRATO, PLAN_BARATO),
    ).resolves.toMatchObject({ estado: 'pendiente' });
  });

  it('tipo_pago NULL se trata como postpago: ante la duda no se regala servicio', async () => {
    const { svc } = servicioCon({ tipoPago: null, deuda: 150 });

    await expect(
      svc.solicitar(CLIENTE, EMPRESA, CONTRATO, PLAN_BARATO),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('el rechazo NO se registra: no se inserta solicitud alguna', async () => {
    const { svc, query } = servicioCon({ tipoPago: 'postpago', deuda: 150 });

    await svc.solicitar(CLIENTE, EMPRESA, CONTRATO, PLAN_BARATO).catch(() => undefined);

    const inserts = query.mock.calls.filter(([sql]) =>
      String(sql).includes('INSERT INTO portal_solicitud_plan'),
    );
    expect(inserts).toHaveLength(0);
  });

  it('el catálogo explica el bloqueo en lenguaje del abonado, con el monto', async () => {
    const { svc } = servicioCon({ tipoPago: 'postpago', deuda: 150 });

    const { planes } = await svc.catalogo(CLIENTE, EMPRESA, CONTRATO);
    const barato = planes.find((p) => p.id === PLAN_BARATO);

    expect(barato?.bloqueo).toContain('150.00');
    expect(barato?.bloqueo).toMatch(/deuda/i);
  });
});

describe('PortalPlanesService — una solicitud a la vez', () => {
  it('con una solicitud en curso, el catálogo bloquea y solicitar de nuevo falla', async () => {
    const query = jest.fn((sql: string) => {
      if (sql.includes('FROM contratos c')) {
        return Promise.resolve([{
          id: CONTRATO, plan_id: PLAN_CARO, plan_nombre: 'Plan 300 Mbps',
          precio_final: '120.00', precio_mensual: '120.00',
          tipo_pago: 'prepago', deuda_total: '0', estado: 'activo',
        }]);
      }
      if (sql.includes('FROM planes') && sql.includes('visible_en_portal')) {
        return Promise.resolve([{ id: PLAN_BARATO, nombre: 'Plan 100 Mbps', precio: '60.00' }]);
      }
      if (sql.includes('FROM portal_solicitud_plan')) {
        return Promise.resolve([{
          id: 'sol-previa', estado: 'pendiente',
          precio_origen: '120.00', precio_destino: '60.00',
          nota_cliente: null, motivo_resolucion: null,
          created_at: new Date().toISOString(), resuelta_en: null,
          plan_origen: 'Plan 300 Mbps', plan_destino: 'Plan 100 Mbps',
        }]);
      }
      return Promise.resolve([]);
    });

    const svc = new PortalPlanesService({ query } as unknown as DataSource);

    await expect(
      svc.solicitar(CLIENTE, EMPRESA, CONTRATO, PLAN_BARATO),
    ).rejects.toBeInstanceOf(ConflictException);

    const { solicitudPendiente } = await svc.catalogo(CLIENTE, EMPRESA, CONTRATO);
    expect(solicitudPendiente?.estado).toBe('pendiente');
  });
});
