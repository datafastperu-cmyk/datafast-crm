// Ola 4 — mide el camino REAL de `detectarMorosos()`, no solo la consulta SQL.
//
// Origen (2026-08-22): la medición de `medir-deuda-por-facturas.sql` §9 mide una sola
// consulta — el reemplazo de `co.deuda_total > 0` por un `EXISTS`. Pero la implementación
// real que se envió (`cobranza.worker.ts`) es esa consulta MÁS una llamada a
// `DeudaPorContratoService.calcular()` por cada CLIENTE distinto con deuda. Esa parte no
// tenía número — este script se lo da, con la misma clase real (no un mock), contra el
// mismo Postgres.
//
// CORREGIDO 2026-08-22, primera corrida: 10.585 ms (41 ms SQL + 10.539 ms en calcular() × 10k
// clientes candidatos). El propietario señaló la mejora gratuita: `calcular()` solo puede dar
// > 0 si el CONTRATO tiene alguna factura exigible con saldo — es la misma pregunta que ya
// resuelve `idx_facturas_contrato_exigible`. Pre-filtrar los candidatos con ese `EXISTS`
// (superconjunto exacto, nunca una aproximación: si el contrato no debe nada, ningún
// servicio suyo puede tener reparto > 0) recorta las llamadas a `calcular()` de ~10.000 a
// ~3.333 sin cambiar un solo resultado. Aplicado aquí Y en `cobranza.worker.ts` — mismo
// predicado en los dos sitios, no una copia que pueda divergir.

import dataSource from '../src/config/datasource';
import { DeudaPorContratoService } from '../src/modules/facturacion/deuda-por-contrato.service';
import { sqlDeudaExigible } from '../src/modules/facturacion/domain/estados-con-saldo';

interface FilaCandidato {
  contrato_id: string;
  empresa_id:  string;
  cliente_id:  string;
}

async function main(): Promise<void> {
  await dataSource.initialize();
  const deudaSvc = new DeudaPorContratoService(dataSource);

  try {
    const t0 = Date.now();

    // Misma forma que `CobranzaScheduler.detectarMorosos()` tras Ola 4 — sin
    // `deuda_total`, acotado a los servicios `activo` — restringido a los clientes BENCH
    // para no medir contra el resto del Postgres de CI.
    const candidatos: FilaCandidato[] = await dataSource.query(`
      SELECT s.id AS contrato_id, s.empresa_id, s.cliente_id
        FROM servicios s
        JOIN clientes c ON c.id = s.cliente_id
       WHERE c.numero_documento LIKE 'BENCH%'
         AND s.estado = 'activo'
         AND s.deleted_at IS NULL
         AND EXISTS (
           SELECT 1 FROM facturas f
            WHERE f.contrato_id = s.contrato_id
              AND ${sqlDeudaExigible('f')}
              AND f.saldo > 0
         )
    `);
    const tCandidatos = Date.now();

    const deudaPorCliente = new Map<string, Map<string, { monto: number; comprobantes: number }>>();
    for (const clienteId of new Set(candidatos.map((c) => c.cliente_id))) {
      const fila = candidatos.find((c) => c.cliente_id === clienteId)!;
      deudaPorCliente.set(clienteId, await deudaSvc.calcular(clienteId, fila.empresa_id));
    }
    const tCalcular = Date.now();

    const morosos = candidatos
      .map((c) => {
        const deuda = deudaPorCliente.get(c.cliente_id)?.get(c.contrato_id);
        return deuda && deuda.monto > 0 ? { ...c, deudaTotal: deuda.monto } : null;
      })
      .filter((c): c is FilaCandidato & { deudaTotal: number } => c !== null)
      .sort((a, b) => b.deudaTotal - a.deudaTotal);
    const tFin = Date.now();

    const distintos = new Set(candidatos.map((c) => c.cliente_id)).size;

    console.log('--- medir-detectar-morosos.ts — camino REAL (SQL + N calcular()) ---');
    console.log(`Candidatos (servicios activos BENCH):     ${candidatos.length}`);
    console.log(`Clientes distintos (llamadas a calcular): ${distintos}`);
    console.log(`Morosos detectados (deuda imputada > 0):  ${morosos.length}`);
    console.log(`Tiempo SQL candidatos:                    ${tCandidatos - t0} ms`);
    console.log(`Tiempo calcular() × ${distintos} clientes:        ${tCalcular - tCandidatos} ms`);
    console.log(`Tiempo filtro/sort en JS:                 ${tFin - tCalcular} ms`);
    console.log(`TIEMPO TOTAL (camino real, no solo SQL):  ${tFin - t0} ms`);
  } finally {
    await dataSource.destroy();
  }
}

main().catch((e) => {
  console.error('[medir-detectar-morosos] Error fatal:', e instanceof Error ? e.stack : e);
  process.exit(1);
});
