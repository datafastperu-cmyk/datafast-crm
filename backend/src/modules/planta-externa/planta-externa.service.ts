import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull } from 'typeorm';

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
import { PeFibraHilo, COLORES_EIA598 } from './entities/pe-fibra-hilo.entity';
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
