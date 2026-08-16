import { GatewayMensajeriaService } from './gateway-mensajeria.service';

// Ola 1 (2026-08-16) — conversión de `despachar()` a `ResultadoOperacion`.
// Grupo 2: su consumidor más lejano es un worker de cola (MensajeriaWorker,
// CampanasWorker) — un orquestador automático, aunque también lo llame
// `SistemaService.reenviarNotifLog()` (humano). El criterio es el consumidor más
// lejano (F-0.1 §9.1), no el más cercano.
//
// Origen (D-14, E-0.3 §10): `despachar()` nunca lanzaba — cualquier fallo, permanente
// o transitorio, volvía como `{enviado:false}` y los workers solo logueaban. El
// `attempts:3` + backoff que BullMQ ya tiene configurado (workers.constants.ts,
// gateway-monitor.service.ts) llevaba tanto tiempo sin ejecutarse como el código que
// dice proteger. Estos tests fijan la clasificación de cada rama, no solo que no lanza.
describe('GatewayMensajeriaService.despachar() — clasificación por rama', () => {
  const hacer = (over: Record<string, unknown> = {}) => {
    const svc = Object.create(GatewayMensajeriaService.prototype) as any;
    svc.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    svc.ds = { query: jest.fn(async () => [{ id: 'log-1' }]) };
    svc.eventos = { registrar: jest.fn() };
    svc.resolveDestino = jest.fn(async () => '51999999999');
    svc.resolveConfig  = jest.fn(async () => ({
      proveedor: 'AUTOMATIZADO_VIP',
      activo: true,
      activoMap: { AUTOMATIZADO_VIP: true, CUSTOM_API: true, DATAFAST_MENSAJERIA_MASIVA: false, SMTP: false },
    }));
    svc.tryEnvio = jest.fn(async () => ({ resultado: { enviado: true, messageId: 'm-1' }, definitivo: false }));
    Object.assign(svc, over);
    return svc;
  };

  const params = { telefono: '51999999999', tipo: 'bienvenida', variables: {}, empresaId: 'e-1', logId: 'log-1' };

  it('rechazado_definitivo: sin número de destino', async () => {
    const svc = hacer({ resolveDestino: jest.fn(async () => '') });
    const r = await svc.despachar(params);
    expect(r.clase).toBe('rechazado_definitivo');
    expect(r.motivo).toMatch(/destino/);
  });

  it('rechazado_definitivo: sin configuración de mensajería activa', async () => {
    const svc = hacer({ resolveConfig: jest.fn(async () => null) });
    const r = await svc.despachar(params);
    expect(r.clase).toBe('rechazado_definitivo');
    expect(r.motivo).toMatch(/configuración/);
  });

  it('rechazado_definitivo: servicio de mensajería desactivado por el operador', async () => {
    const svc = hacer({ resolveConfig: jest.fn(async () => ({ proveedor: 'AUTOMATIZADO_VIP', activo: false, activoMap: {} })) });
    const r = await svc.despachar(params);
    expect(r.clase).toBe('rechazado_definitivo');
    expect(r.motivo).toMatch(/inactivo/);
  });

  it('rechazado_definitivo: el proveedor rechazó por configuración/contenido (definitivo:true)', async () => {
    const svc = hacer({
      tryEnvio: jest.fn(async () => ({ resultado: { enviado: false, error: 'Sin plantilla' }, definitivo: true })),
    });
    const r = await svc.despachar(params);
    expect(r.clase).toBe('rechazado_definitivo');
    expect(r.motivo).toMatch(/Sin plantilla/);
  });

  it('reintentable: fallo transitorio sin fallback disponible', async () => {
    const svc = hacer({
      resolveConfig: jest.fn(async () => ({
        proveedor: 'AUTOMATIZADO_VIP', activo: true,
        activoMap: { AUTOMATIZADO_VIP: true, CUSTOM_API: false, DATAFAST_MENSAJERIA_MASIVA: false, SMTP: false },
      })),
      tryEnvio: jest.fn(async () => ({ resultado: { enviado: false, error: 'timeout del proveedor' }, definitivo: false })),
    });
    const r = await svc.despachar(params);
    expect(r.clase).toBe('reintentable');
  });

  it('aplicado: el primario entrega el mensaje', async () => {
    const svc = hacer();
    const r = await svc.despachar(params);
    expect(r.clase).toBe('aplicado');
  });

  // Caso nombrado del hallazgo: circuit breaker OPEN es TRANSITORIO, no un rechazo de
  // configuración — antes bloqueaba el intento de fallback (`noEnviado:true`); ahora
  // (`definitivo:false`) el fallback SÍ se intenta y puede tener éxito.
  it('aplicado vía fallback: primario con circuit breaker OPEN (definitivo:false) — el fallback se intenta y entrega', async () => {
    const tryEnvio = jest
      .fn()
      .mockResolvedValueOnce({ resultado: { enviado: false, error: 'Circuit breaker OPEN: AUTOMATIZADO_VIP' }, definitivo: false })
      .mockResolvedValueOnce({ resultado: { enviado: true, messageId: 'm-fb' }, definitivo: false });
    const svc = hacer({ tryEnvio });
    const r = await svc.despachar(params);
    expect(tryEnvio).toHaveBeenCalledTimes(2);
    expect(r.clase).toBe('aplicado');
  });

  // El caso malo (PC-04): un error inesperado (BD caída al resolver destino, por ejemplo)
  // no debe tumbar el worker — `clasificarError` decide, no una excepción sin capturar.
  it('el error inesperado no lanza: cae en clasificarError vía el catch', async () => {
    const svc = hacer({ resolveConfig: jest.fn(async () => { throw new Error('BD caída'); }) });
    await expect(svc.despachar(params)).resolves.toHaveProperty('clase');
  });
});
