import { join } from 'node:path';
import {
  analizarCodigo,
  EXTENSIONES_TRANSITORIAS_RESULTADO_OPERACION,
} from './metodos-frontera';

// ═══════════════════════════════════════════════════════════════════════════
// Registro de extensiones LOCALES y TRANSITORIAS de ResultadoOperacion (Ola 1, grupo 3a,
// 2026-08-16). Origen: `SmartoltApiService.aprovisionarOnu()` crea un recurso (la ONU en
// SmartOLT) cuyo identificador el llamador realmente necesita — `ResultadoOperacion` no lleva
// payload A PROPÓSITO (evita que identificadores de proveedor entren al Core, E02-10/E04-10).
// La solución fue un tipo local (`ResultadoAprovisionarOnu`) declarado en este registro, no un
// campo `datos` en el tipo compartido.
//
// QUÉ MIDE ESTA BARRERA: que el registro no crezca sin control, y que cada entrada siga
// correspondiendo a código real — un registro que declara una excepción para un método que ya
// no existe (renombrado, eliminado) es una deuda fantasma que nadie va a encontrar para
// retirarla en la Ola 3.
//
// TÉCHO CONGELADO — solo puede BAJAR (cuando la Ola 3 retire una entrada), nunca subir sin que
// la entrada nueva se declare aquí primero con su propia razón y fecha de retiro.
// ═══════════════════════════════════════════════════════════════════════════
describe('Registro de extensiones transitorias de ResultadoOperacion', () => {
  // 1 = SmartoltApiService.aprovisionarOnu() (Ola 1, grupo 3a). Ver metodos-frontera.ts.
  const TECHO_EXTENSIONES_TRANSITORIAS = 1;

  it('el número de extensiones transitorias declaradas es exactamente el techo congelado', () => {
    // Sube sin declarar aquí → deuda nueva sin registrar (F-0.1-A §6). Baja sin recongelar →
    // esta prueba lo detiene igual (mismo criterio simétrico que TECHO_TABLAS_COMPARTIDAS).
    expect(EXTENSIONES_TRANSITORIAS_RESULTADO_OPERACION.length).toBe(TECHO_EXTENSIONES_TRANSITORIAS);
  });

  it('cada extensión declarada corresponde a un método real, todavía vigente en el código', () => {
    const SRC = join(__dirname, '..', '..');
    const { metodos } = analizarCodigo(SRC);

    for (const ext of EXTENSIONES_TRANSITORIAS_RESULTADO_OPERACION) {
      const m = metodos.find((x) => x.clase === ext.clase && x.nombre === ext.metodo);
      expect(m).toBeDefined();
      // El tipo declarado en el registro debe aparecer en la firma real — si alguien cambia
      // el nombre del tipo sin actualizar el registro, esta prueba lo detecta.
      expect(m!.retorno).toContain(ext.tipo);
    }
  });

  it('cada extensión declara su condición de retiro — no queda como deuda sin destino', () => {
    for (const ext of EXTENSIONES_TRANSITORIAS_RESULTADO_OPERACION) {
      expect(ext.retiro.trim().length).toBeGreaterThan(0);
      expect(ext.razon.trim().length).toBeGreaterThan(0);
    }
  });
});
