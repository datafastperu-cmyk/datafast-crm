import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ESTADOS_CON_SALDO, SQL_ESTADOS_CON_SALDO, sqlEstadoConSaldo } from './estados-con-saldo';
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
    expect(SQL_ESTADOS_CON_SALDO).toContain('en_cobranza');
  });

  it('la lista SQL se interpola sin poder inyectar nada', () => {
    expect(SQL_ESTADOS_CON_SALDO).toBe(
      `('emitida', 'pagada_parcial', 'vencida', 'en_cobranza')`,
    );
    // Se interpola en vez de parametrizarse; la garantía es que el contenido sale del enum.
    for (const e of ESTADOS_CON_SALDO) {
      expect(e).toMatch(/^[a-z_]+$/);
    }
  });

  it('`sqlEstadoConSaldo` cualifica con alias o sin él', () => {
    expect(sqlEstadoConSaldo('f')).toBe(`f.estado IN ${SQL_ESTADOS_CON_SALDO}`);
    expect(sqlEstadoConSaldo()).toBe(`estado IN ${SQL_ESTADOS_CON_SALDO}`);
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
});
