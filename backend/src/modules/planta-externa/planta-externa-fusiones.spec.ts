import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';

import { PlantaExternaService } from './planta-externa.service';
import { PeFibraHilo, HiloEstado } from './entities/pe-fibra-hilo.entity';
import { PeFusion } from './entities/pe-fusion.entity';

/**
 * Reglas de fusión dentro de una mufa.
 *
 * El invariante "un hilo se fusiona UNA sola vez" lo garantizan dos índices únicos
 * parciales en la BD y ya está probado contra Postgres. Lo que se prueba aquí es lo que
 * la base de datos NO puede expresar: la **pertenencia**.
 *
 * Sin ese guard, un UUID mal copiado permitiría fusionar el hilo de un cable de otra zona
 * con uno de esta mufa. El registro resultante sería perfectamente válido para el esquema
 * —dos UUIDs distintos, ninguna restricción violada— y el recorrido del grafo devolvería
 * una ruta que no existe físicamente. Es el peor tipo de error: silencioso y creíble.
 */
describe('PlantaExternaService — fusiones', () => {
  let service: PlantaExternaService;
  let em: any;

  const EMPRESA = 'emp-001';
  const MUFA    = 'mufa-001';

  /** Segmentos que tocan la mufa (universo legal de hilos fusionables aquí). */
  let segmentosDeLaMufa: { id: string }[];
  /** Hilos que existen, con el segmento al que pertenecen. */
  let hilos: { id: string; numero: number; segmentoId: string }[];
  /** Fusión previa devuelta por la búsqueda de idempotencia. */
  let fusionExistente: any;

  beforeEach(async () => {
    segmentosDeLaMufa = [{ id: 'seg-A' }, { id: 'seg-B' }];
    hilos = [
      { id: 'hilo-a1', numero: 1, segmentoId: 'seg-A' },
      { id: 'hilo-b1', numero: 1, segmentoId: 'seg-B' },
      { id: 'hilo-x9', numero: 9, segmentoId: 'seg-OTRA-ZONA' },
    ];
    fusionExistente = null;

    em = {
      findOne: jest.fn(async (entidad: any, opts: any) => {
        if (opts?.where?.id === MUFA) return { id: MUFA, codigo: 'MUFA-07' };
        return null;
      }),
      find: jest.fn(async (_e: any, opts: any) => {
        const ids = (opts.where as any[]).map((w) => w.id);
        return hilos.filter((h) => ids.includes(h.id));
      }),
      createQueryBuilder: jest.fn((entidad: any) => {
        const qb: any = {
          select:    () => qb,
          where:     () => qb,
          andWhere:  () => qb,
          getRawMany: async () => segmentosDeLaMufa,
          getOne:     async () => fusionExistente,
        };
        return qb;
      }),
      save:   jest.fn(async (x: any) => ({ ...x, id: 'fusion-nueva' })),
      create: jest.fn((_e: any, d: any) => d),
      update: jest.fn(async () => ({})),
      count:  jest.fn(async () => 0),
      softDelete: jest.fn(async () => ({})),
    };

    const mockDs = { transaction: jest.fn(async (cb: any) => cb(em)), getRepository: jest.fn() };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        PlantaExternaService,
        { provide: getDataSourceToken(), useValue: mockDs },
      ],
    }).compile();

    service = mod.get(PlantaExternaService);
  });

  const fusionar = (a: string, b: string) =>
    service.crearFusion(EMPRESA, MUFA, { hiloAId: a, hiloBId: b });

  // ───────────────────────────────────────────────────────────────
  describe('pertenencia: sólo se fusionan hilos de cables que llegan a ESTA mufa', () => {

    it('dos hilos de cables que llegan a la mufa → aplicado', async () => {
      const r = await fusionar('hilo-a1', 'hilo-b1');
      expect(r.clase).toBe('aplicado');
    });

    it('un hilo de un cable de OTRA zona → rechazado_definitivo', async () => {
      // El registro sería válido para el esquema: dos UUIDs distintos, ninguna
      // restricción violada. El grafo devolvería una ruta que no existe en la calle.
      const r = await fusionar('hilo-a1', 'hilo-x9');

      expect(r.clase).toBe('rechazado_definitivo');
      expect('motivo' in r && r.motivo).toContain('no llega a la mufa');
      expect(em.save).not.toHaveBeenCalled();
    });

    it('el motivo nombra el hilo y la mufa: un UUID no le dice nada a un técnico', async () => {
      const r = await fusionar('hilo-x9', 'hilo-a1');
      const motivo = 'motivo' in r ? r.motivo : '';
      expect(motivo).toContain('9');          // número de hilo
      expect(motivo).toContain('MUFA-07');    // código de mufa
    });

    it('un hilo inexistente → rechazado_definitivo, no explota', async () => {
      const r = await fusionar('hilo-a1', 'hilo-fantasma');
      expect(r.clase).toBe('rechazado_definitivo');
      expect(em.save).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────────────────────
  describe('idempotencia y errores de dedo', () => {

    it('un hilo consigo mismo se rechaza ANTES de tocar la BD', async () => {
      // Es un typo de un dígito en un formulario de 48 filas, y crea un lazo que el
      // recorrido del grafo tendría que detectar en tiempo de consulta.
      const r = await fusionar('hilo-a1', 'hilo-a1');

      expect(r.clase).toBe('rechazado_definitivo');
      expect(em.findOne).not.toHaveBeenCalled();
    });

    it('la misma pareja ya fusionada → ya_en_destino (ÉXITO), no error', async () => {
      fusionExistente = { id: 'fusion-previa' };

      const r = await fusionar('hilo-a1', 'hilo-b1');

      expect(r.clase).toBe('ya_en_destino');
      expect(em.save).not.toHaveBeenCalled();
    });

    it('un hilo ya fusionado con OTRO hilo → rechazo explicado, no un error de BD crudo', async () => {
      // Este caso NO se puede resolver leyendo primero sin abrir una ventana de carrera:
      // la autoridad es el índice único, y su error se traduce a lenguaje de operador.
      em.save.mockRejectedValueOnce(
        new Error('duplicate key value violates unique constraint "uq_pe_fusion_hilo_a"'),
      );

      const r = await fusionar('hilo-a1', 'hilo-b1');

      expect(r.clase).toBe('rechazado_definitivo');
      expect('motivo' in r && r.motivo).toContain('ya está fusionado');
    });

    it('un error de BD que NO es el índice único se propaga', async () => {
      // Tragarlo lo convertiría en un rechazo de negocio inventado y ocultaría un fallo real.
      em.save.mockRejectedValueOnce(new Error('connection terminated'));
      await expect(fusionar('hilo-a1', 'hilo-b1')).rejects.toThrow('connection terminated');
    });
  });

  // ───────────────────────────────────────────────────────────────
  describe('estado de los hilos', () => {

    it('fusionar marca ambos hilos en_uso', async () => {
      await fusionar('hilo-a1', 'hilo-b1');

      expect(em.update).toHaveBeenCalledWith(
        PeFibraHilo,
        expect.anything(),
        { estado: HiloEstado.EN_USO },
      );
    });

    it('deshacer una fusión inexistente es ÉXITO idempotente', async () => {
      em.findOne.mockResolvedValueOnce(null);
      const r = await service.eliminarFusion(EMPRESA, 'fusion-fantasma');
      expect(r.clase).toBe('ya_en_destino');
    });

    it('al deshacer, un hilo que sigue empalmado en OTRA fusión NO vuelve a libre', async () => {
      // Marcarlo libre a ciegas lo dejaría disponible para vender mientras sigue
      // físicamente empalmado en otra caja.
      em.findOne.mockResolvedValueOnce({ id: 'f1', hiloAId: 'hilo-a1', hiloBId: 'hilo-b1' });
      em.count.mockResolvedValue(1); // ambos siguen en otra fusión

      await service.eliminarFusion(EMPRESA, 'f1');

      expect(em.update).not.toHaveBeenCalledWith(
        PeFibraHilo,
        expect.anything(),
        { estado: HiloEstado.LIBRE },
      );
    });

    it('al deshacer, un hilo sin otras fusiones vuelve a libre', async () => {
      em.findOne.mockResolvedValueOnce({ id: 'f1', hiloAId: 'hilo-a1', hiloBId: 'hilo-b1' });
      em.count.mockResolvedValue(0);

      await service.eliminarFusion(EMPRESA, 'f1');

      expect(em.update).toHaveBeenCalledWith(
        PeFibraHilo,
        { id: 'hilo-a1' },
        { estado: HiloEstado.LIBRE },
      );
    });

    it('deshacer usa soft-delete: la fusión se conserva para trazabilidad histórica', async () => {
      em.findOne.mockResolvedValueOnce({ id: 'f1', hiloAId: 'hilo-a1', hiloBId: 'hilo-b1' });

      await service.eliminarFusion(EMPRESA, 'f1');

      expect(em.softDelete).toHaveBeenCalledWith(PeFusion, { id: 'f1' });
    });
  });
});
