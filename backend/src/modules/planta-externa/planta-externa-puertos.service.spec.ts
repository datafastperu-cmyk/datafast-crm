import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';

import {
  PlantaExternaPuertosService,
  RESERVA_TTL_MIN,
  RESERVA_TECHO_MIN,
} from './planta-externa-puertos.service';
import { PuertoEstado } from './domain/planta-externa-maquina-estados';
import { PeNapPuerto } from './entities/pe-nap-puerto.entity';
import { PeAcometida } from './entities/pe-acometida.entity';

/**
 * Qué demuestra esta suite y qué NO.
 *
 * NO demuestra que Postgres serialice bien dos UPDATE concurrentes: eso es correctitud
 * del motor, no de este código, y probarlo exige una BD real (queda como criterio de
 * aceptación de la fase, pendiente de una BD de prueba).
 *
 * SÍ demuestra lo que es nuestro y lo que un refactor puede romper en silencio:
 *  · que la condición de estado viaja DENTRO del UPDATE y no en un SELECT previo —
 *    el día que alguien lo "simplifique" a leer-y-después-escribir, vuelve la race
 *    condition del expediente y ningún test de negocio lo notaría;
 *  · que 0 filas afectadas se interpreta según de QUIÉN es el puerto, que es la
 *    distinción que la máquina de estados deliberadamente no deriva.
 */
describe('PlantaExternaPuertosService', () => {
  let service: PlantaExternaPuertosService;
  let query: jest.Mock;
  let findOne: jest.Mock;
  let insert: jest.Mock;
  let softDelete: jest.Mock;

  const EMPRESA = 'emp-001';
  const PUERTO = 'pto-001';
  const CONTRATO = 'cnt-001';
  const USUARIO = 'usr-001';

  /** Manager de transacción: el servicio hace todo el trabajo de escritura aquí dentro. */
  const em = () => ({ query, findOne, insert, softDelete });

  beforeEach(async () => {
    query = jest.fn().mockResolvedValue([]);
    findOne = jest.fn().mockResolvedValue(null);
    insert = jest.fn().mockResolvedValue({});
    softDelete = jest.fn().mockResolvedValue({});

    const mockDs = {
      query,
      transaction: jest.fn(async (cb: any) => cb(em())),
      getRepository: jest.fn(() => ({ findOne })),
    };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        PlantaExternaPuertosService,
        { provide: getDataSourceToken(), useValue: mockDs },
      ],
    }).compile();

    service = mod.get(PlantaExternaPuertosService);
  });

  const sqlDeLaLlamada = (i = 0): string => String(query.mock.calls[i][0]);
  const paramsDeLaLlamada = (i = 0): any[] => query.mock.calls[i][1];

  // ───────────────────────────────────────────────────────────────
  describe('asignarPuerto: contar no es reservar (race condition del expediente §2.4)', () => {

    it('reclama el puerto con UN solo UPDATE condicional, sin SELECT previo', () => {
      // Si este test falla es porque alguien introdujo un "primero consulto si está
      // libre y después lo tomo". Entre esas dos sentencias entra otro request: es
      // exactamente la race condition que el modelo de filas físicas vino a cerrar.
      return service
        .asignarPuerto({ empresaId: EMPRESA, puertoId: PUERTO, contratoId: CONTRATO, usuarioId: USUARIO })
        .then(() => {
          const sql = sqlDeLaLlamada(0);
          expect(sql).toMatch(/^\s*UPDATE pe_nap_puerto/);
          expect(sql).toContain('WHERE');
          expect(sql).toContain('estado');
          expect(sql).toContain('RETURNING');
        });
    });

    it('la condición de estado va DENTRO del UPDATE, como parámetro', async () => {
      await service.asignarPuerto({
        empresaId: EMPRESA, puertoId: PUERTO, contratoId: CONTRATO, usuarioId: USUARIO,
      });
      const params = paramsDeLaLlamada(0);
      expect(params).toContain(PuertoEstado.LIBRE);
      expect(params).toContain(PuertoEstado.RESERVADO);
      expect(params).toContain(PuertoEstado.OCUPADO);
      // El aislamiento multi-tenant no es opcional ni siquiera en el camino atómico.
      expect(params).toContain(EMPRESA);
    });

    it('gana la carrera (1 fila) → crea la acometida en la MISMA transacción', async () => {
      query.mockResolvedValueOnce([{ id: PUERTO, nap_id: 'nap-1', numero: 3 }]);

      const r = await service.asignarPuerto({
        empresaId: EMPRESA, puertoId: PUERTO, contratoId: CONTRATO, usuarioId: USUARIO,
      });

      expect(r.clase).toBe('aplicado');
      expect(insert).toHaveBeenCalledWith(PeAcometida, expect.objectContaining({
        contratoId: CONTRATO,
        napPuertoId: PUERTO,
        empresaId: EMPRESA,
      }));
    });

    it('pierde la carrera (0 filas) → NO crea acometida', async () => {
      query.mockResolvedValueOnce([]);
      findOne.mockResolvedValueOnce({ id: PUERTO, numero: 3, estado: PuertoEstado.OCUPADO });
      findOne.mockResolvedValueOnce({ contratoId: 'otro-contrato' });

      const r = await service.asignarPuerto({
        empresaId: EMPRESA, puertoId: PUERTO, contratoId: CONTRATO, usuarioId: USUARIO,
      });

      expect(r.clase).toBe('rechazado_definitivo');
      expect(insert).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────────────────────
  describe('0 filas afectadas: el veredicto depende de QUIÉN tiene el puerto', () => {

    it('ocupado por OTRO contrato → rechazado_definitivo, nunca ya_en_destino', async () => {
      // Si la máquina de estados derivara idempotencia para `ocupar`, esto devolvería
      // "ya_en_destino" y dos contratos creerían tener el mismo puerto. Por eso
      // `ocupar` declara `hacia: null` y la decisión llega hasta aquí.
      query.mockResolvedValueOnce([]);
      findOne.mockResolvedValueOnce({ id: PUERTO, numero: 3, estado: PuertoEstado.OCUPADO });
      findOne.mockResolvedValueOnce({ contratoId: 'otro-contrato' });

      const r = await service.asignarPuerto({
        empresaId: EMPRESA, puertoId: PUERTO, contratoId: CONTRATO, usuarioId: USUARIO,
      });

      expect(r.clase).toBe('rechazado_definitivo');
    });

    it('ocupado por el MISMO contrato → ya_en_destino (ÉXITO idempotente)', async () => {
      // Un reintento leído como fallo produjo 1788 reintentos contra el MA5800 en 4
      // días (incidente 2026-07-28). Aquí el reintento es éxito y se detiene solo.
      query.mockResolvedValueOnce([]);
      findOne.mockResolvedValueOnce({ id: PUERTO, numero: 3, estado: PuertoEstado.OCUPADO });
      findOne.mockResolvedValueOnce({ contratoId: CONTRATO });

      const r = await service.asignarPuerto({
        empresaId: EMPRESA, puertoId: PUERTO, contratoId: CONTRATO, usuarioId: USUARIO,
      });

      expect(r.clase).toBe('ya_en_destino');
    });

    it('reservado por otro operador → reintentable, NO definitivo (la reserva vence sola)', async () => {
      // El error inverso del 28/07: un 409 de lock leído como veredicto definitivo hizo
      // que se descartara el trabajo. Ante la duda, reintentable: reintentar es
      // recuperable, descartar no.
      query.mockResolvedValueOnce([]);
      findOne.mockResolvedValueOnce({ id: PUERTO, numero: 3, estado: PuertoEstado.RESERVADO });

      const r = await service.asignarPuerto({
        empresaId: EMPRESA, puertoId: PUERTO, contratoId: CONTRATO, usuarioId: USUARIO,
      });

      expect(r.clase).toBe('reintentable');
    });

    it('sin splitter detrás (no_habilitado) → rechazo explicado por la máquina de estados', async () => {
      query.mockResolvedValueOnce([]);
      findOne.mockResolvedValueOnce({ id: PUERTO, numero: 9, estado: PuertoEstado.NO_HABILITADO });

      const r = await service.asignarPuerto({
        empresaId: EMPRESA, puertoId: PUERTO, contratoId: CONTRATO, usuarioId: USUARIO,
      });

      expect(r.clase).toBe('rechazado_definitivo');
      expect('motivo' in r && r.motivo).toContain('no_habilitado');
    });

    it('puerto inexistente → rechazado_definitivo', async () => {
      query.mockResolvedValueOnce([]);
      findOne.mockResolvedValueOnce(null);

      const r = await service.asignarPuerto({
        empresaId: EMPRESA, puertoId: PUERTO, contratoId: CONTRATO, usuarioId: USUARIO,
      });

      expect(r.clase).toBe('rechazado_definitivo');
    });
  });

  // ───────────────────────────────────────────────────────────────
  describe('reserva del wizard: el servidor es la autoridad, no el navegador', () => {

    it('reservar usa el mismo reclamo atómico', async () => {
      await service.reservarPuerto({ empresaId: EMPRESA, puertoId: PUERTO, usuarioId: USUARIO });
      expect(sqlDeLaLlamada(0)).toMatch(/^\s*UPDATE pe_nap_puerto/);
      expect(paramsDeLaLlamada(0)).toContain(String(RESERVA_TTL_MIN));
    });

    it('re-reservar el mismo puerto con el mismo usuario renueva el TTL, no falla', async () => {
      // El wizard puede volver atrás y avanzar de nuevo; eso no es un error.
      await service.reservarPuerto({ empresaId: EMPRESA, puertoId: PUERTO, usuarioId: USUARIO });
      const sql = sqlDeLaLlamada(0);
      expect(sql).toContain('reservado_por_usuario_id');
      expect(paramsDeLaLlamada(0)).toContain(USUARIO);
    });

    it('el heartbeat tiene TECHO ABSOLUTO: una pestaña olvidada no retiene el puerto para siempre', async () => {
      // Directriz de wizards, punto 10: el heartbeat SUPRIME el barrido, nunca lo
      // autoriza. Sin techo, el mecanismo de seguridad se convierte en el bloqueo.
      await service.extenderReserva({ empresaId: EMPRESA, puertoId: PUERTO, usuarioId: USUARIO });
      const sql = sqlDeLaLlamada(0);
      expect(sql).toContain('LEAST');
      expect(paramsDeLaLlamada(0)).toContain(String(RESERVA_TECHO_MIN));
      expect(RESERVA_TECHO_MIN).toBeGreaterThan(RESERVA_TTL_MIN);
    });

    it('extender una reserva ajena o vencida no lanza: es no_aplica', async () => {
      query.mockResolvedValueOnce([]);
      const r = await service.extenderReserva({
        empresaId: EMPRESA, puertoId: PUERTO, usuarioId: USUARIO,
      });
      expect(r.clase).toBe('no_aplica');
    });
  });

  // ───────────────────────────────────────────────────────────────
  describe('liberar y barrer: la anulación se reintenta sin efectos raros', () => {

    it('liberar borra la acometida ANTES de soltar el puerto', async () => {
      // Si el puerto quedara libre con una acometida viva apuntándolo, el índice único
      // impediría la siguiente asignación y el puerto quedaría inutilizable sin que
      // nadie entienda por qué.
      query.mockResolvedValueOnce([{ numero: 3 }]);
      await service.liberarPuerto({ empresaId: EMPRESA, puertoId: PUERTO });

      expect(softDelete).toHaveBeenCalledWith(
        PeAcometida,
        expect.objectContaining({ napPuertoId: PUERTO }),
      );
      const ordenSoftDelete = softDelete.mock.invocationCallOrder[0];
      const ordenUpdate = query.mock.invocationCallOrder[0];
      expect(ordenSoftDelete).toBeLessThan(ordenUpdate);
    });

    it('liberar un puerto ya LIBRE es ÉXITO idempotente (wizards, punto 8)', async () => {
      query.mockResolvedValueOnce([]);
      findOne.mockResolvedValueOnce({ id: PUERTO, numero: 3, estado: PuertoEstado.LIBRE });

      const r = await service.liberarPuerto({ empresaId: EMPRESA, puertoId: PUERTO });
      expect(r.clase).toBe('ya_en_destino');
    });

    it('el barrido no filtra por empresa: es mantenimiento del servidor', async () => {
      // Un puerto retenido no debe depender de que alguien de esa empresa esté conectado.
      query.mockResolvedValueOnce([{ id: 'p1' }, { id: 'p2' }]);
      const n = await service.barrerReservasExpiradas();

      expect(n).toBe(2);
      const sql = sqlDeLaLlamada(0);
      expect(sql).not.toContain('empresa_id');
      expect(sql).toContain('reservado_hasta <= now()');
    });

    it('el barrido sólo toca reservas VENCIDAS, nunca vigentes', async () => {
      await service.barrerReservasExpiradas();
      const params = paramsDeLaLlamada(0);
      expect(params).toContain(PuertoEstado.RESERVADO);
      expect(sqlDeLaLlamada(0)).toContain('reservado_hasta IS NOT NULL');
    });
  });

  // ───────────────────────────────────────────────────────────────
  describe('aislamiento multi-tenant', () => {

    it('todo camino de escritura de usuario filtra por empresa_id', async () => {
      await service.asignarPuerto({
        empresaId: EMPRESA, puertoId: PUERTO, contratoId: CONTRATO, usuarioId: USUARIO,
      });
      await service.reservarPuerto({ empresaId: EMPRESA, puertoId: PUERTO, usuarioId: USUARIO });
      await service.liberarPuerto({ empresaId: EMPRESA, puertoId: PUERTO });

      const updatesDeUsuario = query.mock.calls
        .map((c) => String(c[0]))
        .filter((s) => s.includes('UPDATE pe_nap_puerto'));

      expect(updatesDeUsuario.length).toBeGreaterThan(0);
      for (const sql of updatesDeUsuario) {
        expect(sql).toContain('empresa_id = $');
      }
    });

    it('ninguna escritura toca filas borradas', async () => {
      await service.asignarPuerto({
        empresaId: EMPRESA, puertoId: PUERTO, contratoId: CONTRATO, usuarioId: USUARIO,
      });
      expect(sqlDeLaLlamada(0)).toContain('deleted_at IS NULL');
    });
  });

  // ───────────────────────────────────────────────────────────────
  describe('vocabulario de dominio, no de transporte', () => {

    it('ningún método lanza excepciones HTTP: devuelven ResultadoOperacion', async () => {
      query.mockResolvedValue([]);
      findOne.mockResolvedValue(null);

      const clases = await Promise.all([
        service.asignarPuerto({ empresaId: EMPRESA, puertoId: PUERTO, contratoId: CONTRATO, usuarioId: USUARIO }),
        service.reservarPuerto({ empresaId: EMPRESA, puertoId: PUERTO, usuarioId: USUARIO }),
        service.liberarPuerto({ empresaId: EMPRESA, puertoId: PUERTO }),
        service.extenderReserva({ empresaId: EMPRESA, puertoId: PUERTO, usuarioId: USUARIO }),
      ]);

      for (const r of clases) {
        expect(typeof r.clase).toBe('string');
      }
    });
  });
});
