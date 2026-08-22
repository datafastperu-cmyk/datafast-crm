-- Limpieza del banco de pruebas de `medir-deuda-por-facturas.sql` — script propio, no una
-- sección del de siembra, porque entre sembrar y limpiar corre
-- `medir-detectar-morosos.ts` (el camino REAL, no solo la consulta SQL) y necesita los
-- datos sembrados todavía en pie. Orden completo:
--
--   1. medir-deuda-por-facturas.sql   (siembra + mediciones SQL puras)
--   2. medir-detectar-morosos.ts      (SQL + N calcular(), el costo real)
--   3. limpiar-bench-deuda.sql        (este fichero)
--
-- Deja el Postgres compartido del job como lo encontró. Orden FK-safe: facturas →
-- servicios → contratos → clientes → plan. La empresa NO se toca: nunca se creó, se
-- reutilizó la que ya existía (`medir-deuda-por-facturas.sql` §1).
\set ON_ERROR_STOP on

DELETE FROM facturas  WHERE serie = 'BENCH';
DELETE FROM servicios WHERE numero_contrato LIKE 'BENCH%';
DELETE FROM contratos WHERE numero_contrato LIKE 'BENCH%';
DELETE FROM clientes  WHERE numero_documento LIKE 'BENCH%';
DELETE FROM planes    WHERE nombre = 'BENCH — Plan Ola4';
