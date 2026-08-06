import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

/**
 * LA FRONTERA DEL DINERO — el mecanismo que sostiene la regla.
 *
 * Regla: ningún módulo del ERP modifica el saldo cobrado de un comprobante como
 * consecuencia de una entrada de dinero, salvo a través de `AplicadorFacturaService`.
 *
 * Este test existe porque esa regla ya se había enunciado antes y **estaba rota**. Cuando
 * se escribió, había CUATRO copias del mismo UPDATE, y no divergieron de golpe:
 * divergieron en la corrección que solo se aplicó a una. La copia de `adelantos` había
 * perdido el guard `estado NOT IN ('pagada','anulada')`, así que consumía el saldo a favor
 * del abonado contra comprobantes ANULADOS.
 *
 * Una garantía que nadie ejecuta es peor que ninguna, porque el siguiente lector construye
 * encima. Esto la ejecuta.
 *
 * Si este test falla, la pregunta NO es "cómo lo añado a la lista": es por qué ese código
 * mueve dinero por su cuenta.
 */
describe('Frontera del dinero — un solo escritor del saldo de una factura', () => {
  const SRC = join(__dirname, '..', '..');

  /**
   * Sitios autorizados a escribir `facturas.monto_pagado`, con el motivo. La lista es
   * corta a propósito: cada entrada es una excepción que alguien tuvo que justificar.
   */
  const AUTORIZADOS: Array<{ archivo: string; motivo: string }> = [
    {
      archivo: 'modules/facturacion/aplicador-factura.service.ts',
      motivo:  'ES la frontera: el único aplicador.',
    },
  ];

  const ficherosTs = (dir: string): string[] => {
    const salida: string[] = [];
    for (const entrada of readdirSync(dir)) {
      const ruta = join(dir, entrada);
      if (statSync(ruta).isDirectory()) {
        if (entrada === 'node_modules' || entrada === 'migrations') continue;
        salida.push(...ficherosTs(ruta));
        continue;
      }
      if (entrada.endsWith('.ts') && !entrada.endsWith('.spec.ts')) salida.push(ruta);
    }
    return salida;
  };

  const escritoresDeSaldo = (): string[] => {
    const encontrados: string[] = [];
    for (const ruta of ficherosTs(SRC)) {
      const contenido = readFileSync(ruta, 'utf8');
      // Cualquier UPDATE que toque `monto_pagado`. No se busca "UPDATE facturas" porque
      // el nombre de la tabla puede venir interpolado; lo que delata a un aplicador es
      // que mueva esa columna.
      if (/monto_pagado\s*=/.test(contenido)) {
        encontrados.push(relative(SRC, ruta).split(sep).join('/'));
      }
    }
    return encontrados;
  };

  it('solo los sitios autorizados mueven `facturas.monto_pagado`', () => {
    const permitidos = AUTORIZADOS.map((a) => a.archivo);
    const clandestinos = escritoresDeSaldo().filter((f) => !permitidos.includes(f));

    expect(clandestinos).toEqual([]);
  });

  it('la lista de autorizados es UNA entrada: la frontera, y nada más (F4 cerró la última)', () => {
    // Si esto falla porque añadiste una entrada, has tomado una decisión de arquitectura:
    // que hay un segundo sitio legítimo desde donde el dinero entra en una factura.
    // Justifícala en el commit, no en este número.
    expect(AUTORIZADOS).toHaveLength(1);
  });

  it('el aplicador conserva el guard de estado que la copia de adelantos había perdido', () => {
    // El defecto concreto: `adelantos` aplicaba saldo a favor a comprobantes ANULADOS
    // porque su copia del UPDATE no filtraba por estado. El guard vive ahora en un solo
    // sitio, y este test es lo que impide que se caiga sin ruido.
    const aplicador = readFileSync(
      join(SRC, 'modules/facturacion/aplicador-factura.service.ts'), 'utf8',
    );

    expect(aplicador).toMatch(/estado\s+NOT\s+IN\s*\(\s*'pagada'\s*,\s*'anulada'\s*\)/i);
    // Y la condición que impide el sobrepago silencioso cuando dos cajeros cobran a la vez.
    expect(aplicador).toMatch(/<=\s*\(total::numeric\s*-\s*monto_pagado::numeric\s*\+\s*0\.01\)/);
  });

  it('marcar vencidas NO es una entrada de dinero: puede tocar el estado, nunca el saldo', () => {
    // Excepción legítima y declarada. El paso del tiempo constata una fecha; no imputa
    // nada. Lo que este test fija es que siga sin tocar `monto_pagado`.
    const servicio = readFileSync(
      join(SRC, 'modules/facturacion/facturacion.service.ts'), 'utf8',
    );
    const marcarVencidas = servicio.slice(
      servicio.indexOf('async marcarVencidas'),
      servicio.indexOf('async aplicarPago'),
    );

    expect(marcarVencidas).not.toMatch(/monto_pagado/);
  });

  it('el job PROCESAR_PAGO no vuelve: era un segundo aplicador que cortó a un abonado que pagó', () => {
    // Aplicaba el pago y mantenía `fecha_ultimo_pago`, el campo contra el que se medía el
    // corte por mora. Nadie lo encolaba, así que el campo quedaba en NULL y el criterio
    // degeneraba en "días desde que se instaló": el 05/08 cortaron a James Pena al día
    // siguiente de pagar. Reintroducirlo devolvería el arma cargada.
    const worker = readFileSync(
      join(SRC, 'modules/workers/cobranza.worker.ts'), 'utf8',
    );

    // Se busca la DECLARACIÓN, no la palabra: la lápida que dejó F3 en ese archivo
    // menciona el job a propósito, para que quien lo eche de menos lea por qué se fue.
    expect(worker).not.toMatch(/@Process\(\{\s*name:\s*JOBS\.PROCESAR_PAGO/);
    expect(worker).not.toMatch(/async\s+enqueueProcesarPago\s*\(/);
  });
});
