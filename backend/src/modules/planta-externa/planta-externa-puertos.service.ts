import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';

import { ResultadoOperacion } from '../../common/domain/resultado-operacion';
import {
  PuertoEstado,
  evaluarTransicionPuerto,
} from './domain/planta-externa-maquina-estados';
import { PeNapPuerto } from './entities/pe-nap-puerto.entity';
import { PeAcometida } from './entities/pe-acometida.entity';

/** Minutos que dura una reserva de puerto hecha por un wizard de alta. */
export const RESERVA_TTL_MIN = 20;

/**
 * Techo absoluto de una reserva, en minutos. El heartbeat del wizard EXTIENDE el TTL,
 * pero nunca más allá de este límite: sin techo, una pestaña olvidada bloquea el puerto
 * para siempre (directriz de wizards, punto 10 — el heartbeat suprime el barrido, no lo
 * autoriza).
 */
export const RESERVA_TECHO_MIN = 120;

/**
 * Gestión de puertos de NAP y acometidas.
 *
 * Este servicio existe separado del CRUD de planta externa porque es la única parte del
 * módulo que se DISPUTA bajo concurrencia: dos operadores dando de alta a la vez. El
 * resto (mufas, segmentos, fusiones) es documentación y no compite por un recurso.
 *
 * Regla que gobierna todo el archivo: **contar no es reservar**. El expediente original
 * especificaba "Puertos Libres = Capacidad − Clientes Activos", y con eso dos altas
 * simultáneas leen ambas "puerto 3 libre" y ambas lo asignan. Aquí ningún camino de
 * escritura hace SELECT-y-después-UPDATE sobre el estado del puerto: la condición viaja
 * DENTRO del UPDATE, y quien decide es Postgres.
 *
 * Devuelve `ResultadoOperacion` y no excepciones HTTP: estos métodos los consume tanto un
 * controller (humano) como el cron de barrido (máquina), y un 409 no distingue "esto nunca
 * va a funcionar" de "vuelve en 5 minutos" (incidente 2026-07-28).
 */
@Injectable()
export class PlantaExternaPuertosService {
  private readonly logger = new Logger(PlantaExternaPuertosService.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  // ─────────────────────────────────────────────────────────────────
  // Asignación
  // ─────────────────────────────────────────────────────────────────

  /**
   * Asigna un puerto a un contrato creando su acometida.
   *
   * El corazón del módulo. Toda la exclusión mutua vive en dos hechos:
   *
   *  1. El `UPDATE ... WHERE estado IN (...)` es UNA sentencia. Postgres serializa las
   *     escrituras sobre la misma fila, así que de N requests concurrentes exactamente
   *     uno ve `rowCount = 1` y el resto ve 0. No hay ventana entre leer y escribir
   *     porque no hay lectura previa.
   *  2. El índice `uq_pe_acometida_puerto` es la segunda defensa: aunque alguien en el
   *     futuro reescriba mal el UPDATE, la BD sigue impidiendo dos acometidas en el
   *     mismo puerto.
   *
   * Un puerto RESERVADO sólo lo puede tomar quien lo reservó — si no, la reserva no
   * serviría de nada.
   */
  async asignarPuerto(params: {
    empresaId: string;
    puertoId: string;
    contratoId: string;
    usuarioId: string;
    longitudM?: number;
  }): Promise<ResultadoOperacion> {
    const { empresaId, puertoId, contratoId, usuarioId, longitudM } = params;

    return this.ds.transaction(async (em) => {
      // Reclamo atómico. La condición de estado va DENTRO del UPDATE, nunca en un
      // SELECT previo. `reservado_por_usuario_id` se limpia aquí: el puerto pasa a
      // tener dueño real (la acometida) y la reserva deja de tener sentido.
      const res = await em.query(
        `UPDATE pe_nap_puerto
            SET estado = $1,
                reservado_por_usuario_id = NULL,
                reservado_hasta = NULL,
                version = version + 1,
                updated_at = now()
          WHERE id = $2
            AND empresa_id = $3
            AND deleted_at IS NULL
            AND (
                  estado = $4
              OR (estado = $5 AND reservado_por_usuario_id = $6)
            )
        RETURNING id, nap_id, numero`,
        [
          PuertoEstado.OCUPADO,
          puertoId,
          empresaId,
          PuertoEstado.LIBRE,
          PuertoEstado.RESERVADO,
          usuarioId,
        ],
      );

      if (res.length === 0) {
        // Nadie ganó la carrera con este request. El motivo lo decide el estado real,
        // que recién ahora se consulta — para EXPLICAR, no para decidir.
        return this.explicarAsignacionFallida(em, empresaId, puertoId, contratoId);
      }

      // `contratoId` es el nombre del parámetro (contrato de la API con el frontend, sin
      // tocar en este lote); la entidad guarda `servicioId` — Ola 2.
      await em.insert(PeAcometida, {
        empresaId,
        servicioId: contratoId,
        napPuertoId: puertoId,
        longitudM: longitudM ?? null,
      });

      const puerto = res[0];
      return {
        clase: 'aplicado',
        mensaje: `Puerto ${puerto.numero} asignado al contrato.`,
      };
    });
  }

  /**
   * Por qué falló el reclamo atómico. Se ejecuta SÓLO en el camino de error, y sólo para
   * redactar el mensaje: el veredicto ya lo dio el UPDATE.
   *
   * Aquí es donde se resuelve lo que la máquina de estados deliberadamente NO deriva. Si
   * `ocupar` tuviera idempotencia derivada, un puerto ocupado POR OTRO CONTRATO devolvería
   * "ya_en_destino" — un falso éxito que dejaría a dos contratos creyendo tener el mismo
   * puerto. La máquina no puede saber de quién es la acometida; este método sí.
   */
  private async explicarAsignacionFallida(
    em: EntityManager,
    empresaId: string,
    puertoId: string,
    contratoId: string,
  ): Promise<ResultadoOperacion> {
    const puerto = await em.findOne(PeNapPuerto, {
      where: { id: puertoId, empresaId },
    });

    if (!puerto) {
      return { clase: 'rechazado_definitivo', motivo: 'El puerto no existe.' };
    }

    if (puerto.estado === PuertoEstado.OCUPADO) {
      const acometida = await em.findOne(PeAcometida, {
        where: { napPuertoId: puertoId, empresaId },
      });

      // Mismo servicio → la operación ya estaba hecha. Es ÉXITO idempotente: un
      // reintento del cliente o del orquestador no debe leerse como fallo (fue lo que
      // produjo 1788 reintentos contra el MA5800 el 28/07).
      if (acometida?.servicioId === contratoId) {
        return {
          clase: 'ya_en_destino',
          mensaje: `El puerto ${puerto.numero} ya estaba asignado a este contrato.`,
        };
      }

      return {
        clase: 'rechazado_definitivo',
        motivo: `El puerto ${puerto.numero} ya está ocupado por otro contrato.`,
      };
    }

    if (puerto.estado === PuertoEstado.RESERVADO) {
      // Reintentable, NO definitivo: la reserva ajena vence sola. Descartar el trabajo
      // aquí sería el error inverso del 28/07, cuando un 409 de lock se leyó como
      // veredicto y el trabajo se tiró.
      return {
        clase: 'reintentable',
        motivo: `El puerto ${puerto.numero} está reservado por otro operador; la reserva vence sola.`,
      };
    }

    // Estado ilegal de origen (no_habilitado, averiado, retirado): lo explica la máquina,
    // que es el único lugar donde vive ese criterio.
    return (
      evaluarTransicionPuerto('ocupar', puerto.estado, `El puerto ${puerto.numero}`) ?? {
        clase: 'reintentable',
        motivo: 'El puerto no pudo tomarse; reintentar.',
      }
    );
  }

  // ─────────────────────────────────────────────────────────────────
  // Reserva del wizard
  // ─────────────────────────────────────────────────────────────────

  /**
   * Retiene un puerto mientras un wizard de alta está en curso.
   *
   * Mismo patrón atómico que `asignarPuerto`: la condición viaja dentro del UPDATE.
   * Reservar dos veces el mismo puerto con el mismo usuario RENUEVA el TTL en vez de
   * fallar — el wizard puede volver atrás y avanzar de nuevo, y eso no es un error.
   */
  async reservarPuerto(params: {
    empresaId: string;
    puertoId: string;
    usuarioId: string;
  }): Promise<ResultadoOperacion> {
    const { empresaId, puertoId, usuarioId } = params;

    const res = await this.ds.query(
      `UPDATE pe_nap_puerto
          SET estado = $1,
              reservado_por_usuario_id = $2,
              reservado_hasta = now() + ($3 || ' minutes')::interval,
              version = version + 1,
              updated_at = now()
        WHERE id = $4
          AND empresa_id = $5
          AND deleted_at IS NULL
          AND (
                estado = $6
            OR (estado = $1 AND reservado_por_usuario_id = $2)
          )
      RETURNING numero`,
      [
        PuertoEstado.RESERVADO,
        usuarioId,
        String(RESERVA_TTL_MIN),
        puertoId,
        empresaId,
        PuertoEstado.LIBRE,
      ],
    );

    if (res.length === 0) {
      const puerto = await this.ds.getRepository(PeNapPuerto).findOne({
        where: { id: puertoId, empresaId },
      });
      if (!puerto) {
        return { clase: 'rechazado_definitivo', motivo: 'El puerto no existe.' };
      }
      if (puerto.estado === PuertoEstado.RESERVADO) {
        return {
          clase: 'reintentable',
          motivo: `El puerto ${puerto.numero} está reservado por otro operador; la reserva vence sola.`,
        };
      }
      return (
        evaluarTransicionPuerto('reservar', puerto.estado, `El puerto ${puerto.numero}`) ?? {
          clase: 'reintentable',
          motivo: 'El puerto no pudo reservarse; reintentar.',
        }
      );
    }

    return {
      clase: 'aplicado',
      mensaje: `Puerto ${res[0].numero} reservado por ${RESERVA_TTL_MIN} minutos.`,
    };
  }

  /**
   * Heartbeat del wizard: extiende la reserva, con TECHO ABSOLUTO.
   *
   * `created_at` no sirve como referencia del techo porque el puerto se creó con la
   * caja, no con la reserva. El techo se calcula sobre el vencimiento vigente: extender
   * nunca puede llevar la reserva más allá de RESERVA_TECHO_MIN desde ahora.
   *
   * El heartbeat SUPRIME el barrido; no lo autoriza. Si el techo ya se alcanzó, esta
   * llamada no falla ruidosamente —el wizard sigue vivo— pero deja de extender, y el
   * barrido recuperará el puerto. Un recurso retenido para siempre por una pestaña
   * olvidada es peor que un wizard que hay que rehacer.
   */
  async extenderReserva(params: {
    empresaId: string;
    puertoId: string;
    usuarioId: string;
  }): Promise<ResultadoOperacion> {
    const { empresaId, puertoId, usuarioId } = params;

    const res = await this.ds.query(
      `UPDATE pe_nap_puerto
          SET reservado_hasta = LEAST(
                now() + ($1 || ' minutes')::interval,
                now() + ($2 || ' minutes')::interval
              ),
              version = version + 1,
              updated_at = now()
        WHERE id = $3
          AND empresa_id = $4
          AND deleted_at IS NULL
          AND estado = $5
          AND reservado_por_usuario_id = $6
          AND reservado_hasta > now()
      RETURNING numero, reservado_hasta`,
      [
        String(RESERVA_TTL_MIN),
        String(RESERVA_TECHO_MIN),
        puertoId,
        empresaId,
        PuertoEstado.RESERVADO,
        usuarioId,
      ],
    );

    if (res.length === 0) {
      return {
        clase: 'no_aplica',
        mensaje: 'La reserva ya no está vigente o pertenece a otro operador.',
      };
    }

    return { clase: 'aplicado', mensaje: `Reserva del puerto ${res[0].numero} extendida.` };
  }

  /**
   * Libera un puerto: baja de acometida o cancelación explícita del wizard.
   *
   * Idempotente por contrato: liberar un puerto ya LIBRE es ÉXITO, no error (directriz
   * de wizards, punto 8 — una anulación interrumpida se reintenta desde el principio sin
   * efectos raros).
   */
  async liberarPuerto(params: {
    empresaId: string;
    puertoId: string;
  }): Promise<ResultadoOperacion> {
    const { empresaId, puertoId } = params;

    return this.ds.transaction(async (em) => {
      // La acometida se borra (soft) primero: si el puerto quedara libre con una
      // acometida viva apuntándolo, el índice único impediría la siguiente asignación
      // y el puerto quedaría inutilizable sin que nadie entienda por qué.
      await em.softDelete(PeAcometida, { napPuertoId: puertoId, empresaId });

      const res = await em.query(
        `UPDATE pe_nap_puerto
            SET estado = $1,
                reservado_por_usuario_id = NULL,
                reservado_hasta = NULL,
                version = version + 1,
                updated_at = now()
          WHERE id = $2
            AND empresa_id = $3
            AND deleted_at IS NULL
            AND estado IN ($4, $5)
        RETURNING numero`,
        [
          PuertoEstado.LIBRE,
          puertoId,
          empresaId,
          PuertoEstado.RESERVADO,
          PuertoEstado.OCUPADO,
        ],
      );

      if (res.length === 0) {
        const puerto = await em.findOne(PeNapPuerto, { where: { id: puertoId, empresaId } });
        if (!puerto) {
          return { clase: 'rechazado_definitivo', motivo: 'El puerto no existe.' };
        }
        return (
          evaluarTransicionPuerto('liberar', puerto.estado, `El puerto ${puerto.numero}`) ?? {
            clase: 'reintentable',
            motivo: 'El puerto no pudo liberarse; reintentar.',
          }
        );
      }

      return { clase: 'aplicado', mensaje: `Puerto ${res[0].numero} liberado.` };
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // Barrido
  // ─────────────────────────────────────────────────────────────────

  /**
   * Libera las reservas vencidas. Es el MECANISMO REAL de anulación del wizard.
   *
   * El navegador no participa: `beforeunload` no puede ejecutar trabajo asíncrono fiable,
   * y el cierre puede ser un crash, un corte de luz o una sesión caída — precisamente los
   * casos que motivan la regla. Una frontera que no existe en el caso que la justifica no
   * es una frontera (directriz de wizards, punto 10).
   *
   * Sin filtro por empresa a propósito: es mantenimiento del servidor, no una operación
   * de usuario. Un puerto retenido por una empresa no debe depender de que alguien de esa
   * empresa esté conectado.
   */
  async barrerReservasExpiradas(): Promise<number> {
    const res = await this.ds.query(
      `UPDATE pe_nap_puerto
          SET estado = $1,
              reservado_por_usuario_id = NULL,
              reservado_hasta = NULL,
              version = version + 1,
              updated_at = now()
        WHERE estado = $2
          AND deleted_at IS NULL
          AND reservado_hasta IS NOT NULL
          AND reservado_hasta <= now()
      RETURNING id`,
      [PuertoEstado.LIBRE, PuertoEstado.RESERVADO],
    );

    const liberados = res.length;
    if (liberados > 0) {
      // El log describe lo que OCURRIÓ, no lo que el código pretendía hacer.
      this.logger.log(`Barrido de reservas: ${liberados} puerto(s) liberados por TTL vencido.`);
    }
    return liberados;
  }
}
