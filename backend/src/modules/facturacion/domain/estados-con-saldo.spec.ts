import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ESTADOS_CON_SALDO, sqlDeudaExigible } from './estados-con-saldo';
import { EstadoFactura } from '../entities/factura.entity';

// ═══════════════════════════════════════════════════════════════════════════
// Desviación A-4: cuatro implementaciones del cálculo de deuda, una de las cuales
// decide cortes de servicio.
//
// El criterio "qué factura representa dinero que el cliente todavía debe" estaba escrito a
// mano en más de quince consultas, y no todas decían lo mismo: `en_cobranza` era deuda para
// el cobro nocturno —el que corta el servicio— y no lo era para el resumen financiero. No
// falla nada. El ERP responde distinto según por dónde se le pregunte, que es peor, porque
// nadie lo nota.
// ═══════════════════════════════════════════════════════════════════════════
describe('Estados con saldo — una sola definición (A-4)', () => {
  it('debe todo lo emitido y no saldado; no debe lo que aún no existe ni lo extinguido', () => {
    expect([...ESTADOS_CON_SALDO].sort()).toEqual(
      [
        EstadoFactura.EMITIDA,
        EstadoFactura.EN_COBRANZA,
        EstadoFactura.PAGADA_PARCIAL,
        EstadoFactura.VENCIDA,
      ].sort(),
    );

    // Los tres que NO deben estar, cada uno por su razón.
    expect(ESTADOS_CON_SALDO).not.toContain(EstadoFactura.BORRADOR); // aún no existe para el cliente
    expect(ESTADOS_CON_SALDO).not.toContain(EstadoFactura.PAGADA);   // ya no debe nada
    expect(ESTADOS_CON_SALDO).not.toContain(EstadoFactura.ANULADA);  // dejó de deber
  });

  // Que una deuda esté en gestión de cobro no la extingue. Omitirlo hacía que el resumen
  // financiero declarara menos deuda de la que el propio ERP usaba para cortar.
  it('`en_cobranza` cuenta como deuda', () => {
    expect(ESTADOS_CON_SALDO).toContain(EstadoFactura.EN_COBRANZA);
    expect(sqlDeudaExigible()).toContain('en_cobranza');
  });

  it('la lista SQL se interpola sin poder inyectar nada', () => {
    expect(sqlDeudaExigible()).toContain(
      `estado IN ('emitida', 'pagada_parcial', 'vencida', 'en_cobranza')`,
    );
    // Se interpola en vez de parametrizarse; la garantía es que el contenido sale del enum.
    for (const e of ESTADOS_CON_SALDO) {
      expect(e).toMatch(/^[a-z_]+$/);
    }
  });

  it('`sqlDeudaExigible` cualifica con alias o sin él', () => {
    expect(sqlDeudaExigible('f')).toBe(
      `f.estado IN ('emitida', 'pagada_parcial', 'vencida', 'en_cobranza') ` +
      `AND f.factura_original_id IS NULL`,
    );
    expect(sqlDeudaExigible()).toBe(
      `estado IN ('emitida', 'pagada_parcial', 'vencida', 'en_cobranza') ` +
      `AND factura_original_id IS NULL`,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Una nota de crédito NO es deuda (hallazgo 2026-08-08)
//
// El estado no basta para decir si una fila de `facturas` es dinero que el cliente debe:
// `crearNotaCredito` emite el abono con estado `emitida` e importe POSITIVO, porque el
// CHECK `facturas_total_check (total >= 0)` prohíbe los negativos que usan Odoo y ERPNext.
// Como `saldo` es `GENERATED ALWAYS AS (total - monto_pagado)`, el abono nacía con saldo a
// cobrar y los DIECIOCHO consumidores de la deuda lo contaban como cargo.
//
// Anular una factura de S/ 50 no bajaba la deuda —la original salía, su nota entraba— y al
// día siguiente el barrido de vencidas la marcaba `vencida`, con lo que además:
//   · sumaba un comprobante a `meses_deuda` → alimentaba el corte por meses acumulados;
//   · `deuda <= 0` no se cumplía nunca → el abonado paga todo y no se le reactiva;
//   · la cobranza le reclamaba el abono que se le acababa de conceder.
//
// Verificado en producción: 0 notas de crédito y 0 anulaciones. Estaba LATENTE, y la beta
// es precisamente cuando alguien anula por primera vez.
// ═══════════════════════════════════════════════════════════════════════════
describe('Una nota de crédito no cuenta como deuda (hallazgo 2026-08-08)', () => {
  it('el predicado exige documento de cargo, no solo estado', () => {
    // Sin esta condición, el abono se suma como si fuera un cargo.
    expect(sqlDeudaExigible()).toContain('factura_original_id IS NULL');
    expect(sqlDeudaExigible('f')).toContain('f.factura_original_id IS NULL');
  });

  it('el estado suelto ya no se puede pedir: el módulo no lo exporta', () => {
    // Dejarlo público era la forma de que el defecto volviera: quien necesitara la deuda
    // escribiría `estado IN ${SQL_ESTADOS_CON_SALDO}` y olvidaría el tipo de documento,
    // que es exactamente lo que pasó dieciocho veces.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const modulo = require('./estados-con-saldo');
    expect(Object.keys(modulo).sort()).toEqual(['ESTADOS_CON_SALDO', 'sqlDeudaExigible']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// La barrera. Una constante compartida no sirve de nada si el siguiente que necesita la
// lista la vuelve a teclear — que es exactamente cómo llegaron a ser quince.
// ═══════════════════════════════════════════════════════════════════════════
describe('Nadie vuelve a escribir la lista a mano (A-4)', () => {
  const RAIZ = join(__dirname, '..', '..', '..');

  const ficherosTs = (dir: string): string[] => {
    const salida: string[] = [];
    for (const entrada of readdirSync(dir)) {
      if (entrada === 'node_modules' || entrada === 'dist') continue;
      const ruta = join(dir, entrada);
      if (statSync(ruta).isDirectory()) { salida.push(...ficherosTs(ruta)); continue; }
      if (entrada.endsWith('.ts') && !entrada.endsWith('.spec.ts')) salida.push(ruta);
    }
    return salida;
  };

  // Los cuatro estados juntos en una misma línea, en cualquier orden y espaciado.
  const listaAMano = (linea: string): boolean => {
    const sinComentario = linea.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
    return ['emitida', 'pagada_parcial', 'vencida', 'en_cobranza']
      .every((e) => sinComentario.includes(`'${e}'`));
  };

  it('la lista de los cuatro estados con saldo solo se escribe en un sitio', () => {
    const infractores: string[] = [];

    for (const fichero of ficherosTs(RAIZ)) {
      const rel = fichero.slice(RAIZ.length + 1).replace(/\\/g, '/');

      // La definición, y la migración que la fija en la vista de BD. En una migración la
      // lista VA literal a propósito: es SQL que ya se aplicó a servidores en producción
      // y no puede cambiar de significado si mañana cambia la constante de TypeScript.
      if (rel.endsWith('facturacion/domain/estados-con-saldo.ts')) continue;
      if (rel.includes('database/migrations/')) continue;

      readFileSync(fichero, 'utf8').split(/\r?\n/).forEach((linea, i) => {
        if (listaAMano(linea)) infractores.push(`${rel}:${i + 1}`);
      });
    }

    expect(infractores).toEqual([]);
  });

  /**
   * La segunda mitad de la barrera, y la que faltaba: preguntar por la deuda SIN preguntar
   * por el tipo de documento. Con la lista centralizada seguían existiendo dieciocho sitios
   * que lo hacían, porque lo compartido era el estado y el defecto estaba en lo que no se
   * compartía.
   */
  it('quien consulta la tabla `facturas` por deuda usa el predicado completo', () => {
    const infractores: string[] = [];

    for (const fichero of ficherosTs(RAIZ)) {
      const rel = fichero.slice(RAIZ.length + 1).replace(/\\/g, '/');
      if (rel.endsWith('facturacion/domain/estados-con-saldo.ts')) continue;
      if (rel.includes('database/migrations/')) continue;

      const texto = readFileSync(fichero, 'utf8');
      // Consulta la tabla y filtra por estado sin usar el helper: sospechosa.
      if (!/\bFROM\s+facturas\b/i.test(texto)) continue;
      if (!/estado\s+IN\s*\(/i.test(texto)) continue;
      if (texto.includes('sqlDeudaExigible')) continue;

      // Un `estado IN (...)` sobre `facturas` que no pasa por el helper puede ser legítimo
      // —`marcarVencidas` filtra por ('emitida','pagada_parcial') y no calcula deuda—, así
      // que solo se marca cuando además suma o resta dinero.
      if (/SUM\s*\(\s*[a-z]*\.?(saldo|total)/i.test(texto)) infractores.push(rel);
    }

    expect(infractores).toEqual([]);
  });
});
