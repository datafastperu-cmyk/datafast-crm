-- Ola 4, entregable 3 — medición, no construcción (2026-08-18).
--
-- Pregunta: `facturas.saldo` ya es GENERATED. ¿Un índice parcial sobre `facturas` sostiene,
-- a volumen realista, la misma pregunta que hoy responde el acumulador `servicios.deuda_total`
-- ("¿este contrato debe algo?"), usada como pre-filtro indexado en
-- `cobranza.worker.detectarMorosos()`? Si aguanta, E02-12 se cumple sin inventar nada y el
-- acumulador se retira. Si no, se diseña una proyección — pero solo si este número lo exige.
--
-- Corre SOLO en CI, contra el Postgres 16 efímero del workflow — nunca contra producción.
-- Volumen: 10.000 clientes × 12 meses de facturas (no las 2 facturas reales de producción).
--
-- CORREGIDO 2026-08-18, tras el run 32150016820 (verde, y no midió nada):
--   1. Causa raíz: ADR-031/1791800000047 hace el ERP MONO-EMPRESA
--      (`unica_empresa_por_instalacion`). Crear una segunda empresa para el benchmark violaba
--      esa restricción — el INSERT fallaba, `\gset` nunca corría, y cada sentencia siguiente
--      mandaba el literal `:'empresa_id'` sin resolver: syntax error en cascada, EXPLAIN
--      ANALYZE incluido. Se reutiliza la única empresa que la instalación limpia ya sembró
--      (`1700000010000-SeedInitialData.ts`), y el aislamiento se hace por PREFIJO
--      (`numero_documento`/`numero_contrato`), no por empresa nueva.
--   2. `ON_ERROR_STOP` no estaba activo: psql seguía tras el primer error y salía en 0. Un
--      paso que puede "pasar" sin medir es peor que no tenerlo — afirma que midió cuando no
--      midió nada. Activado aquí (`\set ON_ERROR_STOP on`) y también por el step de CI
--      (`-v ON_ERROR_STOP=1`), que además hace una aserción positiva sobre el log: si
--      "Execution Time" no aparece, el step falla con un mensaje que lo dice — la misma
--      distinción de VIO (que exista la evidencia, no que no haya explotado) aplicada a una
--      medición, no a una operación de hardware.

\set ON_ERROR_STOP on
\timing on

-- ── 1. Empresa existente — el ERP es mono-empresa, no se crea una segunda ────────────────
SELECT id AS empresa_id FROM empresas LIMIT 1 \gset

-- ── 2. Plan propio del benchmark (sin restricción de unicidad que lo impida) ─────────────
INSERT INTO planes (empresa_id, nombre, precio, velocidad_bajada, velocidad_subida)
VALUES (:'empresa_id', 'BENCH — Plan Ola4', 80.00, 50, 20)
RETURNING id AS plan_id \gset

-- ── 3. 10.000 clientes, aislados por prefijo BENCH en numero_documento ───────────────────
INSERT INTO clientes (empresa_id, numero_documento, nombre, apellido_paterno, telefono, direccion)
SELECT :'empresa_id', 'BENCH' || lpad(g::text, 8, '0'), 'Cliente Bench ' || g, 'Apellido',
       '999999999', 'Dirección Bench ' || g
FROM generate_series(1, 10000) AS g;

-- ── 4. Un contrato (acuerdo real) por cliente — la cardinalidad de hoy (D-1/054) ─────────
INSERT INTO contratos (empresa_id, cliente_id, numero_contrato, fecha_inicio)
SELECT c.empresa_id, c.id, 'BENCH-CTR-' || row_number() OVER (ORDER BY c.id),
       CURRENT_DATE - INTERVAL '365 days'
FROM clientes c
WHERE c.empresa_id = :'empresa_id'::uuid
  AND c.numero_documento LIKE 'BENCH%';

-- ── 5. Un servicio por cliente, colgando de su contrato ──────────────────────────────────
INSERT INTO servicios (empresa_id, cliente_id, plan_id, contrato_id, numero_contrato,
                        fecha_inicio, precio_mensual, estado)
SELECT c.empresa_id, c.id, :'plan_id'::uuid, co.id,
       'BENCH-SRV-' || row_number() OVER (ORDER BY c.id),
       CURRENT_DATE - INTERVAL '365 days', 80.00, 'activo'
FROM clientes c
JOIN contratos co ON co.cliente_id = c.id AND co.empresa_id = c.empresa_id
WHERE c.empresa_id = :'empresa_id'::uuid
  AND c.numero_documento LIKE 'BENCH%';

-- ── 6. 12 meses de facturas por contrato (~120.000 filas) ────────────────────────────────
-- ~33% de los clientes quedan con el comprobante del mes más reciente sin pagar (vencida) —
-- proporción arbitraria pero no degenerada: ni todos deben, ni ninguno debe.
INSERT INTO facturas (
  empresa_id, cliente_id, servicio_id, contrato_id,
  tipo_comprobante, serie, correlativo,
  periodo_inicio, periodo_fin, subtotal, igv, total, monto_pagado, estado,
  fecha_emision, fecha_vencimiento
)
SELECT
  s.empresa_id, s.cliente_id, s.id, s.contrato_id,
  'boleta', 'BENCH',
  (row_number() OVER (ORDER BY s.id, m))::int,
  (CURRENT_DATE - (m || ' months')::interval)::date,
  ((CURRENT_DATE - (m || ' months')::interval) + INTERVAL '1 month' - INTERVAL '1 day')::date,
  67.80, 12.20, 80.00,
  CASE WHEN m = 0 AND (row_number() OVER (ORDER BY s.cliente_id)) % 3 = 0 THEN 0 ELSE 80.00 END,
  CASE WHEN m = 0 AND (row_number() OVER (ORDER BY s.cliente_id)) % 3 = 0 THEN 'vencida' ELSE 'pagada' END,
  (CURRENT_DATE - (m || ' months')::interval)::date,
  ((CURRENT_DATE - (m || ' months')::interval) + INTERVAL '5 days')::date
FROM servicios s
JOIN clientes c ON c.id = s.cliente_id
CROSS JOIN generate_series(0, 11) AS m
WHERE s.empresa_id = :'empresa_id'::uuid
  AND c.numero_documento LIKE 'BENCH%';

-- ── 7. Recuento de lo sembrado ────────────────────────────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM clientes  WHERE numero_documento LIKE 'BENCH%') AS clientes,
  (SELECT COUNT(*) FROM contratos WHERE numero_contrato  LIKE 'BENCH%') AS contratos,
  (SELECT COUNT(*) FROM servicios WHERE numero_contrato  LIKE 'BENCH%') AS servicios,
  (SELECT COUNT(*) FROM facturas  WHERE serie = 'BENCH')                AS facturas,
  (SELECT COUNT(*) FROM facturas  WHERE serie = 'BENCH' AND estado = 'vencida') AS facturas_vencidas;

-- ── 8. El índice candidato — predicado inmutable, sin CURRENT_DATE ───────────────────────
-- Mismo criterio que `sqlDeudaExigible()` (facturacion/domain/estados-con-saldo.ts): los
-- estados con saldo, excluyendo notas de crédito (A-5). CURRENT_DATE no puede vivir en un
-- índice parcial (no es inmutable) — por eso "vencida" ya es un ESTADO, no una fecha, y basta.
CREATE INDEX idx_bench_facturas_exigible ON facturas (contrato_id)
  WHERE estado IN ('emitida', 'pagada_parcial', 'vencida', 'en_cobranza')
    AND factura_original_id IS NULL;

ANALYZE facturas;
ANALYZE servicios;
ANALYZE contratos;

-- ── 9. LA MEDICIÓN — reemplaza `co.deuda_total > 0` por un EXISTS contra facturas ────────
-- Mismo filtro que `cobranza.worker.detectarMorosos()` hace hoy sobre `servicios.deuda_total`,
-- reescrito para no leer ningún acumulador: la deuda de un contrato es la existencia de al
-- menos una factura exigible con `saldo > 0`, resuelta contra el índice de arriba.
\echo '--- EXPLAIN ANALYZE: reemplazo de deuda_total > 0 por EXISTS sobre facturas ---'
EXPLAIN (ANALYZE, BUFFERS, TIMING, FORMAT TEXT)
SELECT s.id
  FROM servicios s
  JOIN clientes c ON c.id = s.cliente_id
 WHERE c.numero_documento LIKE 'BENCH%'
   AND s.estado = 'activo'
   AND s.deleted_at IS NULL
   AND EXISTS (
     SELECT 1 FROM facturas f
      WHERE f.contrato_id = s.contrato_id
        AND f.estado IN ('emitida', 'pagada_parcial', 'vencida', 'en_cobranza')
        AND f.factura_original_id IS NULL
        AND f.saldo > 0
   );

\echo '--- Recuento de contratos que la consulta de arriba marca como morosos ---'
SELECT COUNT(*) AS contratos_con_deuda
  FROM servicios s
  JOIN clientes c ON c.id = s.cliente_id
 WHERE c.numero_documento LIKE 'BENCH%'
   AND s.estado = 'activo'
   AND s.deleted_at IS NULL
   AND EXISTS (
     SELECT 1 FROM facturas f
      WHERE f.contrato_id = s.contrato_id
        AND f.estado IN ('emitida', 'pagada_parcial', 'vencida', 'en_cobranza')
        AND f.factura_original_id IS NULL
        AND f.saldo > 0
   );

-- ── 10. Limpieza — deja el Postgres compartido del job como lo encontró ─────────────────
-- Orden FK-safe: facturas → servicios → contratos → clientes → plan. La empresa NO se toca:
-- nunca se creó, se reutilizó la que ya existía.
\echo '--- Limpieza: retirando los datos del benchmark ---'
DELETE FROM facturas  WHERE serie = 'BENCH';
DELETE FROM servicios WHERE numero_contrato LIKE 'BENCH%';
DELETE FROM contratos WHERE numero_contrato LIKE 'BENCH%';
DELETE FROM clientes  WHERE numero_documento LIKE 'BENCH%';
DELETE FROM planes    WHERE id = :'plan_id'::uuid;
