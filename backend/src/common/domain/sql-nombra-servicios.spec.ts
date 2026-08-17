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

/**
 * Ola 2 (2026-08-17) — el SEGUNDO modo de fallo, distinto del que vigila la fase 3a de
 * arriba. Aquella barrera vigila una tabla que ya no existe (`relation contratos does
 * not exist` — ruidoso). Esta vigila una COLUMNA que ya no existe en una tabla que
 * SIGUE existiendo: desde que la clasificación aprobada (`E-0.2-clasificacion-contrato-
 * id.md`) empieza a renombrar `contrato_id` → `servicio_id` en las tablas TÉCNICAS, un
 * `contrato_id` olvidado en una consulta contra esa misma tabla falla con "column does
 * not exist" — ruidoso también, pero solo si esa rama del código llega a ejecutarse. El
 * primer renombrado real (`comandos_red_pendientes`) va en el mismo lote que esta
 * ampliación, no después — instrucción explícita del propietario.
 *
 * NO se confunde con `servicios.contrato_id`: esa columna es real y permanente desde la
 * fase 3b (el FK genuino al acuerdo) — `FacturaRepository.contratoDe()` la lee a
 * propósito. Por eso esta barrera no busca "`contrato_id` cerca de `servicios`" (eso
 * marcaría ese caso legítimo como infractor): busca `contrato_id` dentro del MISMO
 * literal SQL que referencia una tabla que este registro declara ya renombrada.
 */
describe('Ola 2 · Ninguna consulta usa contrato_id contra una tabla ya renombrada a servicio_id', () => {
  // Registro DECLARADO — crece con cada tabla técnica que la clasificación aprobada
  // (E-0.2-clasificacion-contrato-id.md) va renombrando. Nunca se adivina por regex.
  const TABLAS_RENOMBRADAS_A_SERVICIO_ID = [
    'comandos_red_pendientes', 'ordenes_trabajo', 'consumo_datos', 'consumo_snapshot',
    'ips_asignadas',
  ];

  const ES_LA_PROPIA_BARRERA = (f: string) => f.endsWith(path.basename(__filename).replace(/.js$/, '.ts'));

  // Un literal SQL en este código siempre vive entre backticks — se escanea cada bloque
  // por separado (no el fichero entero) para no confundir una tabla renombrada en una
  // consulta con un `contrato_id` legítimo de OTRA consulta en el mismo fichero (caso
  // real: outbox-red.service.ts tiene comandos_red_pendientes en casi todo el archivo Y
  // un `ftth_onu_registro.contrato_id` legítimo, sin FK, fuera de este lote).
  const bloquesSql = (contenido: string): string[] => contenido.match(/`[^`]*`/gs) ?? [];

  it('ningún literal SQL mezcla una tabla ya renombrada con la columna vieja `contrato_id`', () => {
    const infractores: string[] = [];
    for (const f of ficheros) {
      if (ES_LA_PROPIA_BARRERA(f)) continue;
      const contenido = fs.readFileSync(f, 'utf8');
      for (const bloque of bloquesSql(contenido)) {
        for (const tabla of TABLAS_RENOMBRADAS_A_SERVICIO_ID) {
          const tieneLaTabla = new RegExp(`\\b(?:FROM|JOIN|UPDATE|INTO)\\s+${tabla}\\b`, 'i').test(bloque);
          const tieneColumnaVieja = /\bcontrato_id\b/.test(bloque);
          if (tieneLaTabla && tieneColumnaVieja) {
            infractores.push(`${path.relative(SRC, f)} (${tabla})`);
          }
        }
      }
    }
    expect(infractores).toEqual([]);
  });

  it('el registro de tablas renombradas no está vacío una vez que Ola 2 empieza a tocar código', () => {
    // Si esto llega a 0 con la Ola 2 ya en marcha, es que se renombró una tabla sin
    // declararla aquí — la barrera dejaría de vigilar la que más importa comprobar.
    expect(TABLAS_RENOMBRADAS_A_SERVICIO_ID.length).toBeGreaterThan(0);
  });
});
