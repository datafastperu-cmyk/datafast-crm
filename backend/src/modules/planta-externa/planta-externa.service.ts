import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, IsNull } from 'typeorm';

import { ResultadoOperacion } from '../../common/domain/resultado-operacion';
import {
  ElementoEstado,
  PuertoEstado,
  PUERTO_CONSUME_CAPACIDAD,
  evaluarTransicionElemento,
} from './domain/planta-externa-maquina-estados';
import { PeMufa } from './entities/pe-mufa.entity';
import { PeNap } from './entities/pe-nap.entity';
import { PeNapPuerto } from './entities/pe-nap-puerto.entity';
import { PeFibraSegmento } from './entities/pe-fibra-segmento.entity';
import { PeFibraHilo, COLORES_EIA598, HiloEstado } from './entities/pe-fibra-hilo.entity';
import { PeFusion, PERDIDA_FUSION_DB } from './entities/pe-fusion.entity';
import {
  PeSplitter,
  SplitterRelacion,
  SALIDAS_POR_RELACION,
  PERDIDA_TIPICA_DB,
} from './entities/pe-splitter.entity';
import { PeSplitterSalida } from './entities/pe-splitter-salida.entity';

/**
 * CRUD de planta externa: mufas, segmentos, NAPs y splitters.
 *
 * A diferencia de `PlantaExternaPuertosService`, esto no se disputa bajo concurrencia —
 * es documentación de infraestructura. Lo que sí exige es ATOMICIDAD: un segmento sin
 * hilos o un splitter sin salidas es un registro corrupto que ninguna lógica posterior
 * puede reparar sola, porque nadie sabe cuántos hilos debía tener.
 *
 * Todos los métodos devuelven `ResultadoOperacion`; el controller traduce en el borde.
 */
@Injectable()
export class PlantaExternaService {
  private readonly logger = new Logger(PlantaExternaService.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  // ─────────────────────────────────────────────────────────────────
  // Segmentos de fibra
  // ─────────────────────────────────────────────────────────────────

  /**
   * Crea un segmento y TODOS sus hilos en una transacción.
   *
   * Los hilos no son opcionales ni diferibles: el número de hilos es un hecho físico del
   * cable que se acaba de tender. Un segmento guardado sin ellos obligaría a adivinarlo
   * después, y el color —que es como el técnico identifica el hilo en campo— ya no
   * podría derivarse de la posición.
   */
  async crearSegmento(
    empresaId: string,
    dto: {
      codigo: string;
      jerarquia: string;
      hilosTotales: number;
      longitudM: number;
      tipoInstalacion?: string;
      atenuacionDbKm?: number;
      descripcion?: string;
      rutaGeojson?: Record<string, unknown>;
      origenSiteId?: string;
      origenMufaId?: string;
      origenNapId?: string;
      destinoSiteId?: string;
      destinoMufaId?: string;
      destinoNapId?: string;
    },
  ): Promise<ResultadoOperacion & { id?: string }> {
    const extremosOrigen = [dto.origenSiteId, dto.origenMufaId, dto.origenNapId].filter(Boolean);
    const extremosDestino = [dto.destinoSiteId, dto.destinoMufaId, dto.destinoNapId].filter(Boolean);

    // Se valida aquí además del CHECK de la BD para dar un motivo legible. El CHECK es
    // la garantía; esto es la explicación.
    if (extremosOrigen.length !== 1 || extremosDestino.length !== 1) {
      return {
        clase: 'rechazado_definitivo',
        motivo: 'Un segmento debe tener exactamente un nodo de origen y uno de destino (site, mufa o NAP).',
      };
    }

    return this.ds.transaction(async (em) => {
      const segmento = await em.save(
        em.create(PeFibraSegmento, {
          empresaId,
          ...dto,
          estado: ElementoEstado.PLANIFICADO,
        } as Partial<PeFibraSegmento>),
      );

      await em.insert(PeFibraHilo, this.construirHilos(empresaId, segmento.id, dto.hilosTotales));

      return {
        clase: 'aplicado' as const,
        mensaje: `Segmento ${dto.codigo} creado con ${dto.hilosTotales} hilos.`,
        id: segmento.id,
      };
    });
  }

  /**
   * Genera las filas de hilo con su color EIA-598 derivado de la posición.
   *
   * El color se calcula y no se pide: el técnico identifica el hilo por color, y tipear
   * 288 colores a mano garantiza errores que después nadie puede distinguir de la
   * realidad. El módulo 12 refleja cómo se repite el código dentro de cada buffer.
   */
  private construirHilos(
    empresaId: string,
    segmentoId: string,
    total: number,
  ): Partial<PeFibraHilo>[] {
    return Array.from({ length: total }, (_, i) => ({
      empresaId,
      segmentoId,
      numero: i + 1,
      color: COLORES_EIA598[i % COLORES_EIA598.length],
    }));
  }

  // ─────────────────────────────────────────────────────────────────
  // Cajas NAP
  // ─────────────────────────────────────────────────────────────────

  /**
   * Crea una NAP y sus puertos FÍSICOS en una transacción.
   *
   * Los puertos nacen en `no_habilitado`, no en `libre`: el adaptador existe desde que se
   * instala la caja, pero sin splitter detrás no da servicio. Es la distinción que el
   * expediente no hacía —contaba capacidad de caja como si fuera capacidad de servicio— y
   * con la que el planificador ve puertos donde no puede conectar a nadie.
   */
  async crearNap(
    empresaId: string,
    dto: {
      codigo: string;
      latitud: number;
      longitud: number;
      capacidadPuertos: number;
      direccion?: string;
      descripcion?: string;
      precisionGpsM?: number;
      mufaOrigenId?: string;
      segmentoAlimentadorId?: string;
    },
  ): Promise<ResultadoOperacion & { id?: string }> {
    return this.ds.transaction(async (em) => {
      const nap = await em.save(
        em.create(PeNap, {
          empresaId,
          ...dto,
          estado: ElementoEstado.PLANIFICADO,
          puertosLibres: 0,
          puertosNoHabilitados: dto.capacidadPuertos,
        } as Partial<PeNap>),
      );

      await em.insert(
        PeNapPuerto,
        Array.from({ length: dto.capacidadPuertos }, (_, i) => ({
          empresaId,
          napId: nap.id,
          numero: i + 1,
          estado: PuertoEstado.NO_HABILITADO,
        })),
      );

      return {
        clase: 'aplicado' as const,
        mensaje: `Caja ${dto.codigo} creada con ${dto.capacidadPuertos} puertos físicos (sin splitter aún).`,
        id: nap.id,
      };
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // Splitters
  // ─────────────────────────────────────────────────────────────────

  /**
   * Instala un splitter en una NAP: crea sus salidas y HABILITA los puertos que alimenta.
   *
   * Caso real que este método existe para soportar: caja de 16 con un 1x8 instalado; los
   * 8 restantes se habilitan meses después con un segundo splitter alimentado por un hilo
   * de paso del cable que cruza la caja.
   *
   * Guard de capacidad FÍSICA: la suma de salidas de todos los splitters no puede exceder
   * los adaptadores de la caja. Un 1x16 no entra en una caja de 8 — y sin este guard el
   * ERP aceptaría el registro, generaría puertos 9..16 que no existen en el poste, y un
   * técnico viajaría a conectar a un puerto inexistente.
   */
  async instalarSplitterEnNap(
    empresaId: string,
    dto: {
      napId: string;
      relacion: SplitterRelacion;
      codigo?: string;
      perdidaDb?: number;
      hiloEntradaId?: string;
      descripcion?: string;
    },
  ): Promise<ResultadoOperacion & { id?: string }> {
    const salidasNuevas = SALIDAS_POR_RELACION[dto.relacion];

    return this.ds.transaction(async (em) => {
      const nap = await em.findOne(PeNap, {
        where: { id: dto.napId, empresaId, deletedAt: IsNull() },
      });
      if (!nap) {
        return { clase: 'rechazado_definitivo' as const, motivo: 'La caja NAP no existe.' };
      }

      // Puertos que YA están servidos por algún splitter. Se cuentan los puertos, no las
      // salidas declaradas: el puerto es el hecho físico y las salidas son la intención.
      const ocupados = await em.count(PeNapPuerto, {
        where: { napId: nap.id, empresaId, deletedAt: IsNull() },
      });
      const habilitados = await em
        .createQueryBuilder(PeNapPuerto, 'p')
        .where('p.nap_id = :napId', { napId: nap.id })
        .andWhere('p.deleted_at IS NULL')
        .andWhere('p.splitter_salida_id IS NOT NULL')
        .getCount();

      if (habilitados + salidasNuevas > nap.capacidadPuertos) {
        return {
          clase: 'rechazado_definitivo' as const,
          motivo:
            `La caja ${nap.codigo} tiene ${nap.capacidadPuertos} puertos físicos y ` +
            `${habilitados} ya habilitados. Un splitter ${dto.relacion} necesita ` +
            `${salidasNuevas} más y no entran.`,
        };
      }

      // Puertos libres de splitter, en orden. La numeración es continua por caja
      // (1..capacidad, atravesando todos sus splitters), nunca reiniciada por splitter:
      // es la que el técnico lee rotulada en la caja, y si no coincide con la del ERP el
      // dato es inútil en campo.
      const disponibles = await em
        .createQueryBuilder(PeNapPuerto, 'p')
        .where('p.nap_id = :napId', { napId: nap.id })
        .andWhere('p.deleted_at IS NULL')
        .andWhere('p.splitter_salida_id IS NULL')
        .andWhere('p.estado = :estado', { estado: PuertoEstado.NO_HABILITADO })
        .orderBy('p.numero', 'ASC')
        .limit(salidasNuevas)
        .getMany();

      if (disponibles.length < salidasNuevas) {
        return {
          clase: 'rechazado_definitivo' as const,
          motivo:
            `Sólo hay ${disponibles.length} puertos sin splitter en la caja ${nap.codigo}; ` +
            `un ${dto.relacion} necesita ${salidasNuevas}. Total de puertos: ${ocupados}.`,
        };
      }

      const splitter = await em.save(
        em.create(PeSplitter, {
          empresaId,
          codigo: dto.codigo ?? null,
          descripcion: dto.descripcion ?? null,
          relacion: dto.relacion,
          // El default es sólo el valor típico: la pérdida real varía por fabricante y
          // generación, y forzar la tabla haría que el presupuesto óptico arrastre un
          // error sistemático que nadie puede corregir sin tocar código.
          perdidaDb: dto.perdidaDb ?? PERDIDA_TIPICA_DB[dto.relacion],
          alojadoEnNapId: nap.id,
          alojadoEnMufaId: null,
          hiloEntradaId: dto.hiloEntradaId ?? null,
          estado: ElementoEstado.INSTALADO,
        } as Partial<PeSplitter>),
      );

      // Salidas y habilitación de puertos, emparejados uno a uno.
      for (let i = 0; i < salidasNuevas; i++) {
        const salida = await em.save(
          em.create(PeSplitterSalida, {
            empresaId,
            splitterId: splitter.id,
            numero: i + 1,
            hiloSalidaId: null,
          } as Partial<PeSplitterSalida>),
        );

        await em.update(
          PeNapPuerto,
          { id: disponibles[i].id },
          { splitterSalidaId: salida.id, estado: PuertoEstado.LIBRE },
        );
      }

      return {
        clase: 'aplicado' as const,
        mensaje:
          `Splitter ${dto.relacion} instalado en ${nap.codigo}: ` +
          `puertos ${disponibles[0].numero}–${disponibles[salidasNuevas - 1].numero} habilitados.`,
        id: splitter.id,
      };
    });
  }

  /**
   * Retira un splitter y deshabilita sus puertos.
   *
   * Falla si alguno de sus puertos está en uso. Sin este guard, retirar el splitter
   * dejaría los puertos huérfanos —o los borraría en cascada— y con ellos la trazabilidad
   * de clientes que siguen navegando. Es la misma clase de discordancia físico↔lógico que
   * produjo la ONU huérfana del 2026-07-21.
   */
  async retirarSplitter(empresaId: string, splitterId: string): Promise<ResultadoOperacion> {
    return this.ds.transaction(async (em) => {
      const splitter = await em.findOne(PeSplitter, {
        where: { id: splitterId, empresaId, deletedAt: IsNull() },
      });
      if (!splitter) {
        return { clase: 'ya_en_destino' as const, mensaje: 'El splitter ya no existe.' };
      }

      const enUso = await em
        .createQueryBuilder(PeNapPuerto, 'p')
        .innerJoin(PeSplitterSalida, 's', 's.id = p.splitter_salida_id')
        .where('s.splitter_id = :splitterId', { splitterId })
        .andWhere('p.deleted_at IS NULL')
        .andWhere('p.estado IN (:...estados)', { estados: [...PUERTO_CONSUME_CAPACIDAD] })
        .getCount();

      if (enUso > 0) {
        return {
          clase: 'rechazado_definitivo' as const,
          motivo:
            `El splitter alimenta ${enUso} puerto(s) con cliente o reserva activa. ` +
            `Da de baja o migra esas acometidas antes de retirarlo.`,
        };
      }

      await em.query(
        `UPDATE pe_nap_puerto p
            SET estado = $1, splitter_salida_id = NULL, version = p.version + 1, updated_at = now()
           FROM pe_splitter_salida s
          WHERE s.id = p.splitter_salida_id
            AND s.splitter_id = $2
            AND p.deleted_at IS NULL`,
        [PuertoEstado.NO_HABILITADO, splitterId],
      );

      await em.softDelete(PeSplitterSalida, { splitterId });
      await em.softDelete(PeSplitter, { id: splitterId });

      return { clase: 'aplicado' as const, mensaje: 'Splitter retirado y puertos deshabilitados.' };
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // Detalle de mufa: lo que hace recorrible el grafo
  // ─────────────────────────────────────────────────────────────────

  /**
   * Todo lo necesario para trabajar dentro de una mufa: qué cables llegan, qué hilos
   * traen, cómo están fusionados y qué splitters aloja.
   *
   * Devuelve los segmentos que TOCAN la mufa por cualquiera de sus dos extremos. Un
   * técnico frente a la caja no piensa en "origen" y "destino" —eso es una convención del
   * modelo—; ve cables que entran y cables que salen, y fusiona entre ellos.
   */
  async detalleMufa(empresaId: string, mufaId: string) {
    const mufa = await this.ds.getRepository(PeMufa).findOne({
      where: { id: mufaId, empresaId, deletedAt: IsNull() },
    });
    if (!mufa) return null;

    const segmentos = await this.ds
      .getRepository(PeFibraSegmento)
      .createQueryBuilder('s')
      .where('s.empresa_id = :empresaId', { empresaId })
      .andWhere('s.deleted_at IS NULL')
      .andWhere('(s.origen_mufa_id = :mufaId OR s.destino_mufa_id = :mufaId)', { mufaId })
      .orderBy('s.codigo', 'ASC')
      .getMany();

    const segmentoIds = segmentos.map((s) => s.id);

    const hilos = segmentoIds.length
      ? await this.ds
          .getRepository(PeFibraHilo)
          .createQueryBuilder('h')
          .where('h.segmento_id IN (:...ids)', { ids: segmentoIds })
          .andWhere('h.deleted_at IS NULL')
          .orderBy('h.segmento_id', 'ASC')
          .addOrderBy('h.numero', 'ASC')
          .getMany()
      : [];

    const [fusiones, splitters] = await Promise.all([
      this.ds.getRepository(PeFusion).find({
        where: { mufaId, empresaId, deletedAt: IsNull() },
      }),
      this.ds.getRepository(PeSplitter).find({
        where: { alojadoEnMufaId: mufaId, empresaId, deletedAt: IsNull() },
      }),
    ]);

    return { mufa, segmentos, hilos, fusiones, splitters };
  }

  /**
   * Fusiona dos hilos dentro de una mufa.
   *
   * El invariante "un hilo se fusiona una sola vez" lo garantizan dos índices únicos
   * parciales en la BD; aquí no se reimplementa. Lo que SÍ vive aquí, porque la BD no
   * puede expresarlo, es la regla de pertenencia: **ambos hilos deben venir de un cable
   * que llega a ESTA mufa**. Sin ese guard, un typo en un UUID permitiría fusionar el
   * hilo de un cable de otra zona con el de acá, y el recorrido del grafo devolvería una
   * ruta que no existe físicamente — un error indetectable después, porque el dato
   * resultante es perfectamente válido para el esquema.
   */
  async crearFusion(
    empresaId: string,
    mufaId: string,
    dto: { hiloAId: string; hiloBId: string; perdidaDb?: number; observacion?: string },
  ): Promise<ResultadoOperacion & { id?: string }> {
    if (dto.hiloAId === dto.hiloBId) {
      return { clase: 'rechazado_definitivo', motivo: 'Un hilo no puede fusionarse consigo mismo.' };
    }

    return this.ds.transaction(async (em) => {
      const mufa = await em.findOne(PeMufa, {
        where: { id: mufaId, empresaId, deletedAt: IsNull() },
      });
      if (!mufa) {
        return { clase: 'rechazado_definitivo' as const, motivo: 'La mufa no existe.' };
      }

      // Segmentos que tocan esta mufa. Es el universo legal de hilos fusionables aquí.
      const segmentos = await em
        .createQueryBuilder(PeFibraSegmento, 's')
        .select('s.id', 'id')
        .where('s.empresa_id = :empresaId', { empresaId })
        .andWhere('s.deleted_at IS NULL')
        .andWhere('(s.origen_mufa_id = :mufaId OR s.destino_mufa_id = :mufaId)', { mufaId })
        .getRawMany<{ id: string }>();

      const idsLegales = new Set(segmentos.map((s) => s.id));

      const hilos = await em.find(PeFibraHilo, {
        where: [{ id: dto.hiloAId, empresaId }, { id: dto.hiloBId, empresaId }],
      });

      if (hilos.length !== 2) {
        return { clase: 'rechazado_definitivo' as const, motivo: 'Alguno de los hilos no existe.' };
      }

      const ajeno = hilos.find((h) => !idsLegales.has(h.segmentoId));
      if (ajeno) {
        return {
          clase: 'rechazado_definitivo' as const,
          motivo:
            `El hilo ${ajeno.numero} pertenece a un cable que no llega a la mufa ` +
            `${mufa.codigo}. Sólo se pueden fusionar hilos de los cables que entran aquí.`,
        };
      }

      // Idempotencia explícita: la misma pareja ya fusionada en esta mufa es ÉXITO, no
      // error. Reintentar un alta que ya se aplicó no puede reportarse como fallo.
      const yaFusionados = await em
        .createQueryBuilder(PeFusion, 'f')
        .where('f.mufa_id = :mufaId', { mufaId })
        .andWhere('f.deleted_at IS NULL')
        .andWhere(
          '((f.hilo_a_id = :a AND f.hilo_b_id = :b) OR (f.hilo_a_id = :b AND f.hilo_b_id = :a))',
          { a: dto.hiloAId, b: dto.hiloBId },
        )
        .getOne();

      if (yaFusionados) {
        return { clase: 'ya_en_destino' as const, mensaje: 'Esos dos hilos ya estaban fusionados.' };
      }

      try {
        const fusion = await em.save(
          em.create(PeFusion, {
            empresaId,
            mufaId,
            hiloAId: dto.hiloAId,
            hiloBId: dto.hiloBId,
            perdidaDb: dto.perdidaDb ?? PERDIDA_FUSION_DB,
            observacion: dto.observacion ?? null,
          } as Partial<PeFusion>),
        );

        await em.update(
          PeFibraHilo,
          { id: In([dto.hiloAId, dto.hiloBId]) },
          { estado: HiloEstado.EN_USO },
        );

        return { clase: 'aplicado' as const, mensaje: 'Fusión registrada.', id: fusion.id };
      } catch (err: any) {
        // Los índices únicos son la autoridad. Si saltan, es porque alguno de los hilos ya
        // está fusionado con OTRO hilo — un dato que el chequeo anterior no cubre y que no
        // se puede resolver leyendo primero sin abrir una ventana de carrera.
        if (String(err?.message ?? '').includes('uq_pe_fusion_hilo')) {
          return {
            clase: 'rechazado_definitivo' as const,
            motivo:
              'Uno de los hilos ya está fusionado con otro hilo. Deshaz esa fusión antes ' +
              'de crear esta.',
          };
        }
        throw err;
      }
    });
  }

  /**
   * Deshace una fusión y devuelve sus hilos a `libre`.
   *
   * Idempotente: deshacer una fusión que ya no existe es ÉXITO. Un operador que hace
   * doble clic, o un reintento, no deben ver un error por algo que ya está como se quería.
   */
  async eliminarFusion(empresaId: string, fusionId: string): Promise<ResultadoOperacion> {
    return this.ds.transaction(async (em) => {
      const fusion = await em.findOne(PeFusion, {
        where: { id: fusionId, empresaId, deletedAt: IsNull() },
      });
      if (!fusion) {
        return { clase: 'ya_en_destino' as const, mensaje: 'Esa fusión ya no existe.' };
      }

      await em.softDelete(PeFusion, { id: fusionId });

      // Los hilos vuelven a `libre` sólo si no quedan en otra fusión viva. Marcarlos
      // libres a ciegas los dejaría disponibles mientras siguen empalmados en otra caja.
      for (const hiloId of [fusion.hiloAId, fusion.hiloBId]) {
        const otras = await em.count(PeFusion, {
          where: [
            { hiloAId: hiloId, deletedAt: IsNull() },
            { hiloBId: hiloId, deletedAt: IsNull() },
          ],
        });
        if (otras === 0) {
          await em.update(PeFibraHilo, { id: hiloId }, { estado: HiloEstado.LIBRE });
        }
      }

      return { clase: 'aplicado' as const, mensaje: 'Fusión deshecha.' };
    });
  }

  /**
   * Instala un splitter dentro de una mufa (derivación con división de potencia).
   *
   * A diferencia del de NAP, no crea puertos: sus salidas alimentan hilos de otros cables
   * (cascada hacia otra mufa o hacia una NAP), no acometidas de cliente.
   */
  async instalarSplitterEnMufa(
    empresaId: string,
    dto: {
      mufaId: string;
      relacion: SplitterRelacion;
      codigo?: string;
      perdidaDb?: number;
      hiloEntradaId?: string;
      descripcion?: string;
    },
  ): Promise<ResultadoOperacion & { id?: string }> {
    return this.ds.transaction(async (em) => {
      const mufa = await em.findOne(PeMufa, {
        where: { id: dto.mufaId, empresaId, deletedAt: IsNull() },
      });
      if (!mufa) {
        return { clase: 'rechazado_definitivo' as const, motivo: 'La mufa no existe.' };
      }

      const splitter = await em.save(
        em.create(PeSplitter, {
          empresaId,
          codigo: dto.codigo ?? null,
          descripcion: dto.descripcion ?? null,
          relacion: dto.relacion,
          perdidaDb: dto.perdidaDb ?? PERDIDA_TIPICA_DB[dto.relacion],
          alojadoEnMufaId: mufa.id,
          alojadoEnNapId: null,
          hiloEntradaId: dto.hiloEntradaId ?? null,
          estado: ElementoEstado.INSTALADO,
        } as Partial<PeSplitter>),
      );

      const salidas = SALIDAS_POR_RELACION[dto.relacion];
      await em.insert(
        PeSplitterSalida,
        Array.from({ length: salidas }, (_, i) => ({
          empresaId,
          splitterId: splitter.id,
          numero: i + 1,
          hiloSalidaId: null,
        })),
      );

      if (dto.hiloEntradaId) {
        await em.update(PeFibraHilo, { id: dto.hiloEntradaId }, { estado: HiloEstado.EN_USO });
      }

      return {
        clase: 'aplicado' as const,
        mensaje: `Splitter ${dto.relacion} instalado en ${mufa.codigo} (${salidas} salidas).`,
        id: splitter.id,
      };
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // Transiciones de estado (mufa, NAP, segmento, splitter)
  // ─────────────────────────────────────────────────────────────────

  /**
   * Aplica una transición de la máquina de estados a cualquier elemento de planta.
   *
   * Un solo método para los cuatro tipos: el ciclo de vida es el mismo y duplicarlo por
   * entidad es exactamente cómo los criterios se dispersan hasta que a uno le falta un
   * estado de origen sin que nadie lo note (análisis 2026-07-28).
   */
  async transicionarElemento(params: {
    empresaId: string;
    tipo: 'mufa' | 'nap' | 'segmento' | 'splitter';
    id: string;
    transicion: 'instalar' | 'activar' | 'averiar' | 'reparar' | 'retirar';
  }): Promise<ResultadoOperacion> {
    const { empresaId, tipo, id, transicion } = params;
    const Entidad = { mufa: PeMufa, nap: PeNap, segmento: PeFibraSegmento, splitter: PeSplitter }[tipo];

    return this.ds.transaction(async (em: EntityManager) => {
      const elemento = (await em.findOne(Entidad as any, {
        where: { id, empresaId, deletedAt: IsNull() },
      })) as unknown as { id: string; estado: ElementoEstado; version: number } | null;

      if (!elemento) {
        return { clase: 'rechazado_definitivo' as const, motivo: `El ${tipo} no existe.` };
      }

      const veredicto = evaluarTransicionElemento(transicion, elemento.estado, `El ${tipo}`);
      if (veredicto) return veredicto;

      const destino = { instalar: ElementoEstado.INSTALADO, activar: ElementoEstado.OPERATIVO,
                        averiar: ElementoEstado.AVERIADO, reparar: ElementoEstado.OPERATIVO,
                        retirar: ElementoEstado.RETIRADO }[transicion];

      // Bloqueo optimista con la columna `version` que BaseModel ya trae: dos técnicos
      // editando la misma mufa es el caso normal, no el raro. 0 filas → conflicto de
      // concurrencia, que es REINTENTABLE, nunca un veredicto definitivo (incidente 28/07).
      const res = await em.query(
        `UPDATE ${em.getRepository(Entidad as any).metadata.tableName}
            SET estado = $1, version = version + 1, updated_at = now()
          WHERE id = $2 AND empresa_id = $3 AND version = $4 AND deleted_at IS NULL
        RETURNING id`,
        [destino, id, empresaId, elemento.version],
      );

      if (res.length === 0) {
        return {
          clase: 'reintentable' as const,
          motivo: 'Otro usuario modificó este elemento mientras lo editabas. Reintenta.',
        };
      }

      return { clase: 'aplicado' as const, mensaje: `El ${tipo} pasó a "${destino}".` };
    });
  }
}
