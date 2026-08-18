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
-- No modifica ninguna tabla de forma permanente: el contenedor de CI se destruye al terminar
-- el job.

\timing on

-- ── 1. Datos base para el benchmark (empresa y plan propios, no colisionan con nada) ──────
INSERT INTO empresas (razon_social, ruc)
VALUES ('Bench Ola4 SA', '20999999999')
RETURNING id AS empresa_id \gset

INSERT INTO planes (empresa_id, nombre, precio, velocidad_bajada, velocidad_subida)
VALUES (:'empresa_id', 'Plan Bench', 80.00, 50, 20)
RETURNING id AS plan_id \gset

-- ── 2. 10.000 clientes ──────────────────────────────────────────────────────────────────
INSERT INTO clientes (empresa_id, numero_documento, nombre, apellido_paterno, telefono, direccion)
SELECT :'empresa_id', lpad(g::text, 8, '0'), 'Cliente Bench ' || g, 'Apellido', '999999999',
       'Dirección Bench ' || g
FROM generate_series(1, 10000) AS g;

-- ── 3. Un contrato (acuerdo real) por cliente — la cardinalidad de hoy (D-1/054) ──────────
INSERT INTO contratos (empresa_id, cliente_id, numero_contrato, fecha_inicio)
SELECT c.empresa_id, c.id, 'CTR-BENCH-' || row_number() OVER (ORDER BY c.id),
       CURRENT_DATE - INTERVAL '365 days'
FROM clientes c
WHERE c.empresa_id = :'empresa_id'::uuid;

-- ── 4. Un servicio por cliente, colgando de su contrato ───────────────────────────────────
INSERT INTO servicios (empresa_id, cliente_id, plan_id, contrato_id, numero_contrato,
                        fecha_inicio, precio_mensual, estado)
SELECT c.empresa_id, c.id, :'plan_id'::uuid, co.id,
       'SRV-BENCH-' || row_number() OVER (ORDER BY c.id),
       CURRENT_DATE - INTERVAL '365 days', 80.00, 'activo'
FROM clientes c
JOIN contratos co ON co.cliente_id = c.id AND co.empresa_id = c.empresa_id
WHERE c.empresa_id = :'empresa_id'::uuid;

-- ── 5. 12 meses de facturas por contrato (~120.000 filas) ─────────────────────────────────
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
  'boleta', 'B001',
  (row_number() OVER (ORDER BY s.id, m))::int,
  (CURRENT_DATE - (m || ' months')::interval)::date,
  ((CURRENT_DATE - (m || ' months')::interval) + INTERVAL '1 month' - INTERVAL '1 day')::date,
  67.80, 12.20, 80.00,
  CASE WHEN m = 0 AND (row_number() OVER (ORDER BY s.cliente_id)) % 3 = 0 THEN 0 ELSE 80.00 END,
  CASE WHEN m = 0 AND (row_number() OVER (ORDER BY s.cliente_id)) % 3 = 0 THEN 'vencida' ELSE 'pagada' END,
  (CURRENT_DATE - (m || ' months')::interval)::date,
  ((CURRENT_DATE - (m || ' months')::interval) + INTERVAL '5 days')::date
FROM servicios s
CROSS JOIN generate_series(0, 11) AS m
WHERE s.empresa_id = :'empresa_id'::uuid;

-- ── 6. Recuento de lo sembrado ──────────────────────────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM clientes  WHERE empresa_id = :'empresa_id'::uuid) AS clientes,
  (SELECT COUNT(*) FROM contratos WHERE empresa_id = :'empresa_id'::uuid) AS contratos,
  (SELECT COUNT(*) FROM servicios WHERE empresa_id = :'empresa_id'::uuid) AS servicios,
  (SELECT COUNT(*) FROM facturas  WHERE empresa_id = :'empresa_id'::uuid) AS facturas,
  (SELECT COUNT(*) FROM facturas  WHERE empresa_id = :'empresa_id'::uuid AND estado = 'vencida') AS facturas_vencidas;

-- ── 7. El índice candidato — predicado inmutable, sin CURRENT_DATE ────────────────────────
-- Mismo criterio que `sqlDeudaExigible()` (facturacion/domain/estados-con-saldo.ts): los
-- estados con saldo, excluyendo notas de crédito (A-5). CURRENT_DATE no puede vivir en un
-- índice parcial (no es inmutable) — por eso "vencida" ya es un ESTADO, no una fecha, y basta.
CREATE INDEX idx_bench_facturas_exigible ON facturas (contrato_id)
  WHERE estado IN ('emitida', 'pagada_parcial', 'vencida', 'en_cobranza')
    AND factura_original_id IS NULL;

ANALYZE facturas;
ANALYZE servicios;
ANALYZE contratos;

-- ── 8. LA MEDICIÓN — reemplaza `co.deuda_total > 0` por un EXISTS contra facturas ─────────
-- Mismo filtro que `cobranza.worker.detectarMorosos()` hace hoy sobre `servicios.deuda_total`,
-- reescrito para no leer ningún acumulador: la deuda de un contrato es la existencia de al
-- menos una factura exigible con `saldo > 0`, resuelta contra el índice de arriba.
\echo '--- EXPLAIN ANALYZE: reemplazo de deuda_total > 0 por EXISTS sobre facturas ---'
EXPLAIN (ANALYZE, BUFFERS, TIMING, FORMAT TEXT)
SELECT s.id
  FROM servicios s
 WHERE s.empresa_id = :'empresa_id'::uuid
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
 WHERE s.empresa_id = :'empresa_id'::uuid
   AND s.estado = 'activo'
   AND s.deleted_at IS NULL
   AND EXISTS (
     SELECT 1 FROM facturas f
      WHERE f.contrato_id = s.contrato_id
        AND f.estado IN ('emitida', 'pagada_parcial', 'vencida', 'en_cobranza')
        AND f.factura_original_id IS NULL
        AND f.saldo > 0
   );
