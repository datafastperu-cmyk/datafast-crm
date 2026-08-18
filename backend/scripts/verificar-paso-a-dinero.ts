// ═══════════════════════════════════════════════════════════════════════════
// Paso A del lote de DINERO (Ola 2) — la guarda ejercitada con datos sembrados.
//
// Origen (2026-08-17, hallazgo del propietario): las tres migraciones de Paso A
// (`1791800000064/065/066`) corren en CI contra una instalación limpia —cero filas—, así
// que el conteo de huérfanos, el backfill y la comparación de dinero pasan sobre conjuntos
// VACÍOS. Una guarda que nunca vio un dato es decorativa (PC-04); su primera ejecución real
// sería en destino, el peor sitio para descubrir que el mapa no cubre un caso.
//
// Este script siembra filas a mano y llama a la MISMA función que las migraciones usan
// (`../src/database/migrations/dinero/paso-a-guardas.ts`) — no una copia que podría
// divergir de lo que corre en producción. Tres casos, y el (b) es el que importa:
//
//   (a) Traducción correcta: fila con acuerdo → contrato_id_real queda con el contrato.
//   (b) HUÉRFANO: fila apuntando a un servicio SIN contrato_id → la guarda debe LANZAR y
//       la columna nueva debe seguir en NULL — nada se escribe a medias.
//   (c) El dinero no se mueve: SUM por cliente idéntico antes y después.
//
// Cada escenario vive en su PROPIA transacción, con ROLLBACK siempre en el `finally` —
// nada de lo sembrado aquí sobrevive al script, corra como corra.
//
// Uso: TS_NODE_PROJECT=tsconfig.migration.json ts-node -T scripts/verificar-paso-a-dinero.ts
// Precondición: correr DESPUÉS de `migration:run:all` — necesita `contrato_id_real` (y en
// cargos_pendientes, `servicio_id`) ya creadas por las migraciones de Paso A.
// ═══════════════════════════════════════════════════════════════════════════

import { QueryRunner } from 'typeorm';
import dataSource from '../src/config/datasource';
import {
  pagosContratoRealPasoA,
  promesasPagoContratoRealPasoA,
  cargosPendientesContratoRealPasoA,
  PasoAHuerfanoError,
} from '../src/database/migrations/dinero/paso-a-guardas';

// Empresa placeholder que SeedInitialData1700000010000 ya deja en toda instalación limpia
// — reutilizarla evita tener que sembrar una empresa propia con sus 15 columnas NOT NULL.
const EMPRESA_ID = 'a0000000-0000-0000-0000-000000000001';

let fallos = 0;

function assert(cond: unknown, mensaje: string): void {
  if (!cond) {
    fallos++;
    console.error(`  ✗ ${mensaje}`);
  } else {
    console.log(`  ✓ ${mensaje}`);
  }
}

// ── Semillas mínimas ─────────────────────────────────────────────────────
// Cada valor de negocio (numero_documento, numero_contrato) lleva este token para que dos
// ejecuciones del script en la misma base no choquen contra una constraint UNIQUE, aunque
// el rollback debería dejar cero rastro. Corto a propósito: numero_documento es
// VARCHAR(20) y numero_contrato VARCHAR(30) — un token largo (pid+timestamp) revienta esos
// límites antes de que la guarda llegue a ejecutarse.
const TOKEN = Math.random().toString(36).slice(2, 8);

async function crearPlan(q: QueryRunner, sufijo: string): Promise<string> {
  // producto NOT NULL DEFAULT 'internet' (fase 2, CatalogoAbiertoAProductos) trae consigo
  // el CHECK planes_velocidad_solo_internet: con producto='internet' (el default, que no
  // se está pisando aquí) las dos velocidades son obligatorias pese a que la columna en sí
  // sea nullable desde esa misma migración.
  const [fila] = await q.query(
    `INSERT INTO planes (empresa_id, nombre, precio, velocidad_bajada, velocidad_subida)
     VALUES ($1, $2, 50, 100, 20) RETURNING id`,
    [EMPRESA_ID, `Plan ${TOKEN}-${sufijo}`],
  );
  return fila.id;
}

async function crearCliente(q: QueryRunner, sufijo: string): Promise<string> {
  // apellido_paterno es NOT NULL en la tabla real (CreateClientes 1700000003000) aunque la
  // entidad TypeORM lo declara nullable con default '' — deriva conocida, sin barrera que
  // la vigile (esquema real vs. entidades es solo informe, F-0.1-A). Se provee explícito
  // aquí porque este script habla SQL crudo contra la tabla, no contra la entidad.
  const [fila] = await q.query(
    `INSERT INTO clientes (empresa_id, numero_documento, nombres, apellido_paterno, telefono, direccion)
     VALUES ($1, $2, $3, $4, '999999999', 'Dirección de prueba — Paso A')
     RETURNING id`,
    [EMPRESA_ID, `${TOKEN}${sufijo}`, `Cliente ${TOKEN}`, `Test-${sufijo}`],
  );
  return fila.id;
}

/** El ACUERDO real (fase 3b). */
async function crearContratoReal(q: QueryRunner, clienteId: string, sufijo: string): Promise<string> {
  const [fila] = await q.query(
    `INSERT INTO contratos (empresa_id, cliente_id, numero_contrato)
     VALUES ($1, $2, $3) RETURNING id`,
    [EMPRESA_ID, clienteId, `CTR-${TOKEN}${sufijo}`],
  );
  return fila.id;
}

/**
 * `servicios` — pasar `contratoRealId: null` simula el caso huérfano: un servicio
 * soft-deleted ANTES de la fase 3b, que nunca recibió el backfill de `servicios.contrato_id`.
 */
async function crearServicio(
  q: QueryRunner, clienteId: string, planId: string, contratoRealId: string | null, sufijo: string,
): Promise<string> {
  const [fila] = await q.query(
    `INSERT INTO servicios
       (empresa_id, cliente_id, plan_id, contrato_id, numero_contrato, fecha_inicio, precio_mensual)
     VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, 50)
     RETURNING id`,
    [EMPRESA_ID, clienteId, planId, contratoRealId, `SVC-${TOKEN}${sufijo}`],
  );
  return fila.id;
}

async function crearPago(q: QueryRunner, clienteId: string, servicioId: string | null, monto: number): Promise<string> {
  const [fila] = await q.query(
    `INSERT INTO pagos (empresa_id, cliente_id, contrato_id, monto, metodo_pago)
     VALUES ($1, $2, $3, $4, 'efectivo') RETURNING id`,
    [EMPRESA_ID, clienteId, servicioId, monto],
  );
  return fila.id;
}

async function crearPromesa(q: QueryRunner, clienteId: string, servicioId: string, monto: number): Promise<string> {
  const [fila] = await q.query(
    `INSERT INTO promesas_pago
       (empresa_id, contrato_id, cliente_id, fecha_vencimiento, monto_prometido, deuda_al_crear)
     VALUES ($1, $2, $3, CURRENT_DATE + 3, $4, $4)
     RETURNING id`,
    [EMPRESA_ID, servicioId, clienteId, monto],
  );
  return fila.id;
}

async function crearCargo(
  q: QueryRunner, clienteId: string, servicioId: string | null, tipo: 'servicio' | 'reconexion' | 'mora', monto: number,
): Promise<string> {
  const [fila] = await q.query(
    `INSERT INTO cargos_pendientes (empresa_id, cliente_id, contrato_id, tipo, monto, aplica_igv)
     VALUES ($1, $2, $3, $4, $5, $4 <> 'mora') RETURNING id`,
    [EMPRESA_ID, clienteId, servicioId, tipo, monto],
  );
  return fila.id;
}

// ── Escenarios ────────────────────────────────────────────────────────────
// Cada uno abre su propia transacción y la revierte SIEMPRE en el finally — el caso (b)
// espera que la guarda lance, así que el try/catch de la guarda y el rollback de la
// transacción son cosas DISTINTAS: uno prueba el comportamiento, el otro limpia.

async function casoTraduccionCorrecta(qr: QueryRunner, tabla: string): Promise<void> {
  console.log(`\n[${tabla}] (a) traducción correcta — servicio CON acuerdo`);
  await qr.startTransaction();
  try {
    const cliente = await crearCliente(qr, 'a');
    const plan = await crearPlan(qr, 'a');
    const contratoReal = await crearContratoReal(qr, cliente, 'a');
    const servicio = await crearServicio(qr, cliente, plan, contratoReal, 'a');

    if (tabla === 'pagos') {
      const pago = await crearPago(qr, cliente, servicio, 85);
      await pagosContratoRealPasoA(qr);
      const [fila] = await qr.query(`SELECT contrato_id_real FROM pagos WHERE id = $1`, [pago]);
      assert(fila.contrato_id_real === contratoReal, 'pagos.contrato_id_real == el acuerdo real del servicio');
    } else if (tabla === 'promesas_pago') {
      const promesa = await crearPromesa(qr, cliente, servicio, 120);
      await promesasPagoContratoRealPasoA(qr);
      const [fila] = await qr.query(`SELECT contrato_id_real FROM promesas_pago WHERE id = $1`, [promesa]);
      assert(fila.contrato_id_real === contratoReal, 'promesas_pago.contrato_id_real == el acuerdo real del servicio');
    } else {
      const cargoReconexion = await crearCargo(qr, cliente, servicio, 'reconexion', 20);
      const cargoMora = await crearCargo(qr, cliente, servicio, 'mora', 15);
      await cargosPendientesContratoRealPasoA(qr);
      const [filaRec] = await qr.query(`SELECT servicio_id, contrato_id_real FROM cargos_pendientes WHERE id = $1`, [cargoReconexion]);
      const [filaMora] = await qr.query(`SELECT servicio_id, contrato_id_real FROM cargos_pendientes WHERE id = $1`, [cargoMora]);
      assert(filaRec.servicio_id === servicio, 'cargos_pendientes(reconexion).servicio_id == el servicio que lo motivó');
      assert(filaRec.contrato_id_real === contratoReal, 'cargos_pendientes(reconexion).contrato_id_real == el acuerdo real');
      assert(filaMora.servicio_id === null, 'cargos_pendientes(mora).servicio_id queda NULL — la mora es del acuerdo, no de un servicio');
      assert(filaMora.contrato_id_real === contratoReal, 'cargos_pendientes(mora).contrato_id_real == el acuerdo real (la mora SÍ traduce el acuerdo)');
    }
  } finally {
    await qr.rollbackTransaction();
  }
}

async function casoHuerfano(qr: QueryRunner, tabla: string): Promise<void> {
  console.log(`\n[${tabla}] (b) EL QUE IMPORTA — servicio SIN acuerdo (huérfano pre-fase-3b)`);
  await qr.startTransaction();
  try {
    const cliente = await crearCliente(qr, 'b');
    const plan = await crearPlan(qr, 'b');
    // contratoRealId = null → simula un servicio soft-deleted ANTES de la fase 3b, que
    // nunca recibió el backfill de servicios.contrato_id. Es EXACTAMENTE el caso que
    // `huerfanos()` en paso-a-guardas.ts debe detectar.
    const servicioHuerfano = await crearServicio(qr, cliente, plan, null, 'b');

    try {
      if (tabla === 'pagos') {
        await crearPago(qr, cliente, servicioHuerfano, 85);
        await pagosContratoRealPasoA(qr);
      } else if (tabla === 'promesas_pago') {
        await crearPromesa(qr, cliente, servicioHuerfano, 120);
        await promesasPagoContratoRealPasoA(qr);
      } else {
        await crearCargo(qr, cliente, servicioHuerfano, 'servicio', 20);
        await cargosPendientesContratoRealPasoA(qr);
      }
    } catch (err) {
      assert(
        err instanceof PasoAHuerfanoError,
        `la guarda lanza PasoAHuerfanoError (no un error genérico): ${err instanceof Error ? err.message : err}`,
      );

      // El punto central del caso: SIN el guard, un pago huérfano se habría quedado
      // con contrato_id_real en NULL, en silencio, y nadie lo habría notado hasta que
      // alguien lo necesitara. Con el guard, el detenerse ES la protección.
      const [fila] = await qr.query(`SELECT contrato_id_real FROM ${tabla} WHERE cliente_id = $1`, [cliente]);
      assert(fila?.contrato_id_real == null, 'la fila huérfana NO quedó con contrato_id_real escrito a medias');
      return;
    }
    assert(false, `un ${tabla} huérfano NO detuvo la migración — se habría quedado en NULL en silencio (PC-04)`);
  } finally {
    await qr.rollbackTransaction();
  }
}

async function casoDineroNoSeMueve(qr: QueryRunner, tabla: string): Promise<void> {
  console.log(`\n[${tabla}] (c) el dinero no se mueve — SUM por cliente antes == después`);
  await qr.startTransaction();
  try {
    const cliente = await crearCliente(qr, 'c');
    const plan = await crearPlan(qr, 'c');
    const contratoReal = await crearContratoReal(qr, cliente, 'c');
    const servicio = await crearServicio(qr, cliente, plan, contratoReal, 'c');

    const sumaAntes = async (): Promise<string> => {
      const [fila] = await qr.query(
        `SELECT COALESCE(SUM(monto), 0)::text AS total FROM ${tabla} WHERE cliente_id = $1`,
        [cliente],
      );
      return fila.total;
    };

    if (tabla === 'pagos') {
      await crearPago(qr, cliente, servicio, 85);
      const antes = await sumaAntes();
      await pagosContratoRealPasoA(qr);
      assert(antes === await sumaAntes(), 'SUM(pagos.monto) del cliente idéntico antes/después del Paso A');
    } else if (tabla === 'promesas_pago') {
      await crearPromesa(qr, cliente, servicio, 120);
      const [antes] = await qr.query(
        `SELECT COALESCE(SUM(monto_prometido),0)::text AS m, COALESCE(SUM(deuda_al_crear),0)::text AS d
           FROM promesas_pago WHERE cliente_id = $1`, [cliente],
      );
      await promesasPagoContratoRealPasoA(qr);
      const [despues] = await qr.query(
        `SELECT COALESCE(SUM(monto_prometido),0)::text AS m, COALESCE(SUM(deuda_al_crear),0)::text AS d
           FROM promesas_pago WHERE cliente_id = $1`, [cliente],
      );
      assert(antes.m === despues.m && antes.d === despues.d, 'SUM(monto_prometido)/SUM(deuda_al_crear) del cliente idéntico antes/después del Paso A');
    } else {
      await crearCargo(qr, cliente, servicio, 'reconexion', 20);
      await crearCargo(qr, cliente, servicio, 'mora', 15);
      const antes = await sumaAntes();
      await cargosPendientesContratoRealPasoA(qr);
      assert(antes === await sumaAntes(), 'SUM(cargos_pendientes.monto) del cliente idéntico antes/después del Paso A');
    }
  } finally {
    await qr.rollbackTransaction();
  }
}

// Un escenario que revienta por algo que NO es la guarda (p.ej. una columna NOT NULL de
// la semilla que este script no conocía) no debe tapar a los demás: cada `casoX` ya hace
// rollback en su propio `finally`, así que el runner queda limpio para seguir. Sin este
// try/catch, el primer fallo inesperado abortaba TODO el script y dejaba los otros 8
// escenarios sin ejecutar — el peor momento para perder cobertura es cuando algo ya salió
// mal.
async function correr(nombre: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    fallos++;
    console.error(`  ✗ [${nombre}] reventó fuera de una aserción: ${e instanceof Error ? e.stack : e}`);
  }
}

async function main(): Promise<void> {
  await dataSource.initialize();
  const qr = dataSource.createQueryRunner();
  try {
    for (const tabla of ['pagos', 'promesas_pago', 'cargos_pendientes']) {
      await correr(`${tabla}/a`, () => casoTraduccionCorrecta(qr, tabla));
      await correr(`${tabla}/b`, () => casoHuerfano(qr, tabla));
      await correr(`${tabla}/c`, () => casoDineroNoSeMueve(qr, tabla));
    }
  } finally {
    await qr.release();
    await dataSource.destroy();
  }

  console.log(`\n[verificar-paso-a-dinero] ${fallos === 0 ? 'TODO VERDE' : `${fallos} aserción(es)/escenario(s) FALLIDO(s)`}`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('[verificar-paso-a-dinero] Error fatal:', e instanceof Error ? e.stack : e);
  process.exit(1);
});
