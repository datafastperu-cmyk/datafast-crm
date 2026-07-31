jest.mock('whatsapp-web.js', () => ({ Client: class {}, LocalAuth: class {}, MessageMedia: {} }));
jest.mock('qrcode', () => ({ toDataURL: jest.fn() }));

// El cliente de WhatsApp vive en UN solo proceso (datafast-whatsapp, WA_ENABLED=true).
// Antes el host se derivaba de RUN_CRONS, así que acababa en el worker mientras el
// frontend hablaba con api-core: el operador tenía la pantalla del CRM delante y
// ninguna acción podía funcionar, porque le preguntaba al proceso equivocado.
// Estos tests fijan las dos mitades de esa garantía.
describe('WaClientService — quién aloja el cliente (WA_ENABLED)', () => {
  const ORIGINAL = process.env.WA_ENABLED;

  afterEach(() => {
    process.env.WA_ENABLED = ORIGINAL;
    jest.resetModules();
  });

  const cargarCon = (waEnabled?: string) => {
    if (waEnabled === undefined) delete process.env.WA_ENABLED;
    else process.env.WA_ENABLED = waEnabled;
    // CHROME_PATH se resuelve al cargar el módulo y en CI no hay navegador.
    process.env.WA_CHROME_PATH = '/usr/bin/google-chrome-stable';

    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { WaClientService } = require('./wa-client.service');

    const health  = { registrar: jest.fn() };
    const gateway = { emitStatus: jest.fn(), emitMensaje: jest.fn(), emitChats: jest.fn(), emitChatUpdate: jest.fn() };
    const svc = new WaClientService(
      {} as any,
      gateway as any,
      { snapshot: jest.fn(), setEstado: jest.fn(), estado: 'CONECTADO' } as any,
      health as any,
      { registrar: jest.fn() } as any,
    );
    return { svc, health };
  };

  it('un proceso sin WA_ENABLED no arranca Chromium ni opina sobre la salud del módulo', () => {
    const { svc, health } = cargarCon('false');

    svc.onModuleInit();

    // Registrar 'ok' aquí sería afirmar algo sobre un cliente que no corre en este proceso.
    expect(health.registrar).not.toHaveBeenCalled();
  });

  it('RUN_CRONS ya no decide el host: sin WA_ENABLED, el worker no aloja el cliente', () => {
    const cronsPrevio = process.env.RUN_CRONS;
    process.env.RUN_CRONS = 'true';
    try {
      const { svc, health } = cargarCon(undefined);
      svc.onModuleInit();
      expect(health.registrar).not.toHaveBeenCalled();
    } finally {
      process.env.RUN_CRONS = cronsPrevio;
    }
  });

  // El corte por QR dejaba el módulo inalcanzable: al arrancar el proceso se
  // gastaban los 15 QR contra una pantalla que nadie miraba, y cuando el operador
  // entraba ya estaba DESCONECTADO sin forma de pedir uno nuevo.
  it('vincular() rearma la ventana de QR tras un corte previo', async () => {
    const { svc } = cargarCon('true');
    const iniciar = jest.spyOn(svc as any, 'iniciarCliente').mockResolvedValue(undefined);
    (svc as any).state.estado = 'DESCONECTADO';
    (svc as any).client = { destroy: jest.fn().mockResolvedValue(undefined) };

    await (svc as any).detenerPorQrNoEscaneado();
    expect((svc as any).detenidoPorQr).toBe(true);

    const res = await svc.vincular();

    expect((svc as any).detenidoPorQr).toBe(false);
    expect((svc as any).qrSinEscanear).toBe(0);
    expect(res.estado).toBe('INICIANDO');
    await new Promise(r => setImmediate(r));
    expect(iniciar).toHaveBeenCalled();
  });

  it('enviar desde un proceso que no es el host falla diciendo POR QUÉ, no "no conectado"', async () => {
    const { svc } = cargarCon('false');

    await expect(svc.enviarMensaje('51999999999', 'hola', 'Agente', 'emp-1'))
      .rejects.toThrow(/no aloja el cliente/i);
    await expect(svc.enviarMedia('/tmp/x.pdf', 'x.pdf', '51999999999', '', 'Agente', 'emp-1'))
      .rejects.toThrow(/no aloja el cliente/i);
  });
});
