import { analizar } from './lotes-sin-cap';

/**
 * PA-15 — **los lotes de fondo llevan tope** (2026-08-10).
 *
 * Un lote sin límite no se degrada al crecer: se cae de golpe el día que el volumen pasa un
 * umbral que nadie conoce. Y contra hardware es peor que caerse — el MA5800 tiene un límite bajo
 * de sesiones VTY concurrentes, y un barrido sin cap ya produjo 1788 reintentos en cuatro días.
 *
 * **El pendiente decía «30 de 33 consultas de fondo sin cap» y no había forma de comprobarlo.**
 * Ahora la hay, y el número era otro: de 74 lotes reales, 16 no llevan tope. La diferencia no es
 * que se arreglara nada — es que el primer recuento contaba agregados, comprobaciones de
 * existencia, búsquedas por clave y subconsultas de pertenencia, donde un `LIMIT` no significa
 * nada o directamente cambiaría el resultado.
 *
 * Es la segunda vez en el día que un número de una ficha resulta estar inflado, después de los
 * «102 endpoints abiertos» de B-3 que eran 99. Un informe que exagera se deja de leer.
 *
 * **Esta barrera congela, no exige cero.** Acotar cada consulta no es poner `LIMIT`: hace falta un
 * `ORDER BY` estable y comprobar que lo procesado deja de casar con el filtro, o el lote se come
 * siempre las mismas filas y mata de hambre al resto. Eso es trabajo caso por caso.
 */
describe('PA-15 · Lotes de fondo con tope', () => {
  const { total, lotes } = analizar();

  /**
   * Techo medido el 2026-08-10. **Puede bajar, nunca subir.**
   *
   * De los 16, ocho están acotados por naturaleza y no urgen: `empresas` tiene una fila por
   * instalación (ADR-031, mono-empresa), `watcher_heartbeat` unas cuarenta y siete, `routers` y
   * `olt_dispositivos` un puñado. Los que crecen con el parque —`facturas`, `pagos`, `servicios`,
   * `notificaciones_logs`, `vpn_clientes`, `ftth_onu_registro`— son los que hay que atacar primero.
   */
  const TECHO = 16;

  it('ningún lote de fondo nuevo se queda sin tope', () => {
    // Si esto falla en una consulta NUEVA: añade `ORDER BY` estable y `LIMIT`, y comprueba que
    // lo procesado deja de casar con el filtro. Subir el techo NO es la salida.
    expect(lotes.length).toBeLessThanOrEqual(TECHO);
  });

  it('el análisis sigue viendo el conjunto completo', () => {
    // Si `total` se desploma, es que el detector dejó de reconocer los ficheros de fondo —y un
    // techo que se cumple porque no se mira nada es peor que no tener techo.
    expect(total).toBeGreaterThan(60);
  });

  it('el camino contra hardware sigue acotado', () => {
    // El outbox es el que habla con el MikroTik y la OLT. Su reclamo atómico lleva
    // `ORDER BY creado_en LIMIT 10 FOR UPDATE SKIP LOCKED`: si alguien se lo quita, el lote deja
    // de tener freno justo donde más caro sale.
    const outbox = lotes.filter((l) => l.fichero.includes('outbox-red') && l.tabla === 'comandos_red_pendientes');
    expect(outbox.map((l) => l.fragmento)).not.toContain(expect.stringContaining('FOR UPDATE SKIP LOCKED'));
  });
});
