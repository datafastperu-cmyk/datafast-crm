import { FtthOnuEstado } from '../entities/ftth-onu-registro.entity';
import {
  FTTH_TRANSICIONES,
  FtthTransicion,
  evaluarTransicion,
  origenesDe,
} from './ftth-maquina-estados';

describe('máquina de estados FTTH', () => {
  // ── Regresión del incidente que originó todo ──────────────────────
  describe('desaprovisionar desde suspendido (incidente CNT-2026-000004)', () => {
    it('acepta `suspendido` como origen: es el camino más transitado del negocio', () => {
      // Un moroso suspendido al que se le da de baja. Omitirlo dejó una ONU huérfana en
      // la OLT y 1603 reintentos contra el MA5800. Si este test falla, volvió el bug.
      expect(origenesDe('desaprovisionar')).toContain(FtthOnuEstado.SUSPENDIDO);
      expect(evaluarTransicion('desaprovisionar', FtthOnuEstado.SUSPENDIDO)).toBeNull();
    });

    it('acepta también activo y los estados intermedios de provisión', () => {
      for (const e of [
        FtthOnuEstado.ACTIVO,
        FtthOnuEstado.GPON_REGISTRADO,
        FtthOnuEstado.WAN_INYECTADO,
        FtthOnuEstado.FALLIDO_ROLLBACK,
      ]) {
        expect(evaluarTransicion('desaprovisionar', e)).toBeNull();
      }
    });
  });

  // ── Idempotencia DERIVADA, no escrita a mano ──────────────────────
  describe('idempotencia', () => {
    it('suspender algo ya suspendido es ya_en_destino (ÉXITO, no error)', () => {
      // Tratarlo como fallo fue lo que produjo 1788 reintentos en 4 días.
      const r = evaluarTransicion('suspender', FtthOnuEstado.SUSPENDIDO);
      expect(r?.clase).toBe('ya_en_destino');
    });

    it('rehabilitar algo ya activo es ya_en_destino', () => {
      expect(evaluarTransicion('rehabilitar', FtthOnuEstado.ACTIVO)?.clase).toBe('ya_en_destino');
    });

    it('la idempotencia se deriva de `hacia`: toda transición con destino la tiene', () => {
      // Un método nuevo no puede olvidarse de ser idempotente porque no la implementa él.
      for (const [nombre, def] of Object.entries(FTTH_TRANSICIONES)) {
        if (def.hacia === null) continue;
        const r = evaluarTransicion(nombre as FtthTransicion, def.hacia);
        expect(r?.clase).toBe('ya_en_destino');
      }
    });
  });

  // ── Rechazos definitivos ──────────────────────────────────────────
  describe('orígenes ilegales', () => {
    it('suspender desde un estado de provisión incompleta es rechazo DEFINITIVO', () => {
      const r = evaluarTransicion('suspender', FtthOnuEstado.PENDIENTE);
      expect(r?.clase).toBe('rechazado_definitivo');
    });

    it('rehabilitar desde activo-fallido es rechazo definitivo, no reintentable', () => {
      // Reintentar esto no cambia nunca el resultado: debe cortar, no martillar la OLT.
      expect(evaluarTransicion('rehabilitar', FtthOnuEstado.FALLIDO_GPON)?.clase)
        .toBe('rechazado_definitivo');
    });

    it('el motivo nombra el estado actual y los válidos: el operador no adivina', () => {
      const r = evaluarTransicion('suspender', FtthOnuEstado.PENDIENTE);
      expect(r && 'motivo' in r && r.motivo).toMatch(/pendiente/);
      expect(r && 'motivo' in r && r.motivo).toMatch(/activo/);
    });
  });

  // ── Coherencia estructural de la tabla ────────────────────────────
  describe('coherencia de la declaración', () => {
    it('ninguna transición queda sin orígenes (sería inalcanzable)', () => {
      for (const [nombre, def] of Object.entries(FTTH_TRANSICIONES)) {
        expect(def.desde.length).toBeGreaterThan(0);
        expect(nombre).toBeTruthy();
      }
    });

    it('ningún destino aparece entre sus propios orígenes (contradiría la idempotencia)', () => {
      for (const def of Object.values(FTTH_TRANSICIONES)) {
        if (def.hacia === null) continue;
        expect(def.desde).not.toContain(def.hacia);
      }
    });

    it('todos los estados declarados existen en el enum', () => {
      const validos = Object.values(FtthOnuEstado);
      for (const def of Object.values(FTTH_TRANSICIONES)) {
        for (const e of def.desde) expect(validos).toContain(e);
        if (def.hacia !== null) expect(validos).toContain(def.hacia);
      }
    });
  });
});
