/**
 * Informe por consola del barrido de autorización (B-3).
 *
 * La barrera vive en `guards/autorizacion-endpoints.spec.ts` — esto solo imprime el detalle
 * para revisarlo a mano. Una sola implementación, dos puntos de entrada.
 *
 * Uso: npm run autorizacion:check [-- --todos]
 */
import { analizar } from './autorizacion-endpoints';

const h = analizar();
const por = (c: string) => h.filter((x) => x.clase === c);

console.log(`Endpoints mutantes (POST/PATCH/PUT/DELETE): ${h.length}\n`);
for (const c of ['ABIERTO', 'ROL', 'PERMISO', 'ROL-FANTASMA', 'PUBLICO', 'GUARD-PROPIO', 'EXENTO']) {
  console.log(`  ${c.padEnd(14)}${String(por(c).length).padStart(4)}`);
}

for (const f of por('ROL-FANTASMA')) {
  console.log(`\n  ROL-FANTASMA  ${f.fichero}:${f.linea}  ${f.verbo} ${f.ruta} → ${f.fantasmas.join(', ')}`);
}

const porFichero = new Map<string, number>();
for (const a of por('ABIERTO')) porFichero.set(a.fichero, (porFichero.get(a.fichero) ?? 0) + 1);
console.log('\n── ABIERTO, por controlador ──');
for (const [f, n] of [...porFichero.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`   ${String(n).padStart(3)}  ${f}`);
}
if (process.argv.includes('--todos')) {
  console.log('\n── detalle ──');
  for (const a of por('ABIERTO')) console.log(`   ${a.fichero}:${a.linea}  ${a.verbo} ${a.ruta}`);
}
