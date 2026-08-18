import { UnprocessableEntityException } from '@nestjs/common';
import { PromesasPagoService } from './promesas-pago.service';
import { EstadoPromesa } from './entities/promesa-pago.entity';

// Guarda "no cortar a quien no debe nada", en el cron de prórrogas vencidas.
//
// Incidente 2026-08-04, reproducido en producción con CNT-2026-000007 (James Pena):
// con facturas consolidadas —el diseño normal cuando un cliente tiene varios servicios—
// el pago no cancelaba la promesa, porque resolvía el contrato como `null` y se saltaba
// la rama. Resultado: factura pagada, saldo cero, promesa viva, IP en `prorroga_datafast`
// y este cron cortando el servicio días después a alguien que ya había pagado.
//
// El camino del pago está corregido, pero cortar a un cliente al día es el peor error que
// puede cometer este cron, así que la comprobación se hace también AQUÍ, en el momento de
// actuar, en vez de confiar en que alguien cerró la promesa al cobrar.

describe('PromesasPagoService — guarda antes de cortar por prórroga vencida', () => {
  const promesa = {
    id: 'promesa-1',
    servicioId: 'contrato-1',
    estado: EstadoPromesa.ACTIVA,
    ipClienteSnapshot: '172.16.201.3',
    routerIdSnapshot:  'router-1',
    usuarioPppoeSnapshot: 'tumbes',
  } as never;

  /** Servicio con lo mínimo que toca `ejecutarCorte`. */
  function crear(deuda: string | Error) {
    const query = jest.fn().mockImplementation(() =>
      deuda instanceof Error ? Promise.reject(deuda) : Promise.resolve([{ deuda }]),
    );
    const repo = {
      update:    jest.fn().mockResolvedValue(undefined),
      findOne:   jest.fn().mockResolvedValue(null),
      increment: jest.fn().mockResolvedValue(undefined),
    };
    const firewallSvc = { suspenderCliente: jest.fn().mockResolvedValue({ clase: 'aplicado', mensaje: 'ok' }) };

    const svc = new PromesasPagoService(
      repo as never,
      { query } as never,
      firewallSvc as never,
      {
        setEstado:         jest.fn().mockResolvedValue({ clase: 'aplicado', mensaje: 'ok' }),
        desconectarSesion: jest.fn().mockResolvedValue({ clase: 'aplicado', mensaje: 'ok' }),
      } as never,
      {
        encolar:                jest.fn().mockResolvedValue(undefined),
        encolarRevocarProrroga: jest.fn().mockResolvedValue(undefined),
      } as never,
      { emit: jest.fn() } as never,
      // FacturaRepository -- solo lo usa crear() (Ola 2, Paso B); ejecutarCorte() no lo toca.
      { contratoDe: jest.fn() } as never,
    );

    // `ejecutarCorte` es privado: se invoca por su nombre porque lo que se prueba es
    // justamente su decisión, no el scheduler que lo llama.
    const ejecutarCorte = (svc as unknown as {
      ejecutarCorte: (p: unknown) => Promise<void>;
    }).ejecutarCorte.bind(svc);

    return { ejecutarCorte, repo, firewallSvc, query };
  }

  it('NO corta si el cliente ya no debe nada (incidente 04/08)', async () => {
    const { ejecutarCorte, repo, firewallSvc } = crear('0');

    await ejecutarCorte(promesa);

    // Ni se toca el router ni se marca la promesa como vencida: se cierra por cumplida.
    expect(firewallSvc.suspenderCliente).not.toHaveBeenCalled();
    expect(repo.update).not.toHaveBeenCalledWith(
      'promesa-1', { estado: EstadoPromesa.VENCIDA_PENDIENTE },
    );
  });

  it('corta si la deuda sigue viva', async () => {
    const { ejecutarCorte, repo } = crear('64.00');

    await ejecutarCorte(promesa);

    // El corte arranca marcando VENCIDA_PENDIENTE antes de tocar el router: si el proceso
    // muere a mitad, el scheduler lo retoma.
    expect(repo.update).toHaveBeenCalledWith(
      'promesa-1', { estado: EstadoPromesa.VENCIDA_PENDIENTE },
    );
  });

  it('ante un fallo al comprobar la deuda, aplaza el corte en vez de arriesgarlo', async () => {
    // No saber cuánto debe no es lo mismo que saber que debe. Un corte indebido se paga en
    // reputación y en llamadas; uno que llega un tick tarde, no.
    const { ejecutarCorte, repo, firewallSvc } = crear(new Error('conexión perdida'));

    await ejecutarCorte(promesa);

    expect(firewallSvc.suspenderCliente).not.toHaveBeenCalled();
    expect(repo.update).not.toHaveBeenCalled();
  });
});

// Regla del propietario (2026-08-18): el invariante "una fila de dinero no nace con el
// acuerdo a medias" se mudó de la migración (Paso A) a tiempo de escritura. A diferencia
// de un pago de caja, otorgar una promesa es un flujo controlado (un operador lo hace a
// propósito) y SÍ puede rechazarse.
describe('PromesasPagoService.crear() — rechaza si el servicio no tiene acuerdo', () => {
  it('un servicio que no cuelga de ningún acuerdo no crea la promesa en silencio', async () => {
    const contratoRow = {
      id: 'svc-001', empresa_id: 'emp-001', cliente_id: 'cli-001', estado: 'activo',
      ip_asignada: '172.16.201.3', router_id: 'router-1', usuario_pppoe: 'tumbes',
      deuda_total: '85.00', en_prorroga: false,
      nombre_cliente: 'Cliente Test', whatsapp: null, telefono: '999999999',
    };
    const query = jest.fn().mockResolvedValue([contratoRow]);
    const transaction = jest.fn();
    const repo = { findOne: jest.fn().mockResolvedValue(null) };
    const facturaRepo = { contratoDe: jest.fn().mockResolvedValue(null) };

    const svc = new PromesasPagoService(
      repo as never,
      { query, transaction } as never,
      {} as never,
      {} as never,
      { encolar: jest.fn(), encolarAplicarProrroga: jest.fn() } as never,
      { emit: jest.fn() } as never,
      facturaRepo as never,
    );

    const futuro = new Date(); futuro.setDate(futuro.getDate() + 5);
    const dto = { servicioId: 'svc-001', fechaVencimiento: futuro.toISOString().split('T')[0] };
    const user = { sub: 'usr-001', empresaId: 'emp-001' };

    await expect(svc.crear(dto as never, user as never))
      .rejects.toThrow(UnprocessableEntityException);

    // Ninguna promesa se creó a medias: el rechazo ocurre ANTES de la transacción.
    expect(transaction).not.toHaveBeenCalled();
  });
});
