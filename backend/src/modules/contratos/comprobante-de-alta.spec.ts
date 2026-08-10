import * as fs from 'fs';
import * as path from 'path';
import { ContratosService } from './contratos.service';
import {
  PoliticaFacturacionService,
  PoliticaFacturacion,
} from '../facturacion/politica-facturacion.service';

/**
 * H-3 — «el primer comprobante del prepago lo emitía el navegador» (2026-08-09).
 *
 * El alta de un abonado prepago emitía su comprobante desde `ClienteWizard.tsx`, en una
 * llamada aparte y posterior a la creación del contrato, envuelta en un `catch {}` vacío.
 * Cuatro defectos a la vez: no había comprobante si el alta venía por API o si la pestaña
 * se cerraba entre las dos llamadas; el fallo se perdía mientras el toast decía «registrado
 * correctamente»; el periodo se calculaba a mano (`hoy` → `hoy + 1 mes`) en vez de con el
 * ciclo del abonado; y no se enviaba `contratoId`.
 *
 * Estos tests fijan el comportamiento en el backend, que es donde el alta y su comprobante
 * son un solo acto.
 */
describe('H-3 · Primer comprobante del alta (2026-08-09)', () => {
  // La política se ejercita DE VERDAD, no con un doble: lo que este hallazgo rompía era
  // justamente el cálculo del periodo, así que un mock que devolviera fechas inventadas no
  // demostraría nada. Sólo se sustituye `resolver`, que es lo único que va a la base.
  const politicaReal = new PoliticaFacturacionService(null as never);

  const POLITICA: PoliticaFacturacion = {
    tipo: 'prepago',
    diaPago: 30,
    diasAntesEmision: 7,
    diasGracia: 5,
    mesesVencidosParaCorte: 3,
    origen: 'cliente',
  };

  const USER = { sub: 'u-1', email: 'op@datafast.pe', empresaId: 'e-1' } as never;
  const CONTRATO = {
    id: 'c-99',
    numeroContrato: 'CNT-2026-000123',
    precioConDescuento: 64,
  } as never;

  /** Servicio con sólo las dependencias que toca la emisión — evita el grafo de DI entero. */
  const armar = (politica: Partial<PoliticaFacturacion>, crear: jest.Mock) => {
    const svc: any = Object.create(ContratosService.prototype);
    svc.logger = { log: jest.fn(), error: jest.fn(), warn: jest.fn() };
    svc.auditoria = { logCreate: jest.fn().mockResolvedValue(undefined) };
    svc.facturacionSvc = { create: crear };
    svc.politicaSvc = Object.assign(
      Object.create(PoliticaFacturacionService.prototype),
      {
        resolver: jest.fn().mockResolvedValue({ ...POLITICA, ...politica }),
        // Los cálculos de fecha son los reales.
        proximoVencimiento: politicaReal.proximoVencimiento.bind(politicaReal),
        periodoServicio:    politicaReal.periodoServicio.bind(politicaReal),
        aIso:               (politicaReal as any).aIso.bind(politicaReal),
        soloFecha:          (politicaReal as any).soloFecha.bind(politicaReal),
        anclaDesplazada:    (politicaReal as any).anclaDesplazada.bind(politicaReal),
      },
    );
    return svc;
  };

  const emitir = (svc: any, dto: Record<string, unknown>) =>
    svc.emitirComprobanteDeAlta(
      CONTRATO,
      { nombre: 'Plan 100 Mbps' },
      { clienteId: 'cli-1', ...dto },
      USER,
    );

  const facturaFalsa = {
    serie: 'B001', correlativo: 7, total: 64, fechaVencimiento: '2026-09-30',
  };

  it('el prepago recibe su comprobante con el ciclo del abonado, no con «hoy + 1 mes»', async () => {
    const crear = jest.fn().mockResolvedValue(facturaFalsa);
    jest.useFakeTimers().setSystemTime(new Date('2026-08-22T15:00:00Z'));

    await emitir(armar({ tipo: 'prepago', diaPago: 30 }, crear), {});

    jest.useRealTimers();

    const dto = crear.mock.calls[0][0];
    // Prepago instalado el 22/08 con anclaje 30: paga por adelantado el ciclo que ABRE en su
    // día de pago. El navegador mandaba 22/08 → 22/09, que no es ningún ciclo suyo.
    expect(dto.periodoInicio).toBe('2026-08-31');
    expect(dto.periodoFin).toBe('2026-09-30');
  });

  it('imputa la deuda al contrato — sin `contratoId` el segundo servicio queda sin dueño', async () => {
    const crear = jest.fn().mockResolvedValue(facturaFalsa);

    await emitir(armar({ tipo: 'prepago' }, crear), {});

    expect(crear.mock.calls[0][0].contratoId).toBe('c-99');
  });

  it('no impone fecha de vencimiento: la fija el día de pago del abonado', async () => {
    const crear = jest.fn().mockResolvedValue(facturaFalsa);

    await emitir(armar({ tipo: 'prepago' }, crear), {});

    // Mandar una aquí reintroduciría el incidente del 2026-08-05 por la puerta del alta.
    expect(crear.mock.calls[0][0].fechaVencimiento).toBeUndefined();
  });

  it('cobra la mensualidad del CONTRATO, no la del plan (respeta el descuento pactado)', async () => {
    const crear = jest.fn().mockResolvedValue(facturaFalsa);

    await emitir(armar({ tipo: 'prepago' }, crear), {});

    expect(crear.mock.calls[0][0].items).toEqual([
      { descripcion: 'Plan 100 Mbps', cantidad: 1, precioUnitario: 64 },
    ]);
  });

  it('el postpago sin instalación no emite nada: su ciclo va por detrás del servicio', async () => {
    const crear = jest.fn();

    await emitir(armar({ tipo: 'postpago' }, crear), {});

    expect(crear).not.toHaveBeenCalled();
  });

  it('el postpago CON instalación cobra sólo la instalación', async () => {
    const crear = jest.fn().mockResolvedValue(facturaFalsa);

    await emitir(armar({ tipo: 'postpago' }, crear), { costoInstalacion: 150 });

    expect(crear.mock.calls[0][0].items).toEqual([
      { descripcion: 'Costo de instalación', cantidad: 1, precioUnitario: 150 },
    ]);
  });

  it('el prepago con instalación cobra las dos cosas en un solo comprobante', async () => {
    const crear = jest.fn().mockResolvedValue(facturaFalsa);

    await emitir(armar({ tipo: 'prepago' }, crear), { costoInstalacion: 150 });

    expect(crear.mock.calls[0][0].items).toHaveLength(2);
  });

  it('si la emisión falla NO tumba el alta, pero tampoco se calla — queda en auditoría', async () => {
    const crear = jest.fn().mockRejectedValue(new Error('correlativo agotado'));
    const svc = armar({ tipo: 'prepago' }, crear);

    // Que no relance es deliberado: el contrato ya está comprometido en la base.
    await expect(emitir(svc, {})).resolves.toBeUndefined();

    // Lo que NO puede volver a pasar es el `catch {}` vacío del navegador.
    expect(svc.auditoria.logCreate).toHaveBeenCalledTimes(1);
    const auditado = svc.auditoria.logCreate.mock.calls[0][0];
    expect(auditado.descripcion).toContain('CNT-2026-000123');
    expect(auditado.descripcion).toContain('correlativo agotado');
    expect(svc.logger.error).toHaveBeenCalled();
  });

  it('ni siquiera un fallo AL AUDITAR el fallo tumba el alta', async () => {
    // Un manejador de errores que puede lanzar no es un manejador. Si la auditoría revienta
    // —tabla bloqueada, doble de test sin promesa— el alta tiene que seguir en pie: es la
    // vía que existe justamente para no tumbarla.
    const svc = armar({ tipo: 'prepago' }, jest.fn().mockRejectedValue(new Error('boom')));
    svc.auditoria.logCreate = jest.fn(() => { throw new Error('auditoría caída'); });

    await expect(emitir(svc, {})).resolves.toBeUndefined();
    expect(svc.logger.error).toHaveBeenCalledTimes(2);
  });
});

/**
 * El orden dentro de `onboarding` es una PRECONDICIÓN de lo anterior, no una preferencia.
 *
 * `saveFacturacionConfig` estaba después de crear el contrato. Mientras el comprobante lo
 * emitía el navegador —en una tercera llamada— daba igual. Al traer la emisión al backend,
 * ese orden haría que la política se resolviera con los valores por defecto de la empresa:
 * **todo abonado prepago se facturaría como postpago**, en silencio y con fechas plausibles.
 *
 * Es un fallo que ninguna prueba de tipos detecta y que en producción sólo se ve semanas
 * después, al no aparecer el cobro. Por eso se fija aquí.
 */
describe('H-3 · onboarding guarda la facturación ANTES de crear el contrato', () => {
  it('saveFacturacionConfig aparece antes de contratosSvc.create', () => {
    const fuente = fs.readFileSync(
      path.join(__dirname, '..', 'clientes', 'clientes.service.ts'),
      'utf8',
    );

    const cuerpo = fuente.slice(fuente.indexOf('async onboarding('));
    expect(cuerpo).not.toBe('');

    const config   = cuerpo.indexOf('this.saveFacturacionConfig(');
    const contrato = cuerpo.indexOf('this.contratosSvc.create(');

    expect(config).toBeGreaterThan(-1);
    expect(contrato).toBeGreaterThan(-1);
    expect(config).toBeLessThan(contrato);
  });
});

/**
 * Barrera: el alta no vuelve a emitir comprobantes desde el navegador.
 *
 * No basta con haberlo quitado — lo que hay que impedir es que vuelva. El patrón es el
 * mismo de `frontera-dinero.spec.ts`: si alguien reintroduce la llamada en la pantalla del
 * alta, el test lo dice antes que producción.
 */
describe('H-3 · el navegador no emite comprobantes en el alta', () => {
  const RAIZ = path.join(__dirname, '..', '..', '..', '..', 'frontend', 'src', 'components', 'clientes');

  const sinComentarios = (s: string): string =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  // Se quitan los comentarios primero: los de este mismo cambio mencionan la llamada para
  // explicar por qué ya no está, y un `includes` a secas los daría por infracción. Ya pasó
  // tres veces con barreras de este tipo.
  const leer = (archivo: string): string[] | null => {
    const ruta = path.join(RAIZ, archivo);
    if (!fs.existsSync(ruta)) return null; // el backend también se testea sin el frontend
    return sinComentarios(fs.readFileSync(ruta, 'utf8')).split('\n');
  };

  it('el wizard del alta no emite ningún comprobante', () => {
    const lineas = leer('ClienteWizard.tsx');
    if (!lineas) return;
    expect(lineas.join('\n')).not.toContain('facturacionApi.create(');
  });

  it('en la ficha del cliente no se emite pegado a la creación del contrato', () => {
    // Aquí NO vale prohibir la llamada entera: la ficha tiene un modal de comprobante
    // manual que debe poder emitir. Lo que se prohíbe es lo que hacía el defecto —emitir
    // como continuación del alta—, y eso se reconoce por la vecindad de las dos llamadas.
    const lineas = leer('ClienteDetalle.tsx');
    if (!lineas) return;

    const VENTANA = 60;
    const infracciones = lineas.flatMap((linea, i) =>
      linea.includes('contratosApi.create(')
        ? lineas
            .slice(i, i + VENTANA)
            .map((l, j) => (l.includes('facturacionApi.create(') ? i + j + 1 : 0))
            .filter(Boolean)
        : [],
    );

    expect(infracciones).toEqual([]);
  });
});
