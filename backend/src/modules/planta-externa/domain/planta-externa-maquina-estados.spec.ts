import {
  ElementoEstado,
  ElementoTransicion,
  ELEMENTO_TRANSICIONES,
  PuertoEstado,
  PuertoTransicion,
  PUERTO_TRANSICIONES,
  PUERTO_NO_RETIRABLE,
  PUERTO_CONSUME_CAPACIDAD,
  evaluarTransicionElemento,
  evaluarTransicionPuerto,
  origenesElemento,
  origenesPuerto,
} from './planta-externa-maquina-estados';

/**
 * Tests de la máquina de estados de planta externa.
 *
 * Cada bloque nombra el incidente o la regla que lo motiva. Un test llamado "no debería
 * fallar" se borra en la primera limpieza; uno que dice por qué existe sobrevive
 * (directriz "VIO hacia adentro", punto 3).
 */
describe('planta-externa: máquina de estados', () => {

  // ───────────────────────────────────────────────────────────────
  describe('idempotencia derivada del estado destino', () => {

    it('activar un elemento ya OPERATIVO es ya_en_destino (ÉXITO), no un error', () => {
      const r = evaluarTransicionElemento('activar', ElementoEstado.OPERATIVO);
      expect(r?.clase).toBe('ya_en_destino');
    });

    it('habilitar un puerto ya LIBRE es ya_en_destino (ÉXITO)', () => {
      const r = evaluarTransicionPuerto('habilitar', PuertoEstado.LIBRE);
      expect(r?.clase).toBe('ya_en_destino');
    });

    it('liberar un puerto ya LIBRE es ya_en_destino: reejecutar el barrido de reservas no es error', () => {
      // Directriz de wizards, punto 8: las compensaciones son idempotentes por contrato.
      // El cron de barrido puede pasar dos veces sobre la misma reserva vencida.
      const r = evaluarTransicionPuerto('liberar', PuertoEstado.LIBRE);
      expect(r?.clase).toBe('ya_en_destino');
    });

    it('NINGÚN método implementa la idempotencia a mano: se deriva de `hacia`', () => {
      // Si esta prueba falla es porque alguien agregó una transición con `hacia` apuntando
      // a un estado alcanzable y luego la reimplementó en el servicio. La máquina es el
      // único lugar donde vive el criterio.
      for (const [nombre, def] of Object.entries(ELEMENTO_TRANSICIONES)) {
        if (def.hacia === null) continue;
        const r = evaluarTransicionElemento(nombre as ElementoTransicion, def.hacia);
        expect(r?.clase).toBe('ya_en_destino');
      }
    });
  });

  // ───────────────────────────────────────────────────────────────
  describe('ocupar NO deriva idempotencia: el puerto puede ser de otro contrato', () => {

    it('ocupar declara `hacia: null` a propósito', () => {
      // Espejo invertido del incidente 2026-07-28: allí un no-op idempotente se leyó como
      // fallo (1788 reintentos contra el MA5800). Aquí, si se derivara la idempotencia, un
      // puerto ocupado POR OTRO CLIENTE devolvería "ya_en_destino" — un falso éxito que
      // dejaría a dos contratos creyendo tener el mismo puerto.
      expect(PUERTO_TRANSICIONES.ocupar.hacia).toBeNull();
    });

    it('ocupar un puerto ya OCUPADO no se resuelve en la máquina: llega al servicio, que conoce al dueño', () => {
      const r = evaluarTransicionPuerto('ocupar', PuertoEstado.OCUPADO);
      // No es `ya_en_destino`. Es rechazo, y el servicio decide según de quién sea la
      // acometida (mismo contrato → ya_en_destino; otro → rechazado_definitivo).
      expect(r?.clase).toBe('rechazado_definitivo');
    });
  });

  // ───────────────────────────────────────────────────────────────
  describe('un puerto sin splitter detrás no es asignable (capacidad de caja ≠ capacidad de splitter)', () => {

    it('NO_HABILITADO es el estado inicial y no se puede ocupar ni reservar', () => {
      // Caso real de planta: NAP de 16 puertos con un solo 1x8 instalado. Los 8 restantes
      // existen físicamente pero no dan servicio. El expediente los contaba como "libres",
      // y con eso el planificador ve capacidad donde no puede conectar a nadie.
      expect(evaluarTransicionPuerto('ocupar', PuertoEstado.NO_HABILITADO)?.clase)
        .toBe('rechazado_definitivo');
      expect(evaluarTransicionPuerto('reservar', PuertoEstado.NO_HABILITADO)?.clase)
        .toBe('rechazado_definitivo');
    });

    it('sólo se habilita al instalar un splitter', () => {
      expect(origenesPuerto('habilitar')).toEqual([PuertoEstado.NO_HABILITADO]);
      expect(evaluarTransicionPuerto('habilitar', PuertoEstado.NO_HABILITADO)).toBeNull();
    });

    it('un puerto RESERVADO consume capacidad de splitter aunque no tenga cliente', () => {
      // Si no contara, dos wizards simultáneos sobre-suscribirían la caja.
      expect(PUERTO_CONSUME_CAPACIDAD).toContain(PuertoEstado.RESERVADO);
      expect(PUERTO_CONSUME_CAPACIDAD).toContain(PuertoEstado.OCUPADO);
      expect(PUERTO_CONSUME_CAPACIDAD).not.toContain(PuertoEstado.LIBRE);
    });
  });

  // ───────────────────────────────────────────────────────────────
  describe('no se destruye trazabilidad de clientes conectados', () => {

    it('retirar el splitter NO deshabilita puertos OCUPADOS', () => {
      // Sin este guard, retirar un splitter vaciaría en cascada los puertos y con ellos la
      // trazabilidad de clientes que siguen navegando.
      expect(evaluarTransicionPuerto('deshabilitar', PuertoEstado.OCUPADO)?.clase)
        .toBe('rechazado_definitivo');
    });

    it('un puerto OCUPADO no se puede retirar', () => {
      // Retirar una caja con clientes colgando es la discordancia físico↔lógico que el ERP
      // existe para evitar (incidente 2026-07-21, ONU huérfana).
      expect(PUERTO_NO_RETIRABLE).toContain(PuertoEstado.OCUPADO);
      expect(origenesPuerto('retirar')).not.toContain(PuertoEstado.OCUPADO);
      expect(evaluarTransicionPuerto('retirar', PuertoEstado.OCUPADO)?.clase)
        .toBe('rechazado_definitivo');
    });

    it('reparar un puerto lo devuelve a LIBRE, nunca a OCUPADO', () => {
      // Reparar no reconecta al cliente que estaba ahí. Si vuelve, es una acometida nueva
      // y queda auditada como tal.
      expect(PUERTO_TRANSICIONES.reparar.hacia).toBe(PuertoEstado.LIBRE);
    });
  });

  // ───────────────────────────────────────────────────────────────
  describe('documentar planta preexistente no exige simular pasos que nunca ocurrieron', () => {

    it('activar acepta PLANIFICADO además de INSTALADO', () => {
      // Un técnico que carga una mufa instalada hace tres años no debe verse obligado a
      // simular un paso por "instalado". Forzar el camino largo es lo que hace que la
      // gente ponga datos falsos.
      expect(origenesElemento('activar')).toContain(ElementoEstado.PLANIFICADO);
      expect(evaluarTransicionElemento('activar', ElementoEstado.PLANIFICADO)).toBeNull();
    });

    it('retirar acepta todo estado no terminal, incluido PLANIFICADO (proyecto cancelado)', () => {
      for (const estado of [
        ElementoEstado.PLANIFICADO,
        ElementoEstado.INSTALADO,
        ElementoEstado.OPERATIVO,
        ElementoEstado.AVERIADO,
      ]) {
        expect(evaluarTransicionElemento('retirar', estado)).toBeNull();
      }
    });

    it('RETIRADO es terminal: no se reactiva', () => {
      expect(evaluarTransicionElemento('activar', ElementoEstado.RETIRADO)?.clase)
        .toBe('rechazado_definitivo');
      expect(evaluarTransicionElemento('reparar', ElementoEstado.RETIRADO)?.clase)
        .toBe('rechazado_definitivo');
    });
  });

  // ───────────────────────────────────────────────────────────────
  describe('el rechazo explica y es auditable', () => {

    it('el motivo nombra el estado actual, la descripción de negocio y los orígenes válidos', () => {
      const r = evaluarTransicionPuerto('ocupar', PuertoEstado.NO_HABILITADO, 'El puerto 9');
      expect(r?.clase).toBe('rechazado_definitivo');
      const motivo = r && 'motivo' in r ? r.motivo : '';
      expect(motivo).toContain('no_habilitado');
      expect(motivo).toContain('acometida');
      expect(motivo).toContain('libre');
    });

    it('ninguna transición declara una lista de orígenes vacía', () => {
      // Una transición sin orígenes es código muerto que aparenta ser una regla.
      for (const def of Object.values(ELEMENTO_TRANSICIONES)) {
        expect(def.desde.length).toBeGreaterThan(0);
      }
      for (const def of Object.values(PUERTO_TRANSICIONES)) {
        expect(def.desde.length).toBeGreaterThan(0);
      }
    });

    it('ninguna transición se declara a sí misma como origen', () => {
      // `desde` incluyendo `hacia` haría inalcanzable la rama de idempotencia: el estado
      // destino se evalúa primero, así que ese origen nunca se ejercitaría.
      const todas = [
        ...Object.values(ELEMENTO_TRANSICIONES),
        ...Object.values(PUERTO_TRANSICIONES),
      ];
      for (const def of todas) {
        if (def.hacia === null) continue;
        expect(def.desde).not.toContain(def.hacia as never);
      }
    });
  });

  // ───────────────────────────────────────────────────────────────
  describe('cobertura de la máquina: todo estado es alcanzable y toda transición es evaluable', () => {

    it('todo estado de elemento (salvo el inicial) es destino de alguna transición', () => {
      const destinos = Object.values(ELEMENTO_TRANSICIONES)
        .map((d) => d.hacia)
        .filter((h): h is ElementoEstado => h !== null);

      for (const estado of Object.values(ElementoEstado)) {
        if (estado === ElementoEstado.PLANIFICADO) continue; // estado de alta
        expect(destinos).toContain(estado);
      }
    });

    it('todo estado de puerto (salvo el inicial) es destino de alguna transición', () => {
      const destinos = Object.values(PUERTO_TRANSICIONES)
        .map((d) => d.hacia)
        .filter((h): h is PuertoEstado => h !== null);

      for (const estado of Object.values(PuertoEstado)) {
        if (estado === PuertoEstado.NO_HABILITADO) continue; // estado de alta
        if (estado === PuertoEstado.OCUPADO) continue;       // `ocupar` usa hacia:null a propósito
        expect(destinos).toContain(estado);
      }
    });

    it('evaluar cualquier transición contra cualquier estado no lanza', () => {
      // La máquina devuelve veredictos, nunca excepciones: la traducción a HTTP ocurre en
      // el borde (`traducirAHttp`), nunca en el dominio.
      for (const t of Object.keys(ELEMENTO_TRANSICIONES) as ElementoTransicion[]) {
        for (const e of Object.values(ElementoEstado)) {
          expect(() => evaluarTransicionElemento(t, e)).not.toThrow();
        }
      }
      for (const t of Object.keys(PUERTO_TRANSICIONES) as PuertoTransicion[]) {
        for (const e of Object.values(PuertoEstado)) {
          expect(() => evaluarTransicionPuerto(t, e)).not.toThrow();
        }
      }
    });
  });
});
