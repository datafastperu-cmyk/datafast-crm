/**
 * Graba el SQL que ejecutan las migraciones de planta externa, sin conectarse a nada.
 *
 * Existe para que lo que se valida contra la base de datos sea EXACTAMENTE lo que
 * correrá en producción, y no una copia manual del SQL que se desincroniza al primer
 * cambio. El QueryRunner falso sólo acumula las sentencias.
 *
 * Uso:  npx ts-node scripts/dump-planta-externa-sql.ts up   > pe-up.sql
 *       npx ts-node scripts/dump-planta-externa-sql.ts down > pe-down.sql
 */
import { CreatePlantaExternaGrafo1791800000028 }
  from '../src/database/migrations/core/1791800000028-CreatePlantaExternaGrafo';
import { CreatePlantaExternaOptica1791800000029 }
  from '../src/database/migrations/core/1791800000029-CreatePlantaExternaOptica';
import { CreatePlantaExternaAcceso1791800000030 }
  from '../src/database/migrations/core/1791800000030-CreatePlantaExternaAcceso';

const sentencias: string[] = [];
const qr = { query: async (sql: string) => { sentencias.push(sql.trim()); return []; } } as any;

async function main() {
  const direccion = process.argv[2] === 'down' ? 'down' : 'up';
  const migraciones = [
    new CreatePlantaExternaGrafo1791800000028(),
    new CreatePlantaExternaOptica1791800000029(),
    new CreatePlantaExternaAcceso1791800000030(),
  ];

  // El orden de `down` es el inverso del de `up`: deshacer en el mismo orden dejaría
  // FKs colgando de tablas que ya no existen.
  const secuencia = direccion === 'up' ? migraciones : [...migraciones].reverse();

  for (const m of secuencia) {
    await (direccion === 'up' ? m.up(qr) : m.down(qr));
  }

  // Una transacción por corrida: si algo falla, la BD de prueba queda como estaba y el
  // error señala la sentencia exacta en vez de un esquema a medio crear.
  process.stdout.write('BEGIN;\n\n');
  process.stdout.write(sentencias.map((s) => `${s};`).join('\n\n'));
  process.stdout.write('\n\nCOMMIT;\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
