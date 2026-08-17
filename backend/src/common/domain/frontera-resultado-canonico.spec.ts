import { join } from 'node:path';
import { analizarCodigo, operacionesDeFrontera, operacionesSinResultadoOperacion } from '../analisis/metodos-frontera';

// ═══════════════════════════════════════════════════════════════════════════
// E03-03 — «Ningún resultado se expresa en vocabulario de transporte» (E-0.3 §11).
// Comprobación de la Ola 1 (F-0.1 §9.1), entregable de la ola — no de después
// (F-0.1 §10.2 · F-0.1-A §4.2).
//
// Origen (D-14, E-0.3 §10): dos incidentes reales nacieron de leer transporte donde debía
// leerse dominio. Un no-op idempotente interpretado como fallo produjo 1788 reintentos
// contra el MA5800 en 4 días; un 409 de lock ocupado interpretado como veredicto definitivo
// descartó trabajo válido. F-0.1 §6 lo resume: «el outbox hace arqueología sobre códigos
// HTTP» — exactamente lo que pasa cuando una operación de frontera lanza `BadRequestException`
// o `ConflictException` en vez de devolver una de las seis clases canónicas.
//
// QUÉ MIDE: si una OPERACIÓN DE FRONTERA (`operacionesDeFrontera()`, definición congelada en
// `metodos-frontera.ts` — método público de un `*Service`, invocado desde al menos otro
// módulo) lanza una excepción HTTP de Nest (`throw new XException(...)`) dentro de su propio
// cuerpo. E03-03 no prohíbe el HTTP: lo prohíbe DENTRO del dominio. El borde sigue hablando
// HTTP (E-0.3 D-14) — el controller traduce en el borde; esta barrera no mira controllers.
//
// TÉCHO CONGELADO, no cero: hoy 959 operaciones existen y solo 11 hablan `ResultadoOperacion`
// (F-0.1 §5.1). Convertir las operaciones de frontera que lanzan HTTP es el trabajo de la
// Ola 1, no una condición para arrancarla. El techo puede bajar (cada conversión real),
// nunca subir sin ADR — mismo mecanismo que `TECHO_TABLAS_COMPARTIDAS` (Ola 0, ADR-032 §4.4).
//
// DIVERGENCIA DECLARADA de ADR-032 §4.4 (F-0.1-A §7.1, regla 7): esta prueba falla también si
// el número BAJA sin que se actualice la constante — un techo que solo bloquea al subir deja
// pasar en silencio el día en que alguien convierte una operación y nadie recongela.
// ═══════════════════════════════════════════════════════════════════════════
describe('Ninguna operación de frontera lanza vocabulario de transporte (E03-03)', () => {
  const SRC = join(__dirname, '..', '..');
  const { metodos } = analizarCodigo(SRC);
  const frontera = operacionesDeFrontera(metodos);

  const EXCEPCION_TRANSPORTE = /throw\s+new\s+(\w*Exception)\s*\(/g;

  interface Hallazgo { id: string; excepciones: string[] }
  const hallazgos = (): Hallazgo[] => {
    const out: Hallazgo[] = [];
    for (const m of frontera) {
      const vistas = new Set<string>();
      for (const [, exc] of m.cuerpo.matchAll(EXCEPCION_TRANSPORTE)) vistas.add(exc);
      if (vistas.size) out.push({ id: `${m.clase}.${m.nombre}`, excepciones: [...vistas].sort() });
    }
    return out;
  };

  // 14 = recongelado el 2026-08-16 tras el grupo 3b, sub-lote XuiLines+SmartoltApi
  // (XuiLinesService.crearLineParaContrato() ya no lanza NotFoundException — bajó de 15).
  // Desglose: 9 BadRequestException, 8 NotFoundException, 2 ConflictException (una operación
  // puede lanzar más de una clase).
  const TECHO_FRONTERA_CON_EXCEPCION_TRANSPORTE = 14;

  it('el número de operaciones de frontera que lanzan HttpException es exactamente el techo congelado', () => {
    const encontrados = hallazgos().map((h) => h.id).sort();

    // Si esto falla porque SUBIÓ: una operación de frontera nueva (o tocada) volvió a lanzar
    // HTTP en vez de devolver ResultadoOperacion — no se acepta ni como deuda (F-0.1-A §6).
    // Si falla porque BAJÓ: recongelar aquí en el número nuevo, es progreso real.
    expect(encontrados.length).toBe(TECHO_FRONTERA_CON_EXCEPCION_TRANSPORTE);
  });

  // PC-04 — el caso malo también se verifica: no basta con que el conteo agregado cuadre,
  // hace falta ver que el detector encuentra un caso real y con nombre. `cambiarEstado()` es
  // la operación central del ciclo de vida del Contrato (437 líneas, dossier E-0.2) y hoy
  // lanza `BadRequestException` ante una transición inválida — ese `BadRequestException` es
  // exactamente el vocabulario de transporte que E03-03 prohíbe en el dominio.
  it('caso conocido: ContratosService.cambiarEstado() lanza BadRequestException (pendiente de convertir)', () => {
    const h = hallazgos().find((x) => x.id === 'ContratosService.cambiarEstado');
    expect(h).toBeDefined();
    expect(h!.excepciones).toContain('BadRequestException');
  });

  // El caso malo inverso: una operación que YA habla el vocabulario de dominio no debe
  // aparecer aquí. Si `PlantaExternaService.transicionarElemento()` (ya devuelve
  // `ResultadoOperacion`, ver E-0.2-interacciones.md) empezara a figurar, sería una regresión.
  it('caso conocido: una operación que ya devuelve ResultadoOperacion no aparece en los hallazgos', () => {
    const h = hallazgos().find((x) => x.id === 'PlantaExternaService.transicionarElemento');
    expect(h).toBeUndefined();
  });

  // Regresión del grupo 1 (outbox → olt-nativo, 2026-08-16): reaplicar() lanzaba
  // NotFoundException/BadRequestException directamente; ahora los devuelve como
  // `rechazado_definitivo`. Si volviera a lanzar, este test lo detecta antes que el
  // conteo agregado.
  it('caso conocido: ProvisionFtthService.reaplicar() ya no lanza excepción de transporte', () => {
    const h = hallazgos().find((x) => x.id === 'ProvisionFtthService.reaplicar');
    expect(h).toBeUndefined();
  });

  // Regresión del grupo 3a (mikrotik → openvpn, 2026-08-16): revocar() lanzaba
  // ConflictException para "ya revocado" — exactamente el 409 que el llamador
  // (MikrotikService.removeRouter()) tenía que adivinar por status/constructor (D-14).
  // Ahora es `ya_en_destino`.
  it('caso conocido: VpnClienteService.revocar() ya no lanza excepción de transporte', () => {
    const h = hallazgos().find((x) => x.id === 'VpnClienteService.revocar');
    expect(h).toBeUndefined();
  });

  // Regresión del grupo 3a (2026-08-16): aprovisionarOnu() lanzaba BadRequestException si
  // SmartOLT no devolvía un id de ONU válido. Ahora es `rechazado_definitivo`.
  it('caso conocido: SmartoltApiService.aprovisionarOnu() ya no lanza excepción de transporte', () => {
    const h = hallazgos().find((x) => x.id === 'SmartoltApiService.aprovisionarOnu');
    expect(h).toBeUndefined();
  });

  // Regresión del grupo 3b, sub-lote XuiLines+SmartoltApi (2026-08-16):
  // crearLineParaContrato() lanzaba NotFoundException si el contrato no existía. Ahora es
  // `rechazado_definitivo`.
  it('caso conocido: XuiLinesService.crearLineParaContrato() ya no lanza excepción de transporte', () => {
    const h = hallazgos().find((x) => x.id === 'XuiLinesService.crearLineParaContrato');
    expect(h).toBeUndefined();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // ANCHO — operaciones de frontera que NO hablan ResultadoOperacion, ni literalmente ni por
  // una extensión declarada (`EXTENSIONES_TRANSITORIAS_RESULTADO_OPERACION`,
  // metodos-frontera.ts). F-0.1 §9.1 lo llamaba «ancho E03-03» y lo narraba solo en prosa —
  // sin comprobación, la cifra de la doc y la que un script regeneraba podían divergir sin que
  // nada lo detectara (el error 15-frente-a-23 de la Ola 0, otra vez). Aquí queda exigido.
  //
  // `SmartoltApiService.aprovisionarOnu()` habla el vocabulario de dominio (las seis clases)
  // pero con un tipo local (`ResultadoAprovisionarOnu`) porque necesita cargar el payload que
  // `ResultadoOperacion` no lleva a propósito — el registro declara esa excepción una vez, en
  // vez de que el medidor la adivine por el nombre del tipo (eso sería maquillarlo).
  // ═══════════════════════════════════════════════════════════════════════
  // 77 = recongelado el 2026-08-16 tras el grupo 3b, sub-lote MikrotikService.crearReglasControl()
  // (78 → 77, único llamador ContratosService.provisionarMikrotik()).
  const TECHO_FRONTERA_SIN_RESULTADO_OPERACION = 77;

  it('el ancho (frontera sin ResultadoOperacion, ni literal ni por extensión declarada) es exactamente el techo congelado', () => {
    const sinRO = operacionesSinResultadoOperacion(metodos).map((m) => `${m.clase}.${m.nombre}`).sort();
    // Mismo criterio simétrico que el techo de excepciones: sube → conversión perdida o
    // regresión sin declarar; baja sin recongelar aquí → esta prueba lo detiene igual.
    expect(sinRO.length).toBe(TECHO_FRONTERA_SIN_RESULTADO_OPERACION);
  });

  // El caso que motivó este techo: aprovisionarOnu() SÍ habla ResultadoOperacion (vía su
  // extensión declarada) y por eso NO debe aparecer en el ancho, aunque `clasificarRetorno()`
  // por sí solo lo clasificaría como «objeto» al no reconocer el nombre del tipo local.
  it('caso conocido: SmartoltApiService.aprovisionarOnu() no aparece en el ancho — su extensión está declarada', () => {
    const sinRO = operacionesSinResultadoOperacion(metodos).map((m) => `${m.clase}.${m.nombre}`);
    expect(sinRO).not.toContain('SmartoltApiService.aprovisionarOnu');
  });
});
