import { ProvisionFtthService } from './provision-ftth.service';
import { FtthCarrilEstado } from '../entities/ftth-onu-registro.entity';

// El barrido de TTL es lo único que impide que el carril TR-069 quede abierto para siempre
// en todo el parque. A escala de miles de ONUs eso no es pool desperdiciado: con
// PeriodicInform=300s, 5000 carriles vivos son ~17 informs por segundo sostenidos contra
// GenieACS y Mongo. El barrido es la defensa de capacidad del ACS, así que sus criterios
// son una garantía del sistema y llevan test (directriz "VIO hacia adentro").
//
// El defecto que motivó estos tests: el criterio de vencimiento era
// `COALESCE(tr069_ultimo_uso_at, updated_at)`, y `updated_at` lo toca cualquier proceso ajeno
// al TR-069 — el drift-watcher, el refresh de inventario, cualquier UPDATE sobre la fila. La
// consulta decía medir uso del carril y medía actividad de la tabla: un carril sin un solo
// uso real podía no vencer nunca porque otro cron rozó el registro.
describe('ProvisionFtthService — barrido de carriles TR-069 (TTL)', () => {
  const hacer = (candidatos: any[] = []) => {
    const queries: Array<{ sql: string; params: any[] }> = [];
    const desactivados: string[] = [];

    const svc = Object.create(ProvisionFtthService.prototype) as any;
    svc.ds = {
      query: jest.fn(async (sql: string, params?: any[]) => {
        queries.push({ sql, params: params ?? [] });
        if (/COUNT\(\*\)/i.test(sql)) return [{ n: '0' }];
        return candidatos;
      }),
    };
    svc.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    svc.desactivarCarril = jest.fn(async (contratoId: string) => {
      desactivados.push(contratoId);
      return { estado: FtthCarrilEstado.INACTIVO_RESERVADO, mensaje: 'ok' };
    });

    return { svc, queries, desactivados };
  };

  const seleccion = (queries: Array<{ sql: string; params: any[] }>) =>
    queries.find((q) => /FROM\s+ftth_onu_registro/i.test(q.sql) && !/COUNT\(\*\)/i.test(q.sql))!;

  it('mide el no-uso SOLO con tr069_ultimo_uso_at — nunca con updated_at', async () => {
    const { svc, queries } = hacer();
    await svc.barrerCarrilesTr069Inactivos();

    const q = seleccion(queries);
    expect(q.sql).toMatch(/tr069_ultimo_uso_at\s*<\s*NOW\(\)/i);
    // La regresión concreta: si `updated_at` vuelve a entrar en el criterio de vencimiento,
    // el TTL deja de medir uso del carril y vuelve a medir actividad de la tabla.
    expect(q.sql).not.toMatch(/updated_at/i);
    expect(q.sql).not.toMatch(/COALESCE\s*\(\s*tr069_ultimo_uso_at/i);
  });

  it('no desactiva por dato ausente: exige que la marca de uso exista', async () => {
    const { svc, queries } = hacer();
    await svc.barrerCarrilesTr069Inactivos();

    // Un carril sin marca no es un carril vencido: es un carril que no se puede juzgar.
    // Barrerlo sería el falso positivo exacto que este cambio elimina.
    expect(seleccion(queries).sql).toMatch(/tr069_ultimo_uso_at\s+IS\s+NOT\s+NULL/i);
  });

  it('excluye las ONUs cuyo auto-config aún no quedó aplicado', async () => {
    const { svc, queries } = hacer();
    await svc.barrerCarrilesTr069Inactivos();

    // El carril es el único medio de escribir el auto-config (WiFi + credenciales web).
    // Cerrarlo antes de que se aplique deja la ONU sin configurar y sin que nadie se entere:
    // una ONU instalada tarde o apagada puede no informar dentro del TTL.
    const q = seleccion(queries);
    expect(q.sql).toMatch(/contrato_onu_config/i);
    expect(q.sql).toMatch(/last_applied_revision\s*>=\s*cfg\.revision/i);
  });

  it('tiene tope por corrida: el MA5800 admite pocas sesiones VTY concurrentes', async () => {
    const { svc, queries } = hacer();
    await svc.barrerCarrilesTr069Inactivos();

    const q = seleccion(queries);
    expect(q.sql).toMatch(/LIMIT\s+\$2/i);
    expect(q.params[1]).toBe(25);
    // Los más antiguos primero: sin orden, el tope haría que unas pocas filas se barrieran
    // siempre y otras nunca.
    expect(q.sql).toMatch(/ORDER\s+BY\s+r\.tr069_ultimo_uso_at\s+ASC/i);
  });

  it('desactiva los candidatos que el criterio sí devuelve', async () => {
    const { svc, desactivados } = hacer([
      { contrato_id: 'c-1', empresa_id: 'e-1' },
      { contrato_id: 'c-2', empresa_id: 'e-1' },
    ]);
    const r = await svc.barrerCarrilesTr069Inactivos();

    expect(desactivados).toEqual(['c-1', 'c-2']);
    expect(r.every((x: any) => x.ok)).toBe(true);
  });

  it('una desactivación que falla no aborta el resto del barrido', async () => {
    const { svc } = hacer([
      { contrato_id: 'c-1', empresa_id: 'e-1' },
      { contrato_id: 'c-2', empresa_id: 'e-1' },
    ]);
    svc.desactivarCarril = jest.fn(async (contratoId: string) => {
      if (contratoId === 'c-1') throw new Error('OLT inalcanzable');
      return { estado: FtthCarrilEstado.INACTIVO_RESERVADO, mensaje: 'ok' };
    });

    const r = await svc.barrerCarrilesTr069Inactivos();

    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ contratoId: 'c-1', ok: false });
    expect(r[1]).toMatchObject({ contratoId: 'c-2', ok: true });
  });
});
