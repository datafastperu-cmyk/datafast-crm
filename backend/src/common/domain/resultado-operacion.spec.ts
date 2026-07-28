import {
  BadRequestException,
  NotFoundException,
  ConflictException,
  ServiceUnavailableException,
  RequestTimeoutException,
} from '@nestjs/common';
import { clasificarError, esExito, traducirAHttp } from './resultado-operacion';

// Estos casos son incidentes reales, no hipótesis. Cada uno costó tiempo de producción:
// el criterio de reintentabilidad se equivocó dos veces seguidas (24/07 y 28/07) y ambas
// veces la causa fue inferir la intención del dominio desde el transporte.
describe('clasificarError', () => {
  it('409 de lock de operación es REINTENTABLE, no un veredicto', () => {
    // Incidente 28/07: el 409 de FtthOperacionLockService se leyó como rechazo
    // definitivo y descartó un DESAPROVISIONAR_ONU que sí debía aplicarse.
    const r = clasificarError(
      new ConflictException('Ya hay una desaprovisión en curso para este contrato.'),
    );
    expect(r.clase).toBe('reintentable');
  });

  it('transición no permitida (400) es RECHAZO DEFINITIVO', () => {
    // Incidente 24/07: reintentar esto 1784 veces no cambió nunca el resultado.
    const r = clasificarError(
      new BadRequestException('Solo se puede suspender desde el estado "activo".'),
    );
    expect(r.clase).toBe('rechazado_definitivo');
  });

  it('recurso inexistente (404) es RECHAZO DEFINITIVO', () => {
    expect(clasificarError(new NotFoundException('No hay registro FTTH')).clase)
      .toBe('rechazado_definitivo');
  });

  it('timeout contra el hardware es INDETERMINADO, nunca simple reintentable', () => {
    // Directriz: un timeout NO significa "no pasó nada" — la operación pudo aplicarse
    // y solo tardar más que el límite del cliente (incidente 22/07).
    const r = clasificarError(
      new ServiceUnavailableException(
        'La operación en la OLT excedió el tiempo de espera del cliente (timeout of 150000ms exceeded).',
      ),
    );
    expect(r.clase).toBe('indeterminado');
  });

  it('el timeout gana sobre el status: un 408 tampoco es rechazo definitivo', () => {
    expect(clasificarError(new RequestTimeoutException('timeout')).clase).toBe('indeterminado');
  });

  it('microservicio caído (503 sin timeout) es REINTENTABLE', () => {
    const r = clasificarError(new ServiceUnavailableException('Microservicio OLT no alcanzable'));
    expect(r.clase).toBe('reintentable');
  });

  it('ante la duda, reintentable: descartar no es recuperable', () => {
    expect(clasificarError(new Error('ECONNRESET')).clase).toBe('reintentable');
    expect(clasificarError('algo raro').clase).toBe('reintentable');
  });
});

describe('esExito', () => {
  it('un no-op idempotente cuenta como éxito', () => {
    // Reejecutar una compensación ya aplicada es ÉXITO (directriz de wizards, punto 8).
    expect(esExito({ clase: 'ya_en_destino', mensaje: 'ya estaba suspendida' })).toBe(true);
    expect(esExito({ clase: 'no_aplica',     mensaje: 'sin ONU FTTH' })).toBe(true);
    expect(esExito({ clase: 'aplicado',      mensaje: 'ok' })).toBe(true);
  });

  it('indeterminado NO es éxito: no hay evidencia de materialización', () => {
    expect(esExito({ clase: 'indeterminado',        motivo: 'timeout' })).toBe(false);
    expect(esExito({ clase: 'rechazado_definitivo', motivo: 'estado inválido' })).toBe(false);
    expect(esExito({ clase: 'reintentable',         motivo: 'OLT caída' })).toBe(false);
  });
});

describe('traducirAHttp', () => {
  it('un rechazo definitivo llega al operador como 400 con su motivo', () => {
    expect(() => traducirAHttp({ clase: 'rechazado_definitivo', motivo: 'estado inválido' }))
      .toThrow(BadRequestException);
  });

  it('indeterminado NO se reporta como fallo: se reporta como "aceptado, sin confirmar"', () => {
    // Reportarlo como error invita a reintentar algo que quizá ya se aplicó.
    const r = traducirAHttp({ clase: 'indeterminado', motivo: 'timeout of 150000ms' });
    expect(r.exitoso).toBe(false);
    expect(r.clase).toBe('indeterminado');
    expect(r.mensaje).toMatch(/SIN CONFIRMAR/);
  });

  it('el no-op idempotente se reporta como éxito al operador', () => {
    const r = traducirAHttp({ clase: 'ya_en_destino', mensaje: 'ya estaba suspendida' });
    expect(r.exitoso).toBe(true);
  });
});
