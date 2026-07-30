import { JwtService } from '@nestjs/jwt';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';

import {
  PortalJwtGuard, PortalJwtPayload, COOKIE_ACCESS,
  PORTAL_JWT_ISSUER, PORTAL_JWT_AUDIENCE, leerCookie,
} from './portal-auth.guard';

// Aislamiento portal ↔ ERP.
//
// El código afirma que "un token de portal no pasa ningún guard interno y un token de
// operador no pasa por el del portal". Esa es una garantía de exclusión: sin un test que
// la ejercite es solo un comentario, y el siguiente lector construye encima. Estos casos
// la sostienen.
//
// Audiencias en juego: el ERP firma y exige `datafast-app` (jwt.strategy.ts); el portal
// firma y exige `datafast-portal`.
const SECRETO_PORTAL = 'a'.repeat(48);
const SECRETO_ERP    = 'b'.repeat(48);
const AUDIENCE_ERP   = 'datafast-app';

const jwt = new JwtService({});

function contexto(headers: Record<string, string>): ExecutionContext {
  const req = { headers } as unknown as Request;
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function firmar(
  payload: Partial<PortalJwtPayload>,
  opts: { secret?: string; audience?: string; expiresIn?: string } = {},
): Promise<string> {
  return jwt.signAsync(
    { sub: 'cliente-1', empresaId: 'empresa-1', usuario: 'jperez', tipo: 'access', ...payload },
    {
      secret:    opts.secret   ?? SECRETO_PORTAL,
      audience:  opts.audience ?? PORTAL_JWT_AUDIENCE,
      issuer:    PORTAL_JWT_ISSUER,
      expiresIn: opts.expiresIn ?? '30m',
    },
  );
}

describe('Aislamiento de sesiones portal ↔ ERP', () => {
  let guard: PortalJwtGuard;
  const secretoOriginal = process.env.PORTAL_JWT_SECRET;

  beforeEach(() => {
    process.env.PORTAL_JWT_SECRET = SECRETO_PORTAL;
    guard = new PortalJwtGuard(jwt);
  });

  afterAll(() => {
    if (secretoOriginal === undefined) delete process.env.PORTAL_JWT_SECRET;
    else process.env.PORTAL_JWT_SECRET = secretoOriginal;
  });

  it('un token del portal NO verifica con la audiencia del ERP', async () => {
    const token = await firmar({});
    await expect(
      jwt.verifyAsync(token, {
        secret: SECRETO_PORTAL, issuer: PORTAL_JWT_ISSUER, audience: AUDIENCE_ERP,
      }),
    ).rejects.toThrow();
  });

  it('un token del ERP NO pasa el guard del portal (audiencia distinta)', async () => {
    const tokenErp = await firmar({}, { audience: AUDIENCE_ERP });
    await expect(
      guard.canActivate(contexto({ cookie: `${COOKIE_ACCESS}=${tokenErp}` })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('un token firmado con el secreto del ERP NO pasa el guard del portal', async () => {
    const token = await firmar({}, { secret: SECRETO_ERP });
    await expect(
      guard.canActivate(contexto({ cookie: `${COOKIE_ACCESS}=${token}` })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('un refresh token NO habilita el acceso a los datos', async () => {
    const token = await firmar({ tipo: 'refresh' });
    await expect(
      guard.canActivate(contexto({ cookie: `${COOKIE_ACCESS}=${token}` })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('un token expirado NO pasa', async () => {
    const token = await firmar({}, { expiresIn: '-1s' });
    await expect(
      guard.canActivate(contexto({ cookie: `${COOKIE_ACCESS}=${token}` })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('sin PORTAL_JWT_SECRET el guard rechaza — falla cerrado, no abierto', async () => {
    const token = await firmar({});
    delete process.env.PORTAL_JWT_SECRET;
    await expect(
      guard.canActivate(contexto({ cookie: `${COOKIE_ACCESS}=${token}` })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('un access token válido pasa y deja el abonado en el request', async () => {
    const token = await firmar({});
    const ctx = contexto({ cookie: `${COOKIE_ACCESS}=${token}` });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);

    const req = ctx.switchToHttp().getRequest() as Request & {
      portalCliente?: PortalJwtPayload;
    };
    expect(req.portalCliente?.sub).toBe('cliente-1');
    expect(req.portalCliente?.tipo).toBe('access');
  });

  it('acepta el token por cabecera Authorization además de por cookie', async () => {
    const token = await firmar({});
    await expect(
      guard.canActivate(contexto({ authorization: `Bearer ${token}` })),
    ).resolves.toBe(true);
  });
});

// El portal lee cookies sin cookie-parser (el proyecto no lo tiene). Si esta función
// se equivoca, la sesión del abonado se cae de formas difíciles de diagnosticar.
describe('leerCookie', () => {
  const req = (cookie?: string) => ({ headers: cookie ? { cookie } : {} }) as Request;

  it('extrae la cookie buscada entre varias', () => {
    expect(leerCookie(req('a=1; portal_access_token=xyz; b=2'), COOKIE_ACCESS)).toBe('xyz');
  });

  it('no confunde una cookie cuyo nombre termina igual', () => {
    expect(leerCookie(req('otro_portal_access_token=malo'), COOKIE_ACCESS)).toBeNull();
  });

  it('decodifica el valor y tolera espacios', () => {
    expect(leerCookie(req(`  ${COOKIE_ACCESS} = a%20b `), COOKIE_ACCESS)).toBe('a b');
  });

  it('devuelve null sin cabecera de cookies', () => {
    expect(leerCookie(req(), COOKIE_ACCESS)).toBeNull();
  });
});
