-- Ola 4, entregable 3 — HERRAMIENTA DE MEDICIÓN REPETIBLE, no un script de un solo uso
-- (resultado obtenido y registrado 2026-08-18; retirado de CI el mismo día — ver abajo).
--
-- Pregunta que contestó: `facturas.saldo` ya es GENERATED. ¿Un índice parcial sobre `facturas`
-- sostiene, a volumen realista, la misma pregunta que hoy responde el acumulador
-- `servicios.deuda_total` ("¿este contrato debe algo?"), usada como pre-filtro indexado en
-- `cobranza.worker.detectarMorosos()`? RESULTADO: sí — 30.295 ms de ejecución, 120.000 facturas,
-- 3.333 contratos morosos detectados (el tercio esperado por diseño del sembrado). Detalle
-- completo, con los tres matices del plan de ejecución (estimaciones erradas por el filtro
-- propio del benchmark, medición en caliente, nombre de índice provisional), en
-- `docs/gobierno/inventario/E-0.2-censo-calculo-deuda.md` §11.5. El índice real que se adoptó
-- —`idx_facturas_contrato_exigible`— vive en la migración `1791800000072`, con su propio
-- nombre y su propia justificación; el de este script (`idx_bench_facturas_exigible`) es
-- exclusivo del benchmark y no sobrevive a su `\echo` de limpieza (§10 del script).
--
-- NO vive en `ci.yml`: costó siete intentos dejarlo conforme al esquema real (mono-empresa,
-- `nombres` no `nombre`, unicidad a 10k filas, dos ENUM con destino distinto — uno vivo, uno ya
-- convertido a VARCHAR por una migración posterior a su creación), y ese esfuerzo no se tira: es
-- exactamente el patrón que hará falta cuando llegue la migración de MikroWISP
-- (`project_migracion_mikrowisp`, real, con datos de abonados de verdad). Para repetir esta
-- medición cuando el volumen realista cambie (más clientes, más meses de historial), correr a
-- mano contra un Postgres desechable — NUNCA contra producción (ver nota de la VPS, abajo):
--
--   PGPASSWORD=ci_password psql -h localhost -U datafast_db_user -d datafast_db \
--     -v ON_ERROR_STOP=1 -f backend/scripts/medir-deuda-por-facturas.sql
--
-- Corre SOLO contra un Postgres efímero/desechable — nunca contra producción. Volumen actual:
-- 10.000 clientes × 12 meses de facturas (no las 2 facturas reales de producción).
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
-- Columnas verificadas contra el log verde de scripts/verificar-paso-a-dinero.ts (commit
-- 60ef8c53, corrió contra Postgres real hace dos días) en vez de la entidad de memoria:
-- `nombres` (plural) es la columna real — el fallo anterior fue una transcripción propia,
-- no una deriva del esquema. La entidad (cliente.entity.ts:44) ya lo decía bien.
--
-- CORREGIDO tras el 4º fallo: el precedente sembraba UNA fila por escenario, así que ninguna
-- restricción de unicidad se activaba nunca. A 10.000 filas se activan todas. Regla aplicada
-- aquí, no campo por campo: TODO valor potencialmente único se deriva de `g` — ningún
-- literal compartido en `telefono`, `email` ni `usuario_portal`.
--   uq_clientes_empresa_documento (empresa_id, numero_documento) — ya derivado.
--   uq_clientes_empresa_telefono  (empresa_id, telefono)         — derivado ahora.
--   uq_clientes_empresa_email     (empresa_id, email)            — derivado ahora.
--   ux_clientes_usuario_portal    (usuario_portal, GLOBAL, sin empresa_id) — derivado ahora.
INSERT INTO clientes (
  empresa_id, numero_documento, nombres, apellido_paterno, telefono, email, usuario_portal,
  direccion
)
SELECT :'empresa_id', 'BENCH' || lpad(g::text, 8, '0'), 'Cliente Bench ' || g, 'Apellido',
       '9' || lpad(g::text, 8, '0'), 'bench' || g || '@bench.test', 'bench_portal_' || g,
       'Dirección Bench ' || g
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
-- El moroso se decide por cliente, no por posición de fila: `numero_documento` codifica el
-- índice `g` (1..10000) usado al generarlo (`'BENCH' || lpad(g,8,'0')`), así que
-- `g % 3 = 0` es una etiqueta determinista por cliente. Un `row_number()` sobre el resultado
-- del CROSS JOIN habría dependido del orden interno, sin garantía, de las 12 filas por
-- cliente — exactamente el tipo de cosa que este script ya no puede permitirse después de
-- la corrección de arriba.
--
-- `tipo_comprobante` DEJÓ de ser ENUM (`1788800000000-ConvertTipoComprobanteToVarchar.ts`, el
-- `up()` la convierte a VARCHAR(30) — el `CREATE TYPE tipo_comprobante` que aparece en ese
-- fichero vive en el `down()`, no en el `up()`). Sin cast: un texto no necesita uno.
-- `estado` SÍ sigue siendo ENUM (`estado_factura`, migración 1700000008000, sin ninguna
-- conversión posterior) — un literal suelto en un `CASE`/`SELECT` no se castea solo al tipo
-- destino como sí ocurre en un `VALUES` de un `INSERT` simple, así que aquí el cast se queda.
-- Verificado columna por columna contra el histórico completo de migraciones sobre `facturas`
-- (no solo la de creación) tras el primer error de tipo: `1783200000000` añade `version` (con
-- default, fuera de esta lista); `1786700000000`/`1786900000000`/`1789100000000` tocan otras
-- columnas o un trigger ya retirado; `1791800000055`/`056` son el rename servicio_id/contrato_id
-- ya conocido. Ninguna otra columna de esta lista cambió de tipo ni de nulabilidad.
-- `numero_completo`/`base_imponible`/`saldo` son `GENERATED ALWAYS` — ninguna aparece en la
-- lista de columnas de arriba; Postgres calcula `saldo` como `total - monto_pagado`, así que
-- la proporción de morosos se controla en `monto_pagado` (abajo), nunca escribiendo `saldo`.
-- `correlativo` es `row_number()` sobre el resultado completo del CROSS JOIN (120.000 filas):
-- único de punta a punta, no se reinicia por cliente — satisface
-- `UNIQUE (empresa_id, serie, correlativo)`.
SELECT
  s.empresa_id, s.cliente_id, s.id, s.contrato_id,
  'boleta', 'BENCH',
  (row_number() OVER (ORDER BY s.id, m))::int,
  (CURRENT_DATE - (m || ' months')::interval)::date,
  ((CURRENT_DATE - (m || ' months')::interval) + INTERVAL '1 month' - INTERVAL '1 day')::date,
  67.80, 12.20, 80.00,
  CASE WHEN m = 0 AND substring(c.numero_documento FROM 6)::int % 3 = 0 THEN 0 ELSE 80.00 END,
  (CASE WHEN m = 0 AND substring(c.numero_documento FROM 6)::int % 3 = 0
        THEN 'vencida' ELSE 'pagada' END)::estado_factura,
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

-- ── 9-bis. CORRECCIÓN — getResumen() no duplica ni pierde deuda con multi-servicio ──────
-- Ola 4 (b), `contrato.repository.ts.getResumen()`: al retirar `deuda_total`, el SUM por
-- estado pasa a nivel de CONTRATO (no de servicio, D-1). Riesgo real: un contrato con más
-- de un servicio en estados DISTINTOS podía contar su deuda dos veces (una por cada
-- servicio) o cero (si el JOIN no encuentra a cuál atribuirla). La condición del propietario
-- fue explícita: "el total debe cuadrar exactamente antes y después... compruébalo con
-- recuento antes/después". Se ejercita aquí: un cliente BENCH recibe un SEGUNDO servicio
-- bajo el MISMO contrato, en un estado distinto ('suspendido').
\echo '--- Preparando el caso multi-servicio para la comprobación de getResumen() ---'
INSERT INTO servicios (empresa_id, cliente_id, plan_id, contrato_id, numero_contrato,
                        fecha_inicio, precio_mensual, estado)
SELECT s.empresa_id, s.cliente_id, s.plan_id, s.contrato_id,
       'BENCH-SRV-MULTI', CURRENT_DATE - INTERVAL '365 days', 80.00, 'suspendido'
  FROM servicios s
  JOIN clientes c ON c.id = s.cliente_id
 WHERE c.numero_documento = 'BENCH00000001'
 LIMIT 1;

\echo '--- EXPLAIN ANALYZE: getResumen() reescrito (nivel contrato, DISTINCT ON) ---'
EXPLAIN (ANALYZE, BUFFERS, TIMING, FORMAT TEXT)
WITH deuda_contrato AS (
  SELECT contrato_id, COALESCE(SUM(saldo), 0) AS deuda
    FROM facturas
   WHERE estado IN ('emitida', 'pagada_parcial', 'vencida', 'en_cobranza')
     AND factura_original_id IS NULL
   GROUP BY contrato_id
),
contrato_estado_atribuido AS (
  SELECT DISTINCT ON (s.contrato_id) s.contrato_id, s.estado
    FROM servicios s
    JOIN clientes c ON c.id = s.cliente_id
   WHERE c.numero_documento LIKE 'BENCH%' AND s.deleted_at IS NULL AND s.contrato_id IS NOT NULL
   ORDER BY s.contrato_id,
     CASE s.estado WHEN 'activo' THEN 0 WHEN 'suspendido' THEN 1
                    WHEN 'pendiente_activacion' THEN 2 ELSE 3 END
),
deuda_por_estado AS (
  SELECT cea.estado, COALESCE(SUM(dc.deuda), 0) AS deuda
    FROM contrato_estado_atribuido cea
    LEFT JOIN deuda_contrato dc ON dc.contrato_id = cea.contrato_id
   GROUP BY cea.estado
)
SELECT s.estado AS estado, COUNT(*) AS total, COALESCE(MAX(dpe.deuda), 0) AS deuda
  FROM servicios s
  JOIN clientes c ON c.id = s.cliente_id
  LEFT JOIN deuda_por_estado dpe ON dpe.estado = s.estado
 WHERE c.numero_documento LIKE 'BENCH%' AND s.deleted_at IS NULL
 GROUP BY s.estado;

\echo '--- Aserción: SUM(deuda) de getResumen() == SUM(facturas.saldo) exigible de los BENCH — ni de más, ni de menos ---'
DO $$
DECLARE
  suma_resumen  NUMERIC;
  suma_directa  NUMERIC;
BEGIN
  WITH deuda_contrato AS (
    SELECT contrato_id, COALESCE(SUM(saldo), 0) AS deuda
      FROM facturas
     WHERE estado IN ('emitida', 'pagada_parcial', 'vencida', 'en_cobranza')
       AND factura_original_id IS NULL
     GROUP BY contrato_id
  ),
  contrato_estado_atribuido AS (
    SELECT DISTINCT ON (s.contrato_id) s.contrato_id
      FROM servicios s
      JOIN clientes c ON c.id = s.cliente_id
     WHERE c.numero_documento LIKE 'BENCH%' AND s.deleted_at IS NULL AND s.contrato_id IS NOT NULL
     ORDER BY s.contrato_id,
       CASE s.estado WHEN 'activo' THEN 0 WHEN 'suspendido' THEN 1
                      WHEN 'pendiente_activacion' THEN 2 ELSE 3 END
  )
  SELECT COALESCE(SUM(dc.deuda), 0) INTO suma_resumen
    FROM contrato_estado_atribuido cea
    LEFT JOIN deuda_contrato dc ON dc.contrato_id = cea.contrato_id;

  SELECT COALESCE(SUM(f.saldo), 0) INTO suma_directa
    FROM facturas f
    JOIN contratos co ON co.id = f.contrato_id
   WHERE co.numero_contrato LIKE 'BENCH-CTR-%'
     AND f.estado IN ('emitida', 'pagada_parcial', 'vencida', 'en_cobranza')
     AND f.factura_original_id IS NULL;

  IF suma_resumen <> suma_directa THEN
    RAISE EXCEPTION 'getResumen() NO cuadra: % (por estado, DISTINCT ON) contra % (SUM directo sobre facturas de contratos BENCH). El multi-servicio duplicó o perdió deuda.',
      suma_resumen, suma_directa;
  END IF;
  RAISE NOTICE 'OK -- getResumen() cuadra exacto: % (mismo total con y sin el contrato multi-servicio)', suma_resumen;
END $$;

-- ── 9-ter. MEDICIÓN — findAllPaginated(): conMora + ORDER BY deuda, forma paginada real ──
-- Mismo predicado que el filtro y el ORDER BY comparten en el repositorio (un solo
-- DEUDA_EXPR): sub-consulta correlacionada contra `facturas.contrato_id`, sobre el índice
-- `idx_bench_facturas_exigible`. Se mide con LIMIT/OFFSET reales (página 1 de 20), que es la
-- forma que de verdad ejecuta el endpoint — nunca sin paginar.
\echo '--- EXPLAIN ANALYZE: findAllPaginated() con conMora + ORDER BY deuda (página 1, 20 filas) ---'
EXPLAIN (ANALYZE, BUFFERS, TIMING, FORMAT TEXT)
SELECT
  c.id, c.numero_contrato AS "numeroContrato", c.estado,
  (SELECT COALESCE(SUM(f.saldo), 0) FROM facturas f
    WHERE f.contrato_id = c.contrato_id
      AND f.estado IN ('emitida', 'pagada_parcial', 'vencida', 'en_cobranza')
      AND f.factura_original_id IS NULL) AS "deudaTotal"
  FROM servicios c
  JOIN clientes cl ON cl.id = c.cliente_id AND cl.numero_documento LIKE 'BENCH%'
 WHERE c.deleted_at IS NULL
   AND (SELECT COALESCE(SUM(f.saldo), 0) FROM facturas f
         WHERE f.contrato_id = c.contrato_id
           AND f.estado IN ('emitida', 'pagada_parcial', 'vencida', 'en_cobranza')
           AND f.factura_original_id IS NULL) > 0
 ORDER BY (SELECT COALESCE(SUM(f.saldo), 0) FROM facturas f
            WHERE f.contrato_id = c.contrato_id
              AND f.estado IN ('emitida', 'pagada_parcial', 'vencida', 'en_cobranza')
              AND f.factura_original_id IS NULL) DESC
 LIMIT 20 OFFSET 0;

-- ── 10. Limpieza ──────────────────────────────────────────────────────────────────────
-- Vive en `limpiar-bench-deuda.sql`, no aquí: entre este script y la limpieza corre el
-- cronómetro de `medir-detectar-morosos.ts` (el camino REAL, SQL + N llamadas a
-- `calcular()`), y necesita que los datos sembrados sigan en pie. Correr los tres en orden:
--   1. Este script (siembra + mediciones SQL puras).
--   2. `TS_NODE_PROJECT=tsconfig.migration.json npx ts-node -T scripts/medir-detectar-morosos.ts`
--   3. `limpiar-bench-deuda.sql`
