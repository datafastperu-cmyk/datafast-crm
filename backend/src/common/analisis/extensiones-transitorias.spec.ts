import { join } from 'node:path';
import {
  analizarCodigo,
  EXTENSIONES_TRANSITORIAS_RESULTADO_OPERACION,
  CASOS_FUERA_DE_D14_RESULTADO_OPERACION,
} from './metodos-frontera';

// ═══════════════════════════════════════════════════════════════════════════
// DOS registros, DOS techos — corrección de cierre de la Ola 1 (2026-08-17, propietario).
//
// Origen del primero: `SmartoltApiService.aprovisionarOnu()` crea un recurso (la ONU en
// SmartOLT) cuyo identificador el llamador realmente necesita — `ResultadoOperacion` no lleva
// payload A PROPÓSITO (evita que identificadores de proveedor entren al Core, E02-10/E04-10).
// La solución fue un tipo local (`ResultadoAprovisionarOnu`) declarado en el registro, no un
// campo `datos` en el tipo compartido. Eso ES deuda transitoria: tiene un binding de módulo
// (Ola 3) que algún día posee el identificador y retira la extensión.
//
// Por qué hay un SEGUNDO registro: la regla de parada de este mecanismo («para en la segunda o
// tercera entrada, es una excepción, no un patrón») existía y no frenó a nadie — el registro
// llegó a 5 entradas, 4 con `retiro: 'Sin fecha'`. Una extensión transitoria sin condición de
// cierre no es deuda, es permanente con otro nombre — y mezclada con la única deuda real,
// diluye la señal que el techo existe para dar. Las 4 no son identificadores de proveedor en
// tránsito: son evidencia de R-6 (F-0.1 §8) — casos que D-14 no cubre por diseño (consulta,
// éxito parcial, payload multi-borde), pendientes de una decisión de arquitectura del
// propietario ANTES de la Ola 3, no de una fecha de retiro que nadie puede prometer todavía.
// ═══════════════════════════════════════════════════════════════════════════
describe('Registro de extensiones TRANSITORIAS de ResultadoOperacion (deuda real, con retiro)', () => {
  // 1 = SmartoltApiService.aprovisionarOnu() (Ola 1, grupo 3a). Única entrada con condición de
  // retiro verificable (Ola 3). Ver metodos-frontera.ts.
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

  // PC-04, caso real: este registro llegó a tener 4 entradas con `retiro: 'Sin fecha'` — una
  // condición vacía no es una condición. Se ejercita explícitamente para que no vuelva a colarse.
  it('cada extensión declara una condición de retiro REAL — nunca "Sin fecha" ni vacía', () => {
    for (const ext of EXTENSIONES_TRANSITORIAS_RESULTADO_OPERACION) {
      expect(ext.retiro.trim().length).toBeGreaterThan(0);
      expect(ext.retiro.trim().toLowerCase()).not.toMatch(/^sin fecha/);
      expect(ext.razon.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('Registro de casos fuera de D-14 (evidencia de R-6, no deuda transitoria)', () => {
  // 4 = ProvisionFtthService.activarCarril() (payload_multi_borde) +
  // OnuTr069DetalleService.refrescarWifi() (consulta) + .setWifi()/.setWifiAmbasBandas()
  // (éxito_parcial) — Ola 1, grupo 4, cierre (2026-08-17). Ver metodos-frontera.ts.
  const TECHO_CASOS_FUERA_DE_D14 = 4;

  it('el número de casos fuera de D-14 declarados es exactamente el techo congelado', () => {
    // Mismo criterio simétrico: sube sin declarar → hueco nuevo sin registrar; baja sin
    // recongelar → esta prueba lo detiene (un caso resuelto por R-6 que nadie actualizó aquí).
    expect(CASOS_FUERA_DE_D14_RESULTADO_OPERACION.length).toBe(TECHO_CASOS_FUERA_DE_D14);
  });

  it('cada caso declarado corresponde a un método real, todavía vigente en el código', () => {
    const SRC = join(__dirname, '..', '..');
    const { metodos } = analizarCodigo(SRC);

    for (const caso of CASOS_FUERA_DE_D14_RESULTADO_OPERACION) {
      const m = metodos.find((x) => x.clase === caso.clase && x.nombre === caso.metodo);
      expect(m).toBeDefined();
      expect(m!.retorno).toContain(caso.tipo);
    }
  });

  it('cada caso nombra a qué hueco de D-14 corresponde y por qué — nunca implícito', () => {
    const VACIOS_VALIDOS = ['consulta', 'exito_parcial', 'payload_multi_borde'];
    for (const caso of CASOS_FUERA_DE_D14_RESULTADO_OPERACION) {
      expect(VACIOS_VALIDOS).toContain(caso.vacio);
      expect(caso.razon.trim().length).toBeGreaterThan(0);
    }
  });

  // Este registro NO tiene campo `retiro`: a diferencia de la deuda transitoria, no hay una
  // fecha ni un hito que lo cierre automáticamente — se resuelve cuando R-6 se conteste (F-0.1
  // §9, bloqueante de la Ola 3), no antes. Sostiene que el tipo NO declara ese campo.
  it('ningún caso finge una condición de retiro que no tiene', () => {
    for (const caso of CASOS_FUERA_DE_D14_RESULTADO_OPERACION) {
      expect((caso as any).retiro).toBeUndefined();
    }
  });
});
