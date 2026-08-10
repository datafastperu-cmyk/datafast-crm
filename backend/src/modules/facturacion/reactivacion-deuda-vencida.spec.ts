import * as fs from 'fs';
import * as path from 'path';

const SRC = path.join(__dirname, '..', '..');

const sinComentarios = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const leer = (rel: string): string =>
  sinComentarios(fs.readFileSync(path.join(SRC, rel), 'utf8'));

/**
 * H-7 — «la reactivación exige deuda TOTAL cero, no vencida» (2026-08-09).
 *
 * El abonado paga lo que realmente debe, le queda un comprobante emitido y aún no vencido, y no
 * se le devuelve el servicio. Es exigirle pago adelantado para reactivar.
 *
 * No se notaba porque H-6 lo tapaba: a un suspendido no se le facturaba nada, así que nunca había
 * un comprobante nuevo que estorbara. Al corregir H-6 aparece — por eso van en el mismo despliegue.
 *
 * **El hallazgo decía dos sitios. Eran CINCO**, y los tres que faltaban solo aparecieron al
 * implementar la corrección:
 *
 *   · el del worker de cobranza, que decide AL FINAL y podía cancelar una reactivación que
 *     `pagos.service` ya había autorizado — abonado pagado y sin servicio;
 *   · `verificarYReactivarContrato`, que además reactiva con `automatico = true` y por tanto se
 *     salta las guardas;
 *   · la ruta del comprobante consolidado.
 *
 * No era un criterio equivocado: era el mismo criterio copiado cinco veces y divergiendo. Es lo
 * que la regla de la máquina de estados declarativa llama un criterio disperso — nadie podía leer
 * las cinco a la vez, y por eso nadie vio que ninguna filtraba por fecha.
 */
describe('H-7 · Las tres puertas de reactivación preguntan lo mismo (2026-08-09)', () => {
  const PUERTAS: Array<[string, string]> = [
    ['las cuatro de pagos (pago, prórroga, consolidada, verificar)', 'modules/pagos/pagos.service.ts'],
    ['guarda del cambio manual de estado',                          'modules/contratos/contratos.service.ts'],
    ['última puerta, en el worker de cobranza',                     'modules/workers/cobranza.worker.ts'],
  ];

  it.each(PUERTAS)('%s consulta la definición única', (_nombre, archivo) => {
    expect(leer(archivo)).toMatch(/vencidaQueBloquea\(|vencidaDelCliente\(/);
  });

  it('pagos.service tiene las CUATRO consultas, no una', () => {
    // Corregir solo la primera dejaba a las otras tres decidiendo con la deuda total.
    const usos = leer('modules/pagos/pagos.service.ts')
      .match(/vencidaQueBloquea\(|vencidaDelCliente\(/g) ?? [];
    expect(usos.length).toBeGreaterThanOrEqual(4);
  });

  it('ninguna vuelve a medir la deuda con su propia consulta', () => {
    // El defecto no era el criterio: era que cada puerta tenía el suyo. Si alguien reintroduce
    // un SUM(f.saldo) en cualquiera de ellas, volvemos a tener varias definiciones — que es
    // exactamente cómo llegamos aquí.
    for (const [, archivo] of PUERTAS) {
      expect(leer(archivo)).not.toMatch(/SUM\(f\.saldo\)/);
    }
  });

  it('la guarda no decide con contratos.deuda_total, que incluye lo no vencido', () => {
    const contratos = leer('modules/contratos/contratos.service.ts');
    const guardas   = contratos.slice(
      contratos.indexOf('const bloqueaReactivacion'),
      contratos.indexOf('const GUARDAS'),
    );
    expect(guardas).not.toContain('deudaTotal');
    expect(guardas).toContain('deudaVencida');
  });

  it('la definición vive en un solo sitio y filtra por fecha de vencimiento', () => {
    const deuda = leer('modules/facturacion/deuda-por-contrato.service.ts');
    const metodo = deuda.slice(deuda.indexOf('async vencidaQueBloquea'));
    // SQL_COMPROBANTE_VENCIDO es lo que añade `fecha_vencimiento < CURRENT_DATE`.
    expect(metodo).toContain('SQL_COMPROBANTE_VENCIDO');
  });
});

/**
 * H-8 — «el ciclo de la reactivación no lo emite nadie» (2026-08-09).
 *
 * El generador diario emitía solo si la fecha de emisión del abonado era EXACTAMENTE hoy. Un
 * prepago suspendido el 07/09 y reactivado el 25/09 se quedaba sin el comprobante del ciclo que sí
 * iba a recibir —un mes entero— porque su día de emisión, el 23, ya había pasado y nadie miraba
 * hacia atrás.
 *
 * Se corrigió con `<=` en vez de `===`, que además hace el generador auto-reparable: cubre también
 * el día en que el cron no llegó a correr. Lo que lo hace seguro es la deduplicación por periodo.
 */
describe('H-8 · El generador diario se auto-repara (2026-08-09)', () => {
  const servicio = leer('modules/facturacion/facturacion.service.ts');

  it('no descarta a un abonado porque su día de emisión ya pasara', () => {
    // Con `!==` un ciclo perdido no se recuperaba jamás.
    expect(servicio).not.toMatch(/aIso\(emite\)\s*!==\s*hoyIso/);
    expect(servicio).toMatch(/aIso\(emite\)\s*>\s*hoyIso/);
  });

  it('sigue existiendo la deduplicación por periodo, que es lo que lo hace seguro', () => {
    // Sin ella, emitir «todo lo que ya venció» duplicaría comprobantes en cada pasada.
    expect(servicio).toContain('existeFacturaClientePeriodo(');
  });
});

/**
 * H-6 — la generación ya no decide con el estado de hoy.
 */
describe('H-6 · La generación cobra lo entregado, no el estado de hoy (2026-08-09)', () => {
  it('la consulta de contratos a facturar ya no filtra por estado activo', () => {
    const repo = fs.readFileSync(
      path.join(SRC, 'modules/facturacion/repositories/factura.repository.ts'), 'utf8',
    );
    // Se mira el SQL crudo, no el fichero: los comentarios explican el defecto y lo nombran.
    const sql = repo.slice(repo.indexOf('async findContratosParaFacturar'));
    const sinComentariosSql = sql.replace(/^\s*--.*$/gm, '');
    expect(sinComentariosSql).not.toMatch(/AND co\.estado = 'activo'/);
  });

  it('los DOS generadores prorratean — el mensual y el diario', () => {
    // Solo se corrigió el mensual en la primera pasada. El de producción es el diario.
    const llamadas = leer('modules/facturacion/facturacion.service.ts')
      .match(/this\.cargoDelContratoEnCiclo\(/g) ?? [];
    expect(llamadas).toHaveLength(2);
  });
});
