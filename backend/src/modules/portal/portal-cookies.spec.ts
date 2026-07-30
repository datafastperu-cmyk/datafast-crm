import { Request, Response } from 'express';

import { PortalAuthService } from './portal-auth.service';
import { COOKIE_ACCESS, COOKIE_REFRESH } from './portal-auth.guard';

// Incidente 2026-07-30: "las credenciales no entran en el portal".
//
// El login respondía 200 y ponía las cookies, pero salían con `Secure` porque el flag se
// deducía de NODE_ENV (PM2 lo fuerza a 'production'). El portal se servía por HTTP, así
// que el navegador DESCARTABA las cookies sin avisar, el middleware no encontraba sesión
// y devolvía al login. Ningún log, ningún error: desde el servidor todo parecía correcto.
//
// La regla que fija este test: `Secure` depende del PROTOCOLO de la petición, nunca del
// entorno. Sin ella, el modo ruta (instalaciones locales o con solo IP, §14) no puede
// funcionar — y es un modo que existe por decisión de producto.

function servicio(): PortalAuthService {
  // Solo se ejercitan los helpers de cookies: las dependencias no se usan en ese camino.
  return new PortalAuthService(
    {} as never, {} as never, {} as never, {} as never,
  );
}

function peticion(opts: { secure?: boolean; forwardedProto?: string }): Request {
  return {
    secure:  opts.secure ?? false,
    headers: opts.forwardedProto ? { 'x-forwarded-proto': opts.forwardedProto } : {},
  } as unknown as Request;
}

function respuesta() {
  const puestas: Array<{ nombre: string; opciones: Record<string, unknown> }> = [];
  const res = {
    cookie: (nombre: string, _valor: string, opciones: Record<string, unknown>) => {
      puestas.push({ nombre, opciones });
    },
    clearCookie: (nombre: string, opciones: Record<string, unknown>) => {
      puestas.push({ nombre, opciones });
    },
  } as unknown as Response;
  return { res, puestas };
}

// `escribirCookies` y `borrarCookies` son privados: se acceden por índice a propósito.
// Probar el efecto observable (qué atributos salen) vale más que respetar el `private`,
// porque es justo ese detalle el que rompió producción.
type Interno = {
  escribirCookies(req: Request, res: Response, a: string, r: string): void;
  borrarCookies(req: Request, res: Response): void;
};

describe('Cookies del portal — `Secure` según el protocolo, no según NODE_ENV', () => {
  const nodeEnvOriginal = process.env.NODE_ENV;

  afterAll(() => { process.env.NODE_ENV = nodeEnvOriginal; });

  it('sobre HTTP la cookie NO lleva Secure — si no, el navegador la descarta', () => {
    // El escenario exacto del incidente: NODE_ENV=production y petición por HTTP.
    process.env.NODE_ENV = 'production';
    const { res, puestas } = respuesta();

    (servicio() as unknown as Interno).escribirCookies(
      peticion({ secure: false }), res, 'a', 'r',
    );

    expect(puestas).toHaveLength(2);
    for (const c of puestas) expect(c.opciones.secure).toBe(false);
  });

  it('sobre HTTPS directo la cookie SÍ lleva Secure', () => {
    process.env.NODE_ENV = 'development';
    const { res, puestas } = respuesta();

    (servicio() as unknown as Interno).escribirCookies(
      peticion({ secure: true }), res, 'a', 'r',
    );

    for (const c of puestas) expect(c.opciones.secure).toBe(true);
  });

  it('detrás de nginx con TLS (x-forwarded-proto: https) lleva Secure', () => {
    // Es como llega en producción con certificado: Express ve http, la cabecera manda.
    const { res, puestas } = respuesta();

    (servicio() as unknown as Interno).escribirCookies(
      peticion({ secure: false, forwardedProto: 'https' }), res, 'a', 'r',
    );

    for (const c of puestas) expect(c.opciones.secure).toBe(true);
  });

  it('siempre son HttpOnly y SameSite=lax, se sirva como se sirva', () => {
    const { res, puestas } = respuesta();

    (servicio() as unknown as Interno).escribirCookies(
      peticion({ secure: false }), res, 'a', 'r',
    );

    for (const c of puestas) {
      expect(c.opciones.httpOnly).toBe(true);
      expect(c.opciones.sameSite).toBe('lax');
      expect(c.opciones.path).toBe('/');
    }
    expect(puestas.map((c) => c.nombre).sort())
      .toEqual([COOKIE_ACCESS, COOKIE_REFRESH].sort());
  });

  it('al borrar se usan los MISMOS atributos que al escribir', () => {
    // Con atributos distintos el navegador trata la cookie como otra y la original
    // sobrevive al cierre de sesión.
    const req = peticion({ forwardedProto: 'https' });

    const escritura = respuesta();
    (servicio() as unknown as Interno).escribirCookies(req, escritura.res, 'a', 'r');

    const borrado = respuesta();
    (servicio() as unknown as Interno).borrarCookies(req, borrado.res);

    for (const nombre of [COOKIE_ACCESS, COOKIE_REFRESH]) {
      const puesta  = escritura.puestas.find((c) => c.nombre === nombre)!;
      const borrada = borrado.puestas.find((c) => c.nombre === nombre)!;
      expect(borrada.opciones.secure).toBe(puesta.opciones.secure);
      expect(borrada.opciones.sameSite).toBe(puesta.opciones.sameSite);
      expect(borrada.opciones.path).toBe(puesta.opciones.path);
      expect(borrada.opciones.httpOnly).toBe(puesta.opciones.httpOnly);
    }
  });
});
