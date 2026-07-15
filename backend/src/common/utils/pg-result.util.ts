// El driver Postgres de TypeORM devuelve, para UPDATE/DELETE en query() raw,
// el par [filas, rowCount] — NO las filas directamente (INSERT y SELECT sí
// devuelven filas). Consumir el resultado sin normalizar produce bugs
// silenciosos: `.length` siempre 2, arrays vacíos truthy, campos undefined.
// Usar SIEMPRE este helper al leer el resultado de un UPDATE/DELETE ... RETURNING.
export function filasUpdateReturning<T>(result: unknown): T[] {
  if (
    Array.isArray(result) &&
    result.length === 2 &&
    Array.isArray(result[0]) &&
    typeof result[1] === 'number'
  ) {
    return result[0] as T[];
  }
  return Array.isArray(result) ? (result as T[]) : [];
}
