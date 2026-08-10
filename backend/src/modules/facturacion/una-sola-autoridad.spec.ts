import * as fs from 'fs';
import * as path from 'path';

const SRC = path.join(__dirname, '..', '..');

const ficheros: string[] = [];
(function recorrer(dir: string) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'migrations') recorrer(p); }
    else if (e.name.endsWith('.ts') && !e.name.includes('.spec.')) ficheros.push(p);
  }
})(SRC);

/**
 * H-10 — **una sola autoridad decide qué se factura** (2026-08-09).
 *
 * Había dos. `FacturacionService` con la política del abonado, el prorrateo y las barreras; y
 * `workers/facturacion.worker` con su propio SQL, su propio criterio de elegibilidad
 * (`estado = 'activo'`), su propio periodo (mes de calendario) y su propia idempotencia.
 *
 * El defecto no era que estuvieran desincronizados: era que **podían estarlo**. Ya habían
 * divergido dos veces —el tipo de comprobante el 04/08, y todo el bloque del dinero el 08-09/08—
 * y la segunda estuvo a punto de emitir un comprobante duplicado, porque cada uno calculaba el
 * periodo a su manera y la comprobación de duplicados comparaba por igualdad.
 *
 * Lo que sostiene la decisión no es haber borrado el código: es que **nadie vuelva a escribirlo**.
 * Una tercera autoridad no se anuncia — aparece como una consulta razonable dentro de un worker.
 */
describe('H-10 · Una sola autoridad decide qué se factura', () => {
  /** El servicio de facturación es el dueño; nadie más enumera a quién toca facturar. */
  const DUENO = path.join('modules', 'facturacion', 'facturacion.service.ts');
  const REPOSITORIO = path.join('modules', 'facturacion', 'repositories', 'factura.repository.ts');

  const sinComentarios = (s: string): string =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/^\s*--.*$/gm, '');

  it('solo el módulo de facturación decide a quién le toca facturar', () => {
    // La firma de esa decisión es leer `servicios` junto a `planes` para enumerar candidatos.
    // Quien haga eso fuera de facturación está construyendo un segundo generador.
    const infractores = ficheros
      .filter((f) => {
        const rel = path.relative(SRC, f);
        if (rel === DUENO || rel === REPOSITORIO) return false;
        const s = sinComentarios(fs.readFileSync(f, 'utf8'));
        return /FROM\s+servicios\b[\s\S]{0,400}?JOIN\s+planes\b/i.test(s)
            && /INSERT\s+INTO\s+facturas\b/i.test(s);
      })
      .map((f) => path.relative(SRC, f));

    expect(infractores).toEqual([]);
  });

  it('nadie fuera de facturación inserta comprobantes', () => {
    const infractores = ficheros
      .filter((f) => !path.relative(SRC, f).startsWith(path.join('modules', 'facturacion')))
      .filter((f) => /INSERT\s+INTO\s+facturas\b/i.test(sinComentarios(fs.readFileSync(f, 'utf8'))))
      .map((f) => path.relative(SRC, f));

    expect(infractores).toEqual([]);
  });

  it('el worker de facturación delega, no interpreta', () => {
    const worker = sinComentarios(
      fs.readFileSync(path.join(SRC, 'modules', 'workers', 'facturacion.worker.ts'), 'utf8'),
    );

    // Puede seguir existiendo como mecanismo de ejecución —cola, reintentos, concurrencia—
    // siempre que llame a la autoridad en vez de reimplementarla.
    expect(worker).toContain('this.facturacionSvc.generarMensual(');

    // Y no puede volver a tener criterio propio de elegibilidad ni de periodo.
    expect(worker).not.toMatch(/dia_facturacion\s*=\s*\$/);
    expect(worker).not.toMatch(/periodo_inicio\s*=\s*\$/);
  });

  it('`servicios.dia_facturacion` ya no decide cuándo facturar', () => {
    // Queda inerte tras H-10. Los dos servicios vivos lo tienen en 1 mientras su día de pago
    // es 28: ya mentía. Si alguien vuelve a colgar de él una decisión, este test lo dice.
    const infractores = ficheros
      .filter((f) => {
        const s = sinComentarios(fs.readFileSync(f, 'utf8'));
        return /dia_facturacion/.test(s) && /INSERT\s+INTO\s+facturas|generarMensual|generarFacturasDelDia/.test(s);
      })
      .map((f) => path.relative(SRC, f));

    expect(infractores).toEqual([]);
  });
});
