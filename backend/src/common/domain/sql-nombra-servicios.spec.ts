import * as fs from 'fs';
import * as path from 'path';

const SRC = path.join(__dirname, '..', '..');

const ficheros: string[] = [];
(function recorrer(dir: string) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'migrations') recorrer(p); }
    else if (e.name.endsWith('.ts')) ficheros.push(p);
  }
})(SRC);

/**
 * Fase 3a — **el SQL crudo nombra `servicios`, no `contratos`** (2026-08-09).
 *
 * La tabla `contratos` nunca guardó contratos: guardaba servicios. Renombrarla tocó 166 sitios en
 * 55 ficheros, y **ninguno de ellos lo ve TypeScript**: son cadenas de texto dentro de
 * `ds.query(...)`.
 *
 * Esa es la razón de esta barrera. La suite no puede detectar SQL roto —los tests son unitarios,
 * con la base simulada—, así que los 737 pasarían con todas las consultas apuntando a una tabla
 * que ya no existe. Lo único que sostiene el renombrado es leer el código.
 *
 * **Y hay una ventana en la que el descuido sería silencioso.** En la fase 3b vuelve a existir una
 * tabla llamada `contratos` —el acuerdo que agrupa los servicios—, así que a partir de entonces un
 * `FROM contratos` olvidado no falla: lee la tabla equivocada y devuelve cero filas. Un corte que
 * no corta, sin un solo error en el log. Por eso el renombrado se desplegó SOLO, con el nombre
 * libre, y por eso esta barrera se queda después.
 */
describe('Fase 3a · El SQL nombra la tabla por lo que guarda', () => {
  /**
   * Consultas que SÍ deben nombrar `contratos` porque hablan del acuerdo, no del servicio.
   * Vacío en 3a —la tabla aún no existe— y se irá poblando en 3b y 3c. Cada entrada es una
   * decisión explícita, que es justo lo contrario de un descuido.
   */
  const LEGITIMAS: string[] = [
    // `contratoDe` (fase 4.2a) resuelve el ACUERDO de un comprobante. Es la primera consulta
    // del repositorio que habla del contrato de verdad y no del servicio, asi que nombrar
    // `contratos` aqui es correcto — y esta linea es la prueba de que fue deliberado.
    'modules' + path.sep + 'facturacion' + path.sep + 'repositories' + path.sep + 'factura.repository.ts',
  ];

  // Este mismo fichero contiene el patrón que persigue —en la expresión regular y en la
  // explicación—, así que se excluye. Es el cuarto falso positivo de esta forma en el
  // repositorio: una barrera que se lee a sí misma siempre se acusa.
  const ES_LA_PROPIA_BARRERA = (f: string) => f.endsWith(path.basename(__filename).replace(/.js$/, '.ts'));

  const sqlQueNombraContratos = (fichero: string): string[] => {
    const s = fs.readFileSync(fichero, 'utf8');
    // `contratos` a secas es casi siempre el nombre del MÓDULO —dueño, ruta, permiso—, y ese no
    // cambia: la API pública sigue siendo /contratos. Solo interesa tras una palabra clave de SQL.
    const de = (re: RegExp): string[] => s.match(re) ?? [];
    return [...de(/\b(?:FROM|JOIN|UPDATE|INTO)\s+contratos\b/gi), ...de(/\bcontratos_historial\b/g)];
  };

  it('ninguna consulta lee la tabla vieja', () => {
    const infractores = ficheros
      .filter((f) => !LEGITIMAS.includes(path.relative(SRC, f)) && !ES_LA_PROPIA_BARRERA(f))
      .filter((f) => sqlQueNombraContratos(f).length > 0)
      .map((f) => path.relative(SRC, f));

    expect(infractores).toEqual([]);
  });

  it('ninguna entidad sigue mapeada a la tabla vieja', () => {
    const infractores = ficheros
      .filter((f) => /@Entity\('contratos'\)|@Entity\('contratos_historial'\)/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(SRC, f));

    expect(infractores).toEqual([]);
  });

  it('el manifiesto de propiedad declara servicios, no contratos', () => {
    // PA-12: si la clave no existe, la tabla queda sin dueño declarado y el barrido de escritores
    // deja de vigilarla — se perdería en silencio la garantía, no la tabla.
    const manifiesto = fs.readFileSync(path.join(SRC, 'common', 'domain', 'propiedad-tablas.ts'), 'utf8');
    expect(manifiesto).toMatch(/^\s*servicios:\s*\{/m);
    expect(manifiesto).toMatch(/^\s*servicios_historial:/m);
  });
});
