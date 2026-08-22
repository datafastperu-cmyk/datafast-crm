// Ola 4 — mide el camino REAL de `detectarMorosos()`, no solo la consulta SQL.
//
// Origen (2026-08-22): la medición de `medir-deuda-por-facturas.sql` §9 mide una sola
// consulta — el reemplazo de `co.deuda_total > 0` por un `EXISTS`. Pero la implementación
// real que se envió (`cobranza.worker.ts`) es esa consulta MÁS una llamada a
// `DeudaPorContratoService.calcular()` por cada CLIENTE distinto con deuda (~3.333 al
// volumen de este banco de pruebas). Esa parte nunca tuvo número — este script se lo da,
// con la misma clase real (no un mock), contra el mismo Postgres.
//
// Precondición: correr DESPUÉS de `medir-deuda-por-facturas.sql` (siembra los 10k×12) y
// ANTES de `limpiar-bench-deuda.sql` — este script NO siembra ni limpia, solo mide.
//
// Uso: TS_NODE_PROJECT=tsconfig.migration.json npx ts-node -T scripts/medir-detectar-morosos.ts

import dataSource from '../src/config/datasource';
import { DeudaPorContratoService } from '../src/modules/facturacion/deuda-por-contrato.service';

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
