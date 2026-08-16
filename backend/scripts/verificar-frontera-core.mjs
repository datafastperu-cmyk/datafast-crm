// Barreras de frontera del Core — Ola 0 (F-0.1-A §6, orden 2 y 3). Dos invariantes de
// E-0.2 §13, ambas de tipo «Esquema» (F-0.1-A §4.1), leídas del mismo volcado de
// `information_schema` que ya produce el paso «Volcar esquema resultante» del CI.
//
//   E02-10 — «El Core no almacena identificadores ni recursos de proveedor como autoridad»
//            (E-0.2 §12: ONU · service-port · PON · VLAN · IP · queue · credenciales de
//            proveedor · identificadores de fabricante · estado técnico). El invariante que
//            más deuda impide reintroducir (F-0.1-A §6, orden 2).
//   E02-08 — «El Cliente no tiene estado contractual almacenado» (E-0.2 §13). Trivial y de
//            alto valor (F-0.1-A §6, orden 3): se deriva de los servicios, nunca se guarda.
//
// Las dos FALLABAN al enchufarlas — es lo esperado (aviso explícito del propietario,
// 2026-08-16). No se apagan ni se ajustan para que el build pase: cada una declara su
// TECHO como deuda congelada (regla 5 del anexo, mismo mecanismo que
// `TECHO_TABLAS_COMPARTIDAS` en `propiedad-tablas.ts`) — puede bajar, nunca subir sin ADR.
//
// Uso:  node scripts/verificar-frontera-core.mjs <schema.txt>
// Mismo formato de entrada que verificar-sql.mjs: `tabla:col1,col2,...` por línea.

import { readFileSync } from 'fs';

const SCHEMA_FILE = process.argv[2];
if (!SCHEMA_FILE) {
  console.error('Uso: node scripts/verificar-frontera-core.mjs <schema.txt>');
  process.exit(2);
}

// Tablas del Core comercial hoy (E-0.2 §11 D-3, D-1) — antes de que la Ola 2/3/4 separe
// Servicio Contratado y Cuenta de Facturación en tablas propias. Mismo universo que
// `inventario-bloque.ts` BLOQUES.A.semillas; se duplica aquí a propósito porque ese fichero
// es TypeScript y este es un script de CI plano — si el Core gana/pierde una tabla, actualizar
// las dos listas es responsabilidad de quien haga el cambio de esquema.
const TABLAS_CORE = ['clientes', 'contratos', 'servicios', 'servicios_historial', 'facturas', 'pagos'];

// No es exhaustiva ni puede serlo (E-0.2 §12: «en ningún caso»). Cada patrón es vocabulario
// de un dominio técnico concreto que el Core no debe conocer. Un falso positivo se corrige
// afinando el patrón, no borrándolo.
const PATRONES_PROVEEDOR = [
  [/\bonu_id\b/i, 'identificador de ONU (olt-nativo/smartolt)'],
  [/\bont_id\b|\bpon_id\b/i, 'identificador GPON (olt-nativo)'],
  [/\brouter_id\b/i, 'identificador de router (mikrotik)'],
  [/\bnodo_id\b/i, 'identificador de nodo de red (mikrotik)'],
  [/\bsegmento_id\b/i, 'identificador de segmento IPv4 (mikrotik/IPAM)'],
  [/\bantena_ap_id\b/i, 'identificador de antena (monitoreo)'],
  [/\bip_asignada\b|\bip_mikrotik_asignada\b|\bip_administracion\b/i, 'IP de proveedor'],
  [/\bmac_address\b/i, 'identificador de fabricante (MAC)'],
  [/\bvlan\w*/i, 'VLAN (mikrotik)'],
  [/pppoe/i, 'credencial PPPoE (mikrotik)'],
  [/\bnombre_queue\b/i, 'recurso de queue (mikrotik)'],
  [/\bcomunidad_snmp\b/i, 'credencial SNMP (monitoreo)'],
  [/antena/i, 'config de antena WISP (mikrotik)'],
  [/^caja_nap$|^puerto_nap$/i, 'recurso de planta externa (NAP)'],
  [/^hardware_/i, 'estado técnico como autoridad (E-0.2 §12)'],
  [/service_port/i, 'service-port GPON (olt-nativo)'],
  [/\bssid\b|password_wifi/i, 'credencial de CPE (gestión de equipo)'],
];

const tablas = new Map();
for (const linea of readFileSync(SCHEMA_FILE, 'utf8').split('\n')) {
  const i = linea.indexOf(':');
  if (i < 0) continue;
  const tabla = linea.slice(0, i).trim();
  if (!tabla) continue;
  tablas.set(tabla, linea.slice(i + 1).trim().split(',').map((c) => c.trim()).filter(Boolean));
}

const hallazgos = [];
for (const tabla of TABLAS_CORE) {
  const cols = tablas.get(tabla);
  if (!cols) continue; // la Ola 2/3/4 puede renombrar/retirar la tabla; no es error de este script
  for (const col of cols) {
    for (const [patron, motivo] of PATRONES_PROVEEDOR) {
      if (patron.test(col)) { hallazgos.push({ tabla, col, motivo }); break; }
    }
  }
}

console.log(`Columnas de proveedor en tablas del Core: ${hallazgos.length}\n`);
for (const h of hallazgos.sort((a, b) => a.tabla.localeCompare(b.tabla) || a.col.localeCompare(b.col))) {
  console.log(`  ${h.tabla}.${h.col}  —  ${h.motivo}`);
}

// Deuda congelada por ADR-032 §4.4: puede bajar, nunca subir. 22 = la foto de la Ola 0
// (2026-08-16), toda en `servicios`. Subir este número exige ADR, igual que
// TECHO_TABLAS_COMPARTIDAS.
const TECHO_COLUMNAS_PROVEEDOR_EN_CORE = 22;

if (hallazgos.length > TECHO_COLUMNAS_PROVEEDOR_EN_CORE) {
  console.error(`\nFALLA: ${hallazgos.length} > techo congelado (${TECHO_COLUMNAS_PROVEEDOR_EN_CORE}). ` +
    'Una columna nueva de proveedor en el Core no se acepta ni como deuda: E02-10 es el ' +
    'invariante de mayor valor de esta fase (F-0.1-A §6).');
  process.exit(1);
}
if (hallazgos.length < TECHO_COLUMNAS_PROVEEDOR_EN_CORE) {
  console.error(`\nFALLA: ${hallazgos.length} < techo declarado (${TECHO_COLUMNAS_PROVEEDOR_EN_CORE}). ` +
    'El techo bajó — es progreso real. Actualizar TECHO_COLUMNAS_PROVEEDOR_EN_CORE en este ' +
    'script para que quede congelado en el nuevo número (mismo criterio que ' +
    '`propiedad-tablas.spec.ts`: un manifiesto no arrastra deuda ya corregida).');
  process.exit(1);
}
console.log(`\nE02-10 — deuda declarada (Ola 0, F-0.1-A §6): ${TECHO_COLUMNAS_PROVEEDOR_EN_CORE}. Sin cambios.`);

// ═══════════════════════════════════════════════════════════════════════════
// E02-08 — El Cliente no tiene estado contractual almacenado
// ═══════════════════════════════════════════════════════════════════════════
// `clientes.estado` (+ `fecha_estado`, `motivo_estado`, su metadata inseparable) es estado
// contractual guardado en el Cliente — exactamente lo que E02-08 prohíbe: se calcula al leer
// desde los servicios del contrato (E-0.2 D-5), nunca se escribe en Cliente. Hoy SÍ se
// escribe (`contratos.service.ts` hace `UPDATE clientes SET estado = ...`), y por eso F-0.1
// §6 registra «tres portadores del mismo estado».
console.log('\n─────────────────────────────────────────');
const COLUMNAS_ESTADO_CLIENTE = ['estado', 'fecha_estado', 'motivo_estado'];
const colsCliente = tablas.get('clientes') ?? [];
const estadoEnCliente = COLUMNAS_ESTADO_CLIENTE.filter((c) => colsCliente.includes(c));

console.log(`Columnas de estado contractual en \`clientes\`: ${estadoEnCliente.length}`);
for (const c of estadoEnCliente) console.log(`  clientes.${c}`);

// Deuda congelada: 3 = la foto de la Ola 0 (2026-08-16). Baja a 0 cuando Ola 5 retire las
// columnas y el estado se derive de los servicios del contrato (E-0.2 D-5, E02-06/07/08).
const TECHO_COLUMNAS_ESTADO_CLIENTE = 3;

if (estadoEnCliente.length > TECHO_COLUMNAS_ESTADO_CLIENTE) {
  console.error(`\nFALLA: ${estadoEnCliente.length} > techo congelado (${TECHO_COLUMNAS_ESTADO_CLIENTE}). ` +
    'Una columna nueva de estado en Cliente no se acepta ni como deuda: E02-08 es trivial y de ' +
    'alto valor (F-0.1-A §6) — no debería crecer nunca.');
  process.exit(1);
}
if (estadoEnCliente.length < TECHO_COLUMNAS_ESTADO_CLIENTE) {
  console.error(`\nFALLA: ${estadoEnCliente.length} < techo declarado (${TECHO_COLUMNAS_ESTADO_CLIENTE}). ` +
    'El techo bajó — es progreso real (probablemente la Ola 5). Actualizar ' +
    'TECHO_COLUMNAS_ESTADO_CLIENTE en este script para que quede congelado en el nuevo número.');
  process.exit(1);
}
console.log(`\nE02-08 — deuda declarada (Ola 0, F-0.1-A §6): ${TECHO_COLUMNAS_ESTADO_CLIENTE}. Sin cambios.`);
process.exit(0);
